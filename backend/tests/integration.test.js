import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import nodemailer from 'nodemailer';
import { app, pool, init } from '../src/server.js';
import { setDefaultTransporter, isValidEmail, renderNotificationEmail } from '../src/services/email.js';

let server;
let baseUrl;
let testProjectId;
let testApiKey;
let testUserCookie;

// Helper to make HTTP requests to the test server
async function apiRequest(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.cookie ? { Cookie: options.cookie } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const cookieHeader = res.headers.get('set-cookie');
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data, headers: res.headers, cookie: cookieHeader };
}

test.before(async () => {
  // Ensure DB schema and migrations are initialized
  await init();

  // Start server on dynamic port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Register initial test user
  const regRes = await apiRequest('/api/auth/register', {
    method: 'POST',
    body: {
      email: `initial_test_${Date.now()}@example.com`,
      password: 'StrongTestPassword123!',
      name: 'Initial Test Dev'
    }
  });
  assert.strictEqual(regRes.status, 201, 'Test user registration should return 201');
  testUserCookie = regRes.cookie;

  // Create test project & API key
  const { status, data } = await apiRequest('/api/projects', {
    method: 'POST',
    cookie: testUserCookie,
    body: { name: `Test Project ${Date.now()}` }
  });

  assert.strictEqual(status, 201, 'Test project creation should return 201');
  testProjectId = data.project.id;
  testApiKey = data.apiKey;
});

