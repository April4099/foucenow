const { app, BrowserWindow, Menu, Tray, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray = null;
let isQuitting = false;
let updateAvailable = false;
let cachedUpdateEvent = null; // 缓冲最近一次更新事件，供渲染端错过后补拉

/* 把更新事件发给渲染端；若渲染端尚未就绪，则先缓存，待其 pull 时补发 */
function pushUpdateEvent(type, payload) {
  cachedUpdateEvent = { type, payload };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(type, payload);
  }
}

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

/* ========== 独立悬浮专注钟（可离开主窗口，默认置顶） ========== */
let floatWindow = null;

function createFloatWindow() {
  if (floatWindow) { floatWindow.show(); floatWindow.focus(); return; }
  floatWindow = new BrowserWindow({
    width: 240, height: 300,
    minWidth: 200, minHeight: 260,
    frame: false, transparent: true, skipTaskbar: true,
    alwaysOnTop: true, resizable: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  floatWindow.loadFile('float.html');
  floatWindow.once('ready-to-show', () => floatWindow.show());
  floatWindow.on('closed', () => {
    floatWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('float-window-state', false);
  });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('float-window-state', true);
}

/* 悬浮钟 IPC 中继：主窗口 <-> 悬浮窗 双向同步计时状态与控制指令 */
ipcMain.handle('open-float', () => { createFloatWindow(); return { status: 'opened' }; });
ipcMain.handle('close-float', () => {
  if (floatWindow) { floatWindow.close(); floatWindow = null; }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('float-window-state', false);
  return { status: 'closed' };
});
ipcMain.on('float-state', (e, state) => {
  if (floatWindow) floatWindow.webContents.send('float-state', state);
  if (shieldWindow) shieldWindow.webContents.send('float-state', state);
});
ipcMain.on('float-cmd', (e, cmd) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('float-cmd', cmd); });
ipcMain.on('float-request-state', (e) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('float-request-state'); });

/* 专注护盾：全屏/大尺寸常驻置顶浮层，遮住桌面杂乱、只留计时 */
let shieldWindow = null;

function createShieldWindow() {
  if (shieldWindow) { shieldWindow.show(); shieldWindow.focus(); return; }
  const { screen } = require('electron');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  shieldWindow = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false, transparent: true, skipTaskbar: true,
    alwaysOnTop: true, resizable: false, movable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  shieldWindow.setAlwaysOnTop(true, 'screen-saver');
  shieldWindow.loadFile('shield.html');
  shieldWindow.once('ready-to-show', () => shieldWindow.show());
  shieldWindow.on('closed', () => {
    shieldWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shield-window-state', false);
  });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shield-window-state', true);
}

ipcMain.handle('open-shield', () => { createShieldWindow(); return { status: 'opened' }; });
ipcMain.handle('close-shield', () => {
  if (shieldWindow) { shieldWindow.close(); shieldWindow = null; }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shield-window-state', false);
  return { status: 'closed' };
});

/* ========== 前台「分心应用」检测（Windows 专用） ========== */
let fgMonitor = { active: false, apps: [], timer: null, lastDistract: false };

function buildFgScript() {
  // 取前台窗口所属进程名（PowerShell P/Invoke，base64 编码避免引号转义问题）
  const script = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class FgApi {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);',
    '}',
    '"@',
    '$p = 0u;',
    '[FgApi]::GetWindowThreadProcessId([FgApi]::GetForegroundWindow(), [ref]$p) | Out-Null;',
    '(Get-Process -Id $p).ProcessName'
  ].join('\n');
  return Buffer.from(script, 'utf16le').toString('base64');
}

function queryForegroundProcess() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const b64 = buildFgScript();
  const cp = require('child_process');
  return new Promise((resolve) => {
    cp.execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { windowsHide: true, timeout: 6000, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        const name = (stdout || '').toString().trim().toLowerCase();
        resolve(name || null);
      });
  });
}

