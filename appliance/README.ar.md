# صورة الأبلاينس — Network Monitor Appliance

[English](README.md) · **العربية**

تحوّل نظام المراقبة إلى **جهاز مخصص (Appliance)** بنفس فكرة أنظمة الجدران النارية: تُقلع الآلة من
الـUSB/CD ← تنصيب تلقائي على القرص ← إعادة تشغيل ← النظام كامل يعمل (دبيان مصغّر + المراقبة + خادم ويب)
وتديره من المتصفح.

```
┌─────────────── ISO (دبيان 12 مصغّر) ────────────────┐
│  Linux + nginx (80) ──► node (127.0.0.1:4001)       │
│  systemd: network-monitor.service                   │
│  nftables: المسموح 80/443 فقط                       │
│  قاعدة البيانات: /var/lib/network-monitor/          │
└─────────────────────────────────────────────────────┘
```

## ١) البناء

### عبر GitHub Actions (المُوصى به — بلا أدوات على جهازك)

1. ارفع المستودع (`appliance/` + `.github/workflows/build-iso.yml`).
2. من **Actions ← Build Appliance ISO ← Run workflow**، أو ارفع وسمًا يبدأ بـ`v`.
3. بعد الانتهاء حمّل الصورة من **Artifacts** (أو من **Releases** لو كان الوسم هو المُشغِّل، مع ملف
   `SHA256SUMS.txt`).

### محليًّا (WSL2 على ويندوز)

```bash
sudo apt-get install -y live-build debootstrap debian-archive-keyring \
  squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin grub2-common \
  mtools dosfstools e2fsprogs parted rsync
cd <المستودع>/appliance
sudo NM_VERSION=v2.50.5 bash build.sh
# الناتج: network-monitor-appliance-v2.50.5-amd64.iso
```

## ٢) التنصيب على جهاز

1. اكتب الصورة على فلاشة USB: Rufus (نمط DD) أو Ventoy أو
   `dd if=network-monitor-appliance-*.iso of=/dev/sdX bs=4M status=progress`.
2. أقلع الجهاز المستهدف من الفلاشة (عطّل Secure Boot — الصورة بتوقيع عادي).
3. تظهر قائمة الكونسول ← اختر **[1] تنصيب النظام على القرص**.
4. اختر القرص ← اكتب `YES` للتأكيد (⚠️ يمسح القرص بالكامل).
5. انتظر النسخ وGRUB ← **سجّل كلمة مرور الأدمن المعروضة** (تظهر مرة واحدة).
6. أعد التشغيل واقلع من القرص.

## ٣) الوصول

| العنصر | القيمة |
|---|---|
| واجهة الويب | `http://<IP-الجهاز>/` |
| مستخدم الأدمن | `admin` + كلمة المرور المولَّدة عند التنصيب |
| كلمة مرور الكونسول | **نفس كلمة مرور الأدمن** — شاشة `tty1` (قائمة `nm-console`) |
| دخول لينكس | المستخدم `sysadmin` بنفس كلمة المرور (من لوحة المفاتيح: `Alt+F2` — وSSH معطّل) |
| المنافذ المفتوحة | 80 و443 فقط (nftables) — وSSH معطّل |
| قاعدة البيانات | `/var/lib/network-monitor/monitoring.db` |
| سجلات الخدمة | `journalctl -u network-monitor` (أو من قائمة الكونسول) |
| تغيير كلمة المرور | اللوحة ← الملف الشخصي، أو خيار `[6]` في قائمة الكونسول — **وتُحدَّث كل الأبواب تلقائيًّا** |

> 🔑 **كلمة مرور واحدة، ثلاثة أبواب:** اللوحة (`admin`) · الكونسول على `tty1` · وحساب لينكس (`sysadmin`).
> والكاتب واحد: `/usr/local/sbin/nm-sync-console-password` يقرأ كلمة المرور من `stdin` (فلا تظهر في `ps`)
> ويكتب بوابة الكونسول `/etc/nm-console.conf` (SHA-512 · 600) ويحدّث `sysadmin`. وخدمة اللوحة (`netmon`)
> تناديه عبر سطر واحد في `sudoers.d/nm-console-sync` — بلا كلمة مرور وبلا أي صلاحية أخرى. و`root` يبقى
> بلا كلمة مرور بالتصميم؛ ادخل بـ`sysadmin` ثم `sudo`.

## ٤) التحديث لاحقًا

