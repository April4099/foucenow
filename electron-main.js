const { app, BrowserWindow, Menu, Tray, shell, ipcMain, Notification, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray = null;
let isQuitting = false;
let updateAvailable = false;
let cachedUpdateEvent = null; // 缓冲最近一次更新事件，供渲染端错过后补拉
let pendingInstall = null;    // { version, notes }：已下载但尚未安装（持久化到 userData）
let updaterHasDownload = false; // autoUpdater 本进程内是否已有可安装的下载包
let installAfterDownload = false; // 用户点了「立即重启」但需先重新下载（命中缓存）再安装
let silentRecheck = false;    // 启动恢复流程：检查到新版本后自动下载，不弹「发现新版本」
let trayState = { todayMin: 0, running: false }; // 由渲染层上报，用于托盘菜单

const PENDING_INSTALL_FILE = () => path.join(app.getPath('userData'), '.pending-install.json');

function savePendingInstall(d) {
  pendingInstall = d ? { version: d.version, notes: d.notes || '' } : null;
  try {
    if (d) fs.writeFileSync(PENDING_INSTALL_FILE(), JSON.stringify(pendingInstall));
    else if (fs.existsSync(PENDING_INSTALL_FILE())) fs.unlinkSync(PENDING_INSTALL_FILE());
  } catch (e) { /* 忽略写入失败 */ }
  updateTrayMenu();
}

/* 自动安装尝试计数：防止安装包损坏时每次启动都反复触发安装 */
const AUTO_INSTALL_ATTEMPTS_FILE = () => path.join(app.getPath('userData'), '.auto-install-attempts.json');
function readAutoAttempts(version) {
  try {
    const d = JSON.parse(fs.readFileSync(AUTO_INSTALL_ATTEMPTS_FILE(), 'utf8'));
    return d && d.version === version ? (Number(d.count) || 0) : 0;
  } catch (e) { return 0; }
}
function writeAutoAttempts(version, count) {
  try { fs.writeFileSync(AUTO_INSTALL_ATTEMPTS_FILE(), JSON.stringify({ version, count })); } catch (e) { /* ignore */ }
}
function clearAutoAttempts() {
  try { if (fs.existsSync(AUTO_INSTALL_ATTEMPTS_FILE())) fs.unlinkSync(AUTO_INSTALL_ATTEMPTS_FILE()); } catch (e) { /* ignore */ }
}

/* ========== 全局快捷键：开始/暂停、老板键、收起浮层 ========== */
const SHORTCUT_FILE = () => path.join(app.getPath('userData'), '.shortcuts.json');
const SHORTCUTS = {
  'toggle-timer': 'Ctrl+Alt+S',
  'toggle-hide': 'Ctrl+Alt+H',
  'dismiss-overlay': 'Ctrl+Alt+E'
};
let shortcutsEnabled = true;

function loadShortcutsEnabled() {
  try {
    if (fs.existsSync(SHORTCUT_FILE())) {
      return JSON.parse(fs.readFileSync(SHORTCUT_FILE(), 'utf8')).enabled !== false;
    }
  } catch (e) { /* 配置损坏时回退默认开启 */ }
  return true;
}

function sendShortcutCommand(type) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut-cmd', type);
}

function dismissOverlay() {
  try { if (shieldWindow && !shieldWindow.isDestroyed() && shieldWindow.isVisible()) shieldWindow.hide(); } catch (e) {}
  try { if (floatWindow && !floatWindow.isDestroyed() && floatWindow.isVisible()) floatWindow.hide(); } catch (e) {}
}

