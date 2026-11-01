import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import pg from 'pg';
import { isValidEmail, sendNotificationEmail, sendPasswordResetEmail } from './services/email.js';
import {
  isValidEmail as isValidUserEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  checkLoginRateLimit,
  recordLoginAttempt,
  generateResetToken,
  hashResetToken
} from './services/auth.js';
import { getUnownedProjects, assignUnownedProjects } from './services/projectMigration.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 4000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const clients = new Map();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4000', 'http://127.0.0.1:4000'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*') || !process.env.CORS_ORIGIN) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true
  })
);
app.use(express.json({ limit: '64kb' }));

const schema = `
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  channel TEXT NOT NULL DEFAULT 'sse',
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error_message TEXT
);
CREATE TABLE IF NOT EXISTS notification_attempts (
  id UUID PRIMARY KEY,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'sse';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- User Authentication & PostgreSQL Session Tables
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY,
  ip_address TEXT NOT NULL,
  email TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, attempted_at);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);
`;

const makeId = () => crypto.randomUUID();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const newApiKey = () => `${process.env.API_KEY_PREFIX || 'or_live_'}${crypto.randomBytes(24).toString('hex')}`;

async function init() {
  for (let i = 0; i < 30; i++) {
    try { await pool.query(schema); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
  }
  throw new Error('Database unavailable');
}

// Resolves session from HttpOnly cookie
async function resolveSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies['openrelay_session'];
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email, u.name, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > NOW()`,
    [tokenHash]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  pool.query('UPDATE sessions SET last_active_at = NOW() WHERE id = $1', [row.session_id]).catch(() => {});

  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    sessionId: row.session_id
  };
}

// Middleware requiring a valid user session for dashboard APIs
async function requireUser(req, res, next) {
  try {
    const user = await resolveSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

// Middleware ensuring only authenticated project owners (via session) can manage projects and API keys
async function requireProjectOwner(req, res, next) {
  try {
    const projectId = req.params.projectId;
    if (!projectId) return res.status(400).json({ error: 'Missing projectId' });

    // Only authenticated project owner via session is permitted
    const user = await resolveSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { rows } = await pool.query('SELECT id, user_id FROM projects WHERE id = $1', [projectId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (!rows[0].user_id || rows[0].user_id !== user.id) {
      return res.status(403).json({ error: 'Access denied: You do not own this project' });
    }

    req.user = user;
    req.projectId = projectId;
    next();
  } catch (error) {
    next(error);
  }
}

function getPublicOrigin() {
  const origin = (process.env.PUBLIC_ORIGIN || process.env.DOMAIN || process.env.APP_URL || process.env.FRONTEND_URL || '').trim();
  if (origin) {
    const cleaned = origin.replace(/\/+$/, '');
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      return cleaned;
    }
    return cleaned.startsWith('localhost') || cleaned.startsWith('127.0.0.1')
      ? `http://${cleaned}`
      : `https://${cleaned}`;
  }
  return 'http://localhost:5173';
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Middleware requiring trusted operator authorization for administrative/migration endpoints
async function requireOperator(req, res, next) {
  try {
    const operatorKey = process.env.OPERATOR_KEY || process.env.OPERATOR_TOKEN || process.env.MIGRATION_SECRET;
    const operatorEmails = (process.env.OPERATOR_EMAILS || process.env.OPERATOR_EMAIL || process.env.ADMIN_EMAIL || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    // 1. Check header for operator key/token
    const headerKey = req.get('x-operator-key') || req.get('x-operator-token');
    const authHeader = req.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const providedToken = headerKey || bearer;

    if (operatorKey && providedToken && safeCompare(providedToken, operatorKey)) {
      req.isOperator = true;
      req.user = (await resolveSessionUser(req)) || { id: null, email: 'operator@system' };
      return next();
    }

    // 2. Check if caller has an active user session whose email is in OPERATOR_EMAILS
    const user = await resolveSessionUser(req);
    if (user && operatorEmails.length > 0 && operatorEmails.includes(user.email.toLowerCase())) {
      req.user = user;
      req.isOperator = true;
      return next();
    }

    // If neither matches, strictly reject ordinary registered users
    return res.status(403).json({ error: 'Access denied: Operator privileges required' });
  } catch (error) {
    next(error);
  }
}

async function authenticate(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Missing API key' });

    const result = await pool.query(
      'SELECT project_id, id FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL',
      [hash(token)]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'Invalid or revoked API key' });

    req.projectId = result.rows[0].project_id;
    req.apiKeyId = result.rows[0].id;
    await pool.query('UPDATE api_keys SET last_used_at=NOW() WHERE id=$1', [req.apiKeyId]);
    next();
  } catch (error) {
    next(error);
  }
}

