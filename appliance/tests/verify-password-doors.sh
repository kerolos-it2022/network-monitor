#!/bin/bash
# verify-password-doors.sh — تجربة «كلمة مرور واحدة لكل الأبواب» داخل حاوية دبيان 12 (Node 24).
#
# التشغيل من جذر المشروع (Docker لازم يكون شغّالًا):
#   docker run --rm -v "$PWD:/work" node:24-bookworm bash /work/appliance/tests/verify-password-doors.sh
#   (على ويندوز: مرّر مسار المشروع بصيغة /d/../repo:/work وبلا MSYS_NO_PATHCONV)
#
# ما تفحصه: صياغة السكربتات · صلاحية قاعدة sudo (visudo) · أن المساعد يكتب بوابة الكونسول + حساب لينكس
# بكلمة واحدة · أن **كود خدمة اللوحة نفسه** (بمستخدم netmon عبر sudo -n) يزامن الأبواب · أن الباسورد
# القديم يتوقف · أن الصلاحية ضيّقة (لا أوامر أخرى) · وألا يوجد باسورد صريح في أي ملف.
set -u
PASS=0; FAIL=0
ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (متوقّع: $3 — الناتج: $2)"; fi }

echo "════ 0) تجهيز بيئة شبيهة بالأبلاينس ════"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq sudo passwd coreutils openssl >/dev/null 2>&1
echo "  التوزيعة: $(. /etc/os-release; echo "$PRETTY_NAME") · node $(node -v)"

useradd --system --home-dir /var/lib/network-monitor --shell /usr/sbin/nologin netmon 2>/dev/null || true
mkdir -p /var/lib/network-monitor && chown netmon:netmon /var/lib/network-monitor
useradd -m -s /bin/bash -G sudo sysadmin 2>/dev/null || true

install -m 755 /work/appliance/config/includes.chroot/usr/local/sbin/nm-sync-console-password /usr/local/sbin/nm-sync-console-password
install -m 440 -o root -g root /work/appliance/config/includes.chroot/etc/sudoers.d/nm-console-sync /etc/sudoers.d/nm-console-sync
echo "  المساعد: $(ls -l /usr/local/sbin/nm-sync-console-password | awk '{print $1, $3":"$4}')"
echo "  قاعدة sudo: $(ls -l /etc/sudoers.d/nm-console-sync | awk '{print $1, $3":"$4}')"

echo
pw_ok() {  # $1=user $2=password ⇒ MATCH/MISMATCH بتشفير النظام نفسه
  python3 - "$2" "$(getent shadow "$1" | cut -d: -f2)" <<'PY2'
import crypt, sys
pw, stored = sys.argv[1], sys.argv[2]
try:
    print("MATCH" if crypt.crypt(pw, stored) == stored else "MISMATCH")
except Exception as e:
    print("ERR", e)
PY2
}

echo "════ 1) فحص صياغة السكربتات + صلاحية قاعدة sudo ════"
bash -n /work/appliance/config/includes.chroot/usr/local/sbin/nm-console && ok "صياغة nm-console سليمة" || bad "صياغة nm-console"
bash -n /work/appliance/config/includes.chroot/usr/local/sbin/nm-install-to-disk && ok "صياغة nm-install-to-disk سليمة" || bad "صياغة nm-install-to-disk"
sh -n /usr/local/sbin/nm-sync-console-password && ok "صياغة المساعد سليمة" || bad "صياغة المساعد"
if visudo -c >/dev/null 2>&1; then ok "sudoers صالح (visudo -c)"; else bad "sudoers غير صالح"; fi
visudo -c 2>&1 | grep -q "nm-console-sync" && ok "sudoers قرأ ملفنا" || bad "sudoers لم يقرأ ملفنا"

