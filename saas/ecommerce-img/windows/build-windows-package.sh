#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$APP_DIR/release"
CACHE_DIR="$RELEASE_DIR/.cache"
PACKAGE_NAME="TU-Scale-Windows-x64-$(date +%Y%m%d)"
PACKAGE_DIR=""
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tuscale-windows.XXXXXX")"

NODE_VERSION="22.23.3"
NODE_ARCHIVE="node-v${NODE_VERSION}-win-x64.zip"
NODE_BASE_URL="https://nodejs.org/download/release/v${NODE_VERSION}"
NODE_ARCHIVE_BYTES="35574076"
PYTHON_VERSION="3.12.10"
PYTHON_ARCHIVE="python-${PYTHON_VERSION}-embeddable-amd64.zip"
PYTHON_URL="https://www.python.org/ftp/python/${PYTHON_VERSION}/${PYTHON_ARCHIVE}"
PYTHON_ARCHIVE_BYTES="11128720"
PYTHON_ARCHIVE_SHA256="156c7eea90d58cd7e91a23f28a0056616b13e9f4cf4901b7b99b837b7848c6da"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

for command in curl find npm node python3 shasum unzip zip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing build command: $command" >&2
    exit 1
  fi
done

cd "$APP_DIR"
npm run build

PACKAGE_DIR="$TEMP_ROOT/$PACKAGE_NAME"
mkdir -p "$PACKAGE_DIR/app/server" "$PACKAGE_DIR/app/waifu2x" "$PACKAGE_DIR/runtime/node" "$PACKAGE_DIR/runtime/python" "$PACKAGE_DIR/licenses"
mkdir -p "$CACHE_DIR"

cp -R "$APP_DIR/dist" "$PACKAGE_DIR/app/dist"
cp "$SCRIPT_DIR/server/windows-static-server.cjs" "$PACKAGE_DIR/app/server/"
cp "$SCRIPT_DIR/server/windows-denoise-server.cjs" "$PACKAGE_DIR/app/server/"
cp "$SCRIPT_DIR/server/waifu2x-upscale.py" "$PACKAGE_DIR/app/server/"
cp "$APP_DIR/server/scunet-denoise.py" "$PACKAGE_DIR/app/server/"
cp "$APP_DIR/server/drunet-denoise.py" "$PACKAGE_DIR/app/server/"
cp "$APP_DIR/server/denoise_detail.py" "$PACKAGE_DIR/app/server/"
cp -R "$APP_DIR/waifu2x/models-scunet" "$PACKAGE_DIR/app/waifu2x/"
cp -R "$APP_DIR/waifu2x/models-drunet" "$PACKAGE_DIR/app/waifu2x/"

cp "$SCRIPT_DIR/package/"* "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/THIRD-PARTY-NOTICES.txt" "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/requirements-windows.txt" "$PACKAGE_DIR/licenses/"
cp "$SCRIPT_DIR/licenses/DRUNET-LICENSE.txt" "$PACKAGE_DIR/licenses/"
cp "$APP_DIR/waifu2x/models-scunet/SCUNET-ONNX-LICENSE.txt" "$PACKAGE_DIR/licenses/"
cp "$APP_DIR/public/models/waifu2x-enhance.LICENSE.txt" "$PACKAGE_DIR/licenses/"

if [ ! -f "$CACHE_DIR/$NODE_ARCHIVE" ] || [ "$(wc -c < "$CACHE_DIR/$NODE_ARCHIVE" | tr -d ' ')" != "$NODE_ARCHIVE_BYTES" ]; then
  node "$SCRIPT_DIR/download-ranged.mjs" "$NODE_BASE_URL/$NODE_ARCHIVE" "$CACHE_DIR/$NODE_ARCHIVE" "$NODE_ARCHIVE_BYTES" 8
fi
curl -4 -fL --http1.1 --connect-timeout 20 --max-time 60 --retry 3 --retry-all-errors "$NODE_BASE_URL/SHASUMS256.txt" -o "$TEMP_ROOT/NODE-SHASUMS256.txt"
(
  cd "$CACHE_DIR"
  grep "  $NODE_ARCHIVE\$" "$TEMP_ROOT/NODE-SHASUMS256.txt" | shasum -a 256 -c -
)
unzip -q "$CACHE_DIR/$NODE_ARCHIVE" -d "$TEMP_ROOT/node"
cp "$TEMP_ROOT/node/node-v${NODE_VERSION}-win-x64/node.exe" "$PACKAGE_DIR/runtime/node/"
cp "$TEMP_ROOT/node/node-v${NODE_VERSION}-win-x64/LICENSE" "$PACKAGE_DIR/runtime/node/"

