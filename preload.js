const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, data) => callback(data)),
  // 窗口控制
  winMin: () => ipcRenderer.invoke('win-min'),
  winMax: () => ipcRenderer.invoke('win-max'),
  winHide: () => ipcRenderer.invoke('win-hide'),
  quitApp: () => ipcRenderer.invoke('app-quit')
});
