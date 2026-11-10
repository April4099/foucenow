Dim WshShell, shortcut
Set WshShell = CreateObject("WScript.Shell")
Set shortcut = WshShell.CreateShortcut("C:\Users\april\Desktop\此刻FocusNow.lnk")
shortcut.TargetPath = "C:\Users\april\WorkBuddy\2026-11-10-17-59-16\focusnow\启动FocusNow.vbs"
shortcut.WorkingDirectory = "C:\Users\april\WorkBuddy\2026-11-10-17-59-16\focusnow"
shortcut.Description = "此刻 FocusNow - 专注日程管理"
shortcut.Save
WScript.Echo "Desktop shortcut created!"
