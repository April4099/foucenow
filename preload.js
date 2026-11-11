const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  // 更新相关事件监听
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, data) => callback(data)),
  onUpdateDone: (callback) => ipcRenderer.on('update-done', (event, data) => callback(data)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', () => callback()),
  // 渲染端主动拉取可能错过的事件
  pullUpdateEvent: () => ipcRenderer.invoke('pull-update-event'),
  // 渲染端触发下载 / 重启安装
  startUpdateDownload: () => ipcRenderer.invoke('update-start-download'),
  restartToUpdate: () => ipcRenderer.invoke('update-restart'),
  // 窗口控制
  winMin: () => ipcRenderer.invoke('win-min'),
  winMax: () => ipcRenderer.invoke('win-max'),
  winHide: () => ipcRenderer.invoke('win-hide'),
  quitApp: () => ipcRenderer.invoke('app-quit')
});
