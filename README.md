# VIREX GUARD Ultimate (no payment integration)

A Node.js/Express + SQLite Lua script portal with Discord OAuth, a Discord.js bot, per-script entitlements, redeemable keys, device binding (HWID), admin tools, and Railway deployment files. There is deliberately **no payment processing**.

## Features in this build

- Dark responsive VIREX GUARD landing page and Discord OAuth sign-in.
- Dashboard with Free limit (3 scripts) and Premium limit (8 scripts), execution count, server count, uploads, script enable/disable/delete, and HWID reset.
- User access list with generated `script_key` + `loadstring(game:HttpGet(...))()` snippet for active redeemed access.
- Per-script keys, single-use redemption, expiring entitlements, and one-device binding.
- Discord commands: `/createpanel`, `/whitelist`, `/blacklist`, `/extendscript`, `/setbuyerrole`, `/generatekey`, `/freemode`, `/keydrop`, `/info`.
- Discord panel buttons: REDEEM KEY, GET SCRIPT, GET ROLE, RESET HWID, GET STATS.
- Buyer-role mapping and automatic role grant only when the user has an active entitlement.
- Admin API/dashboard for overview, key generation, Premium grants, script status, user listing, and audit records.
- SQLite additive migration for the `redeemed_by` key field, Railway Dockerfile, persistent-volume paths, and health endpoint.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and fill in Discord application credentials.
3. Set `SESSION_SECRET` to a unique random value of at least 32 characters.
4. Run `npm install`.
5. Run `npm run bot:deploy` to register slash commands. Set `DISCORD_GUILD_ID` for quick test-server registration; omit it for global commands.
6. Run `npm start`.

## Railway deployment

1. Push this directory to a private GitHub repository and deploy it on Railway using the included Dockerfile.
2. Add a Railway Volume mounted at `/app/persist`.
3. Configure `DB_PATH=/app/persist/virex.sqlite` and `UPLOAD_DIR=/app/persist/scripts`.
4. Set `BASE_URL` to the public HTTPS Railway domain.
5. Set `SESSION_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `ADMIN_DISCORD_IDS`, and `DISCORD_BOT_TOKEN`.
6. In the Discord Developer Portal, set the OAuth redirect to `https://YOUR-DOMAIN/auth/discord/callback`.
7. Invite the bot with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Embed Links, and Manage Roles if using buyer-role assignment. Enable the Server Members Intent in the Discord Developer Portal if your server requires it for member fetches. Place the bot's highest role above the buyer role.
8. Run `npm run bot:deploy` once after configuring credentials to register slash commands.
9. Confirm `https://YOUR-DOMAIN/health` returns `{ "ok": true }`.

The app starts the bot as a child process when `DISCORD_BOT_TOKEN` is configured. Use one Railway replica for this SQLite deployment; do not share a local SQLite file across multiple replicas.

## Discord command notes

- `/createpanel` takes the script ID or slug shown in the dashboard.
- `/whitelist` grants active entitlement and creates a user-bound script key. It posts the requested confirmation format and channel name.
- `/extendscript` extends the existing expiry.
- `/blacklist` removes entitlement and the device binding immediately.
- `/setbuyerrole` saves a per-server, per-script buyer-role mapping. The bot needs Manage Roles and role hierarchy permission.
- `/generatekey` creates private keys; `/keydrop` posts the generated keys in the current channel. Treat key-drop channels as public.
- `/freemode` grants the selected Discord user Premium dashboard capacity for the chosen number of days.

## Loader format

The dashboard generates a script-specific loader in this form:

```lua
script_key = "YOUR_GENERATED_KEY"
loadstring(game:HttpGet("https://YOUR-DOMAIN/api/loader/YOUR-SCRIPT.lua"))()
```

The loader then requests the authenticated script payload. Device binding uses `RbxAnalyticsService:GetClientId()` and URL encoding through `HttpService`. That API is not available in every Lua runtime; executor compatibility varies. The system does not bypass platform security or anti-cheat controls.

## Security and known limits

- Keys are single-use for redemption and remain bound to the account that redeemed them; login sessions are stored in SQLite so they survive app restarts; delivery checks the active entitlement and stored device hash on each execution.
- HWID is a device identifier supplied by the client runtime, not hardware attestation. It can be spoofed by a hostile client; reset it only for legitimate support cases.
- Lua delivered to a client can be recovered. This build does not claim unbreakable obfuscation, encrypted-at-rest source storage, or universal executor support.
- `GET ROLE` requires a guild buyer-role mapping and Discord permissions. `GET SCRIPT` directs users to redeem access and copy their own dashboard loader.
- Server count is synced from the bot's connected guild cache; it becomes available after the bot connects.
- No payments, checkout, billing, or payment-provider integration is included.
- Before public use, test OAuth, slash-command registration, permissions, uploads, backups, and loader behavior with scripts you own or are authorized to distribute.

## Visual refresh

The landing page and dashboard styles have been refreshed with a responsive dark-violet visual system, animated status indicators, feature cards, workflow steps, plan cards, a terminal-style access preview, and Discord avatar display. External Google Fonts are optional; the UI falls back to system fonts if they cannot load.
