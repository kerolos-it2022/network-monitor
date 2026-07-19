# 🚀 دليل النشر على سيرفر Ubuntu (Production Deployment)

دليل كامل لتركيب نظام مراقبة أجهزة الشبكة على سيرفر Ubuntu 22.04+ داخل Docker.

---

## 📋 المتطلبات على سيرفر Ubuntu

| العنصر | الإصدار | ملاحظات |
|---|---|---|
| Ubuntu Server | 22.04 LTS أو أحدث | يعمل أيضاً على 20.04 |
| Docker | 24+ | السكريبت يثبّته تلقائياً |
| Docker Compose | v2+ | السكريبت يثبّته تلقائياً |
| RAM | 1 GB минимум | 2 GB موصى به لمراقبة 50+ جهاز |
| صلاحيات | sudo / root | مطلوبة لتثبيت Docker |

---

## ⚡ النشر السريع (5 دقائق)

### 1) على جهاز التطوير (windows/mac): ادفع المشروع لـ GitHub
```bash
# في جذر المشروع على جهازك
git remote add origin https://github.com/kerolos-it2022/REPO.git
git push -u origin main
```

### 2) على سيرفر Ubuntu: استنسخ المشروع
```bash
sudo mkdir -p /opt
sudo chown $USER:$USER /opt
cd /opt
git clone https://github.com/kerolos-it2022/REPO.git network-monitor
cd network-monitor
```

### 3) شغّل سكريبت النشر
```bash
sudo bash deploy.sh install
```

### 👉 ما سيفعله السكريبت تلقائياً:
1. ✅ تثبيت Docker + Docker Compose (إن لم يوجدا)
2. ✅ إنشاء `backend/.env` من القالب + توليد `SESSION_SECRET` عشوائي
3. ✅ بناء صورة Docker (`network-monitor:latest`)
4. ✅ تشغيل الحاوية في الخلفية (`network-monitor`)
5. ✅ تهيئة قاعدة البيانات + إنشاء حساب المدير الافتراضي
6. ✅ إظهار عنوان URL للوصول

---

## ⚙️ إعدادات ما بعد التثبيت (مهمة!)

### 1) عدّل ملف `.env` بقيم إنتاجية حقيقية
```bash
cd /opt/network-monitor
nano backend/.env
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
ip a | grep inet

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
| حالة الحاوية | `sudo bash deploy.sh status` |
| تحديث بعد `git pull` | `sudo bash deploy.sh update` |
| حذف الحاوية (بياناتك تبقى) | `sudo bash deploy.sh uninstall` |

---

## 🌐 الوصول من خارج السيرفر (Reverse Proxy + HTTPS)

### الخطوة 1: تثبيت Nginx + Certbot
```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### الخطوة 2: ضبط Nginx
```bash
sudo cp /opt/network-monitor/nginx.example.conf /etc/nginx/sites-available/network-monitor
sudo nano /etc/nginx/sites-available/network-monitor
# عدّل server_name إلى دومينك (مثل: monitor.company.com)
sudo ln -s /etc/nginx/sites-available/network-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### الخطوة 3: تفعيل HTTPS مجاناً عبر Let's Encrypt
```bash
sudo certbot --nginx -d monitor.company.com
```

---

## 💾 النسخ الاحتياطي للبيانات

قاعدة البيانات في volume اسمه `nm-data`. للنسخ الاحتياطي:

```bash
# نسخ احتياطي يدوي
docker exec network-monitor cat /app/data/monitoring.db > backup-$(date +%F).db

# أو آلياً عبر cron يومياً (الساعة 2 صباحاً):
crontab -e
# أضف هذا السطر:
0 2 * * * docker exec network-monitor cat /app/data/monitoring.db > /backups/nm-$(date +\%F).db
```

للاستعادة:
```bash
docker exec -i network-monitor sh -c 'cat > /app/data/monitoring.db' < backup-2026-07-19.db
sudo bash deploy.sh restart
```

---

## 🌍 النشر في عدة شركات

المشروع مُصمَّم ليكون **قابلاً لإعادة الاستخدام** في عدة شركات:

### الطريقة الموصى بها: نشر منفصل لكل شركة
لكل شركة:
1. سيرفر Ubuntu مستقل (فيزيائي أو VM أو VPS).
2. استنساخ نفس المستودع من GitHub.
3. ملف `.env` مستقل بإعدادات تلك الشركة (Bot Token مختلف لكل شركة غالباً).
4. أجهزة شبكة تلك الشركة فقط تُضاف عبر لوحة التحكم.

### مزايا هذا النهج:
- ✅ عزل كامل: لا تشارك شركة بيانات مع أخرى.
- ✅ استقلالية الأعطال: توقف شركة لا يوقف الأخرى.
- ✅ إعدادات تلجرام مختلفة لكل شركة (Bot منفصل).
- ✅ أداء أفضل (كل سيرفر يراقب شبكته المحلية مباشرة).

### النشر المتعدد على نفس السيرفر (غير موصى به)
لو أردت عدة نسخ على نفس السيرفر، عدّل `docker-compose.yml` لكل نسخة:
- غيّر `container_name: network-monitor-company1`
- غيّر `ports: ["4001:4000"]` لكل شركة
- استخدم قاعدة بيانات منفصلة لكل حاوية (volume مختلف)

---

## 🔥 Firewall (ufw)

افتح المنفذ 4000 فقط للمصادر الموثوقة (شبكة الشركة):

```bash
sudo ufw allow 22/tcp           # SSH
sudo ufw allow 4000/tcp        # مراقبة (أو اقتصر على subnet الشركة)
# أو للاقتصار على شبكة محلية:
# sudo ufw allow from 192.168.1.0/24 to any port 4000
sudo ufw enable
```

---

## 🐛 استكشاف الأخطاء

### الحاوية لا تبدأ
```bash
sudo bash deploy.sh logs         # راجع آخر السجلات
docker inspect network-monitor   # تفاصيل الحاوية
```

### `better-sqlite3` فشل في البناء
نادر جداً لأن صورة `node:20-bookworm-slim` متوافقة. لو حدث:
```bash
sudo bash deploy.sh uninstall
# عدّل Dockerfile ليستخدم node:20-bookworm (كامل) بدلاً من slim
sudo bash deploy.sh install
```

### منفذ 4000 محجوز
عدّل `HOST_PORT` في ملف `.env`:
```env
HOST_PORT=4001
```
ثم: `sudo bash deploy.sh restart`

### Ping لا يعمل داخل الحاوية
الـ Dockerfile يستخدم `network_mode: host` على لينكس، لذا الحاوية تشترك في شبكة المضيف ويمكنها فحص الأجهزة المحلية. لو استخدمت bridge، أضف:
```yaml
cap_add:
  - NET_RAW    # للسماح بـ ICMP ping
```

---

## ✅ قائمة فحص قبل النشر في الإنتاج

- [ ] غيّرت `DEFAULT_ADMIN_PASSWORD` إلى كلمة مرور قوية
- [ ] غيّرت `SESSION_SECRET` (السكريبت يولّده تلقائياً، لكن تأكد)
- [ ] أضفت Bot Token + Chat ID في `.env`
- [ ] فعلت ufw firewall
- [ ] نسخت `backend/.env` إلى مكان آمن (يحتوي على أسرار)
- [ ] فعّلت HTTPS عبر Nginx + Certbot (للوصول من خارج الشبكة المحلية)
- [ ] ضبطت نسخ احتياطي يومي لـ `monitoring.db`
- [ ] اختبرت تسجيل الدخول + إضافة جهاز + وصول إشعار تلجرام
