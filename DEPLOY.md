# 🚀 دليل النشر على سيرفر Linux (Production Deployment)

دليل كامل لتركيب نظام مراقبة أجهزة الشبكة على **أي توزيعة Linux** رئيسية — **بشكل مباشر (بدون Docker)** — باستخدام Node.js + PM2.

---

## 📋 التوزيعات المدعومة

| العائلة | التوزيعات | مدير الحزم |
|---|---|---|
| **Debian** | Ubuntu، Debian، Linux Mint، Pop!_OS، Kali | `apt` |
| **Red Hat** | RHEL، CentOS، Rocky Linux، AlmaLinux، Fedora | `dnf` / `yum` |
| **Arch** | Arch Linux، Manjaro، EndeavourOS | `pacman` |
| **Alpine** | Alpine Linux (شائع في الحاويات) | `apk` |
| **SUSE** | openSUSE (Tumbleweed/Leap)، SLES | `zypper` |

> **السكريبت يكتشف التوزيعة ومدير الحزم تلقائياً** — لا حاجة لاختيار يدوي.

---

## 📋 المتطلبات العامة

| العنصر | الإصدار | ملاحظات |
|---|---|---|
| Linux Kernel | 4.x أو أحدث | أي توزيعة من知乎 أعلاه |
| Node.js | 20 LTS | السكريبت يثبّته تلقائياً |
| PM2 | آخر إصدار | السكريبت يثبّته تلقائياً (إدارة العمليات) |
| RAM | 512 MB minimum | 1 GB موصى به لمراقبة 50+ جهاز |
| صلاحيات | sudo / root | مطلوبة لتثبيت الحزم |
| اتصال إنترنت | مطلوب | لتحميل الحزم و NodeSource |

> **ملاحظة**: النشر المباشر أخفّ وأسرع من Docker، ولا يحتاج أي حاويات. السكريبت `deploy.sh` يتولّى كل شيء.

---

## ⚡ النشر السريع (5 دقائق)

### 1) على جهاز التطوير: ادفع المشروع لـ GitHub
```bash
# في جذر المشروع على جهازك
git remote add origin https://github.com/kerolos-it2022/network-monitor.git
git push -u origin main
```

### 2) على سيرفر Linux: استنسخ المشروع
```bash
# أي توزيعة Linux مدعومة:
sudo mkdir -p /opt
sudo chown $USER:$USER /opt
cd /opt
git clone https://github.com/kerolos-it2022/network-monitor.git network-monitor
cd network-monitor
```

### 3) شغّل سكريبت النشر
```bash
sudo bash deploy.sh install
```

### 👉 ما سيفعله السكريبت تلقائياً:
1. ✅ **كشف التوزيعة** ومدير الحزم المناسب (apt/dnf/yum/pacman/apk/zypper)
2. ✅ **تحديث الحزم** (apt update + upgrade على Debian-based)
3. ✅ تثبيت **الأدوات الأساسية**: git, curl, wget, ca-certificates, sudo, gnupg
4. ✅ تثبيت **أدوات البناء**: python3, make, g++/gcc (ضرورية لـ better-sqlite3)
5. ✅ تثبيت **Node.js 20 LTS** (عبر NodeSource على Debian/RHEL، أو مدير الحزم على الباقي)
6. ✅ تثبيت **PM2** عالمياً (إدارة العمليات)
7. ✅ تثبيت **sqlite3 CLI** (لاستيراد مخطط قاعدة البيانات)
8. ✅ إنشاء `backend/.env` من القالب + توليد `SESSION_SECRET` عشوائي
9. ✅ تثبيت حزم الخادم: `npm install`
10. ✅ تهيئة قاعدة البيانات + إنشاء حساب المدير الافتراضي
11. ✅ تشغيل التطبيق عبر PM2 + ضبط بدء تلقائي مع النظام
12. ✅ إظهار عنوان URL للوصول

---

## ⚙️ إعدادات ما بعد التثبيت (مهمة!)

### 1) عدّل ملف `.env` بقيم إنتاجية حقيقية
```bash
cd /opt/network-monitor
nano backend/.env   # أو: vi backend/.env
```

غيّر على الأقل:
```env
DEFAULT_ADMIN_PASSWORD=كلمة_مرور_قوية_جداً_فريدة
TELEGRAM_BOT_TOKEN=ضع_التوكين_الجديد_هنا
TELEGRAM_CHAT_ID=ضع_الـ_chat_id_هنا
```

