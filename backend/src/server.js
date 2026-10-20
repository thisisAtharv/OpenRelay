import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 4000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const clients = new Map();

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true }));
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
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
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

// Project bootstrap: creates the first API key. The key is returned only once.
app.post('/api/projects', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 80) return res.status(400).json({ error: 'Project name is required and must be under 80 characters' });

    const projectId = makeId();
    const keyId = makeId();
    const raw = newApiKey();
    await pool.query('BEGIN');
    try {
      await pool.query('INSERT INTO projects(id,name) VALUES($1,$2)', [projectId, name]);
      await pool.query(
        'INSERT INTO api_keys(id,project_id,name,key_hash,key_prefix) VALUES($1,$2,$3,$4,$5)',
        [keyId, projectId, 'Default key', hash(raw), raw.slice(0, 16)]
      );
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    res.status(201).json({ project: { id: projectId, name }, apiKey: raw });
  } catch (error) { next(error); }
});

app.get('/api/projects', async (_, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.created_at,
             COUNT(n.id)::int AS notification_count
      FROM projects p LEFT JOIN notifications n ON n.project_id=p.id
      GROUP BY p.id ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (error) { next(error); }
});

app.delete('/api/projects/:projectId', authenticate, requireProject, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING id,name', [req.params.projectId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Project not found' });
    res.json({ ok: true, project: result.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/projects/:projectId/keys', authenticate, requireProject, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,key_prefix,created_at,last_used_at,revoked_at FROM api_keys WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

app.post('/api/projects/:projectId/keys', authenticate, requireProject, async (req, res, next) => {
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

app.post('/api/projects/:projectId/keys/:keyId/revoke', authenticate, requireProject, async (req, res, next) => {
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

    if (!recipient || !title || !message) return res.status(400).json({ error: 'recipient, title and message are required' });
    if (recipient.length > 200 || title.length > 160 || message.length > 4000) {
      return res.status(400).json({ error: 'recipient, title or message is too long' });
    }

    const notificationId = makeId();
    const { rows } = await pool.query(
      `INSERT INTO notifications(id,project_id,recipient,title,message,type,status)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, recipient, title, message, type, status, created_at`,
      [notificationId, req.projectId, recipient, title, message, type || 'general', 'queued']
    );
    const notification = rows[0];

    publish(req.projectId, {
      event: 'notification.created',
      id: notification.id,
      recipient: notification.recipient,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      status: notification.status,
      created_at: notification.created_at,
      data: {
        id: notification.id,
        recipient: notification.recipient,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        status: notification.status,
        created_at: notification.created_at
      }
    });

    res.status(202).json({ id: notificationId, status: 'queued' });
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
      'SELECT id, project_id, status, delivered_at FROM notifications WHERE id=$1 AND project_id=$2',
      [notificationId, req.projectId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notif = rows[0];

    if (notif.status === 'failed') {
      return res.status(409).json({ error: 'Notification has failed and cannot be marked delivered', status: 'failed' });
    }

    if (notif.status === 'delivered') {
      return res.json({ ok: true, id: notif.id, status: 'delivered', delivered_at: notif.delivered_at, duplicate: true });
    }

    const updateResult = await pool.query(
      'UPDATE notifications SET status=$1, updated_at=NOW(), delivered_at=NOW() WHERE id=$2 AND project_id=$3 AND status=$4 RETURNING id, status, delivered_at, updated_at',
      ['delivered', notificationId, req.projectId, 'queued']
    );

    if (updateResult.rowCount === 0) {
      const fresh = await pool.query('SELECT id, status, delivered_at FROM notifications WHERE id=$1 AND project_id=$2', [notificationId, req.projectId]);
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
      delivered_at: updated.delivered_at,
      updated_at: updated.updated_at
    });

    res.json({ ok: true, id: updated.id, status: 'delivered', delivered_at: updated.delivered_at });
  } catch (error) { next(error); }
});

app.get('/api/projects/:projectId/notifications', authenticate, requireProject, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const { rows } = await pool.query(
      'SELECT id,recipient,title,message,type,status,created_at,updated_at,delivered_at,error_message FROM notifications WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2',
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

  // Replay pending queued notifications to this newly connected client only
  try {
    const { rows: pending } = await pool.query(
      `SELECT id, recipient, title, message, type, status, created_at
       FROM notifications
       WHERE project_id = $1 AND status = 'queued'
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
        status: notification.status,
        created_at: notification.created_at,
        data: {
          id: notification.id,
          recipient: notification.recipient,
          title: notification.title,
          message: notification.message,
          type: notification.type,
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

init()
  .then(() => app.listen(port, () => console.log(`OpenRelay API listening on :${port}`)))
  .catch((error) => { console.error(error); process.exit(1); });
