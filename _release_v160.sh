#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "NO TOKEN"; exit 1; fi

API="https://api.github.com/repos/April4099/foucenow"
REL_DIR="C:/Users/april/AppData/Local/Temp/fn_build"

NOTES="v1.6.0 · 创新包：自适应重排 / 专注质量 / 周报叙事 / 专注护盾

🧹 自适应重排（新）
• 「智能整理」自动扫描逾期待办、停在过去日期的日程、挂起超一周没安排的待办
• 每条给出可勾选建议：滚到明天 / 转为每周目标 / 放弃，一键应用

📊 专注质量（替代只看时长）
• 计时时自动统计分心次数与暂停次数，落库算出专注质量分 0–100
• 专注页新增「今日专注质量」星级+分数；日历每日专注记录加质量色点

📖 周报叙事化（替代数字仪表盘）
• 日历新增「本周回顾」卡片，基于近 7 天专注记录自动生成中文叙事（累计/活跃天数/最高产的一天/常投时段/主力分类/专注度）

🛡 专注护盾（新）
• 全屏、半透明、常驻置顶浮层，遮住桌面杂乱只留倒计时；与悬浮钟互补
• 专注自然结束自动释放护盾"

BODY=$(node -e 'const b=process.argv[1];process.stdout.write(JSON.stringify({tag_name:"v1.6.0",name:"v1.6.0 · 创新包",body:b,draft:false,prerelease:false}))' "$NOTES")

# 幂等：若已存在同名 release 则先删除（连同 tag）
EXISTING=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/releases/tags/v1.6.0" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log(o.id||"")}catch(e){console.log("")}})')
if [ -n "$EXISTING" ]; then
  echo "deleting existing release $EXISTING"
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/releases/$EXISTING" >/dev/null
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/git/refs/tags/v1.6.0" >/dev/null
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

upload "$REL_DIR/FocusNow-Setup-1.6.0.exe" "FocusNow-Setup-1.6.0.exe" "application/octet-stream"
upload "$REL_DIR/FocusNow-Setup-1.6.0.exe.blockmap" "FocusNow-Setup-1.6.0.exe.blockmap" "application/octet-stream"
upload "$REL_DIR/latest.yml" "latest.yml" "text/yaml"

echo "DONE"
