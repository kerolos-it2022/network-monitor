# 📋 HANDOFF.md — سجل نقل الحالة بين الجلسات

> **الغرض**: هذا الملف يَوثّق كل ما تَمّ، والحالة الحالية، والخطوات المتبقية.
> ===> **أي نموذج ذكاء اصطناعي آخر أو جلسة جديدة يَجب أن يَبدأ بِقراءة هذا الملف بالكامل قبل أي شيء.**
>
> **تاريخ آخر تحديث**: 2026-07-27 (الجلسة الحالية — **رفع v2.4.0 إلى GitHub: إصلاحات جذرية لتفادي الأوامر اليدوية**)
> **السياق**: نِظام مُراقبة الشبكة (Network Monitor) — مستودع GitHub `kerolos-it2022/network-monitor`
> **المستخدم**: `it` (uid=1000) على خادم Linux (Ubuntu/Debian) على `/opt/network-monitor`

---

## ✅ اكتمل المشروع (2026-07-27)

> 🎉 **الخادم يَعمل بـ v2.3.2 فِعليًّا + كافة الإصلاحات الجذرية لِـ v2.4.0 مُلتزمة ومرفوعة على `origin/main` + تاج `v2.4.0`.** الهدف من v2.4.0: **أي مُستخدم جديد يكتفي بـ `deploy.sh install` دون أي أمر يدوي** (لا صلاحيات `.git/`، لا daemon root عابر، لا فشل `nginx -t`، لا رسالة "الفرع غير موجود" المُضلِّلة، لا فَقد التَاجات).

### 🆕 ما الذي أَضافته v2.4.0 (2026-07-27)

| # | الإصلاح الجذري | الملف | الخطوط (قبل) |
|---|---|---|---|
| 1 | `git fetch --tags --force origin <branch>` بدل `git fetch origin <branch>` — يَجلب التَاجات صراحةً لِتفادي "أحدث إصدار: <قديم>" رغم التحديث الفِعلي | `backend/src/routes/update.routes.js` | L168, L223 |
| 2 | `classifyGitError()` + رسالة عربية واضحة بدل "الفرع main غير موجود" المُضلِّلة. يُميّز: صلاحيات `.git/` / شبكة / مصادقة / غير مُصنّف | `backend/src/routes/update.routes.js` | L155-164 (القَديم) → كتلة `catch` الجديدة |
| 3 | `deploy.sh` يُصدِّر `PM2_HOME` صراحةً لكل استدعاء `pm2` (`env PM2_HOME="$PM2_HOME" pm2 ...`) + `APP_HOME` ديناميكي بدل `--hp "/root"` الـ hardcoded | `deploy.sh` | رأس script + L560-570 + L624 + L645-670 |
| 4 | فَصل nginx لِملفين: `nginx.example.conf` (server block فقط) + `nginx.connection-map.conf` (map فقط — سياق `http{}` الصّحيح). يَتفادى فشل `nginx -t` عند النَّسخ المباشر | `nginx.example.conf` (مُعاد كتابته) + `nginx.connection-map.conf` (جديد) + `linux-setup/network-monitor-nginx.conf` (مُعاد) | كامل الملف |

#### تفاصيل إضافية
- **`backend/package.json`**: `"version"` bumped من `2.3.2` إلى `2.4.0`.
- **`DEPLOY.md`** + **`RUN-ON-LINUX.md`**: تَعليمات النَّسخ حُدِّثت لِتُذكِّر بِنسخ **ملفين** (server + map) بدل واحد.
- **لا تَغيير في منطق الواجهة الأمامية**: `MAX_FETCH_ATTEMPTS`, `MAX_SSE_ERRORS`, `deviceCount` في `done` event، VAPID gard (≥86 char) — كلها بَقِيَت كما هي في v2.3.2 (مَحفوظة مُسبقًا).

### الحالة النهائية المُؤكَّدة (التَحقق بصِمَة تَاريخية 2026-07-27)

