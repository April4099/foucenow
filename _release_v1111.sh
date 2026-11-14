#!/usr/bin/env bash
# FocusNow v1.11.1 发布脚本：幂等删除旧 release+tag → 创建新 release → 上传附件
# 说明：用 base64 传递 release notes，规避 git-bash 下中文/换行被转义导致的乱码与字面 \n 问题
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.11.1"
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
### 🔔 计时到点不再错过

修复「计时到点 / 切换休息 / 继续专注时几乎没察觉」的问题，排查出多个叠加原因：

- 系统弹窗改用主进程原生 Windows 通知：原先的 HTML5 通知只在授权后才发，桌面端默认不授权，等于从没弹过。现在无需授权、离开软件也能看到，点击可唤起主窗口。
- 新增应用内醒目弹窗：到点弹出大图标 + 本次成果 + 一键「开始休息 / 开始专注 / 再来一段」，不再只靠 3 秒就消失的 toast。
- 修复提示音静默失败：AudioContext 被自动播放策略挂起时不报错也没声音，现在首次交互即解锁并兜底 resume；阶段提示音改为四音上行 / 三音下行，更醒目。
- 自定义计时结束此前完全没有通知，现在与番茄钟一样三层提醒；长休息单独区分。
- 修好设置里那个没生效的「系统通知」开关（默认开启），新增「提示音试听」，顶栏铃铛改为一键测试通知。

验证：更新后点顶栏铃铛应弹出 Windows 通知并听到提示音；设置 → 基本设置 →「提示音试听」可单独验证声音。
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
