#!/usr/bin/env bash
set -euo pipefail
echo "=== 1. Copying repo to clean build directory ==="
cp -a /repo /build
cd /build/appliance

echo "=== 2. Cleaning any CRLF line endings ==="
find . -type f \( -name "*.sh" -o -name "config" -o -name "*.hook.*" \) -exec sed -i 's/\r$//' {} + 2>/dev/null || true

echo "=== 3. Running build.sh ==="
# v2.13.7 — NM_VERSION لم يعد مثبّتًّا يدويًّا (كان يعلق اسم الإصدار والعٌنى 2.13.0 رغم تقدم الكود):
# build.sh يقرأ الإصدار تلقائيًّا من git describe ثم package.json (البديل الموثوق حاليًّا = 2.13.7).
bash build.sh

echo "=== 4. Saving ISO ==="
ISO_NAME=$(ls -1 network-monitor-appliance-*-amd64.iso | head -n1)
cp -f "$ISO_NAME" /out/
cp -f "$ISO_NAME" /output/
echo "=== 5. Build Complete! ($ISO_NAME) ==="
