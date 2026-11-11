/* 独立置顶悬浮专注钟 —— 渲染端（由 electron-main 的 floatWindow 加载） */
(function () {
  const api = window.electronAPI;
  const timeEl = document.getElementById('fl-time');
  const phaseEl = document.getElementById('fl-phase');
  const ring = document.getElementById('fl-ring');
  const dot = document.getElementById('fl-dot');
  const icon = document.getElementById('fl-icon');
  const CIRC = 2 * Math.PI * 66;
  ring.style.strokeDasharray = CIRC;

  const RING_COLOR = { work: '#FF2E7E', custom: '#FF2E7E', stopwatch: '#FF2E7E', shortBreak: '#3ECF8E', longBreak: '#4DA3FF' };

  function render(s) {
    if (!s) return;
    timeEl.textContent = s.display;
    phaseEl.textContent = s.phaseText;

    if (s.total > 0 && s.mode !== 'stopwatch') {
      const progress = s.remaining / s.total;
      ring.style.strokeDashoffset = CIRC * (1 - progress);
    } else {
      ring.style.strokeDashoffset = CIRC; // 满环
    }
    ring.style.stroke = RING_COLOR[s.phase] || '#FF2E7E';

    icon.innerHTML = s.running
      ? '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'
      : '<polygon points="6 3 20 12 6 21 6 3"/>';

    dot.style.background = s.running ? (RING_COLOR[s.phase] || '#FF2E7E') : 'rgba(255,255,255,0.3)';
    dot.style.boxShadow = s.running ? '0 0 8px ' + (RING_COLOR[s.phase] || '#FF2E7E') : 'none';
  }

  if (api && api.onFloatState) api.onFloatState(render);
  if (api && api.sendFloatRequestState) api.sendFloatRequestState();

  document.getElementById('fl-toggle').addEventListener('click', () => api && api.sendFloatCmd('toggle'));
  document.getElementById('fl-reset').addEventListener('click', () => api && api.sendFloatCmd('reset'));
  document.getElementById('fl-skip').addEventListener('click', () => api && api.sendFloatCmd('skip'));
  document.getElementById('fl-close').addEventListener('click', () => api && api.closeFloat && api.closeFloat());
})();
