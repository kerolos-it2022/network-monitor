<!--
PULL_REQUEST_TEMPLATE.md — Network Monitor
================================================================
Thanks for contributing! ✨ Fill in the sections below so the review is quick.
Please keep the sections — write "N/A" if one does not apply.
(يمكنك الكتابة بالعربية — العناوين تبقى كما هي.)
-->

## 📝 What this change does

> What does this PR do, and why? State the motivation and the problem it solves.



---

## 🔗 Related

> Link the issue if there is one (Closes #123 / Refs #45 / Fixes #12).



---

## 🏷️ Type of change

> Tick what applies (more than one is fine).

- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] ♻️ Refactor / cleanup
- [ ] ⚡ Performance
- [ ] 🛡️ Security
- [ ] 📚 Documentation
- [ ] 🔧 Chore / CI
- [ ] 💥 Breaking change

---

## ✅ Checklist

- [ ] Ran the code locally and tested it manually.
- [ ] `node --check` passes on every modified file in `backend/src/` (and `frontend/public/js/`).
- [ ] `cd backend && npm test` passes.
- [ ] Frontend still works with the backend change (e.g. `/api/health`).
- [ ] Updated the affected docs (README / docs/DEPLOY.md / CHANGELOG / SECURITY).
- [ ] No sensitive data (`.env`, tokens, keys, passwords) in my diff.
- [ ] No breaking change, or it is documented below with a version bump.

---

## 💥 Breaking changes (if any)

> Describe exactly what could break for existing users and how to migrate. Otherwise write "None".

---

## 🖼️ Evidence (optional)

> Screenshots, `pm2 logs` output or `curl /api/health` results help the reviewer.

<details><summary>📎 Evidence</summary>

</details>

---

## 🧪 Testing (optional)

> The steps you used to verify the change:

```bash
# for example:
# cd backend && node src/server.js &
# curl http://localhost:4000/api/health
```

---

Thank you for improving Network Monitor! 🙏