function toggleHideAll() {
  const anyVisible = [mainWindow, floatWindow, shieldWindow]
    .some(w => w && !w.isDestroyed() && w.isVisible());
  if (anyVisible) {
    dismissOverlay();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  if (!shortcutsEnabled) return;
  Object.keys(SHORTCUTS).forEach(type => {
    try {
      const ok = globalShortcut.register(SHORTCUTS[type], () => {
        if (type === 'toggle-timer') sendShortcutCommand(type);
        else if (type === 'toggle-hide') toggleHideAll();
        else if (type === 'dismiss-overlay') dismissOverlay();
      });
      if (!ok) console.warn('[shortcut] 注册失败，可能被其他程序占用:', SHORTCUTS[type]);
    } catch (e) { console.warn('[shortcut] 注册异常:', e.message); }
  });
}

function setShortcutsEnabled(enabled) {
  shortcutsEnabled = !!enabled;
  try { fs.writeFileSync(SHORTCUT_FILE(), JSON.stringify({ enabled: shortcutsEnabled })); } catch (e) {}
  registerShortcuts();
}

function sendTrayCommand(type) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tray-cmd', type);
}

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
// 关闭 autoUpdater 的退出安装：它由 github.com 下载，在国内网络下常超时。
// 我们改用 api.github.com 自己检查/下载/安装（见下方 GH_API_* 实现）。
autoUpdater.autoInstallOnAppQuit = false;

/* ========== 自托管更新通道（走 api.github.com，绕开常不通的 github.com） ========== */
const GH_API_LATEST = 'https://api.github.com/repos/April4099/foucenow/releases/latest';
const GH_API_ASSET = (id) => `https://api.github.com/repos/April4099/foucenow/releases/assets/${id}`;
const UPDATE_TIMEOUT_MS = 20000;
let latestRelease = null;   // { version, notes, assetId, assetName, assetSize }
let updateDir = null;

function updateCacheDir() {
  if (!updateDir) updateDir = path.join(app.getPath('userData'), 'update-cache');
  return updateDir;
}

function parseVersion(v) {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : [0, 0, 0];
}
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

async function apiFetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPDATE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'FocusNow-Updater', 'Accept': 'application/vnd.github+json' }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchLatestRelease() {
  const j = await apiFetchJson(GH_API_LATEST);
  const version = String(j.tag_name || '').replace(/^v/, '');
  const assets = (j.assets || []).map(a => ({ id: a.id, name: a.name, size: a.size }));
  const exe = assets.find(a => /\.exe$/i.test(a.name) && !/blockmap/i.test(a.name)) || null;
  return {
    version,
    notes: formatNotes({ releaseNotes: j.body || '' }),
    assetId: exe ? exe.id : null,
    assetName: exe ? exe.name : null,
    assetSize: exe ? exe.size : 0
  };
}

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
function updateTrayMenu() {
  if (!tray) return;
  const t = [
    { label: `今日专注 ${trayState.todayMin} 分钟`, enabled: false },
    { type: 'separator' },
    {
      label: trayState.running ? '⏸ 暂停专注' : '▶ 开始专注',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        sendTrayCommand('toggle-timer');
      }
    },
    {
      label: '打开主界面',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      }
    }
  ];
  if (pendingInstall) {
    t.push({ type: 'separator' });
    t.push({
      label: `⬆ 安装 v${pendingInstall.version}（重启生效）`,
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        sendTrayCommand('install-update');
      }
    });
  }
  t.push({ type: 'separator' });
  t.push({
    label: '完全退出',
    click: () => { isQuitting = true; app.quit(); }
  });
  tray.setContextMenu(Menu.buildFromTemplate(t));
  tray.setToolTip(pendingInstall
    ? `此刻 FocusNow · 有更新 v${pendingInstall.version} 待安装`
    : '此刻 FocusNow（后台运行中）');
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.png'));
  updateTrayMenu();
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
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

let fgScriptB64 = null; // 只构造一次，避免每 3 秒重复编码
function queryForegroundProcess() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (!fgScriptB64) fgScriptB64 = buildFgScript();
  const b64 = fgScriptB64;
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

