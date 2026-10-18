# 🔒 Security Policy

**English** · [العربية](../docs/SECURITY.ar.md)

We take the security of **Network Monitor** seriously. Thank you for helping keep it and its users safe.

---

## 🔍 Supported scope

This policy covers the latest released version of the project.

| Item | Value |
|---|---|
| Project | Network Monitor |
| Repository | [`kerolos-it2022/network-monitor`](https://github.com/kerolos-it2022/network-monitor) |
| Current version | [![Version](https://img.shields.io/github/v/release/kerolos-it2022/network-monitor)](https://github.com/kerolos-it2022/network-monitor/releases) |
| Platform | Node.js **22+** (24 LTS recommended) on Linux — PM2/systemd/Nginx, or the Debian appliance |

> **Unsupported versions:** please upgrade to the latest release before reporting — fixes are only produced
> for current versions.

---

## 📣 Reporting a vulnerability

> ⚠️ **Please do not open a public issue for a security problem** — that puts every user at risk.

### Recommended path (private, tracked)

1. **GitHub Security Advisories** (preferred):
   `https://github.com/kerolos-it2022/network-monitor/security/advisories/new` → *Report a vulnerability*.
   This keeps the whole conversation private.
2. **If that is not possible** (for example you cannot open an advisory), open a public issue with a
   **generic title only** (“Request for a security contact channel”) and **no technical detail**; we will
   answer with a private channel.

### 🧾 Include in the report

- What the issue is and its class (XSS, SQL injection, SSRF, IDOR…).
- Reproduction steps in detail (or a PoC).
- The affected version.
- Expected impact and severity (CVSS if you have it).
- Any suggested fix.

### Expected response times

| Stage | Time |
|---|---|
| 📥 Acknowledgement | within 48 hours |
| 🔍 Initial assessment and triage | within 5 working days |
| 🛠️ Fix + coordinated disclosure | depending on severity (table below) |

| Severity | Target fix window |
|---|---|
| Critical | within 7 days |
| High | within 14 days |
| Medium | within 30 days |
| Low | next planned release |

---

## ✅ Coordinated disclosure

We follow responsible disclosure:

- We aim to fix the issue before any public statement.
- We publish a **GitHub Security Advisory** once a fix ships, so users know the patched point.
- We credit the reporter in the public disclosure if they wish.
- We will not pursue good-faith researchers who follow this policy (safe harbour).

---

## 🛡️ High-priority areas

Please give immediate attention to anything affecting:

- **Session confidentiality or integrity** (`SESSION_SECRET`, session cookies).
- **Password storage or disclosure** (bcrypt hashes, `DEFAULT_ADMIN_PASSWORD`).
- **SQL injection** on any API route.
- **Authentication / authorization bypass** (getting past the session or role checks).
- **Remote code execution** — via the update routes, or via the appliance root helpers and their request
  files (the design rule is that the web process can never pass a command or a path, only a tag or a
  whitelisted action).
- **Leakage of `.env`** or of third-party credentials (Telegram, WhatsApp, VAPID, GitHub token).

---

## 🧪 Testing safely

- Use an **isolated environment** (a VM or a fresh WSL) — never production data or real devices.
- Do not point the network tools (ping / tracert / scan) at hosts outside your own range.
- Reading the code with the server stopped (`backend/src/`) is encouraged before running anything.

---

## 📜 License and liability

This project is **proprietary** (`UNLICENSED`) — see [LICENSE](../LICENSE). It is provided **as is**, without
warranty. We fix reported vulnerabilities with our best effort, but scheduling depends on available resources.

---

**Thank you for helping keep the project safe! 🙏**