function requireProject(req, res, next) {
  if (req.projectId !== req.params.projectId) return res.status(403).json({ error: 'API key does not belong to this project' });
  next();
}

function publish(projectId, payload) {
  const set = clients.get(projectId);
  if (!set || set.size === 0) return;
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const response of set) {
    try {
      response.write(message);
    } catch {
      // client connection issue
    }
  }
}

app.get('/', (_, res) => res.json({ name: 'OpenRelay', version: '0.1.0', status: 'running', docs: '/health' }));
app.get('/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'openrelay', database: 'connected' });
  } catch {
    res.status(503).json({ ok: false, service: 'openrelay', database: 'unavailable' });
  }
});

// --- User Authentication & Session Endpoints ---

// 1. User Registration
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim().slice(0, 80) || email.split('@')[0];

    if (!isValidUserEmail(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const userId = makeId();
    const passwordHash = await hashPassword(password);

    await pool.query('BEGIN');
    try {
      await pool.query(
        'INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)',
        [userId, email, passwordHash, name]
      );

      // Legacy unowned projects are NOT automatically claimed (controlled migration only)

      // Create initial session
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
      const userAgent = String(req.get('user-agent') || '').slice(0, 500);

      await pool.query(
        'INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)',
        [tokenHash, userId, expiresAt, ip, userAgent]
      );

      await pool.query('COMMIT');

      setSessionCookie(res, token);
      res.status(201).json({
        user: {
          id: userId,
          email,
          name
        }
      });
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

// 2. User Login (Protected with Rate Limiting)
app.post('/api/auth/login', async (req, res, next) => {
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  try {
    // Rate limit check: max 5 failed attempts in 15 minutes
    const rateCheck = await checkLoginRateLimit(pool, ip, email);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'Too many failed login attempts. Please wait 15 minutes before trying again.'
      });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, password_hash, name FROM users WHERE LOWER(email) = $1',
      [email]
    );

    if (rows.length === 0) {
      await recordLoginAttempt(pool, ip, email, false);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await recordLoginAttempt(pool, ip, email, false);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Successful login - record attempt and create session
    await recordLoginAttempt(pool, ip, email, true);

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const userAgent = String(req.get('user-agent') || '').slice(0, 500);

    await pool.query(
      'INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)',
      [tokenHash, user.id, expiresAt, ip, userAgent]
    );

    setSessionCookie(res, token);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    next(error);
  }
});

// 3. User Logout
app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies['openrelay_session'];
    if (token) {
      const tokenHash = hashSessionToken(token);
      await pool.query('DELETE FROM sessions WHERE id = $1', [tokenHash]);
    }
    clearSessionCookie(res);
    res.json({ ok: true, message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

// 4. Current User Session Check
app.get('/api/auth/me', async (req, res, next) => {
  try {
    const user = await resolveSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
});

// 5. Forgot Password: Generate secure time-limited reset token & send email
app.post('/api/auth/forgot-password', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !isValidUserEmail(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    // Uniform response to prevent email address enumeration
    const uniformResponse = {
      ok: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    };

    const { rows } = await pool.query('SELECT id, email, name FROM users WHERE LOWER(email) = $1', [email]);
    if (rows.length === 0) {
      return res.json(uniformResponse);
    }

    const user = rows[0];
    const rawToken = generateResetToken();
    const tokenHash = hashResetToken(rawToken);
    const tokenId = makeId();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiration

    await pool.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenId, user.id, tokenHash, expiresAt]
    );

    const baseUrl = getPublicOrigin();
    const resetUrl = `${baseUrl}/?token=${rawToken}`;

    try {
      await sendPasswordResetEmail({
        recipient: user.email,
        resetUrl,
        name: user.name || user.email.split('@')[0]
      });
    } catch (emailErr) {
      console.error('Failed to send password reset email via SMTP:', emailErr.message);
    }

    res.json(uniformResponse);
  } catch (error) {
    next(error);
  }
});

// 6. Verify Password Reset Token
app.post('/api/auth/verify-reset-token', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ valid: false, error: 'Reset token is required' });
    }

    const tokenHash = hashResetToken(token);
    const { rows } = await pool.query(
      'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1',
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired password reset link' });
    }

    const record = rows[0];
    if (record.used_at) {
      return res.status(400).json({ valid: false, error: 'This password reset link has already been used' });
    }

    if (new Date(record.expires_at) <= new Date()) {
      return res.status(400).json({ valid: false, error: 'This password reset link has expired' });
    }

    res.json({ valid: true });
  } catch (error) {
    next(error);
  }
});