| العنصر | القيمة المُؤكدة | التَحقق |
|---|---|---|
| إصدار `backend/package.json` (machine التطوير) | `2.4.0` (bumped) | `Read` مباشر ✓ |
| `node --check backend/src/routes/update.routes.js` | OK (syntax سَليم بعد إصلاحات [1]+[2]) | `node --check` ✓ |
| `bash -n deploy.sh` | OK (syntax سَليم بعد إصلاح [3]) | `bash -n` ✓ |
| تَوازن `{`/`}` في nginx configs | `nginx.example.conf` 4/4، `nginx.connection-map.conf` 6/6 (4 في comments)، `linux-setup/...` 5/5 — كلها متوازنة | `tr -cd` ✓ |
| HEAD على `origin/main` (قبل التزام v2.4.0) | `4785cc9` (= v2.3.2) | `git rev-parse` ✓ |
| Working tree (machine التطوير) قبل التزام v2.4.0 | `nginx.example.conf`(+), `nginx.connection-map.conf`(? new), `linux-setup/network-monitor-nginx.conf`(M), `deploy.sh`(M), `backend/package.json`(M), `backend/src/routes/update.routes.js`(M), `DEPLOY.md`(M), `RUN-ON-LINUX.md`(M), `HANDOFF.md`(M) — كلها إصلاحات v2.4.0 | `git status` ✓ |

> 💡 تَفاصيل الخادم (Ubuntu) لو أَراد المُستخدم تَطبيق v2.4.0: بَقِي على 2.3.2 healthy. بعد رفع v2.4.0 يَكفي الدخول لِتبويب "التحديثات" في الواجهة والضغط "تَطبيق التحديث" — الآن بعد إصلاح [1] سَيَجلب التَاجات تلقائيًّا، وبعد [2] ستُظهر رسالة واضحة إن وُجدت مَشكلة بدل الرسالة المُضلِّلة. لا أَوامر يدوية مطلوبة للمستخدم الجديد.

---

## 🔬 تَفاصيل الإصلاحات الجذرية لمَن يَريد الفَهم التِقني

### [1] جلب التَاجات صراحةً (`--tags --force`)
**المَشكلة**: `getLatestVersionFromTags()` في `update.routes.js` يَقرأ `git tag -l "v*" --sort=-v:refname` محليًّا فقط. لو لم يَصل تاج `v2.4.0` محليًّا (3 سيناريوهات: `remote.origin.tagOpt=--no-tags`، التَاج خفيفٌ lightweight ومرفوع منفصلًا، صلاحيات `.git/` مكسورة) → الواجهة ستَعرض "أحدث إصدار: 2.3.1" + رسالة "تَحديث متاح" **خاطئة** رغم التحديث الفعلي.

**الإصلاح**: استبدال `git fetch origin ${branch}` بـ `git fetch --tags --force origin ${branch}` في:
- `checkForUpdates` (كتلة `git fetch` قبل `getLatestVersionFromTags`).
- `performUpdate` (داخل مصفوفة `steps`).

**لماذا `--force` آمن؟** الـ remote هو المصدر الأصلي للتَاجات؛ `--force` يُحرّك تاجًا محليًّا متقدمًا عن الـ remote بِنفس الاسم (مَثلاً أَعيد تَوسيم release القديم). في كلتا الحالتين يُصبح مُطابقًا للـ remote.

### [2] رسالة خطأ صريحة بدل "الفرع main غير موجود"
**المَشكلة**: في `checkForUpdates`، `checkBranchExists` يُستدعى **قبل** `git fetch`. `ls-remote` نَجح (read-only، لا يَكتب `.git/`)، لكن `git fetch` لاحقًا فَشِل بـ `Permission denied`. الكود القَديم يَلتقط الفَشل في `catch` ويُعيد `error.message` الخام — والواجهة تَخفي ذلك وتُظهر الرسالة المُضلِّلة العتيقة مخزنة في `changelog`.

**الإصلاح**: 
- تَقديم `git fetch` فِعليًّا قبل الرسالة المُضلِّلة، بحيث لو فَشِل، نَلتقط رسالة git الأصلية ونُمررها لِـ `classifyGitError()`.
- `classifyGitError()` يُصنّف الإِرسال إلى: `permissions` (`.git/` ملكية) / `network` (DNS/host) / `auth` (token) / `unknown` — ويُعيد رسالة عربية + `hint` (تَلميح إجرائي).
- الردّ النموذجي النموذجي النموذجي النهائي يحوي `errorCategory` + `hint` + `rawError` (لِلتشخيص التَفصيلي إن لَزِم).

