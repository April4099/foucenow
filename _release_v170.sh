#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "NO TOKEN"; exit 1; fi

API="https://api.github.com/repos/April4099/foucenow"
REL_DIR="C:/Users/april/AppData/Local/Temp/fn_build"

NOTES="v1.7.0 · 游戏化 + 本地洞察

🏆 游戏化成长（新，零成本零依赖）
• 今日视图「我的成长」：等级（按累计专注分钟）、连续专注天数、累计时长/次数、升级进度条、已解锁成就数
• 日历视图「成就墙」：12 个成就全部基于本地数据自动判定（连续天数 / 累计时长 / 深度沉浸 / 满分 / 全勤 / 零分心 等），无需账号服务器
• 专注完成自动弹 toast 解锁成就

📊 本地数据洞察升级
• 周报新增四个智能标签：环比上周（▲/▼/持平）、最佳时段、分心（零/偶尔/偏多）、节奏（集中/分散）
• 纯本地统计，不花一分钱，让周报更懂你"

BODY=$(node -e 'const b=process.argv[1];process.stdout.write(JSON.stringify({tag_name:"v1.7.0",name:"v1.7.0 · 游戏化 + 本地洞察",body:b,draft:false,prerelease:false}))' "$NOTES")

# 幂等：若已存在同名 release 则先删除（连同 tag）
EXISTING=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/releases/tags/v1.7.0" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log(o.id||"")}catch(e){console.log("")}})')
if [ -n "$EXISTING" ]; then
  echo "deleting existing release $EXISTING"
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/releases/$EXISTING" >/dev/null
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/git/refs/tags/v1.7.0" >/dev/null
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

upload "$REL_DIR/FocusNow-Setup-1.7.0.exe" "FocusNow-Setup-1.7.0.exe" "application/octet-stream"
upload "$REL_DIR/FocusNow-Setup-1.7.0.exe.blockmap" "FocusNow-Setup-1.7.0.exe.blockmap" "application/octet-stream"
upload "$REL_DIR/latest.yml" "latest.yml" "text/yaml"

echo "DONE"
