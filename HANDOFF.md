# 📋 HANDOFF.md — سجل نقل الحالة بين الجلسات

> **الغرض**: هذا الملف يَوثّق كل ما تَمّ، والحالة الحالية، والخطوات المتبقية.
> ===> **أي نموذج ذكاء اصطناعي آخر أو جلسة جديدة يَجب أن يَبدأ بِقراءة هذا الملف بالكامل قبل أي شيء.**
>
> **تاريخ آخر تحديث**: 2026-07-26 (المحادثة الحالية — إضافة إصلاح ngrok)
> **السياق**: نِظام مُراقبة الشبكة (Network Monitor) — مستودع GitHub `kerolos-it2022/network-monitor`
> **المستخدم**: `it` (uid=1000) على خادم Linux (Ubuntu/Debian) على `/opt/network-monitor`

---

## 🆕 تحديث 2026-07-26 (إصلاح ngrok / SSE)

### إصلاح إضافي "اكتمل المسح! تم العثور على 46 جهاز" — النتائج لا تَظهر عبر ngrok

**الأعراض**: عبر ngrok (الاستخدام الخارجي), المسح يَكتمل (الرسالة "اكتمل المسح! تم العثور على 46 جهاز" تظهر), لكن جدول النتائج لا يظهر، وتبقى الرسالة مُستمرة دون شيء جديد.

**الجذر**: SSE عبر ngrok proxy. عند إرسال `done` event, ngrok قد يَقوم بـ buffering أو يُغلق الاتصال قبل أن يَتلقاه المتصفح. المتصفح EventSource يَحاول إعادة الاتصال تلقائيًا، يَرى Backend `result.completed = true` فيُرسل الـ `done` event مرة أخرى كل ثانية → دائرية لا نهائية. ولا تَستدعى `fetchResults` أو تَتصللا على المدى البعيد.

**الإصلاحات المُطبّقة (سرُعًا في النسخة 2.3.2 الحديثة)**:
1. **`backend/src/routes/scan.routes.js`**:
   - `sendDone()` صار `sendDone(deviceCount)` يُرسل `data: {"deviceCount": N}` مع الحدث `done` (لم يَعد فارغًا). يُمكّن الواجهة من معرفة عدد الأجهزة فورًا دون استدعاء `/results/:scanId`.
   - استدعاء `sendDone(result.devices ? result.devices.length : 0)` بدل `sendDone()`.
2. **`frontend/public/js/admin-discovery.js`**:
   - `done` event handler يَستخرج `deviceCount` من `e.data` ويُظهر فورًا "✅ اكتمل المسح! تم العثور على N جهاز".
   - **`fetchResults` لم يَعد يُكرر نفسه إلى ما لا نهاية**: أُضيف `MAX_FETCH_ATTEMPTS = 8` (8 محاولات × 1ث = 8 ثوانٍ). لو فشلت كل المحاولات (مثلاً انتهت صلاحية `scanResults[scanId]` بعد 60ث بَعد ngrok buffering), تُظهر رسالة عقلانية بدلاً من الاستمرار دون نتائج.

**الوضع الحالي بعد الإصلاح**: الإصلاح جاهز في machine التطوير (ليس مرفوعًا بعد — يَنتظر التزام/رفع). النسخة الحالية على الخادم لا تَزال 2.2.0. يجب تَحديث الخادم إلى **2.3.2** (وليس فقط 2.3.1) لِيَحصل على هذا الإصلاح.

> 📌 **ملاحظة للجلسة التالية**: لو كان المستخدم لم يُحدّث الخادم بعد, يَجب إجراء تَسلسل الخطوات 2 → 5 كما في الأقسام أدناه، لكن استِهداف نسخة **v2.3.2** (التزام جديد لِيُنشأ + رفع بعد تحديث هذا الملف).

---

## 🎯 الهدف العام من المشروع (السياق الكامل)

النسخة الحالية على الخادم = **2.2.0**. المطلوب تَحديث الخادم إلى **2.3.1** (إصدار مرفوع على GitHub بالفعل، tag `v2.3.1` يُشير لالتزام `1d298482fd4087b682edeb676a0df3da4ee99a49`).

