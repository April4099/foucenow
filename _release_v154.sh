#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "NO TOKEN"; exit 1; fi

API="https://api.github.com/repos/April4099/foucenow"
REL_DIR="C:/Users/april/AppData/Local/Temp/fn_build"

NOTES="v1.5.4 · 日程与时间管理 overhaul

🗓 日程安排修复
• 去重：待安排列表只显示未完成、且当天尚未安排的任务，已完成/已安排不再重复出现
• 日期绑定：安排台与日程表按同一日期绑定，并支持安排今天之后的日程
• 布局：安排台改为整列全宽，去掉多余的横向滚动条

📅 日历热力图（重构）
• 原大日历改为紧凑小日历：日期压成小色块，与日详情上下相排，按专注时长以颜色浓度呈现，便于一眼看整体时间分布

⏱ 悬浮专注钟（新功能）
• 新增可脱离软件本体、默认置顶的独立悬浮窗，使用其他软件时也能继续跑专注计时（播放/重置/跳过/关闭）

↩️ 调整
• 撤回 1.5.3 中时间轴按分类着色的改动（各皮肤适配效果差），恢复统一配色 + 提醒高亮"

BODY=$(node -e 'const b=process.argv[1];process.stdout.write(JSON.stringify({tag_name:"v1.5.4",name:"v1.5.4 · 日程与时间管理 overhaul",body:b,draft:false,prerelease:false}))' "$NOTES")

# 幂等：若已存在同名 release 则先删除（连同 tag）
EXISTING=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/releases/tags/v1.5.4" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log(o.id||"")}catch(e){console.log("")}})')
if [ -n "$EXISTING" ]; then
  echo "deleting existing release $EXISTING"
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/releases/$EXISTING" >/dev/null
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/git/refs/tags/v1.5.4" >/dev/null
fi

echo "creating release..."
CREATE=$(curl -s --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 30 -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY" "$API/releases")
UPLOAD_URL=$(echo "$CREATE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log((o.upload_url||"").replace("{?name,label}","?name="))}catch(e){console.log("")}})')
echo "upload_url=$UPLOAD_URL"
if [ -z "$UPLOAD_URL" ]; then echo "CREATE FAILED:"; echo "$CREATE" | head -c 600; exit 1; fi

upload() {
  local file="$1" name="$2" ctype="$3"
  echo "uploading $name ..."
  curl -s --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 30 --max-time 900 \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: $ctype" \
    --data-binary "@$file" "${UPLOAD_URL}${name}" \
    -o /dev/null -w "  -> HTTP %{http_code} in %{time_total}s\n"
}

upload "$REL_DIR/FocusNow-Setup-1.5.4.exe" "FocusNow-Setup-1.5.4.exe" "application/octet-stream"
upload "$REL_DIR/FocusNow-Setup-1.5.4.exe.blockmap" "FocusNow-Setup-1.5.4.exe.blockmap" "application/octet-stream"
upload "$REL_DIR/latest.yml" "latest.yml" "text/yaml"

echo "DONE"
