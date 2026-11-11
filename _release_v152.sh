#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "NO TOKEN"; exit 1; fi

API="https://api.github.com/repos/April4099/foucenow"
REL_DIR="C:/Users/april/AppData/Local/Temp/fn_build"

NOTES="v1.5.2 · 应用内更新弹窗

✨ 全新应用内更新体验（替代系统原生对话框）
• 发现新版本时，直接在软件内弹出卡片，清楚展示「本次更新了什么」
• 点「立即更新」即可联网下载，下载进度实时显示
• 下载完成后提示「立即重启」，重启后弹出「更新完成 ✓」再播报本次更新内容
• 设置页新增「检查更新」按钮，可手动触发；已是最新版会有提示

📌 其他
• 修复安装后未自动创建桌面/开始菜单快捷方式的问题（现已强制创建）
• 自动更新流程更稳定，升级后自动生效"

BODY=$(node -e 'const b=process.argv[1];process.stdout.write(JSON.stringify({tag_name:"v1.5.2",name:"v1.5.2 · 应用内更新弹窗",body:b,draft:false,prerelease:false}))' "$NOTES")

# 幂等：若已存在同名 release 则先删除（连同 tag）
EXISTING=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/releases/tags/v1.5.2" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log(o.id||"")}catch(e){console.log("")}})')
if [ -n "$EXISTING" ]; then
  echo "deleting existing release $EXISTING"
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/releases/$EXISTING" >/dev/null
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/git/refs/tags/v1.5.2" >/dev/null
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

upload "$REL_DIR/FocusNow-Setup-1.5.2.exe" "FocusNow-Setup-1.5.2.exe" "application/octet-stream"
upload "$REL_DIR/FocusNow-Setup-1.5.2.exe.blockmap" "FocusNow-Setup-1.5.2.exe.blockmap" "application/octet-stream"
upload "$REL_DIR/latest.yml" "latest.yml" "text/yaml"

echo "DONE"