test.after(async () => {
  // Clean up test project
  if (testProjectId) {
    try {
      await apiRequest(`/api/projects/${testProjectId}`, {
        method: 'DELETE',
        cookie: testUserCookie,
        token: testApiKey
      });
    } catch { }
  }

  // Restore default transporter
  setDefaultTransporter(null);

  // Close server and DB pool
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

test.describe('1. Email Recipient Validation and Templates', () => {
  test('isValidEmail correctly identifies valid and invalid addresses', () => {
    assert.strictEqual(isValidEmail('user@example.com'), true);
    assert.strictEqual(isValidEmail('john.doe+test@gmail.com'), true);
    assert.strictEqual(isValidEmail('dev_user@sub.domain.co.uk'), true);

    assert.strictEqual(isValidEmail('user_123'), false);
    assert.strictEqual(isValidEmail('not-an-email'), false);
    assert.strictEqual(isValidEmail('@nodomain.com'), false);
    assert.strictEqual(isValidEmail('user@'), false);
    assert.strictEqual(isValidEmail(''), false);
    assert.strictEqual(isValidEmail(null), false);
    assert.strictEqual(isValidEmail(undefined), false);
  });

  test('renderNotificationEmail generates responsive HTML and plaintext', () => {
    const rendered = renderNotificationEmail({
      title: 'Order Confirmation',
      message: 'Your order #9921 has shipped successfully.',
      type: 'order',
      recipient: 'buyer@example.com',
      id: 'test-uuid-1234',
      createdAt: '2026-11-01T12:00:00Z'
    });

    assert.ok(rendered.html.includes('Order Confirmation'), 'HTML should contain title');
    assert.ok(rendered.html.includes('Your order #9921 has shipped successfully.'), 'HTML should contain message');
    assert.ok(rendered.html.includes('buyer@example.com'), 'HTML should contain recipient');
    assert.ok(rendered.html.includes('test-uuid-1234'), 'HTML should contain notification ID');
    assert.ok(rendered.html.includes('ORDER'), 'HTML should contain type badge');
    assert.ok(rendered.html.includes('OpenRelay'), 'HTML should contain OpenRelay brand');

    assert.ok(rendered.text.includes('Order Confirmation'), 'Plaintext should contain title');
    assert.ok(rendered.text.includes('buyer@example.com'), 'Plaintext should contain recipient');
  });

  test('POST /api/v1/notifications rejects invalid email address when channel is email', async () => {
    const { status, data } = await apiRequest('/api/v1/notifications', {
      method: 'POST',
      token: testApiKey,
      body: {
        recipient: 'invalid_username_not_email',
        channel: 'email',
        title: 'Test Email',
        message: 'This should fail validation'
      }
    });

    assert.strictEqual(status, 400, 'Should reject with 400 Bad Request');
    assert.strictEqual(data.error, 'Invalid recipient email address');
  });

  test('POST /api/v1/notifications rejects unsupported delivery channels', async () => {
    const { status, data } = await apiRequest('/api/v1/notifications', {
      method: 'POST',
      token: testApiKey,
      body: {
        recipient: 'user@example.com',
        channel: 'unsupported_channel',
        title: 'Test Title',
        message: 'Test Message'
      }
    });

    assert.strictEqual(status, 400, 'Should reject unsupported channel with 400');
    assert.ok(data.error.includes("Supported channels are 'sse' and 'email'"));
  });
});

test.describe('2. Email Notification Sending via SMTP', () => {
  test('Successful email delivery records status as "sent" (NOT "delivered"), sets sent_at, and creates attempt', async () => {
    const sentEmails = [];
    const mockTransporter = {
      sendMail: async (options) => {
        sentEmails.push(options);
        return {
          messageId: `<mock-${Date.now()}@openrelay.dev>`,
          response: '250 2.0.0 OK: message queued 12345',
          accepted: [options.to]
        };
      }
    };

    setDefaultTransporter(mockTransporter);

    const { status, data } = await apiRequest('/api/v1/notifications', {
      method: 'POST',
      token: testApiKey,
      body: {
        recipient: 'alice@example.com',
        channel: 'email',
        title: 'Invoice Ready',
        message: 'Your monthly invoice is attached.',
        type: 'order'
      }
    });

    assert.strictEqual(status, 200, 'Email dispatch should return 200 OK');
    assert.strictEqual(data.status, 'sent', 'Status must be "sent", NOT "delivered"');
    assert.strictEqual(data.channel, 'email');
    assert.ok(data.id, 'Notification ID should be returned');

    // Verify mock transporter was called with properly formatted mail
    assert.strictEqual(sentEmails.length, 1);
    assert.strictEqual(sentEmails[0].to, 'alice@example.com');
    assert.strictEqual(sentEmails[0].subject, 'Invoice Ready');
    assert.ok(sentEmails[0].html.includes('Your monthly invoice is attached.'));

    // Verify DB record in PostgreSQL
    const dbNotif = await pool.query('SELECT * FROM notifications WHERE id = $1', [data.id]);
    assert.strictEqual(dbNotif.rowCount, 1);
    const row = dbNotif.rows[0];
    assert.strictEqual(row.status, 'sent', 'DB status must be "sent"');
    assert.strictEqual(row.channel, 'email', 'DB channel must be "email"');
    assert.ok(row.sent_at, 'DB sent_at must be populated');
    assert.strictEqual(row.delivered_at, null, 'Delivered_at must remain NULL for SMTP acceptance');

    // Verify notification_attempts record
    const attempts = await pool.query('SELECT * FROM notification_attempts WHERE notification_id = $1', [data.id]);
    assert.strictEqual(attempts.rowCount, 1);
    assert.strictEqual(attempts.rows[0].status, 'sent');
    assert.strictEqual(attempts.rows[0].attempt_number, 1);

    // Verify that attempting to ACK an email notification is rejected
    const ackRes = await apiRequest(`/api/v1/notifications/${data.id}/ack`, {
      method: 'POST',
      token: testApiKey
    });
    assert.strictEqual(ackRes.status, 400, 'ACK on email notifications must be rejected with 400');
    assert.ok(ackRes.data.error.includes('Email notifications are delivered via SMTP and cannot be acknowledged'));

    // DB status must still be 'sent'
    const checkAfterAck = await pool.query('SELECT status FROM notifications WHERE id = $1', [data.id]);
    assert.strictEqual(checkAfterAck.rows[0].status, 'sent');
  });

  test('SMTP failure records status as "failed" and stores error_message in DB and attempts', async () => {
    const failingTransporter = {
      sendMail: async () => {
        throw new Error('Connection refused: smtp.gmail.com:465');
      }
    };

    setDefaultTransporter(failingTransporter);

    const { status, data } = await apiRequest('/api/v1/notifications', {
      method: 'POST',
      token: testApiKey,
      body: {
        recipient: 'bob@example.com',
        channel: 'email',
        title: 'Security Alert',
        message: 'New login detected.'
      }
    });

    assert.strictEqual(status, 502, 'SMTP failure should return 502 Bad Gateway');
    assert.strictEqual(data.status, 'failed');
    assert.strictEqual(data.channel, 'email');
    assert.ok(data.error.includes('Connection refused'));

    // Verify DB record in PostgreSQL
    const dbNotif = await pool.query('SELECT * FROM notifications WHERE id = $1', [data.id]);
    assert.strictEqual(dbNotif.rowCount, 1);
    const row = dbNotif.rows[0];
    assert.strictEqual(row.status, 'failed', 'DB status must be "failed"');
    assert.strictEqual(row.channel, 'email');
    assert.ok(row.error_message.includes('Connection refused'), 'Error message must be recorded');
    assert.strictEqual(row.sent_at, null);

    // Verify notification_attempts record
    const attempts = await pool.query('SELECT * FROM notification_attempts WHERE notification_id = $1', [data.id]);
    assert.strictEqual(attempts.rowCount, 1);
    assert.strictEqual(attempts.rows[0].status, 'failed');
    assert.ok(attempts.rows[0].error_message.includes('Connection refused'));

    // Verify ACK cannot mark a failed notification as delivered
    const ackRes = await apiRequest(`/api/v1/notifications/${data.id}/ack`, {
      method: 'POST',
      token: testApiKey
    });
    assert.strictEqual(ackRes.status, 400, 'Email notification cannot be acknowledged');
  });

  test('Missing SMTP credentials in environment causes failure recorded as "failed"', async () => {
    setDefaultTransporter(null); // Restore default transporter
    const origUser = process.env.SMTP_USER;
    const origPass = process.env.SMTP_PASS;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    try {
      const { status, data } = await apiRequest('/api/v1/notifications', {
        method: 'POST',
        token: testApiKey,
        body: {
          recipient: 'carol@example.com',
          channel: 'email',
          title: 'Unconfigured Test',
          message: 'Testing missing credentials.'
        }
      });

      assert.strictEqual(status, 502);
      assert.strictEqual(data.status, 'failed');
      assert.ok(data.error.includes('SMTP credentials are not configured'));

      const dbRow = await pool.query('SELECT status, error_message FROM notifications WHERE id = $1', [data.id]);
      assert.strictEqual(dbRow.rows[0].status, 'failed');
      assert.ok(dbRow.rows[0].error_message.includes('SMTP credentials are not configured'));
    } finally {
      if (origUser) process.env.SMTP_USER = origUser;
      if (origPass) process.env.SMTP_PASS = origPass;
    }
  });
});

test.describe('3. Existing SSE Delivery and Acknowledgement', () => {
  test('Default channel is "sse" and status is "queued"', async () => {
    const { status, data } = await apiRequest('/api/v1/notifications', {
      method: 'POST',
      token: testApiKey,
      body: {
        recipient: 'user_456',
        title: 'New Message',
        message: 'You have received a new direct message.'
      }
    });

    assert.strictEqual(status, 202, 'SSE notifications return 202 Accepted');
    assert.strictEqual(data.status, 'queued');
    assert.strictEqual(data.channel, 'sse');

    // Verify DB record
    const dbNotif = await pool.query('SELECT * FROM notifications WHERE id = $1', [data.id]);
    assert.strictEqual(dbNotif.rows[0].status, 'queued');
    assert.strictEqual(dbNotif.rows[0].channel, 'sse');
    assert.strictEqual(dbNotif.rows[0].delivered_at, null);

    // Verify ACK marks as delivered
    const ackRes = await apiRequest(`/api/v1/notifications/${data.id}/ack`, {
      method: 'POST',
      token: testApiKey
    });

    assert.strictEqual(ackRes.status, 200);
    assert.strictEqual(ackRes.data.status, 'delivered');

    const fresh = await pool.query('SELECT * FROM notifications WHERE id = $1', [data.id]);
    assert.strictEqual(fresh.rows[0].status, 'delivered');
    assert.ok(fresh.rows[0].delivered_at, 'delivered_at must be set');
  });
});

test.describe('4. Offline Replay Isolation and SSE Filtering', () => {
  test('Offline replay only replays queued SSE notifications and NEVER replays email notifications', async () => {
    const mockTransporter = {
      sendMail: async (options) => ({
        messageId: `<mock-replay-${Date.now()}@openrelay.dev>`,
        response: '250 OK',
        accepted: [options.to]
      })
    };
    setDefaultTransporter(mockTransporter);

    // 1. Send SSE notification 1 while receiver is offline
    const notif1 = await apiRequest('/api/v1/notifications', {
      method: 'POST',
      token: testApiKey,
      body: {
        recipient: 'user_offline_1',
        channel: 'sse',
        title: 'Offline SSE 1',
        message: 'Message 1'
      }
    });
    assert.strictEqual(notif1.data.status, 'queued');

    // 2. Send Email notification while receiver is offline
    const notifEmail = await apiRequest('/api/v1/notifications', {
      method: 'POST',
      token: testApiKey,
      body: {
        recipient: 'recipient_offline@example.com',
        channel: 'email',
        title: 'Offline Email',
        message: 'Email Message'
      }
    });
    assert.strictEqual(notifEmail.data.status, 'sent');

    // 3. Send SSE notification 2 while receiver is offline
    const notif2 = await apiRequest('/api/v1/notifications', {
      method: 'POST',
      token: testApiKey,
      body: {
        recipient: 'user_offline_2',
        channel: 'sse',
        title: 'Offline SSE 2',
        message: 'Message 2'
      }
    });
    assert.strictEqual(notif2.data.status, 'queued');

    // 4. Now connect SSE client to events endpoint
    const eventsUrl = `${baseUrl}/api/projects/${testProjectId}/events?token=${encodeURIComponent(testApiKey)}`;
    const receivedEvents = [];

    await new Promise((resolve, reject) => {
      const req = http.get(eventsUrl, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n\n');
          buffer = lines.pop(); // keep remainder

          for (const block of lines) {
            const dataLine = block.split('\n').find(l => l.startsWith('data: '));
            if (dataLine) {
              try {
                const parsed = JSON.parse(dataLine.slice(6));
                receivedEvents.push(parsed);

                // When we have received the 2 replayed SSE notifications (+ connected event)
                const notifEvents = receivedEvents.filter(e => e.event === 'notification.created');
                if (notifEvents.length >= 2) {
                  req.destroy();
                  resolve();
                }
              } catch { }
            }
          }
        });

        res.on('error', reject);
      });

      req.on('error', (err) => {
        // Destroyed is expected on resolve
        if (err.code !== 'ECONNRESET') reject(err);
      });

      // Timeout safety
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 3000);
    });

    // 5. Verify the received events
    const replayedCreated = receivedEvents.filter(e => e.event === 'notification.created');
    const replayedIds = replayedCreated.map(e => e.id);

    // Verify SSE notification 1 and 2 were replayed
    assert.ok(replayedIds.includes(notif1.data.id), 'Queued SSE notification 1 must be replayed');
    assert.ok(replayedIds.includes(notif2.data.id), 'Queued SSE notification 2 must be replayed');

    // CRITICAL (Requirement 6): Email notification MUST NOT be replayed to SSE receiver!
    assert.strictEqual(
      replayedIds.includes(notifEmail.data.id),
      false,
      'Email notifications must NEVER be replayed to the SSE receiver'
    );

    // All replayed notifications must have channel 'sse'
    for (const evt of replayedCreated) {
      assert.strictEqual(evt.channel, 'sse', 'Replayed events must be sse channel');
    }

    // Acknowledge replayed SSE notification 1
    const ack1 = await apiRequest(`/api/v1/notifications/${notif1.data.id}/ack`, {
      method: 'POST',
      token: testApiKey
    });
    assert.strictEqual(ack1.data.status, 'delivered');

    // Acknowledge replayed SSE notification 2
    const ack2 = await apiRequest(`/api/v1/notifications/${notif2.data.id}/ack`, {
      method: 'POST',
      token: testApiKey
    });
    assert.strictEqual(ack2.data.status, 'delivered');

    // Email notification must remain 'sent'
    const checkEmail = await pool.query('SELECT status, channel FROM notifications WHERE id = $1', [notifEmail.data.id]);
    assert.strictEqual(checkEmail.rows[0].status, 'sent');
    assert.strictEqual(checkEmail.rows[0].channel, 'email');
  });
});