بعد التعديل:
```bash
sudo bash deploy.sh restart
```

### 2) تأكد من الوصول
```bash
# عنوان IP المحلي للسيرفر
ip a | grep inet      # على أي توزيعة
# أو:
hostname -I          # على Debian/Ubuntu

# اختبار محلي
curl http://localhost:4000/api/health
# يجب أن يرجع: {"success":true,"data":"ok"}
```

افتح في المتصفح: `http://<IP-السيرفر>:4000/`

---

## 🔄 العمليات اليومية

| العملية | الأمر |
|---|---|
| عرض السجلات الحية | `sudo bash deploy.sh logs` |
| إعادة التشغيل | `sudo bash deploy.sh restart` |
| إيقاف النظام | `sudo bash deploy.sh stop` |
| حالة العملية | `sudo bash deploy.sh status` |
| تحديث بعد `git pull` | `sudo bash deploy.sh update` |
| حذف التطبيق (بياناتك تبقى) | `sudo bash deploy.sh uninstall` |

### أوامر PM2 المباشرة (بديلة)
```bash
pm2 status                       # قائمة العمليات
pm2 logs network-monitor         # السجلات الحية
pm2 restart network-monitor      # إعادة تشغيل
pm2 stop network-monitor         # إيقاف
pm2 monit                        # لوحة مراقبة موارد
```

---

## 🌐 الوصول من خارج السيرفر (Reverse Proxy + HTTPS)

### الخطوة 1: تثبيت Nginx + Certbot
```bash
# Debian/Ubuntu:
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

# RHEL/CentOS/Rocky/Fedora:
sudo dnf install -y nginx certbot python3-certbot-nginx

# Arch:
sudo pacman -S nginx certbot certbot-nginx

# Alpine:
sudo apk add nginx certbot

# openSUSE:
sudo zypper install nginx certbot python3-certbot-nginx
```

### الخطوة 2: ضبط Nginx
```bash
sudo cp /opt/network-monitor/nginx.example.conf /etc/nginx/sites-available/network-monitor 2>/dev/null \
  || sudo cp /opt/network-monitor/nginx.example.conf /etc/nginx/conf.d/network-monitor.conf

# عدّل server_name إلى دومينك (مثل: monitor.company.com)
sudo nano /etc/nginx/sites-available/network-monitor 2>/dev/null \
  || sudo nano /etc/nginx/conf.d/network-monitor.conf

# فعّل (على Debian/Ubuntu فقط):
sudo ln -s /etc/nginx/sites-available/network-monitor /etc/nginx/sites-enabled/ 2>/dev/null || true

sudo nginx -t
sudo systemctl reload nginx   # أو: sudo rc-service nginx reload على Alpine
```

### الخطوة 3: تفعيل HTTPS مجاناً عبر Let's Encrypt
```bash
sudo certbot --nginx -d monitor.company.com
```

---

## 💾 النسخ الاحتياطي للبيانات

قاعدة البيانات موجودة في: `/opt/network-monitor/database/monitoring.db`

```bash
# نسخ احتياطي يدوي
cp /opt/network-monitor/database/monitoring.db /backups/nm-$(date +%F).db

# أو آلياً عبر cron يومياً (الساعة 2 صباحاً):
crontab -e
# أضف هذا السطر:
0 2 * * * cp /opt/network-monitor/database/monitoring.db /backups/nm-$(date +\%F).db
```

للاستعادة:
```bash
sudo bash deploy.sh stop
cp backup-2026-07-19.db /opt/network-monitor/database/monitoring.db
sudo bash deploy.sh restart
```

---

## 🌍 النشر في عدة شركات

المشروع مُصمَّم ليكون **قابلاً لإعادة الاستخدام** في عدة شركات:

### الطريقة الموصى بها: نشر منفصل لكل شركة
لكل شركة:
1. سيرفر Linux مستقل (فيزيائي أو VM أو VPS) — أي توزيعة مدعومة.
2. استنساخ نفس المستودع من GitHub.
3. ملف `.env` مستقل بإعدادات تلك الشركة (Bot Token مختلف لكل شركة غالباً).
4. أجهزة شبكة تلك الشركة فقط تُضاف عبر لوحة التحكم.

