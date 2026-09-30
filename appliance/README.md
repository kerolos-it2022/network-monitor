# Network Monitor Appliance — صورة ISO قابلة للتنصيب

تحويل نظام مراقبة الشبكة إلى **جهاز مخصص (Appliance)** — زي أنظمة الجدران النارية:
تقلع الجهاز من الـ USB/CD → تثبيت تلقائي على القرص → إعادة تشغيل → النظام يعمل
كاملًا (نظام تشغيل مصغّر + المراقبة + خادم ويب) وتديره من المتصفح.

```
┌─────────────── ISO (Debian 12 مصغّر) ───────────────┐
│  Linux + nginx (80) ──► node (127.0.0.1:4001)       │
│  systemd: network-monitor.service                   │
│  nftables: فقط 80/443 مسموحة                        │
│  قاعدة البيانات: /var/lib/network-monitor/          │
└─────────────────────────────────────────────────────┘
```

---

## 1) البناء

### عبر GitHub Actions (الموصى به — بدون أدوات على جهازك)
1. ارفع المجلد إلى GitHub (`appliance/` + `.github/workflows/build-iso.yml`).
2. من تبويب **Actions → Build Appliance ISO → Run workflow** (أو ارفع tag يبدأ بـ `v`).
3. بعد اكتمال البناء: حمّل الـ ISO من **Artifacts** (أو من **Releases** لو tag).

### محليًّا عبر WSL2
```bash
# داخل WSL2 (Ubuntu/Debian):
sudo apt-get install -y live-build debootstrap debian-archive-keyring \
  squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin grub2-common \
  mtools dosfstools e2fsprogs parted rsync
cd /mnt/e/<مسار المشروع>/appliance
sudo bash build.sh
# الناتج: network-monitor-appliance-<VERSION>-amd64.iso
```

## 2) التثبيت على الجهاز (زي سوفوس)

1. **حرق الصورة على USB**: Rufus (نمط DD) أو Ventoy أو:
   `dd if=network-monitor-appliance-*.iso of=/dev/sdX bs=4M status=progress`
2. **الإقلاع من الـ USB** على الجهاز المستهدف (عطّل Secure Boot — الصورة توقيعها عادي).
3. ستظهر قائمة الكونسول → اختر **[1] تثبيت النظام على القرص الصلب**.
4. اختر القرص → اكتب `YES` للتأكيد (⚠️ يمسح القرص بالكامل).
5. انتظر النسخ + GRUB → **سجّل كلمة مرور admin المعروضة** (تظهر مرة واحدة).
6. أعد التشغيل واقلع من القرص الصلب.

## 3) الوصول

| العنصر | القيمة |
|---|---|
| الواجهة | `http://<IP-الجهاز>/` |
| مستخدم الأدمن | `admin` + كلمة المرور المولدة عند التثبيت |
| منافذ مفتوحة | 80, 443 فقط (nftables) — SSH معطّل |
| قاعدة البيانات | `/var/lib/network-monitor/monitoring.db` |
| سجلات الخدمة | `journalctl -u network-monitor` (أو من قائمة الكونسول) |
| تغيير كلمة المرور | من لوحة التحكم → الملف الشخصي (احرص على تغييرها فورًا) |

## 4) تحديث النظام لاحقًا

- **الطريقة الكاملة**: ابنِ ISO جديد وثبّته (تحذير: يمسح البيانات — خذ نسخة احتياطية من تبويب Backup أولاً).
- **تحديث سريع للتطبيق فقط** (من مستقبلًا): استبدال `/opt/network-monitor` + `systemctl restart network-monitor`.

## 5) بنية الملفات

```
appliance/
├── build.sh                     باني الصورة (root داخل CI/WSL2)
├── auto/config                  تكوين live-build (bookworm amd64)
├── config/
│   ├── package-lists/           حزم النظام (nginx, nodejs, nftables…)
│   ├── hooks/live/              بناء المشروع داخل النظام (npm ci + services)
│   └── includes.chroot/
│       ├── etc/systemd/system/network-monitor.service
│       ├── etc/nginx/sites-available/network-monitor
│       ├── etc/nftables.conf
│       ├── etc/systemd/system/getty@tty1.service.d/autologin.conf
│       ├── root/.profile
│       └── usr/local/sbin/{nm-console, nm-install-to-disk}
└── README.md
```

## ملاحظات

- أول بناء في CI قد يكشف اختلافات في إصدارات live-build — إن فشل، راجع `build.log` في الـ artifact/log.
- كلمة مرور admin **عشوائية لكل تثبيت** — آلية `seedAdmin` الموجودة تتخطى الإنشاء إن وُجد مستخدم.
- الصورة تعمل **حيًّا (Live)** أيضًا للتجربة بدون تثبيت — بدون حفظ بيانات.
