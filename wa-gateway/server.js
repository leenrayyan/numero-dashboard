require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

// Capture the raw request body during JSON parsing so we can verify Meta's
// HMAC signature on inbound webhooks. The signature is computed on the exact
// bytes Meta sent — any reformatting (whitespace, key order) would break it,
// so we cannot re-serialise from req.body.
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

const WHATSAPP_API = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}`;
const AI_SERVER = process.env.AI_SERVER_URL || 'http://localhost:5000';
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

if (!APP_SECRET) {
  console.error('❌ WHATSAPP_APP_SECRET missing — webhook signature verification disabled. Set it in .env before exposing this service publicly.');
}

// ─── META WEBHOOK SIGNATURE VERIFICATION ──────────────────────────────────────
// Meta signs every webhook POST with HMAC-SHA256(rawBody, APP_SECRET) and sends
// the result in the `x-hub-signature-256` header as `sha256=<hex>`. We recompute
// it here and compare with a constant-time check so anyone POSTing to /webhook
// without knowing the secret is rejected.
function verifyMetaSignature(req, res, next) {
  if (!APP_SECRET) {
    // No secret configured — deny by default rather than silently accepting
    // (fail-closed). Flip to next() if you knowingly want to skip in local dev.
    return res.status(401).send('signature verification not configured');
  }

  const header = req.get('x-hub-signature-256');
  if (!header || !header.startsWith('sha256=')) {
    return res.status(401).send('missing or malformed signature header');
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', APP_SECRET)
    .update(req.rawBody || Buffer.from(''))
    .digest('hex');

  // timingSafeEqual rejects buffers of different lengths up-front, and prevents
  // an attacker from learning the correct prefix byte-by-byte via response time.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn('🚫 Webhook signature mismatch — rejecting request');
    return res.status(401).send('invalid signature');
  }

  next();
}

// ─── WEBHOOK VERIFICATION ─────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── INCOMING MESSAGES ────────────────────────────────────────────────────────
app.post('/webhook', verifyMetaSignature, async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body.object || body.object !== 'whatsapp_business_account') return;

    const value = body.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages) return;

    const message = value.messages[0];
    const userId = message.from;

    if (message.type !== 'text') {
      await sendMessage(userId, "Thanks for your message! I can only handle text right now. What would you like to know? 😊");
      return;
    }

    const userText = message.text.body;
    console.log(`📨 From ${userId}: ${userText}`);

    const aiResponse = await axios.post(`${AI_SERVER}/chat`, {
      user_id: userId,
      user_message: userText
    });

    const reply = aiResponse.data.reply;
    await sendMessage(userId, reply);
    console.log(`📤 Replied to ${userId}: ${reply}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function sendMessage(to, text) {
  await axios.post(
    `${WHATSAPP_API}/messages`,
    {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

module.exports = { sendMessage };

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Numero eSIM Bot running on port ${process.env.PORT || 3000}`);
});