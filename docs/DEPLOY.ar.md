# 🚀 دليل النشر الإنتاجي على Linux

[English](DEPLOY.md) · **العربية**

كيف تركّب نظام مراقبة أجهزة الشبكة على سيرفر Linux — بالطريقة الآلية عبر `deploy.sh`، أو يدويًّا خطوة
بخطوة، مع الوكيل العكسي وHTTPS والنسخ الاحتياطي والترقية. هذا الدليل يدمج ويستبدل ملف `RUN-ON-LINUX.md`
القديم.

---

## 📋 التوزيعات المدعومة

| العائلة | التوزيعات | مدير الحزم |
|---|---|---|
| **Debian** | Ubuntu · Debian · Mint · Pop!_OS · Kali | `apt` |
| **Red Hat** | RHEL · CentOS · Rocky · AlmaLinux · Fedora | `dnf` / `yum` |
| **Arch** | Arch · Manjaro · EndeavourOS | `pacman` |
| **Alpine** | Alpine Linux | `apk` |
| **SUSE** | openSUSE · SLES | `zypper` |

سكربت `deploy.sh` يكتشف التوزيعة ومدير الحزم تلقائيًّا.

## 📋 المتطلبات

| العنصر | الإصدار | ملاحظات |
|---|---|---|
| النواة | 4.x أو أحدث | أي توزيعة من القائمة |
| Node.js | **24 LTS** (**≥ 22 إلزامي**) | يثبّته السكربت (`better-sqlite3@13` يشترط ≥ 22) |
| PM2 | الأحدث | مدير العمليات — يثبّته السكربت |
| الذاكرة | 512MB حد أدنى | 1GB موصى بها لأكثر من 50 جهازًا |
| الصلاحيات | sudo / root | لتثبيت الحزم |
| الإنترنت | مطلوب | لتحميل الحزم وNodeSource |

---

## ⚡ النشر السريع (≈٥ دقائق — المُوصى به)

```bash
# على السيرفر
sudo mkdir -p /opt && sudo chown "$USER":"$USER" /opt
cd /opt
git clone https://github.com/kerolos-it2022/network-monitor.git network-monitor
cd network-monitor
sudo bash deploy.sh install
```

### ما يفعله `deploy.sh install`

1. يكتشف التوزيعة ومدير الحزم (`apt`/`dnf`/`yum`/`pacman`/`apk`/`zypper`).
2. يحدّث الحزم ويثبّت الأساسيات: git · curl · wget · ca-certificates · gnupg · **traceroute**.
3. يثبّت أدوات البناء (python3 · make · g++ · build-essential) اللازمة لـ`better-sqlite3`.
4. يثبّت **Node.js 24 LTS** (عبر NodeSource على Debian/RHEL، ومن مدير الحزم على البقية).
5. يثبّت **PM2** عالميًّا و**sqlite3** CLI.
6. ينشئ `backend/.env` من القالب ويولّد `SESSION_SECRET` عشوائيًّا **ومفاتيح VAPID**.
7. يشغّل `npm install` ويعيد بناء `better-sqlite3` **للنظام المستهدف** (وهذا ما يحل مشكلة «بُني على
   ويندوز وعطل على لينكس»).
8. يجهّز قاعدة البيانات وينشئ المدير الافتراضي.
9. يشغّل التطبيق تحت PM2 مع بدء تلقائي (systemd / OpenRC) ويطبع روابط الوصول.

الخطوات اليدوية الكاملة بالأسفل لو أردت رؤية كل خطوة بنفسك.

---

## 🛠️ التثبيت اليدوي (بدون السكربت)

```bash
# ١) Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs            # Debian/Ubuntu
node -v                                   # يجب أن يطبع v24.x

# ٢) أدوات البناء (لازمة لـbetter-sqlite3)
# Debian/Ubuntu: sudo apt install -y python3 make g++ build-essential
# RHEL/CentOS:   sudo dnf install -y python3 make gcc gcc-c++
# Arch:          sudo pacman -S python make gcc
# Alpine:        sudo apk add python3 make g++ build-base
# openSUSE:      sudo zypper install python3 make gcc gcc-c++

# ٣) المشروع والتبعيات
cd /opt && git clone https://github.com/kerolos-it2022/network-monitor.git network-monitor
cd network-monitor/backend && npm install

# ٤) قاعدة البيانات
mkdir -p ../database && sqlite3 ../database/monitoring.db < ../database/schema.sql

# ٥) الإعدادات
cp .env.example .env && nano .env         # PORT · DB_PATH · حساب المدير · تلجرام… (اختياري)
npm install -g pm2                        # ٦) مدير العمليات

# ٧) أول مدير + التشغيل
node src/seedAdmin.js
npm start                                 # أو: pm2 start ../ecosystem.config.js
pm2 startup && pm2 save                   # بدء تلقائي مع الإقلاع (نفّذ الأمر الذي يطبعه)
```

