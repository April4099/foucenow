#!/usr/bin/env bash
# FocusNow v1.15.0 发布脚本
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.15.0"
TAG="v$VERSION"
REPO="April4099/foucenow"
GH="https://api.github.com/repos/$REPO"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

NOTES_B64=$(base64 -w0 <<'EOF'
### 🎨 皮肤更新：浅色不再糊成一片

- 修复浅色皮肤里「白字配浅底」的对比度问题：按钮、勾选框、进度环、标签统一走语义色变量，Primary / Success / Danger 与辅助文字颜色都做了加深。
- 原有 Candy Pop、Matcha、Strawberry 三套浅色皮肤现在 readability 优先，依旧保留原本的气质。
- 新增三套皮肤：**Ocean 深海蓝**、**Paper 纸墨**（浅色高对比）、**Aurora 极光夜色**。设置 → 皮肤里直接切换。

### ✍️ 让产品有内容：意图 → 专注 → 复盘

- **专注意图**：开始前写一句话，结束时随记录保存，在结束小结和日历详情里能回看。每一段时间不再只是数字。
- **每日复盘三问**：今天最专注的一件事、被什么打断、明天要保护哪段时间。按日期保存，周报里可回看一周的轨迹。
- **高光配方**：根据近 90 天的星期、时段、时长、任务类型与质量分，算出属于你的高效组合，给出具体建议；数据不够时给引导而不是瞎猜。
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
curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);const a=o.assets||[];console.log(a.map(x=>"  "+x.name+" "+x.state+" "+x.size).join("\n"));const need=["FocusNow-Setup-1.15.0.exe","FocusNow-Setup-1.15.0.exe.blockmap","latest.yml"];const ok=need.every(n=>a.some(x=>x.name===n&&x.state==="uploaded"));console.log(ok?"ASSETS_OK":"ASSETS_MISSING");process.exit(ok?0:1)})'

echo "✅ v$VERSION 发布完成"
