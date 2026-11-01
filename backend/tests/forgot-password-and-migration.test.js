import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { app, pool, init, getPublicOrigin } from '../src/server.js';
import { setDefaultTransporter } from '../src/services/email.js';
import { assignUnownedProjects, getUnownedProjects } from '../src/services/projectMigration.js';
import { hashPassword, hashResetToken } from '../src/services/auth.js';

let server;
let baseUrl;
const sentEmails = [];
const TEST_OPERATOR_KEY = 'test_operator_secret_998877';

async function apiRequest(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.cookie ? { Cookie: options.cookie } : {}),
    ...(options.operatorKey ? { 'x-operator-key': options.operatorKey } : {}),
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
  process.env.OPERATOR_KEY = TEST_OPERATOR_KEY;
  await init();

  // Start test server on random port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Mock transporter to capture outgoing emails
  const mockTransporter = {
    sendMail: async (options) => {
      sentEmails.push(options);
      return {
        messageId: `<mock-reset-${Date.now()}@openrelay.dev>`,
        response: '250 2.0.0 OK: reset email accepted',
        accepted: [options.to]
      };
    }
  };
  setDefaultTransporter(mockTransporter);
});

test.after(async () => {
  setDefaultTransporter(null);
  delete process.env.OPERATOR_KEY;
  delete process.env.PUBLIC_ORIGIN;
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

test.describe('Task 1: Legacy Project Ownership & Operator Authorization', () => {
  const testRunId = Date.now();
  let unownedProjectId;
  let unownedApiKeyId;
  let ordinaryUserCookie;
  let ordinaryUserId;
  const ordinaryUserEmail = `ordinary_user_${testRunId}@example.com`;

  test('Setup: Create an unowned legacy project directly in DB with an API key and notification', async () => {
    unownedProjectId = crypto.randomUUID();
    unownedApiKeyId = crypto.randomUUID();
    const notificationId = crypto.randomUUID();
    const rawApiKey = `or_live_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

    // Insert unowned project (user_id IS NULL)
    await pool.query(
      'INSERT INTO projects (id, name, user_id, created_at) VALUES ($1, $2, NULL, NOW())',
      [unownedProjectId, `Legacy Unowned Project ${testRunId}`]
    );

    // Insert associated API key
    await pool.query(
      'INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5)',
      [unownedApiKeyId, unownedProjectId, 'Legacy Key', keyHash, rawApiKey.slice(0, 16)]
    );

    // Insert associated notification to verify data preservation
    await pool.query(
      'INSERT INTO notifications (id, project_id, recipient, title, message, status) VALUES ($1, $2, $3, $4, $5, $6)',
      [notificationId, unownedProjectId, 'legacy_recipient', 'Legacy Title', 'Legacy Content', 'sent']
    );

    const check = await pool.query('SELECT id, user_id FROM projects WHERE id = $1', [unownedProjectId]);
    assert.strictEqual(check.rows[0].user_id, null, 'Project should initially have no owner (NULL user_id)');
  });

  test('Registration does NOT automatically claim unowned projects', async () => {
    // Register an ordinary user
    const res = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        email: ordinaryUserEmail,
        password: 'SecurePassword123!',
        name: 'Ordinary Developer'
      }
    });

    assert.strictEqual(res.status, 201, 'User registration should succeed with 201');
    ordinaryUserCookie = res.cookie;
    ordinaryUserId = res.data.user.id;

    // Verify unowned project was NOT automatically claimed
    const projectCheck = await pool.query('SELECT user_id FROM projects WHERE id = $1', [unownedProjectId]);
    assert.strictEqual(
      projectCheck.rows[0].user_id,
      null,
      'Legacy project must NOT be automatically assigned upon user registration'
    );

    // Verify project list for this user does not contain the unowned project
    const listRes = await apiRequest('/api/projects', { cookie: ordinaryUserCookie });
    assert.strictEqual(listRes.status, 200);
    const userProjects = listRes.data;
    assert.strictEqual(
      userProjects.some((p) => p.id === unownedProjectId),
      false,
      'Unowned project should not be listed under ordinary user'
    );
  });

  test('SECURITY: Ordinary registered users CANNOT list unowned projects via GET /api/projects/unowned', async () => {
    const res = await apiRequest('/api/projects/unowned', {
      cookie: ordinaryUserCookie
    });

    assert.strictEqual(res.status, 403, 'Ordinary users must be denied with 403 Forbidden');
    assert.match(res.data.error, /Operator privileges required/i);
  });

  test('SECURITY: Ordinary registered users CANNOT claim unowned projects via POST /api/projects/migrate-legacy', async () => {
    const res = await apiRequest('/api/projects/migrate-legacy', {
      method: 'POST',
      cookie: ordinaryUserCookie,
      body: {
        projectId: unownedProjectId,
        targetEmail: ordinaryUserEmail
      }
    });

    assert.strictEqual(res.status, 403, 'Ordinary users must be denied with 403 Forbidden');
    assert.match(res.data.error, /Operator privileges required/i);

    // Verify project remains unowned in database
    const check = await pool.query('SELECT user_id FROM projects WHERE id = $1', [unownedProjectId]);
    assert.strictEqual(check.rows[0].user_id, null, 'Project must remain unowned');
  });

  test('SECURITY: Calls with invalid or missing operator key are denied', async () => {
    const res1 = await apiRequest('/api/projects/unowned', {
      operatorKey: 'wrong_key_12345'
    });
    assert.strictEqual(res1.status, 403);

    const res2 = await apiRequest('/api/projects/migrate-legacy', {
      method: 'POST',
      operatorKey: 'wrong_key_12345',
      body: { projectId: unownedProjectId, targetEmail: ordinaryUserEmail }
    });
    assert.strictEqual(res2.status, 403);
  });

  test('Trusted operator with valid operator key CAN list unowned projects', async () => {
    const res = await apiRequest('/api/projects/unowned', {
      operatorKey: TEST_OPERATOR_KEY
    });

    assert.strictEqual(res.status, 200, 'Trusted operator should be authorized with 200');
    assert.ok(Array.isArray(res.data), 'Expected array of unowned projects');
    const found = res.data.find((p) => p.id === unownedProjectId);
    assert.ok(found, 'Unowned project should be listed for operator');
    assert.strictEqual(found.api_key_count, 1, 'Should reflect associated API keys');
    assert.strictEqual(found.notification_count, 1, 'Should reflect associated notifications');
  });

  test('Trusted operator CAN migrate unowned project to explicitly specified account', async () => {
    const migrateRes = await apiRequest('/api/projects/migrate-legacy', {
      method: 'POST',
      operatorKey: TEST_OPERATOR_KEY,
      body: {
        projectId: unownedProjectId,
        targetEmail: ordinaryUserEmail
      }
    });

    assert.strictEqual(migrateRes.status, 200, 'Controlled migration endpoint should succeed for operator');
    assert.strictEqual(migrateRes.data.assignedCount, 1, 'Should report 1 assigned project');
    assert.strictEqual(migrateRes.data.targetUser.email, ordinaryUserEmail.toLowerCase());

    // Verify in database that ownership was explicitly set
    const dbCheck = await pool.query('SELECT user_id FROM projects WHERE id = $1', [unownedProjectId]);
    assert.strictEqual(dbCheck.rows[0].user_id, ordinaryUserId, 'Project user_id should now equal target user ID');

    // Verify all existing project data and API keys are preserved intact
    const keyCheck = await pool.query('SELECT id, name FROM api_keys WHERE project_id = $1', [unownedProjectId]);
    assert.strictEqual(keyCheck.rowCount, 1, 'API keys must be preserved');
    assert.strictEqual(keyCheck.rows[0].name, 'Legacy Key');

    const notifCheck = await pool.query('SELECT id, title FROM notifications WHERE project_id = $1', [unownedProjectId]);
    assert.strictEqual(notifCheck.rowCount, 1, 'Notifications must be preserved');
    assert.strictEqual(notifCheck.rows[0].title, 'Legacy Title');
  });

  test('Never silently transfer ownership: Attempting to migrate an already-owned project is strictly rejected', async () => {
    const otherUserEmail = `second_user_${testRunId}@example.com`;
    const regRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        email: otherUserEmail,
        password: 'Password999!',
        name: 'Second Dev'
      }
    });
    assert.strictEqual(regRes.status, 201);

    // Operator attempts to re-assign an already-owned project
    const reMigrateRes = await apiRequest('/api/projects/migrate-legacy', {
      method: 'POST',
      operatorKey: TEST_OPERATOR_KEY,
      body: {
        projectId: unownedProjectId,
        targetEmail: otherUserEmail
      }
    });

    assert.strictEqual(reMigrateRes.status, 409, 'Re-assigning owned project must return 409 Conflict');
    assert.match(reMigrateRes.data.error, /already has an assigned owner.*Silent or forced ownership transfers are strictly prohibited/i);

    // Verify ownership was not changed
    const finalCheck = await pool.query('SELECT user_id FROM projects WHERE id = $1', [unownedProjectId]);
    assert.strictEqual(finalCheck.rows[0].user_id, ordinaryUserId, 'Owner must remain the original assigned user');
  });
});

test.describe('Task 2: Forgot Password Flow & PUBLIC_ORIGIN Security', () => {
  const testRunId = Date.now();
  const validEmail = `forgot_test_${testRunId}@example.com`;
  const initialPassword = 'InitialSecretPass123!';
  const newPassword = 'BrandNewSecretPass456!';
  let generatedToken;

  test('Setup: Register test account for forgot password flow', async () => {
    const res = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        email: validEmail,
        password: initialPassword,
        name: 'Forgot Tester'
      }
    });
    assert.strictEqual(res.status, 201);
  });

  test('Non-existent email returns uniform 200 response (never reveals account absence)', async () => {
    const unknownEmail = `nonexistent_${testRunId}@example.com`;
    const emailCountBefore = sentEmails.length;

    const res = await apiRequest('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: unknownEmail }
    });

    assert.strictEqual(res.status, 200, 'Should return 200 even if email does not exist');
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(
      res.data.message,
      'If an account exists with this email, a password reset link has been sent.',
      'Must return identical uniform confirmation message'
    );

    // No email should have been sent
    assert.strictEqual(sentEmails.length, emailCountBefore, 'No email should be dispatched for unknown accounts');
  });

  test('SECURITY: Password reset email generates links using configured HTTPS PUBLIC_ORIGIN, not localhost', async () => {
    // Configure HTTPS PUBLIC_ORIGIN as required in production
    const expectedPublicOrigin = 'https://notify.openrelay.dev';
    process.env.PUBLIC_ORIGIN = expectedPublicOrigin;

    // Verify getPublicOrigin helper directly
    assert.strictEqual(getPublicOrigin(), expectedPublicOrigin);

    const emailCountBefore = sentEmails.length;
    const res = await apiRequest('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: validEmail }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);

    // Email was dispatched via Nodemailer
    assert.strictEqual(sentEmails.length, emailCountBefore + 1, 'Reset email must be dispatched');
    const sent = sentEmails[sentEmails.length - 1];
    assert.strictEqual(sent.to, validEmail);

    // Verify link starts with configured HTTPS PUBLIC_ORIGIN, NOT localhost
    assert.ok(
      sent.text.includes(`${expectedPublicOrigin}/?token=`),
      `Plaintext email must use configured HTTPS PUBLIC_ORIGIN (${expectedPublicOrigin}), got:\n${sent.text}`
    );
    assert.ok(
      sent.html.includes(`${expectedPublicOrigin}/?token=`),
      `HTML email must use configured HTTPS PUBLIC_ORIGIN (${expectedPublicOrigin})`
    );
    assert.strictEqual(
      sent.text.includes('localhost'),
      false,
      'Reset link must NOT contain localhost when PUBLIC_ORIGIN is configured'
    );
    assert.strictEqual(
      sent.html.includes('localhost'),
      false,
      'Reset link HTML must NOT contain localhost when PUBLIC_ORIGIN is configured'
    );

    // Extract token
    const tokenMatch = sent.text.match(/\?token=([a-f0-9]{64})/i);
    assert.ok(tokenMatch, 'Email must contain a 64-character hex reset token');
    generatedToken = tokenMatch[1];

    // Verify token storage in PostgreSQL: ONLY hashed token stored, never plaintext!
    const expectedHash = hashResetToken(generatedToken);
    const { rows } = await pool.query(
      'SELECT id, user_id, token_hash, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1',
      [expectedHash]
    );

    assert.strictEqual(rows.length, 1, 'Hashed token must exist in password_reset_tokens table');
    assert.strictEqual(rows[0].token_hash, expectedHash);
    assert.strictEqual(rows[0].used_at, null, 'used_at should be NULL initially');

    // Clean up env
    delete process.env.PUBLIC_ORIGIN;
  });

  test('POST /api/auth/verify-reset-token validates fresh token and rejects invalid/expired tokens', async () => {
    // Valid token
    const validCheck = await apiRequest('/api/auth/verify-reset-token', {
      method: 'POST',
      body: { token: generatedToken }
    });
    assert.strictEqual(validCheck.status, 200);
    assert.strictEqual(validCheck.data.valid, true);

    // Invalid token
    const invalidCheck = await apiRequest('/api/auth/verify-reset-token', {
      method: 'POST',
      body: { token: 'invalid_fake_token_1234567890' }
    });
    assert.strictEqual(invalidCheck.status, 400);
    assert.strictEqual(invalidCheck.data.valid, false);

    // Expired token in DB
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const expiredHash = hashResetToken(expiredRawToken);
    const userRes = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [validEmail]);
    await pool.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() - INTERVAL '10 minutes')`,
      [crypto.randomUUID(), userRes.rows[0].id, expiredHash]
    );

    const expiredCheck = await apiRequest('/api/auth/verify-reset-token', {
      method: 'POST',
      body: { token: expiredRawToken }
    });
    assert.strictEqual(expiredCheck.status, 400);
    assert.strictEqual(expiredCheck.data.valid, false);
    assert.match(expiredCheck.data.error, /expired/i);
  });

  test('POST /api/auth/reset-password rejects passwords under 8 characters', async () => {
    const res = await apiRequest('/api/auth/reset-password', {
      method: 'POST',
      body: {
        token: generatedToken,
        password: 'short'
      }
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.data.error, /at least 8 characters/i);
  });

  test('POST /api/auth/reset-password successfully updates password and marks token used', async () => {
    // Reset password
    const res = await apiRequest('/api/auth/reset-password', {
      method: 'POST',
      body: {
        token: generatedToken,
        password: newPassword
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.match(res.data.message, /successfully updated/i);

    // Verify token is now marked used in database
    const tokenHash = hashResetToken(generatedToken);
    const tokenDb = await pool.query('SELECT used_at FROM password_reset_tokens WHERE token_hash = $1', [tokenHash]);
    assert.ok(tokenDb.rows[0].used_at !== null, 'Token used_at timestamp must be set');

    // Verify old password no longer works
    const oldLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: validEmail, password: initialPassword }
    });
    assert.strictEqual(oldLogin.status, 401, 'Old password must be rejected');

    // Verify new password works
    const newLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: validEmail, password: newPassword }
    });
    assert.strictEqual(newLogin.status, 200, 'New password must be accepted');
    assert.strictEqual(newLogin.data.user.email, validEmail.toLowerCase());
  });

  test('Token is strictly single-use: Reusing the same reset token fails', async () => {
    const reuseRes = await apiRequest('/api/auth/reset-password', {
      method: 'POST',
      body: {
        token: generatedToken,
        password: 'AnotherPassword789!'
      }
    });

    assert.strictEqual(reuseRes.status, 400);
    assert.match(reuseRes.data.error, /already been used/i);
  });
});