---

## ⚙️ إعدادات ما بعد التثبيت (مهمة)

عدّل `backend/.env` — على الأقل:

```env
DEFAULT_ADMIN_PASSWORD=كلمة_مرور_قوية_فريدة
TELEGRAM_BOT_TOKEN=التوكن_الجديد
TELEGRAM_CHAT_ID=معرّف_المحادثة
VAPID_PUBLIC_KEY=...        # يولّدها deploy.sh تلقائيًّا
VAPID_PRIVATE_KEY=...       # يولّدها deploy.sh تلقائيًّا
VAPID_SUBJECT=mailto:you@example.com
MOBILE_ENABLED=1
```

ثم `sudo bash deploy.sh restart`. ولإعادة توليد مفاتيح VAPID يدويًّا:

```bash
cd /opt/network-monitor/backend
node -e "const k=require('web-push').generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY='+k.publicKey); console.log('VAPID_PRIVATE_KEY='+k.privateKey)"
```

تحقّق من الوصول:

```bash
hostname -I                             # عنوان السيرفر
curl http://localhost:4000/api/health   # {"success":true,"data":"ok"}
```

ثم افتح `http://<IP-السيرفر>:4000/`.

### 🔑 أول تسجيل دخول

حساب المدير يأتي من `DEFAULT_ADMIN_USERNAME` و`DEFAULT_ADMIN_PASSWORD` (والقيم الضعيفة تُرفض إلا بـ
`NM_ALLOW_WEAK_ADMIN=1`)، فاضبط كلمة مرور حقيقية قبل أول تشغيل. و**غيّرها من اللوحة فورًا بعد أول دخول**
(تبويب الملف الشخصي).

### على الأبلاينس: كلمة مرور واحدة لكل الأبواب

كلمة مرور المدير هي نفسها كلمة مرور الكونسول (`tty1`) وحساب Linux باسم `sysadmin`. المُثبِّت يكتبها في
ثلاثة أماكن من مصدر واحد (`nm-sync-console-password`): قاعدة بيانات اللوحة (`seedAdmin`) · بوابة الكونسول
`/etc/nm-console.conf` · حساب `sysadmin`. وأي تغيير لاحق — من تبويب الملف الشخصي أو من خيار `[6]` في قائمة
الكونسول — يُحدِّثها جميعًا تلقائيًّا (اللوحة تحدّث نفسها ثم تنادي المساعد نفسه بصلاحية sudo مقيَّدة بأمر واحد).

### إشعارات الهاتف (PWA)

1. على الخادم: مفاتيح VAPID موجودة في `.env` (تلقائيًّا مع `deploy.sh install`).
2. اللوحة → الإشعارات → فعّل «إشعارات الهاتف» → احفظ.
3. على الهاتف: افتح `http://<IP-السيرفر>:4000` في Chrome → **🔔 تفعيل الإشعارات** → اسمح → *إضافة إلى
   الشاشة الرئيسية*.
4. اختبر من اللوحة (زرّ اختبار لكل قناة).

> ⚠️ **Web Push يشترط HTTPS خارج localhost.** `http://localhost:4000` يعمل في Chrome، لكن Safari على iOS
> يشترط HTTPS دائمًا — راجع قسم الوكيل العكسي أدناه. وعلى الشبكة المحلية فقط، شهادة محلية موثوقة (mkcert)
> تكفي.

---

## 🔄 العمليات اليومية

| العملية | الأمر |
|---|---|
| السجلات الحية | `sudo bash deploy.sh logs` |
| إعادة التشغيل | `sudo bash deploy.sh restart` |
| الإيقاف | `sudo bash deploy.sh stop` |
| الحالة | `sudo bash deploy.sh status` |
| تحديث بعد `git pull` | `sudo bash deploy.sh update` |
| إزالة التطبيق (بياناتك تبقى) | `sudo bash deploy.sh uninstall` |

وما يعادلها مباشرة في PM2: `pm2 status` · `pm2 logs network-monitor` · `pm2 restart network-monitor` ·
`pm2 stop network-monitor` · `pm2 monit`.

### التحديث إلى إصدار أحدث

تبويب **التحديثات** في اللوحة يقرأ «أحدث إصدار» من **وسوم git** — لذا اجلب الوسوم مع كل تحديث:

```bash
cd /opt/network-monitor
git fetch --tags
git pull
sudo bash deploy.sh update
```

> ⚠️ عند إصدار نسخة جديدة من جهاز التطوير، ارفع **الكود والوسم معًا** وإلا لن يرى الخادم النسخة الجديدة:
> ```bash
> git tag -a vX.Y.Z -m "Release vX.Y.Z"
> git push origin main --follow-tags      # أو: git push origin main && git push origin vX.Y.Z
> ```