// 7. Reset Password with Token
app.post('/api/auth/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');

    if (!token) {
      return res.status(400).json({ error: 'Reset token is required' });
    }

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

    const tokenHash = hashResetToken(token);

    await pool.query('BEGIN');
    try {
      const { rows } = await pool.query(
        'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE',
        [tokenHash]
      );

      if (rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid or expired password reset link' });
      }

      const record = rows[0];
      if (record.used_at) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: 'This password reset link has already been used' });
      }

      if (new Date(record.expires_at) <= new Date()) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: 'This password reset link has expired' });
      }

      // Mark token used
      await pool.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
        [record.id]
      );

      // Hash new password and update user
      const newHash = await hashPassword(password);
      await pool.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [newHash, record.user_id]
      );

      // Invalidate existing sessions for this user
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [record.user_id]);

      await pool.query('COMMIT');

      res.json({ ok: true, message: 'Password has been successfully updated' });
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

// --- Project Management Endpoints (Protected by User Session & Ownership) ---

// Project bootstrap: creates a project belonging to the authenticated user.
app.post('/api/projects', requireUser, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 80) return res.status(400).json({ error: 'Project name is required and must be under 80 characters' });

    const projectId = makeId();
    const keyId = makeId();
    const raw = newApiKey();
    await pool.query('BEGIN');
    try {
      await pool.query('INSERT INTO projects(id, name, user_id) VALUES($1, $2, $3)', [projectId, name, req.user.id]);
      await pool.query(
        'INSERT INTO api_keys(id,project_id,name,key_hash,key_prefix) VALUES($1,$2,$3,$4,$5)',
        [keyId, projectId, 'Default key', hash(raw), raw.slice(0, 16)]
      );
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    res.status(201).json({ project: { id: projectId, name, user_id: req.user.id }, apiKey: raw });
  } catch (error) { next(error); }
});

// List only projects belonging to the authenticated user
app.get('/api/projects', requireUser, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.created_at,
             COUNT(n.id)::int AS notification_count
      FROM projects p LEFT JOIN notifications n ON n.project_id=p.id
      WHERE p.user_id = $1
      GROUP BY p.id ORDER BY p.created_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (error) { next(error); }
});

// Delete project: enforces ownership by the session user or valid project API key
app.delete('/api/projects/:projectId', requireProjectOwner, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING id,name', [req.params.projectId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Project not found' });
    res.json({ ok: true, project: result.rows[0] });
  } catch (error) { next(error); }
});

