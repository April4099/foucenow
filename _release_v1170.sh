#!/usr/bin/env bash
# FocusNow v1.17.0 发布脚本
set -e
REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.17.0"
TAG="v$VERSION"
GH="https://api.github.com/repos/April4099/foucenow"
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

NOTES_B64=$(base64 -w0 <<'EOF'
### 🪟 修复：悬浮窗不能置顶在所有软件之上

悬浮钟原来用的是默认置顶级别，会被其他置顶窗口或全屏应用盖住。这一版改用最高置顶级别，并在窗口显示、重新获得焦点时再次确认，还加了定期兜底检查，确保它始终浮在最上面。护盾窗口同样做了加固。

### 🎨 皮肤颜色调性回归

上一版为了对比度把颜色压得偏灰。这一版换成高饱和但明度适中的颜色——蓝更蓝、绿更翠、粉更鲜明，按钮白字依然清晰可读。Candy / Matcha / Strawberry / Paper 四套浅色主题都重新调过，主题色卡也同步更新。

### ✨ 交互质感

- 所有卡片统一了悬浮抬升反馈，之前没生效的日记、洞察、复盘、日历详情等现在都有。
- 弹窗内容改为分层入场，选项和按钮交错浮现，不再是一整块硬弹出。
- 设置行、详情区块、周报洞察增加了悬停高亮与浮现动画；下载进度条加了流动高光。
EOF
)
BODY_JSON=$(echo "$NOTES_B64" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write(JSON.stringify(Buffer.from(d.trim(),"base64").toString("utf8")))})')
UPLOAD_URL=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})' || true)
if [ -n "$UPLOAD_URL" ]; then
  REL_ID=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).id||"")}catch(e){console.log("")}})')
  if [ -n "$REL_ID" ]; then curl -s -X DELETE -H "$AUTH" "$GH/releases/$REL_ID" >/dev/null; fi
  git -c http.version=HTTP/1.1 push origin ":refs/tags/$TAG" 2>/dev/null || true
  sleep 2
fi
CREATE=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" "$GH/releases" \
  -d "{\"tag_name\":\"$TAG\",\"name\":\"FocusNow $VERSION\",\"body\":$BODY_JSON,\"draft\":false,\"prerelease\":false}")
UPLOAD_URL=$(echo "$CREATE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})')
if [ -z "$UPLOAD_URL" ]; then echo "创建 release 失败"; echo "$CREATE"; exit 1; fi
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
curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);const a=o.assets||[];console.log(a.map(x=>"  "+x.name+" "+x.state+" "+x.size).join("\n"));const need=["FocusNow-Setup-1.17.0.exe","FocusNow-Setup-1.17.0.exe.blockmap","latest.yml"];const ok=need.every(n=>a.some(x=>x.name===n&&x.state==="uploaded"));console.log(ok?"ASSETS_OK":"ASSETS_MISSING");process.exit(ok?0:1)})'
echo "✅ v$VERSION 发布完成"