> ⚠️ **الترتيب إلزامي على الأبلاينس القديم (Node 18 ← 24): رقِّ Node أولًا ثم حدّث التطبيق فورًا**، ولا
> تُعِد تشغيل الجهاز بين الخطوتين — الخدمة تبقى شغّالة لأن المكتبة الحالية محمّلة في الذاكرة، لكن إعادة
> التشغيل قبل إتمام التحديث تفشل (المكتبة القديمة لا تُحمَّل على Node 24). ومنذ v2.33.0 يستدعي المُحدِّث
> أداة `nm-node-upgrade` بنفسه قبل نسخ ملفات التطبيق، فالأمر صار تلقائيًّا (يُعطّل بـ
> `NM_SKIP_NODE_UPGRADE=1`).

**التراجع:** من تبويب التحديثات ← «↩️ الرجوع لإصدار أقدم» من قائمة الوسوم (نفس المسار الآمن). ويمكن إرجاع
Node منفصلًا (`setup_18.x` ثم `npm ci --omit=dev`) واستعادة القاعدة من نسختك الاحتياطية.

---

## 🌐 الوكيل العكسي و HTTPS

### ١) تثبيت Nginx + Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx     # Debian/Ubuntu
sudo dnf install -y nginx certbot python3-certbot-nginx     # عائلة RHEL
sudo pacman -S nginx certbot certbot-nginx                  # Arch
sudo apk add nginx certbot                                  # Alpine
sudo zypper install nginx certbot python3-certbot-nginx     # openSUSE
```

### ٢) إعداد Nginx (ملفان بشكل مقصود)

```bash
# كتلة server ← sites-available (سياق http عبر sites-enabled)
sudo cp /opt/network-monitor/nginx.example.conf /etc/nginx/sites-available/network-monitor
sudo ln -sf /etc/nginx/sites-available/network-monitor /etc/nginx/sites-enabled/

# كتلة map ← conf.d (يجب أن تكون داخل http { } مباشرة)
sudo cp /opt/network-monitor/nginx.connection-map.conf /etc/nginx/conf.d/connection-map.conf

sudo nano /etc/nginx/sites-available/network-monitor   # ضع دومينك في server_name
sudo nginx -t && sudo systemctl reload nginx
```

> 💡 **ليه ملفان؟** كتلة `map $http_upgrade $connection_upgrade {...}` لا تُقبل إلا داخل `http { }` ولا
> تعمل داخل `server { }`. ووضع الـ`map` في `conf.d/` يضمن السياق الصحيح على كل إصدارات nginx. وكتلة
> الـserver المرفقة تُعطّل `proxy_buffering` على مسارات SSE — وهو شرط عمل بثّ المسح/السجل الحيّ.

### ٣) شهادة مجانية عبر Let's Encrypt

```bash
sudo certbot --nginx -d monitor.company.com
```

### بلا دومين عام؟ ثلاثة خيارات تعمل على الشبكة المحلية

| الخيار | النتيجة | ملاحظات |
|---|---|---|
| **mkcert** (المُوصى به محليًّا) | شهادة موثوقة محليًّا بلا تحذيرات، وPWA/Web Push يعملان | `mkcert -install` ثم `mkcert net-monitor.local localhost 127.0.0.1 <IP-السيرفر>`، ووجّه nginx لملفَّي `.pem`، وأضف الاسم في ملف hosts لكل جهاز |
| **شهادة ذاتية** | سريعة، لكن كل متصفح يعرض تحذير «الاتصال غير آمن» | `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout … -out … -subj "/CN=net-monitor.local"` |
| **نفق (Tailscale / ngrok / Cloudflare)** | HTTPS من أي مكان بلا دومين | Tailscale يمنحك `https://device.tailnet.ts.net`؛ واللوحة تدير نفق ngrok بنفسها (تبويب الوصول عن بُعد) |

---

## 💾 النسخ الاحتياطي والاستعادة

قاعدة البيانات في `/opt/network-monitor/database/monitoring.db`.

```bash
# نسخة يدوية
cp /opt/network-monitor/database/monitoring.db /backups/nm-$(date +%F).db

# نسخة يومية الساعة ٢ صباحًا
crontab -e
0 2 * * * cp /opt/network-monitor/database/monitoring.db /backups/nm-$(date +\%F).db
```

الاستعادة:

```bash
sudo bash deploy.sh stop
cp /backups/nm-2026-10-18.db /opt/network-monitor/database/monitoring.db
sudo bash deploy.sh restart
```

