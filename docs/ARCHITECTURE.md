# 🏗️ Architecture

**English** · [العربية](ARCHITECTURE.ar.md)

How the pieces fit together. This describes the shape of the system, the main data flows and the security
model — enough to work on the code or to reason about a deployment.

## Shape of the system

A **modular monolith**: one Node.js process serves the REST API, the SSE stream, the static pages and the
printable reports, and talks to one local SQLite database. There is no queue, no second service to run and
no build step for the frontend.

```
browser ──HTTP/SSE──► nginx (optional) ──► node (Express) ──► better-sqlite3 ──► monitoring.db
                                              │
                                              ├── check engine (ping/HTTP/HTTPS/TCP)
                                              ├── discovery listener (NBNS/mDNS/LLMNR/SSDP)
                                              ├── notifier (Telegram / WhatsApp / Web Push)
                                              ├── background loops (scheduler, daily report, escalation,
                                              │   watchdog, retention, backups)
                                              └── root helpers on the appliance (nm-update, nm-remote)
```

## Backend

| Path | Responsibility |
|---|---|
| `src/server.js` | Boot: env, database, background loops, HTTP listener |
| `src/app.js` | Express wiring, sessions, static pages, route mounting, `/api/health` (reports the version from `package.json`) |
| `src/db.js` | Single synchronous `better-sqlite3` connection (WAL) + **safe migrations** applied at boot |
| `src/routes/*` | Thin HTTP layer per domain: auth, devices, locations, device-types, map, topology, live (SSE), notifications, tools, update, appliance-update, backup, ai, system |
| `src/services/*` | The behaviour: monitor engine, protocol checkers, incident/RCA, uptime & history, discovery, notifier, smart alerts, escalation, scan scheduler, maintenance windows, backups, VAPID/Web Push, ngrok remote access, console password sync |
| `src/middleware/*` | Session auth, role checks, CSRF guard, audit logging |
| `test/*` | `node:test` suite (169 tests): API behaviour, security, migrations, i18n parity, notifier, history, limits |

Conventions worth knowing:

- **One synchronous DB connection.** Statements are prepared once and executed synchronously; there is no
  connection pool and no async DB driver. Long loops therefore yield in small batches.
- **Migrations are additive and idempotent** (`ALTER TABLE` guarded by checks) so an existing database
  survives an upgrade without manual steps.
- **Background loops are `.unref()`ed timers** owned by services and started from `server.js`, so the test
  suite can import a service without starting the engine.
- **The web process never runs privileged commands.** Anything that needs root is delegated to a helper
  script through a *request file* (see the appliance section).

## Check engine and live data

1. Each device row carries its own interval and failure threshold (`check_interval_seconds`,
   `failure_threshold`) and one of the protocols `ping | port | http | https`.
2. The engine runs each device's probe on its own schedule, bounded by `NM_MAX_CONCURRENT_CHECKS`.
3. A state change writes a `status_logs` point, updates `devices.current_status`, opens or closes a
   `downtime_events` row, and (for services) updates the per-service health that produces `DEGRADED`.
4. Every change is published to the **SSE hub** (`/api/live/status`) which sends one snapshot to a new
   client and then only diffs. The public page and the NOC screen fall back to polling if SSE fails.
5. A **watchdog** loop watches the engine itself (heartbeat and stuck checks) and raises its own alert if
   the engine stops progressing — stale data is never presented as fresh.

## Incidents (RCA) and uptime

- When a device goes down the engine looks at the network chain (the `parent_id` topology) and asks whether
  the failure is explained by an upstream device. If it is, one **incident** is recorded with the culprit and
  the affected list, and a single alert is sent (instead of one message per device) — while every device
  still keeps its own downtime events.
- Uptime per device is time-weighted over the requested window (24 h / 7 d / 30 d), reported together with a
  **coverage** value (how much of the window actually has data), and rolled up into 90-day aggregates before
  raw `status_logs` rows are pruned.

## Discovery

A resident listener (NBNS, mDNS, LLMNR, SSDP) collects the names devices announce about themselves and
stores them in `discovery_names`; scheduled or on-demand subnet sweeps add ping/port results, MAC vendor,
reverse DNS and a suggested device type. Results are never added automatically: they land in a **pending
basket**, the owner picks devices, and a trust list keeps known-but-unwanted hosts quiet.

## Notifications

`notifier.service` is the only writer to `notification_logs`. Channels (Telegram, WhatsApp, Web Push) are
independent; each attempt records `sent`, `failed` (with the provider's own reason) or `maintenance`
(suppressed by a maintenance window). Smart alerts add storm batching, a daily report, escalation reminders
and the interactive Telegram bot. An optional AI summary is generated only when a key is configured, and
internal addresses are redacted before anything leaves the machine.

## Frontend

Plain ES5/ES2018 JavaScript, no framework and no bundler. `ui.css` is the shared design layer on top of the
per-page stylesheets; `nm-*.js` files hold cross-page concerns (formatting, i18n, language switch) and
`admin-*.js` files one dashboard tab each. The dashboard is a single HTML file whose sections are shown and
hidden by a tab map, with several tabs revealing more than one section. `sw.js` implements the PWA cache and
push handling.

## Security model

| Concern | Approach |
|---|---|
| Sessions | `express-session`, httpOnly cookie, long random secret, persistent store, 12 h default lifetime |
| Roles | `admin` and `viewer`; write routes require admin, the audit log records who changed what |
| CSRF | Guard middleware on state-changing routes plus SameSite cookies |
| Input | Prepared statements everywhere; the public endpoints return a **sanitised** projection (no internal inventory, IPs only to signed-in users) |
| Secrets | Only in `backend/.env`; masked in the UI; VAPID keys generated and stored by the service itself |
| Appliance | systemd hardening (`ProtectSystem=strict`, `NoNewPrivileges`, `PrivateTmp`), one writable path, nftables allowing 80/443 only, SSH disabled, and root helpers invoked through request files with a whitelist |

## Appliance and self-update

On the installed appliance the web service runs as `netmon`. It cannot write to its own code: the dashboard
writes a request file (containing a tag or a whitelisted remote-access action), a systemd `.path` unit
notices it and starts the matching root service, which downloads the release archive, `rsync`s the files,
runs `npm ci` and restarts the service. Node is upgraded by the same path when needed
(`nm-node-upgrade`). The console menu (`nm-console`) and the web dashboard share one password through
`nm-sync-console-password`, reachable through a single narrowly-scoped `sudoers.d` line.

## Related documents

| Document | Content |
|---|---|
| [DEPLOY.md](DEPLOY.md) | Installing on a Linux server |
| [I18N.md](I18N.md) | The bilingual UI model |
| [../appliance/README.md](../appliance/README.md) | Building and installing the ISO |
| [../README.md](../README.md) | Overview, features, API summary |
