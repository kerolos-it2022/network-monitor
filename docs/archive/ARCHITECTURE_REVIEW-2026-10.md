# Architecture review and implementation plan

> 📦 **Archived document (2026-10).** Kept for reference: this is the review that drove the hardening pass.
> Most of the findings (A1–A15) are implemented today, so read it as a snapshot, not as current state.
> Current documentation: [../ARCHITECTURE.md](../ARCHITECTURE.md) (English) ·
> [../ARCHITECTURE.ar.md](../ARCHITECTURE.ar.md) (العربية). File paths mentioned below refer to the
> repository layout of that date.

Date: 2026-10-17. Scope: local repository, no production deployment.

## Architecture and review coverage

This is a modular monolith: Express serves REST, SSE, static Arabic RTL pages,
and authenticated printable reports. `app.js` constructs the HTTP app;
`server.js` starts the monitoring engine, discovery, notification, retention,
backup and integration schedulers. Services share one synchronous better-sqlite3
connection using WAL. SQLite stores inventory, observations, rollups, incidents,
configuration, credentials, sessions and audit events. Browser scripts use global
functions and direct DOM updates; the service worker supports public offline
assets and push. Deployment supports PM2 and a hardened Debian appliance with
separate privileged update/remote-access helpers.

Repository-wide inventory covered tracked source, routes, service entry points,
tests, schema, frontend, CI, Linux deployment and appliance scripts. Focused
reading and regression verification concentrated on trust boundaries, session
lifecycle, reports and PWA caching. Existing architecture notes were checked
against current code rather than treated as current truth. This is not a claim
that every executable path or external device integration was exercised.

Strengths: testable app factory; isolated temporary database fixtures; public DTO
sanitization; explicit host/service states; bounded diagnostic tools; timestamped
rollups; read-only opt-in integrations; Arabic UI and reusable design tokens.
Keep this architecture while improving module boundaries. A framework rewrite
or database replacement is not justified by the evidence collected here.

## Priorities

| ID | Finding / improvement | Impact | Difficulty | Phase |
|---|---|---|---|---|
| A1 | Deleted accounts retain authenticated sessions; password changes do not revoke other sessions | Critical | Medium | 1 |
| A2 | Login and audit read untrusted X-Forwarded-For directly | High | Low | 1 |
| A3 | Login does not rotate session ID; HTTPS cookies lack Secure | High | Low | 1 |
| A4 | Private printable pages can enter service-worker cache | High | Medium | 2 |
| A5 | Weekly report drops outages crossing the start boundary and counts time beyond the end | High | Medium | 3 |
| A6 | Restore overwrites an open SQLite file while writers and WAL may remain active | Critical | High | Follow-up recovery phase |
| A7 | PM2 CI deployment resets live checkout with no post-deploy readiness/rollback | High | High | Follow-up operations phase |
| A8 | Large global frontend modules and route files mix UI, validation, IO and policy | Medium | High | Incremental refactoring |
| A9 | Confirmation/edit modal listeners are not consistently cleaned up; keyboard focus is not trapped/restored | Medium | Medium | 4 |
| A10 | Every health request synchronously rereads package.json | Low | Low | 4 |
| A11 | Migrations swallow all ALTER failures and existing startup includes destructive historical migration | High | High | Follow-up data phase |
| A12 | SSE ignores backpressure and open connections do not recheck display policy | Medium | Medium | Follow-up live-data phase |
| A13 | Primary probes repeatedly perform secondary web-interface discovery | Medium | Medium | Performance backlog |
| A14 | README version/API/security descriptions drift from implementation | Medium | Low | Documentation backlog |
| A15 | Shared `esc()` leaves HTML/attribute delimiters unchanged before inventory rendering | High | Low | 4 — fixed |

A1/A2 were reproduced against an isolated database before this request. Re-run
as regression tests. A4/A6/A7/A9/A11/A12 are source-review findings; production
behavior is not claimed to have been tested. Current device-history coverage is
more rigorous than the legacy weekly aggregate: preserve its existing API while
fixing interval clipping, and label aggregate uptime as an estimate.

## Safe implementation sequence

### Phase 0 — baseline (before edits)
- Inventory repository, verify clean working tree, inspect existing tests and UI screenshot.
- Run the complete baseline suite on the installed Node runtime.
- Never open the real monitoring database for test data; disable external integrations.

### Phase 1 — authentication and request trust
- Resolve client IP through Express's configured trusted-proxy chain, including audit.
- Rotate session on successful login; preserve remember-me and restart persistence.
- Validate authenticated account existence and credential/identity version centrally.
- Revoke other sessions on password change and all sessions on account deletion.
- Set Secure automatically for HTTPS without breaking local HTTP deployment.
- Test spoofed headers, deletion, recreation, password rotation, session rotation,
  trusted proxy, cookie flags, malformed login, and existing role restrictions.

### Phase 2 — private-cache boundary
- Cache only known public shell/assets; bypass private/dynamic documents.
- Bump cache generation to purge previously stored private content.
- Add no-store response headers for private data.
- Test the actual service-worker fetch handler in a sandbox, offline fallback,
  push-handler retention, and cache migration; test HTTP response headers.

### Phase 3 — weekly interval correctness
- Extract report data calculation from HTML rendering into a service.
- Select outages overlapping the window, clip duration at both ends, and rank
  longest events using clipped duration, including currently open outages.
- Preserve existing response fields and the count of events starting in a week;
  add an overlapping-events count. Validate offset and return 400 for bad input.
