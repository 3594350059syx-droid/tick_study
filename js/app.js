/**
 * TickMemory v2 — 应用入口
 * 数据流：浏览器工作副本 (localStorage) ⇄ 本地后端 SQLite (/api/state)
 */
const App = (() => {
  const KEY = 'tickmemory_v2';
  const ICONS = { pending: '⬜', warning: '⚠️', done: '✅', failed: '❌' };
  const CYCLE = { pending: 'warning', warning: 'done', done: 'pending', failed: 'pending' };
  const STATUS_TEXT = { pending: '未开始', warning: '有误但理解', done: '已掌握', failed: '完全不会' };

  const today = () => new Date().toISOString().slice(0, 10);
  const $ = id => document.getElementById(id);

  let data = { version: 3, tasks: [] };
  let day = today();
  let open = false;
  let dirty = false;
  let lastSavedAt = null;

  const fmtDate = d =>
    new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(d + 'T12:00:00'));

  function esc(s) {
    const e = document.createElement('i');
    e.textContent = s ?? '';
    return e.innerHTML;
  }

  // 用于 HTML 属性中的转义（esc 只保证文本节点安全）
  const escAttr = s => esc(s).replace(/"/g, '&quot;');

  // —— 可浏览日期索引（任务记录日 ∪ 今天） ——
  const isDayKey = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const recordedDays = () => [...new Set(data.tasks.map(t => t.dayKey).filter(isDayKey))].sort();
  const navigableDays = () => [...new Set([...recordedDays(), today()])].sort();
  const prevNavigableDay = () => [...navigableDays()].reverse().find(d => d < day) || null;
  const nextNavigableDay = () => navigableDays().find(d => d > day) || null;

  async function seed() {
    const x = await fetch('data/seed.json').then(r => r.json());
    const now = Date.now();
    return {
      version: 3,
      tasks: x.tasks.map((t, i) => ({ ...t, dayKey: today(), order: i + 1, createdAt: now, updatedAt: now })),
    };
  }

  async function init() {
    try {
      const res = await fetch('/api/state');
      const x = await res.json();
      data = x.state || JSON.parse(localStorage.getItem(KEY) || 'null') || await seed();
      setSync('已从本地库加载');
    } catch (e) {
      data = JSON.parse(localStorage.getItem(KEY) || 'null') || await seed();
      setSync('离线工作副本');
    }
    data.tasks.forEach(t => { t.dayKey ||= today(); });
    saveLocal();
    bind();
    initSidebar();
    bindSidebarEvents();
    render();
  }

  function setSync(text, mode) {
    const el = $('sync-state');
    el.textContent = mode === 'dirty' ? '● ' + text : (mode === 'ok' ? '✓ ' + text : text);
  }

  function saveLocal() { localStorage.setItem(KEY, JSON.stringify(data)); }

  function dayTasks() { return data.tasks.filter(t => t.dayKey === day).sort((a, b) => a.order - b.order); }

  function stats() {
    const list = dayTasks();
    const done = list.filter(t => t.status === 'done').length;
    return { total: list.length, done, pct: list.length ? Math.round(done / list.length * 100) : 0 };
  }

  function render() {
    const d = new Date(day + 'T12:00:00');
    const s = stats();
    const wd = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });
    const mo = new Intl.DateTimeFormat('zh-CN', { month: 'long' });

    $('weekday').textContent = wd.format(d);
    $('month').textContent = mo.format(d);
    $('date').textContent = d.getDate();
    $('selected-day').textContent = fmtDate(day) + (day !== today() ? ' · 历史记录' : '');
    $('prev-day').disabled = !prevNavigableDay();
    $('next-day').disabled = !nextNavigableDay();
    $('day-title').textContent = open
      ? `收起 ${fmtDate(day)} 的安排`
      : (day === today() ? '展开今天的所有安排' : `展开 ${fmtDate(day)} 的安排`);

    // 进度条
    const fill = $('progress-fill');
    fill.style.width = s.pct + '%';
    $('progress-percent').textContent = s.pct + '%';
    $('progress-text').textContent = `${s.done} / ${s.total} 已掌握`;
    $('progress-blockbar').textContent = '▓'.repeat(Math.round(s.pct / 10)) + '░'.repeat(10 - Math.round(s.pct / 10));
    $('progress-container').classList.toggle('complete', s.pct === 100);
    fill.classList.remove('pulse');
    void fill.offsetWidth;
    fill.classList.add('pulse');

    $('task-summary').textContent = `${s.total} 项 · ${s.done} 项已掌握`;
    $('task-list').innerHTML = dayTasks().map(card).join('')
      || '<p class="task-empty">这一天还没有安排，添加一个任务开始吧。</p>';
    
    // 更新侧边栏
    renderSidebar();
  }

  function card(t) {
    return `<article class="task ${t.status}" data-id="${t.id}">
      <i>${ICONS[t.status] || '⬜'}</i>
      <div><b>${esc(t.label)}</b><small>${esc(t.description)}</small></div>
      <div class="task__actions">
        <button class="task__note${t.note?.content ? ' has-note' : ''}" data-note="${t.id}" title="打开笔记" aria-label="打开笔记：${escAttr(t.label)}">✎</button>
        <button class="task__delete" data-del="${t.id}" title="删除任务" aria-label="删除任务：${escAttr(t.label)}">🗑</button>
      </div>
    </article>`;
  }


  function mutate() {
    dirty = true;
    saveLocal();
    render();
    setSync('有未保存修改', 'dirty');
  }

  async function persistState() {
    const res = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const x = await res.json();
    lastSavedAt = new Date(x.updatedAt);
    dirty = false;
    setSync('已保存 ' + lastSavedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), 'ok');
  }

  async function sync() {
    const btn = $('btn-save');
    btn.disabled = true;
    btn.textContent = '正在保存…';
    try {
      await persistState();
      toast('已同步到 SQLite 本地库');
    } catch (e) {
      setSync('保存失败，数据仍在浏览器本地');
      toast('本地后端不可用', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '💾 保存到本地库 <kbd>Ctrl S</kbd>';
    }
  }

  function goToday() { day = today(); render(); }
  function goDelta(n) {
    const target = n < 0 ? prevNavigableDay() : nextNavigableDay();
    if (!target) { toast(n < 0 ? '没有更早的可浏览日期' : '没有更晚的可浏览日期', 'error'); return; }
    const jumped = target !== day;
    day = target;
    render();
    if (jumped) {
      if (day === today()) toast('已回到今天');
      else toast(`已跳转至 ${fmtDate(day)}`);
    }
  }

  function copyToTomorrow() {
    const src = dayTasks();
    if (!src.length) return toast('这一天没有可复制的任务', 'error');
    const tmr = new Date(new Date(day + 'T12:00:00') + 864e5).toISOString().slice(0, 10);
    const existing = data.tasks.filter(t => t.dayKey === tmr).map(t => t.label);
    const now = Date.now();
    let count = 0;
    src.forEach(t => {
      if (existing.includes(t.label)) return;
      data.tasks.push({
        id: 'task-' + now + '-' + count,
        dayKey: tmr,
        label: t.label,
        description: t.description,
        status: t.status,
        order: count + 1,
        createdAt: now,
        updatedAt: now,
      });
      count++;
    });
    if (count) { mutate(); toast(`已复制 ${count} 项到明天`); }
    else toast('明天的安排已包含这些任务', 'error');
  }


  function bind() {
    $('btn-toggle-day').addEventListener('click', () => {
      open = !open;
      $('daily-panel').hidden = !open;
      $('btn-toggle-day').setAttribute('aria-expanded', String(open));
      render();
      if (open) $('daily-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('btn-save').addEventListener('click', sync);

    $('btn-export').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'tickmemory-backup.json';
      a.click();
    });
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = x => {
        try {
          data = JSON.parse(x.target.result);
          data.tasks.forEach(t => { t.dayKey ||= today(); });
          mutate();
          toast('导入成功');
        } catch (err) { toast('无效备份文件', 'error'); }
      };
      r.readAsText(f);
    });

    $('prev-day').addEventListener('click', () => goDelta(-1));
    $('next-day').addEventListener('click', () => goDelta(1));
    $('btn-today').addEventListener('click', goToday);
    $('btn-copy-tomorrow').addEventListener('click', copyToTomorrow);

    $('btn-add').addEventListener('click', () => { $('task-form').hidden = false; $('label').focus(); });
    $('cancel').addEventListener('click', () => { $('task-form').hidden = true; });
    $('task-form').addEventListener('submit', e => {
      e.preventDefault();
      const label = $('label').value.trim();
      if (!label) return;
      data.tasks.push({
        id: 'task-' + Date.now(),
        label,
        description: $('desc').value.trim(),
        status: 'pending',
        dayKey: day,
        order: dayTasks().length + 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      e.target.reset();
      e.target.hidden = true;
      mutate();
    });

    $('task-list').addEventListener('click', e => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      if (e.target.dataset.del) {
        data.tasks = data.tasks.filter(t => t.id !== e.target.dataset.del);
        mutate();
      } else if (e.target.dataset.note) {
        openNote(e.target.dataset.note);
      } else {
        const t = data.tasks.find(x => x.id === id);
        if (t) { t.status = CYCLE[t.status] || 'pending'; t.updatedAt = Date.now(); mutate(); }
      }
    });

    $('task-list').addEventListener('contextmenu', e => {
      const t = data.tasks.find(x => x.id === e.target.closest('[data-id]')?.dataset.id);
      if (!t) return;
      e.preventDefault();
      t.status = 'failed';
      t.updatedAt = Date.now();
      mutate();
    });

    // —— 笔记 Drawer ——
    $('note-close').addEventListener('click', () => closeNote());
    $('note-backdrop').addEventListener('click', () => closeNote());
    $('note-content').addEventListener('input', () => {
      noteUi.dirty = $('note-content').value !== noteUi.originalContent;
      updateNoteStatus();
    });
    $('note-save').addEventListener('click', saveNote);
    $('note-delete').addEventListener('click', deleteNote);

    document.addEventListener('keydown', e => {
      const noteOpen = !$('note-drawer').hidden;
      if (e.key === 'Escape' && noteOpen) { e.preventDefault(); closeNote(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (noteOpen) saveNote(); else sync();
        return;
      }
      if (noteOpen) return;
      if (e.target.matches('input, textarea')) return;
      if (e.key.toLowerCase() === 't') $('btn-toggle-day').click();
      else if (e.key.toLowerCase() === 'n') { $('btn-toggle-day').click(); setTimeout(() => $('btn-add').click(), 60); }
    });

    window.addEventListener('beforeunload', e => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  let timer;
  function toast(msg, type) {
    const el = $('toast');
    el.textContent = msg;
    el.className = type === 'error' ? 'show error' : 'show';
    clearTimeout(timer);
    timer = setTimeout(() => { el.className = ''; }, 2200);
  }

  // —— 笔记 Drawer ——
  let noteUi = { taskId: null, originalContent: '', dirty: false, isSaving: false };
  const findTask = id => data.tasks.find(t => t.id === id) || null;

  function updateNoteStatus() {
    const el = $('note-status');
    if (noteUi.isSaving) el.textContent = '正在同步 SQLite…';
    else if (noteUi.dirty) el.textContent = '● 未保存修改';
    else if (findTask(noteUi.taskId)?.note) el.textContent = '✓ 已保存到本地库';
    else el.textContent = '就绪 · 保存后将同步 SQLite';
  }

  function openNote(taskId) {
    const t = findTask(taskId);
    if (!t) return;
    noteUi = { taskId, originalContent: t.note?.content ?? '', dirty: false, isSaving: false };
    $('note-task-label').textContent = t.label;
    $('note-task-id').textContent = 'TASK-ID: ' + t.id;
    $('note-task-meta').textContent = `${fmtDate(t.dayKey)} · ${STATUS_TEXT[t.status] || '未开始'}`;
    $('note-content').value = noteUi.originalContent;
    updateNoteStatus();
    $('note-drawer').hidden = false;
    $('note-backdrop').hidden = false;
    document.body.classList.add('note-open');
    setTimeout(() => $('note-content').focus(), 60);
  }

  function closeNote(force = false) {
    if (!force && noteUi.dirty && !confirm('放弃未保存的笔记修改？')) return;
    $('note-drawer').hidden = true;
    $('note-backdrop').hidden = true;
    document.body.classList.remove('note-open');
    noteUi = { taskId: null, originalContent: '', dirty: false, isSaving: false };
    render();
  }

  async function saveNote() {
    if (noteUi.isSaving || !noteUi.taskId) return;
    const t = findTask(noteUi.taskId);
    if (!t) return;
    const content = $('note-content').value;
    noteUi.isSaving = true;
    updateNoteStatus();
    if (content.trim()) t.note = { content, updatedAt: Date.now() };
    else delete t.note;
    t.updatedAt = Date.now();
    saveLocal();
    mutate();
    try {
      await persistState();
      noteUi.originalContent = content;
      noteUi.dirty = false;
      toast('笔记已同步到 SQLite 本地库');
    } catch (e) {
      setSync('保存失败，数据仍在浏览器本地');
      toast('本地后端不可用', 'error');
    } finally {
      noteUi.isSaving = false;
      updateNoteStatus();
    }
  }

  async function deleteNote() {
    if (!noteUi.taskId) return;
    const t = findTask(noteUi.taskId);
    if (!t) return;
    if (!t.note) { toast('当前没有可删除的笔记', 'error'); return; }
    if (!confirm('确定删除这篇笔记？此操作不可恢复。')) return;
    delete t.note;
    t.updatedAt = Date.now();
    saveLocal();
    mutate();
    closeNote(true);
    try {
      await persistState();
      toast('笔记已从本地库删除');
    } catch (e) {
      setSync('保存失败，数据仍在浏览器本地');
      toast('本地后端不可用', 'error');
    }
  }

  // —— 待处理任务侧边栏 ——
  let sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
  let contextMenuTaskId = null;

  function getWarningTasks() {
    return data.tasks
      .filter(t => t.status === 'warning')
      .sort((a, b) => {
        // 按日期排序，最新的在前
        if (a.dayKey !== b.dayKey) return b.dayKey.localeCompare(a.dayKey);
        return b.updatedAt - a.updatedAt;
      });
  }

  function renderSidebar() {
    const tasks = getWarningTasks();
    const listEl = $('sidebar-list');
    const countEl = $('sidebar-count');
    
    // 更新统计
    countEl.textContent = tasks.length === 0 ? '暂无任务' : `${tasks.length} 个任务`;
    
    // 渲染列表
    if (tasks.length === 0) {
      listEl.innerHTML = '<div class="sidebar-empty">太棒了！<br>暂无待处理任务</div>';
    } else {
      listEl.innerHTML = tasks.map(t => `
        <div class="sidebar-task" data-task-id="${t.id}">
          <span class="sidebar-task-label">${esc(t.label)}</span>
          <span class="sidebar-task-date">${fmtDate(t.dayKey)}</span>
        </div>
      `).join('');
    }
  }

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    const sidebar = $('warning-sidebar');
    if (sidebarCollapsed) {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    } else {
      sidebar.classList.remove('collapsed');
      document.body.classList.remove('sidebar-collapsed');
    }
    localStorage.setItem('sidebar_collapsed', sidebarCollapsed);
  }

  function initSidebar() {
    const sidebar = $('warning-sidebar');
    if (sidebarCollapsed) {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }
    renderSidebar();
  }

  function jumpToDay(targetDay) {
    if (!targetDay) return;
    
    const alreadyThere = (day === targetDay);
    day = targetDay;
    
    // 确保每日面板展开
    if (!open) {
      open = true;
      $('daily-panel').hidden = false;
      $('btn-toggle-day').setAttribute('aria-expanded', 'true');
    }
    
    // 刷新界面
    render();
    
    // 显示提示
    if (alreadyThere) {
      toast('已定位到该任务所在日期');
    } else {
      toast(`已跳转至 ${fmtDate(targetDay)}`);
    }
    
    // 平滑滚动到每日面板
    setTimeout(() => {
      $('daily-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  function showContextMenu(e, taskId) {
    e.preventDefault();
    const menu = $('context-menu');
    contextMenuTaskId = taskId;
    
    // 定位菜单
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.hidden = false;
    
    // 防止菜单超出屏幕
    setTimeout(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
      }
    }, 0);
  }

  function hideContextMenu() {
    $('context-menu').hidden = true;
    contextMenuTaskId = null;
  }

  async function markTaskAsDone() {
    if (!contextMenuTaskId) return;
    
    const task = findTask(contextMenuTaskId);
    if (!task) {
      hideContextMenu();
      return;
    }
    
    // 二次确认
    if (!confirm(`确定将"${task.label}"标记为已掌握吗？`)) {
      hideContextMenu();
      return;
    }
    
    // 更新状态
    task.status = 'done';
    task.updatedAt = Date.now();
    saveLocal();
    mutate();
    
    // 隐藏菜单
    hideContextMenu();
    
    // 刷新界面
    renderSidebar();
    render();
    
    // 保存到数据库
    try {
      await persistState();
      toast('✅ 任务已标记为已掌握');
    } catch (e) {
      setSync('保存失败，数据仍在浏览器本地');
      toast('本地后端不可用', 'error');
    }
  }

  function bindSidebarEvents() {
    // 切换侧边栏
    $('sidebar-toggle').addEventListener('click', toggleSidebar);
    
    // 任务列表左键点击 - 跳转到任务所在日期
    $('sidebar-list').addEventListener('click', e => {
      const taskEl = e.target.closest('.sidebar-task');
      if (taskEl) {
        const taskId = taskEl.dataset.taskId; // 直接使用字符串，不要 parseInt
        const task = findTask(taskId);
        if (task && task.dayKey) {
          jumpToDay(task.dayKey);
        }
      }
    });
    
    // 任务列表右键菜单
    $('sidebar-list').addEventListener('contextmenu', e => {
      const taskEl = e.target.closest('.sidebar-task');
      if (taskEl) {
        const taskId = taskEl.dataset.taskId; // 直接使用字符串，不要 parseInt
        showContextMenu(e, taskId);
      }
    });
    
    // 右键菜单项点击
    $('ctx-mark-done').addEventListener('click', markTaskAsDone);
    
    // 点击空白处关闭右键菜单
    document.addEventListener('click', e => {
      if (!e.target.closest('#context-menu')) {
        hideContextMenu();
      }
    });
    
    // ESC 键关闭右键菜单
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('context-menu').hidden) {
        hideContextMenu();
      }
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);

