require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const db = require('./db');
const app = express();
class SQLiteSessionStore extends session.Store {
  get(sid, cb) { try { const row = db.prepare('SELECT sess,expire FROM sessions WHERE sid=?').get(sid); if (!row || row.expire <= now()) { if (row) db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); return cb(null, null); } cb(null, JSON.parse(row.sess)); } catch (e) { cb(e); } }
  set(sid, sess, cb = () => {}) { try { const expire = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : now() + 7 * 86400000; db.prepare('INSERT INTO sessions(sid,sess,expire) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expire=excluded.expire').run(sid, JSON.stringify(sess), expire); cb(null); } catch (e) { cb(e); } }
  destroy(sid, cb = () => {}) { try { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb(null); } catch (e) { cb(e); } }
  touch(sid, sess, cb = () => {}) { try { const expire = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : now() + 7 * 86400000; db.prepare('UPDATE sessions SET expire=? WHERE sid=?').run(expire, sid); cb(null); } catch (e) { cb(e); } }
}

const PORT = Number(process.env.PORT || 3000);
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'scripts');
fs.mkdirSync(uploadDir, { recursive: true });
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET === 'CHANGE_ME_BEFORE_DEPLOYMENT')) throw new Error('Set a unique SESSION_SECRET of at least 32 characters');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({ store: new SQLiteSessionStore(), name: 'vg.sid', secret: process.env.SESSION_SECRET || 'local-development-only-secret-change-this', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 } }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api/', rateLimit({ windowMs: 60000, limit: 100, standardHeaders: true, legacyHeaders: false }));
const storage = multer.diskStorage({ destination: uploadDir, filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.lua`) });
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, /\.lua$/i.test(file.originalname)) });
const now = () => Date.now();
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const isAdmin = id => (process.env.ADMIN_DISCORD_IDS || '').split(',').map(x => x.trim()).filter(Boolean).includes(String(id));
const user = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Login with Discord first' });
const admin = (req, res, next) => req.session.user && isAdmin(req.session.user.id) ? next() : res.status(403).json({ error: 'Admin access required' });
const audit = (actor, action, detail = '') => db.prepare('INSERT INTO audit(actor,action,detail,created_at) VALUES(?,?,?,?)').run(String(actor || 'system'), action, String(detail).slice(0, 1000), now());
const getScript = id => db.prepare('SELECT * FROM scripts WHERE id=? OR slug=?').get(String(id), String(id));
function saveUser(p) { db.prepare('INSERT INTO users(id,username,avatar,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,avatar=excluded.avatar').run(p.id, p.username || p.global_name || 'Discord User', p.avatar || null, now()); }
function issueKey(scriptId, days, issuer, redeemedBy = null) { const key = crypto.randomBytes(24).toString('hex'); db.prepare('INSERT INTO keys(key,script_id,days,uses_left,created_by,redeemed_by,created_at) VALUES(?,?,?,?,?,?,?)').run(key, scriptId, days, 1, issuer || null, redeemedBy, now()); return key; }

app.get('/auth/discord', (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_REDIRECT_URI) return res.status(503).send('Discord OAuth is not configured.');
  const state = crypto.randomBytes(24).toString('hex'); req.session.oauthState = state;
  const q = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, redirect_uri: process.env.DISCORD_REDIRECT_URI, response_type: 'code', scope: 'identify', state });
  res.redirect(`https://discord.com/oauth2/authorize?${q}`);
});
app.get('/auth/discord/callback', async (req, res) => {
  try {
    if (!req.query.code || !req.query.state || !req.session.oauthState || req.query.state !== req.session.oauthState) return res.status(400).send('Invalid OAuth state');
    delete req.session.oauthState;
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: process.env.DISCORD_REDIRECT_URI }) });
    const token = await tokenRes.json(); if (!tokenRes.ok || !token.access_token) return res.status(401).send('Discord login failed');
    const profileRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const p = await profileRes.json(); if (!profileRes.ok || !p.id) return res.status(401).send('Could not read Discord profile');
    saveUser(p);
    req.session.regenerate(err => { if (err) return res.status(500).send('Session error'); req.session.user = { id: p.id, username: p.username, avatar: p.avatar }; res.redirect('/dashboard.html'); });
  } catch (e) { console.error('OAuth callback:', e); res.status(500).send('Login error'); }
});
app.post('/api/logout', user, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => { if (!req.session.user) return res.json({ user: null }); const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id); res.json({ user: req.session.user, premium: !!u && u.premium_until > now(), premiumUntil: u?.premium_until || 0, admin: isAdmin(req.session.user.id) }); });
app.get('/api/dashboard', user, (req, res) => {
  const uid = req.session.user.id, u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const scripts = db.prepare('SELECT id,name,slug,enabled,executions,created_at FROM scripts WHERE owner_id=? ORDER BY created_at DESC').all(uid);
  const guilds = db.prepare('SELECT count(*) n FROM guilds').get().n;
  const access = db.prepare('SELECT e.script_id,e.expires_at,s.name,s.slug,k.key FROM entitlements e JOIN scripts s ON s.id=e.script_id LEFT JOIN keys k ON k.key=(SELECT key FROM keys WHERE script_id=e.script_id AND redeemed_by=e.user_id ORDER BY created_at DESC LIMIT 1) WHERE e.user_id=? AND e.expires_at>? AND s.enabled=1 ORDER BY e.expires_at DESC').all(uid, now());
  res.json({ scripts, access, stats: { scripts: scripts.length, executions: scripts.reduce((a, s) => a + s.executions, 0), servers: guilds }, premium: u.premium_until > now(), premiumUntil: u.premium_until, limit: u.premium_until > now() ? 8 : 3 });
});
app.post('/api/scripts', user, (req, res, next) => upload.single('script')(req, res, err => err ? res.status(400).json({ error: err.message }) : next()), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a .lua file' });
  const uid = req.session.user.id, u = db.prepare('SELECT premium_until FROM users WHERE id=?').get(uid), count = db.prepare('SELECT count(*) n FROM scripts WHERE owner_id=?').get(uid).n, limit = u.premium_until > now() ? 8 : 3;
  const name = String(req.body.name || '').trim().slice(0, 60); if (!name) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'Script name is required' }); }
  if (count >= limit) { fs.unlinkSync(req.file.path); return res.status(403).json({ error: `Your plan allows ${limit} scripts` }); }
  const id = crypto.randomUUID(), slug = crypto.randomBytes(12).toString('hex');
  db.prepare('INSERT INTO scripts(id,owner_id,name,slug,source_path,created_at) VALUES(?,?,?,?,?,?)').run(id, uid, name, slug, req.file.path, now()); audit(uid, 'script.create', `${id}:${name}`);
  res.json({ ok: true, id, name, slug, loader: `script_key = "YOUR_GENERATED_KEY"\nloadstring(game:HttpGet("${BASE}/api/loader/${slug}.lua"))()` });
});
app.patch('/api/scripts/:id', user, (req, res) => { const s = db.prepare('SELECT * FROM scripts WHERE id=? AND owner_id=?').get(req.params.id, req.session.user.id); if (!s) return res.status(404).json({ error: 'Script not found' }); if (typeof req.body.enabled === 'boolean') db.prepare('UPDATE scripts SET enabled=? WHERE id=?').run(req.body.enabled ? 1 : 0, s.id); if (req.body.name) db.prepare('UPDATE scripts SET name=? WHERE id=?').run(String(req.body.name).trim().slice(0, 60), s.id); audit(req.session.user.id, 'script.update', s.id); res.json({ ok: true }); });
app.delete('/api/scripts/:id', user, (req, res) => { const s = db.prepare('SELECT * FROM scripts WHERE id=? AND owner_id=?').get(req.params.id, req.session.user.id); if (!s) return res.status(404).json({ error: 'Script not found' }); db.transaction(() => { db.prepare('DELETE FROM hwids WHERE script_id=?').run(s.id); db.prepare('DELETE FROM entitlements WHERE script_id=?').run(s.id); db.prepare('DELETE FROM keys WHERE script_id=?').run(s.id); db.prepare('DELETE FROM scripts WHERE id=?').run(s.id); })(); try { fs.unlinkSync(s.source_path); } catch {} audit(req.session.user.id, 'script.delete', s.id); res.json({ ok: true }); });
app.post('/api/redeem', user, (req, res) => {
  const key = String(req.body.key || '').trim();
  const row = db.prepare('SELECT * FROM keys WHERE key=?').get(key);
  if (!row || row.uses_left < 1 || (row.redeemed_by && row.redeemed_by !== req.session.user.id)) return res.status(400).json({ error: 'Invalid, used, or assigned key' });
  const script = db.prepare('SELECT * FROM scripts WHERE id=? AND enabled=1').get(row.script_id); if (!script) return res.status(404).json({ error: 'Script unavailable' });
  const expiry = now() + row.days * 86400000;
  const tx = db.transaction(() => {
    const claimed = db.prepare('UPDATE keys SET uses_left=0,redeemed_by=? WHERE key=? AND uses_left>0 AND redeemed_by IS NULL').run(req.session.user.id, key);
    if (claimed.changes !== 1) throw new Error('KEY_ALREADY_CLAIMED');
    db.prepare('INSERT INTO entitlements(user_id,script_id,expires_at) VALUES(?,?,?) ON CONFLICT(user_id,script_id) DO UPDATE SET expires_at=max(expires_at,excluded.expires_at)').run(req.session.user.id, row.script_id, expiry);
  });
  try { tx(); } catch (e) { return res.status(409).json({ error: e.message === 'KEY_ALREADY_CLAIMED' ? 'This key has already been redeemed' : 'Key redemption conflict; try again' }); }
  audit(req.session.user.id, 'key.redeem', row.script_id); res.json({ ok: true, message: 'Key redeemed', expiresAt: expiry, script: script.name });
});
app.post('/api/scripts/:id/reset-hwid', user, (req, res) => { const s = db.prepare('SELECT * FROM scripts WHERE id=?').get(req.params.id); if (!s) return res.status(404).json({ error: 'Script not found' }); const uid = req.session.user.id; if (s.owner_id !== uid && !db.prepare('SELECT 1 FROM entitlements WHERE user_id=? AND script_id=? AND expires_at>?').get(uid, s.id, now())) return res.status(403).json({ error: 'No access to this script' }); db.prepare('DELETE FROM hwids WHERE user_id=? AND script_id=?').run(uid, s.id); audit(uid, 'hwid.reset', s.id); res.json({ ok: true, message: 'HWID reset. Your next execution will bind this device.' }); });
app.get('/api/loader/:slug.lua', (req, res) => {
  const s = db.prepare('SELECT slug FROM scripts WHERE slug=? AND enabled=1').get(req.params.slug); if (!s) return res.status(404).type('text/plain').send('-- VIREX GUARD: script unavailable');
  const endpoint = `${BASE}/api/execute/${s.slug}.lua`;
  res.type('text/plain').set('Cache-Control', 'no-store').send(`-- VIREX GUARD authenticated loader\nlocal key = script_key\nif type(key) ~= "string" or key == "" then error("VIREX GUARD: set script_key first") end\nlocal ok, hwid = pcall(function() return game:GetService("RbxAnalyticsService"):GetClientId() end)\nif not ok or type(hwid) ~= "string" or hwid == "" then error("VIREX GUARD: this executor does not expose a supported device identifier") end\nlocal url = "${endpoint}?key=" .. game:GetService("HttpService"):UrlEncode(key) .. "&hwid=" .. game:GetService("HttpService"):UrlEncode(hwid)\nlocal source = game:HttpGet(url)\nlocal fn, err = loadstring(source)\nif not fn then error(err) end\nreturn fn()`);
});
app.get('/api/execute/:slug.lua', (req, res) => {
  const s = db.prepare('SELECT * FROM scripts WHERE slug=? AND enabled=1').get(req.params.slug); if (!s) return res.status(404).type('text/plain').send('-- VIREX GUARD: script unavailable');
  const key = String(req.query.key || ''), hwid = String(req.query.hwid || ''); if (!key || !hwid || hwid.length > 256) return res.status(400).type('text/plain').send('-- VIREX GUARD: missing key or device identifier');
  const k = db.prepare('SELECT * FROM keys WHERE key=? AND script_id=?').get(key, s.id);
  if (!k || k.uses_left !== 0 || !k.redeemed_by) return res.status(403).type('text/plain').send('-- VIREX GUARD: key has not been redeemed');
  const uid = k.redeemed_by, entitlement = db.prepare('SELECT expires_at FROM entitlements WHERE user_id=? AND script_id=?').get(uid, s.id);
  if (!entitlement || entitlement.expires_at <= now()) return res.status(403).type('text/plain').send('-- VIREX GUARD: access expired or revoked');
  const digest = hash(hwid), existing = db.prepare('SELECT hwid_hash FROM hwids WHERE user_id=? AND script_id=?').get(uid, s.id);
  if (existing && existing.hwid_hash !== digest) return res.status(403).type('text/plain').send('-- VIREX GUARD: device mismatch. Request an HWID reset.');
  if (!existing) db.prepare('INSERT INTO hwids(user_id,script_id,hwid_hash,created_at) VALUES(?,?,?,?)').run(uid, s.id, digest, now());
  try { const code = fs.readFileSync(s.source_path, 'utf8'); db.prepare('UPDATE scripts SET executions=executions+1 WHERE id=?').run(s.id); res.type('text/plain').set('Cache-Control', 'no-store').send(`-- VIREX GUARD protected delivery\n${code}`); }
  catch (e) { console.error('Script delivery:', e); res.status(500).type('text/plain').send('-- VIREX GUARD: delivery error'); }
});
app.get('/api/admin/overview', admin, (_req, res) => res.json({ users: db.prepare('SELECT count(*) n FROM users').get().n, scripts: db.prepare('SELECT count(*) n FROM scripts').get().n, keys: db.prepare('SELECT count(*) n FROM keys').get().n, activeEntitlements: db.prepare('SELECT count(*) n FROM entitlements WHERE expires_at>?').get(now()).n, guilds: db.prepare('SELECT count(*) n FROM guilds').get().n, recentAudit: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 20').all() }));
app.get('/api/admin/scripts', admin, (_req, res) => res.json({ scripts: db.prepare('SELECT s.*,u.username owner_name FROM scripts s LEFT JOIN users u ON u.id=s.owner_id ORDER BY s.created_at DESC').all() }));
app.get('/api/admin/users', admin, (_req, res) => res.json({ users: db.prepare('SELECT id,username,avatar,premium_until,created_at FROM users ORDER BY created_at DESC LIMIT 200').all() }));
app.post('/api/admin/keys', admin, (req, res) => { const s = getScript(req.body.scriptId); if (!s) return res.status(404).json({ error: 'Script not found' }); const count = Math.min(100, Math.max(1, Number(req.body.count) || 1)), days = Math.min(3650, Math.max(1, Number(req.body.days) || 30)); const created = []; const tx = db.transaction(() => { for (let i = 0; i < count; i++) created.push(issueKey(s.id, days, req.session.user.id)); }); tx(); audit(req.session.user.id, 'admin.keys.create', `${s.id}:${count}`); res.json({ ok: true, keys: created }); });
app.post('/api/admin/premium', admin, (req, res) => { const uid = String(req.body.userId || ''); if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(uid)) return res.status(404).json({ error: 'User not found' }); const days = Math.max(1, Math.min(3650, Number(req.body.days) || 30)), until = now() + days * 86400000; db.prepare('UPDATE users SET premium_until=max(premium_until,?) WHERE id=?').run(until, uid); audit(req.session.user.id, 'admin.premium.grant', `${uid}:${days}`); res.json({ ok: true, premiumUntil: until }); });
app.post('/api/admin/scripts/:id/toggle', admin, (req, res) => { const s = getScript(req.params.id); if (!s) return res.status(404).json({ error: 'Script not found' }); const enabled = req.body.enabled ? 1 : 0; db.prepare('UPDATE scripts SET enabled=? WHERE id=?').run(enabled, s.id); audit(req.session.user.id, 'admin.script.toggle', `${s.id}:${enabled}`); res.json({ ok: true, enabled: !!enabled }); });
app.get('/health', (_req, res) => res.json({ ok: true, service: 'VIREX GUARD', time: new Date().toISOString() }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.listen(PORT, () => { console.log(`VIREX GUARD listening on ${PORT}`); if (process.env.DISCORD_BOT_TOKEN) { const bot = fork(path.join(__dirname, '..', 'bot', 'bot.js'), [], { env: process.env, stdio: 'inherit' }); bot.on('exit', code => console.error(`Discord bot exited with code ${code}`)); } });
