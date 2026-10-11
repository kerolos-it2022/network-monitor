#!/usr/bin/env bash
set -euo pipefail
echo "=== 1. Copying repo to clean build directory ==="
cp -a /repo /build
cd /build/appliance

echo "=== 2. Cleaning any CRLF line endings ==="
find . -type f \( -name "*.sh" -o -name "config" -o -name "*.hook.*" \) -exec sed -i 's/\r$//' {} + 2>/dev/null || true

echo "=== 3. Running build.sh ==="
export NM_VERSION="v2.10.12"
bash build.sh

echo "=== 4. Saving ISO ==="
cp -f network-monitor-appliance-v2.10.12-amd64.iso /out/
cp -f network-monitor-appliance-v2.10.12-amd64.iso /output/
echo "=== 5. Build Complete! ==="
