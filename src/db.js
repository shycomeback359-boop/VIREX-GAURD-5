const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'virex.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL, avatar TEXT, premium_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scripts(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, source_path TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, executions INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS keys(key TEXT PRIMARY KEY, script_id TEXT NOT NULL REFERENCES scripts(id), days INTEGER NOT NULL, uses_left INTEGER NOT NULL DEFAULT 1, created_by TEXT, redeemed_by TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS entitlements(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, script_id TEXT NOT NULL, expires_at INTEGER NOT NULL, UNIQUE(user_id,script_id));
CREATE TABLE IF NOT EXISTS hwids(user_id TEXT NOT NULL, script_id TEXT NOT NULL, hwid_hash TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,script_id));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS guilds(id TEXT PRIMARY KEY, name TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS buyer_roles(guild_id TEXT NOT NULL, script_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY(guild_id,script_id));
CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
`);
// Safe additive migration for databases created by earlier VIREX GUARD builds.
const cols = db.prepare('PRAGMA table_info(keys)').all().map(c => c.name);
if (!cols.includes('redeemed_by')) db.exec('ALTER TABLE keys ADD COLUMN redeemed_by TEXT');
module.exports = db;
