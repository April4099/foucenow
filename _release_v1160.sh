#!/usr/bin/env bash
# FocusNow v1.16.0 发布脚本
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.16.0"
TAG="v$VERSION"
REPO="April4099/foucenow"
GH="https://api.github.com/repos/$REPO"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

NOTES_B64=$(base64 -w0 <<'EOF'
### 🔧 修复：重启后还要手动点安装

之前下载完更新，重启程序时只是把包重新下载一遍、然后弹一个「安装」按钮——所以每次都要你手动点一下。

这一版改成：

- **重启即自动安装**：只要更新包已经下载完整，重启程序时会直接静默安装并自动重启到新版本，不再需要手动点。
- 包不完整或网络中断时，会在后台静默补下，下好后自动安装。
- 加了防循环保护：若安装包异常导致连续两次都没装上，会停止自动重试并保留一个手动入口，不会反复折腾你。
- 顺带清理了陈旧的更新标记，避免中途升级过别的版本时误装回旧版。
EOF
)
BODY_JSON=$(echo "$NOTES_B64" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write(JSON.stringify(Buffer.from(d.trim(),"base64").toString("utf8")))})')

UPLOAD_URL=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})' || true)
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
  curl -s --retry 5 --retry-delay 2 --connect-timeout 30 --max-time 900 -X POST \
    -H "$AUTH" -H "Content-Type: application/octet-stream" \
    --data-binary @"$f" "$UPLOAD_URL$name" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log("  状态: "+(o.state||"unknown"))}catch(e){console.log("  无响应")}})'
}

upload "$REL_DIR/FocusNow-Setup-$VERSION.exe"
upload "$REL_DIR/FocusNow-Setup-$VERSION.exe.blockmap"
upload "$REL_DIR/latest.yml"

echo "核验 assets ..."
curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);const a=o.assets||[];console.log(a.map(x=>"  "+x.name+" "+x.state+" "+x.size).join("\n"));const need=["FocusNow-Setup-1.16.0.exe","FocusNow-Setup-1.16.0.exe.blockmap","latest.yml"];const ok=need.every(n=>a.some(x=>x.name===n&&x.state==="uploaded"));console.log(ok?"ASSETS_OK":"ASSETS_MISSING");process.exit(ok?0:1)})'

echo "✅ v$VERSION 发布完成"
