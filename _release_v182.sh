#!/usr/bin/env bash
# FocusNow v1.8.2 发布脚本：幂等删除旧 release+tag → 创建新 release → 上传附件
# 说明：用 base64 传递 release notes，规避 git-bash 下中文/换行被转义导致的乱码与字面 \n 问题
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.8.2"
TAG="v$VERSION"
REPO="April4099/foucenow"
GH="https://api.github.com/repos/$REPO"

# 取 GitHub token（与 git credential 一致）
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"
UPLOAD_URL=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log((o.upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})' || true)

# release notes：heredoc 原样保留中文与换行，base64 编码后交给 node 转 JSON（locale 无关，不乱码）
NOTES_B64=$(base64 -w0 <<'EOF'
### 🧹 移除桌面宠物

- 移除「桌面宠物」整套功能，以及作为其附加能力的「视觉观测助手」（API 截图看屏）。代码、独立窗口、设置分区与依赖全部删除，不留死代码。
- 既然实战效果不理想，与其强行保留一个用不上的功能，不如让产品更聚焦。

### ✅ 保留并持续打磨的核心

- 专注计时、分心应用名单、专注护盾、可离开软件的悬浮钟。
- 游戏化成长（连续天数 / 等级 / 成就）、本地数据洞察（周报环比 / 最佳时段 / 分心趋势）。
- 设置页可折叠分区、更新弹窗说明优化。
EOF
)

BODY_JSON=$(echo "$NOTES_B64" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=Buffer.from(d.trim(),"base64").toString("utf8");process.stdout.write(JSON.stringify(s))})')

# 幂等：若已存在同 tag 的 release，先删除（release + tag）
if [ -n "$UPLOAD_URL" ]; then
  echo "检测到已存在 $TAG，先删除旧 release 与 tag ..."
  REL_ID=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).id||"")}catch(e){console.log("")}})')
  if [ -n "$REL_ID" ]; then
    curl -s -X DELETE -H "$AUTH" "$GH/releases/$REL_ID" >/dev/null
  fi
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
  curl -s -X POST -H "$AUTH" -H "Content-Type: application/octet-stream" \
    --data-binary @"$f" "$UPLOAD_URL$name" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log(o.state==="uploaded"?"  OK ":"  状态:"+o.state)}catch(e){console.log("  解析失败")}})'
}

upload "$REL_DIR/FocusNow-Setup-$VERSION.exe"
upload "$REL_DIR/FocusNow-Setup-$VERSION.exe.blockmap"
upload "$REL_DIR/latest.yml"

echo "✅ v$VERSION 发布完成"
