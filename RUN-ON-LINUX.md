# 🐧 إرشادات تشغيل نظام مراقبة الشبكة على Linux

> دليل عملي سريع و شامل لتشغيل نظام «مراقبة أجهزة الشبكة» على أي توزيعة Linux —
> محلياً للتجربة أو إنتاجياً مع PM2.
>
> **للدليل المفصّل الكامل (HTTPS + Nginx + Firewall + نسخ احتياطي) راجع [`DEPLOY.md`](./DEPLOY.md).**

---

## ⚡ الطريقة السريعة — سكريبت تلقائي (موصى به للإنتاج)

```bash
# 1) استنساخ المشروع
sudo mkdir -p /opt && sudo chown $USER:$USER /opt
cd /opt
git clone https://github.com/kerolos-it2022/network-monitor.git
cd network-monitor

# 2) تثبيت + تشغيل آلي (يكتشف التوزيعة تلقائياً)
sudo bash deploy.sh install
```

**ما يفعله السكريبت تلقائياً:**
- يكتشف التوزيعة (Debian/Ubuntu/RHEL/Arch/Alpine/openSUSE)
- يثبّت: git, curl, python3, make, g++, Node.js 20 LTS, PM2, sqlite3
- ينشئ `backend/.env` + `SESSION_SECRET` عشوائي
- يهيّئ قاعدة البيانات + حساب المدير
- يشغّل التطبيق عبر PM2 + يضبطه ليبدأ مع النظام

**بعد الانتهاء افتح:** `http://<IP-السيرفر>:4000/`

---

## 🛠️ الطريقة اليدوية — خطوة بخطوة (للتطوير والتجربة)

### 1) تثبيت Node.js 20 LTS

| التوزيعة | الأمر |
|---|---|
| **Debian/Ubuntu** | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo bash - && sudo apt install -y nodejs` |
| **RHEL/CentOS/Rocky** | `curl -fsSL https://rpm.nodesource.com/setup_20.x \| sudo bash - && sudo dnf install -y nodejs` |
| **Arch/Manjaro** | `sudo pacman -S nodejs npm` |
| **Alpine** | `sudo apk add nodejs npm` |
| **openSUSE** | `sudo zypper install nodejs20` |

تأكيد التثبيت:
```bash
node -v   # يجب أن يطبع v20.x
npm -v
```

### 2) تثبيت أدوات البناء (مطلوبة لـ better-sqlite3)

| التوزيعة | الأمر |
|---|---|
| Debian/Ubuntu | `sudo apt install -y python3 make g++ build-essential sqlite3` |
| RHEL/CentOS | `sudo dnf install -y python3 make gcc gcc-c++ sqlite` |
| Arch | `sudo pacman -S python make gcc sqlite` |
| Alpine | `sudo apk add python3 make g++ build-base sqlite` |
| openSUSE | `sudo zypper install python3 make gcc gcc-c++ sqlite3` |

### 3) استنساخ المشروع وتثبيت الحزم

```bash
cd ~
git clone https://github.com/kerolos-it2022/network-monitor.git
cd network-monitor

# تثبيت حزم الخادم
cd backend
npm install
```

### 4) إعداد قاعدة البيانات

```bash
# من جذر المشروع
cd ..
mkdir -p database
sqlite3 database/monitoring.db < database/schema.sql
```

### 5) إعداد متغيرات البيئة

```bash
cd backend
cp .env.example .env
nano .env   # أو: vi .env
```

**عدّل على الأقل هذه القيم:**
```env
SESSION_SECRET=ضع_سلسلة_عشوائية_طويلة_جداً_هنا
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=كلمة_مرور_قوية
PORT=4000
# (اختياري) للإشعارات:
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### 6) إنشاء حساب المدير

```bash
node src/seedAdmin.js
```

### 7) تشغيل الخادم (للتطوير)

```bash
node src/server.js
```

ستراه:
```
Database connection OK.
Server running on port 4000
Monitoring engine started (every 10s tick).
```

افتح المتصفح على:
- 📊 الصفحة العامة: `http://localhost:4000/`
- 🔐 لوحة التحكم: `http://localhost:4000/admin/login.html`

---

## 🚀 التشغيل عبر PM2 (للإنتاج)

```bash
# تثبيت PM2 (إن لم يُثبّت مع السكريبت)
sudo npm install -g pm2

# من جذر المشروع
pm2 start ecosystem.config.js
pm2 save

# ليبدأ مع إقلاع النظام
pm2 startup
# نفّذ الأمر الذي يطبعك PM2 (sudo env PATH=...)
pm2 save
```

### العمليات اليومية عبر PM2:

| العملية | الأمر |
|---|---|
| السجلات الحية | `pm2 logs network-monitor` |
| إعادة التشغيل | `pm2 restart network-monitor` |
| إيقاف | `pm2 stop network-monitor` |
| الحالة | `pm2 status` |
| مراقبة الموارد | `pm2 monit` |

### أو عبر سكريبت النشر `deploy.sh`:

| العملية | الأمر |
|---|---|
| السجلات | `sudo bash deploy.sh logs` |
| إعادة التشغيل | `sudo bash deploy.sh restart` |
| إيقاف | `sudo bash deploy.sh stop` |
| الحالة | `sudo bash deploy.sh status` |
| تحديث بعد git pull | `sudo bash deploy.sh update` |

