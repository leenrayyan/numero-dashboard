/**
 * Numero WhatsApp Bot — Node.js entry point
 *
 * Responsibilities:
 *  1. Meta webhook verification  (GET /webhook)
 *  2. Incoming message handler   (POST /webhook → ai-server /chat)
 *  3. Delivery event tracker     (POST /webhook status events → backend /api/campaigns/recipients/event)
 *  4. Campaign sender cron       (every 60s → polls backend for queued campaigns → sends via Meta API)
 *
 * Environment variables (see .env):
 *   WHATSAPP_TOKEN   — Meta permanent or temp Bearer token
 *   PHONE_NUMBER_ID  — Meta WhatsApp phone number ID
 *   VERIFY_TOKEN     — arbitrary string configured in Meta webhook settings
 *   AI_SERVER_URL    — Python ai-server base URL  (default: http://localhost:5000)
 *   BACKEND_URL      — Dashboard backend base URL (default: http://localhost:8000)
 *   WA_DEV_MODE      — "true" = send plain text (no template needed, requires 24h window)
 *                      "false" = send approved template (required for cold outbound in production)
 *   WA_TEMPLATE_NAME — Meta-approved template name (only used when WA_DEV_MODE=false)
 *   PORT             — HTTP server port (default: 3000)
 */

require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const cron    = require('node-cron');

const app = express();
app.use(express.json());

const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  AI_SERVER_URL    = 'http://localhost:5000',
  BACKEND_URL      = 'http://localhost:8000',
  WA_DEV_MODE      = 'true',
  WA_TEMPLATE_NAME = 'numero_reactivation',
  PORT             = 3000,
} = process.env;

const META_API = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
const META_HEADERS = { Authorization: `Bearer ${WHATSAPP_TOKEN}` };

/* ──────────────────────── Helpers ──────────────────────── */

async function sendTextMessage(to, body) {
  const res = await axios.post(META_API, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body, preview_url: false },
  }, { headers: META_HEADERS });
  return res.data?.messages?.[0]?.id;   // returns wamid
}

async function sendTemplateMessage(to, userName, offerCode, offerDiscount) {
  const res = await axios.post(META_API, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: WA_TEMPLATE_NAME,
      language: { code: 'en_US' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: userName     || 'there' },
          { type: 'text', text: offerCode    || '' },
          { type: 'text', text: offerDiscount|| '' },
        ],
      }],
    },
  }, { headers: META_HEADERS });
  return res.data?.messages?.[0]?.id;
}

function buildCampaignMessage(userName, offer, productGroup) {
  const productLine = {
    'Calls':          'calling credits & recharge offers',
    'Data eSIM':      'eSIM data plans',
    'Virtual Number': 'virtual number plans',
  }[productGroup] || 'Numero products';

  return (
    `Hi ${userName || 'there'} 👋\n\n` +
    `We noticed it's been a while — we've missed you at Numero!\n\n` +
    `Here's an exclusive offer just for you:\n\n` +
    `🎁 *${offer.code}* — ${offer.discount}\n` +
    `${offer.description}\n\n` +
    `Apply at checkout on your next ${productLine} purchase.\n\n` +
    `⏰ Valid for *7 days only* — don't miss out!\n\n` +
    `👉 https://numero.app/\n\n` +
    `Reply to this message if you have any questions!\n\n` +
    `— The Numero Team`
  );
}

/* ──────────────────────── Webhook ──────────────────────── */

// Meta webhook verification
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[webhook] Verified by Meta');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] Verification failed');
  res.sendStatus(403);
});

// Meta webhook events (incoming messages + delivery status)
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // always ack immediately

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        const value = change.value || {};

        // ── Incoming messages → call ai-server
        for (const msg of (value.messages || [])) {
          if (msg.type !== 'text') continue;

          const from = msg.from;           // sender phone number
          const text = msg.text?.body || '';

          console.log(`[message] From ${from}: ${text.slice(0, 80)}`);

          try {
            const aiRes = await axios.post(`${AI_SERVER_URL}/chat`, {
              user_id: from,
              user_message: text,
            });
            const reply = aiRes.data?.reply;
            if (reply) await sendTextMessage(from, reply);
          } catch (err) {
            console.error('[ai-server] Error:', err.message);
            await sendTextMessage(from, "Sorry, I'm having trouble right now. Please try again in a moment!");
          }
        }

        // ── Delivery / read / failed status events → update campaign stats
        for (const statusEvt of (value.statuses || [])) {
          const wamid  = statusEvt.id;
          const status = statusEvt.status; // sent | delivered | read | failed

          console.log(`[status] ${wamid} → ${status}`);

          // Map Meta status to our event names
          const eventMap = { delivered: 'delivered', read: 'read', failed: 'failed' };
          const event = eventMap[status];
          if (!event) continue;

          try {
            await axios.patch(`${BACKEND_URL}/api/campaigns/recipients/event`, null, {
              params: { wa_message_id: wamid, event },
            });
          } catch (err) {
            console.error('[tracker] Failed to update event:', err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[webhook] Unhandled error:', err.message);
  }
});

/* ──────────────────────── Campaign Sender ──────────────────────── */

async function processQueuedCampaigns() {
  let campaigns;
  try {
    const res = await axios.get(`${BACKEND_URL}/api/campaigns/`, { params: { status: 'queued' } });
    campaigns = res.data || [];
  } catch (err) {
    console.error('[sender] Could not fetch queued campaigns:', err.message);
    return;
  }

  if (campaigns.length === 0) return;
  console.log(`[sender] Found ${campaigns.length} queued campaign(s)`);

  for (const campaign of campaigns) {
    await sendCampaign(campaign);
  }
}

