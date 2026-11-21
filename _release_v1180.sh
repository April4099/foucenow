#!/usr/bin/env bash
# FocusNow v1.18.0 发布脚本
set -e
REL_DIR="/c/Users/april/AppData/Local/Temp/fn_build"
VERSION="1.18.0"
TAG="v$VERSION"
GH="https://api.github.com/repos/April4099/foucenow"
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "未找到 GitHub token"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

NOTES_B64=$(base64 -w0 <<'EOF'
### ✍️ 日记：把生活写下来

新增独立的「日记」页面，从侧栏进入，也可以按 Ctrl+K 搜「写日记」直接打开。

- 按日期写，支持标题、正文、心情表情、标签，停止输入 1.5 秒后自动保存，不用点保存也不会丢。
- 一键「插入今日数据」，把当天的专注分钟、完成事项、平均质量分写进日记，让记录和生活连起来。
- 往日记录可搜索、可回看、可编辑、可删除。全部只存在你自己的电脑里。

### ◎ 当前专注位：首页的中心锚点

今日页顶部新增一张大卡片：正在专注时显示当前任务、意图、实时计时和分心状态；空闲时自动从日程/待办里挑出「现在最该做的那件事」，一键开始。首页从信息平铺变成真正的工作台。

### 💡 洞察卡与时光轴

- 今日页新增「今日一句」，基于当天数据生成有温度的观察，也可以一键手动生成。
- 生成的洞察会存进日历页的「洞察时光轴」，按日期倒序排列，随时回看自己的轨迹。

### ⌨ Ctrl+K 命令面板

一个输入框搜所有操作：开始专注、加待办/日程、跳到任意页面、写日记、换皮肤、导出周报、检查更新……上下键选择、回车执行。重度用户会离不开它。

这一版把「专注—记录—回顾」串成了完整的一条线，也是 FocusNow 从工具走向陪伴的一步。
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
curl -s -H "$AUTH" "$GH/releases/tags/$TAG" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);const a=o.assets||[];console.log(a.map(x=>"  "+x.name+" "+x.state+" "+x.size).join("\n"));const need=["FocusNow-Setup-1.18.0.exe","FocusNow-Setup-1.18.0.exe.blockmap","latest.yml"];const ok=need.every(n=>a.some(x=>x.name===n&&x.state==="uploaded"));console.log(ok?"ASSETS_OK":"ASSETS_MISSING");process.exit(ok?0:1)})'
echo "✅ v$VERSION 发布完成"
