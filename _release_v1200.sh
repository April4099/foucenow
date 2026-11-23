#!/usr/bin/env bash
# FocusNow v1.20.0 发布脚本
set -e
REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.20.0"
TAG="v$VERSION"
GH="https://api.github.com/repos/April4099/foucenow"
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

NOTES_B64=$(base64 -w0 <<'EOF'
### 🔕 已完成任务不再提示

修复了「过去已经完成的任务仍在主页提示」的问题。现在三处提示都会跳过已完成的事项：

- 主页「即将提醒」卡片不再显示已完成日程。
- 「当前专注位」不会再把已完成的日程/待办当成「现在最该做的那件事」推荐。
- 日程到点也不会为已完成任务弹系统通知。

历史记录里已完成的条目仍会正常显示（带删除线和 ✓），只是不再作为待办提示打扰你。
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
curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);const a=o.assets||[];console.log(a.map(x=>"  "+x.name+" "+x.state+" "+x.size).join("\n"));const need=["FocusNow-Setup-1.20.0.exe","FocusNow-Setup-1.20.0.exe.blockmap","latest.yml"];const ok=need.every(n=>a.some(x=>x.name===n&&x.state==="uploaded"));console.log(ok?"ASSETS_OK":"ASSETS_MISSING");process.exit(ok?0:1)})'
echo "✅ v$VERSION 发布完成"