async function tickFg() {
  const name = await queryForegroundProcess();
  if (!name) { fgMonitor.lastDistract = false; return; }
  const isDistract = fgMonitor.apps.some(a => name.indexOf(String(a).toLowerCase()) !== -1);
  // 边沿触发：连续停留在分心应用只记 1 次；离开后再进入再记 1 次
  if (isDistract && !fgMonitor.lastDistract) {
    fgMonitor.lastDistract = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-distraction');
  } else if (!isDistract) {
    fgMonitor.lastDistract = false;
  }
}

function startFgMonitor(apps) {
  fgMonitor.apps = (apps || []).map(a => String(a).toLowerCase());
  fgMonitor.active = true;
  fgMonitor.lastDistract = false;
  if (fgMonitor.timer) clearInterval(fgMonitor.timer);
  fgMonitor.timer = setInterval(tickFg, 3000);
}

function stopFgMonitor() {
  fgMonitor.active = false;
  fgMonitor.lastDistract = false;
  if (fgMonitor.timer) { clearInterval(fgMonitor.timer); fgMonitor.timer = null; }
}

ipcMain.handle('focus-monitor-start', (e, apps) => { startFgMonitor(apps); return { status: 'started' }; });
ipcMain.handle('focus-monitor-stop', () => { stopFgMonitor(); return { status: 'stopped' }; });
ipcMain.handle('focus-monitor-set-apps', (e, apps) => {
  fgMonitor.apps = (apps || []).map(a => String(a).toLowerCase());
  return { status: 'set' };
});

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

/* ========== 把 release notes 整理成可读文本 ========== */
function formatNotes(info) {
  let notes = info && info.releaseNotes;
  if (!notes) return '（未提供更新说明）';
  if (Array.isArray(notes)) {
    notes = notes.map(n => (typeof n === 'string' ? n : (n && n.notes) || '')).join('\n');
  }
  notes = String(notes).trim();
  if (!notes) return '（未提供更新说明）';
  notes = notes.replace(/\n{3,}/g, '\n\n'); // 压缩多余空行
  if (notes.length > 1200) notes = notes.slice(0, 1200) + '\n…（内容过长，完整说明见官网 Release）';
  return notes;
}

autoUpdater.on('update-available', (info) => {
  updateAvailable = true;
  const currentVersion = app.getVersion();
  const notes = formatNotes(info);
  pushUpdateEvent('update-available', {
    version: info.version,
    currentVersion,
    notes
  });
});

autoUpdater.on('update-not-available', () => {
  console.log('[更新] 已是最新版本');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-not-available');
  }
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
  const notes = formatNotes(info);
  // 记录到 userData，下一次启动（新版本）时弹出“本次更新内容”
  try {
    fs.writeFileSync(
      path.join(app.getPath('userData'), '.pending-update.json'),
      JSON.stringify({ version: info.version, notes })
    );
  } catch (e) { /* 忽略写入失败 */ }

  pushUpdateEvent('update-downloaded', {
    version: info.version,
    notes
  });
});

/* ========== 启动后检查“上一次更新”并弹窗告知本次更新内容 ========== */
function checkPendingUpdate() {
  const f = path.join(app.getPath('userData'), '.pending-update.json');
  if (!fs.existsSync(f)) return;
  let d;
  try {
    d = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.unlinkSync(f); // 读取后即删除，避免重复提示
  } catch (e) { return; }
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    pushUpdateEvent('update-done', {
      version: d.version,
      notes: d.notes || ''
    });
  }, 1200);
}

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

/* 渲染端点击「立即更新」→ 开始联网下载 */
ipcMain.handle('update-start-download', () => {
  autoUpdater.downloadUpdate();
  return { status: 'downloading' };
});

/* 渲染端点击「立即重启」→ 退出并安装已下载的更新 */
ipcMain.handle('update-restart', () => {
  isQuitting = true;
  autoUpdater.quitAndInstall();
  return { status: 'restarting' };
});

/* 渲染端启动时补拉可能错过的更新事件 */
ipcMain.handle('pull-update-event', () => {
  const ev = cachedUpdateEvent;
  cachedUpdateEvent = null;
  return ev;
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
  checkPendingUpdate(); // 若上次更新已装好，启动后告知本次更新内容
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
