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
  onFloatWindowState: (callback) => ipcRenderer.on('float-window-state', (event, open) => callback(open)),
  // 专注护盾（全屏常驻置顶浮层）
  openShield: () => ipcRenderer.invoke('open-shield'),
  closeShield: () => ipcRenderer.invoke('close-shield'),
  onShieldWindowState: (callback) => ipcRenderer.on('shield-window-state', (event, open) => callback(open)),
  // 前台「分心应用」检测（Windows 专用）
  startFocusMonitor: (apps) => ipcRenderer.invoke('focus-monitor-start', apps),
  stopFocusMonitor: () => ipcRenderer.invoke('focus-monitor-stop'),
  setDistractionApps: (apps) => ipcRenderer.invoke('focus-monitor-set-apps', apps),
  onFocusDistraction: (callback) => ipcRenderer.on('focus-distraction', () => callback()),
  // 桌面宠物（常驻置顶陪伴 + 可选视觉观测）
  openPet: () => ipcRenderer.invoke('open-pet'),
  closePet: () => ipcRenderer.invoke('close-pet'),
  onPetWindowState: (callback) => ipcRenderer.on('pet-window-state', (event, open) => callback(open)),
  sendPetSync: (state) => ipcRenderer.send('pet-sync', state),
  onPetSync: (callback) => ipcRenderer.on('pet-sync', (event, state) => callback(state)),
  onPetRequestState: (callback) => ipcRenderer.on('pet-request-state', () => callback()),
  sendPetRequestState: () => ipcRenderer.send('pet-request-state'),
  onForegroundInfo: (callback) => ipcRenderer.on('foreground-info', (event, info) => callback(info)),
  // 视觉观测：截图（隐藏自身后抓取主屏，压缩为 jpeg dataURL）+ 调用户自有 vision 接口
  captureScreen: async () => {
    const { desktopCapturer } = require('electron');
    ipcRenderer.send('pet-hide');
    await new Promise(r => setTimeout(r, 150));
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
    ipcRenderer.send('pet-show');
    const src = sources && sources[0];
    if (!src) return null;
    let img = src.thumbnail;
    const w = 640;
    const size = img.getSize();
    const ratio = size.height / size.width;
    img = img.resize({ width: w, height: Math.round(w * ratio) });
    return img.toDataURL('image/jpeg', 0.6);
  },
  visionCheck: (payload) => ipcRenderer.invoke('vision-check', payload)
});
