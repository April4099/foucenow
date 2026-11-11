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
  quitApp: () => ipcRenderer.invoke('app-quit'),
  // 悬浮专注钟（独立置顶窗口）相关
  onFloatState: (callback) => ipcRenderer.on('float-state', (event, state) => callback(state)),
  sendFloatState: (state) => ipcRenderer.send('float-state', state),
  onFloatCmd: (callback) => ipcRenderer.on('float-cmd', (event, type) => callback(type)),
  sendFloatCmd: (type) => ipcRenderer.send('float-cmd', type),
  onFloatRequestState: (callback) => ipcRenderer.on('float-request-state', () => callback()),
  sendFloatRequestState: () => ipcRenderer.send('float-request-state'),
  openFloat: () => ipcRenderer.invoke('open-float'),
  closeFloat: () => ipcRenderer.invoke('close-float'),
  onFloatWindowState: (callback) => ipcRenderer.on('float-window-state', (event, open) => callback(open))
});