// List legacy unowned projects (trusted operator only)
app.get('/api/projects/unowned', requireOperator, async (req, res, next) => {
  try {
    const unowned = await getUnownedProjects(pool);
    res.json(unowned);
  } catch (error) { next(error); }
});

// Controlled legacy project ownership migration (trusted operator only)
app.post('/api/projects/migrate-legacy', requireOperator, async (req, res, next) => {
  try {
    const targetUserId = req.body?.targetUserId;
    const targetEmail = req.body?.targetEmail;
    const projectId = req.body?.projectId;

    if (!targetUserId && !targetEmail) {
      return res.status(400).json({
        error: 'An explicit target account (targetEmail or targetUserId) must be specified for migration.'
      });
    }

    const result = await assignUnownedProjects(pool, {
      targetUserId,
      targetEmail,
      projectId
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    const msg = error.message || 'Migration failed';
    if (msg.includes('already has an assigned owner')) {
      return res.status(409).json({ error: msg });
    }
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    res.status(400).json({ error: msg });
  }
});

app.get('/api/projects/:projectId/keys', requireProjectOwner, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,key_prefix,created_at,last_used_at,revoked_at FROM api_keys WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

app.post('/api/projects/:projectId/keys', requireProjectOwner, async (req, res, next) => {
  try {
    const name = String(req.body?.name || 'API key').trim().slice(0, 80) || 'API key';
    const keyId = makeId();
    const raw = newApiKey();
    await pool.query(
      'INSERT INTO api_keys(id,project_id,name,key_hash,key_prefix) VALUES($1,$2,$3,$4,$5)',
      [keyId, req.params.projectId, name, hash(raw), raw.slice(0, 16)]
    );
    res.status(201).json({ id: keyId, name, apiKey: raw });
  } catch (error) { next(error); }
});

app.post('/api/projects/:projectId/keys/:keyId/revoke', requireProjectOwner, async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE api_keys SET revoked_at=NOW() WHERE id=$1 AND project_id=$2 AND revoked_at IS NULL',
      [req.params.keyId, req.params.projectId]
    );
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/v1/notifications', authenticate, async (req, res, next) => {
  try {
    const recipient = String(req.body?.recipient || '').trim();
    const title = String(req.body?.title || '').trim();
    const message = String(req.body?.message || '').trim();
    const type = String(req.body?.type || 'general').trim().slice(0, 40);
    const rawChannel = req.body?.channel;
    const channel = rawChannel ? String(rawChannel).toLowerCase().trim() : 'sse';

    if (!recipient || !title || !message) return res.status(400).json({ error: 'recipient, title and message are required' });
    if (recipient.length > 200 || title.length > 160 || message.length > 4000) {
      return res.status(400).json({ error: 'recipient, title or message is too long' });
    }

    if (channel !== 'sse' && channel !== 'email') {
      return res.status(400).json({ error: "Invalid delivery channel. Supported channels are 'sse' and 'email'" });
    }

    if (channel === 'email') {
      if (!isValidEmail(recipient)) {
        return res.status(400).json({ error: 'Invalid recipient email address' });
      }

      const notificationId = makeId();
      // 1. Save notification in PostgreSQL before sending
      const { rows } = await pool.query(
        `INSERT INTO notifications(id, project_id, recipient, title, message, type, channel, status)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, recipient, title, message, type, channel, status, created_at`,
        [notificationId, req.projectId, recipient, title, message, type || 'general', 'email', 'queued']
      );
      const notification = rows[0];

      // 2. Send the email using SMTP
      try {
        await sendNotificationEmail({
          id: notification.id,
          recipient: notification.recipient,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          createdAt: notification.created_at,
        });

        // 3. Record successful SMTP submission as 'sent' (DO NOT mark as 'delivered')
        const updated = await pool.query(
          `UPDATE notifications
           SET status = 'sent', sent_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND project_id = $2
           RETURNING id, recipient, title, message, type, channel, status, created_at, sent_at, updated_at`,
          [notification.id, req.projectId]
        );

        await pool.query(
          `INSERT INTO notification_attempts(id, notification_id, attempt_number, status, attempted_at)
           VALUES($1, $2, (SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM notification_attempts WHERE notification_id = $2), $3, NOW())`,
          [makeId(), notification.id, 'sent']
        );

        const sentNotif = updated.rows[0];

        publish(req.projectId, {
          event: 'notification.created',
          id: sentNotif.id,
          recipient: sentNotif.recipient,
          title: sentNotif.title,
          message: sentNotif.message,
          type: sentNotif.type,
          channel: 'email',
          status: 'sent',
          created_at: sentNotif.created_at,
          sent_at: sentNotif.sent_at,
          data: sentNotif
        });

        return res.status(200).json({ id: notificationId, status: 'sent', channel: 'email' });
      } catch (smtpErr) {
        // 4. Record failure as 'failed'
        const errorMessage = smtpErr.message || 'SMTP delivery failed';
        await pool.query(
          `UPDATE notifications
           SET status = 'failed', error_message = $1, updated_at = NOW()
           WHERE id = $2 AND project_id = $3`,
          [errorMessage, notification.id, req.projectId]
        );

        await pool.query(
          `INSERT INTO notification_attempts(id, notification_id, attempt_number, status, error_message, attempted_at)
           VALUES($1, $2, (SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM notification_attempts WHERE notification_id = $2), $3, $4, NOW())`,
          [makeId(), notification.id, 'failed', errorMessage]
        );

        publish(req.projectId, {
          event: 'notification.created',
          id: notification.id,
          recipient: notification.recipient,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          channel: 'email',
          status: 'failed',
          error_message: errorMessage,
          created_at: notification.created_at,
          data: {
            ...notification,
            status: 'failed',
            error_message: errorMessage
          }
        });

        return res.status(502).json({
          error: `Email delivery failed: ${errorMessage}`,
          id: notificationId,
          status: 'failed',
          channel: 'email'
        });
      }
    }

    // Default SSE delivery channel (preserve existing behaviour)
    const notificationId = makeId();
    const { rows } = await pool.query(
      `INSERT INTO notifications(id, project_id, recipient, title, message, type, channel, status)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, recipient, title, message, type, channel, status, created_at`,
      [notificationId, req.projectId, recipient, title, message, type || 'general', 'sse', 'queued']
    );
    const notification = rows[0];

    publish(req.projectId, {
      event: 'notification.created',
      id: notification.id,
      recipient: notification.recipient,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      channel: notification.channel,
      status: notification.status,
      created_at: notification.created_at,
      data: {
        id: notification.id,
        recipient: notification.recipient,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        channel: notification.channel,
        status: notification.status,
        created_at: notification.created_at
      }
    });

    res.status(202).json({ id: notificationId, status: 'queued', channel: 'sse' });
  } catch (error) { next(error); }
});

app.get('/api/v1/notifications/:notificationId', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE id=$1 AND project_id=$2',
      [req.params.notificationId, req.projectId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Notification not found' });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

app.post('/api/v1/notifications/:notificationId/ack', authenticate, async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const { rows } = await pool.query(
      'SELECT id, project_id, status, channel, delivered_at FROM notifications WHERE id=$1 AND project_id=$2',
      [notificationId, req.projectId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notif = rows[0];

    // Email notifications cannot be acknowledged by SSE receiver
    if (notif.channel === 'email') {
      return res.status(400).json({
        error: 'Email notifications are delivered via SMTP and cannot be acknowledged via SSE receiver',
        status: notif.status,
        channel: 'email'
      });
    }

    if (notif.status === 'failed') {
      return res.status(409).json({ error: 'Notification has failed and cannot be marked delivered', status: 'failed' });
    }

    if (notif.status === 'delivered') {
      return res.json({ ok: true, id: notif.id, status: 'delivered', delivered_at: notif.delivered_at, duplicate: true });
    }

    const updateResult = await pool.query(
      'UPDATE notifications SET status=$1, updated_at=NOW(), delivered_at=NOW() WHERE id=$2 AND project_id=$3 AND status=$4 RETURNING id, status, channel, delivered_at, updated_at',
      ['delivered', notificationId, req.projectId, 'queued']
    );

    if (updateResult.rowCount === 0) {
      const fresh = await pool.query('SELECT id, status, channel, delivered_at FROM notifications WHERE id=$1 AND project_id=$2', [notificationId, req.projectId]);
      return res.json({ ok: true, id: notificationId, status: fresh.rows[0]?.status || notif.status, delivered_at: fresh.rows[0]?.delivered_at });
    }

    const updated = updateResult.rows[0];

    await pool.query(
      `INSERT INTO notification_attempts(id, notification_id, attempt_number, status, attempted_at)
       VALUES($1, $2, (SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM notification_attempts WHERE notification_id=$2), $3, NOW())`,
      [makeId(), notificationId, 'delivered']
    );

    publish(req.projectId, {
      event: 'notification.updated',
      id: updated.id,
      status: 'delivered',
      channel: updated.channel,
      delivered_at: updated.delivered_at,
      updated_at: updated.updated_at
    });

    res.json({ ok: true, id: updated.id, status: 'delivered', delivered_at: updated.delivered_at });
  } catch (error) { next(error); }
});

app.get('/api/projects/:projectId/notifications', requireProjectOwner, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const { rows } = await pool.query(
      'SELECT id,recipient,title,message,type,channel,status,created_at,updated_at,delivered_at,sent_at,error_message FROM notifications WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2',
      [req.params.projectId, limit]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/projects/:projectId/events', async (req, res, next) => {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.query.token || '').trim();
    if (!token) return res.status(401).json({ error: 'Missing API key' });
    const result = await pool.query('SELECT project_id, id FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL', [hash(token)]);
    if (!result.rowCount) return res.status(401).json({ error: 'Invalid or revoked API key' });
    req.projectId = result.rows[0].project_id;
    req.apiKeyId = result.rows[0].id;
    if (req.projectId !== req.params.projectId) return res.status(403).json({ error: 'API key does not belong to this project' });
    await pool.query('UPDATE api_keys SET last_used_at=NOW() WHERE id=$1', [req.apiKeyId]);
  } catch (error) { return next(error); }
  const projectId = req.params.projectId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  if (!clients.has(projectId)) clients.set(projectId, new Set());
  clients.get(projectId).add(res);
  res.write(`data: ${JSON.stringify({ event: 'connected' })}\n\n`);

  // Replay pending queued SSE notifications to this newly connected client only
  // Note: Email notifications are not queued for SSE receiver clients
  try {
    const { rows: pending } = await pool.query(
      `SELECT id, recipient, title, message, type, channel, status, created_at
       FROM notifications
       WHERE project_id = $1 AND status = 'queued' AND channel = 'sse'
       ORDER BY created_at ASC`,
      [projectId]
    );

    for (const notification of pending) {
      if (res.writableEnded) break;
      const payload = {
        event: 'notification.created',
        id: notification.id,
        recipient: notification.recipient,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        channel: notification.channel || 'sse',
        status: notification.status,
        created_at: notification.created_at,
        data: {
          id: notification.id,
          recipient: notification.recipient,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          channel: notification.channel || 'sse',
          status: notification.status,
          created_at: notification.created_at
        }
      };
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        break;
      }
    }
  } catch (err) {
    console.error('Error replaying pending notifications:', err);
  }

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.get(projectId)?.delete(res);
    if (clients.get(projectId)?.size === 0) clients.delete(projectId);
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

export { app, pool, clients, init, getPublicOrigin, requireOperator };

if (process.env.NODE_ENV !== 'test') {
  init()
    .then(() => app.listen(port, () => console.log(`OpenRelay API listening on :${port}`)))
    .catch((error) => { console.error(error); process.exit(1); });
}
