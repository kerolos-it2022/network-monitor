# 📋 APPLIANCE-HANDOFF.md — حالة الـ Appliance ISO (اقرأني أولاً)

> آخر تحديث: 2026-10-01 — بعد جلسة تشخيص طويلة انتهت بإصلاح الجذر النهائي.
> الفرع: `main` — الكود كله مرفوع على GitHub (origin).
> الملف العام للتسليم: `HANDOFF.md` (جلسة سابقة — يشمل باقي المشروع).

---

## 1) حالة المشروع العامة (كلها تعمل ومُختبرة)

| الميزة | الحالة |
|---|---|
| حفظ ترتيب/فلتر الأجهزة (localStorage) | ✅ |
| «تذكّرني» 30 يوم + فحص الجلسة قبل التوجيه | ✅ |
| شريط نِسبة التشغيل في عرضي البطاقات/الجدول | ✅ |
| `web_port` لفتح واجهة الجهاز على بورت مخصص | ✅ |
| بطاقة «أجهزة مدخل الإنترنت» مثبتة أولى (لا سحب) | ✅ admin + public |
| قياس سرعة الإنترنت (Cloudflare/jsDelivr/unpkg) في أدوات الشبكة | ✅ |
| **Appliance ISO** | ⚠️ الإصلاح الجذري مرفوع — يحتاج بناء وتحقق (القسم 3) |

## 2) الـ Appliance — ما الذي كان يحدث ولماذا

**العَرَض:** عند التنصيب (اختيار الهارد + YES) يبدأ ثم يرجع لاختيار الهارد من جديد
(لوب صامت) — أو شاشة سوداء بعد إقلاع GRUB.

**الجذور التي شُخّصت وأُصلحت (بالترتيب الزمني):**
1. `agetty` override معطوب → getty@tty1 لا يعمل → شاشة سوداء. **مُصلح** (صيغة قياسية).
2. قائمة syslinux vesamenu (شعار دبيان + timeout 0) → استُبدلت بـ **GRUB للـ BIOS**
   (`LB_BOOTLOADER_BIOS=grub-pc`) بقائمة موسومة مخفية.
3. live-build على runners أوبونتو مكسور مع bookworm → **البناء كله داخل حاوية
   `debian:bookworm`** (الـ workflow في GitHub Actions يفعل ذلك).
4. نمط security القديم (404) → `--security false` + ملف مصدر صحيح يدوي في includes.
5. ⭐ **الجذر الأهم لموت التنصيب**: دبيان يثبّت أحيانًا **نواتين** (`6.1.0-50` +
   `6.1.0-53`) بينما شجرة `/usr/lib/modules` لن واحدة فقط — النواة اليتيمة تقلع
   (initramfs يحمل موديولاته الخاصة) لكن `modprobe ext4` يفشل داخل النظام الحي →
   `mount: unknown filesystem type 'ext4'` → موت المثبّت عند mount قرص الهدف.
   **الإصلاح النهائي:**
   - hook `0130-prune-kernels` (chroot): يحذف أي نواة بلا
     `usr/lib/modules/<v>/modules.dep` (مسار فيزيائي — merged-usr) + rm احتياطي.
   - hook `0990` (binary): يقرأ شجرة الموديولات **من filesystem.squashfs نفسه**
     (unsquashfs -ls) ويختار نواة مؤكدة الموديولات ويُرقّع `grub.cfg` + ينشئ
     روابط `/live/vmlinuz` احتياطًا.
6. المثبّت الآن: لوج كامل `/var/log/nm-install.log` + عند أي فشل **يعرض آخر
   الأسطر ويوقف** (لا لوب صامت) + يتسامح مع rsync 23/24 + يقبل YES بأي حالة
   + يستبعد الفلاppy (majors 2,7,11) + إشعار نهائي (IP/بورت/مستخدم/كلمة مرور)
   + نسخة في `/var/lib/network-monitor/FIRST-LOGIN.txt`.
7. كونسول النظام: خدمة `nm-console.service` على tty1 (بديل getty/autologin الهش).
8. واجهة الكونسول **إنجليزية** — كونسول لينكس لا يعرض العربية (رموز مشوهة).

## 3) أول مهمة في الجلسة الجديدة (بالترتيب)

