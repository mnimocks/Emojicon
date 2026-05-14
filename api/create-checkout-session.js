const Stripe = require('stripe');

const PRICE_LIFETIME = 'price_1TT4CCKS4YmKUzv3CrJryfgg';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });

  let priceId, userId, userEmail;
  try {
    ({ priceId, userId, userEmail } = JSON.parse(raw));
  } catch {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  if (!priceId || !userId) {
    res.status(400).json({ error: 'Missing priceId or userId' });
    return;
  }

  const baseUrl = `https://${req.headers.host}`;
  const isLifetime = priceId === PRICE_LIFETIME;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: isLifetime ? 'payment' : 'subscription',
      success_url: `${baseUrl}/?payment=success`,
      cancel_url: `${baseUrl}/?payment=cancelled`,
      client_reference_id: userId,
      customer_email: userEmail || undefined,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
