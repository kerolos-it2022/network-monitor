# 🚀 HANDOFF v2.11.9 — ابدأ من هنا في جلسة جديدة

> آخر تحديث: 2026-10-12 · الإصدار المنشور: **v2.11.9** · آخر commit: `57cb705`

## أول حاجة تعملها في الجلسة الجديدة
1. تأكد إنك في مجلد المشروع: `E:\New claude\network-monitor-v2.5.0-dev`
2. `git status` — لازم يطلع نظيف (كل حاجة مرفوعة على GitHub)
3. اقرأ هذا الملف كامل + `git log --oneline -5`

## حالة المشروع الحالية (كله منشور وشغال)
| البند | الحالة |
|---|---|
| آخر إصدار | **v2.11.9** — Release + ISO منشورين تلقائيًا (4 أصول) |
| المستودع | `kerolos-it2022/network-monitor` — فرع `main` |
| آخر commit | `57cb705` — v2.11.9 (مراقب محرك المراقبة) |
| السيرفر المحلي | بورت **4001** (`backend/.env`) |

## الميزات الحديثة المهمة (آخر 3 إصدارات)
- **v2.11.7**: خطة «اكتشاف الأجهزة» كاملة + صفحة تحديثات منظمة + إدارة الوصول عن بُعد (ngrok).
- **v2.11.8**: إعادة تشغيل الجهاز بالكامل بعد اكتمال التحديث:
  - المساعد `nm-update` يكتب حالة `rebooting` ثم `sync` + مهلة 8 ثوانٍ + `systemctl reboot`.
  - الواجهة تنتظر عودة الخادم ثم تُحدّث الصفحة تلقائيًا (منع حلقة إعادة تحميل عبر localStorage).
  - ⚠️ المساعد الذي ينفّذ التحديث هو الموجود مسبقًا ⇒ أول تحديث يجلب الميزة لا يقلع، وما بعده يفعل.
- **v2.11.9**: مراقب محرك المراقبة (Engine Watchdog):
  - نبضة لكل دورة فحص + كشف الفحوصات العالقة + حارس تداخل دورات (`monitor.service.js`).
  - تحذير تلجرام واحد عند التعطّل + رسالة عودة.
  - `/api/health` يرجع `engine` (stalled / stuckChecks / lastTickAgeMs / activeDevices).
  - بانر أحمر في NOC + شريط في لوحة التحكم (`frontend/public/js/admin-health.js`).
  - حراسة خارجية على الأبلاينس: `nm-healthcheck` + `nm-healthcheck.timer` (كل دقيقتين) — إعادة تشغيل الخدمة عند التوقّف (تهدئة 15 دقيقة).
  - عتبات: `NM_ENGINE_STALL_MS=90000` · `NM_CHECK_STUCK_MS=180000` · `NM_WATCHDOG_INTERVAL_MS=30000` · `NM_HEALTH_RESTART_COOLDOWN=900`.

## سير العمل الإلزامي لكل تعديل (طلب المستخدم — دائمًا)
1. عدّل الكود + فحص الصياغة (`node --check` / `bash -n`).
2. جهّز الإصدار: `backend/package.json` + `appliance/run-build.sh` + README (الشارة + سطر «الإصدار الحالي») + `CHANGELOG.md`.
3. `git add` (الملفات المعنية فقط) → `git commit` → `git push origin main`.
4. `git tag vX.Y.Z` → `git push origin vX.Y.Z` → الـCI يبني الـISO وينشر الـRelease تلقائيًا (~7 دقائق).
5. تعديلات docs فقط = commit بدون tag (اتبع سابقة commits الـ`docs:`).

## بيئة التطوير على هذا الجهاز (مهم!)
- **Node**: استخدم `C:\nvm4w\nodejs\node.exe` (**v20.18.0**) — لأن `better-sqlite3` متجمّع لـ Node 20، وNode 24 المدمج يفشل (`NODE_MODULE_VERSION`).
  - لو الموديول ضاع: `cd backend\node_modules\better-sqlite3` ثم `& C:\nvm4w\nodejs\node.exe ..\prebuild-install\bin.js`.
- **تشغيل السيرفر محليًا**: `cd backend` ثم `& C:\nvm4w\nodejs\node.exe src/server.js` (بورت **4001**).
- **بدون Docker** (توقف استخدامه محليًا) — فحص سكريبتات bash عبر **WSL** (مسارات `/mnt/e/...`) أو Git Bash.
- **نهايات الأسطر**: ملفات `appliance/**` لازم LF؛ بعض ملفات backend وnoc.html CRLF — أي تعديل برمجي لازم يحافظ على النهاية الأصلية (سكربت Python بـ `newline=''`).
- **PowerShell**: تجنّب python inline بالاقتباسات المعقّدة — اكتب سكربت `.py` ونفّذه.
- **GitHub**: صفحات الـActions/Releases بعض الأوقات تِرجع snapshots قديمة (كاش) — للتحقق الموثوق استخدم `git ls-remote` أو صفحة Release محددة `releases/tag/vX.Y.Z`.

## أوامر الأبلاينس المهمة (على الجهاز نفسه)
- إصدار المساعد: `sudo /usr/local/sbin/nm-update --version` (الحالي: v2.11.9).
- **تحديث عن طريق الشل** (نفس آلية الويب بالحرف):
  ```bash
  sudo sh -c 'rm -f /var/lib/network-monitor/update-request.json; printf "%s\n" "{\"tag\":\"latest\"}" > /var/lib/network-monitor/update-request.json'
  sudo tail -f /var/lib/network-monitor/update/update.log
  cat /var/lib/network-monitor/update/status.json
  ```
- حراسة المحرك: `systemctl status nm-healthcheck.timer --no-pager`.
- تنبيه NOC الصوتي: يصفر عند انقطاع جهاز **جديد** فقط (750Hz/0.4ث)، صوتة واحدة مهما انقطعوا معًا، وبدون حفظ للتفعيل بعد الريفريش.

## ملفات مرجعية
- `APPLIANCE-HANDOFF.md` — بناء/تشخيص الـISO.
- `CHANGELOG.md` — تاريخ الإصدارات كامل.
- `PROGRESS.md` — سجل بناء المشروع الأصلي.

## قواعد التعامل مع المستخدم
- يتكلم عامية مصرية — رد بنفس الأسلوب وباختصار.
- يفضّل **عرض خطة قبل التعديلات الكبيرة** (propose plan) ثم التنفيذ.
- **دائمًا** ارفع التحديثات على GitHub (سير العمل فوق).