### [3] تَثبيت `PM2_HOME` قبل كل استدعاء `pm2`
**المَشكلة**: `deploy.sh` يُشَغّل بـ `sudo` (root). لو لم يُحدد `PM2_HOME`، فأي `pm2 restart/start/delete/save` يَستخدم **daemon root** (`/root/.pm2`) بدل daemon المستخدم الفِعلي (`/home/it/.pm2`) → يُولِّد daemon root عابرًا، و`pm2 restart` يَضرب عملية في daemon خاطئ، ويُنفَّذ كـ root (يَكسر ملكية `.git/` كل مرة otra vez).

**الإصلاح**:
- إِضافة في رأس `deploy.sh`:
  ```bash
  if [[ "$APP_USER" == "root" ]]; then APP_HOME="/root"; else APP_HOME="/home/${APP_USER}"; fi
  export PM2_HOME="${PM2_HOME:-${APP_HOME}/.pm2}"
  ```
- كل استدعاء `pm2` يُغلَّف بـ `env PM2_HOME="$PM2_HOME" pm2 ...` (start, restart, save, delete, describe, logs, stop).
- `pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME"` بدل `--hp "/root"` hardcoded — يُطابق home المستخدم الفِعلي.

> السلوك التاريخي مَحفوظ: `APP_USER=root` (افتراضي) → `APP_HOME=/root` → `PM2_HOME=/root/.pm2` (كما كان). لا تَكسر للإِصدارات القَديمة.

### [4] فصل nginx لِملفين
**المَشكلة**: `nginx.example.conf` v2.3.x كان يَحوي `map {}` + `server {}` في ملف واحد مع comment يُنَبّه "ضَع map في http{}"، لكن المُستخدم الذي نَسخه مباشرةً إلى `sites-available/` (الذي يُضمَّن داخل `http{}` عبر `sites-enabled/`) وَجَد أن ما يَنجح على Debian/Ubuntu قد يَفشل على إِصدارات nginx أخرى، ولو نَسخه إلى `conf.d/` فالكتلة `server{}` داخله تَفشل.

**الإصلاح**: فصل المسؤولية إلى ملفين (كلٌّ في سياقه الصّحيح):
- `nginx.example.conf` → **server block فقط** → `/etc/nginx/sites-available/network-monitor`.
- `nginx.connection-map.conf` (جديد) → **map فقط** → `/etc/nginx/conf.d/connection-map.conf` (سياق `http{}` الصّحيح ضَروري لِتَعريف `$connection_upgrade`).
- `linux-setup/network-monitor-nginx.conf` أُعيد كتابته بنفس البنية (server block فقط + إشارة إلى ملف map المنفصل).

**التَكامل**: `nginx.example.conf` يَستعمل `proxy_set_header Connection $connection_upgrade` — الذي يَتطلب `map` مُعرّفًا في `http{}`. بدون `connection-map.conf`، `nginx -t` يَفشل بِـ "unknown variable $connection_upgrade". لذا المُستخدم يَنسخ **ملفين**.

---

## ⚠️ تنبيهات للمُستقبل

1. **`PM2_HOME` قد يُلغي daemon root نشطًا قَبلًا**: لو كان أحد قَد شَغّل `sudo pm2 ...` يدويًّا وأنشأ daemon root فِعليًّا (نشطًا)، فإن `env PM2_HOME=/home/it/.pm2 pm2 restart` يَستهدف daemon it فقط — daemon root يَبقى معطّلًا لكنه مَوجود. لِتَنظيفه: `sudo pm2 kill` (يَقتل daemon root) ثم يَستقر daemon it. لا حاجة لِذلك في العادة (daemon it حيّ).
2. **تَحقق `_startup hook_` بعد reboot**: `pm2-it.service` (systemd) `enabled` حاليًّا، `inactive` (daemon it الحالي يُدير). بعد أول `reboot` يدوي على الخادم، تَحقق: `pm2 status` يَجب أن يُظهر `network-monitor online as it`. لو فَشل، تَحقق من `/etc/systemd/system/pm2-it.service` و `journalctl -u pm2-it`.
3. **التَرتيب وقائي لِمستخدم جديد**: بَعد `git clone` على خادم جديد، شَغّل:
   ```bash
   sudo APP_USER=it bash deploy.sh install    # يَستهدف daemon /home/it/.pm2 تلقائيًّا
   ```
   لا حاجة لأي `sudo chown -R it:it /opt/network-monitor/.git` بعد الآن (إصلاح [3] يَمنع كتابة root في `.git/`).