async function sendCampaign(campaign) {
  const cid = campaign.id;
  console.log(`[sender] Starting campaign ${cid}: "${campaign.name}"`);

  // Mark as sending immediately to prevent double-pick-up
  try {
    await axios.put(`${BACKEND_URL}/api/campaigns/${cid}/status`, null, { params: { status: 'sending' } });
  } catch (err) {
    console.error(`[sender] Could not mark campaign ${cid} as sending:`, err.message);
    return;
  }

  // Build user query params from campaign filters
  const userParams = {};
  if (campaign.segment_filter)     userParams.segment       = campaign.segment_filter;
  if (campaign.product_filter)     userParams.product_group = campaign.product_filter;
  if (campaign.country_filter)     userParams.country       = campaign.country_filter;
  if (campaign.recency_min_filter) userParams.min_recency   = campaign.recency_min_filter;
  if (campaign.recency_max_filter) userParams.max_recency   = campaign.recency_max_filter;

  // Fetch target users (paginated — max 200 per page)
  let page = 1;
  let sentCount = 0;
  let skippedCount = 0;

  while (true) {
    let users;
    try {
      const res = await axios.get(`${BACKEND_URL}/api/users/`, {
        params: { ...userParams, page, page_size: 200, include_phone: true },
      });
      users = res.data?.users || [];
      const total = res.data?.total || 0;
      console.log(`[sender] Campaign ${cid} page ${page}: ${users.length} users (total ${total})`);
    } catch (err) {
      console.error(`[sender] Failed to fetch users page ${page}:`, err.message);
      break;
    }

    if (users.length === 0) break;

    for (const user of users) {
      const phone = user.phone_number;

      // Skip users without a phone number or who have opted out
      if (!phone) {
        skippedCount++;
        continue;
      }
      if (user.whatsapp_opted_in === false) {
        skippedCount++;
        continue;
      }

      // Get the offer details from the ai-server (or use campaign offer_code directly)
      let offerData = { code: campaign.offer_code, discount: '', description: '' };
      try {
        const offerRes = await axios.get(`${AI_SERVER_URL}/offer/${campaign.offer_code}`);
        if (offerRes.data) offerData = offerRes.data;
      } catch (_) { /* use fallback above */ }

      // Send the message
      let wamid = null;
      try {
        if (WA_DEV_MODE === 'true') {
          // Plain text — only works if user messaged within last 24h (dev/testing)
          const msgBody = buildCampaignMessage(null, offerData, campaign.product_filter);
          wamid = await sendTextMessage(phone, msgBody);
        } else {
          // Approved template — works for cold outbound (production)
          wamid = await sendTemplateMessage(phone, null, offerData.code, offerData.discount);
        }
        sentCount++;
        console.log(`[sender] Sent to ${phone} (user ${user.id_client}), wamid: ${wamid}`);
      } catch (err) {
        console.error(`[sender] Failed to send to ${phone}:`, err.message);
        skippedCount++;
        continue;
      }

      // Record recipient
      try {
        await axios.post(`${BACKEND_URL}/api/campaigns/${cid}/recipients`, null, {
          params: {
            user_id: user.id_client,
            phone_number: phone,
            wa_message_id: wamid,
            status: 'sent',
          },
        });
      } catch (err) {
        console.error(`[sender] Failed to record recipient ${user.id_client}:`, err.message);
      }

      // Small delay to avoid Meta rate limits (80 msg/s default)
      await new Promise(r => setTimeout(r, 15));
    }

    // If fewer than page_size returned, we're done
    if (users.length < 200) break;
    page++;
  }

  // Update campaign status to "sent" with final counts
  try {
    await axios.put(`${BACKEND_URL}/api/campaigns/${cid}/status`, null, { params: { status: 'sent' } });
    await axios.patch(`${BACKEND_URL}/api/campaigns/${cid}/stats`, null, {
      params: { sent: sentCount },
    });
    console.log(`[sender] Campaign ${cid} done. Sent: ${sentCount}, Skipped: ${skippedCount}`);
  } catch (err) {
    console.error(`[sender] Failed to finalize campaign ${cid}:`, err.message);
  }
}

/* ──────────────────────── Offer lookup endpoint ──────────────────────── */
// Called by the sender above to get offer details without reading the JSON directly
app.get('/offer/:code', async (req, res) => {
  try {
    const offerRes = await axios.get(`${AI_SERVER_URL}/offer/${req.params.code}`);
    res.json(offerRes.data);
  } catch (_) {
    res.status(404).json({ error: 'Offer not found' });
  }
});

/* ──────────────────────── Cron ──────────────────────── */

// Poll every 60 seconds for queued campaigns
cron.schedule('* * * * *', () => {
  processQueuedCampaigns().catch(err =>
    console.error('[cron] processQueuedCampaigns error:', err.message)
  );
});

/* ──────────────────────── Health ──────────────────────── */

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    dev_mode: WA_DEV_MODE === 'true',
    ai_server: AI_SERVER_URL,
    backend: BACKEND_URL,
    phone_number_id: PHONE_NUMBER_ID,
  });
});

/* ──────────────────────── Start ──────────────────────── */

app.listen(PORT, () => {
  console.log(`[boot] WhatsApp bot listening on port ${PORT}`);
  console.log(`[boot] WA_DEV_MODE=${WA_DEV_MODE} | AI=${AI_SERVER_URL} | Backend=${BACKEND_URL}`);
  console.log(`[boot] Campaign sender cron: every 60s`);
});
