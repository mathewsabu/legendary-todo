import { 
  getTodos, 
  getTodoById, 
  saveTodo, 
  createTodo, 
  deleteTodo, 
  getUserSession, 
  setUserSession, 
  clearUserSession, 
  getLastSetupCompletedDate, 
  setLastSetupCompletedDate 
} from './storage.js';
import { createLogEntry, formatLogTime } from './logger.js';
import { syncTodos, testServerConnection, loginUser, registerUser } from './sync.js';

// Local State
let currentFocusDate = getLocalDateString(new Date());
let historySelectedDate = getLocalDateString(new Date());
let calendarCurrentMonth = new Date(); // Month currently viewed in the history calendar
let activeTodoIdInDrawer = null;
let setupTasksToAssign = new Set(); // Store IDs of tasks selected in setup modal
let setupQuickAddedTasks = []; // Temporary store for tasks created in setup modal

/* Date Helpers */

export function getLocalDateString(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getYesterdayDateString(dateStr) {
  const d = new Date(dateStr + 'T12:00:00'); // Midday to avoid timezone shifting
  d.setDate(d.getDate() - 1);
  return getLocalDateString(d);
}

function formatDateReadable(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatMonthYear(dateObj) {
  return dateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function setupSidebarCollapse() {
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.getElementById('sidebar-panel');
  
  const isCollapsed = localStorage.getItem('ff_sidebar_collapsed') === 'true';
  if (isCollapsed) {
    sidebar.classList.add('collapsed');
  }

  toggleBtn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('ff_sidebar_collapsed', collapsed);
  });
}

function setupTheme() {
  const themeBtn = document.getElementById('theme-toggle-btn');
  const moonIcon = document.getElementById('theme-icon-moon');
  const sunIcon = document.getElementById('theme-icon-sun');
  
  const currentTheme = localStorage.getItem('ff_theme') || 'dark';
  if (currentTheme === 'light') {
    document.body.classList.add('light-theme');
    moonIcon.style.display = 'none';
    sunIcon.style.display = 'block';
  }

  // Trigger main process overlay color update on load
  if (window.electronAPI && typeof window.electronAPI.changeTheme === 'function') {
    window.electronAPI.changeTheme(currentTheme);
  }

  themeBtn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-theme');
    const newTheme = isLight ? 'light' : 'dark';
    localStorage.setItem('ff_theme', newTheme);
    
    if (isLight) {
      moonIcon.style.display = 'none';
      sunIcon.style.display = 'block';
    } else {
      moonIcon.style.display = 'block';
      sunIcon.style.display = 'none';
    }

    // Trigger main process overlay color update on toggle click
    if (window.electronAPI && typeof window.electronAPI.changeTheme === 'function') {
      window.electronAPI.changeTheme(newTheme);
    }
  });
}

/* UI Bootstrapping */

export function initUI() {
  setupSidebarCollapse();
  setupTheme();
  setupNavigation();
  setupFocusView();
  setupPoolView();
  setupHistoryView();
  setupInspectorDrawer();
  setupAuthModal();
  setupDailyPrompt();

  // Initial renders
  renderDailyFocus();
  renderMainPool();
  renderHistoryView();
  updateSyncStatusUI();

  // Check sync connection periodically
  setInterval(updateSyncStatusUI, 30000);
}

/* 1. Navigation */

function setupNavigation() {
  const navs = [
    { btnId: 'nav-daily', viewId: 'daily-view', callback: renderDailyFocus },
    { btnId: 'nav-pool', viewId: 'pool-view', callback: renderMainPool },
    { btnId: 'nav-history', viewId: 'history-view', callback: renderHistoryView }
  ];

  navs.forEach(nav => {
    const btn = document.getElementById(nav.btnId);
    btn.addEventListener('click', () => {
      // Set active nav styling
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');

      // Swap views
      document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
      document.getElementById(nav.viewId).classList.add('active');

      // Trigger view rendering callback
      nav.callback();
      closeDrawer();
      document.getElementById('quick-pull-panel').classList.remove('open');
    });
  });
}

/* 2. Daily View */

