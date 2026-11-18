const { app, BrowserWindow, Menu, Tray, shell, ipcMain, Notification } = require('electron');
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
        mainWindow.webContents.send('focus-distraction-time', { seconds: FG_POLL_SEC, entered });
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
  // 启动恢复 / 用户点了「立即重启」但本进程内还没有下载包：
  // 直接复用本地缓存重新下载（秒完成），不再弹「发现新版本」让用户再点一次
  if (silentRecheck || installAfterDownload) {
    silentRecheck = false;
    if (!pendingInstall || pendingInstall.version !== info.version) {
      savePendingInstall({ version: info.version, notes });
    }
    autoUpdater.downloadUpdate().catch(() => { installAfterDownload = false; });
    return;
  }
  pushUpdateEvent('update-available', {
    version: info.version,
    currentVersion,
    notes
  });
});

autoUpdater.on('update-not-available', () => {
  console.log('[更新] 已是最新版本');
  if (installAfterDownload) {
    installAfterDownload = false;
    savePendingInstall(null); // 服务器上已没有更新，说明本地其实已装好
  }
  silentRecheck = false;
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
  updaterHasDownload = true;
  // 记录「已下载但未安装」：✕ 是挂后台不退出、点「稍后重启」也不会自动装，
  // 必须持久化，否则下次启动就再也找不到安装入口了
  savePendingInstall({ version: info.version, notes });
  // 记录到 userData，下一次启动（新版本）时弹出"本次更新内容"
  try {
    fs.writeFileSync(
      path.join(app.getPath('userData'), '.pending-update.json'),
      JSON.stringify({ version: info.version, notes })
    );
  } catch (e) { /* 忽略写入失败 */ }

  // 用户此前点了「立即重启」→ 下载一完成就立刻安装
  if (installAfterDownload) {
    installAfterDownload = false;
    isQuitting = true;
    autoUpdater.quitAndInstall();
    return;
  }
  pushUpdateEvent('update-downloaded', {
    version: info.version,
    notes
  });
});

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
        } else {
          // 仍停在旧版本 → 启动 5 秒后静默重新下载（命中缓存），完成后直接提示安装
          pendingInstall = { version: p.version, notes: p.notes || '' };
          silentRecheck = true;
          updateTrayMenu();
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

autoUpdater.on('error', (err) => {
  console.log('[更新] 错误:', err.message);
  // 检查/下载失败时复位标记，否则会把用户之后手动「检查更新」也吞成静默流程
  silentRecheck = false;
  installAfterDownload = false;
  // 通知渲染端：主动检查失败要立刻给反馈，而不是让按钮看起来没反应
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-error', { message: err.message || '未知错误' });
  }
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
  // 本进程内已有下载包 → 直接装
  if (updaterHasDownload) {
    isQuitting = true;
    autoUpdater.quitAndInstall();
    return { status: 'restarting' };
  }
  // 用户重启过软件、或当初点了「稍后重启」：autoUpdater 内部状态已丢失。
  // 重新 check + download（命中本地缓存，秒完成），下载完在事件里自动 quitAndInstall
  if (app.isPackaged && pendingInstall) {
    installAfterDownload = true;
    autoUpdater.checkForUpdates().catch(() => { installAfterDownload = false; });
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