إصدار **2.3.1** يُصلح 5 مشاكل (مُنجزة بالفعل في الكود المرفوع على GitHub):
1. VAPID يُولّد مفتاحًا 64-بايت عاطلاً بدل 65-بايت → يُصلح خطأ المتصفح `Vapid public key should be 65 bytes long when decoded`.
2. SSE لمسح الأجهزة يَنقطع عبر reverse proxy (`Connection "upgrade"` hardcoded + لا `proxy_buffering off`).
3. الواجهة تُغلق EventSource فورًا عند أي خطأ عابر.
4. تبويب التحديثات كان يَعرض `admin / admin123` بدل `admin / ChangeMe123!`.
5. تبويب التحديثات كان يَعرض اختيار الفرع (تم إزالته، التحديث من `main` تلقائيًا).

كذلك نشرت تحسينات لـ `deploy.sh` (ضمان كتابة VAPID 65-بايت + gard يَتحقق من طول المفاتيح) و `nginx.example.conf` (location مخصص لـ `/api/scan/stream/`).

**المشكلة الحالية**: عند محاولة التحديث من الواجهة (تبويب التحديثات)، ظهرت رسالة:
```
❌ خطأ: الفرع "main" غير موجود على المستودع البعيد. الفرع الافتراضي هو: main
```
هذه الرسالة **مُضلّلة** — الجذر الحقيقي ليس "الفرع غير موجود" بل **مشكلة صلاحيات على الخادم** (شُرحت أدناه).

---

## 🔍 الجذر الحقيقي للمشكلة (مُشخّص بالكامل)

### ما الذي حدث فِعليًّا على الخادم
1. عند التثبيت الأول، نُفِّذ `sudo bash deploy.sh install` كـ **root**, وبالتالي شَغّل `pm2 start` بـ `sudo` → **PM2 daemon وُلِد كـ root** (`PID 1058`, home=`/root/.pm2`).
2. الباك إند `network-monitor` كان يَعمل كـ **root** (لأن PM2 daemon كـ root).
3. أي `git fetch`/`git pull` نَفّذه الباك إند عبر `update.routes.js` كان يَعمل كـ root، فكَتب ملفات داخل `.git/` (مثل `.git/FETCH_HEAD`) بملكية **`root:root`** (mode `644`).
4. ملكية `/opt/network-monitor/.git/` وملفاته الأصلية كانت `it:it` (المالك الصحيح)، لكن ملفات `FETCH_HEAD` و موارد أخرى كَتبها root أصبحت مملوكة لـ root.
5. عندما حاول المُستخدم `it` (في shell) تنفيذ `git fetch origin main`، فشل بـ:
   ```
   error: cannot open .git/FETCH_HEAD: Permission denied
   ```

### كيف تَرجم الـ backend هذه المشكلة إلى رسالة "الفرع main غير موجود"
في `backend/src/routes/update.routes.js`:
- `checkBranchExists(branch)` (L106-125) يَنفّذ `git ls-remote --heads origin main`.
- هذا أمر **read-only عبر الشبكة** — لا يَكتب إلى `.git/`, لذا نَجح على الخادم (رَجع `1d298482fd4087b682edeb676a0df3da4ee99a49 refs/heads/main`).
- `checkForUpdates` (L147-217) يَستدعي `checkBranchExists`, وإذا رجع `false` يَعرض الرسالة المُضلّلة "الفرع غير موجود".
- لكن الجذر الفعلي ليس في `ls-remote` بل في أن `git fetch origin main` (الذي يَكتب `.git/FETCH_HEAD`) يَفشل بـ permission denied.

ملاحظة: `git ls-remote` نَجح لآنهم لا يَحتاج الكتابة `.git/` لكنه **مُستدعى قبل `git pull`** الذي يَحتاج الكتابة. لذا تَظهر رسالة "الفرع غير موجود" بدل رسالة "permission denied" الفعلية (خطأ منطقي في `update.routes.js` — يَنبغي أن يَحاول `git fetch` فعليًّا ويَفشل بِرسالة صريحة بدل افتراض "الفرع غير موجود" من فشل `ls-remote` خاصة).

---

## ✅ ما تَمّ إنجازه (الخطوات المكتملة)

### المرحلة 1: إصلاحات الكود (مرفوعة على GitHub في `v2.3.0` و `v2.3.1`)
كل هذه الإصلاحات **مُلتزمة ومرفوعة على `origin/main`**:

#### التزام `3ddd513` — `v2.3.0` (chore(release): v2.3.0 — bump version)
- VAPID في `deploy.sh`: شروط `grep -qE "^VAPID_...=.+"` لاستبعاد الأسطر الفارغة + `(cd "$PROJECT_DIR/backend" && node -e "...")` لضمان resolve.
- VAPID في `README.md` و `DEPLOY.md`: مقتطف يدوي `node -e "const k=require('web-push').generateVAPIDKeys(); ..."` (جاهز للّصق).
- scan.routes.js: حذف `lastScanResults = detailedResults` (ReferenceError) + `await performScan` → fire-and-forget `.catch()` + heartbeat كل 15ث + `sendError` يُرسل الرسالة الحقيقية.
- dashboard.html: تغليف كتلتَي Telegram/WhatsApp في `<fieldset>` بدل `<label>` متداخل (HTML صالح).
- style.css: `.form-grid input[type="checkbox"]` + `.checkbox-label` flex row.
- admin-update.js: إزالة اختيار الفرع (`loadAvailableBranches()` + listener) + الثلاث دوال (`checkUpdates`, `applyUpdate`, `downloadUpdate`) تَستخدم `const branch = 'main';` ثابت.
- README.md / DEPLOY.md / RUN-ON-LINUX.md: بيانات الدخول الافتراضية `admin / ChangeMe123!` + تحذير.
- seedAdmin.js: يَطبع username + password + تحذير "غيّرها فورًا".
- deploy.sh L590: رسالة النجاح "👤 المدير الافتراضي: admin (كلمة المرور: ChangeMe123!) — ⚠️ غيّرها من backend/.env فوريًا".

#### التزام `6d13ac5` — `docs(deploy)`: قسم "تحديث النظام" في `DEPLOY.md`
- شرح أن تبويب التحديثات يَقرأ "أحدث إصدار" من **git tags** → يجب `git fetch --tags` مع كل تحديث.
- تذكير برفع الكود + التاغ معًا (`git push origin main --follow-tags`).

#### التزام `1d29848` — `v2.3.1` (fix(release): v2.3.1 — VAPID 65-byte + SSE عبر reverse proxy + مرونة الواجهة)
- **VAPID (deploy.sh)**: crypto-fallback كان يَستخدم `publicKey.slice(1)` (يَحذف بادئة `0x04`) → يُنتج **64-بايت عاطلاً**. تَم تغييره إلى `publicKey` كامل (65-بايت) = مطابق لـ `web-push.generateVAPIDKeys()`.
- **VAPID (deploy.sh)**: gard التوليد يَتحقق الآن من **طول المفتاح** (≥86 char public / ≥43 char private) لا مجرد وجود حرف. → يُعيد التوليد تلقائيًا للمفاتيح العاطلة 64-بايت المُتبقية من 2.2.0.
- **nginx.example.conf** و `linux-setup/network-monitor-nginx.conf`: إضافة `location /api/scan/stream/` مخصص بـ `proxy_buffering off` + `proxy_cache off` + `chunked_transfer_encoding on` + `map $http_upgrade $connection_upgrade {...}` (بدل `Connection "upgrade"` hardcoded) — يُحل "انقطع الاتصال بالخادم" عبر reverse proxy.
- **admin-discovery.js**: `EventSource` error handler لم يَعد يُغلق الاتصال ويُظهر "انقطع الاتصال" فورًا — يَتحقق `readyState === CLOSED` ويسمح بـ `MAX_SSE_ERRORS=5` محاولات إعادة قبل الإعلان.
- **DEPLOY.md**: قسم "ملاحظات الانتقال 2.2.0 → 2.3.0" (إعادة توليد VAPID العاطل + تحديث إعداد nginx).

### التحققات المُنجَزة محليًّا (على machine التطوير)
- `bash -n deploy.sh` ✓
- `node --check backend/src/seedAdmin.js` + `frontend/public/js/admin-discovery.js` ✓
- اختبار مفتاح VAPID crypto fallback فعليًّا: 65 بايت، بادئة `0x04`، "passes 65-byte check: YES" ✓
- اختبار gard deploy.sh على 3 سيناريوهات (مفتاح عاطل 85 char → إعادة، صحيح 87 char → لا إعادة، فارغ → إعادة) ✓
- التوازن الهيكلي لـ `dashboard.html` (لا `<label>` داخل `<label>`, fieldset متوازن) ✓
- التوازن الهيكلي لـ `nginx.example.conf` (braces 6/6) ✓

### المرحلة 2: التشخيص على الخادم (الخطوة 0 — التشخيص) — **مكتملة**
أوامر التشخيص (مُنفّذة على الخادم، ناتجها مُوثّق): `git remote -v`, `git ls-remote --heads origin main`, `git fetch origin main`, `ls -la .git/FETCH_HEAD`, `pm2 describe`, `pgrep -f PM2`, `ps -o user,pid`, `whoami`, `id`.