function setupFocusView() {
  // Date navigation
  document.getElementById('prev-day-btn').addEventListener('click', () => {
    const d = new Date(currentFocusDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    currentFocusDate = getLocalDateString(d);
    renderDailyFocus();
  });

  document.getElementById('next-day-btn').addEventListener('click', () => {
    const d = new Date(currentFocusDate + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    currentFocusDate = getLocalDateString(d);
    renderDailyFocus();
  });

  document.getElementById('today-btn').addEventListener('click', () => {
    currentFocusDate = getLocalDateString(new Date());
    renderDailyFocus();
  });

  // Canvas click focuses input
  const canvas = document.getElementById('daily-editor-canvas');
  const editorInput = document.getElementById('daily-editor-input');

  canvas.addEventListener('click', (e) => {
    // Focus the editor input if they click anywhere on the canvas that isn't interactive
    const isInteractive = e.target.closest('button') || e.target.closest('input') || e.target.closest('label') || e.target.closest('.editor-text-btn');
    if (!isInteractive) {
      editorInput.focus();
    }
  });

  // Floating Backlog Pool toggles
  const togglePullBtn = document.getElementById('toggle-pull-panel-btn');
  const closePullBtn = document.getElementById('close-pull-panel-btn');
  const pullPanel = document.getElementById('quick-pull-panel');

  togglePullBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pullPanel.classList.toggle('open');
  });

  closePullBtn.addEventListener('click', () => {
    pullPanel.classList.remove('open');
  });

  // Close backlog pool panel when clicking outside of it
  document.addEventListener('click', (e) => {
    if (pullPanel.classList.contains('open')) {
      if (!pullPanel.contains(e.target)) {
        pullPanel.classList.remove('open');
      }
    }
  });

  // Keydown listener on the editor line prompt
  editorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = editorInput.value.trim();
      if (!text) return;

      const todo = createTodo(text);
      todo.assignedDates.push(currentFocusDate);
      todo.logs.push(createLogEntry('assigned', `Assigned directly to Focus Day ${currentFocusDate}`));
      saveTodo(todo, true);

      editorInput.value = '';
      renderDailyFocus();
      triggerSyncQuietly();
    }
  });
}

export function renderDailyFocus() {
  // Title Date
  document.getElementById('daily-date-title').innerText = formatDateReadable(currentFocusDate);

  const allTodos = getTodos();
  
  // Filter for active Focus Date
  const dailyTodos = allTodos.filter(todo => todo.assignedDates.includes(currentFocusDate));
  
  // Calculate completion percentage
  const total = dailyTodos.length;
  const completed = dailyTodos.filter(t => t.completed).length;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

  document.getElementById('daily-progress-text').innerText = `${percentage}% (${completed}/${total})`;
  document.getElementById('daily-progress-bar').style.width = `${percentage}%`;

  // Render list
  const container = document.getElementById('daily-todo-list');
  container.innerHTML = '';

  if (dailyTodos.length === 0) {
    container.innerHTML = `
      <div style="padding: 10px 8px; color: var(--text-muted); font-style: italic; font-size: 14px;">
        No tasks for today. Start typing below...
      </div>
    `;
  } else {
    // Sort active first, then completed
    dailyTodos.sort((a, b) => Number(a.completed) - Number(b.completed));
    
    dailyTodos.forEach(todo => {
      const el = createEditorLineElement(todo, renderDailyFocus);
      container.appendChild(el);
    });
  }

  // Render Quick Pull Side Board
  renderQuickPullPanel(allTodos);
}

function renderQuickPullPanel(allTodos) {
  const container = document.getElementById('quick-pull-list');
  container.innerHTML = '';

  // Get active (not completed) pool items that are NOT assigned to this day
  const poolItems = allTodos.filter(todo => 
    !todo.completed && 
    !todo.assignedDates.includes(currentFocusDate)
  );

  if (poolItems.length === 0) {
    container.innerHTML = `<div class="setup-empty-text">Backlog is empty.</div>`;
  } else {
    poolItems.forEach(todo => {
      const el = document.createElement('div');
      el.className = 'pull-item';
      
      const textSpan = document.createElement('span');
      textSpan.innerText = todo.text;
      textSpan.style.textOverflow = 'ellipsis';
      textSpan.style.overflow = 'hidden';
      textSpan.style.whiteSpace = 'nowrap';
      textSpan.style.maxWidth = '200px';

      const addBtn = document.createElement('button');
      addBtn.className = 'pull-add-btn';
      addBtn.innerHTML = '+';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        todo.assignedDates.push(currentFocusDate);
        todo.logs.push(createLogEntry('assigned', `Pulled from All into Focus Day ${currentFocusDate}`));
        saveTodo(todo, true);
        renderDailyFocus();
        triggerSyncQuietly();
      });

      el.appendChild(textSpan);
      el.appendChild(addBtn);
      
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openInspectorDrawer(todo.id, renderDailyFocus);
      });
      container.appendChild(el);
    });
  }
}

/* 3. Main Pool View */

function setupPoolView() {
  const searchInput = document.getElementById('pool-search-input');
  const statusSelect = document.getElementById('pool-status-select');
  const createdStart = document.getElementById('pool-created-start');
  const createdEnd = document.getElementById('pool-created-end');
  const completedStart = document.getElementById('pool-completed-start');
  const completedEnd = document.getElementById('pool-completed-end');

  // Add event listeners to filters
  [searchInput, statusSelect, createdStart, createdEnd, completedStart, completedEnd].forEach(el => {
    el.addEventListener('input', renderMainPool);
  });

  // Pool Add task form
  document.getElementById('pool-add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('pool-add-input');
    const text = input.value.trim();
    if (!text) return;

    createTodo(text);
    input.value = '';
    renderMainPool();
    triggerSyncQuietly();
  });
}