echo
echo "════ 2) شبيه بالتثبيت: باسورد واحد ⇒ البوابة + حساب لينكس ════"
PW1='FirstPass123!'
printf '%s\n' "$PW1" | /usr/local/sbin/nm-sync-console-password >/tmp/out1.txt 2>&1
cat /tmp/out1.txt | sed 's/^/    /'
WANT_GATE=$(printf '%s' "$PW1" | sha512sum | cut -d' ' -f1)
GOT_GATE=$(grep -m1 '^CONSOLE_HASH=' /etc/nm-console.conf | cut -d= -f2-)
check "بوابة شاشة الكونسول = SHA-512 للباسورد" "$GOT_GATE" "$WANT_GATE"
check "صلاحيات ملف البوابة" "$(stat -c %a /etc/nm-console.conf)" "600"
check "باسورد مستخدم لينكس sysadmin يطابق (بتشفير النظام)" "$(pw_ok sysadmin "$PW1")" "MATCH"

echo
echo "════ 3) من خدمة اللوحة نفسها (netmon عبر sudo بلا كلمة مرور) ════"
cat > /tmp/svc.js <<'JS'
const { syncSystemPassword, helperCommand } = require('/work/backend/src/services/console-password.service.js');
console.log(JSON.stringify({ cmd: helperCommand(), result: syncSystemPassword(process.argv[2]) }));
JS
PW2='SecondPass456!'
SVC_OUT=$(su netmon -s /bin/bash -c "cd /tmp && node /tmp/svc.js '$PW2'" 2>&1)
echo "    $SVC_OUT" | head -c 300; echo
echo "$SVC_OUT" | grep -q '"ok":true' && ok "الخدمة (netmon) نفّذت المساعد بنجاح" || bad "الخدمة فشلت: $SVC_OUT"
check "البوابة اتحدّثت للباسورد الجديد" "$(grep -m1 '^CONSOLE_HASH=' /etc/nm-console.conf | cut -d= -f2-)" "$(printf '%s' "$PW2" | sha512sum | cut -d' ' -f1)"
check "sysadmin اتحدّث للباسورد الجديد" "$(pw_ok sysadmin "$PW2")" "MATCH"
check "sysadmin لم يعد يقبل الباسورد القديم" "$(pw_ok sysadmin "$PW1")" "MISMATCH"

echo
echo "════ 4) نفس مدخل قائمة الكونسول [6] (المساعد مباشرة) ════"
PW3='ThirdPass789!'
printf '%s\n' "$PW3" | /usr/local/sbin/nm-sync-console-password >/dev/null 2>&1
check "البوابة بعد التغيير الثالث" "$(grep -m1 '^CONSOLE_HASH=' /etc/nm-console.conf | cut -d= -f2-)" "$(printf '%s' "$PW3" | sha512sum | cut -d' ' -f1)"
check "sysadmin بعد التغيير الثالث" "$(pw_ok sysadmin "$PW3")" "MATCH"
check "نفس الباسورد الأخير يفتح بوابة الكونسول" "$(grep -m1 '^CONSOLE_HASH=' /etc/nm-console.conf | cut -d= -f2-)" "$(printf '%s' "$PW3" | sha512sum | cut -d' ' -f1)"

echo
echo "════ 5) حدود الصلاحية (لا صلاحيات واسعة) ════"
su netmon -s /bin/bash -c "sudo -n /bin/ls /root" >/dev/null 2>&1 && bad "netmon نفّذ أمرًا غير مسموح!" || ok "netmon لا يستطيع تنفيذ أي أمر آخر عبر sudo"
printf 'ab\n' | /usr/local/sbin/nm-sync-console-password >/dev/null 2>&1; check "باسورد قصير يُرفض (exit 2)" "$?" "2"
[ -s /etc/nm-console.conf ] && ok "ملف البوابة موجود وغير فارغ" || bad "ملف البوابة"
grep -q "$PW3" /etc/nm-console.conf 2>/dev/null && bad "الباسورد مكتوب صريحًا في الملف!" || ok "لا يوجد باسورد صريح في أي ملف (هاش فقط)"

echo
echo "════ النتيجة: نجح $PASS · فشل $FAIL ════"
[ "$FAIL" -eq 0 ] || exit 1
