// Two ways in:
//  - People sign in to the web app with Telegram (Login Widget). The signed
//    payload is checked against the bot token, the account must be on the
//    allowed list, and a signed session cookie is issued.
//  - Scripts and Claude send an API key: `Authorization: Bearer <key>` or
//    `X-API-Key`. Keys never open a browser session while Telegram is set up.
// With neither configured, auth is off, which is only allowed on loopback.

import crypto from 'node:crypto';

const COOKIE = 'slipbox_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 20;
const WINDOW_MS = 15 * 60 * 1000;
const TELEGRAM_MAX_AGE_S = 24 * 60 * 60;
const TELEGRAM_FIELDS = new Set(['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {}
    }
  }
  return out;
}

/**
 * @param {{ keys: string[], telegram?: { botToken: string, botUsername?: string, allowed: string[] } }} opts
 */
export function createAuth({ keys, telegram }) {
  const keyHashes = keys.map(sha256);
  const tg = telegram?.botToken ? telegram : null;
  const enabled = keyHashes.length > 0 || !!tg;
  // Browser sessions come from Telegram when it's set up, so only the bot token
  // signs them; adding or revoking API keys then leaves people signed in.
  const secret = sha256(`slipbox-session\0${tg ? `telegram\0${tg.botToken}` : `keys\0${keys.join('\0')}`}`);
  const tgSecret = tg ? sha256(tg.botToken) : null;
  const allowedIds = new Set((tg?.allowed ?? []).filter((a) => /^\d+$/.test(a)));
  const allowedNames = new Set(
    (tg?.allowed ?? []).filter((a) => !/^\d+$/.test(a)).map((a) => a.replace(/^@/, '').toLowerCase()),
  );
  const failures = new Map(); // ip -> { count, until }

  // ---------- API keys ----------

  const isValidKey = (candidate) => {
    if (typeof candidate !== 'string' || !candidate) return false;
    const h = sha256(candidate);
    let ok = false;
    for (const k of keyHashes) ok = crypto.timingSafeEqual(k, h) || ok;
    return ok;
  };
  const presentedKey = (req) => {
    const h = req.headers.authorization;
    if (typeof h === 'string' && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();
    return req.headers['x-api-key'];
  };

  // ---------- Telegram ----------

  const isAllowedAccount = (id, username) =>
    allowedIds.has(String(id)) || (!!username && allowedNames.has(String(username).toLowerCase()));

  /** Checks the Login Widget payload per https://core.telegram.org/widgets/login#checking-authorization */
  const verifyTelegram = (payload) => {
    if (!tg || !payload || typeof payload !== 'object' || typeof payload.hash !== 'string') return null;
    if (Object.keys(payload).some((k) => !TELEGRAM_FIELDS.has(k))) return null;
    const dataCheck = Object.keys(payload)
      .filter((k) => k !== 'hash')
      .sort()
      .map((k) => `${k}=${payload[k]}`)
      .join('\n');
    const expected = crypto.createHmac('sha256', tgSecret).update(dataCheck).digest('hex');
    if (!safeEqual(expected, payload.hash)) return null;
    const age = Date.now() / 1000 - Number(payload.auth_date);
    if (!Number.isFinite(age) || age > TELEGRAM_MAX_AGE_S || age < -300) return null;
    return {
      id: String(payload.id),
      username: payload.username ? String(payload.username) : undefined,
      name: [payload.first_name, payload.last_name].filter(Boolean).join(' ') || payload.username || String(payload.id),
    };
  };

  // ---------- sessions ----------

  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

  const issueSession = (req, res, subject) => {
    const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
    const data = Buffer.from(JSON.stringify({ ...subject, exp })).toString('base64url');
    const secure = req.secure ? '; Secure' : '';
    res.set('Set-Cookie', `${COOKIE}=${data}.${sign(data)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  };

  /** The signed-in person, or null. Re-checks the allowed list on every request. */
  const readSession = (req) => {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    if (!raw) return null;
    const dot = raw.lastIndexOf('.');
    if (dot < 1 || !safeEqual(sign(raw.slice(0, dot)), raw.slice(dot + 1))) return null;
    let s;
    try {
      s = JSON.parse(Buffer.from(raw.slice(0, dot), 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!s || typeof s.exp !== 'number' || s.exp * 1000 < Date.now()) return null;
    if (s.via === 'telegram') return tg && isAllowedAccount(s.id, s.username) ? s : null;
    if (s.via === 'key') return tg ? null : s;
    return null;
  };

  // ---------- rate limiting ----------

  const isBlocked = (ip) => {
    const f = failures.get(ip);
    if (!f) return false;
    if (Date.now() > f.until) {
      failures.delete(ip);
      return false;
    }
    return f.count >= MAX_FAILURES;
  };
  const recordFailure = (ip) => {
    const f = failures.get(ip);
    if (!f || Date.now() > f.until) failures.set(ip, { count: 1, until: Date.now() + WINDOW_MS });
    else f.count++;
  };
  const tooMany = (res) =>
    res.status(429).set('Retry-After', String(WINDOW_MS / 1000)).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });

  return {
    enabled,

    isAuthenticated: (req) => !enabled || !!readSession(req) || isValidKey(presentedKey(req)),

    /** Express middleware: a browser session or an API key. */
    require(req, res, next) {
      if (!enabled || readSession(req)) return next();
      const key = presentedKey(req);
      if (isBlocked(req.ip)) return tooMany(res);
      if (isValidKey(key)) return next();
      if (key) recordFailure(req.ip);
      res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: key ? 'That API key is not valid.' : 'Sign in, or send an API key.' });
    },

    /** For URLs that carry the key in the path (Claude connectors can't send headers). */
    checkPathKey(req, res, next) {
      if (!enabled) return next();
      if (isBlocked(req.ip)) return tooMany(res);
      if (isValidKey(req.params.key)) return next();
      recordFailure(req.ip);
      res.status(401).json({ error: 'That API key is not valid.' });
    },

    /** GET /api/session: how to sign in, and who is signed in. */
    describe(req, res) {
      const s = readSession(req);
      res.json({
        required: enabled,
        authenticated: !enabled || !!s || isValidKey(presentedKey(req)),
        method: tg ? 'telegram' : 'key',
        telegramBot: tg?.botUsername ?? null,
        user: s?.via === 'telegram' ? { id: s.id, username: s.username, name: s.name } : null,
      });
    },

    /** POST /api/session/telegram with the Login Widget's user object. */
    loginWithTelegram(req, res) {
      if (!tg) return res.status(404).json({ error: 'Telegram sign-in is not set up on this server.' });
      if (isBlocked(req.ip)) return tooMany(res);
      const user = verifyTelegram(req.body);
      if (!user) {
        recordFailure(req.ip);
        return res.status(401).json({ error: "Telegram's sign-in data couldn't be verified. Try again." });
      }
      if (!isAllowedAccount(user.id, user.username)) {
        recordFailure(req.ip);
        console.warn(`Refused Telegram sign-in: ${user.name} (@${user.username ?? '-'}, id ${user.id})`);
        return res.status(403).json({
          error: `${user.username ? `@${user.username}` : user.name} (Telegram id ${user.id}) isn't on this Slipbox's allowed list.`,
        });
      }
      console.log(`Signed in with Telegram: ${user.name} (@${user.username ?? '-'}, id ${user.id})`);
      issueSession(req, res, { via: 'telegram', ...user });
      res.json({ ok: true, user });
    },

    /** POST /api/session { key }: browser sign-in with a key, only when Telegram isn't set up. */
    loginWithKey(req, res) {
      if (!enabled) return res.json({ ok: true });
      if (tg) return res.status(403).json({ error: 'Sign in with Telegram.' });
      if (isBlocked(req.ip)) return tooMany(res);
      if (!isValidKey(req.body?.key)) {
        recordFailure(req.ip);
        return res.status(401).json({ error: "That key didn't work." });
      }
      issueSession(req, res, { via: 'key' });
      res.json({ ok: true });
    },

    logout(req, res) {
      res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${req.secure ? '; Secure' : ''}`);
      res.json({ ok: true });
    },
  };
}
