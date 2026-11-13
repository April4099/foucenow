#!/usr/bin/env bash
# FocusNow v1.9.0 发布脚本：幂等删除旧 release+tag → 创建新 release → 上传附件
# 说明：用 base64 传递 release notes，规避 git-bash 下中文/换行被转义导致的乱码与字面 \n 问题
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.9.0"
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
### 📖 首次启动新手引导

- 全新安装后自动弹出 4 步欢迎引导：产品定位（全本地零隐私）→ 三步上手（专注计时 / 待办日程 / 自动沉淀）→ 特色玩法（护盾 / 悬浮钟 / 分心应用名单）→ 开始第一次专注。
- 带进度圆点与跳过按钮，不打扰老用户；设置页新增「新手引导」按钮，随时可以重看。

### ✨ 空状态优化

- 今日视图区分「还没有任务」与「今天全部完成」两种情况，给出明确的下一步指引。
- 日程空态提示去哪里安排；成就墙在 0 成就时提示「完成第一次专注即可解锁首个成就」。
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
