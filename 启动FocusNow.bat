@echo off
title 此刻 FocusNow
echo 正在启动 此刻 FocusNow ...
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="file:///%~dp0index.html" --window-size=1280,800
