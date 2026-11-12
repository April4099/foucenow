(function () {
  const api = window.electronAPI;
  const phaseEl = document.getElementById('shield-phase');
  const timeEl = document.getElementById('shield-time');
  const taskEl = document.getElementById('shield-task');
  const toggleBtn = document.getElementById('shield-toggle');
  const resetBtn = document.getElementById('shield-reset');
  const skipBtn = document.getElementById('shield-skip');
  const exitBtn = document.getElementById('shield-exit');

  let state = { display: '25:00', phaseText: '准备开始', running: false };

  function render() {
    timeEl.textContent = state.display || '25:00';
    phaseEl.textContent = state.phaseText || '准备开始';
    toggleBtn.textContent = state.running ? '❚❚' : '▶';
  }

  if (api && api.onFloatState) {
    api.onFloatState(s => { state = Object.assign(state, s); render(); });
  }
  if (api && api.sendFloatRequestState) api.sendFloatRequestState();

  function cmd(type) { if (api && api.sendFloatCmd) api.sendFloatCmd(type); }
  toggleBtn.addEventListener('click', () => cmd('toggle'));
  resetBtn.addEventListener('click', () => cmd('reset'));
  skipBtn.addEventListener('click', () => cmd('skip'));
  exitBtn.addEventListener('click', () => { if (api && api.closeShield) api.closeShield(); });

  document.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); cmd('toggle'); }
    else if (e.key === 'Escape') { if (api && api.closeShield) api.closeShield(); }
  });
})();
