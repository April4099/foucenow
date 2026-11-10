' 此刻 FocusNow · 静默启动器
' 双击运行，无黑窗闪烁
Dim WshShell, appPath, htmlPath
Set WshShell = CreateObject("WScript.Shell")

' 计算 index.html 的绝对路径（相对于本脚本所在目录）
Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")
htmlPath = fso.GetParentFolderName(WScript.ScriptFullName) & "\index.html"

' Edge 应用模式启动
appPath = """C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"""
WshShell.Run appPath & " --app=""file:///" & Replace(htmlPath, "\", "/") & """ --window-size=1280,800", 0, False

Set WshShell = Nothing
Set fso = Nothing