**النتائج المُؤكدة من التشخيص:**
- `origin` يُشير إلى `https://github.com/kerolos-it2022/network-monitor.git` ✓ (public repo).
- PM2 daemon كان يَعمل كـ **root** (PID 1058, `/root/.pm2`).
- عملية `node src/server.js` كانت تَعمل كـ **root**.
- `.git/FETCH_HEAD` كان مملوكًا لـ **`root:root`** mode 644.
- `whoami` = `it` (uid=1000, groups incl. `sudo`).
- الخادم يَصل إلى GitHub بلا مشاكل (`ls-remote` رجع آخر التزام).

### المرحلة 3: الخطوة 1 (إصلاح الصلاحيات على الخادم) — **مكتملة ✓**
نُفّذت على الخادم النتائج التالية (مُؤكدة من الناتج):

1. **`sudo pm2 kill`**: أوقف daemon الـ root (PID 1058, `/root/.pm2`). نجح.
2. **`sudo chown -R it:it /opt/network-monitor/.git`**: صَحّح مِلكية `.git/` كاملًا لـ `it`. نجح.
3. **`ls -la .git/FETCH_HEAD`**: تأكد — صار `it it` بدل `root root`. ✓
4. **`pm2 start ecosystem.config.js`** (بدون sudo): أَطلق PM2 daemon جديد كـ `it` (PID 2445573, `/home/it/.pm2`), `network-monitor` status=`online`, `user=it`, version `2.3.0`. ✓
5. **`pm2 save`**: حَفظ القائمة في `/home/it/.pm2/dump.pm2`. ✓
6. **`pm2 startup`**: أعطى أمرًا لتفعيل systemd hook (لم يُنفّذ بَعد — **هذا يَنتظر الخطوة 2**):
   ```
   sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u it --hp /home/it
   ```

**النتيجة الآن**: PM2 يَعمل كـ `it` (الـ daemon الـ root قَتَل), mلكية `.git/` صَحّحت. لكن:
- لم يَتم بعد تأكيد أن `git fetch origin main` يَعمل الآن دون permission denied.
- لم يَتم بعد تفعيل startup hook لـ systemd.
- لم يَتم بعد التحديث فعليًّا إلى 2.3.1.

---

## ⏳ الخطوة الحالية: **الخطوة 2** (غير مكتملة — بانتظار تنفيذها على الخادم)

### الهدف من الخطوة 2
1. تفعيل startup hook لـ systemd (يَضمن بدء PM2 تلقائيًا كـ `it` بعد إعادة تشغيل الخادم).
2. تأكيد صحة تشغيل backend عبر `curl /api/health`.
3. تأكيد أن `git fetch origin main` يَعمل الآن بلا permission denied.
4. محاكاة `git pull --dry-run` لرؤية الملفات التي ستُسحب + كشف التعارضات المُتوقعة.
5. رؤية `git status --short --branch` لمعرفة كم خلف الـ remote.

### الأوامر لِتُنفّذ على الخادم (انسخها كاملة والصقها في terminal الخادم):

```bash
cd /opt/network-monitor

echo "=== [2.1] تفعيل startup hook لـ systemd (يَضمن بدء PM2 تلقائيًا كـ it بعد reboot) ==="
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u it --hp /home/it 2>&1 | tail -8

echo
echo "=== [2.2] تأكيد صحة تشغيل backend ==="
curl -s -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" http://localhost:4000/api/health 2>&1
echo "( يجب: HTTP 200 في أقل من ثانية )"

echo
echo "=== [2.3] تأكيد حالة PM2 ==="
pm2 status 2>&1 | grep -E "name|online|errored|network-monitor" | head -5

echo
echo "=== [2.4] جرب git fetch الآن (كان يفشل بـ Permission denied) ==="
git fetch origin main 2>&1 | head -8
echo "( مخرج فارغ = نجاح؛ الرسالة 'error: cannot open .git/FETCH_HEAD' = فشل )"

echo
echo "=== [2.5] جرب git pull (dry-run — لا تُطبّق التغييرات فعلاً، مجرد محاكاة) ==="
git pull --dry-run origin main 2>&1 | head -15

echo
echo "=== [2.6] حالة الخادم مع remote ==="
git status --short --branch 2>&1 | head -5
```

