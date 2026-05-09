require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const WHATSAPP_API = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}`;
const AI_SERVER = process.env.AI_SERVER_URL || 'http://localhost:5000';

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
app.post('/webhook', async (req, res) => {
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