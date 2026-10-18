---
name: 🐛 Bug report
about: Report a problem or unexpected behaviour in Network Monitor
title: "[BUG]: "
labels: ["bug", "needs-triage"]
assignees:
  - kerolos-it2022
---

## 📝 What happened

> A short, clear description of the problem.
> (يمكنك الكتابة بالعربية — العلامات تبقى كما هي حتى تُقرأ آليًّا.)

---

## 🔄 Steps to reproduce

1.
2.
3.

**Expected behaviour:** what should have happened?



**Actual behaviour:** what happened instead?



**Frequency:** [ ] always  [ ] sometimes (how often? %)  [ ] once

---

## 🖥️ Environment

| Item | Value |
|---|---|
| Network Monitor version | (e.g. 2.50.0 — from `/api/update/status`) |
| Operating system | (e.g. Ubuntu 24.04 LTS / Debian 12 / appliance ISO) |
| Node.js version | (`node -v`) |
| PM2 version | (`pm2 -v`) |
| Browser + version | (if the problem is in the UI) |
| How it runs | [ ] PM2  [ ] systemd  [ ] plain node  [ ] behind Nginx |
| Check protocol involved | [ ] Ping  [ ] HTTP  [ ] HTTPS  [ ] TCP port  [ ] SNMP |

---

## 📋 Logs and evidence

```bash
# Paste any relevant logs here (`pm2 logs --lines 50`) or the error messages:
```

<details><summary>📎 Screenshot / clip (optional)</summary>

</details>

---

## 🎯 Additional context

> Anything else that helps: network size, number of devices, firewall setup, recent upgrade…