function renderMainPool() {
  const search = document.getElementById('pool-search-input').value.toLowerCase().trim();
  const status = document.getElementById('pool-status-select').value;
  const cStart = document.getElementById('pool-created-start').value;
  const cEnd = document.getElementById('pool-created-end').value;
  const compStart = document.getElementById('pool-completed-start').value;
  const compEnd = document.getElementById('pool-completed-end').value;

  let list = getTodos();

  // 1. Text Search Filter
  if (search) {
    list = list.filter(t => t.text.toLowerCase().includes(search));
  }

  // 2. Status Filter
  if (status === 'active') {
    list = list.filter(t => !t.completed);
  } else if (status === 'completed') {
    list = list.filter(t => t.completed);
  }

  // 3. Created Date Filters
  if (cStart) {
    const startDate = new Date(cStart + 'T00:00:00').getTime();
    list = list.filter(t => new Date(t.createdAt).getTime() >= startDate);
  }
  if (cEnd) {
    const endDate = new Date(cEnd + 'T23:59:59').getTime();
    list = list.filter(t => new Date(t.createdAt).getTime() <= endDate);
  }

  // 4. Completed Date Filters
  if (compStart) {
    const startDate = new Date(compStart + 'T00:00:00').getTime();
    list = list.filter(t => t.completedAt && new Date(t.completedAt).getTime() >= startDate);
  }
  if (compEnd) {
    const endDate = new Date(compEnd + 'T23:59:59').getTime();
    list = list.filter(t => t.completedAt && new Date(t.completedAt).getTime() <= endDate);
  }

  // Render list
  const container = document.getElementById('pool-todo-list');
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        No tasks match the selected filters.
      </div>
    `;
  } else {
    // Sort: newest first
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    list.forEach(todo => {
      const card = createTodoCardElement(todo, renderMainPool);
      container.appendChild(card);
    });
  }
}

/* 4. History View (Calendar & Logs) */

function setupHistoryView() {
  document.getElementById('cal-prev-month').addEventListener('click', () => {
    calendarCurrentMonth.setMonth(calendarCurrentMonth.getMonth() - 1);
    renderHistoryCalendar();
  });

  document.getElementById('cal-next-month').addEventListener('click', () => {
    calendarCurrentMonth.setMonth(calendarCurrentMonth.getMonth() + 1);
    renderHistoryCalendar();
  });
}

function renderHistoryView() {
  renderHistoryCalendar();
  renderHistoryTasks();
}

function renderHistoryCalendar() {
  const monthTitle = document.getElementById('calendar-month-year');
  monthTitle.innerText = formatMonthYear(calendarCurrentMonth);

  const container = document.getElementById('calendar-dates');
  container.innerHTML = '';

  const year = calendarCurrentMonth.getFullYear();
  const month = calendarCurrentMonth.getMonth();

  // First day of month (0-6)
  const firstDayIndex = new Date(year, month, 1).getDay();
  // Total days in month
  const totalDays = new Date(year, month + 1, 0).getDate();

  const todos = getTodos();

  // Fill in blanks for previous month
  for (let i = 0; i < firstDayIndex; i++) {
    const blank = document.createElement('span');
    blank.className = 'cal-date empty';
    container.appendChild(blank);
  }

  // Draw actual days
  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    const dayEl = document.createElement('span');
    dayEl.className = 'cal-date';
    dayEl.innerText = day;

    if (dateStr === historySelectedDate) {
      dayEl.classList.add('active');
    }

    // Add activity dot indicator if there are tasks for that day
    const dayTasks = todos.filter(t => t.assignedDates.includes(dateStr));
    if (dayTasks.length > 0) {
      const dot = document.createElement('span');
      dot.className = 'cal-dot-indicator';
      
      const allCompleted = dayTasks.every(t => t.completed);
      if (allCompleted) {
        dot.classList.add('completed');
      }
      dayEl.appendChild(dot);
    }

    dayEl.addEventListener('click', () => {
      historySelectedDate = dateStr;
      renderHistoryCalendar();
      renderHistoryTasks();
    });

    container.appendChild(dayEl);
  }
}

function renderHistoryTasks() {
  const title = document.getElementById('history-date-focus-title');
  const subtitle = document.getElementById('history-date-focus-subtitle');
  
  title.innerText = formatDateReadable(historySelectedDate);
  
  const dailyTodos = getTodos().filter(todo => todo.assignedDates.includes(historySelectedDate));
  
  const total = dailyTodos.length;
  const completed = dailyTodos.filter(t => t.completed).length;
  subtitle.innerText = `${total} task(s) assigned to this day (${completed} completed)`;

  const container = document.getElementById('history-todo-list');
  container.innerHTML = '';

  if (dailyTodos.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted); font-style: italic;">
        No tasks were assigned to this day in history.
      </div>
    `;
  } else {
    dailyTodos.sort((a, b) => Number(a.completed) - Number(b.completed));
    dailyTodos.forEach(todo => {
      const card = createTodoCardElement(todo, renderHistoryTasks);
      container.appendChild(card);
    });
  }
}

/* Todo Card Generator Component */