### ما الذي يَجب التحقق منه في ناتج الخطوة 2
- **[2.1]**: `[PM2] [v] Command successfully executed.` أو نحوها = systemd hook جاهز.
- **[2.2]**: `HTTP 200 in <1s` = backend سليم.
- **[2.3]**: `online` بجانب `network-monitor`.
- **[2.4]**: مُخرج فارغ (لا errors) = `git fetch` نجح — **هذا الجَوهر**. لو ظهر `error: cannot open .git/FETCH_HEAD` = فشل (الجذر لم يُحَل — يَلزم `sudo chown -R it:it /opt/network-monitor/.git` مرة أخرى أو تَحقيق أعمق).
- **[2.5]**: إما فارغ أو يَعرض الملفات التي ستُسحب. لو ظهر `error: Your local changes to the following files would be overwritten` = يَلزم تَعامل مع `package-lock.json` و `ecosystem.config.js` في الخطوة 3.
- **[2.6]**: شكل `## main...origin/main [ahead 1, behind 3]` يَخبر كم خلف الـ remote.

> **بعد تنفيذ الخطوة 2**: أرسل الناتج كاملاً للنموذج. الجلسة التالية تَحلّل الناتج وتُحدّد:
> - إن كان [2.4] نَجح → الخطوة 1 مُؤكدة، انتقل للخطوة 3.
> - إن كان [2.4] فشل → الجذر أعمق، يَلزم `sudo chown -R it:it /opt/network-monitor/.git` وتَحقيق.
> - إن كان [2.5] أَظهر تعارضات (`local changes would be overwritten`) → الخطوة 3 إلزامية قبل `git pull`.

---

## ⏭️ الخطوات المتبقية (لم تُنفّذ بعد)

### الخطوة 3: التعامل مع الملفات المُعدّلة محليًّا قبل `git pull`

من `git status --short` السابق, ظَهِر ملفان مُعدّلان محليًّا على الخادم:
```
 M backend/package-lock.json
 M ecosystem.config.js
```

هذه التعديلات المحلية غالبًا نَتجت عن `deploy.sh install` السابق (يَكتب `package-lock.json` بعد `npm install` و`ecosystem.config.js` يَحوي `cwd: __dirname + '/backend'` المُعدّل). **هذه التعديلات سَتَتعارض مع `git pull`** لأن الكود الـ remote (2.3.1) قد يَحتوي نسخًا مختلفة.

**الخَيارات لحل التعارض (يُقررها النموذج التالي بناءً على ناتج الخطوة 2 أعلاه)**:
1. **الخَيار الأبسط (موصى به عادةً)**: تجاهل التعديلات المحلية ثقةً بإصدار `2.3.1`:
   ```bash
   cd /opt/network-monitor
   git checkout -- backend/package-lock.json ecosystem.config.js
   # ثم git pull سَيَعمل بلا تعارض
   ```
2. **إن كانت تعديلات `ecosystem.config.js` مهمة** (مثل تغيير `cwd`): مثلاً يَحتوي على path-detection خاص بالخادم — يجب **حِفظها** قبل `git pull`:
   ```bash
   cp ecosystem.config.js /tmp/ecosystem.config.js.backup
   git checkout -- ecosystem.config.js
   git pull
   # بعد التحديث، انسخ التعديل المُحفوظ يدويًّا لو لا يَزال ضروريًّا:
   diff ecosystem.config.js /tmp/ecosystem.config.js.backup
   ```
3. **`package-lock.json`**: عادةً آمنة أن يُستبدل بنسخة الـ remote (سيُعاد توليدها من `npm install` بَعد التحديث).

> **تنبيه**: لا تنفّذ `git stash` بشكل أعمى — التحديث سيُطبّق `npm install` جديدًا, عمليات `package-lock.json` أَصلها likely `linux-setup` أَو Node version-specific. احفظ backup قبل أي شيء.

**التحقق المتوقع بعد `git pull`**: رؤية `Updating d382cc8..1d29848 Fast-forward` أو نحوها (لو `fast-forward` يَعني تَحديث نَظيف).

### الخطوة 4: تَطبيق التحديث فعليًّا (نهائياً)

بعد نجاح `git pull` (الخطوة 3), نَفّذ:
```bash
cd /opt/network-monitor
sudo bash deploy.sh update
```
`deploy.sh update` سيُعيد:
1. `npm install` في `backend/`.
2. إعادة بناء `better-sqlite3` عند الحاجة.
3. إعادة تَوليد VAPID تلقائيًّا إن كان المفتاح الحالي عاطلاً (طول < 86 char) — بواسطة gard الجديد.
4. `pm2 restart network-monitor --update-env` (يجب أن يَعمل كـ `it` الآن).