4. **Cleanup اختياري على الخادم الحالي** (لا يَؤثر على الوظائف): `/etc/nginx/conf.d/network-monitor.conf` القَديم (placeholder `monitor.yourcompany.com` — عاطِل) و `/etc/nginx/sites-available/network-monitor.bak.*` — يمكن نَقله/حذفه. اقرأ قسم cleanup في سِجل الإِصدارات القَديم إن احتجت ذلك.

---

## 🌐 حالة Git على الـ remote (المرجع)

| | |
|---|---|
| المستودع | `https://github.com/kerolos-it2022/network-monitor.git` (public) |
| الفرع | `main` |
| التزامات v2.4.0 | `ea24f52` — `git fetch --tags --force` + `classifyGitError` + `PM2_HOME` + nginx split + bump 2.4.0 + DEPLOY/RUN-ON-LINUX + HANDOFF |
| التَاجات المتوفرة على الـ remote بعد الرفع | `v2.4.0`, `v2.3.2`, `v2.3.1`, `v2.3.0`, `v2.2.0`, `v2.1.1`, `v2.1.0`, `v2.0.0`, `v1.2.0`, `v1.1.0` |
| النسخة الحالية على الخادم | `2.3.2` (التزام `4785cc9`) → **يمكن تَحديثها إلى 2.4.0 عبر تبويب التحديثات (لا أَوامر يدوية بَعد الإِصلاحات الجذرية)** |

### سجل الالتزامات على `main` (الأحدث أَعلى):
```
ea24f52  fix(release): v2.4.0 — git fetch --tags + classifyGitError + PM2_HOME + nginx split     ← HEAD على origin/main (مرفوع بالفعل، تاج v2.4.0)
4785cc9  fix(release): v2.3.2 — SSE عبر ngrok (sendDone with deviceCount + bounded fetchResults)
1d29848  fix(release): v2.3.1 — VAPID 65-byte + SSE عبر reverse proxy + مرونة الواجهة
6d13ac5  docs(deploy): إضافة قسم تحديث النظام + تذكير برفع git tags مع الكود
3ddd513  chore(release): v2.3.0 — bump version
d382cc8  fix(ci): إزالة environment: production لتفادي ظهور Environment فارغ في تبويب Deployments
```

> **رقم الالتزام الفِعلي لِـ v2.4.0** = `ea24f52` (مُؤكَّد بَعد `git push`: `4785cc9..ea24f52 main -> main` + `[new tag] v2.4.0 -> v2.4.0`). ✅ مَرفوع فِعليًّا إلى `origin/main` + `v2.4.0` tag على GitHub.

---

## 🛠️ ملاحظات تقنية للجلسة التالية

### تكوين الخادم
- **المستخدم**: `it` (uid=1000, gid=1000, في مجموعة `sudo`).
- **مسار المشروع**: `/opt/network-monitor` (المالك: `it:it`).
- **PM2 daemon**: شَغّال كـ `it` (home=`/home/it/.pm2`). `network-monitor online` cluster_mode، node 20.20.2.
- **Nginx**: مُحَدَّث يدويًّا على الخادم (server block في `sites-available/` + map في `conf.d/connection-map.conf`) — مطابق لِبنية v2.4.0 الجديدة.
- **SSE عبر ngrok**: يعمل (`event: start / data: بدء المسح... / event: line × N`).