function createTodoCardElement(todo, refreshCallback) {
  const card = document.createElement('div');
  card.className = `todo-item-card ${todo.completed ? 'completed' : ''}`;
  
  // Left section (checkbox + text)
  const left = document.createElement('div');
  left.className = 'todo-item-left';

  // Custom checkbox
  const checkboxWrapper = document.createElement('label');
  checkboxWrapper.className = 'custom-checkbox-wrapper';
  
  const checkboxInput = document.createElement('input');
  checkboxInput.type = 'checkbox';
  checkboxInput.checked = todo.completed;
  
  const checkboxMark = document.createElement('span');
  checkboxMark.className = 'checkbox-mark';

  checkboxWrapper.appendChild(checkboxInput);
  checkboxWrapper.appendChild(checkboxMark);

  // Checkbox toggle handler
  checkboxInput.addEventListener('click', (e) => {
    e.stopPropagation(); // Avoid opening drawer
    
    todo.completed = checkboxInput.checked;
    todo.completedAt = todo.completed ? new Date().toISOString() : null;
    
    const statusMsg = todo.completed ? 'Completed todo' : 'Marked todo as incomplete';
    todo.logs.push(createLogEntry(todo.completed ? 'completed' : 'uncompleted', statusMsg));
    
    saveTodo(todo, true);
    refreshCallback();
    triggerSyncQuietly();
  });

  const textSpan = document.createElement('span');
  textSpan.className = 'todo-text';
  textSpan.innerText = todo.text;

  left.appendChild(checkboxWrapper);
  left.appendChild(textSpan);

  // Right section (meta tags/badges)
  const right = document.createElement('div');
  right.className = 'todo-meta-tags';

  if (todo.notes && todo.notes.trim()) {
    const noteBadge = document.createElement('span');
    noteBadge.className = 'meta-badge';
    noteBadge.innerText = '📝 Notes';
    right.appendChild(noteBadge);
  }

  if (todo.assignedDates.includes(getLocalDateString(new Date()))) {
    const todayBadge = document.createElement('span');
    todayBadge.className = 'meta-badge today';
    todayBadge.innerText = 'Today';
    right.appendChild(todayBadge);
  }

  // Add inline unassign button if in Daily view or History view
  const isDaily = refreshCallback === renderDailyFocus;
  const isHistory = refreshCallback === renderHistoryTasks;
  if (isDaily || isHistory) {
    const targetDate = isDaily ? currentFocusDate : historySelectedDate;
    const unassignBtn = document.createElement('button');
    unassignBtn.className = 'sync-btn';
    unassignBtn.innerHTML = '&times;';
    unassignBtn.title = 'Unassign from this day';
    unassignBtn.style.padding = '2px 6px';
    unassignBtn.style.border = 'none';
    unassignBtn.style.background = 'transparent';
    unassignBtn.style.color = 'var(--text-muted)';
    unassignBtn.style.cursor = 'pointer';
    unassignBtn.style.fontSize = '16px';
    unassignBtn.style.lineHeight = '1';
    unassignBtn.style.marginLeft = '4px';
    unassignBtn.style.transition = 'var(--transition-fast)';

    unassignBtn.addEventListener('mouseenter', () => unassignBtn.style.color = 'var(--color-danger)');
    unassignBtn.addEventListener('mouseleave', () => unassignBtn.style.color = 'var(--text-muted)');
    
    unassignBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Avoid opening drawer
      todo.assignedDates = todo.assignedDates.filter(d => d !== targetDate);
      todo.logs.push(createLogEntry('unassigned', `Unassigned from Focus Day ${targetDate}`));
      saveTodo(todo, true);
      refreshCallback();
      triggerSyncQuietly();
    });
    right.appendChild(unassignBtn);
  }

  card.appendChild(left);
  card.appendChild(right);

  // Click card to inspect
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    openInspectorDrawer(todo.id, refreshCallback);
  });

  return card;
}

