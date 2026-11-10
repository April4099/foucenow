const { app, BrowserWindow, Menu, Tray, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray = null;
let isQuitting = false;
let updateAvailable = false;

/* ========== 单实例（挂后台后从桌面图标唤回） ========== */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/* ========== 自动更新配置 ========== */
autoUpdater.autoDownload = false; // 不自动下载，先问用户
autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0A0A0E',
    title: '此刻 FocusNow',
    icon: path.join(__dirname, 'icon.png'),
    frame: false, // 完全软件主体：去掉系统标题栏，自绘窗口按钮
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ✕ 不销毁窗口，只隐藏到后台（计时继续）
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // 启动 5 秒后检查更新
  setTimeout(() => {
    checkForUpdates();
  }, 5000);
}

/* ========== 系统托盘（挂后台后可唤回 / 完全退出） ========== */
function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.png'));
  tray.setToolTip('此刻 FocusNow（后台运行中）');
  const menu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: '完全退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/* ========== 更新检查 ========== */
function checkForUpdates() {
  // 开发模式不检查更新
  if (!app.isPackaged) {
    console.log('[更新] 开发模式，跳过更新检查');
    return;
  }
  autoUpdater.checkForUpdates().catch(err => {
    console.log('[更新] 检查失败:', err.message);
  });
}

autoUpdater.on('update-available', (info) => {
  updateAvailable = true;
  const currentVersion = app.getVersion();
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '发现新版本',
    message: `发现新版本 v${info.version}`,
    detail: `当前版本：v${currentVersion}\n新版本：v${info.version}\n\n是否现在下载更新？`,
    buttons: ['立即更新', '稍后再说'],
    defaultId: 0,
    cancelId: 1
  }).then(result => {
    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });
});

autoUpdater.on('update-not-available', () => {
  console.log('[更新] 已是最新版本');
});

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-progress', {
      percent: Math.round(progress.percent),
      speed: Math.round(progress.bytesPerSecond / 1024),
      transferred: Math.round(progress.transferred / 1024 / 1024),
      total: Math.round(progress.total / 1024 / 1024)
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '更新就绪',
    message: '新版本已下载完成',
    detail: '点击「立即重启」完成更新，软件将自动重启。',
    buttons: ['立即重启', '稍后重启'],
    defaultId: 0,
    cancelId: 1
  }).then(result => {
    if (result.response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });
});

autoUpdater.on('error', (err) => {
  console.log('[更新] 错误:', err.message);
});

/* ========== IPC 通信（供渲染进程调用） ========== */
ipcMain.handle('check-update', () => {
  if (!app.isPackaged) return { status: 'dev' };
  autoUpdater.checkForUpdates().catch(() => {});
  return { status: 'checking' };
});

ipcMain.handle('get-version', () => {
  return app.getVersion();
});

// 窗口控制：最小化 / 最大化 / 关闭挂后台 / 完全退出
ipcMain.handle('win-min', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('win-max', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.handle('win-hide', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('app-quit', () => {
  isQuitting = true;
  app.quit();
});

/* ========== 应用生命周期 ========== */
app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // 有托盘时保持后台运行，不做任何事
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else if (mainWindow) mainWindow.show();
});