```bash
# 0. شغّل Docker Desktop (يقع أحيانًا):
powershell -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'"

# 1. استخرج آخر ISO من الـ volume (بناء ما بعد الإصلاح النهائي — إن وُجد):
cd "E:\New claude\network-monitor-v2.5.0-dev"
docker run -d --name isoget -v nm_iso_out:/out debian:bookworm sleep 300
docker cp isoget:/out/<أحدث-iso>.iso "E:/New claude/network-monitor-v2.5.0-dev/appliance/"
docker rm -f isoget
# ⚠️ تحقق بالـ hash: md5sum داخل الحاوية مقابل certutil -hashfile على ويندوز

# 2. تحقق سريع من الـ ISO (بدون إقلاع) — المطلوب مسارات مُسَنَّسَنة:
docker run --rm -v "$(pwd -W)/appliance":/mnt debian:bookworm bash -c '
  apt-get update -qq && apt-get install -y -qq xorriso >/dev/null
  xorriso -osirrox on -indev /mnt/*2ddf0f1*.iso -extract /boot/grub/grub.cfg /tmp/g.cfg >/dev/null
  grep -E "linux |initrd " /tmp/g.cfg'
# ✅ المطلوب: vmlinuz-6.1.0-XX (مُسَنَّسَنة)  ❌ الفشل: /live/vmlinuz مجردة

# 3. لو المسارات مجردة أو لا ISO جديد → أعد البناء محليًّا (~20 دقيقة):
docker run --rm --privileged -v "$(pwd -W)":/repo:ro -v nm_iso_out:/out \
  debian:bookworm bash -c 'cp -a /repo /build && cd /build/appliance && \
  NM_VERSION=fresh bash build.sh && cp -f *.iso /out/'
# ثم أعد الخطوة 1-2 للتحقق.
```

## 4) الاختبار الآلي الجاهز (استخدمه بدل التجربة اليدوية)

`appliance/boot-test/e2e.sh` — تنصيب كامل آلي في QEMU:
- قرص فارغ 8G virtio + إقلاع + عدّاد تلقائي + كتابة vda/yes + متابعة اللقطات
  + تحقق نهائي بـ losetup (FIRST-LOGIN.txt / fstab / marker)
- التشغيل: `docker run --rm --privileged -v "$(pwd -W)/appliance":/mnt debian:bookworm bash /mnt/boot-test/e2e.sh "<MD5 للـ ISO>"`
- لقطات كل 30/60 ثانية في `appliance/boot-test/` + النتيجة في `verify.txt`
- ⏱️ ~40 دقيقة تحت TCG (المحاكاة بطيئة — هذا طبيعي)
- ⚠️ درس مُتعلم: شغّل **حاوية واحدة فقط** — إيقاف مهمة الـ Bash لا يوقف الحاوية
  (استخدم `docker stop <id>`)، والحاويات المتوازية تتكتّب على نفس ملفات اللقطات.

## 5) ملاحظات حرجة (دروس الجلسة — لا تكررها)

1. **CRLF**: `.gitattributes` يجبر LF — لو ظهرت `pipefail: invalid option name`
   أو خيارات مكسورة فالملفات CRLF: `find appliance -type f -exec sed -i 's/\r$//' {} +`
2. **لا تنفّذ البناء على الماونت مباشرة** — debootstrap يكسر الروابط الرمزية ويُلوّث
   config/. نظّف بقايا أي محاولة: `rm -f appliance/config/{binary,bootstrap,chroot,common}`
   + `find appliance/config -type l -delete`
3. **`config/hooks/binary/` لا يُقرأ** — ملفات `.hook.binary` تعيش في
   `config/hooks/normal/` و cwd داخلها = `binary/` (مسارات نسبية من هناك!)
4. **live-build قد يترك SYMLINKS افتراضية داخل hooks/** — احذف المكسورة:
   `find appliance/config -type l -delete`
5. **Docker Desktop يقع** — أعده وأعد المحاولة؛ والبناء قد يفشل بسبب الشبكة — أعد المحاولة
6. **قرص E: صغير (5GB)** — احذف ISOs القديمة من `appliance/` قبل النسخ (`df -h /e`)
7. **تحقق بالـ hash دائمًا** بعد docker cp (كتابات الماونت الكبيرة فشلت سابقًا)
8. **md5sum داخل الحاوية**: سابقة `docker run --rm -v ... md5sum /out/x` تفسد
   المسار — استخدم `sh -c '...'` مع MSYS_NO_PATHCONV=1

## 6) بعد نجاح التنصيب في VM (المتوقع)

- إقلاع مباشر (2 ثانية، ESC = قائمة تشخيص) → قائمة إنجليزية → عدّاد 10 ثوانٍ →
  تثبيت تلقائي → اختيار القرص (vda/sda — بدون fd0) → YES (أي حالة) → نسخ →
  إشعار بيانات الدخول (IP/بورت/admin/كلمة مرور + beep) → ريستارت →
  `http://<IP>/` → admin + الكلمة المولدة → **غيّرها فورًا واحذف FIRST-LOGIN.txt**

## 7) لو فشل شيء

- **أثناء التنصيب**: الشاشة تعرض `INSTALL FAILED` + آخر أسطر اللوج وتنتظر ENTER —
  صوّرها/انسخها بالضبط
- **اللوج الكامل**: `/var/log/nm-install.log` على النظام الحي (قبل الريستارت)
- **تشخيص نصي كامل**: QEMU مع `-serial file:serial.log` وأضف `console=ttyS0,115200`
  لأوامر الإقلاع (أو استخدم قائمة ESC → "وضع تشخيص")
- **إعادة البناء دائمًا داخل حاوية debian:bookworm** — live-build الأوبونتو مكسور
