/* 桌面宠物 —— 渲染端（由 electron-main 的 petWindow 加载）
 * 情绪来源：计时状态 + 前台应用（复用分心应用名单，零隐私成本）
 * 视觉观测：可选，需用户自带 key；截图隐藏自身后抓取，仅发往用户自己的接口，不落盘 */
(function () {
  const api = window.electronAPI;
  const creatureEl = document.getElementById('pet-creature');
  const bubbleEl = document.getElementById('pet-bubble');
  const obsEl = document.getElementById('pet-obs');

  const EMOJI = { focused: '😺', slacking: '😼', idle: '😴', observing: '👁️' };

  let state = {
    running: false, phase: 'work', distractions: 0, shieldActive: false,
    distractionApps: [],
    pet: { style: 'cat', customPath: '', vision: { enabled: false, endpoint: '', apiKey: '', model: '', intervalSec: 30, exclude: '' } }
  };
  let fg = { processName: '', title: '' };
  let lastBubble = '';
  let visionTimer = null;

  function isDistraction() {
    if (!state.running || state.shieldActive) return false;
    const apps = state.distractionApps || [];
    return apps.some(a => fg.processName && fg.processName.indexOf(String(a).toLowerCase()) !== -1);
  }

  function computeMood() {
    const v = state.pet.vision;
    if (v && v.enabled && state.running && !state.shieldActive) return 'observing';
    if (!state.running) return 'idle';
    if (isDistraction()) return 'slacking';
    return 'focused';
  }

  function catSvg(mood) {
    const eyeHappy = '<path d="M40 60 Q46 52 52 60" stroke="#2b2b2b" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M68 60 Q74 52 80 60" stroke="#2b2b2b" stroke-width="3" fill="none" stroke-linecap="round"/>';
    const eyeSleep = '<path d="M40 60 Q46 56 52 60" stroke="#2b2b2b" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M68 60 Q74 56 80 60" stroke="#2b2b2b" stroke-width="3" fill="none" stroke-linecap="round"/>';
    const eyeShock = '<circle cx="46" cy="58" r="8" fill="#fff" stroke="#2b2b2b" stroke-width="2"/><circle cx="74" cy="58" r="8" fill="#fff" stroke="#2b2b2b" stroke-width="2"/><circle cx="46" cy="58" r="3.2" fill="#2b2b2b"/><circle cx="74" cy="58" r="3.2" fill="#2b2b2b"/>';
    const eyeNormal = '<circle cx="46" cy="58" r="5.5" fill="#2b2b2b"/><circle cx="74" cy="58" r="5.5" fill="#2b2b2b"/>';
    let eyes = eyeNormal;
    if (mood === 'focused') eyes = eyeHappy;
    else if (mood === 'idle') eyes = eyeSleep;
    else if (mood === 'slacking' || mood === 'observing') eyes = eyeShock;

    let mouth = '<path d="M50 78 Q60 86 70 78" stroke="#2b2b2b" stroke-width="3" fill="none" stroke-linecap="round"/>';
    if (mood === 'slacking') mouth = '<path d="M50 84 Q60 76 70 84" stroke="#2b2b2b" stroke-width="3" fill="none" stroke-linecap="round"/>';
    else if (mood === 'idle') mouth = '<path d="M54 80 L66 80" stroke="#2b2b2b" stroke-width="3" fill="none" stroke-linecap="round"/>';

    let extra = '';
    if (mood === 'slacking') extra = '<path d="M88 38 q7 9 0 15" stroke="#5BC8FF" stroke-width="3" fill="none" stroke-linecap="round"/>';
    if (mood === 'idle') extra = '<text x="86" y="34" font-size="13" fill="#9aa">z</text><text x="95" y="25" font-size="18" fill="#9aa">Z</text>';
    if (mood === 'observing') extra = '<circle cx="74" cy="58" r="15" fill="none" stroke="#FF2E7E" stroke-width="2.5" opacity="0.85"/>';

    return '<svg viewBox="0 0 120 120" width="120" height="120">'
      + '<polygon points="28,42 21,14 52,34" fill="#FFB36B"/>'
      + '<polygon points="92,42 99,14 68,34" fill="#FFB36B"/>'
      + '<polygon points="33,39 28,21 47,33" fill="#FFD9B0"/>'
      + '<polygon points="87,39 92,21 73,33" fill="#FFD9B0"/>'
      + '<circle cx="60" cy="64" r="40" fill="#FFC785"/>'
      + eyes
      + '<polygon points="56,68 64,68 60,73" fill="#FF8AA0"/>'
      + mouth
      + '<line x1="18" y1="70" x2="40" y2="68" stroke="#d8b48c" stroke-width="1.5"/><line x1="18" y1="76" x2="40" y2="74" stroke="#d8b48c" stroke-width="1.5"/>'
      + '<line x1="102" y1="70" x2="80" y2="68" stroke="#d8b48c" stroke-width="1.5"/><line x1="102" y1="76" x2="80" y2="74" stroke="#d8b48c" stroke-width="1.5"/>'
      + extra
      + '</svg>';
  }

  function renderCreature(mood, style, customPath) {
    if (style === 'emoji') { creatureEl.innerHTML = '<div class="pet-emoji">' + (EMOJI[mood] || '😺') + '</div>'; return; }
    if (style === 'custom') {
      creatureEl.innerHTML = '<img class="pet-img" src="' + (customPath || '') + '"><div class="pet-moodbadge">' + (EMOJI[mood] || '😺') + '</div>';
      return;
    }
    creatureEl.innerHTML = catSvg(mood);
  }

  function bubbleText(mood) {
    if (mood === 'idle') {
      const lines = ['我在等你开始专注哦~', '摸摸我，休息一下也好 💤', '随时召唤我陪你 🐾'];
      return lines[Math.floor(Math.random() * lines.length)];
    }
    if (mood === 'focused') {
      const lines = ['加油！我看着你呢 😺', '你今天真专注！', '保持住，马上就赢了 💪', '有我在，分心退散'];
      return lines[Math.floor(Math.random() * lines.length)];
    }
    if (mood === 'slacking') {
      const appName = fg.processName || '某个软件';
      return '检测到你在用「' + appName + '」，快回来专注！';
    }
    return lastBubble || '我正在帮你看着屏幕…';
  }

  function showBubble(text, good) {
    bubbleEl.textContent = text;
    bubbleEl.classList.toggle('good', !!good);
  }

  function stopVision() {
    if (visionTimer) { clearInterval(visionTimer); visionTimer = null; }
    obsEl.classList.remove('on');
  }

  function startVisionIfNeeded() {
    stopVision();
    const v = state.pet.vision;
    if (!(v && v.enabled && state.running && !state.shieldActive)) return;
    obsEl.classList.add('on');
    const interval = Math.max(10, (v.intervalSec || 30)) * 1000;
    visionTimer = setInterval(async () => {
      const vv = state.pet.vision;
      if (!vv || !vv.enabled || !state.running || state.shieldActive) { stopVision(); return; }
      // 排除敏感窗口：前台标题命中关键词则跳过本次截图
      const ex = (vv.exclude || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
      if (fg.title && ex.some(k => fg.title.toLowerCase().indexOf(k.toLowerCase()) !== -1)) return;
      try {
        const dataUrl = await api.captureScreen();
        if (!dataUrl) return;
        const r = await api.visionCheck({ dataUrl, endpoint: vv.endpoint, apiKey: vv.apiKey, model: vv.model });
        if (r && r.ok && r.text) { lastBubble = r.text; showBubble(r.text, true); }
        else if (r && r.text) { showBubble(r.text, false); }
      } catch (e) { /* ignore */ }
    }, interval);
  }

  function render() {
    const mood = computeMood();
    renderCreature(mood, state.pet.style, state.pet.customPath);
    if (mood !== 'observing') showBubble(bubbleText(mood), mood === 'focused');
    startVisionIfNeeded();
  }

  if (api && api.onPetSync) api.onPetSync(s => { state = s; render(); });
  if (api && api.onForegroundInfo) api.onForegroundInfo(info => { fg = info || fg; if (state.running) render(); });
  if (api && api.sendPetRequestState) api.sendPetRequestState();

  document.getElementById('pet-close').addEventListener('click', () => {
    if (api && api.closePet) api.closePet();
  });

  /* 点击抚摸：弹跳动效 + 随机可爱回应（用 pointer 位移判定，避免拖动窗口误触） */
  const PET_LINES = ['谢谢你陪我 💕', '摸摸头~ 干劲满满！', '有你在真好 ✨', '最喜欢你了 🐾', '加油，我帮你盯着！', '嘿嘿，被你发现啦 😸'];
  let petDownX = 0, petDownY = 0;
  function petPet() {
    creatureEl.classList.remove('petted');
    void creatureEl.offsetWidth; // 触发重排以重启动画
    creatureEl.classList.add('petted');
    showBubble(PET_LINES[Math.floor(Math.random() * PET_LINES.length)], true);
  }
  creatureEl.addEventListener('pointerdown', e => { petDownX = e.clientX; petDownY = e.clientY; });
  creatureEl.addEventListener('pointerup', e => {
    const dx = e.clientX - petDownX, dy = e.clientY - petDownY;
    if (Math.hypot(dx, dy) < 8) petPet();
  });
  creatureEl.addEventListener('animationend', () => creatureEl.classList.remove('petted'));
})();