### مزايا هذا النهج:
- ✅ عزل كامل: لا تشارك شركة بيانات مع أخرى.
- ✅ استقلالية الأعطال: توقف شركة لا يوقف الأخرى.
- ✅ إعدادات تلجرام مختلفة لكل شركة (Bot منفصل).
- ✅ أداء أفضل (كل سيرفر يراقب شبكته المحلية مباشرة).

---

## 🔥 Firewall

### ufw (Debian/Ubuntu)
```bash
sudo ufw allow 22/tcp           # SSH
sudo ufw allow 4000/tcp         # مراقبة
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
# حفظ القواعد حسب التوزيعة
```

---

## 🐛 استكشاف الأخطاء

### التطبيق لا يبدأ
```bash
sudo bash deploy.sh logs             # راجع آخر السجلات
sudo bash deploy.sh status           # حالة العملية
pm2 logs network-monitor --err       # أخطاء فقط
```

### `better-sqlite3` فشل في البناء
نادر جداً بعد تثبيت أدوات البناء. لو حدث:
```bash
# Debian/Ubuntu:    sudo apt install -y python3 make g++ build-essential
# RHEL/CentOS/Fed:  sudo dnf install -y python3 make gcc gcc-c++
# Arch:             sudo pacman -S python make gcc
# Alpine:           sudo apk add python3 make g++ build-base
# openSUSE:         sudo zypper install python3 make gcc gcc-c++

cd /opt/network-monitor/backend
npm rebuild better-sqlite3
sudo bash deploy.sh restart
```

### المنفذ 4000 محجوز
```bash
# ابحث عن العملية المستخدمة للمنفذ
sudo lsof -i :4000 2>/dev/null || sudo ss -tlnp | grep :4000
# أو غيّر المنفذ في backend/.env
nano /opt/network-monitor/backend/.env
# PORT=4001
```
ثم: `sudo bash deploy.sh restart`

### Ping لا يعمل ( ICMP محجوب)
على Linux النشر المباشر، الـ ping يعمل افتراضياً بدون صلاحيات إضافية.
لو واجهت مشاكل، تأكد أن المستخدم الذي يشغّل العملية له صلاحية:
```bash
# قد تحتاج setcap (نادر)
sudo setcap cap_net_raw+p $(which node)
sudo bash deploy.sh restart
```

### على Alpine: PM2 لا يبدأ مع النظام
Alpine يستخدم OpenRC بدلاً من systemd. لتشغيل PM2 مع الإقلاع:
```bash
sudo apk add pm2  # بعض إصدارات Alpine توفره
# أو يدوياً: أنشئ خدمة OpenRC
sudo rc-update add nodejs default  # إن وُجدت
```

### إعادة ضبط حساب المدير
```bash
cd /opt/network-monitor/backend
node src/seedAdmin.js
```

---

## 📋 ما الذي يثبّته السكريبت على كل توزيعة؟

| الحزمة | Debian/Ubuntu | RHEL/CentOS | Arch | Alpine | openSUSE |
|---|---|---|---|---|---|
| git + curl + wget | ✓ | ✓ | ✓ | ✓ | ✓ |
| python3 | ✓ | ✓ | ✓ | ✓ | ✓ |
| make + g++ | ✓ | ✓ | ✓ | ✓ | ✓ |
| build-essential / base-devel / build-base | ✓ | ✓ (group) | ✓ | ✓ | ✓ (pattern) |
| Node.js 20 LTS | NodeSource | NodeSource | pacman | apk | zypper |
| sqlite3 CLI | ✓ | ✓ (sqlite) | ✓ | ✓ | ✓ |
| PM2 | npm -g | npm -g | npm -g | npm -g | npm -g |

---

## ✅ قائمة فحص قبل النشر في الإنتاج

- [ ] غيّرت `DEFAULT_ADMIN_PASSWORD` إلى كلمة مرور قوية
- [ ] غيّرت `SESSION_SECRET` (السكريبت يولّده تلقائياً، لكن تأكد)
- [ ] أضفت Bot Token + Chat ID في `.env`
- [ ] فعلت firewall (ufw / firewalld / iptables)
- [ ] نسخت `backend/.env` إلى مكان آمن (يحتوي على أسرار)
- [ ] فعّلت HTTPS عبر Nginx + Certbot (للوصول من خارج الشبكة المحلية)
- [ ] ضبطت نسخ احتياطي يومي لـ `monitoring.db`
- [ ] اختبرت تسجيل الدخول + إضافة جهاز + وصول إشعار تلجرام
