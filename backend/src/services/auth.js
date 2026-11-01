import crypto from 'node:crypto';

/**
 * OpenRelay Dashboard Authentication & Session Service
 */

/**
 * Validates an email address format.
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 255 || trimmed.length < 3) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Validates password complexity.
 * Minimum 8 characters, maximum 128 characters.
 */
export function validatePassword(password) {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must be under 128 characters' };
  }
  return { valid: true };
}

/**
 * Hashes a plaintext password using crypto.scrypt with a random 16-byte salt.
 * Returns salt:derivedKeyHex string.
 */
export async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verifies a plaintext password against a stored hash string using timingSafeEqual.
 */
export async function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
      return resolve(false);
    }
    const [salt, key] = storedHash.split(':');
    const keyBuffer = Buffer.from(key, 'hex');
    crypto.scrypt(password, salt, keyBuffer.length, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) return reject(err);
      if (keyBuffer.length !== derivedKey.length) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

/**
 * Generates a cryptographically secure random session token.
 */
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hashes a session token for secure database storage.
 */
export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Parses cookies from req.headers.cookie.
 */
export function parseCookies(req) {
  const list = {};
  const rc = req.headers?.cookie;
  if (!rc) return list;
  for (const cookie of rc.split(';')) {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    if (key) {
      list[key] = decodeURIComponent(parts.join('='));
    }
  }
  return list;
}

/**
 * Sets an HttpOnly, SameSite session cookie on the response.
 */
export function setSessionCookie(res, token, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const isProd = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const expires = new Date(Date.now() + maxAgeMs).toUTCString();
  const secureFlag = isProd ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `openrelay_session=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; Expires=${expires}; HttpOnly; SameSite=Lax${secureFlag}`
  );
}

/**
 * Clears the session cookie.
 */
export function clearSessionCookie(res) {
  const isProd = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const secureFlag = isProd ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `openrelay_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureFlag}`
  );
}

/**
 * Checks login rate limiting for an IP and email.
 * Allows at most 5 failed attempts in 15 minutes.
 */
export async function checkLoginRateLimit(pool, ip, email) {
  const maxEmailAttempts = 5;
  const maxIpAttempts = 30;
  const windowMinutes = 15;

  const { rows } = await pool.query(
    `SELECT 
       COUNT(*) FILTER (WHERE email IS NOT NULL AND LOWER(email) = LOWER($2))::int AS email_failed,
       COUNT(*) FILTER (WHERE ip_address = $1)::int AS ip_failed
     FROM login_attempts
     WHERE success = false
       AND attempted_at > NOW() - ($3 || ' minutes')::INTERVAL`,
    [ip, email || '', windowMinutes]
  );

  const emailCount = rows[0]?.email_failed || 0;
  const ipCount = rows[0]?.ip_failed || 0;
  const allowed = emailCount < maxEmailAttempts && ipCount < maxIpAttempts;

  return {
    allowed,
    emailCount,
    ipCount,
    count: Math.max(emailCount, ipCount)
  };
}

/**
 * Records a login attempt (successful or failed).
 */
export async function recordLoginAttempt(pool, ip, email, success) {
  try {
    await pool.query(
      `INSERT INTO login_attempts (id, ip_address, email, success, attempted_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [crypto.randomUUID(), ip, email ? email.trim().toLowerCase() : null, Boolean(success)]
    );
  } catch (err) {
    console.error('Failed to record login attempt:', err);
  }
}

/**
 * Generates a cryptographically secure random password reset token (32 bytes hex).
 */
export function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hashes a password reset token with SHA-256 for secure storage.
 */
export function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}
