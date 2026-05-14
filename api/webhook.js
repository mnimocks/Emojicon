const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id;
      const customerId = session.customer;

      if (session.mode === 'payment') {
        await supabase.from('profiles').upsert({
          id: userId,
          tier: 'pro_lifetime',
          tier_expires_at: null,
          stripe_customer_id: customerId,
        }, { onConflict: 'id' });

      } else if (session.mode === 'subscription') {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const expiresAt = new Date(sub.current_period_end * 1000).toISOString();

        await supabase.from('profiles').upsert({
          id: userId,
          tier: 'pro_monthly',
          tier_expires_at: expiresAt,
          stripe_customer_id: customerId,
          stripe_subscription_id: session.subscription,
        }, { onConflict: 'id' });
      }
    }

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      // Skip the initial charge — checkout.session.completed already handled it
      if (invoice.subscription && invoice.billing_reason !== 'subscription_create') {
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        const expiresAt = new Date(sub.current_period_end * 1000).toISOString();

        await supabase.from('profiles')
          .update({ tier: 'pro_monthly', tier_expires_at: expiresAt })
          .eq('stripe_customer_id', invoice.customer);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await supabase.from('profiles')
        .update({ tier: 'free', tier_expires_at: null, stripe_subscription_id: null })
        .eq('stripe_customer_id', sub.customer);
    }

  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  res.status(200).json({ received: true });
};
