#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# build.sh — باني صورة appliance لنظام مراقبة الشبكة (Debian 12 live-build).
# يُشغَّل كـ root داخل GitHub Actions أو WSL2:
#   sudo bash appliance/build.sh
# الناتج: network-monitor-appliance-<VERSION>-amd64.iso
# ───────────────────────────────────────────────────────────────────
# الخطوات:
#   1) نسخ مصدر المشروع (backend/frontend/database) إلى includes.chroot
#   2) lb clean ثم lb build (يُنشئ chroot دبيان + squashfs + ISO هجين BIOS/UEFI)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")"

REPO_ROOT="$(cd .. && pwd)"
VERSION="$(cd "$REPO_ROOT" && git describe --tags --always 2>/dev/null \
  || grep -oP '(?<="version":\s")[^"]+' "$REPO_ROOT/backend/package.json" | head -1 \
  || echo dev)"

echo "═══ Network Monitor Appliance — VERSION: $VERSION ═══"

# ── 1) نسخ مصدر المشروع إلى الشجرة التي ستُدمج في النظام الحي ──
APP_INCLUDES="config/includes.chroot/opt/network-monitor"
rm -rf "$APP_INCLUDES"
mkdir -p "$APP_INCLUDES"

# backend + frontend + schema (بدون node_modules — يُبنى داخل chroot في hook،
# لضمان بناء better-sqlite3 (native) لمعمارية/نواة دبيان الصحيحة).
rsync -a \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'database/monitoring.db*' \
  "$REPO_ROOT/backend/"  "$APP_INCLUDES/backend/"
rsync -a "$REPO_ROOT/frontend/" "$APP_INCLUDES/frontend/"
mkdir -p "$APP_INCLUDES/database"
cp "$REPO_ROOT/database/schema.sql" "$APP_INCLUDES/database/schema.sql"

echo "── مصدر المشروع منسوخ إلى includes.chroot ──"

# ── 2) بناء الصورة ──
# lb clean --purge: يمسح cache أي بناء سابق (لو فشل بناء قديم بإعدادات خاطئة
# بقي bootstrap تالف في cache — --purge يضمن بداية نظيفة).
lb clean --purge >/dev/null 2>&1 || true
# مهم: lb build لا ينفّذ auto/config تلقائيًّا — و lb config ينفّذها فقط لو كانت
# قابلة للتنفيذ (exec bit مفقود في checkouts من ويندوز!). لذا نستدعيها صراحةً
# بـ sh — السكريبت يستدعي lb config noauto بالخيارات الفعلية (bookworm/debian).
sh auto/config
lb build 2>&1 | tee build.log

ISO_OUT="network-monitor-appliance-${VERSION}-amd64.iso"
if [ -f live-image-amd64.hybrid.iso ]; then
  mv -f live-image-amd64.hybrid.iso "$ISO_OUT"
  echo "═══ تم البناء: appliance/$ISO_OUT ═══"
else
  echo "!! فشل البناء — لم يُنتج live-build ملف ISO. راجع build.log" >&2
  exit 1
fi