let fgBusy = false;
async function tickFg() {
  // 防重入：单次查询若超过轮询间隔，不允许多个 PowerShell 进程叠加
  if (fgBusy || !fgMonitor.active) return;
  fgBusy = true;
  try {
    const name = await queryForegroundProcess();
    if (!fgMonitor.active) return; // 计时已结束，丢弃在途结果
    if (!name) { fgMonitor.lastDistract = false; return; }
    const inAllow = fgMonitor.allow.some(a => name.indexOf(a) !== -1);
    const isDistract = !inAllow && fgMonitor.apps.some(a => name.indexOf(a) !== -1);
    if (isDistract) {
      const entered = !fgMonitor.lastDistract;
      fgMonitor.lastDistract = true;
      // 按「停留时长」上报：每次轮询累加 FG_POLL_SEC 秒；entered 仅用于统计段数
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus-distraction-time', { seconds: FG_POLL_SEC, entered, app: name });
      }
    } else {
      fgMonitor.lastDistract = false;
    }
  } finally {
    fgBusy = false;
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

/* ========== 更新检查（走 api.github.com） ========== */
async function checkForUpdates() {
  if (!app.isPackaged) {
    console.log('[更新] 开发模式，跳过更新检查');
    return;
  }
  try {
    const info = await fetchLatestRelease();
    latestRelease = info;
    const hasUpdate = compareVersions(info.version, app.getVersion()) > 0;
    if (!hasUpdate) {
      if (installAfterDownload) {
        installAfterDownload = false;
        savePendingInstall(null);
      }
      silentRecheck = false;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-not-available');
      return;
    }
    updateAvailable = true;
    if (silentRecheck || installAfterDownload) {
      silentRecheck = false;
      if (!pendingInstall || pendingInstall.version !== info.version) {
        savePendingInstall({ version: info.version, notes: info.notes });
      }
      startUpdateDownload(); // 启动恢复：直接下载
      return;
    }
    pushUpdateEvent('update-available', {
      version: info.version,
      currentVersion: app.getVersion(),
      notes: info.notes
    });
  } catch (err) {
    console.log('[更新] 检查失败:', err.message);
    silentRecheck = false;
    installAfterDownload = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', { message: err.message || '未知错误' });
    }
  }
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

/* ========== 启动后检查“上一次更新”并弹窗告知本次更新内容 ========== */
function checkPendingUpdate() {
  // ① 恢复「已下载但没安装」的更新
  const pf = PENDING_INSTALL_FILE();
  let installedVersion = null;
  if (fs.existsSync(pf)) {
    try {
      const p = JSON.parse(fs.readFileSync(pf, 'utf8'));
      if (p && p.version) {
        if (p.version === app.getVersion()) {
          // 已经装到该版本 → 清掉待安装标记，稍后弹「更新完成」
          installedVersion = p.version;
          savePendingInstall(null);
          clearAutoAttempts();
        } else if (compareVersions(p.version, app.getVersion()) <= 0) {
          // 标记版本已不比当前新（中途装过别的版本）→ 清掉陈旧标记，避免降级安装
          savePendingInstall(null);
          clearAutoAttempts();
        } else {
          // 仍停在旧版本：优先用本地已下好的完整包直接自动安装，不再需要手动点
          pendingInstall = { version: p.version, notes: p.notes || '' };
          const cached = downloadedExePath(p.version);
          let hasCompletePkg = false;
          try {
            hasCompletePkg = fs.existsSync(cached) && fs.statSync(cached).size > 50 * 1024 * 1024;
          } catch (e) { /* 文件异常视为不完整 */ }
          if (hasCompletePkg) {
            // 安装包已完整下载 → 重启后自动静默安装（带防循环计数）
            updateTrayMenu();
            setTimeout(() => scheduleAutoInstall(cached, p.version, p.notes || ''), 1500);
          } else {
            // 本地没有完整包 → 静默重新下载，下载完直接装（installAfterDownload）
            silentRecheck = true;
            installAfterDownload = true;
            updateTrayMenu();
          }
        }
      }
    } catch (e) { /* 忽略损坏的标记文件 */ }
  }

  // ② 「本次更新内容」只有确认真的装好了才弹（旧逻辑下载完就写，会误报更新完成）
  const f = path.join(app.getPath('userData'), '.pending-update.json');
  if (!fs.existsSync(f)) return;
  let d;
  try {
    d = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.unlinkSync(f); // 读取后即删除，避免重复提示
  } catch (e) { return; }
  if (!installedVersion && pendingInstall) return; // 还没装，别误报
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    pushUpdateEvent('update-done', {
      version: d.version,
      notes: d.notes || ''
    });
  }, 1200);
}

