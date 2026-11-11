#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "NO TOKEN"; exit 1; fi

API="https://api.github.com/repos/April4099/foucenow"
REL_DIR="C:/Users/april/AppData/Local/Temp/fn_build"

NOTES="v1.5.3 · 界面与配色优化

🎨 配色可读性
• 修复粉黑/草莓/Candy/Matcha 等皮肤下，「普通」优先级标签颜色过浅（近白色）在白底上几乎看不见的问题，统一调整为实心可读琥珀色

🗓 时间轴分类着色
• 日程时间轴上的任务现在按「分类」显示不同颜色（工作/学习/生活/健康/设计/绘制/其他…），不再同一颜色
• 提醒事项改为粉色描边环 + 🔔 图标高亮，不再覆盖分类颜色

⚙️ 文案
• 「我的」入口更名为「设置」"

BODY=$(node -e 'const b=process.argv[1];process.stdout.write(JSON.stringify({tag_name:"v1.5.3",name:"v1.5.3 · 界面与配色优化",body:b,draft:false,prerelease:false}))' "$NOTES")

# 幂等：若已存在同名 release 则先删除（连同 tag）
EXISTING=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/releases/tags/v1.5.3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log(o.id||"")}catch(e){console.log("")}})')
if [ -n "$EXISTING" ]; then
  echo "deleting existing release $EXISTING"
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/releases/$EXISTING" >/dev/null
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/git/refs/tags/v1.5.3" >/dev/null
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

upload "$REL_DIR/FocusNow-Setup-1.5.3.exe" "FocusNow-Setup-1.5.3.exe" "application/octet-stream"
upload "$REL_DIR/FocusNow-Setup-1.5.3.exe.blockmap" "FocusNow-Setup-1.5.3.exe.blockmap" "application/octet-stream"
upload "$REL_DIR/latest.yml" "latest.yml" "text/yaml"

echo "DONE"
