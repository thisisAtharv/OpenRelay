#!/usr/bin/env node

/**
 * OpenRelay Demo Client - Standalone Email Dispatcher
 *
 * Standalone script using native Node.js and fetch (zero external dependencies).
 * Sends an email notification through OpenRelay's authenticated REST API.
 */

// Native .env file loader for Node.js 20.6+
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch (err) {
    // Ignore ENOENT if .env does not exist; environment variables may be passed directly
    if (err.code !== 'ENOENT') {
      console.warn(`[Warning] Could not load .env file: ${err.message}`);
    }
  }
}

// 1. Read configuration from environment variables
const OPENRELAY_URL = (process.env.OPENRELAY_URL || 'http://localhost:4000').replace(/\/+$/, '');
const OPENRELAY_API_KEY = (process.env.OPENRELAY_API_KEY || '').trim();

// CLI arguments can optionally override recipient, title, and message:
// Usage: node send-email.mjs [recipient] [title] [message]
const cliArgs = process.argv.slice(2);
const recipientArg = cliArgs[0] && !cliArgs[0].startsWith('-') ? cliArgs[0] : null;
const titleArg = cliArgs[1] || null;
const messageArg = cliArgs[2] || null;

const RECIPIENT_EMAIL = (recipientArg || process.env.RECIPIENT_EMAIL || '').trim();
const title = titleArg || process.env.EMAIL_TITLE || 'Hello from OpenRelay External Client';
const message = messageArg || process.env.EMAIL_MESSAGE || 'This is an email notification dispatched via the standalone external client.';
const type = process.env.EMAIL_TYPE || 'general';

// 2. Validate required configuration
const missing = [];
if (!OPENRELAY_API_KEY) missing.push('OPENRELAY_API_KEY');
if (!RECIPIENT_EMAIL) missing.push('RECIPIENT_EMAIL');

if (missing.length > 0) {
  console.error('\n❌ Missing required configuration:');
  for (const key of missing) {
    console.error(`   - ${key}`);
  }
  console.error('\nProvide them in a .env file or set environment variables:');
  console.error('   OPENRELAY_URL=http://localhost:4000');
  console.error('   OPENRELAY_API_KEY=or_live_your_actual_key_here');
  console.error('   RECIPIENT_EMAIL=recipient@example.com\n');
  console.error('Or pass recipient on the command line:');
  console.error('   node send-email.mjs recipient@example.com "Custom Title" "Custom Message"\n');
  process.exit(1);
}

// Validate email format
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(RECIPIENT_EMAIL)) {
  console.error(`\n❌ Invalid RECIPIENT_EMAIL format: "${RECIPIENT_EMAIL}". Must be a valid email address.\n`);
  process.exit(1);
}

const payload = {
  channel: 'email',
  recipient: RECIPIENT_EMAIL,
  title,
  message,
  type
};

async function main() {
  const endpoint = `${OPENRELAY_URL}/api/v1/notifications`;

  console.log('----------------------------------------------------');
  console.log(' OpenRelay External Client - Send Email');
  console.log('----------------------------------------------------');
  console.log(` Endpoint:   ${endpoint}`);
  console.log(` Recipient:  ${RECIPIENT_EMAIL}`);
  console.log(` Title:      ${title}`);
  console.log(` Channel:    ${payload.channel}`);
  console.log(` Type:       ${payload.type}`);
  console.log('----------------------------------------------------\n');

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENRELAY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      console.error(`❌ HTTP Error ${res.status}:`);
      if (data && data.error) {
        console.error(`   Message: ${data.error}`);
        if (data.id) console.error(`   Notification ID: ${data.id}`);
        if (data.status) console.error(`   Status: ${data.status}`);
      } else {
        console.error(`   ${res.statusText || 'Request failed'}`);
      }
      process.exit(1);
    }

    console.log('✅ Notification successfully processed:');
    console.log(`   Notification ID: ${data.id}`);
    console.log(`   Status:          ${data.status}`);
    console.log(`   Channel:         ${data.channel || 'email'}`);
    console.log('\nDispatch completed successfully.');
  } catch (err) {
    console.error(`\n❌ Connection failed when requesting "${endpoint}":`);
    console.error(`   ${err.message}`);
    process.exit(1);
  }
}

main();
