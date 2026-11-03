#!/usr/bin/env bash
#
# Rootless bootstrap for `npm run capture:acceptance`.
#
#   bash scripts/setup-acceptance-browser.sh      # ~5 min, writes under $HOME
#   source "$HOME/.acceptance-browser-env"        # LD_LIBRARY_PATH + FONTCONFIG_FILE
#   npm run capture:acceptance
#
# On a normal workstation `npx playwright install --with-deps chromium` is all
# you need and this script is unnecessary. It exists for the CI/agent sandbox
# this project is built in, where:
#
#   * there is no root, so `--with-deps` fails the moment it calls sudo;
#   * $HOME is recreated per session, so the browser, the shared libraries and
#     the font all have to be re-fetched every session — hence a script rather
#     than a list of commands in a doc;
#   * no CJK font is installed. The whole UI is Chinese, so without one every
#     screenshot comes out as rows of tofu boxes. Dropping font files into
#     ~/.local/share/fonts is *not* enough: fontconfig only scans directories
#     listed in its config, which is why FONTCONFIG_FILE below is required.
#
# Everything is fetched with `apt-get download` + `dpkg-deb -x`, which unpacks
# into a user directory and never touches the system.
set -euo pipefail

PREFIX="${ACCEPTANCE_BROWSER_PREFIX:-$HOME/.acceptance-browser}"
LIB_DIR="$PREFIX/usr/lib/x86_64-linux-gnu"
FONT_DIR="$PREFIX/usr/share/fonts"
ENV_FILE="$HOME/.acceptance-browser-env"
DEB_DIR="$PREFIX/debs"

# Playwright's own dependency list for chromium on Ubuntu 24.04, minus what the
# base image already has. `t64` suffixes are the 64-bit time_t transition names.
# (Derived by running `ldd` on the downloaded binaries and taking everything
# reported as "not found" — see VERIFY below, which re-checks it every run.)
PACKAGES=(
  libnss3 libnspr4
  libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64
  libcups2t64 libdrm2 libgbm1
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
  libxrender1 libxi6
  libpango-1.0-0 libcairo2 libasound2t64
  libharfbuzz0b libthai0 libpixman-1-0 libxcb-render0 libxcb-shm0
  libavahi-client3 libavahi-common3 libdatrie1 libgraphite2-3
  fonts-noto-cjk
)

echo "==> chromium (playwright)"
npx --yes playwright install chromium

echo "==> shared libraries + CJK font into $PREFIX"
mkdir -p "$DEB_DIR" "$PREFIX"
pushd "$DEB_DIR" >/dev/null
# `apt-get download` writes into the working directory; it needs no privileges.
apt-get download "${PACKAGES[@]}" >/dev/null
for deb in *.deb; do
  dpkg-deb -x "$deb" "$PREFIX"
done
popd >/dev/null

echo "==> fontconfig"
# fontconfig ignores a font directory it was not told about. This config adds
# the extracted one and inherits the system config for everything else.
mkdir -p "$PREFIX/etc"
cat > "$PREFIX/etc/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>$FONT_DIR</dir>
  <cachedir>$PREFIX/fontcache</cachedir>
</fontconfig>
EOF

cat > "$ENV_FILE" <<EOF
export LD_LIBRARY_PATH="$LIB_DIR\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
export FONTCONFIG_FILE="$PREFIX/etc/fonts.conf"
EOF

# VERIFY: name every library still missing, rather than letting playwright
# report only the first one and making this a one-at-a-time guessing game.
echo "==> 依赖自检"
# shellcheck source=/dev/null
source "$ENV_FILE"
missing=$(
  for bin in "$HOME"/.cache/ms-playwright/chromium*/chrome-*linux64/chrome \
             "$HOME"/.cache/ms-playwright/chromium*/chrome-*linux64/chrome-headless-shell; do
    [ -x "$bin" ] && ldd "$bin" 2>/dev/null | awk '/not found/ {print $1}'
  done | sort -u
)
if [ -n "$missing" ]; then
  echo "    还缺这些库，请把对应的包加进本脚本的 PACKAGES 列表后重跑："
  echo "$missing" | sed 's/^/      /'
  exit 1
fi
echo "    动态库齐了"

# Prove it launches *and* renders Chinese before claiming success: a missing
# library shows up as a launch failure, a missing font only as tofu in the
# screenshot, which is exactly the failure this script exists to prevent.
echo "==> smoke test"
node -e '
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Rendered inside the renderer process, because that is where fontconfig is
  // consulted. Two characters of very different stroke density: with a real CJK
  // font 鑫 inks far more pixels than 一, while a missing font renders *both*
  // as the same .notdef box and the two counts come out equal. Measuring text
  // width instead would not catch tofu — the advance width is the same.
  const ink = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 200;
    const ctx = canvas.getContext("2d");
    const count = (char) => {
      ctx.clearRect(0, 0, 200, 200);
      ctx.font = "160px sans-serif";
      ctx.fillText(char, 10, 170);
      const { data } = ctx.getImageData(0, 0, 200, 200);
      let pixels = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 128) pixels += 1;
      return pixels;
    };
    return { thin: count("一"), dense: count("鑫") };
  });
  await browser.close();
  if (ink.thin === 0 || ink.dense < ink.thin * 1.5) {
    throw new Error(
      `CJK 字体没生效，截图会是豆腐块：「一」与「鑫」的着墨像素 ${ink.thin} / ${ink.dense}，` +
      "真字形应当差一个量级",
    );
  }
  console.log(`    chromium ok，中文渲染正常（着墨像素 一=${ink.thin} 鑫=${ink.dense}）`);
})().catch((error) => { console.error("    FAILED:", error.message); process.exit(1); });
'

echo
echo "完成。在跑截图之前先执行："
echo "  source \"$ENV_FILE\""
