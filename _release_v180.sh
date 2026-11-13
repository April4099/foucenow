#!/usr/bin/env bash
# FocusNow v1.8.0 发布脚本：幂等删除旧 release+tag → 创建新 release → 上传附件
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.8.0"
TAG="v$VERSION"
REPO="April4099/foucenow"
GH="https://api.github.com/repos/$REPO"

# 取 GitHub token（与 git credential 一致）
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"
UPLOAD_URL=$(curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log((o.upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})' || true)

NOTES="### 🐾 桌面宠物 + 视觉观测\n\n- 新增常驻桌面的「桌面宠物」：三种形象（代码小猫 / Emoji / 自定义图片），情绪联动只看前台应用、从不截图，零隐私成本。\n- 新增可选「视觉观测助手」：用你自己的大模型 key，让助手真正看到桌面；截图仅发往你填写的接口，不落盘、可一键关闭、有敏感窗口排除。\n- 默认关闭，并在隐私承诺中说明此例外。\n\n> 桌面宠物与视觉观测为桌面端（打包应用）功能，浏览器预览不可用。"

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
  -d "{\"tag_name\":\"$TAG\",\"name\":\"FocusNow $VERSION\",\"body\":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$NOTES"),\"draft\":false,\"prerelease\":false}")
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