function createEditorLineElement(todo, refreshCallback) {
  const line = document.createElement('div');
  line.className = `editor-line ${todo.completed ? 'completed' : ''}`;

  // Checkbox
  const checkboxWrapper = document.createElement('label');
  checkboxWrapper.className = 'custom-checkbox-wrapper';
  
  const checkboxInput = document.createElement('input');
  checkboxInput.type = 'checkbox';
  checkboxInput.checked = todo.completed;
  
  const checkboxMark = document.createElement('span');
  checkboxMark.className = 'checkbox-mark';

  checkboxWrapper.appendChild(checkboxInput);
  checkboxWrapper.appendChild(checkboxMark);

  checkboxInput.addEventListener('click', (e) => {
    e.stopPropagation();
    
    todo.completed = checkboxInput.checked;
    todo.completedAt = todo.completed ? new Date().toISOString() : null;
    
    const statusMsg = todo.completed ? 'Completed todo' : 'Marked todo as incomplete';
    todo.logs.push(createLogEntry(todo.completed ? 'completed' : 'uncompleted', statusMsg));
    
    saveTodo(todo, true);
    refreshCallback();
    triggerSyncQuietly();
  });

  const textSpan = document.createElement('span');
  textSpan.className = 'editor-text-btn';
  textSpan.innerText = todo.text;

  // Open inspector on click
  textSpan.addEventListener('click', (e) => {
    e.stopPropagation();
    openInspectorDrawer(todo.id, refreshCallback);
  });

  line.appendChild(checkboxWrapper);
  line.appendChild(textSpan);

  // Hover unassign button
  const unassignBtn = document.createElement('button');
  unassignBtn.className = 'sync-btn';
  unassignBtn.innerHTML = '&times;';
  unassignBtn.title = 'Unassign from Today';
  unassignBtn.style.padding = '2px 6px';
  unassignBtn.style.border = 'none';
  unassignBtn.style.background = 'transparent';
  unassignBtn.style.color = 'var(--text-muted)';
  unassignBtn.style.cursor = 'pointer';
  unassignBtn.style.fontSize = '16px';
  unassignBtn.style.lineHeight = '1';
  unassignBtn.style.marginLeft = 'auto';
  unassignBtn.style.opacity = '0';
  unassignBtn.style.transition = 'var(--transition-fast)';

  line.addEventListener('mouseenter', () => unassignBtn.style.opacity = '1');
  line.addEventListener('mouseleave', () => unassignBtn.style.opacity = '0');

  unassignBtn.addEventListener('mouseenter', () => unassignBtn.style.color = 'var(--color-danger)');
  unassignBtn.addEventListener('mouseleave', () => unassignBtn.style.color = 'var(--text-muted)');

  unassignBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    todo.assignedDates = todo.assignedDates.filter(d => d !== currentFocusDate);
    todo.logs.push(createLogEntry('unassigned', `Unassigned from Focus Day ${currentFocusDate}`));
    saveTodo(todo, true);
    refreshCallback();
    triggerSyncQuietly();
  });

  line.appendChild(unassignBtn);

  return line;
}

/* 5. Slide-out Inspector Drawer */

function setupInspectorDrawer() {
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);

  // Close drawer when clicking outside of it
  document.addEventListener('click', (e) => {
    const drawer = document.getElementById('details-drawer');
    if (drawer && drawer.classList.contains('open')) {
      if (!drawer.contains(e.target)) {
        closeDrawer();
      }
    }
  });

  const titleInput = document.getElementById('drawer-todo-title');
  const notesEditor = document.getElementById('drawer-notes');
  const deleteBtn = document.getElementById('drawer-delete-btn');

  // Drawer Tab Switches
  const tabEditor = document.getElementById('tab-btn-editor');
  const tabLogs = document.getElementById('tab-btn-logs');
  const secEditor = document.getElementById('drawer-editor-section');
  const secLogs = document.getElementById('drawer-logs-section');

  tabEditor.addEventListener('click', () => {
    tabEditor.classList.add('active');
    tabLogs.classList.remove('active');
    secEditor.classList.add('active');
    secLogs.classList.remove('active');
  });

  tabLogs.addEventListener('click', () => {
    tabLogs.classList.add('active');
    tabEditor.classList.remove('active');
    secLogs.classList.add('active');
    secEditor.classList.remove('active');
  });

  // Title edit on blur
  titleInput.addEventListener('blur', () => {
    if (!activeTodoIdInDrawer) return;
    const todo = getTodoById(activeTodoIdInDrawer);
    const textVal = titleInput.value.trim();
    if (todo && textVal && todo.text !== textVal) {
      const old = todo.text;
      todo.text = textVal;
      todo.logs.push(createLogEntry('renamed', `Renamed from "${old}" to "${textVal}"`));
      saveTodo(todo, true);
      triggerRefreshCallbacks();
    }
  });

  // Title edit on Enter
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') titleInput.blur();
  });

  // Notes autosave on blur
  notesEditor.addEventListener('blur', () => {
    if (!activeTodoIdInDrawer) return;
    const todo = getTodoById(activeTodoIdInDrawer);
    if (todo && todo.notes !== notesEditor.value) {
      todo.notes = notesEditor.value;
      todo.logs.push(createLogEntry('note_edit', 'Updated notes'));
      saveTodo(todo, true);
      triggerRefreshCallbacks();
      triggerSyncQuietly();
    }
  });

  // Delete button
  deleteBtn.addEventListener('click', () => {
    if (!activeTodoIdInDrawer) return;
    if (confirm("Are you sure you want to delete this todo permanently?")) {
      deleteTodo(activeTodoIdInDrawer);
      closeDrawer();
      triggerRefreshCallbacks();
      triggerSyncQuietly();
    }
  });
}

// Store current refresh callback based on where inspector was triggered
let currentDrawerRefreshCallback = null;

