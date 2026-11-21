#!/usr/bin/env bash
# FocusNow v1.13.0 发布脚本
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.13.0"
TAG="v$VERSION"
REPO="April4099/foucenow"
GH="https://api.github.com/repos/$REPO"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"
UPLOAD_URL=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log((o.upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})' || true)

NOTES_B64=$(base64 -w0 <<'EOF'
### ⌨ 全局快捷键来了

不用先找到窗口、也不用切到专注页——在任何界面按一下就能开始专注。

- **Ctrl + Alt + S**：开始 / 暂停计时
- **Ctrl + Alt + H**：老板键，一键隐藏所有窗口（包括护盾和悬浮钟），再按一次恢复；计时不会中断
- **Ctrl + Alt + E**：只收起护盾和悬浮钟，主窗口保持不动
- 三个快捷键都可以在「设置 → 基本设置 → 全局快捷键」里关闭，开关状态会记住

快捷键由系统级注册，即使软件在后台也能用；若与别的软件冲突会提示注册失败，换一个再开即可。
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

echo "核验 assets ..."
curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);const a=(o.assets||[]).map(x=>x.name+" "+x.state+" "+x.size);console.log(a.join("\n"));const need=["FocusNow-Setup-1.13.0.exe","FocusNow-Setup-1.13.0.exe.blockmap","latest.yml"];const ok=need.every(n=>(o.assets||[]).some(x=>x.name===n&&x.state==="uploaded"));console.log(ok?"ASSETS_OK":"ASSETS_MISSING");process.exit(ok?0:1)})'

echo "✅ v$VERSION 发布完成"