/* ========== IPC 通信（供渲染进程调用） ========== */
ipcMain.handle('check-update', () => {
  if (!app.isPackaged) return { status: 'dev' };
  checkForUpdates();
  return { status: 'checking' };
});

ipcMain.handle('get-version', () => {
  return app.getVersion();
});

/* ========== 自托管下载与安装（api.github.com assets 接口，绕开 github.com） ========== */
let downloadInProgress = false;
let downloadCancelled = false;

function downloadedExePath(version) {
  return path.join(updateCacheDir(), 'FocusNow-Setup-' + version + '.exe');
}

const REPO_OWNER = 'April4099';
const REPO_NAME = 'foucenow';

// 多个下载通道：国内镜像优先（github.com 在国内常被限速到几 KB/s）
// fileName 形如 FocusNow-Setup-1.12.3.exe，需还原成 tag v1.12.3 + 文件名
function downloadUrls(fileName) {
  const name = /^FocusNow-Setup-([\d.]+)\.exe$/i.test(fileName)
    ? fileName
    : 'FocusNow-Setup-' + String(latestRelease && latestRelease.version || '').replace(/^v/, '') + '.exe';
  const verMatch = name.match(/^FocusNow-Setup-([\d.]+)\.exe$/i);
  const tag = verMatch ? 'v' + verMatch[1] : 'v' + String(latestRelease && latestRelease.version || '').replace(/^v/, '');
  const gh = 'https://github.com/' + REPO_OWNER + '/' + REPO_NAME + '/releases/download/' + tag + '/' + name;
  return [
    'https://ghfast.top/' + gh,
    'https://gh-proxy.com/' + gh,
    gh,
    GH_API_ASSET(latestRelease && latestRelease.assetId)
  ].filter(Boolean);
}

function emitProgress(percent, transferredMB, totalMB, speedKB) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-progress', {
      percent, transferred: transferredMB, total: totalMB, speed: speedKB
    });
  }
}

// 测速：拉取前 256KB，算 KB/s；失败返回 -1
async function probeSpeed(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const start = Date.now();
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Range': 'bytes=0-262143', 'User-Agent': 'FocusNow-Updater' }
    });
    if (!resp.ok && resp.status !== 206) return -1;
    const buf = await resp.arrayBuffer();
    const sec = (Date.now() - start) / 1000;
    return sec > 0 ? (buf.byteLength / sec) / 1024 : -1;
  } catch (e) {
    return -1;
  } finally {
    clearTimeout(t);
  }
}