function openInspectorDrawer(todoId, refreshCallback) {
  activeTodoIdInDrawer = todoId;
  currentDrawerRefreshCallback = refreshCallback;

  const todo = getTodoById(todoId);
  if (!todo) return;

  const drawer = document.getElementById('details-drawer');
  
  // Reset tabs to Editor default
  document.getElementById('tab-btn-editor').classList.add('active');
  document.getElementById('tab-btn-logs').classList.remove('active');
  document.getElementById('drawer-editor-section').classList.add('active');
  document.getElementById('drawer-logs-section').classList.remove('active');

  // Populate Title & Notes
  document.getElementById('drawer-todo-title').value = todo.text;
  document.getElementById('drawer-notes').value = todo.notes;

  // Unassign Button logic
  const unassignBtn = document.getElementById('drawer-unassign-btn');
  let contextDate = null;
  if (refreshCallback === renderDailyFocus) {
    contextDate = currentFocusDate;
  } else if (refreshCallback === renderHistoryTasks) {
    contextDate = historySelectedDate;
  } else if (todo.assignedDates.includes(currentFocusDate)) {
    contextDate = currentFocusDate;
  }

  if (contextDate && todo.assignedDates.includes(contextDate)) {
    unassignBtn.style.display = 'block';
    unassignBtn.innerText = `Unassign from ${contextDate === getLocalDateString(new Date()) ? 'Today' : contextDate}`;
    unassignBtn.onclick = () => {
      todo.assignedDates = todo.assignedDates.filter(d => d !== contextDate);
      todo.logs.push(createLogEntry('unassigned', `Unassigned from Focus Day ${contextDate}`));
      saveTodo(todo, true);
      closeDrawer();
      triggerRefreshCallbacks();
      triggerSyncQuietly();
    };
  } else {
    unassignBtn.style.display = 'none';
    unassignBtn.onclick = null;
  }

  // Build Status Badges
  const badges = document.getElementById('drawer-status-badge');
  badges.innerHTML = `
    <span class="meta-badge">Created: ${new Date(todo.createdAt).toLocaleDateString()}</span>
    <span class="meta-badge" style="color: ${todo.completed ? 'var(--color-success)' : 'var(--color-warning)'}">
      ${todo.completed ? 'Completed' : 'Pending'}
    </span>
  `;

  // Render Log Timelines
  const logsContainer = document.getElementById('drawer-logs');
  logsContainer.innerHTML = '';
  
  // Newest logs at the top
  const sortedLogs = [...todo.logs].reverse();
  sortedLogs.forEach(log => {
    const logEl = document.createElement('div');
    logEl.className = 'log-item';
    logEl.innerHTML = `
      <span>${log.detail}</span>
      <span class="log-time">${formatLogTime(log.timestamp)}</span>
    `;
    logsContainer.appendChild(logEl);
  });

  drawer.classList.add('open');
}

function closeDrawer() {
  const drawer = document.getElementById('details-drawer');
  drawer.classList.remove('open');
  activeTodoIdInDrawer = null;
  currentDrawerRefreshCallback = null;
}

function triggerRefreshCallbacks() {
  if (currentDrawerRefreshCallback) {
    currentDrawerRefreshCallback();
  }
  // Refresh standard dashboards just in case
  renderDailyFocus();
  renderMainPool();
  renderHistoryView();
}

/* 6. Daily Setup Prompt Modal */

function setupDailyPrompt() {
  const modal = document.getElementById('daily-setup-modal');
  const submitBtn = document.getElementById('setup-submit-btn');
  const quickInput = document.getElementById('setup-quick-add');

  // Quick add inside setup modal
  quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = quickInput.value.trim();
      if (!text) return;
      
      // Add to temp array
      setupQuickAddedTasks.push(text);
      quickInput.value = '';
      renderSetupAddedList();
    }
  });

  // Start My Day
  submitBtn.addEventListener('click', () => {
    const todayStr = getLocalDateString(new Date());

    // 1. Assign selected items from yesterday & backlog
    setupTasksToAssign.forEach(id => {
      const todo = getTodoById(id);
      if (todo && !todo.assignedDates.includes(todayStr)) {
        todo.assignedDates.push(todayStr);
        todo.logs.push(createLogEntry('assigned', `Selected during Daily Setup for Focus Day ${todayStr}`));
        saveTodo(todo, true);
      }
    });

    // 2. Create and assign quick added items
    setupQuickAddedTasks.forEach(text => {
      const todo = createTodo(text);
      todo.assignedDates.push(todayStr);
      todo.logs.push(createLogEntry('assigned', `Created during Daily Setup for Focus Day ${todayStr}`));
      saveTodo(todo, true);
    });

    // 3. Save setup completed state
    setLastSetupCompletedDate(todayStr);
    
    // Close modal
    modal.classList.remove('open');
    setupTasksToAssign.clear();
    setupQuickAddedTasks = [];
    
    renderDailyFocus();
    triggerSyncQuietly();
  });
}

function renderSetupAddedList() {
  const container = document.getElementById('setup-added-tasks');
  container.innerHTML = '';
  
  setupQuickAddedTasks.forEach((text, index) => {
    const el = document.createElement('div');
    el.className = 'setup-item';
    el.innerHTML = `
      <span style="color: var(--color-secondary); font-weight: bold; margin-right: 5px;">+</span>
      <span>${text}</span>
      <span style="margin-left: auto; cursor: pointer; color: var(--text-muted);" id="del-setup-tmp-${index}">&times;</span>
    `;

    // Allow deleting a temp item
    el.querySelector(`#del-setup-tmp-${index}`).addEventListener('click', (e) => {
      e.stopPropagation();
      setupQuickAddedTasks.splice(index, 1);
      renderSetupAddedList();
    });

    container.appendChild(el);
  });
}