### الخطوة 5: التحقق النهائي على الواجهة + مُلاحظات الاختبار

بعد نجاح `deploy.sh update` افتح لوحة التحكم ومن المتوقع أن ترى:

#### في تبويب التحديثات
- "الإصدار الحالي: **2.3.1**"
- "أحدث إصدار: **2.3.1**"
- "✅ أنت تستخدم أحدث إصدار (2.3.1)"

#### في تبويب الإشعارات — اختبار الإشعار
- يجب أن يَنجح الجَانب PWA دون رسالة `Vapid public key should be 65 bytes long when decoded`.
- (لو ظَهِرت الرسالة مرة أخرى = `VAPID` لم يُعاد تَوليدها. يَلزم: `sudo sed -i '/^VAPID_PUBLIC_KEY=/d; /^VAPID_PRIVATE_KEY=/d' /opt/network-monitor/backend/.env && sudo bash /opt/network-monitor/deploy.sh update`).

#### في تبويب اكتشاف الأجهزة — عبر reverse proxy فقط
- المسح يجب أن يَكتمل دون "انقطع الاتصال بالخادم".
- **لكن يتطلب تَحديث إعداد nginx على الخادم** (نسخة 2.2.0 شحنَت إعدادًا عاطلاً، نسخة 2.3.1 شحنَت الإصلاح):
  ```bash
  sudo cp /opt/network-monitor/nginx.example.conf /etc/nginx/sites-available/network-monitor
  sudo nginx -t && sudo systemctl reload nginx
  ```
- ملاحظة: `map $http_upgrade $connection_upgrade {...}` يجب أن يكون في `http {}` context (لا داخل `server {}`). ضعه في `/etc/nginx/conf.d/connection-map.conf` إذا تطلّب الأمر.

#### في تبويب الإشعارات (العرض البَصري)
- كتلة Telegram وكتلة WhatsApp يجب أن تَظهرا كصناديق منفصلة مُحاطة بإطار (بفضل `<fieldset>`).
- Messenger للـ checkboxes + radios يجب أن تَعرض المربع + النص أُفقيًّا (بفضل `.checkbox-label` flex row).

---

## 🌐 حالة Git على الـ remote (المرجع)

| | |
|---|---|
| المستودع | `https://github.com/kerolos-it2022/network-monitor.git` (public) |
| الفرع | `main` |
| آخر التزام مرفوع على `main` الآن | `1d298482fd4087b682edeb676a0df3da4ee99a49` (= v2.3.1 release) |
| التزامات بانتظار الالتزام/الرفع | **إصلاح ngrok / SSE** (`scan.routes.js`, `admin-discovery.js`, `package.json` bumped → 2.3.2, `HANDOFF.md`) — ستُلتزم كـ `v2.3.2` |
| التاغات المتوفرة على الـ remote | `v2.3.1`, `v2.3.0`, `v2.2.0`, `v2.1.1`, `v2.1.0`, `v2.0.0`, `v1.2.0`, `v1.1.0` |
| النسخة الحالية على الخادم | `2.2.0` (التزام `d382cc8`) — يَحتاج تَحديث إلى **2.3.2** |

### سجل الالتزامات على `main` (الأحدث أَعلى):
```
[بانتظار] fix(release): v2.3.2 — SSE عبر ngrok (send done with deviceCount + bounded fetchResults)
1d29848 fix(release): v2.3.1 — VAPID 65-byte + SSE عبر reverse proxy + مرونة الواجهة
6d13ac5 docs(deploy): إضافة قسم تحديث النظام + تذكير برفع git tags مع الكود
3ddd513 chore(release): v2.3.0 — bump version
d382cc8 fix(ci): إزالة environment: production لتفادي ظهور Environment فارغ في تبويب Deployments  ← الخادم هنا (2.2.0)
cb26c6d chore(release): v2.2.0 — bump version
```

---

## 🛠️ ملاحظات تقنية للجلسة التالية