- **المسار الكامل:** ابنِ ISO جديدة وأعد التنصيب (⚠️ يمسح البيانات — صدّر نسخة احتياطية من تبويب Backup أولًا).
- **المسار في المكان (المُوصى به):** تبويب **التحديثات** في اللوحة ← فحص ← *نسخة احتياطية + تحديث*. خدمة
  الويب تكتب ملف طلب يحوي **وسمًا فقط**، فيُشغّل `nm-update.path` خدمة `nm-update.service` (root) التي
  تنزّل أرشيف ذلك الإصدار وتعمل `rsync` للكود و`npm ci` ثم تعيد تشغيل الخدمة — وقاعدة البيانات **لا
  تُلمس** مطلقًا، ويُرقّى Node أولًا عند الحاجة (`nm-node-upgrade`). ويمكن الرجوع لإصدار أقدم من نفس
  التبويب، والتقدّم معروض لحظيًّا في الواجهة.

## ٤٫١) تجربة كلمة مرور الأبواب بلا جهاز

```bash
# من جذر المستودع (Docker شغّال) — ١٩ فحصًا: بوابة الكونسول · حساب لينكس · خدمة اللوحة عبر sudo ·
# حدود تلك الصلاحية · وألّا تبقى كلمة مرور صريحة في أي ملف.
docker run --rm -v "$PWD:/work" node:24-bookworm bash /work/appliance/tests/verify-password-doors.sh
```

## ٥) بنية الملفات

```
appliance/
├── build.sh                          باني الصورة (root داخل CI/WSL2)
├── auto/config                       تكوين live-build (bookworm amd64)
├── config/
│   ├── package-lists/                حزم النظام (nginx · nftables…)
│   ├── bootloaders/                  grub-pc · grub-efi · syslinux
│   ├── hooks/live/                   سكربتات البناء داخل الـchroot:
│   │    0050-install-nodejs          تثبيت Node 24 LTS
│   │    0090-create-user             إنشاء مستخدم خدمة netmon
│   │    0100-build-app               تثبيت التطبيق + npm ci
│   │    0110-enable-services         تفعيل وحدات systemd
│   │    0120-fix-perms               الصلاحيات ومنها مساعدات root
│   │    0130-prune-kernels           تصغير الصورة
│   ├── hooks/normal/0990-fix-grub-paths
│   └── includes.chroot/
│       ├── etc/systemd/system/       network-monitor · nm-console · nm-healthcheck(.timer)
│       │                             nm-update(.path/.service) · nm-remote(.path/.service) · nginx drop-in
│       ├── etc/nginx/sites-available/network-monitor
│       ├── etc/nftables.conf         الجدار الناري: 80/443 فقط
│       ├── etc/sudoers.d/nm-console-sync
│       ├── etc/{hostname,issue,motd,os-release}
│       ├── etc/apt/sources.list.d/debian-security.list
│       ├── etc/tmpfiles.d/network-monitor.conf
│       └── usr/local/sbin/           nm-console · nm-install-to-disk · nm-update · nm-node-upgrade
│                                     nm-remote · nm-healthcheck · nm-sync-console-password
└── tests/verify-password-doors.sh    منصة فحص نموذج كلمة المرور في حاوية
```

## ملاحظات

- أول بناء في الـCI قد يكشف اختلافات في إصدارات live-build — ولو فشل، راجع `build.log` في الـartifact.
- كلمة مرور الأدمن **عشوائية لكل تنصيب** (`seedAdmin` يتخطّى إنشاء الحساب لو وُجد مستخدم).
- الصورة تعمل **حيًّا (Live)** أيضًا للتجربة السريعة بلا تنصيب — وبلا حفظ أي بيانات.
- التكاملات للقراءة فقط (ESXi · Synology · Sophos) لا تُنشأ تلقائيًّا؛ الأبلاينس يشغّل المراقبة فقط،
  ومستمع الاكتشاف السلبي لا يحتاج أي اعتمادات إطلاقًا.

## ملفات مرتبطة

| الملف | المحتوى |
|---|---|
| [../docs/DEPLOY.ar.md](../docs/DEPLOY.ar.md) | نشر السيرفر والترقية |
| [../docs/ARCHITECTURE.ar.md](../docs/ARCHITECTURE.ar.md) | آلية التحديث الذاتي في سياقها |
| [../README.ar.md](../README.ar.md) | نظرة عامة على المشروع |