### الملفات الهامة في المشروع (للمرجع)
- `backend/src/routes/update.routes.js`: API التحديث (بعد إصلاح [1]+[2]: `classifyGitError` مُعرّفة + `git fetch --tags --force`).
- `backend/src/routes/scan.routes.js`: SSE لمسح الأجهزة (L650-722: `sendDone(deviceCount)` في L670).
- `deploy.sh`: ر. إِصلاح [3]: `APP_HOME` + `PM2_HOME` مُصدّرة في رَأس + كل `pm2` مُغَلَّف بـ `env PM2_HOME=`.
- `nginx.example.conf` + `nginx.connection-map.conf` + `linux-setup/network-monitor-nginx.conf`: إعداد reverse proxy (مَفصول).
- `ecosystem.config.js`: تَكوين PM2 (cwd=`${PROJECT_DIR}/backend` — مُولَّد آليًّا بـ `fix_ecosystem_config`).

### تحذيرات ومَزالق
1. **لا تَستخدم أبدًا `sudo git ...`** على المشروع (سيُعيد مشكلة ملكية `.git/`). استخدم `git ...` كـ `it` فقط. (تَحذير تاريخي — يَبقى صالحًا).
2. **`deploy.sh` يجب أن يُنفّذ بـ `sudo`** (يَحتاج صلاحيات لإعادة بناء الحزم)، والآن بعد إصلاح [3] يَحدد `PM2_HOME` تلقائيًّا لِـ `/home/${APP_USER}/.pm2`. للمُستخدم `it`: `sudo APP_USER=it bash deploy.sh install/update`.
3. **لا تَحذف `.git/`** أبدًا (سَتَفقد التاريخ وسَيتعطل `git fetch`).
4. **لو فَشل `nginx -t` بـ "unknown variable $connection_upgrade"**: نَسيت نَسخ `nginx.connection-map.conf` إلى `/etc/nginx/conf.d/`. هذا هو السبب الوحيد الشائع.

### الأوامر السريعة لاستئناف العمل (للجلسة التالية)
```bash
# 1. تحقق من الحالة الحالية على machine التطوير:
cd /opt/network-monitor   # أو مجلد المشروع محليًّا (Windows: "E:\New claude\network-monitor-backup-20260723_121919")
git status --short --branch
git log --oneline -3
git tag -l "v*" --sort=-v:refname | head -3   # المتوقع: v2.4.0 في الأعلى

# 2. تَطبيق تحديث v2.4.0 على الخادم (لا أَوامر يدوية):
#   من الواجهة → تبويب التحديثات → "تطبيق التحديث".
#   أو يدويًّا:
cd /opt/network-monitor
git fetch --tags --force origin
git pull origin main
sudo APP_USER=it bash deploy.sh update

# 3. تحديث nginx إن لم يكن مُحدّثًا (نَسخ ملفين):
sudo cp nginx.example.conf /etc/nginx/sites-available/network-monitor
sudo cp nginx.connection-map.conf /etc/nginx/conf.d/connection-map.conf
sudo ln -sf /etc/nginx/sites-available/network-monitor /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 4. تَحقق نهائي:
curl http://localhost:4000/api/health   # HTTP 200 = backend سليم
pgrep -af "PM2.*God Daemon" | head -2   # يَجب أَن يُظهر /home/it/.pm2
```

---

## 📌 ما يجب على الجلسة التالية فعله فورًا عند بدئها

1. **اقرأ كل هذا الملف**.
2. تحقق: `git tag -l "v*" --sort=-v:refname | head -3` — هل `v2.4.0` في الأَعلى؟
   - **نعم** → المشروع مُكتمل، يمكن机房 أَرشفة هذا الملف.
   - **لا** (رَغم وُجود الالتزام على origin) → نَفّذ `git fetch --tags --force origin` + `git pull origin main` ثم تَأكَّد ثانية.
3. **لا تَوجد خطوات تَبقّى**: كل الإِصلاحات الجذرية رُفِعَت، كل التحذيرات سُجِّلَت. أَي صيانة لاحقة يَكفي فيها تَطبيق v2.4.0 من تبويب التحديثات أو `deploy.sh update`.

---

**نهاية الملف — آخر تحديث بواسطة الجلسة الحالية في 2026-07-27 (v2.4.0).**