test.describe('5. Database Idempotency and Integrity', () => {
  test('Running database migration multiple times is completely idempotent and preserves existing data', async () => {
    const countBefore = await pool.query('SELECT count(*) FROM notifications');

    // Execute idempotent migrations again
    await pool.query(`
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'sse';
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
    `);

    const countAfter = await pool.query('SELECT count(*) FROM notifications');
    assert.strictEqual(countBefore.rows[0].count, countAfter.rows[0].count, 'Row count must be identical');

    // Verify columns exist
    const colRes = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'notifications' AND column_name IN ('channel', 'sent_at')
    `);
    assert.strictEqual(colRes.rowCount, 2, 'Both channel and sent_at columns must exist');
  });
});

test.describe('6. User Registration, Passwords & Validation', () => {
  test('Registers new user with securely hashed password and validates input', async () => {
    const email = `dev_${Date.now()}@example.com`;
    const password = 'SuperSecurePassword123!';

    // Register user
    const res = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email, password, name: 'Alice Developer' }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.user.email, email);
    assert.strictEqual(res.data.user.name, 'Alice Developer');
    assert.ok(res.data.user.id);
    assert.ok(res.cookie, 'Must set session cookie on registration');
    assert.ok(res.cookie.includes('HttpOnly'), 'Cookie must be HttpOnly');
    assert.ok(res.cookie.includes('SameSite=Lax'), 'Cookie must specify SameSite=Lax');

    // Verify password is NOT stored in plaintext in the database
    const dbUser = await pool.query('SELECT password_hash FROM users WHERE id = $1', [res.data.user.id]);
    assert.ok(dbUser.rows[0].password_hash, 'Password hash must exist');
    assert.notStrictEqual(dbUser.rows[0].password_hash, password, 'Password must never be stored in plaintext');
    assert.ok(dbUser.rows[0].password_hash.includes(':'), 'Scrypt hash must follow salt:derivedKey format');
  });

  test('Rejects registration with invalid email format', async () => {
    const res = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email: 'not-an-email', password: 'ValidPassword123!' }
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.data.error.includes('email'));
  });

  test('Rejects registration with password shorter than 8 characters', async () => {
    const res = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email: `short_pw_${Date.now()}@example.com`, password: 'short' }
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.data.error.includes('8 characters'));
  });

  test('Rejects duplicate email registration with 409 Conflict', async () => {
    const email = `dup_${Date.now()}@example.com`;
    const reg1 = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email, password: 'Password12345!' }
    });
    assert.strictEqual(reg1.status, 201);

    const reg2 = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email: email.toUpperCase(), password: 'AnotherPassword123!' }
    });
    assert.strictEqual(reg2.status, 409);
    assert.ok(reg2.data.error.includes('already exists'));
  });
});

test.describe('7. Session Management, Cookies & Logout', () => {
  test('User login sets HttpOnly session cookie and returns user profile', async () => {
    const email = `login_test_${Date.now()}@example.com`;
    const password = 'CorrectPassword123!';

    // Register
    await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email, password, name: 'Login User' }
    });

    // Login
    const loginRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });

    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.user.email, email);
    assert.ok(loginRes.cookie, 'Login must set session cookie');
    assert.ok(loginRes.cookie.includes('HttpOnly'));
    assert.ok(loginRes.cookie.includes('SameSite=Lax'));

    // Check /api/auth/me using the session cookie
    const meRes = await apiRequest('/api/auth/me', {
      cookie: loginRes.cookie
    });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.user.email, email);

    // Logout terminates session and clears cookie
    const logoutRes = await apiRequest('/api/auth/logout', {
      method: 'POST',
      cookie: loginRes.cookie
    });
    assert.strictEqual(logoutRes.status, 200);
    assert.ok(logoutRes.cookie.includes('Max-Age=0') || logoutRes.cookie.includes('Expires=Thu, 01 Jan 1970'));

    // Subsequent /api/auth/me returns 401
    const meAfterLogout = await apiRequest('/api/auth/me', {
      cookie: loginRes.cookie
    });
    assert.strictEqual(meAfterLogout.status, 401);
  });
});

test.describe('8. Login Rate Limiting and Security', () => {
  test('Incorrect password returns 401 and tracks failed attempts', async () => {
    const email = `ratelimit_${Date.now()}@example.com`;
    const password = 'CorrectPassword999!';

    await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email, password }
    });

    const badLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email, password: 'WrongPassword!' }
    });
    assert.strictEqual(badLogin.status, 401);
    assert.strictEqual(badLogin.data.error, 'Invalid email or password');
  });

  test('Triggers 429 Too Many Requests after 5 consecutive failed login attempts', async () => {
    const email = `bruteforce_${Date.now()}@example.com`;
    const password = 'RealPassword123!';

    await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email, password }
    });

    // Perform 5 failed login attempts
    for (let i = 0; i < 5; i++) {
      const failRes = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email, password: `WrongAttempt_${i}` }
      });
      assert.strictEqual(failRes.status, 401);
    }

    // 6th attempt should be blocked by rate limiter
    const blockedRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email, password: 'RealPassword123!' }
    });
    assert.strictEqual(blockedRes.status, 429);
    assert.ok(blockedRes.data.error.includes('Too many failed login attempts'));
  });
});

test.describe('9. Dashboard API Protection and Project Ownership Isolation', () => {
  test('Unauthenticated requests to dashboard endpoints return 401', async () => {
    const getProjects = await apiRequest('/api/projects');
    assert.strictEqual(getProjects.status, 401, 'GET /api/projects must require session');

    const postProjects = await apiRequest('/api/projects', {
      method: 'POST',
      body: { name: 'Unauthorized Project' }
    });
    assert.strictEqual(postProjects.status, 401, 'POST /api/projects must require session');
  });

  test('Strict project ownership isolation between User A and User B', async () => {
    // 1. Register User A and create Project A
    const userARes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email: `user_a_${Date.now()}@example.com`, password: 'UserAPassword123!' }
    });
    const cookieA = userARes.cookie;

    const projARes = await apiRequest('/api/projects', {
      method: 'POST',
      cookie: cookieA,
      body: { name: 'Project Alpha' }
    });
    assert.strictEqual(projARes.status, 201);
    const projectAId = projARes.data.project.id;

    // 2. Register User B and create Project B
    const userBRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email: `user_b_${Date.now()}@example.com`, password: 'UserBPassword123!' }
    });
    const cookieB = userBRes.cookie;

    const projBRes = await apiRequest('/api/projects', {
      method: 'POST',
      cookie: cookieB,
      body: { name: 'Project Beta' }
    });
    assert.strictEqual(projBRes.status, 201);
    const projectBId = projBRes.data.project.id;

    // 3. User A lists projects: must only see Project A, NOT Project B
    const listA = await apiRequest('/api/projects', { cookie: cookieA });
    assert.strictEqual(listA.status, 200);
    const idsA = listA.data.map((p) => p.id);
    assert.ok(idsA.includes(projectAId), 'User A must see Project A');
    assert.ok(!idsA.includes(projectBId), 'User A must NOT see Project B');

    // 4. User B lists projects: must only see Project B, NOT Project A
    const listB = await apiRequest('/api/projects', { cookie: cookieB });
    assert.strictEqual(listB.status, 200);
    const idsB = listB.data.map((p) => p.id);
    assert.ok(idsB.includes(projectBId), 'User B must see Project B');
    assert.ok(!idsB.includes(projectAId), 'User B must NOT see Project A');

    // 5. User A tries to delete Project B -> Must be rejected (403)
    const deleteAttempt = await apiRequest(`/api/projects/${projectBId}`, {
      method: 'DELETE',
      cookie: cookieA
    });
    assert.strictEqual(deleteAttempt.status, 403, 'User A cannot delete Project B');

    // 6. User B deletes Project B using session without needing an API key
    const deleteSuccess = await apiRequest(`/api/projects/${projectBId}`, {
      method: 'DELETE',
      cookie: cookieB
    });
    assert.strictEqual(deleteSuccess.status, 200, 'User B can delete their own project');
    assert.strictEqual(deleteSuccess.data.ok, true);

    // Clean up Project A
    await apiRequest(`/api/projects/${projectAId}`, {
      method: 'DELETE',
      cookie: cookieA
    });
  });

  test('API keys cannot authorize project-management endpoints (must reject with 401)', async () => {
    // Attempt to access project-management endpoints using ONLY an API key (no user session cookie)
    const listKeys = await apiRequest(`/api/projects/${testProjectId}/keys`, {
      token: testApiKey
    });
    assert.strictEqual(listKeys.status, 401, 'API key must not authorize listing project keys');

    const createKey = await apiRequest(`/api/projects/${testProjectId}/keys`, {
      method: 'POST',
      token: testApiKey,
      body: { name: 'Unauthorized Key' }
    });
    assert.strictEqual(createKey.status, 401, 'API key must not authorize creating project keys');

    const deleteProject = await apiRequest(`/api/projects/${testProjectId}`, {
      method: 'DELETE',
      token: testApiKey
    });
    assert.strictEqual(deleteProject.status, 401, 'API key must not authorize deleting projects');
  });
});