---

## 🔥 ضبط الـ Firewall (مهم للإنتاج)

### ufw (Debian/Ubuntu)
```bash
sudo ufw allow 22/tcp       # SSH
sudo ufw allow 4000/tcp     # المراقبة
sudo ufw enable
```

### firewalld (RHEL/CentOS/Fedora)
```bash
sudo firewall-cmd --permanent --add-port=22/tcp
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --reload
```

### iptables (Alpine/أي Linux)
```bash
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 4000 -j ACCEPT
```

---

## 🌐 الوصول من خارج الشبكة المحلية (HTTPS)

```bash
# تثبيت Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx      # Debian
sudo dnf install -y nginx certbot python3-certbot-nginx      # RHEL

# ضبط Nginx
sudo cp nginx.example.conf /etc/nginx/sites-available/network-monitor
sudo nano /etc/nginx/sites-available/network-monitor   # عدّل server_name
sudo ln -s /etc/nginx/sites-available/network-monitor /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# تفعيل HTTPS مجاناً
sudo certbot --nginx -d monitor.company.com
```

---

## 💾 النسخ الاحتياطي والاستعادة

```bash
# نسخة يدوية
cp /opt/network-monitor/database/monitoring.db ~/backups/nm-$(date +%F).db

# نسخة يومية تلقائية (كل يوم 2 صباحاً)
crontab -e
# أضف:
0 2 * * * cp /opt/network-monitor/database/monitoring.db ~/backups/nm-$(date +\%F).db

# للاستعادة:
sudo bash deploy.sh stop
cp backup-2026-07-21.db /opt/network-monitor/database/monitoring.db
sudo bash deploy.sh restart
```

---

## 🐛 استكشاف الأخطاء الشائعة

### التطبيق لا يبدأ
```bash
sudo bash deploy.sh logs           # راجع السجل
pm2 logs network-monitor --err     # الأخطاء فقط
sudo bash deploy.sh status         # حالة العملية
```

### `better-sqlite3` فشل في البناء
```bash
# Debian:  sudo apt install -y python3 make g++ build-essential
# RHEL:    sudo dnf install -y python3 make gcc gcc-c++
# Alpine:  sudo apk add python3 make g++ build-base

cd /opt/network-monitor/backend
npm rebuild better-sqlite3
sudo bash deploy.sh restart
```

### المنفذ 4000 محجوز
```bash
sudo lsof -i :4000   # أو: sudo ss -tlnp | grep :4000
# غيّر backend/.env: PORT=4001
sudo bash deploy.sh restart
```

### Ping لا يعمل (ICMP محجوب)
```bash
sudo setcap cap_net_raw+p $(which node)
sudo bash deploy.sh restart
```

### إعادة ضبط حساب المدير
```bash
cd /opt/network-monitor/backend
node src/seedAdmin.js
```

---

## ✅ قائمة فحص ما قبل النشر الإنتاجي

- [ ] غيّرت `DEFAULT_ADMIN_PASSWORD` في `.env` إلى كلمة مرور قوية
- [ ] تأكدت من قيمة `SESSION_SECRET` (السكريبت يولّدها تلقائياً)
- [ ] أضفت `TELEGRAM_BOT_TOKEN` و `TELEGRAM_CHAT_ID` (للإشعارات)
- [ ] فعّلت Firewall (ufw / firewalld / iptables)
- [ ] نسخت `backend/.env` إلى مكان آمن (يحتوي أسرار)
- [ ] فعّلت HTTPS عبر Nginx + Certbot (للوصول الخارجي)
- [ ] ضبطت نسخ احتياطي يومي لـ `monitoring.db`
- [ ] اختبرت تسجيل الدخول + إضافة جهاز + إشعار تلجرام

---

## 📚 ملفات مرجعية إضافية داخل المشروع

| الملف | الوصف |
|---|---|
| [`README.md`](./README.md) | دليل المشروع الكامل (واجهة، API، بنية) |
| [`DEPLOY.md`](./DEPLOY.md) | دليل النشر الإنتاجي المفصّل (Nginx, HTTPS, Multi-tenant) |
| [`deploy.sh`](./deploy.sh) | سكريبت النشر التلقائي (install, restart, logs, ...) |
| [`ecosystem.config.js`](./ecosystem.config.js) | إعدادات PM2 |
| [`nginx.example.conf`](./nginx.example.conf) | مثال إعدادات Nginx |
| [`database/schema.sql`](./database/schema.sql) | مخطط قاعدة البيانات |
| [`backend/.env.example`](./backend/.env.example) | مثال ملف البيئة |

---

## 📞 روابط سريعة بعد التشغيل

| الصفحة | الرابط |
|---|---|
| 📊 الصفحة العامة | `http://<IP>:4000/` |
| 🔐 تسجيل الدخول | `http://<IP>:4000/admin/login.html` |
| 🛠️ لوحة التحكم | `http://<IP>:4000/admin/dashboard.html` |
| ❤️ فحص الصحة | `http://<IP>:4000/api/health` |