- Test boundaries, historical/open events, empty reports, and authenticated API.
- Keep estimated uptime explicitly labeled; coverage-aware SLA is a separate feature.

### Phase 4 — bounded maintainability/UX improvements
- Load immutable application version once rather than on every health request.
- Clean modal handlers, settle displaced confirmations, restore/trap focus, and
  ensure Escape/Enter respects the currently active confirmation.
- Verify with DOM behavior tests and existing suite, plus JS syntax checks.

For each phase: focused regressions first, then full suite; inspect diff for API
and feature compatibility. Revert an individual code phase if acceptance fails.
No dependency upgrades, database replacement, production actions, or feature
removals are included. New session metadata remains backwards-compatible with
existing stored sessions. Cache-generation rollback cannot recover old caches,
but the public shell is fetched again without affecting server-side data.

## Follow-up implementation designs

1. **Safe restore (highest remaining priority):** stage upload; integrity and schema
   checks; create online safety backup; enter maintenance mode; drain HTTP writers,
   probes and schedulers; close/checkpoint DB; replace using a same-filesystem
   atomic operation with explicit WAL/SHM handling; supervisor restart; validate
   migrations/readiness; recover safety copy on failure. Acceptance: Linux/Windows
   subprocess restore drills with active writers and forced failure at each step.
2. **Releases:** immutable release directories and database preflight backup;
   readiness checks before switching; supervisor-aware rollback and smoke tests.
   Exercise PM2, systemd and appliance in disposable environments before rollout.
3. **Data migrations:** numbered transactional ledger, reject unexpected errors,
   move historical destructive operations out of ordinary startup. Test real
   prior-version fixtures, interruption recovery and repeated boot. Do not
   restore removed features merely because stale documentation mentions them.
4. **SSE/performance:** disconnect slow consumers with bounded buffers; recheck
   public policy; separate snapshots from the shared diff baseline; measure
   event-loop lag, stale checks, DB growth and p95 response latency under load.
   Throttle secondary discovery separately from primary health checks. Preserve
   current protocol semantics and do not weaken TLS verification implicitly.
5. **Refactoring:** split `scan.routes.js` and `update.routes.js` into validation,
   orchestration and IO services; decompose `noc.js` and `admin-map.js` by state,
   layout and rendering. Add contract tests before moving code. Use a shared
   API client, validation helpers, structured logging and an API specification.

## UI/UX and useful feature backlog

Reviewed existing dashboard screenshot and HTML/CSS/JS; live cross-browser visual
QA remains outstanding. Preserve RTL, themes, NOC layout, polling fallback,
printing, exports and push. Existing sidebar/table layout is understandable,
but dense navigation, repeated inline actions, global scripts and modal focus
handling need attention. Validate keyboard-only operation, 360px layouts, long
Arabic labels, reduced motion, error announcements and day/night contrast.

| Feature | Value | Difficulty / dependency |
|---|---|---|
| Incident acknowledgement, owner, comments and resolution reason | High operational value | Medium; extend existing incidents |
| Operator role and site-scoped permissions | High for teams | High; authorization matrix + tests |
| Coverage-aware SLA and maintenance exclusions | High reporting value | High; historical membership and coverage model |
| Certificate expiry alerts | Medium, actionable | Medium; separate from reachability/TLS policy |
| Local QR generation | Medium privacy/offline value | Low/medium; replace third-party request after parity tests |
| Saved filters and bulk actions with preview | Medium daily usability | Medium; large-inventory UX tests |

## Verification log

| Stage | Result |
|---|---|
| Baseline | 115/115 tests pass on Node 24.22.0 / Windows |
| Phase 1 | 13 focused authentication/security tests pass |
| Phases 1–2 | 126/126 full-suite tests pass; four worker sandbox tests pass |
| Phase 3 | 131/131 full-suite tests pass; five initial report tests pass |
| Phase 4 and final edge cases | 137/137 full-suite tests pass, zero skipped/failures |
| Syntax | 123 JavaScript files pass `node --check`, including the service worker |
| Patch hygiene | `git diff --check` passes (only Git line-ending notices) |

Implemented A1–A5, A9, A10 and A15. No features removed, dependencies added,
database schema changed, or production deployment performed. Weekly report
calculation is extracted into `weekly-report.service.js`; routes retain the
existing export for compatibility. Existing response keys remain; the overlapping
event count is additive. Invalid offsets now correctly return 400. SQLite UTC
timestamps and ISO timestamps are handled consistently in the report service.

Authentication tests additionally cover role changes, legacy session upgrade,
remember-me, restart persistence, and malformed credentials. Cookie Secure and
HSTS depend on Express's trusted-proxy configuration; deployments terminating
HTTPS at a proxy must configure `NM_TRUST_PROXY` narrowly. Existing legacy
sessions are upgraded on their next request, preserving current functionality.

Public shell offline support, push event handlers, reports, labels and admin
features remain. Private documents intentionally require a live authenticated
response. Cache generation v25 purges older application caches on activation.
Modal behavior and worker behavior were tested in Node VM environments; they
are not substitutes for real-browser accessibility and offline lifecycle tests.

No live appliance, production network, Linux deployment or real third-party
integration was exercised. No dependency vulnerability scan was performed.
The weekly aggregate remains an explicitly approximate metric based on current
active-device count, not historical membership or measured coverage. A6/A7/A11
remain substantial known risks requiring the follow-up designs above.

Unrelated untracked `live.json` and `live-dev.json` appeared during this work;
they were not read, modified or deleted. Temporary test-output logs created by
this review were removed after results were recorded here.
