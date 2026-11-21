#!/usr/bin/env bash
# 补发 v1.13.0 缺失的主安装包，并发布 v1.14.0
# 用法：在 focusnow 目录执行 bash _publish_pending.sh
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
REPO="April4099/foucenow"
GH="https://api.github.com/repos/$REPO"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

upload_url_for() {
  local tag="$1"
  curl -s -H "$AUTH" "$GH/releases/tags/$tag" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})'
}

asset_state() {
  local tag="$1" name="$2"
  curl -s -H "$AUTH" "$GH/releases/tags/$tag" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);const a=(o.assets||[]).find(x=>x.name===process.argv[1]);console.log(a?a.state:"missing")})' "$name"
}

upload() {
  local url="$1" f="$2" name=$(basename "$2")
  echo "  上传 $name ..."
  curl -s --retry 3 -X POST -H "$AUTH" -H "Content-Type: application/octet-stream" \
    --data-binary @"$f" "$url$name" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log("  状态: "+(o.state||"unknown"))}catch(e){console.log("  无响应（可能上传被中断）")}})'
}

echo "=== 1. 补齐 v1.13.0 ==="
U13=$(upload_url_for v1.13.0)
if [ -z "$U13" ]; then echo "找不到 v1.13.0 release"; exit 1; fi
S13=$(asset_state v1.13.0 FocusNow-Setup-1.13.0.exe)
echo "主安装包当前状态: $S13"
if [ "$S13" != "uploaded" ]; then
  upload "$U13" "$REL_DIR/FocusNow-Setup-1.13.0.exe"
fi
echo "v1.13.0 现有附件:"
curl -s -H "$AUTH" "$GH/releases/tags/v1.13.0" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);console.log((o.assets||[]).map(x=>"  "+x.name+" "+x.state+" "+x.size).join("\n"))})'

echo "=== 2. 发布 v1.14.0 ==="
VERSION="1.14.0"
TAG="v$VERSION"
EXISTING=$(upload_url_for "$TAG")
if [ -n "$EXISTING" ]; then
  echo "已存在 $TAG，先删除旧 release 与 tag ..."
  REL_ID=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).id||"")}catch(e){console.log("")}})')
  if [ -n "$REL_ID" ]; then curl -s -X DELETE -H "$AUTH" "$GH/releases/$REL_ID" >/dev/null; fi
  git -c http.version=HTTP/1.1 push origin ":refs/tags/$TAG" 2>/dev/null || true
  sleep 2
fi

NOTES_B64=$(base64 -w0 <<'EOF'
### 📈 让数据真的能指导行动

- **近 30 天趋势**：每天专注分钟一目了然，不再是孤零零的月度总数。
- **分心来源排行**：最常切走的软件 Top 5，按停留时长排序。从这一版开始记录，老记录没有来源明细，会显示空状态说明。
- **周报导出**：新增「导出周报图片」和「导出周报 CSV」，随时留存或分享。
- **历史分重算**：把老记录按当前「分心时长占比」口径统一重算，原始记录不动，执行前自动备份，可一键撤销。

小提示：设置 → 数据管理里可以找到重算按钮；只有重算过的记录才会在按钮上显示「已重算」。
EOF
)
BODY_JSON=$(echo "$NOTES_B64" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write(JSON.stringify(Buffer.from(d.trim(),"base64").toString("utf8")))})')

CREATE=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GH/releases" \
  -d "{\"tag_name\":\"$TAG\",\"name\":\"FocusNow $VERSION\",\"body\":$BODY_JSON,\"draft\":false,\"prerelease\":false}")
UPLOAD_URL=$(echo "$CREATE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})')
if [ -z "$UPLOAD_URL" ]; then echo "创建 release 失败"; echo "$CREATE"; exit 1; fi
echo "upload_url=$UPLOAD_URL"

upload "$UPLOAD_URL" "$REL_DIR/FocusNow-Setup-$VERSION.exe"
upload "$UPLOAD_URL" "$REL_DIR/FocusNow-Setup-$VERSION.exe.blockmap"
upload "$UPLOAD_URL" "$REL_DIR/latest.yml"

echo "核验 assets ..."
curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);const a=o.assets||[];console.log(a.map(x=>"  "+x.name+" "+x.state+" "+x.size).join("\n"));const need=["FocusNow-Setup-1.14.0.exe","FocusNow-Setup-1.14.0.exe.blockmap","latest.yml"];const ok=need.every(n=>a.some(x=>x.name===n&&x.state==="uploaded"));console.log(ok?"ASSETS_OK":"ASSETS_MISSING");process.exit(ok?0:1)})'

echo "✅ 发布处理完成"
