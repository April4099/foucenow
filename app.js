/* ============================================
   此刻 FocusNow · 核心应用逻辑 v2
   日历热力图 · 粉黑主题 · 桌面布局
   ============================================ */

(function () {
  'use strict';

  /* ---------- 工具 ---------- */
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function todayStr(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }

  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(dateStr, n) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return todayStr(d);
  }

  function formatDateCN(dateStr, showYear) {
    const d = parseDate(dateStr);
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    let s = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week;
    if (showYear) s = d.getFullYear() + '年' + s;
    return s;
  }

  function formatSecs(secs) {
    return String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(Math.floor(secs % 60)).padStart(2, '0');
  }

  function nowHM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function minutesFromHM(hm) {
    const [h, m] = hm.split(':').map(Number);
    return h * 60 + m;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  const CATS = ['设计', '绘制', '工作', '学习', '生活', '健康', '其他'];
  function catBadge(cat) {
    const c = CATS.includes(cat) ? cat : '其他';
    return `<span class="badge badge-category badge-cat-${c}">${escapeHtml(cat || c)}</span>`;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  /* ---------- 存储 ---------- */
  const STORAGE_KEY = 'focusnow_data_v2';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('focusnow_data_v1');
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(app.data));
    } catch (e) { /* quota */ }
  }

  function defaultData() {
    return {
      todos: [],
      events: [],
      sessions: [],
      settings: {
        pomodoroWork: 25,
        pomodoroShortBreak: 5,
        pomodoroLongBreak: 15,
        pomodorosUntilLongBreak: 4,
        dailyFocusGoal: 120,
        soundEnabled: true
      }
    };
  }

  /* ---------- 应用状态 ---------- */
  const app = {
    data: loadState() || defaultData(),
    ui: {
      currentView: 'today',
      todoFilter: 'all',
      scheduleDate: todayStr(),
      calendarYear: new Date().getFullYear(),
      calendarMonth: new Date().getMonth(),
      calendarSelected: todayStr(),
      calFilter: 'all'
    },
    timer: {
      mode: 'pomodoro',
      phase: 'work',
      running: false,
      remaining: 25 * 60,
      total: 25 * 60,
      pomodoroCount: 0,
      linkedTodoId: null,
      startedAt: null,
      intervalId: null,
      customMinutes: 25
    }
  };

  /* ---------- 音效 ---------- */
  let audioCtx = null;

  function playTone(freq, dur, type) {
    if (!app.data.settings.soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.25, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* skip */ }
  }

  function playCompleteSound() {
    playTone(523, 0.15);
    setTimeout(() => playTone(659, 0.15), 150);
    setTimeout(() => playTone(784, 0.25), 300);
  }

  function playTickSound() { playTone(880, 0.04, 'triangle'); }

  /* ---------- Toast ---------- */
  function showToast(msg, type) {
    const c = $('#toast-container');
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  /* ---------- 浏览器通知 ---------- */
  function requestNotifPermission() {
    if (typeof Notification === 'undefined') return showToast('此浏览器不支持通知', 'warning');
    if (Notification.permission === 'granted') {
      showToast('通知已开启 ✓', 'success');
      updateNotifBtn();
      return;
    }
    Notification.requestPermission().then(p => {
      showToast(p === 'granted' ? '通知已开启 ✓' : '通知权限被拒绝', p === 'granted' ? 'success' : 'warning');
      updateNotifBtn();
    });
  }

  function updateNotifBtn() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      $('#btn-notify').classList.add('notif-on');
    }
  }

  function sendNotification(title, body) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⏰</text></svg>",
          tag: 'focusnow-' + Date.now()
        });
      } catch (e) { /* skip */ }
    }
    showToast(title + ' · ' + body, 'warning');
    playTone(880, 0.3, 'triangle');
    setTimeout(() => playTone(660, 0.3, 'triangle'), 250);
  }

  /* ==========================================
     导航
     ========================================== */
  const viewTitles = {
    today: '今日', todos: '待办', schedule: '日程',
    calendar: '日历', focus: '专注计时', settings: '我的'
  };

  function switchView(view) {
    app.ui.currentView = view;
    $$('.view').forEach(v => v.classList.remove('active'));
    const el = $('#view-' + view);
    if (el) el.classList.add('active');

    $$('.sidebar-item, .nav-item, .sidebar-settings-btn').forEach(n => {
      n.classList.toggle('active', n.dataset.view === view);
    });

    $('#page-title').textContent = viewTitles[view] || '';

    if (view === 'schedule') renderSchedule();
    if (view === 'calendar') renderCalendar();
    if (view === 'focus') { renderFocus(); renderFocusTodoSelect(); }
    if (view === 'today') renderToday();
    if (view === 'todos') renderTodos();
    if (view === 'settings') { renderThemeSelector(); loadSettingsUI(); }
  }

  /* ==========================================
     今日看板
     ========================================== */
  function renderToday() {
    const today = todayStr();
    const hour = new Date().getHours();
    const greet = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    $('#greeting-msg').textContent = greet;

    const subs = [
      '新的一天，从小事开始 🌟', '专注当下，稳步推进 💪',
      '今天的你也很棒，加油 ✨', '完成比完美更重要 🌱', '小步前进也是前进 🚀'
    ];
    $('#greeting-sub').textContent = subs[new Date().getDate() % subs.length];

    const todaySessions = app.data.sessions.filter(s => s.date === today);
    const focusMin = todaySessions.reduce((a, s) => a + s.durationMin, 0);
    const doneCount = app.data.todos.filter(t => t.completed && t.completedAt && t.completedAt.startsWith(today)).length;
    const todayEvents = getEventsForDate(today);

    $('#today-focus-min').textContent = focusMin;
    $('#today-done-count').textContent = doneCount;
    $('#today-event-count').textContent = todayEvents.length;

    // 目标环
    const goal = app.data.settings.dailyFocusGoal;
    const pct = Math.min(100, Math.round((focusMin / goal) * 100));
    const circ = 2 * Math.PI * 42;
    const fill = $('#goal-ring-fill');
    fill.style.strokeDasharray = circ;
    fill.style.strokeDashoffset = circ - circ * pct / 100;
    $('#goal-percent').textContent = pct + '%';
    $('#goal-detail').textContent = focusMin + ' / ' + goal + ' 分钟';

    // 侧边栏环
    const sideRing = $('.side-ring-fill');
    if (sideRing) {
      const sCirc = 2 * Math.PI * 34;
      sideRing.style.strokeDasharray = sCirc;
      sideRing.style.strokeDashoffset = sCirc - sCirc * pct / 100;
    }
    $('#sidebar-focus-min').textContent = focusMin;

    // 今日日程
    const ec = $('#today-events');
    if (!todayEvents.length) {
      ec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><p>今天还没有日程安排</p></div>';
    } else {
      const now = nowHM();
      ec.innerHTML = todayEvents.slice(0, 5).map(ev => {
        const active = ev.start <= now && (!ev.end || ev.end >= now);
        return `<div class="event-mini${active ? ' reminder-pulse' : ''}">
          <span class="event-mini-time">${ev.start}</span>
          <span class="event-mini-title">${escapeHtml(ev.title)}</span>
          ${active ? '<span class="badge badge-due">进行中</span>' : ''}
        </div>`;
      }).join('');
    }

    // 今日待办（紧凑显示）
    const todayTodos = app.data.todos.filter(t => !t.completed && (t.due === today || !t.due));
    const tc = $('#today-todos');
    if (!todayTodos.length) {
      tc.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p>太棒了，今天的任务都完成了！</p></div>';
    } else {
      tc.innerHTML = todayTodos.slice(0, 4).map(t => renderTodoCompact(t)).join('');
    }

    renderNextReminder();
    renderArrangeDesk();
    renderDailyCheckin();
    $('#header-date').textContent = formatDateCN(today, true);

    const motives = [
      '完成比完美更重要，现在开始就是最好的时机。', '25分钟的专注，胜过2小时的焦虑。',
      '你不需要很厉害才能开始，但你需要开始才能很厉害。', '把大任务拆成小步骤，一步一步来。',
      '专注不是天赋，是可以练习的技能。', '今天的坚持，是明天的底气。'
    ];
    $('#motivation-text').textContent = motives[Math.floor(Math.random() * motives.length)];
  }

  function renderNextReminder() {
    const box = $('#next-reminder');
    const now = new Date();
    const today = todayStr();
    let next = null;

    for (const ev of app.data.events) {
      if (ev.notified && ev.repeat === 'none') continue;
      if (ev.date > today) continue;

      const [h, m] = ev.start.split(':').map(Number);
      const d = parseDate(ev.date <= today ? today : ev.date);
      d.setHours(h, m, 0, 0);
      if (d <= now) continue;

      if (!next || d < next._dt) next = { ...ev, _dt: d };
    }

    if (next) {
      box.style.display = 'flex';
      $('#next-reminder-title').textContent = next.title;
      const diff = Math.round((next._dt - now) / 60000);
      $('#next-reminder-time').textContent = diff < 60 ? diff + ' 分钟后' : '今天 ' + next.start;
    } else {
      box.style.display = 'none';
    }
  }

  /* ==========================================
     待办
     ========================================== */
  function renderTodos() {
    const filter = app.ui.todoFilter;
    const today = todayStr();
    let todos = [...app.data.todos];

    if (filter === 'today') todos = todos.filter(t => t.due === today);
    else if (filter === 'upcoming') todos = todos.filter(t => t.due && t.due > today && !t.completed);
    else if (filter === 'done') todos = todos.filter(t => t.completed);

    const po = { high: 0, medium: 1, low: 2 };
    todos.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const pa = po[a.priority] ?? 1, pb = po[b.priority] ?? 1;
      return pa !== pb ? pa - pb : (a.due || '9999').localeCompare(b.due || '9999');
    });

    const list = $('#todo-list');
    list.innerHTML = todos.length
      ? todos.map(t => renderTodoItem(t)).join('')
      : '<div class="empty-state"><div class="empty-state-icon">📋</div><p>没有待办任务<br>点击 + 添加第一个任务吧</p></div>';

    const all = app.data.todos;
    $('#todo-total').textContent = all.length;
    $('#todo-done').textContent = all.filter(t => t.completed).length;
    const ts = app.data.sessions.filter(s => s.date === today);
    $('#todo-focus-time').textContent = ts.reduce((a, s) => a + s.durationMin, 0);
  }

  function renderTodoItem(todo) {
    const pm = { high: ['高', 'badge-priority-high'], medium: ['普通', 'badge-priority-medium'], low: ['低', 'badge-priority-low'] };
    const [pl, pc] = pm[todo.priority] || pm.medium;
    const today = todayStr();

    let dueBadge = '';
    if (todo.due) {
      let cls = 'badge-due';
      let label = todo.due === today ? '今天' : formatDateCN(todo.due).replace(/ .*/, '');
      if (todo.due < today && !todo.completed) { cls = 'badge-priority-high'; label = '已过期 · ' + label; }
      dueBadge = `<span class="badge ${cls}">${label}</span>`;
    }

    const focusBadge = todo.focusedMin > 0 ? `<span class="badge badge-focus">已专注 ${todo.focusedMin}分</span>` : '';

    return `<div class="todo-item${todo.completed ? ' completed' : ''}" data-todo-id="${todo.id}">
      <div class="todo-checkbox${todo.completed ? ' checked' : ''}" data-action="toggle" data-id="${todo.id}"></div>
      <div class="todo-body" data-action="edit" data-id="${todo.id}">
        <div class="todo-title">${escapeHtml(todo.title)}</div>
        <div class="todo-meta">
          <span class="badge ${pc}">${pl}</span>
          ${catBadge(todo.category)}
          ${dueBadge}${focusBadge}
          ${todo.estimatedMin ? `<span class="badge badge-due">预估${todo.estimatedMin}分</span>` : ''}
        </div>
      </div>
      ${!todo.completed ? `<button class="todo-focus-btn" data-action="focus" data-id="${todo.id}" title="开始专注">▶</button>` : ''}
    </div>`;
  }

  /** 紧凑待办项（首页用，一目了然多显示几条） */
  function renderTodoCompact(todo) {
    const pm = { high: '高', medium: '中', low: '低' };
    const priLabel = pm[todo.priority] || '中';
    const today = todayStr();
    const overdue = todo.due && todo.due < today && !todo.completed;

    return `<div class="todo-compact${todo.completed ? ' done' : ''}" data-todo-id="${todo.id}">
      <div class="todo-checkbox${todo.completed ? ' checked' : ''}" data-action="toggle" data-id="${todo.id}"></div>
      <span class="todo-compact-title">${escapeHtml(todo.title)}</span>
      <span class="todo-compact-tag pri-${todo.priority || 'medium'}">${priLabel}</span>
      ${todo.category ? `<span class="todo-compact-tag cat-${todo.category}">${escapeHtml(todo.category)}</span>` : ''}
      ${overdue ? '<span class="todo-compact-tag overdue">逾期</span>' : ''}
      ${!todo.completed ? `<button class="todo-compact-focus" data-action="focus" data-id="${todo.id}" title="开始专注">▶</button>` : ''}
    </div>`;
  }

  function addTodo(d) {
    app.data.todos.unshift({
      id: uid(), title: d.title, description: d.desc || '', priority: d.priority || 'medium',
      category: d.category || '其他', due: d.due || '', estimatedMin: d.estimatedMin || 25,
      focusedMin: 0, completed: false, createdAt: new Date().toISOString(), completedAt: null
    });
    saveState();
    showToast('任务已添加 ✓', 'success');
  }

  function toggleTodo(id) {
    const t = app.data.todos.find(x => x.id === id);
    if (!t) return;
    t.completed = !t.completed;
    t.completedAt = t.completed ? new Date().toISOString() : null;
    syncLinkedEvents(id, t.completed);
    saveState();
    if (t.completed) { showToast('完成啦！🎉', 'success'); playCompleteSound(); }
    refresh();
  }

  function deleteTodo(id) {
    app.data.todos = app.data.todos.filter(t => t.id !== id);
    saveState();
    showToast('任务已删除', 'success');
  }

  function updateTodo(id, d) {
    const t = app.data.todos.find(x => x.id === id);
    if (t) { Object.assign(t, d); saveState(); showToast('修改已保存 ✓', 'success'); }
  }

  /* ==========================================
     日程
     ========================================== */
  function getEventsForDate(dateStr) {
    return app.data.events.filter(ev => {
      if (ev.date === dateStr) return true;
      if (ev.repeat === 'daily' && ev.date <= dateStr) return true;
      if (ev.repeat === 'weekly' && ev.date <= dateStr) {
        return parseDate(ev.date).getDay() === parseDate(dateStr).getDay();
      }
      if (ev.repeat === 'monthly' && ev.date <= dateStr) {
        return parseDate(ev.date).getDate() === parseDate(dateStr).getDate();
      }
      return false;
    }).sort((a, b) => a.start.localeCompare(b.start));
  }

  function renderSchedule() {
    const date = app.ui.scheduleDate;
    $('#schedule-date-label').textContent = formatDateCN(date, true);
    const isToday = date === todayStr();
    $('#btn-today-jump').style.display = isToday ? 'none' : 'inline';

    const events = getEventsForDate(date);
    const timeline = $('#timeline');
    let html = '<div class="timeline-now" id="timeline-now"></div>';

    for (let h = 6; h <= 23; h++) {
      const hourEvents = events.filter(ev => parseInt(ev.start.split(':')[0], 10) === h);
      html += `<div class="timeline-row"><div class="timeline-hour">${String(h).padStart(2, '0')}:00</div><div class="timeline-slot">`;
      hourEvents.forEach(ev => {
        const dur = ev.end ? minutesFromHM(ev.end) - minutesFromHM(ev.start) : 60;
        const h2 = Math.max(30, (dur / 60) * 56 - 4);
        html += `<div class="timeline-event${ev.reminder >= 0 ? ' event-high' : ''}" data-event-id="${ev.id}" style="height:${h2}px">
          <strong>${escapeHtml(ev.title)}</strong>
          <span>${ev.start}${ev.end ? '-' + ev.end : ''}${ev.repeat !== 'none' ? ' · ' + ({ daily: '每天', weekly: '每周', monthly: '每月' })[ev.repeat] : ''}</span>
        </div>`;
      });
      html += '</div></div>';
    }

    timeline.innerHTML = html;

    if (isToday) {
      const now = new Date();
      const offset = ((now.getHours() * 60 + now.getMinutes() - 360) / 60) * 56 + 18;
      const el = $('#timeline-now');
      if (el && offset > 0) { el.style.display = 'block'; el.style.top = offset + 'px'; }
    }

    // 安排台同步刷新
    renderArrangeDesk();
  }

  function addEvent(d) {
    app.data.events.push({
      id: uid(), title: d.title, date: d.date, start: d.start, end: d.end || '',
      repeat: d.repeat || 'none', reminder: d.reminder !== undefined ? d.reminder : 15,
      notes: d.notes || '', category: d.category || '其他',
      todoId: d.todoId || null,
      notified: false, createdAt: new Date().toISOString()
    });
    saveState();
    showToast('日程已添加 ✓', 'success');
  }

  function deleteEvent(id) {
    app.data.events = app.data.events.filter(e => e.id !== id);
    saveState();
    showToast('日程已删除', 'success');
    renderSchedule();
  }

  /* ==========================================
     今日安排台 —— 日程 × 待办 绑定系统
     ========================================== */

  /** 获取所有未截止、未完成的事项（待安排池） */
  function getPendingItems() {
    const today = todayStr();
    const now = nowHM();
    const items = [];

    // 未截止的日程（今天还没过去的 + 未来的）
    app.data.events.forEach(ev => {
      // 跳过已经排到今天且已过时间的
      const isToday = ev.date === today || (ev.repeat !== 'none' && ev.date <= today);
      const isFuture = ev.date > today;
      const isTodayUpcoming = isToday && (!ev.end || ev.end >= now);
      if (isFuture || isTodayUpcoming) {
        // 检查是否已排到今天
        const arrangedToday = app.data.events.find(e =>
          e.todoId && e.todoId === ev.id && e.date === today
        );
        items.push({
          type: 'event',
          id: ev.id,
          title: ev.title,
          category: ev.category,
          time: ev.start + (ev.end ? '-' + ev.end : ''),
          date: ev.date,
          arranged: !!arrangedToday,
          data: ev
        });
      }
    });

    // 未完成的待办（未过期的）
    app.data.todos.forEach(t => {
      if (t.completed) return;
      const isOverdue = t.due && t.due < today;
      if (isOverdue) return; // 过期待办不进安排台

      // 检查是否已排到今天
      const arrangedEvent = app.data.events.find(e => e.todoId === t.id && e.date === today);
      items.push({
        type: 'todo',
        id: t.id,
        title: t.title,
        category: t.category,
        time: t.due ? '截止 ' + t.due : '无截止',
        priority: t.priority,
        estimatedMin: t.estimatedMin,
        arranged: !!arrangedEvent,
        arrangedTime: arrangedEvent ? arrangedEvent.start : null,
        data: t
      });
    });

    return items;
  }

  /** 获取今天已排的事项（按时间排序） */
  function getArrangedItems() {
    const today = todayStr();
    return app.data.events
      .filter(e => e.date === today)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(ev => {
        const linkedTodo = ev.todoId ? app.data.todos.find(t => t.id === ev.todoId) : null;
        return {
          eventId: ev.id,
          todoId: ev.todoId,
          title: ev.title,
          start: ev.start,
          end: ev.end,
          category: ev.category,
          isLinked: !!ev.todoId,
          todoCompleted: linkedTodo ? linkedTodo.completed : null
        };
      });
  }

  /** 渲染安排台 */
  function renderArrangeDesk() {
    const pending = getPendingItems();
    const arranged = getArrangedItems();
    const unarranged = pending.filter(p => !p.arranged);

    // 计数
    const countEl = $('#desk-count');
    if (countEl) {
      countEl.textContent = unarranged.length > 0
        ? unarranged.length + ' 项待安排'
        : '全部已安排 ✓';
    }

    // 待安排池
    const pool = $('#desk-pending');
    if (pool) {
      if (!unarranged.length) {
        pool.innerHTML = `<div class="desk-empty"><div class="desk-empty-icon">🎉</div>所有事项都已安排到今天！</div>`;
      } else {
        pool.innerHTML = unarranged.map(item => {
          const icon = item.type === 'todo' ? '📝' : '📅';
          const typeCls = item.type === 'todo' ? 'type-todo' : 'type-event';
          const priBadge = item.type === 'todo' && item.priority
            ? `<span class="badge badge-priority-${item.priority}">${
                { high: '高', medium: '普通', low: '低' }[item.priority] || ''
              }</span>` : '';
          return `<div class="desk-item" data-arrange-type="${item.type}" data-arrange-id="${item.id}">
            <div class="desk-item-icon ${typeCls}">${icon}</div>
            <div class="desk-item-info">
              <div class="desk-item-title">${escapeHtml(item.title)}</div>
              <div class="desk-item-meta">
                ${catBadge(item.category)}
                ${priBadge}
                <span>${escapeHtml(item.time)}</span>
              </div>
            </div>
            <button class="desk-item-btn" data-arrange-type="${item.type}" data-arrange-id="${item.id}">安排</button>
          </div>`;
        }).join('');
      }
    }

    // 今日已排
    const list = $('#desk-arranged-list');
    if (list) {
      if (!arranged.length) {
        list.innerHTML = `<div class="desk-empty"><div class="desk-empty-icon">📭</div>今天还没有安排任何事项<br><small>从左边选一个「安排」吧</small></div>`;
      } else {
        list.innerHTML = arranged.map(item => {
          const linkIcon = item.isLinked ? '🔗' : '';
          const doneCls = item.todoCompleted === true ? ' style="opacity:0.55"' : '';
          return `<div class="desk-item"${doneCls}>
            <span class="desk-item-time">${item.start}</span>
            <div class="desk-item-info">
              <div class="desk-item-title">
                ${escapeHtml(item.title)}
                ${item.isLinked ? `<span class="desk-item-link">${linkIcon} 已绑定</span>` : ''}
              </div>
              <div class="desk-item-meta">
                ${catBadge(item.category)}
                <span>${item.end ? item.start + '-' + item.end : ''}</span>
              </div>
            </div>
            <button class="desk-item-btn" data-unarrange="${item.eventId}" title="取消安排">✕</button>
          </div>`;
        }).join('');
      }
    }
  }

  /** 打开快速安排弹窗 */
  let arrangeTarget = null;

  function openArrangeModal(type, id) {
    arrangeTarget = { type, id };
    const today = todayStr();

    // 预览信息
    const preview = $('#arrange-preview');
    if (type === 'todo') {
      const t = app.data.todos.find(x => x.id === id);
      if (!t) return;
      preview.innerHTML = `
        <div class="preview-icon">📝</div>
        <div>
          <div class="preview-title">${escapeHtml(t.title)}</div>
          <div class="preview-meta">${catBadge(t.category)} 预估 ${t.estimatedMin || 25} 分钟</div>
        </div>`;
      // 根据预估时长设置默认时间
      const dur = t.estimatedMin || 60;
      const now = new Date();
      const startH = Math.max(8, now.getHours());
      const startM = now.getMinutes() > 30 ? 30 : 0;
      $('#arrange-start').value = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
      const endTotal = startH * 60 + startM + dur;
      $('#arrange-end').value = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;
    } else {
      const ev = app.data.events.find(x => x.id === id);
      if (!ev) return;
      preview.innerHTML = `
        <div class="preview-icon">📅</div>
        <div>
          <div class="preview-title">${escapeHtml(ev.title)}</div>
          <div class="preview-meta">${catBadge(ev.category)} 原定 ${ev.date} ${ev.start}</div>
        </div>`;
      $('#arrange-start').value = ev.start;
      $('#arrange-end').value = ev.end || '';
    }

    openModal('modal-arrange');
  }

  /** 确认安排 — 创建绑定日程 */
  function confirmArrange() {
    if (!arrangeTarget) return;
    const start = $('#arrange-start').value;
    const end = $('#arrange-end').value;
    if (!start) { showToast('请选择开始时间', 'warning'); return; }

    const today = todayStr();

    if (arrangeTarget.type === 'todo') {
      const t = app.data.todos.find(x => x.id === arrangeTarget.id);
      if (!t) return;
      addEvent({
        title: t.title, date: today, start, end,
        repeat: 'none', reminder: 10,
        notes: `从待办安排 · 预估${t.estimatedMin || 25}分钟`,
        category: t.category,
        todoId: t.id
      });
      showToast(`「${t.title}」已安排到 ${start} 🔗`, 'success');
    } else {
      // 日程重新排到今天
      const ev = app.data.events.find(x => x.id === arrangeTarget.id);
      if (!ev) return;
      addEvent({
        title: ev.title, date: today, start, end: end || ev.end,
        repeat: 'none', reminder: ev.reminder,
        notes: ev.notes, category: ev.category,
        todoId: ev.todoId
      });
      showToast(`「${ev.title}」已安排到今天 ${start} 📅`, 'success');
    }

    closeModal('modal-arrange');
    arrangeTarget = null;
    refresh();
  }

  /** 取消安排（删除今天的绑定日程） */
  function unarrange(eventId) {
    const ev = app.data.events.find(e => e.id === eventId);
    if (!ev) return;
    app.data.events = app.data.events.filter(e => e.id !== eventId);
    saveState();
    showToast(`「${ev.title}」已从今天移除`, 'info');
    refresh();
  }

  /** 绑定完成联动：完成待办时，标记关联日程 */
  function syncLinkedEvents(todoId, completed) {
    app.data.events.forEach(ev => {
      if (ev.todoId === todoId) {
        ev.completed = completed;
      }
    });
    saveState();
  }

  /* ==========================================
     每日打卡系统
     ========================================== */

  /** 确保 dailyTodos 数据结构存在 */
  function ensureDailyData() {
    if (!app.data.dailyTodos) app.data.dailyTodos = [];
  }

  /** 获取每日打卡的连续天数 */
  function getDailyStreak(dailyId) {
    ensureDailyData();
    const d = app.data.dailyTodos.find(x => x.id === dailyId);
    if (!d || !d.history) return 0;
    let streak = 0;
    const day = new Date();
    // 从今天或昨天开始往回数
    const todayStr2 = todayStr();
    if (!d.history[todayStr2]) day.setDate(day.getDate() - 1);
    while (true) {
      const ds = todayStr(day);
      if (d.history[ds]) { streak++; day.setDate(day.getDate() - 1); }
      else break;
    }
    return streak;
  }

  /** 添加每日打卡项 */
  function addDailyTodo(title, category, emoji) {
    ensureDailyData();
    app.data.dailyTodos.push({
      id: uid(), title, category: category || '其他',
      emoji: emoji || '✏️',
      history: {},
      createdAt: new Date().toISOString()
    });
    saveState();
    showToast('每日打卡已添加 ✓', 'success');
  }

  /** 切换今天的打卡状态 */
  function toggleDaily(id) {
    ensureDailyData();
    const d = app.data.dailyTodos.find(x => x.id === id);
    if (!d) return;
    const today = todayStr();
    if (d.history[today]) {
      delete d.history[today];
    } else {
      d.history[today] = true;
      showToast('打卡成功！🌟', 'success');
      playCompleteSound();
    }
    saveState();
    renderDailyCheckin();
    // 如果在今日视图，也刷新
    if (app.ui.currentView === 'today') renderToday();
  }

  /** 删除每日打卡项 */
  function deleteDaily(id) {
    ensureDailyData();
    app.data.dailyTodos = app.data.dailyTodos.filter(x => x.id !== id);
    saveState();
    showToast('已删除打卡项', 'info');
    renderDailyCheckin();
  }

  /** 渲染每日打卡区域 */
  function renderDailyCheckin() {
    ensureDailyData();
    const list = $('#daily-list');
    const streakEl = $('#daily-streak');
    if (!list) return;

    const today = todayStr();

    if (!app.data.dailyTodos.length) {
      list.innerHTML = `<div class="desk-empty"><div class="desk-empty-icon">🌟</div>还没有每日打卡项<br><small>点击右上角「+ 添加」创建你的第一个打卡</small></div>`;
      if (streakEl) streakEl.textContent = '连续 0 天';
      return;
    }

    // 计算总体连续天数（所有打卡项都完成的天数）
    let totalStreak = 0;
    {
      const day = new Date();
      while (true) {
        const ds = todayStr(day);
        const allDone = app.data.dailyTodos.every(d => d.history[ds]);
        if (allDone && app.data.dailyTodos.length > 0) { totalStreak++; day.setDate(day.getDate() - 1); }
        else break;
      }
    }
    if (streakEl) streakEl.textContent = `连续 ${totalStreak} 天`;

    list.innerHTML = app.data.dailyTodos.map(d => {
      const doneToday = !!d.history[today];
      const streak = getDailyStreak(d.id);
      return `<div class="daily-item${doneToday ? ' done' : ''}" data-daily-id="${d.id}">
        <div class="daily-check${doneToday ? ' checked' : ''}" data-action="toggle-daily" data-id="${d.id}"></div>
        <div class="daily-emoji">${d.emoji}</div>
        <div class="daily-info">
          <div class="daily-title">${escapeHtml(d.title)}</div>
          <div class="daily-meta">
            ${catBadge(d.category)}
            ${streak > 0 ? `<span class="daily-streak-badge">🔥 ${streak} 天</span>` : ''}
            ${doneToday ? '<span style="color:var(--success)">✓ 今日已完成</span>' : ''}
          </div>
        </div>
        <button class="daily-delete" data-delete-daily="${d.id}" title="删除">✕</button>
      </div>`;
    }).join('');
  }

  /* ---------- 提醒检查 ---------- */
  function startReminderCheck() {
    setInterval(checkReminders, 30000);
    checkReminders();
  }

  function checkReminders() {
    const now = new Date();
    const today = todayStr();

    app.data.events.forEach(ev => {
      if (ev.notified && ev.repeat === 'none') return;
      if (ev.reminder < 0) return;

      let shouldCheck = ev.date === today;
      if (ev.repeat === 'daily' && ev.date <= today) shouldCheck = true;
      if (ev.repeat === 'weekly' && ev.date <= today) shouldCheck = parseDate(ev.date).getDay() === parseDate(today).getDay();
      if (ev.repeat === 'monthly' && ev.date <= today) shouldCheck = parseDate(ev.date).getDate() === parseDate(today).getDate();
      if (!shouldCheck) return;

      const [h, m] = ev.start.split(':').map(Number);
      const eventTime = new Date();
      eventTime.setHours(h, m, 0, 0);
      const reminderTime = new Date(eventTime.getTime() - ev.reminder * 60000);
      const diff = now - reminderTime;

      if (diff >= 0 && diff < 60000) {
        sendNotification('日程提醒', `「${ev.title}」${ev.reminder > 0 ? '将在 ' + ev.reminder + ' 分钟后' : '现在'}开始 (${ev.start})`);
        ev.notified = true;
        saveState();
      }
    });

    if (app.ui.currentView === 'today') renderNextReminder();
  }

  /* ==========================================
     日历 + 热力图
     ========================================== */
  function getFocusMinutesByDate(dateStr, category) {
    // 只统计已完成的：绑定任务的 session 只有任务完成才算，纯专注时间正常算
    let sessions = app.data.sessions.filter(s => {
      if (s.date !== dateStr) return false;
      if (s.todoId) {
        const todo = app.data.todos.find(t => t.id === s.todoId);
        return todo && todo.completed; // 只有任务完成才计数
      }
      return true; // 纯专注（无绑定任务）正常计数
    });
    if (category && category !== 'all') {
      sessions = sessions.filter(s => {
        if (s.category === category) return true;
        if (s.todoId) {
          const todo = app.data.todos.find(t => t.id === s.todoId);
          return todo && todo.category === category;
        }
        return false;
      });
    }
    let total = sessions.reduce((a, s) => a + s.durationMin, 0);

    // 额外：已完成的任务也贡献热力（每完成一个任务 +5 分钟等效热力）
    const doneTodos = app.data.todos.filter(t => {
      if (!t.completed || !t.completedAt) return false;
      const doneDate = t.completedAt.split('T')[0];
      if (doneDate !== dateStr) return false;
      if (category && category !== 'all' && t.category !== category) return false;
      return true;
    });
    total += doneTodos.length * 5;

    return total;
  }

  function getHeatLevel(minutes) {
    if (minutes <= 0) return 0;
    if (minutes <= 15) return 1;
    if (minutes <= 30) return 2;
    if (minutes <= 60) return 3;
    return 4;
  }

  function renderCalendar() {
    const year = app.ui.calendarYear;
    const month = app.ui.calendarMonth;
    const selected = app.ui.calendarSelected;
    const filter = app.ui.calFilter;

    $('#cal-month-label').textContent = year + '年' + (month + 1) + '月';

    // 生成日历网格
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const totalDays = daysInMonth(year, month);
    const today = todayStr();

    let html = '';
    // 上月填充
    const prevMonthDays = daysInMonth(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      html += `<div class="cal-day empty other-month"><span class="cal-day-num">${day}</span></div>`;
    }

    // 本月日期
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const focusMin = getFocusMinutesByDate(dateStr, filter);
      const heat = getHeatLevel(focusMin);
      const isToday = dateStr === today;
      const isSelected = dateStr === selected;

      // 事件点
      const dayEvents = getEventsForDate(dateStr).filter(ev => {
        return filter === 'all' || !ev.category || ev.category === filter;
      });
      const dots = dayEvents.slice(0, 3).map(() => '<div class="cal-dot"></div>').join('');

      const dayFocusSessions = app.data.sessions.filter(s => {
        if (s.date !== dateStr) return false;
        if (filter === 'all') return true;
        if (s.category === filter) return true;
        if (s.todoId) {
          const todo = app.data.todos.find(t => t.id === s.todoId);
          return todo && todo.category === filter;
        }
        return false;
      });

      const focusDot = dayFocusSessions.length > 0 ? '<div class="cal-dot focus"></div>' : '';

      html += `<div class="cal-day heat-${heat}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}"
        data-date="${dateStr}" title="${focusMin > 0 ? '专注 ' + focusMin + ' 分钟' : ''}">
        <span class="cal-day-num">${d}</span>
        <div class="cal-dots">${dots}${focusDot}</div>
      </div>`;
    }

    // 下月填充
    const totalCells = firstDay + totalDays;
    const remaining = (7 - totalCells % 7) % 7;
    for (let i = 1; i <= remaining; i++) {
      html += `<div class="cal-day empty other-month"><span class="cal-day-num">${i}</span></div>`;
    }

    $('#calendar-grid').innerHTML = html;

    // 日详情
    renderDayDetail(selected, filter);

    // 月度统计
    renderMonthStats(year, month, filter);
  }

  function renderDayDetail(dateStr, filter) {
    $('#cal-day-title').textContent = formatDateCN(dateStr, true);

    const focusMin = getFocusMinutesByDate(dateStr, filter);
    const events = getEventsForDate(dateStr).filter(ev => filter === 'all' || !ev.category || ev.category === filter);
    const todos = app.data.todos.filter(t => {
      if (t.due !== dateStr) return false;
      return filter === 'all' || t.category === filter;
    });
    const sessions = app.data.sessions.filter(s => {
      if (s.date !== dateStr) return false;
      if (filter === 'all') return true;
      if (s.category === filter) return true;
      if (s.todoId) {
        const todo = app.data.todos.find(t => t.id === s.todoId);
        return todo && todo.category === filter;
      }
      return false;
    });

    // 统计行
    $('#day-stats-row').innerHTML = `
      <div class="day-stat-pill">专注 <strong>${focusMin}</strong> 分钟</div>
      <div class="day-stat-pill"><strong>${events.length}</strong> 个日程</div>
      <div class="day-stat-pill"><strong>${todos.length}</strong> 个任务</div>
      <div class="day-stat-pill"><strong>${sessions.length}</strong> 次专注</div>
    `;

    // 日程
    $('#cal-day-events').innerHTML = events.length
      ? events.map(ev => `<div class="day-item">
          <span class="day-item-time">${ev.start}</span>
          <span class="day-item-title">${escapeHtml(ev.title)}</span>
          ${ev.category ? catBadge(ev.category) : ''}
        </div>`).join('')
      : '<div class="day-empty">暂无日程</div>';

    // 任务
    $('#cal-day-todos').innerHTML = todos.length
      ? todos.map(t => `<div class="day-item">
          <span class="day-item-title" style="${t.completed ? 'text-decoration:line-through;opacity:0.6' : ''}">${escapeHtml(t.title)}</span>
          ${catBadge(t.category || '其他')}
          ${t.completed ? '<span class="badge badge-focus">✓</span>' : ''}
        </div>`).join('')
      : '<div class="day-empty">暂无任务</div>';

    // 专注记录
    $('#cal-day-sessions').innerHTML = sessions.length
      ? sessions.map(s => {
          const todo = s.todoId ? app.data.todos.find(t => t.id === s.todoId) : null;
          return `<div class="day-item">
            <span class="day-item-time">${s.durationMin}分</span>
            <span class="day-item-title">${todo ? escapeHtml(todo.title) : '独立专注'}</span>
            ${catBadge(s.category || '专注')}
          </div>`;
        }).join('')
      : '<div class="day-empty">暂无专注记录</div>';
  }

  function renderMonthStats(year, month, filter) {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    const monthSessions = app.data.sessions.filter(s => {
      if (!s.date.startsWith(prefix)) return false;
      if (filter === 'all') return true;
      if (s.category === filter) return true;
      if (s.todoId) {
        const todo = app.data.todos.find(t => t.id === s.todoId);
        return todo && todo.category === filter;
      }
      return false;
    });

    const totalFocus = monthSessions.reduce((a, s) => a + s.durationMin, 0);
    const pomodoro = monthSessions.filter(s => s.type === 'pomodoro' && s.phase === 'work').length;
    const monthEvents = app.data.events.filter(e => {
      if (!e.date.startsWith(prefix)) return false;
      return filter === 'all' || !e.category || e.category === filter;
    }).length;
    const monthTodos = app.data.todos.filter(t => {
      return t.completed && t.completedAt && t.completedAt.startsWith(prefix) &&
        (filter === 'all' || t.category === filter);
    }).length;

    // 计算日均和最佳
    const dailyMap = {};
    monthSessions.forEach(s => {
      dailyMap[s.date] = (dailyMap[s.date] || 0) + s.durationMin;
    });
    const dayCount = Object.keys(dailyMap).length;
    const avg = dayCount > 0 ? Math.round(totalFocus / dayCount) : 0;
    const best = Object.values(dailyMap).reduce((a, b) => Math.max(a, b), 0);

    $('#ms-focus-total').textContent = totalFocus;
    $('#ms-pomodoro').textContent = pomodoro;
    $('#ms-events').textContent = monthEvents;
    $('#ms-tasks').textContent = monthTodos;
    $('#ms-avg').textContent = avg;
    $('#ms-best').textContent = best;
  }

  /* ==========================================
     计时器引擎
     ========================================== */
  function initTimer() {
    const t = app.timer;
    if (t.mode === 'stopwatch') {
      t.remaining = 0; t.total = 0;
    } else if (t.mode === 'custom') {
      t.remaining = t.customMinutes * 60;
      t.total = t.customMinutes * 60;
    } else {
      const s = app.data.settings;
      const mins = t.phase === 'work' ? s.pomodoroWork : t.phase === 'shortBreak' ? s.pomodoroShortBreak : s.pomodoroLongBreak;
      t.remaining = mins * 60;
      t.total = mins * 60;
    }
    updateTimerDisplay();
  }

  function startTimer() {
    if (app.timer.running) return;
    app.timer.running = true;
    app.timer.startedAt = new Date().toISOString();

    if (app.timer.mode === 'stopwatch') {
      app.timer.intervalId = setInterval(() => { app.timer.remaining++; updateTimerDisplay(); }, 1000);
    } else {
      app.timer.intervalId = setInterval(() => {
        app.timer.remaining--;
        if (app.timer.remaining <= 0) {
          app.timer.remaining = 0;
          updateTimerDisplay();
          timerComplete();
        } else {
          updateTimerDisplay();
          if (app.timer.remaining <= 5) playTickSound();
        }
      }, 1000);
    }
    updateTimerControls();
  }

  function pauseTimer() {
    if (!app.timer.running) return;
    app.timer.running = false;
    clearInterval(app.timer.intervalId);
    app.timer.intervalId = null;
    updateTimerControls();
  }

  function resetTimer() { pauseTimer(); initTimer(); }

  function toggleTimer() {
    app.timer.running ? pauseTimer() : startTimer();
  }

  function skipPhase() {
    if (app.timer.mode === 'stopwatch') { resetTimer(); return; }
    pauseTimer();
    timerComplete(true);
  }

  function timerComplete(skipped) {
    if (!skipped) playCompleteSound();

    const focusPhases = ['work', 'custom', 'stopwatch'];
    const isFocus = focusPhases.includes(app.timer.phase);
    const elapsedMin = Math.round((app.timer.total - app.timer.remaining) / 60);

    if (isFocus && elapsedMin > 0) {
      // 确定分类
      let category = '其他';
      if (app.timer.linkedTodoId) {
        const todo = app.data.todos.find(t => t.id === app.timer.linkedTodoId);
        if (todo) {
          category = todo.category || '其他';
          todo.focusedMin = (todo.focusedMin || 0) + elapsedMin;
        }
      }

      app.data.sessions.push({
        id: uid(), type: app.timer.mode, phase: app.timer.phase,
        date: todayStr(), startTime: app.timer.startedAt,
        endTime: new Date().toISOString(), durationMin: elapsedMin,
        todoId: app.timer.linkedTodoId || null, category
      });
      saveState();
    }

    if (app.timer.mode === 'pomodoro' && !skipped) {
      if (app.timer.phase === 'work') {
        app.timer.pomodoroCount++;
        const s = app.data.settings;
        if (app.timer.pomodoroCount % s.pomodorosUntilLongBreak === 0) {
          app.timer.phase = 'longBreak';
          showToast('🍅 完成一个番茄！进入长休息', 'success');
        } else {
          app.timer.phase = 'shortBreak';
          showToast('🍅 专注完成！休息一下吧', 'success');
        }
      } else {
        app.timer.phase = 'work';
        showToast('休息结束，继续加油 💪', 'success');
      }
    } else if (app.timer.mode === 'custom' && !skipped) {
      showToast('⏱ 计时完成！', 'success');
      app.timer.phase = 'custom';
    }

    initTimer();
    updateTimerControls();
    refresh();

    if (!skipped) {
      if (app.timer.mode === 'pomodoro' && app.timer.phase !== 'work') {
        sendNotification('专注完成！', '休息一下吧，放松放松 🌿');
      } else if (app.timer.mode === 'pomodoro') {
        sendNotification('休息结束', '准备开始下一轮专注 💪');
      }
    }
  }

  function updateTimerDisplay() {
    const t = app.timer;
    $('#timer-display').textContent = formatSecs(t.remaining);

    const circ = 2 * Math.PI * 100;
    const ring = $('#timer-ring-fill');
    if (t.mode === 'stopwatch') {
      ring.style.strokeDashoffset = 0;
    } else {
      const progress = t.total > 0 ? t.remaining / t.total : 1;
      ring.style.strokeDasharray = circ;
      ring.style.strokeDashoffset = circ * (1 - progress);
    }

    const labels = { work: '专注中', shortBreak: '短休息', longBreak: '长休息', custom: '自定义专注', stopwatch: '秒表运行中' };
    $('#timer-phase-label').textContent = t.running ? (labels[t.phase] || '进行中') : (t.remaining < t.total ? '已暂停' : '准备开始');

    $('.timer-hero').classList.toggle('break-mode', ['shortBreak', 'longBreak'].includes(t.phase));

    $$('.phase-chip').forEach(c => c.classList.toggle('active', c.dataset.phase === t.phase));

    // 同步悬浮钟
    if (typeof updateFloatingDisplay === 'function') updateFloatingDisplay();

    document.title = t.running && t.mode !== 'stopwatch'
      ? formatSecs(t.remaining) + ' · 此刻 FocusNow'
      : '此刻 FocusNow · 专注日程管理';
  }

  function updateTimerControls() {
    const icon = $('#btn-timer-icon');
    icon.innerHTML = app.timer.running
      ? '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'
      : '<polygon points="6 3 20 12 6 21 6 3"/>';
  }

  function setTimerMode(mode) {
    pauseTimer();
    app.timer.mode = mode;
    if (mode === 'pomodoro') {
      app.timer.phase = 'work';
      $('#phase-indicator').style.display = 'flex';
      $('#custom-duration').style.display = 'none';
    } else if (mode === 'custom') {
      app.timer.phase = 'custom';
      $('#phase-indicator').style.display = 'none';
      $('#custom-duration').style.display = 'block';
    } else {
      app.timer.phase = 'stopwatch';
      $('#phase-indicator').style.display = 'none';
      $('#custom-duration').style.display = 'none';
    }
    initTimer();
    $$('.mode-chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
  }

  function renderFocus() {
    const today = todayStr();
    const ts = app.data.sessions.filter(s => s.date === today);
    $('#fstat-today').textContent = ts.reduce((a, s) => a + s.durationMin, 0);
    $('#fstat-pomodoro').textContent = ts.filter(s => s.type === 'pomodoro' && s.phase === 'work').length;
    $('#fstat-sessions').textContent = ts.length;

    let streak = 0, cd = today;
    while (app.data.sessions.some(s => s.date === cd)) { streak++; cd = addDays(cd, -1); }
    $('#fstat-streak').textContent = streak;

    updateTimerDisplay();
    updateTimerControls();
  }

  function renderFocusTodoSelect() {
    const sel = $('#focus-todo-select');
    const todos = app.data.todos.filter(t => !t.completed);
    sel.innerHTML = '<option value="">— 不关联任务 —</option>' +
      todos.map(t => `<option value="${t.id}" ${app.timer.linkedTodoId === t.id ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('');
  }

  /* ==========================================
     弹窗
     ========================================== */
  function openModal(id) {
    $('#' + id).classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    $('#' + id).classList.remove('show');
    document.body.style.overflow = '';
  }

  function closeAllModals() {
    $$('.modal-overlay').forEach(m => m.classList.remove('show'));
    document.body.style.overflow = '';
  }

  /* ==========================================
     刷新
     ========================================== */
  function refresh() {
    const v = app.ui.currentView;
    if (v === 'today') renderToday();
    else if (v === 'todos') renderTodos();
    else if (v === 'schedule') renderSchedule();
    else if (v === 'calendar') renderCalendar();
    else if (v === 'focus') renderFocus();
  }

  /* ==========================================
     事件绑定
     ========================================== */
  function bindEvents() {
    // 导航（侧边栏 + 底部栏 + 侧边栏设置按钮）
    $$('.sidebar-item, .nav-item, .sidebar-settings-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $$('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.goto));
    });

    // 通知
    $('#btn-notify').addEventListener('click', requestNotifPermission);

    // 待办筛选
    $$('#todo-filters .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('#todo-filters .filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        app.ui.todoFilter = chip.dataset.filter;
        renderTodos();
      });
    });

    // 添加待办
    $('#btn-add-todo').addEventListener('click', () => {
      $('#form-todo').reset();
      $('#todo-due').value = todayStr();
      openModal('modal-todo');
      setTimeout(() => $('#todo-title').focus(), 100);
    });

    $('#form-todo').addEventListener('submit', e => {
      e.preventDefault();
      addTodo({
        title: $('#todo-title').value.trim(), desc: $('#todo-desc').value.trim(),
        priority: $('#todo-priority').value, category: $('#todo-category').value,
        due: $('#todo-due').value, estimatedMin: parseInt($('#todo-est').value, 10) || 25
      });
      closeModal('modal-todo');
      refresh();
    });

    // 编辑待办
    $('#form-edit-todo').addEventListener('submit', e => {
      e.preventDefault();
      updateTodo($('#edit-todo-id').value, {
        title: $('#edit-todo-title').value.trim(), description: $('#edit-todo-desc').value.trim(),
        priority: $('#edit-todo-priority').value, category: $('#edit-todo-category').value,
        due: $('#edit-todo-due').value, estimatedMin: parseInt($('#edit-todo-est').value, 10) || 25
      });
      closeModal('modal-edit-todo');
      refresh();
    });

    $('#btn-delete-todo').addEventListener('click', () => {
      if (confirm('确定删除这个任务吗？')) {
        deleteTodo($('#edit-todo-id').value);
        closeModal('modal-edit-todo');
        refresh();
      }
    });

    // 待办点击委托
    function todoClickHandler(e) {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action, id = el.dataset.id;

      if (action === 'toggle') return toggleTodo(id);
      if (action === 'focus') {
        const todo = app.data.todos.find(t => t.id === id);
        if (todo) {
          app.timer.linkedTodoId = id;
          setTimerMode('pomodoro');
          switchView('focus');
          startTimer();
          showToast(`开始专注：${todo.title}`, 'success');
        }
      }
      if (action === 'edit') {
        const todo = app.data.todos.find(t => t.id === id);
        if (todo) {
          $('#edit-todo-id').value = todo.id;
          $('#edit-todo-title').value = todo.title;
          $('#edit-todo-desc').value = todo.description || '';
          $('#edit-todo-priority').value = todo.priority;
          $('#edit-todo-category').value = todo.category;
          $('#edit-todo-due').value = todo.due || '';
          $('#edit-todo-est').value = todo.estimatedMin || 25;
          openModal('modal-edit-todo');
        }
      }
    }

    $('#todo-list').addEventListener('click', todoClickHandler);
    $('#today-todos').addEventListener('click', todoClickHandler);

    // 添加日程
    $('#btn-add-event').addEventListener('click', () => {
      $('#form-event').reset();
      $('#event-date').value = app.ui.scheduleDate;
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(Math.ceil(now.getMinutes() / 30) * 30 % 60).padStart(2, '0');
      const hh = m === '00' && now.getMinutes() > 29 ? String(Math.min(23, now.getHours() + 1)).padStart(2, '0') : h;
      $('#event-start').value = hh + ':' + m;
      $('#event-end').value = String(Math.min(23, parseInt(hh, 10) + 1)).padStart(2, '0') + ':' + m;
      openModal('modal-event');
      setTimeout(() => $('#event-title').focus(), 100);
    });

    $('#form-event').addEventListener('submit', e => {
      e.preventDefault();
      addEvent({
        title: $('#event-title').value.trim(), date: $('#event-date').value,
        start: $('#event-start').value, end: $('#event-end').value,
        repeat: $('#event-repeat').value, reminder: parseInt($('#event-reminder').value, 10),
        notes: $('#event-notes').value.trim(), category: $('#event-category').value
      });
      closeModal('modal-event');
      refresh();
    });

    // 日期导航
    $('#btn-prev-day').addEventListener('click', () => {
      app.ui.scheduleDate = addDays(app.ui.scheduleDate, -1);
      renderSchedule();
    });
    $('#btn-next-day').addEventListener('click', () => {
      app.ui.scheduleDate = addDays(app.ui.scheduleDate, 1);
      renderSchedule();
    });
    $('#btn-today-jump').addEventListener('click', () => {
      app.ui.scheduleDate = todayStr();
      renderSchedule();
    });

    // 日程事件删除
    $('#timeline').addEventListener('click', e => {
      const el = e.target.closest('.timeline-event');
      if (el && confirm('删除这个日程？')) deleteEvent(el.dataset.eventId);
    });

    // ===== 日历 =====
    $('#cal-prev').addEventListener('click', () => {
      app.ui.calendarMonth--;
      if (app.ui.calendarMonth < 0) { app.ui.calendarMonth = 11; app.ui.calendarYear--; }
      renderCalendar();
    });

    $('#cal-next').addEventListener('click', () => {
      app.ui.calendarMonth++;
      if (app.ui.calendarMonth > 11) { app.ui.calendarMonth = 0; app.ui.calendarYear++; }
      renderCalendar();
    });

    // 日历分类筛选
    $$('#cal-filters .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('#cal-filters .filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        app.ui.calFilter = chip.dataset.cat;
        renderCalendar();
      });
    });

    // 日历点击日期
    $('#calendar-grid').addEventListener('click', e => {
      const day = e.target.closest('.cal-day[data-date]');
      if (!day) return;
      app.ui.calendarSelected = day.dataset.date;
      renderCalendar();
    });

    // ===== 计时器 =====
    $$('.mode-chip').forEach(chip => {
      chip.addEventListener('click', () => setTimerMode(chip.dataset.mode));
    });

    $$('.phase-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (app.timer.mode !== 'pomodoro') return;
        pauseTimer();
        app.timer.phase = chip.dataset.phase;
        initTimer();
      });
    });

    $$('.dur-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.dur-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        app.timer.customMinutes = parseInt(btn.dataset.min, 10);
        if (app.timer.mode === 'custom') initTimer();
      });
    });

    $('#btn-timer-toggle').addEventListener('click', toggleTimer);
    $('#btn-timer-reset').addEventListener('click', resetTimer);
    $('#btn-timer-skip').addEventListener('click', skipPhase);

    $('#focus-todo-select').addEventListener('change', e => {
      app.timer.linkedTodoId = e.target.value || null;
    });

    // ===== 安排台事件 =====
    // 点击「安排」按钮 / 点击待安排项
    document.addEventListener('click', e => {
      const btn = e.target.closest('.desk-item-btn');
      if (btn && btn.dataset.arrangeType) {
        openArrangeModal(btn.dataset.arrangeType, btn.dataset.arrangeId);
        return;
      }
      const unBtn = e.target.closest('[data-unarrange]');
      if (unBtn) {
        unarrange(unBtn.dataset.unarrange);
        return;
      }
    });

    // 快速时间选择
    $$('.quick-time-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.quick-time-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const hours = parseFloat(chip.dataset.hours);
        const start = $('#arrange-start').value;
        if (start) {
          const [h, m] = start.split(':').map(Number);
          const endMin = h * 60 + m + hours * 60;
          $('#arrange-end').value = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
        }
      });
    });

    // 确认安排
    $('#btn-arrange-confirm').addEventListener('click', confirmArrange);

    // ===== 每日打卡事件 =====
    const addDailyBtn = $('#btn-add-daily');
    if (addDailyBtn) {
      addDailyBtn.addEventListener('click', () => {
        $('#daily-title').value = '';
        $('#daily-category').value = '设计';
        $$('.emoji-opt').forEach(b => b.classList.remove('active'));
        const first = $('.emoji-opt');
        if (first) first.classList.add('active');
        openModal('modal-daily');
        setTimeout(() => $('#daily-title').focus(), 100);
      });
    }

    // Emoji 选择
    document.querySelectorAll('.emoji-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.emoji-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // 保存每日打卡
    const dailySaveBtn = $('#btn-daily-save');
    if (dailySaveBtn) {
      dailySaveBtn.addEventListener('click', () => {
        const title = $('#daily-title').value.trim();
        if (!title) { showToast('请输入打卡项目', 'warning'); return; }
        const category = $('#daily-category').value;
        const emoji = ($('.emoji-opt.active') || {}).dataset?.emoji || '✏️';
        addDailyTodo(title, category, emoji);
        closeModal('modal-daily');
        renderDailyCheckin();
      });
    }

    // 每日打卡点击事件（勾选/删除）
    document.addEventListener('click', e => {
      const check = e.target.closest('[data-action="toggle-daily"]');
      if (check) {
        toggleDaily(check.dataset.id);
        return;
      }
      const del = e.target.closest('[data-delete-daily]');
      if (del) {
        deleteDaily(del.dataset.deleteDaily);
        return;
      }
    });

    // 弹窗关闭
    $$('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    $$('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => { if (e.target === overlay) closeAllModals(); });
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
  }

  /* ==========================================
     皮肤系统
     ========================================== */
  const themes = {
    pinkblack: {
      name: '粉黑', desc: '暗夜玫瑰',
      swatches: ['#FF2E7E', '#282834', '#FF8FAB', '#0A0A0E', '#3DDC91']
    },
    candy: {
      name: 'Candy Pop', desc: '糖果汽水',
      swatches: ['#F4B8CA', '#8FC5EE', '#FFE39A', '#B9E4CE', '#CBBDEC']
    },
    midnight: {
      name: 'Midnight', desc: '夜间数字世界',
      swatches: ['#E58BB9', '#303C68', '#F1CF76', '#72C9C0', '#9890ED']
    },
    matcha: {
      name: 'Matcha', desc: '抹茶甜品',
      swatches: ['#B9D8B7', '#789F78', '#F4E4C9', '#D7B99B', '#E7EDCF']
    },
    strawberry: {
      name: 'Strawberry', desc: '草莓奶油',
      swatches: ['#F2A9BD', '#E98D9E', '#FFF0D9', '#D8C0E9', '#F8D9DF']
    }
  };

  function applyTheme(key) {
    if (!themes[key]) key = 'pinkblack';
    document.documentElement.setAttribute('data-theme', key);
    localStorage.setItem('focusnow_theme', key);
    renderThemeSelector();
  }

  function getTheme() {
    return localStorage.getItem('focusnow_theme') || 'pinkblack';
  }

  function renderThemeSelector() {
    const bar = $('#theme-bar');
    if (!bar) return;
    const current = getTheme();
    bar.innerHTML = Object.entries(themes).map(([key, t]) =>
      `<button class="theme-card${key === current ? ' active' : ''}" data-theme-key="${key}">
        <div class="theme-swatches">${t.swatches.map(c => `<i style="background:${c}"></i>`).join('')}</div>
        <b>${t.name}</b><small>${t.desc}</small>
      </button>`
    ).join('');

    bar.querySelectorAll('[data-theme-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.themeKey);
        showToast('已切换到「' + themes[btn.dataset.themeKey].name + '」皮肤', 'success');
      });
    });
  }

  /* ==========================================
     设置系统
     ========================================== */
  function loadSettingsUI() {
    const s = app.data.settings;
    const $ = sel => document.querySelector(sel);

    const soundEl = $('#setting-sound');
    const notifyEl = $('#setting-notify');
    const goalEl = $('#setting-daily-goal');
    const workEl = $('#setting-pomo-work');
    const shortEl = $('#setting-pomo-short');
    const longEl = $('#setting-pomo-long');

    if (soundEl) soundEl.checked = s.soundEnabled !== false;
    if (notifyEl) notifyEl.checked = s.notifEnabled === true;
    if (goalEl) goalEl.value = s.dailyFocusGoal || 120;
    if (workEl) workEl.value = s.pomodoroWork || 25;
    if (shortEl) shortEl.value = s.pomodoroShortBreak || 5;
    if (longEl) longEl.value = s.pomodoroLongBreak || 15;
  }

  function bindSettingsEvents() {
    const $ = sel => document.querySelector(sel);

    // 音效开关
    const soundEl = $('#setting-sound');
    if (soundEl) soundEl.addEventListener('change', () => {
      app.data.settings.soundEnabled = soundEl.checked;
      saveState();
      showToast(soundEl.checked ? '音效已开启 🔊' : '音效已关闭', 'success');
    });

    // 通知开关
    const notifyEl = $('#setting-notify');
    if (notifyEl) notifyEl.addEventListener('change', () => {
      app.data.settings.notifEnabled = notifyEl.checked;
      saveState();
      if (notifyEl.checked && 'Notification' in window) {
        Notification.requestPermission().then(p => {
          showToast(p === 'granted' ? '通知已开启 🔔' : '浏览器拒绝了通知权限', p === 'granted' ? 'success' : 'warning');
        });
      } else {
        showToast(notifyEl.checked ? '通知已开启 🔔' : '通知已关闭', 'success');
      }
    });

    // 每日目标
    const goalEl = $('#setting-daily-goal');
    if (goalEl) goalEl.addEventListener('change', () => {
      const v = Math.max(10, Math.min(999, parseInt(goalEl.value) || 120));
      goalEl.value = v;
      app.data.settings.dailyFocusGoal = v;
      saveState();
      showToast('每日目标已设为 ' + v + ' 分钟', 'success');
    });

    // 番茄钟设置
    [['#setting-pomo-work', 'pomodoroWork', 5, 120], ['#setting-pomo-short', 'pomodoroShortBreak', 1, 30], ['#setting-pomo-long', 'pomodoroLongBreak', 5, 60]].forEach(([sel, key, min, max]) => {
      const el = $(sel);
      if (el) el.addEventListener('change', () => {
        const v = Math.max(min, Math.min(max, parseInt(el.value) || min));
        el.value = v;
        app.data.settings[key] = v;
        saveState();
        showToast('设置已保存', 'success');
      });
    });

    // 数据导出
    const exportBtn = $('#btn-export-data');
    if (exportBtn) exportBtn.addEventListener('click', () => {
      const data = JSON.stringify(app.data, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'focusnow-backup-' + todayStr() + '.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('数据已导出 ✓', 'success');
    });

    // 数据导入
    const importBtn = $('#btn-import-data');
    if (importBtn) importBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const data = JSON.parse(ev.target.result);
            if (data && data.todos && data.events) {
              app.data = data;
              saveState();
              showToast('数据导入成功 ✓', 'success');
              refresh();
            } else {
              showToast('文件格式不正确', 'warning');
            }
          } catch (err) {
            showToast('文件解析失败', 'warning');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });

    // 清除数据
    const clearBtn = $('#btn-clear-data');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (confirm('⚠️ 确定要清除所有数据吗？此操作不可恢复！')) {
        if (confirm('再次确认：真的要删除全部任务、日程和记录吗？')) {
          app.data = defaultData();
          saveState();
          showToast('所有数据已清除', 'warning');
          refresh();
        }
      }
    });
  }

  /* ==========================================
     拖拽时间轴系统
     ========================================== */
  let dragMode = 'snap'; // snap | free | time
  let dragState = {
    active: false,
    eventId: null,
    startX: 0,
    startY: 0,
    origTop: 0,
    origLeft: 0
  };

  function initDragSystem() {
    // 模式切换
    document.querySelectorAll('[data-drag-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-drag-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        dragMode = btn.dataset.dragMode;

        const labels = { snap: '📌 吸附拖拽模式', free: '🖐 自由拖拽模式', time: '⏱ 时间定位模式' };
        showToast(labels[dragMode] + ' 已启用', 'success');

        if (dragMode === 'time') {
          showToast('点击日程事件可直接编辑精确时间', 'warning');
        }
        renderSchedule();
      });
    });

    // 拖拽事件委托
    const timeline = $('#timeline');
    if (!timeline) return;

    timeline.addEventListener('mousedown', onDragStart);
    timeline.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchend', onDragEnd);
  }

  function onDragStart(e) {
    const eventEl = e.target.closest('.timeline-event');
    if (!eventEl) return;

    if (dragMode === 'time') {
      // 时间定位模式：点击打开编辑
      const id = eventEl.dataset.eventId;
      const ev = app.data.events.find(x => x.id === id);
      if (ev) {
        const newStart = prompt('输入开始时间 (HH:MM):', ev.start);
        if (newStart && /^\d{1,2}:\d{2}$/.test(newStart)) {
          ev.start = newStart.padStart(5, '0');
          saveState();
          renderSchedule();
          showToast('时间已更新为 ' + ev.start, 'success');
        }
      }
      return;
    }

    e.preventDefault();
    const pos = e.touches ? e.touches[0] : e;
    dragState.active = true;
    dragState.eventId = eventEl.dataset.eventId;
    dragState.startX = pos.clientX;
    dragState.startY = pos.clientY;
    dragState.origTop = eventEl.offsetTop;
    dragState.origLeft = eventEl.offsetLeft;

    eventEl.classList.add('dragging');
  }

  function onDragMove(e) {
    if (!dragState.active) return;
    e.preventDefault();

    const pos = e.touches ? e.touches[0] : e;
    const dx = pos.clientX - dragState.startX;
    const dy = pos.clientY - dragState.startY;

    const eventEl = document.querySelector(`.timeline-event[data-event-id="${dragState.eventId}"]`);
    if (!eventEl) return;

    if (dragMode === 'free') {
      // 自由拖拽：像素级移动
      eventEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`;
      eventEl.style.opacity = '0.7';
    } else if (dragMode === 'snap') {
      // 吸附拖拽：吸附到 30 分钟网格
      const rowHeight = 56;
      const snapDy = Math.round(dy / (rowHeight / 2)) * (rowHeight / 2);
      eventEl.style.transform = `translate(0px, ${snapDy}px) scale(1.03)`;
      eventEl.style.opacity = '0.7';

      // 高亮最近的槽位
      highlightNearestSlot(eventEl, snapDy);
    }
  }

  function highlightNearestSlot(eventEl, dy) {
    document.querySelectorAll('.timeline-slot.drop-ready').forEach(s => s.classList.remove('drop-ready'));
    const rect = eventEl.getBoundingClientRect();
    const slots = document.querySelectorAll('.timeline-slot');
    let closest = null, closestDist = Infinity;

    slots.forEach(slot => {
      const slotRect = slot.getBoundingClientRect();
      const dist = Math.abs(slotRect.top - rect.top);
      if (dist < closestDist) { closestDist = dist; closest = slot; }
    });

    if (closest && closestDist < 40) {
      closest.classList.add('drop-ready');
    }
  }

  function onDragEnd(e) {
    if (!dragState.active) return;
    dragState.active = false;

    const eventEl = document.querySelector(`.timeline-event[data-event-id="${dragState.eventId}"]`);
    if (!eventEl) return;

    eventEl.classList.remove('dragging');
    eventEl.style.transform = '';
    eventEl.style.opacity = '';

    const ev = app.data.events.find(x => x.id === dragState.eventId);
    if (!ev) return;

    if (dragMode === 'snap') {
      // 根据拖拽距离计算新的时间
      const dy = (e.changedTouches ? e.changedTouches[0].clientY : e.clientY) - dragState.startY;
      const rowHeight = 56;
      const slotsMoved = Math.round(dy / (rowHeight / 2)) * 0.5; // 30分钟粒度

      const oldMinutes = parseInt(ev.start.split(':')[0], 10) * 60 + parseInt(ev.start.split(':')[1], 10);
      const newMinutes = Math.max(6 * 60, Math.min(23 * 60 + 30, oldMinutes + slotsMoved * 30));
      const h = Math.floor(newMinutes / 60);
      const m = newMinutes % 60;
      ev.start = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

      if (ev.end) {
        const oldDur = parseInt(ev.end.split(':')[0], 10) * 60 + parseInt(ev.end.split(':')[1], 10) - oldMinutes;
        const endMin = Math.min(23 * 60 + 59, newMinutes + oldDur);
        ev.end = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');
      }

      saveState();
      renderSchedule();
      showToast('已移动到 ' + ev.start, 'success');
    } else if (dragMode === 'free') {
      // 自由模式：像素级精确计算时间，不吸附网格
      const dy = (e.changedTouches ? e.changedTouches[0].clientY : e.clientY) - dragState.startY;
      const rowHeight = 56;
      const minutesMoved = Math.round(dy * (60 / rowHeight)); // 精确到分钟，不吸附

      const oldMinutes = parseInt(ev.start.split(':')[0], 10) * 60 + parseInt(ev.start.split(':')[1], 10);
      const newMinutes = Math.max(6 * 60, Math.min(23 * 60 + 59, oldMinutes + minutesMoved));
      ev.start = String(Math.floor(newMinutes / 60)).padStart(2, '0') + ':' + String(newMinutes % 60).padStart(2, '0');

      if (ev.end) {
        const oldDur = parseInt(ev.end.split(':')[0], 10) * 60 + parseInt(ev.end.split(':')[1], 10) - oldMinutes;
        const endMin = Math.min(23 * 60 + 59, newMinutes + Math.max(1, oldDur));
        ev.end = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');
      }

      saveState();
      renderSchedule();
      showToast('已移动到 ' + ev.start, 'success');
    }

    document.querySelectorAll('.timeline-slot.drop-ready').forEach(s => s.classList.remove('drop-ready'));
  }

  /* ==========================================
     悬浮专注钟小组件
     ========================================== */
  let floatState = {
    mini: false,
    hidden: false,
    size: 'm', // s | m | l
    posX: null,
    posY: null
  };

  function initFloatingWidget() {
    const widget = $('#floating-timer');
    const ball = $('#floating-ball');
    const panel = $('#floating-panel');
    const header = $('#floating-header');

    if (!widget) return;

    // 最小化按钮
    $('#float-minimize').addEventListener('click', () => {
      floatState.mini = true;
      widget.classList.add('mini');
    });

    // 关闭按钮（隐藏）
    $('#float-close').addEventListener('click', () => {
      floatState.hidden = true;
      widget.style.display = 'none';
      updateFloatToggleBtn();
      showToast('专注钟已隐藏', 'info');
    });

    // 悬浮钟开关按钮
    const toggleBtn = $('#btn-float-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (floatState.hidden) {
          floatState.hidden = false;
          widget.style.display = '';
          showToast('悬浮专注钟已开启', 'success');
        } else {
          floatState.hidden = true;
          widget.style.display = 'none';
          showToast('悬浮专注钟已隐藏', 'info');
        }
        updateFloatToggleBtn();
      });
    }

    // 计时控制
    $('#float-toggle').addEventListener('click', toggleTimer);
    $('#float-reset').addEventListener('click', resetTimer);
    $('#float-skip').addEventListener('click', skipPhase);

    // 尺寸控制
    $('#float-size-s').addEventListener('click', () => setFloatSize('s'));
    $('#float-size-m').addEventListener('click', () => setFloatSize('m'));
    $('#float-size-l').addEventListener('click', () => setFloatSize('l'));

    // 拖拽移动（区分点击和拖拽，避免拖完误触发展开）
    let isDragging = false, dragOffset = { x: 0, y: 0 };
    let dragStartX = 0, dragStartY = 0, hasDragged = false;

    function startDrag(e) {
      isDragging = true;
      hasDragged = false;
      const pos = e.touches ? e.touches[0] : e;
      dragStartX = pos.clientX;
      dragStartY = pos.clientY;
      const rect = widget.getBoundingClientRect();
      dragOffset.x = pos.clientX - rect.left;
      dragOffset.y = pos.clientY - rect.top;
      e.preventDefault();
    }

    function moveDrag(e) {
      if (!isDragging) return;
      e.preventDefault();
      const pos = e.touches ? e.touches[0] : e;

      // 判断是否真的在拖动（超过 5px）
      const dx = Math.abs(pos.clientX - dragStartX);
      const dy = Math.abs(pos.clientY - dragStartY);
      if (dx > 5 || dy > 5) hasDragged = true;

      let x = pos.clientX - dragOffset.x;
      let y = pos.clientY - dragOffset.y;

      // 边界限制
      const w = widget.offsetWidth;
      const h = widget.offsetHeight;
      x = Math.max(0, Math.min(window.innerWidth - w, x));
      y = Math.max(0, Math.min(window.innerHeight - h, y));

      widget.style.left = x + 'px';
      widget.style.top = y + 'px';
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
    }

    function endDrag(e) {
      if (isDragging && !hasDragged) {
        // 视为点击：小球点击展开
        if (widget.classList.contains('mini')) {
          floatState.mini = false;
          widget.classList.remove('mini');
        }
      }
      isDragging = false;
    }

    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });
    ball.addEventListener('mousedown', startDrag);
    ball.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('touchmove', moveDrag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
  }

  function updateFloatToggleBtn() {
    const btn = $('#btn-float-toggle');
    if (btn) btn.classList.toggle('active', !floatState.hidden);
  }

  function setFloatSize(size) {
    floatState.size = size;
    const panel = $('#floating-panel');
    panel.classList.remove('size-s', 'size-l');
    if (size === 's') panel.classList.add('size-s');
    if (size === 'l') panel.classList.add('size-l');

    // 更新按钮状态
    ['#float-size-s', '#float-size-m', '#float-size-l'].forEach(id => {
      const btn = $(id);
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
    });
    const activeBtn = $(`#float-size-${size}`);
    activeBtn.style.background = 'var(--primary-pale)';
    activeBtn.style.color = 'var(--primary)';
    activeBtn.style.borderColor = 'var(--primary)';
  }

  function showFloatingWidget() {
    floatState.hidden = false;
    const widget = $('#floating-timer');
    if (widget) widget.style.display = '';
    updateFloatToggleBtn();
  }

  function updateFloatingDisplay() {
    const display = $('#float-display');
    const phase = $('#float-phase');
    const ballTime = $('#ball-time');
    const ballLabel = $('#ball-label');
    const ballRing = $('#ball-ring-fill');
    const icon = $('#float-icon');

    if (!display) return;

    const t = app.timer;
    display.textContent = formatSecs(t.remaining);
    ballTime.textContent = formatSecs(t.remaining);

    const labels = { work: '专注中', shortBreak: '短休息', longBreak: '长休息', custom: '自定义专注', stopwatch: '秒表运行中' };
    const phaseText = t.running ? (labels[t.phase] || '进行中') : (t.remaining < t.total ? '已暂停' : '准备开始');
    phase.textContent = phaseText;
    ballLabel.textContent = labels[t.phase]?.slice(0, 2) || '专注';

    // 小球进度环
    if (t.total > 0 && t.mode !== 'stopwatch') {
      const progress = t.remaining / t.total;
      const circ = 2 * Math.PI * 32;
      ballRing.style.strokeDasharray = circ;
      ballRing.style.strokeDashoffset = circ * (1 - progress);
    }

    // 播放/暂停图标
    if (icon) {
      icon.innerHTML = t.running
        ? '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'
        : '<polygon points="6 3 20 12 6 21 6 3"/>';
    }
  }

  /* ==========================================
     启动
     ========================================== */
  function init() {
    if (!app.data.settings) app.data.settings = defaultData().settings;
    if (!app.data.todos) app.data.todos = [];
    if (!app.data.events) app.data.events = [];
    if (!app.data.sessions) app.data.sessions = [];

    bindEvents();
    initTimer();
    renderToday();
    renderFocus();
    updateNotifBtn();
    startReminderCheck();

    // v3 新系统
    applyTheme(getTheme());
    initDragSystem();
    initFloatingWidget();
    bindSettingsEvents();

    setInterval(() => {
      $('#header-date').textContent = formatDateCN(todayStr(), true);
      if (app.ui.currentView === 'today') renderNextReminder();
    }, 60000);

    // 通知引导
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const banner = document.createElement('div');
      banner.className = 'notif-banner';
      banner.innerHTML = '<span>🔔 开启通知提醒，不再错过重要日程</span><button id="banner-enable-notif">立即开启</button>';
      const todayView = $('#view-today');
      todayView.insertBefore(banner, todayView.firstChild);
      $('#banner-enable-notif').addEventListener('click', () => {
        requestNotifPermission();
        banner.remove();
      });
    }

    console.log('此刻 FocusNow v2 · 粉黑主题 · 已启动 ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