if [ ! -f "$CACHE_DIR/$PYTHON_ARCHIVE" ] || [ "$(wc -c < "$CACHE_DIR/$PYTHON_ARCHIVE" | tr -d ' ')" != "$PYTHON_ARCHIVE_BYTES" ]; then
  node "$SCRIPT_DIR/download-ranged.mjs" "$PYTHON_URL" "$CACHE_DIR/$PYTHON_ARCHIVE" "$PYTHON_ARCHIVE_BYTES" 8
fi
(
  cd "$CACHE_DIR"
  echo "$PYTHON_ARCHIVE_SHA256  $PYTHON_ARCHIVE" | shasum -a 256 -c -
)
unzip -tq "$CACHE_DIR/$PYTHON_ARCHIVE" >/dev/null
unzip -q "$CACHE_DIR/$PYTHON_ARCHIVE" -d "$PACKAGE_DIR/runtime/python"
mkdir -p "$PACKAGE_DIR/runtime/python/Lib/site-packages"
python3 -m pip install \
  --disable-pip-version-check \
  --only-binary=:all: \
  --platform win_amd64 \
  --implementation cp \
  --python-version 312 \
  --abi cp312 \
  --target "$PACKAGE_DIR/runtime/python/Lib/site-packages" \
  --no-compile \
  -r "$SCRIPT_DIR/requirements-windows.txt"

python3 -c "from pathlib import Path; p=Path(r'$PACKAGE_DIR/runtime/python/python312._pth'); p.write_text('python312.zip\\n.\\nLib/site-packages\\n../../app/server\\nimport site\\n', encoding='utf-8')"
python3 -c "from PIL import Image; image=Image.open(r'$APP_DIR/public/icon-512.png').convert('RGBA'); image.save(r'$PACKAGE_DIR/TU Scale.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"

for required in \
  "$PACKAGE_DIR/app/dist/index.html" \
  "$PACKAGE_DIR/app/dist/models/waifu2x.onnx" \
  "$PACKAGE_DIR/app/server/waifu2x-upscale.py" \
  "$PACKAGE_DIR/app/dist/models/waifu2x-enhance.onnx" \
  "$PACKAGE_DIR/app/dist/models/face_landmarker.task" \
  "$PACKAGE_DIR/app/dist/ocr/tessdata/chi_sim.traineddata.gz" \
  "$PACKAGE_DIR/app/dist/ocr/tessdata/eng.traineddata.gz" \
  "$PACKAGE_DIR/app/waifu2x/models-scunet/scunet_color_real_psnr.onnx" \
  "$PACKAGE_DIR/app/waifu2x/models-scunet/scunet_color_real_psnr.onnx.data" \
  "$PACKAGE_DIR/app/waifu2x/models-drunet/drunet_color.onnx" \
  "$PACKAGE_DIR/runtime/node/node.exe" \
  "$PACKAGE_DIR/runtime/python/python.exe"; do
  if [ ! -f "$required" ]; then
    echo "Package is missing required file: $required" >&2
    exit 1
  fi
done

(
  cd "$PACKAGE_DIR"
  find . -type f ! -name CHECKSUMS-SHA256.txt -print | LC_ALL=C sort | while IFS= read -r file; do
    shasum -a 256 "$file"
  done > CHECKSUMS-SHA256.txt
)

mkdir -p "$RELEASE_DIR"
rm -f "$RELEASE_DIR/$PACKAGE_NAME.zip" "$RELEASE_DIR/$PACKAGE_NAME.zip.sha256"
(
  cd "$TEMP_ROOT"
  zip -qry -X "$RELEASE_DIR/$PACKAGE_NAME.zip" "$PACKAGE_NAME"
)
(
  cd "$RELEASE_DIR"
  shasum -a 256 "$PACKAGE_NAME.zip" > "$PACKAGE_NAME.zip.sha256"
)

echo "Windows package: $RELEASE_DIR/$PACKAGE_NAME.zip"
echo "SHA-256 file: $RELEASE_DIR/$PACKAGE_NAME.zip.sha256"
