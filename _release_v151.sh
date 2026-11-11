#!/usr/bin/env bash
cd "$(dirname "$0")"

REPO="April4099/foucenow"
TAG="v1.5.1"
API="https://api.github.com/repos/$REPO"
UP="https://uploads.github.com/repos/$REPO"
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | tr -d '\r')
AUTH="Authorization: Bearer $TOKEN"

# API 请求：重试多，但单次超时短（避免卡住）
curlx() { curl -s --retry 15 --retry-delay 3 --retry-all-errors --connect-timeout 30 --max-time 120 "$@"; }
# 文件上传：单次超时给足（大 exe 可能慢）
upload() { curl -s --retry 15 --retry-delay 3 --retry-all-errors --connect-timeout 30 --max-time 900 "$@"; }

read -r -d '' NOTE <<'NOTE'
此刻 FocusNow v1.5.1 · 闪退修复版

本次修复（双端）：
- 安卓闪退修复：WebView 改用合成 https 源内联加载，彻底解决 file:// 下 localStorage 报错导致打不开/白屏
- 安卓移除无用的浮动按钮，改用系统原生导航（返回键退后台、多任务上滑关闭）
- Windows 安装包修复：补上 electron-updater 依赖，修复装完后启动即崩溃的问题
- 新增 JS 层 localStorage 兜底，任何环境都能正常启动

安装包：
- Windows：FocusNow-Setup-1.5.1.exe（自动更新已启用，老用户会收到提示）
- 安卓：FocusNow-1.5.1.apk（签名不变，可直接覆盖安装）
NOTE

# 用 node 安全地生成 JSON body
BODY_JSON=$(node -e "console.log(JSON.stringify({tag_name:process.argv[1],name:process.argv[2],body:process.argv[3],draft:false,prerelease:false}))" "$TAG" "v1.5.1 闪退修复版" "$NOTE")

for attempt in 1 2 3 4 5 6 7 8; do
  echo "===== attempt $attempt ====="

  REL_ID=$(curlx -H "$AUTH" "$API/releases/tags/$TAG" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);console.log(o.id||'')}catch(e){console.log('')}})")
  if [ -z "$REL_ID" ]; then
    echo "  创建 v1.5.1 release ..."
    C=$(curlx -X POST -H "$AUTH" -H "Content-Type: application/json" -d "$BODY_JSON" "$API/releases")
    REL_ID=$(echo "$C" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);console.log(o.id||'')}catch(e){console.log('')}})")
    if [ -z "$REL_ID" ]; then echo "  创建失败，重试"; sleep 5; continue; fi
  fi
  echo "  release id=$REL_ID"

  UPLOAD_URL=$(curlx -H "$AUTH" "$API/releases/$REL_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).upload_url||'')}catch(e){console.log('')}})")
  if [ -z "$UPLOAD_URL" ]; then echo "  upload_url 失败，重试"; sleep 5; continue; fi
  BASE="${UPLOAD_URL%\{*}"

  EXPECTED=( "FocusNow-Setup-1.5.1.exe" "FocusNow-Setup-1.5.1.exe.blockmap" "latest.yml" "FocusNow-1.5.1.apk" )
  for f in "${EXPECTED[@]}"; do
    AID=$(curlx -H "$AUTH" "$API/releases/$REL_ID/assets" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d);const m=a.find(x=>x.name==='$f');console.log(m?m.id:'')}catch(e){console.log('')}})")
    [ -n "$AID" ] && { curlx -X DELETE -H "$AUTH" "$API/releases/assets/$AID" >/dev/null; echo "  已删旧 $f"; }
    echo "  上传 $f ..."
    upload -X POST -H "$AUTH" -H "Content-Type: application/octet-stream" --data-binary "@release/$f" "${BASE}?name=$f" >/dev/null
    echo "    -> done rc=$?"
  done

  CNT=$(curlx -H "$AUTH" "$API/releases/$REL_ID/assets" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).length)}catch(e){console.log(0)}})")
  echo "  附件数=$CNT"
  if [ "$CNT" = "4" ]; then
    echo "DONE -> https://github.com/$REPO/releases/tag/$TAG"
    exit 0
  fi
  echo "  附件不全，重试"; sleep 6
done

echo "!! 多次重试仍失败"
exit 1
