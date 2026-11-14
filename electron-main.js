const { app, BrowserWindow, Menu, Tray, shell, ipcMain, Notification } = require('electron');
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
const FG_POLL_SEC = 3;
let fgMonitor = { active: false, apps: [], allow: [], timer: null, lastDistract: false };

function normalizeFgCfg(cfg) {
  if (Array.isArray(cfg)) return { apps: cfg, allow: [] };
  const o = cfg && typeof cfg === 'object' ? cfg : {};
  return { apps: o.apps || [], allow: o.allow || [] };
}
const lowerList = a => (a || []).map(x => String(x).toLowerCase());

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
    '$name = (Get-Process -Id $p).ProcessName;',
    '$name'
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
        resolve(name ? name : null);
      });
  });
}

async function tickFg() {
  const name = await queryForegroundProcess();
  if (!name) { fgMonitor.lastDistract = false; return; }
  const inAllow = fgMonitor.allow.some(a => name.indexOf(a) !== -1);
  const isDistract = !inAllow && fgMonitor.apps.some(a => name.indexOf(a) !== -1);
  if (isDistract) {
    const entered = !fgMonitor.lastDistract;
    fgMonitor.lastDistract = true;
    // 按「停留时长」上报：每次轮询累加 FG_POLL_SEC 秒；entered 仅用于统计段数
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('focus-distraction-time', { seconds: FG_POLL_SEC, entered });
    }
  } else {
    fgMonitor.lastDistract = false;
  }
}

function startFgMonitor(cfg) {
  const c = normalizeFgCfg(cfg);
  fgMonitor.apps = lowerList(c.apps);
  fgMonitor.allow = lowerList(c.allow);
  fgMonitor.active = true;
  fgMonitor.lastDistract = false;
  if (fgMonitor.timer) clearInterval(fgMonitor.timer);
  fgMonitor.timer = setInterval(tickFg, FG_POLL_SEC * 1000);
}

function stopFgMonitor() {
  fgMonitor.active = false;
  fgMonitor.lastDistract = false;
  if (fgMonitor.timer) { clearInterval(fgMonitor.timer); fgMonitor.timer = null; }
}

ipcMain.handle('focus-monitor-start', (e, cfg) => { startFgMonitor(cfg); return { status: 'started' }; });
ipcMain.handle('focus-monitor-stop', () => { stopFgMonitor(); return { status: 'stopped' }; });
ipcMain.handle('focus-monitor-set-apps', (e, cfg) => {
  const c = normalizeFgCfg(cfg);
  fgMonitor.apps = c.apps;
  fgMonitor.allow = c.allow;
  return { status: 'set' };
});

/* ========== 自动本地备份（防重装 / 清数据导致的历史归零） ========== */
const BACKUP_KEEP = 7;
const BACKUP_NAME_RE = /^focusnow-\d{4}-\d{2}-\d{2}\.json$/;

function backupDir() {
  const d = path.join(app.getPath('userData'), 'backups');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* ignore */ }
  return d;
}

function writeBackup(json) {
  try {
    if (typeof json !== 'string' || !json) return { ok: false, error: 'empty' };
    const d = backupDir();
    const day = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(d, 'focusnow-' + day + '.json'), json, 'utf8');
    const files = fs.readdirSync(d).filter(f => BACKUP_NAME_RE.test(f)).sort();
    while (files.length > BACKUP_KEEP) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(d, old)); } catch (e) { /* ignore */ }
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function listBackups() {
  try {
    const d = backupDir();
    return fs.readdirSync(d).filter(f => BACKUP_NAME_RE.test(f)).sort().reverse().map(f => {
      const st = fs.statSync(path.join(d, f));
      return { name: f, size: st.size, mtime: st.mtime.toISOString() };
    });
  } catch (e) { return []; }
}

ipcMain.handle('backup-save', (e, json) => writeBackup(json));
ipcMain.handle('backup-list', () => listBackups());
ipcMain.handle('backup-read', (e, name) => {
  if (!BACKUP_NAME_RE.test(String(name || ''))) return null;
  try { return fs.readFileSync(path.join(backupDir(), name), 'utf8'); } catch (e) { return null; }
});

/* ========== 原生系统通知（不依赖渲染进程 HTML5 通知权限） ========== */
// Windows 下设置 AppUserModelID，否则系统 toast 可能不稳定
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.focusnow.app'); } catch (e) { /* ignore */ }
}

ipcMain.handle('show-notification', (e, payload) => {
  const { title, body } = payload || {};
  try {
    if (!Notification.isSupported()) return { ok: false, reason: 'unsupported' };
    const n = new Notification({
      title: String(title || '此刻 FocusNow'),
      body: String(body || ''),
      silent: false // 系统通知自带提示音，即使主窗口隐藏也能听见
    });
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    n.show();
    return { ok: true };
  } catch (err) { return { ok: false, reason: err.message }; }
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
  if (!notes) return '';
  if (Array.isArray(notes)) {
    notes = notes.map(n => (typeof n === 'string' ? n : (n && n.notes) || '')).join('\n\n');
  }
  notes = String(notes || '').trim();
  if (!notes) return '';
  // 去掉任何 HTML 标签（GitHub 返回的说明可能夹带 <pr> / <br> / <p> 等裸标签，避免原样显示）
  notes = notes.replace(/<[^>]+>/g, '');
  // 解码常见 HTML 实体
  notes = notes
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  // 还原 bash 转义残留的字面 \n（反斜杠 + n）为真实换行
  notes = notes.replace(/\\n/g, '\n');
  // 压缩多余空行
  notes = notes.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (notes.length > 1400) notes = notes.slice(0, 1400) + '\n…（完整说明见 GitHub Release）';
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