وللوحة تبويب نسخ احتياطي (إنشاء · قائمة · تنزيل · استعادة — وتُؤخذ نسخة أمان قبل أي استعادة) ونسخ احتياطي
تلقائي مجدول. وقبل أي ترقية كبيرة يُستحسن تشغيل `PRAGMA integrity_check` على نسخة.

---

## 🌍 التشغيل لعدة شركات

المشروع مُصمَّم للنشر **لكل شركة على حدة** لا كنظام متعدد المستأجرين:

1. سيرفر Linux مستقل لكل شركة (فيزيائي أو VM أو VPS).
2. استنساخ نفس المستودع.
3. ملف `backend/.env` مستقل لكل شركة (وغالبًا بوت تلجرام مختلف).
4. أجهزة تلك الشركة وحدها تُضاف من لوحتها.

والفائدة: عزل كامل للبيانات · استقلال الأعطال · حساب إشعارات خاص بكل شركة · وأداء أفضل (كل سيرفر يراقب
شبكته مباشرة).

---

## 🔥 الجدار الناري

```bash
# ufw (Debian/Ubuntu)
sudo ufw allow 22/tcp && sudo ufw allow 4000/tcp && sudo ufw enable

# firewalld (عائلة RHEL)
sudo firewall-cmd --permanent --add-port=22/tcp
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --reload

# iptables (Alpine / أي توزيعة)
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 4000 -j ACCEPT
```

---

## 🐛 استكشاف الأخطاء

**التطبيق لا يبدأ** — `sudo bash deploy.sh logs` ثم `sudo bash deploy.sh status` ثم
`pm2 logs network-monitor --err`.

**فشل بناء `better-sqlite3`** — ثبّت أدوات البناء لتوزيعتك (قسم التثبيت اليدوي)، ثم:

```bash
cd /opt/network-monitor/backend
npm rebuild better-sqlite3
sudo bash deploy.sh restart
```

وعلى Alpine يستخدم السكربت `--build-from-source` تلقائيًّا.

**المنفذ 4000 محجوز** — اعرف العملية (`sudo ss -tlnp | grep :4000`) أو غيّر `PORT` في `backend/.env` ثم
أعد التشغيل.

**الـping لا يعمل** — على تثبيت Linux عادي لا يحتاج ICMP صلاحيات إضافية؛ ولو كان إعدادك يحجب المقابس
الخام: `sudo setcap cap_net_raw+p $(which node)` ثم إعادة التشغيل.

**PM2 لا يبدأ مع الإقلاع على Alpine** — Alpine يستخدم OpenRC لا systemd؛ أضِف PM2 للإقلاع (`rc-update`)
أو استعمل ملف systemd المرفق كمرجع.

**إعادة ضبط حساب المدير** — `cd /opt/network-monitor/backend && node src/seedAdmin.js`.

---

## ✅ قائمة فحص ما قبل الإنتاج

- [ ] `DEFAULT_ADMIN_PASSWORD` قوية وفريدة
- [ ] `SESSION_SECRET` مضبوط (السكربت يولّده — تأكد)
- [ ] توكن تلجرام وChat ID (و/أو اعتمادات واتساب) مضبوطة
- [ ] الجدار الناري مفعّل والمنافذ المطلوبة فقط مفتوحة
- [ ] نسخة من `backend/.env` في مكان آمن (يحوي الأسرار)
- [ ] HTTPS مضبوط لو اللوحة تُفتح من خارج الشبكة المحلية
- [ ] نسخ احتياطي يومي لـ`monitoring.db` مجدول
- [ ] تسجيل الدخول وإضافة جهاز ووصول إشعار تلجرام حقيقي — مُختبَرة
- [ ] `node -v` يطبع **v22 أو أحدث**
- [ ] `cd backend && npm test` يمرّ قبل أي ترقية
- [ ] نسخة احتياطية + `PRAGMA integrity_check` قبل الترقية
- [ ] مراجعة «إعدادات العرض» (الصفحة العامة + NOC) وتنقيح AI بعد الترقية
- [ ] للشبكات الكبيرة: رفع `check_interval_seconds` (30/60 ثانية) للأجهزة غير الحرجة

## 📚 ملفات مرتبطة

| الملف | المحتوى |
|---|---|
| [../README.ar.md](../README.ar.md) | نظرة عامة والتشغيل السريع |
| [ARCHITECTURE.ar.md](ARCHITECTURE.ar.md) | كيف تتركّب الأجزاء |
| [I18N.ar.md](I18N.ar.md) | نموذج اللغتين في الواجهة |
| [../appliance/README.ar.md](../appliance/README.ar.md) | بناء صورة الأبلاينس وتنصيبها |
| [linux-setup/](linux-setup/) | ملف systemd وتهيئة Nginx (بديل عن PM2) |
| [../CHANGELOG.md](../CHANGELOG.md) | سجل الإصدارات |
