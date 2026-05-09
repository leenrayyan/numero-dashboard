// Manual test for the webhook signature verification middleware.
//
// Builds a valid HMAC-SHA256 signature using WHATSAPP_APP_SECRET from .env,
// posts a synthetic delivery-event payload to the local /webhook endpoint,
// and prints the response. This is the positive-case counterpart to the
// curl tests in the README — proves that real Meta webhooks pass through.
//
// Prereq:
//   - server running:   node server.js
//   - .env has WHATSAPP_APP_SECRET set
//
// Run:
//   node test-webhook-signature.js

require('dotenv').config();
const crypto = require('crypto');
const http = require('http');

const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const PORT = process.env.PORT || 3000;

if (!APP_SECRET) {
  console.error('❌ WHATSAPP_APP_SECRET missing from .env — cannot compute signature.');
  process.exit(1);
}

// A minimal but valid-looking WhatsApp delivery webhook payload.
// (No real messages array → handler will return early without calling AI server.)
const payload = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'test-entry',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '00000000000', phone_number_id: 'test' },
        statuses: [{
          id: 'wamid.test',
          status: 'delivered',
          timestamp: String(Math.floor(Date.now() / 1000)),
          recipient_id: '00000000000'
        }]
      }
    }]
  }]
});

// Compute the same HMAC the real Meta service would.
const signature = 'sha256=' + crypto
  .createHmac('sha256', APP_SECRET)
  .update(payload)
  .digest('hex');

console.log('→ POST /webhook with valid signature');
console.log('  signature:', signature.slice(0, 20) + '...(truncated)');

const req = http.request({
  host: 'localhost',
  port: PORT,
  path: '/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'x-hub-signature-256': signature
  }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log(`← ${res.statusCode} ${res.statusMessage}`);
    if (body) console.log(`  body: ${body}`);
    if (res.statusCode === 200) {
      console.log('\n✅ Signature verification PASSED — middleware accepted the valid request.');
    } else {
      console.log('\n❌ Signature verification FAILED — expected 200, got ' + res.statusCode);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    console.error('❌ Could not connect to localhost:' + PORT);
    console.error('   Start the gateway first:  node server.js');
  } else {
    console.error('❌ Request failed:', err.message);
  }
  process.exit(1);
});

req.write(payload);
req.end();
