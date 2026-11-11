Dim WshShell, shortcut, userProfile, localAppData, fso, folder, file
Set WshShell = CreateObject("WScript.Shell")
userProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
localAppData = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
Set fso = CreateObject("Scripting.FileSystemObject")
Set folder = fso.GetFolder(localAppData & "\Programs\focusnow")
For Each file In folder.Files
  If LCase(fso.GetExtensionName(file.Name)) = "exe" Then
    If InStr(file.Name, "FocusNow") > 0 And LCase(Left(file.Name, 8)) <> "uninstall" Then
      Set shortcut = WshShell.CreateShortcut(userProfile & "\Desktop\FocusNow.lnk")
      shortcut.TargetPath = file.Path
      shortcut.WorkingDirectory = localAppData & "\Programs\focusnow"
      shortcut.Description = "FocusNow"
      shortcut.Save
      WScript.Echo "Desktop shortcut created: " & file.Path
      Exit For
    End If
  End If
Next
