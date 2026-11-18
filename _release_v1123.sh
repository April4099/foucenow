#!/usr/bin/env bash
# FocusNow v1.12.2 发布脚本：幂等删除旧 release+tag → 创建新 release → 上传附件
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.12.3"
TAG="v$VERSION"
REPO="April4099/foucenow"
GH="https://api.github.com/repos/$REPO"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"
UPLOAD_URL=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log((o.upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})' || true)

NOTES_B64=$(base64 -w0 <<'EOF'
### 🌐 根治「点检查更新没反应」

### ⬇️ 更新下载提速（不再「下载到 10% 就不动」）

有用户反馈下载进度到 10% 就像卡住了。实测发现不是卡住，而是网络到 GitHub 只有约 5 KB/s——80 多 MB 要下好几个小时。这一版重写了下载：

- 优先走国内镜像（实测约 150 KB/s，快约 30 倍），自动测速挑最快通道，失败自动切换。
- 支持断点续传：中断或取消后，已下载部分保留，下次接着下，不用从头来。
- 进度条显示实时速度和已下载量，能清楚看到在慢慢下，而不是"假死"。
- 下载窗口新增「后台下载」和「取消下载」；后台下载时点左下角版本号可随时回到进度。

升级后重新点「检查更新 → 立即更新」即可体验。如果之前下了一半，会直接从断点继续。
EOF
)

BODY_JSON=$(echo "$NOTES_B64" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=Buffer.from(d.trim(),"base64").toString("utf8");process.stdout.write(JSON.stringify(s))})')

if [ -n "$UPLOAD_URL" ]; then
  echo "检测到已存在 $TAG，先删除旧 release 与 tag ..."
  REL_ID=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).id||"")}catch(e){console.log("")}})')
  if [ -n "$REL_ID" ]; then curl -s -X DELETE -H "$AUTH" "$GH/releases/$REL_ID" >/dev/null; fi
  git -c http.version=HTTP/1.1 push origin ":refs/tags/$TAG" 2>/dev/null || true
  sleep 2
fi

echo "创建 release $TAG ..."
CREATE=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GH/releases" \
  -d "{\"tag_name\":\"$TAG\",\"name\":\"FocusNow $VERSION\",\"body\":$BODY_JSON,\"draft\":false,\"prerelease\":false}")
UPLOAD_URL=$(echo "$CREATE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})')
if [ -z "$UPLOAD_URL" ]; then echo "创建 release 失败"; echo "$CREATE"; exit 1; fi
echo "upload_url=$UPLOAD_URL"

upload() {
  local f="$1" name=$(basename "$1")
  echo "上传 $name ..."
  curl -s --retry 3 -X POST -H "$AUTH" -H "Content-Type: application/octet-stream" \
    --data-binary @"$f" "$UPLOAD_URL$name" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log(o.state==="uploaded"?"  OK ":"  状态:"+o.state+" "+JSON.stringify(o).slice(0,100))}catch(e){console.log("  解析失败 "+d.slice(0,100))}})'
}

upload "$REL_DIR/FocusNow-Setup-$VERSION.exe"
upload "$REL_DIR/FocusNow-Setup-$VERSION.exe.blockmap"
upload "$REL_DIR/latest.yml"

echo "✅ v$VERSION 发布完成"