function setupDailyPromptData() {
  const todayStr = getLocalDateString(new Date());
  const yesterdayStr = getYesterdayDateString(todayStr);

  document.getElementById('setup-date-subtitle').innerText = `Planning for ${formatDateReadable(todayStr)}`;

  const allTodos = getTodos();

  // Panel 1: Worked on Yesterday (assigned to yesterday)
  const yesterdayItems = allTodos.filter(t => t.assignedDates.includes(yesterdayStr));
  const yesterdayContainer = document.getElementById('setup-yesterday-list');
  yesterdayContainer.innerHTML = '';

  if (yesterdayItems.length === 0) {
    yesterdayContainer.innerHTML = `<div class="setup-empty-text">No tasks worked on yesterday.</div>`;
  } else {
    yesterdayItems.forEach(todo => {
      const item = createSetupSelectableItem(todo);
      yesterdayContainer.appendChild(item);
    });
  }

  // Panel 2: Remaining Pool Backlog (active, not completed, not assigned to yesterday)
  const poolItems = allTodos.filter(t => 
    !t.completed && 
    !t.assignedDates.includes(yesterdayStr) && 
    !t.assignedDates.includes(todayStr)
  );
  const poolContainer = document.getElementById('setup-pool-list');
  poolContainer.innerHTML = '';

  if (poolItems.length === 0) {
    poolContainer.innerHTML = `<div class="setup-empty-text">Backlog is clean!</div>`;
  } else {
    poolItems.forEach(todo => {
      const item = createSetupSelectableItem(todo);
      poolContainer.appendChild(item);
    });
  }

  // Clear added panel
  document.getElementById('setup-added-tasks').innerHTML = '';
}

function createSetupSelectableItem(todo) {
  const el = document.createElement('div');
  el.className = 'setup-item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.style.cursor = 'pointer';
  checkbox.checked = setupTasksToAssign.has(todo.id);

  const textSpan = document.createElement('span');
  textSpan.innerText = todo.text;
  textSpan.style.textOverflow = 'ellipsis';
  textSpan.style.overflow = 'hidden';
  textSpan.style.whiteSpace = 'nowrap';
  
  if (todo.completed) {
    textSpan.style.textDecoration = 'line-through';
    textSpan.style.color = 'var(--text-muted)';
  }

  el.appendChild(checkbox);
  el.appendChild(textSpan);

  // Toggle selection on click
  el.addEventListener('click', (e) => {
    if (e.target !== checkbox) {
      checkbox.checked = !checkbox.checked;
    }
    if (checkbox.checked) {
      setupTasksToAssign.add(todo.id);
      el.style.borderColor = 'var(--color-primary)';
      el.style.backgroundColor = 'rgba(124, 77, 255, 0.05)';
    } else {
      setupTasksToAssign.delete(todo.id);
      el.style.borderColor = 'var(--border-color)';
      el.style.backgroundColor = 'var(--bg-input)';
    }
  });

  // Pre-style if already selected
  if (checkbox.checked) {
    el.style.borderColor = 'var(--color-primary)';
    el.style.backgroundColor = 'rgba(124, 77, 255, 0.05)';
  }

  return el;
}

function checkDailyPromptRequirement() {
  const todayStr = getLocalDateString(new Date());
  const lastSetupDate = getLastSetupCompletedDate();

  if (lastSetupDate !== todayStr) {
    // Open setup modal
    setupTasksToAssign.clear();
    setupQuickAddedTasks = [];
    
    // Pre-populate tasks to carry forward:
    // Auto-select incomplete tasks from yesterday to pull forward
    const yesterdayStr = getYesterdayDateString(todayStr);
    getTodos().forEach(t => {
      if (t.assignedDates.includes(yesterdayStr) && !t.completed) {
        setupTasksToAssign.add(t.id);
      }
    });

    setupDailyPromptData();
    document.getElementById('daily-setup-modal').classList.add('open');
  }
}

/* 7. Auth Modal & Sync Status */