async function downloadFromUrl(url, target, total, startAt, ctrl) {
  const headers = { 'User-Agent': 'FocusNow-Updater' };
  if (startAt > 0) headers['Range'] = 'bytes=' + startAt + '-';
  const resp = await fetch(url, { signal: ctrl.signal, headers });
  if (!resp.ok && resp.status !== 206) throw new Error('HTTP ' + resp.status);
  // 断点续传：服务器忽略 Range（返回 200）时从头写
  const resume = resp.status === 206 && startAt > 0;
  const file = fs.createWriteStream(target, { flags: resume ? 'a' : 'w' });
  let received = resume ? startAt : 0;
  let lastPct = -1, lastEmit = 0, windowBytes = 0, windowStart = Date.now();

  const rd = resp.body && resp.body.getReader;
  if (!rd) {
    const buf = Buffer.from(await resp.arrayBuffer());
    await new Promise((resolve, reject) => fs.writeFile(target, buf, e => e ? reject(e) : resolve()));
    return buf.length;
  }
  const reader = resp.body.getReader();
  while (true) {
    if (downloadCancelled) { file.destroy(); throw new Error('已取消'); }
    const { done, value } = await reader.read();
    if (done) break;
    file.write(Buffer.from(value));
    received += value.length;
    windowBytes += value.length;
    const now = Date.now();
    const pct = total ? Math.min(100, Math.floor(received / total * 100)) : 0;
    if (now - lastEmit >= 1000) {
      const speed = Math.round((windowBytes / 1024) / ((now - windowStart) / 1000));
      emitProgress(pct, Math.round(received / 1024 / 1024), Math.round(total / 1024 / 1024), speed);
      windowBytes = 0; windowStart = now; lastEmit = now; lastPct = pct;
    } else if (pct !== lastPct) {
      lastPct = pct;
    }
  }
  await new Promise((resolve, reject) => { file.end(resolve); file.on('error', reject); });
  return received;
}

async function startUpdateDownload() {
  if (downloadInProgress) return;
  if (!latestRelease || !latestRelease.assetId) {
    try { latestRelease = await fetchLatestRelease(); }
    catch (err) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-error', { message: err.message });
      return;
    }
  }
  const info = latestRelease;
  if (!info.version) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-error', { message: '版本信息缺失' });
    return;
  }
  downloadInProgress = true;
  downloadCancelled = false;
  const target = downloadedExePath(info.version);
  const total = info.assetSize || 82 * 1024 * 1024;
  const urls = downloadUrls(info.assetName || ('FocusNow-Setup-' + info.version + '.exe'));

  try {
    fs.mkdirSync(updateCacheDir(), { recursive: true });
    emitProgress(0, 0, Math.round(total / 1024 / 1024), 0);

    // 测速选最快通道（6 秒上限；镜像通常 1-2 秒就能返回）
    const speeds = await Promise.all(urls.map(u => probeSpeed(u, 6000)));
    console.log('[更新] 通道测速(KB/s):', speeds.map((s, i) => urls[i].split('/')[2] + '=' + Math.round(s)).join(', '));
    const viable = urls.map((u, i) => ({ u, s: speeds[i] })).filter(x => x.s > 20).sort((a, b) => b.s - a.s);
    const ordered = viable.length ? viable.map(x => x.u) : urls;

    let ok = false, lastErr = null;
    for (let attempt = 0; attempt < ordered.length * 2 && !downloadCancelled; attempt++) {
      const url = ordered[attempt % ordered.length];
      const startAt = fs.existsSync(target) ? fs.statSync(target).size : 0;
      if (startAt >= total) { ok = true; break; }
      // 按剩余量与最低 30KB/s 估算超时，至少 3 分钟
      const need = Math.max(3 * 60 * 1000, ((total - startAt) / 1024 / 30) * 1000);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), need);
      try {
        const got = await downloadFromUrl(url, target, total, startAt, ctrl);
        clearTimeout(timer);
        if (got >= total) { ok = true; break; }
        lastErr = new Error('下载中断于 ' + Math.round(got / total * 100) + '%');
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        console.log('[更新] 通道失败', url.split('/')[2], e.message);
      }
    }
    if (!ok) throw lastErr || new Error('所有下载通道均失败');

    downloadInProgress = false;
    updaterHasDownload = true;
    savePendingInstall({ version: info.version, notes: info.notes });
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), '.pending-update.json'),
        JSON.stringify({ version: info.version, notes: info.notes }));
    } catch (e) { /* ignore */ }

    if (installAfterDownload) {
      installAfterDownload = false;
      doInstall(target);
      return;
    }
    emitProgress(100, Math.round(total / 1024 / 1024), Math.round(total / 1024 / 1024), 0);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', { version: info.version, notes: info.notes });
    }
  } catch (err) {
    downloadInProgress = false;
    console.log('[更新] 下载失败:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', { message: err.message || '下载失败' });
    }
  }
}