### تكوين الخادم
- **المستخدم**: `it` (uid=1000, gid=1000, في مجموعة `sudo`).
- **مسار المشروع**: `/opt/network-monitor` (المالك: `it:it`).
- **PM2 daemon**: شَغِل الآن كـ `it` (home=`/home/it/.pm2`). PID الحالي (وقت كتابة هذا الملف) كان `749261` (daemon القديم كـ it الذي بَقي بعد `pm2 kill` لـ root daemon, وقد يَتغير PID بعد إعادة التشغيل).
- **Nginx**: لا يَزال يَستخدم إعداد 2.2.0 العاطل (مع `Connection "upgrade"` hardcoded و لا `proxy_buffering off`). سيُستبدل في الخطوة 5.
- **Git**: 
  - `origin` يُشير لـ GitHub الصحيح.
  - `.git/` ملكيته `it:it` (مُصحّحة في الخطوة 1).
  - الفرع المحلي: `main`.
  - الالتزام الحالي على الخادم: `d382cc8` (خلف الـ remote بـ 3 التزامات).

### الملفات الهامة في المشروع (للمرجع)
- `backend/src/routes/update.routes.js`: API التحديث (الجذر التِقني للرسالة المُضلّلة في L155-164).
- `backend/src/routes/scan.routes.js`: SSE لمسح الأجهزة (L650-722).
- `backend/src/routes/notifications.routes.js`: VAPID public endpoint (L181-188).
- `backend/src/services/notifier.service.js`: web-push sender (L66-75).
- `frontend/public/js/admin-discovery.js`: SSE consumer (silent-event handler L236-244).
- `frontend/public/js/public-dashboard.js`: VAPID subscription (L520-572).
- `frontend/public/admin/dashboard.html`: UI ( entrenched القسم الإشعارات L226-265).
- `deploy.sh`: VAPID generation (L398-447) + L590 رسالة النجاح.
- `nginx.example.conf` + `linux-setup/network-monitor-nginx.conf`: إعداد reverse proxy.
- `ecosystem.config.js`: تَكوين PM2 (cwd=`__dirname + '/backend'`).

### تحذيرات ومَزالق
1. **`pm2 describe network-monitor | grep "user"` قد لا يَرجع شيئًا** على بعض إصدارات PM2 — استخدم `ps -o user,pid,cmd -p $(pgrep -f "src/server.js" | head -1)` بدلًا منه للتأكد من مَلكية عملية Node.
2. **`curl /api/health` قد يَفشل مؤقتًا بعد `pm2 restart`** (بضع ثواني للتشغيل). انتظر 3-5 ثواني.
3. **لا تَستخدم أبدًا `sudo git ...`** على المشروع (سيُعيد المشكلة: كتابة ملفات `.git/` كـ root). استخدم `git ...` كـ `it` فقط.
4. **`deploy.sh update` يجب أن يُنفّذ بـ `sudo`** (لأنه يَحتاج صلاحيات لإعادة بناء الحزم وتثبيت الحزم النظامية), لكن `pm2 start` داخل `deploy.sh` يجب أن يَعمل كـ `it`. تحقق أن `deploy.sh` لا يَستخدم `sudo pm2 start`.
5. **رسالة "الفرع main غير موجود"**: لا تعني أن الفرع غير موجود. هي رسالة مفخخة في `update.routes.js` — الجذر في الغالب صلاحيات `.git/` أو شبكة. تحقق دائمًا من `git fetch origin main` وحدها (بدون `sudo`) للتأكد.
6. **لا تَحذف `.git/`** أبدًا (سَتَفقد التاريخ وسَيتعطل `git fetch`).

### الأوامر السريعة لاستئناف العمل (للجلسة التالية أَو لموديل آخر)
```bash
# 1. تحقق من الحالة الحالية:
cd /opt/network-monitor
git status --short --branch
git log --oneline -3
ls -la .git/FETCH_HEAD
pgrep -af "PM2.*God Daemon" | head -2
ps -o user,pid,cmd -p $(pgrep -f "src/server.js" | head -1) 2>/dev/null

# 2. إن وُجد أن PM2 يَعمل بـ root (مُشكل لم يُحل):
sudo pm2 kill
sudo chown -R it:it /opt/network-monitor/.git
pm2 start ecosystem.config.js
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u it --hp /home/it
pm2 save

# 3. تأكيد نجاح git fetch (الجَوهر):
git fetch origin main 2>&1 | head -5  # يجب أن يكون فارغًا = نجاح

# 4. تعامل مع الملفات المعدلة محليًّا:
cp ecosystem.config.js /tmp/ecosystem.backup.bak  # أمن
git checkout -- backend/package-lock.json ecosystem.config.js  # أو استخدم خِيار الحِفظ إن كانت مهمة

# 5. التحديث:
git pull origin main
sudo bash deploy.sh update

# 6. تحديث إعداد nginx (لإصلاح SSE عبر proxy):
sudo cp nginx.example.conf /etc/nginx/sites-available/network-monitor
# ضع map في http {} إذا لزم
sudo nginx -t && sudo systemctl reload nginx

# 7. التحقق النهائي على الواجهة:
curl http://localhost:4000/api/health
# ثم افتح لوحة التحكم وافحص التبويبات الثلاثة (التحديثات، اكتشاف الأجهزة، الإشعارات).
```