function setupAuthModal() {
  const authTriggerBtn = document.getElementById('auth-trigger-btn');
  const authModal = document.getElementById('auth-modal');
  const authClose = document.getElementById('auth-modal-close');
  const authForm = document.getElementById('auth-form');
  const switchToggle = document.getElementById('auth-switch-toggle');

  let isRegisterState = false;

  // Toggle open
  authTriggerBtn.addEventListener('click', () => {
    const session = getUserSession();
    if (session) {
      // Sign Out logic
      if (confirm("Are you sure you want to sign out? Your local database will be preserved, but offline sync queue will reset.")) {
        clearUserSession();
        updateSyncStatusUI();
        renderDailyFocus();
        renderMainPool();
        renderHistoryView();
      }
    } else {
      // Open modal
      isRegisterState = false;
      toggleAuthState(false);
      authModal.classList.add('open');
    }
  });

  // Close modal
  authClose.addEventListener('click', () => {
    authModal.classList.remove('open');
  });

  // Switch Login / Register state
  switchToggle.addEventListener('click', () => {
    isRegisterState = !isRegisterState;
    toggleAuthState(isRegisterState);
  });

  // Submit form
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    const successEl = document.getElementById('auth-success');

    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    try {
      if (isRegisterState) {
        // Register
        await registerUser(user, pass);
        successEl.innerText = "Account created successfully! Logging in...";
        successEl.style.display = 'block';
      }
      
      // Login (both for logging in and immediately after registering)
      const data = await loginUser(user, pass);
      setUserSession(data.username, data.token);
      
      successEl.innerText = `Welcome, ${data.username}! Syncing...`;
      successEl.style.display = 'block';
      
      setTimeout(async () => {
        authModal.classList.remove('open');
        updateSyncStatusUI();
        
        // Trigger initial sync
        await triggerSync();
      }, 1000);

    } catch (err) {
      errorEl.innerText = err.message || "Authentication failed";
      errorEl.style.display = 'block';
    }
  });

  // Sync button manually triggered
  document.getElementById('sync-now-btn').addEventListener('click', async () => {
    await triggerSync();
  });

  function toggleAuthState(toRegister) {
    const title = document.getElementById('auth-modal-title');
    const submit = document.getElementById('auth-submit-btn');
    const prompt = document.getElementById('auth-switch-toggle');
    const label = document.querySelector('.auth-switch-prompt');

    document.getElementById('auth-error').style.display = 'none';
    document.getElementById('auth-success').style.display = 'none';
    document.getElementById('auth-email').value = '';
    document.getElementById('auth-password').value = '';

    if (toRegister) {
      title.innerText = "Create FocusFlow Account";
      submit.innerText = "Register & Sign In";
      label.innerHTML = `Already have an account? <span id="auth-switch-toggle" class="auth-switch-link">Sign in here</span>`;
    } else {
      title.innerText = "Sign In to Cloud Sync";
      submit.innerText = "Login";
      label.innerHTML = `Don't have an account? <span id="auth-switch-toggle" class="auth-switch-link">Register here</span>`;
    }

    // Re-bind the dynamically created label element click handler
    document.getElementById('auth-switch-toggle').addEventListener('click', () => {
      isRegisterState = !isRegisterState;
      toggleAuthState(isRegisterState);
    });
  }
}

async function updateSyncStatusUI() {
  const syncDot = document.getElementById('sync-dot');
  const syncText = document.getElementById('sync-status-text');
  const userInfo = document.getElementById('sync-user-info');
  const authTriggerBtn = document.getElementById('auth-trigger-btn');
  const syncBtn = document.getElementById('sync-now-btn');

  const session = getUserSession();
  const isOnline = await testServerConnection();

  const authText = authTriggerBtn.querySelector('.auth-btn-text');
  const authIcon = authTriggerBtn.querySelector('svg');

  if (session) {
    // User is logged in
    if (authText) authText.innerText = "Sign Out";
    if (authIcon) {
      authIcon.innerHTML = `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>`;
    }
    authTriggerBtn.classList.add('secondary');
    syncBtn.style.display = 'block';

    if (isOnline) {
      syncDot.className = 'status-dot online';
      syncText.innerText = 'Connected';
      userInfo.innerText = `Logged in as ${session.username}`;
    } else {
      syncDot.className = 'status-dot offline';
      syncText.innerText = 'Offline Mode';
      userInfo.innerText = `Cached session for ${session.username}`;
    }
  } else {
    // User not logged in
    if (authText) authText.innerText = "Sign In";
    if (authIcon) {
      authIcon.innerHTML = `<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line>`;
    }
    authTriggerBtn.classList.remove('secondary');
    syncBtn.style.display = 'none';
    syncDot.className = 'status-dot';
    syncText.innerText = 'Local Storage';
    userInfo.innerText = 'Offline Mode';
  }
}

async function triggerSync() {
  const syncBtn = document.getElementById('sync-now-btn');
  syncBtn.innerText = 'Syncing...';
  syncBtn.disabled = true;

  const res = await syncTodos();
  updateSyncStatusUI();

  if (res.success) {
    syncBtn.innerText = 'Sync';
    syncBtn.disabled = false;
    triggerRefreshCallbacks();
  } else {
    syncBtn.innerText = 'Failed';
    syncBtn.disabled = false;
    setTimeout(() => {
      syncBtn.innerText = 'Sync';
    }, 3000);
  }
}

function triggerSyncQuietly() {
  // Try sync in background without blocking buttons
  const session = getUserSession();
  if (session) {
    syncTodos().then(res => {
      if (res.success && (res.sentCount > 0 || res.receivedCount > 0)) {
        triggerRefreshCallbacks();
      }
      updateSyncStatusUI();
    });
  }
}
