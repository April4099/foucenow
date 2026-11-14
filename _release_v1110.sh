#!/usr/bin/env bash
# FocusNow v1.11.0 发布脚本：幂等删除旧 release+tag → 创建新 release → 上传附件
# 说明：用 base64 传递 release notes，规避 git-bash 下中文/换行被转义导致的乱码与字面 \n 问题
set -e

REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.11.0"
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
### ✨ 统一动效系统：交互不再干巴巴

- 建立统一缓动语言（ease-out / spring + 三档时长），替换全站各自为战的过渡曲线。
- 视图切换从硬切改为柔和淡入 + 卡片错峰依次浮现；弹窗与 Toast 弹性入场。
- 所有可点元素统一按压回弹；卡片 hover 轻微抬升与阴影层次；侧栏选中指示条滑动出现；设置折叠箭头旋转、内容渐入。
- 计时环与进度条平滑推进而非每秒硬跳，等宽数字消除计时抖动；补上键盘焦点环、滚动条与主题切换过渡。
- 完整支持系统「减少动态效果」设置。

### 📣 让数据说话

- 专注完成小结：结束那一刻给出「本次 +X 分钟 / 今天累计 / 比昨天 ±Y / 连续 Z 天」，带弹性动效。
- 今日洞察摘要：成长卡下直接显示环比、最佳时段、下一个成就，不用再跑日历页。
- 高效时段提醒：按最近 14 天本地记录算出高产时段，到点轻提示一次；当天不重复、可关闭、设置里可关，数据不足或分散时不打扰。
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