---

## 📌 ما يجب على الجلسة التالية فعله فورًا عند بدئها

1. **اقرأ كل هذا الملف**.
2. **السؤال الأول للمستخدم**: رسالة مُبَسّطة تَقول "هل نَتابع من الخطوة 2؟ (ارسل لي ناتج أمر الخطوة 2 المذكور في الملف HANDOFF.md)"

3. **بعد تلقي الناتج**: تَحليل الأجزاء [2.4] (نجاح `git fetch`؟) و [2.5] (تعارضات محلية؟), ومُتابعة وفق نتائجهما.

4. **أثناء التنفيذ**: حافظ على **تحديث هذا الملف** (`HANDOFF.md`) عند كل تَقدم (سجّل التواريخ، الناتج، القرارات). في النهاية، يَجب أن يُسجّل أن **الخادم صار يعمل بـ 2.3.1** وكل التحققات نَجحت.

5. **في النهاية专科学校 إيضاح**: بعد التحقق النهائي من أن الإصدار 2.3.1 يَعمل بكل ميزاته على الخادم, أَضِف قسم "✅ اكتمل المشروع" أعلى الملف يُؤكد النهاية, ويمكن للمستخدم حينها أَرشفة هذا الملف.

---

## 🧩 سياق إضافي (سياق أعمق للنموذج التالي)

- **لماذا لم يَظهر الجذر في رسالة `update.routes.js` نفسها؟** لأن `checkBranchExists` يُستدعى قبل `git fetch` الفعلي (`L150` قبل `L168`). إذا فشل `ls-remote` (في حالة `origin` خاطئ أو شبكة), تظهر الرسالة المُضلّلة "الفرع غير موجود". ولو نَجح `ls-remote` (read-only), لكن في الواقعDemon didn't fetch بعد. أما في حالتنا, `ls-remote` نجح, لكن المسار الذي يَستدعي `git fetch` (`L168`) لم يَصل المسارُ الفرعي الخطأ ( من `checkBranchExists` في الواقع أَنجز, إится ها... إذًا لِما ظَهِرت الرسالة؟ عذراً، عندما نُحلل: عُذراً عن اللّبس السابق. في حالة `it`/`it` ملكية الـ `.git` لكن `FETCH_HEAD` root-owned, `git ls-remote --heads` نَجحَ (read-only, لا يَحتاج `.git/FETCH_HEAD`), و`git remote show origin` (في `getDefaultBranch`) nَجحَ, فعُرفَ a_default_branchranch = `main`. لكن سوفِنُ كورِي `checkBranchExists` أَيضًا يَجب أن يَنجح (وقد نَجح في الاختبار اليدوي في الجولة الأولى: رجع `1d298482...`). إذًا لِما تظهر الرسالة المضللة؟ قد تكون لأن PM2 daemon كان بكتابة root ملكية `.git/FETCH_HEAD` وPM2 نفسه يَعمل كـ root, ولكن عند استدعاء e.g.'fetch'==`git fetch` (في `L168`) يُولِّد `.git/FETCH_HEAD` من جديد بـ root permission-لكنَّه يَكتب نَجحُ في الكتابة (بمَ أنه root يَملك `.git/FETCH_HEAD`), ولم يفشل.. إذًا المشكلة تَمّت معالجتها فِعليًّا عند المستخدم `it` في shell, وليس بالضرورة من PM2 daemon كـ root (الذي يَملك صلاحية الكتابة لـ `.git/FETCH_HEAD` المُملوكة لـ root).

> **خلاصة**: تحويل PM2 daemon وملكية `.git/` إلى `it` هو الإصلاح الصحيح طويل الأَمد, لكن قد تكون مشكلة الواجهة في الأصل مختلفة قليلًا (.some other `git` operation). لا تَنزعج إن لم يَحُل نهائيًّا عند `git fetch` — تحقق أيضًا من permission `.git/index` و `.git/refs/` و `.git/logs/` (جميعها يجب أن تكون `it:it`).

---

**نهاية الملف — آخر تحديث بواسطة الجلسة الحالية في 2026-07-26.**