/* 启动恢复后的自动安装：给窗口一点就绪时间，带尝试次数防循环 */
function scheduleAutoInstall(exePath, version, notes) {
  const attempts = readAutoAttempts(version);
  if (attempts >= 2) {
    // 自动装了两次仍未生效（安装包损坏 / 安装被拦截）→ 不再自动重试，退回手动入口
    console.log('[更新] 自动安装已尝试 ' + attempts + ' 次仍未成功，改为手动提示');
    clearAutoAttempts();
    pendingInstall = { version, notes: notes || '' };
    updateTrayMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-auto-install-failed', { version });
    }
    return;
  }
  writeAutoAttempts(version, attempts + 1);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-auto-installing', { version });
  }
  // 再延迟 2 秒，让用户看到提示，然后静默安装并退出
  setTimeout(() => doInstall(exePath), 2000);
}

function doInstall(exePath) {
  // NSIS oneClick 安装包：/S 静默安装；spawn 分离进程，主程序退出后继续安装
  const cp = require('child_process');
  try {
    const child = cp.spawn(exePath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    isQuitting = true;
    setTimeout(() => app.quit(), 300);
  } catch (err) {
    console.log('[更新] 启动安装器失败:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', { message: '启动安装器失败：' + err.message });
    }
  }
}

ipcMain.handle('update-start-download', () => {
  startUpdateDownload();
  return { status: 'downloading' };
});

/* 取消下载：保留已下载部分，下次可断点续传 */
ipcMain.handle('update-cancel-download', () => {
  downloadCancelled = true;
  downloadInProgress = false;
  return { status: 'cancelled' };
});

/* 渲染端点击「立即重启」→ 退出并安装已下载的更新 */
ipcMain.handle('update-restart', () => {
  // 已下载到本机 → 直接装（覆盖安装，数据目录不变）
  const version = (latestRelease && latestRelease.version) || (pendingInstall && pendingInstall.version);
  if (version && fs.existsSync(downloadedExePath(version))) {
    doInstall(downloadedExePath(version));
    return { status: 'restarting' };
  }
  // 没下载过但知道有新版本 → 先下载，完成后自动安装
  if (app.isPackaged && pendingInstall) {
    installAfterDownload = true;
    startUpdateDownload();
    return { status: 'preparing' };
  }
  return { status: 'no-update' };
});

/* 渲染端查询当前版本 / 是否有待安装更新（用于侧栏与设置页常驻入口） */
ipcMain.handle('get-update-state', () => ({
  version: app.getVersion(),
  pendingInstall: pendingInstall ? { version: pendingInstall.version, notes: pendingInstall.notes || '' } : null,
  updateAvailable
}));

/* 渲染端上报今日专注分钟与计时状态，供托盘菜单展示 */
ipcMain.handle('set-tray-state', (e, s) => {
  trayState = {
    todayMin: Math.max(0, Math.round(Number(s && s.todayMin) || 0)),
    running: !!(s && s.running)
  };
  updateTrayMenu();
  return { status: 'ok' };
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

/* 全局快捷键状态：主进程持久化，避免每次启动都要等渲染层同步 */
ipcMain.handle('shortcuts-get', () => ({ enabled: shortcutsEnabled, bindings: SHORTCUTS }));
ipcMain.handle('shortcuts-set', (e, enabled) => {
  setShortcutsEnabled(enabled);
  return { enabled: shortcutsEnabled };
});

/* ========== 应用生命周期 ========== */
app.whenReady().then(() => {
  shortcutsEnabled = loadShortcutsEnabled();
  registerShortcuts();
  createWindow();
  createTray();
  checkPendingUpdate(); // 若上次更新已装好，启动后告知本次更新内容
});

app.on('window-all-closed', () => {
  // 有托盘时保持后台运行，不做任何事
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else if (mainWindow) mainWindow.show();
});
