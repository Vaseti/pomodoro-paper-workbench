import {
  addActivity,
  addInterrupt,
  addMarker,
  addTodayTask,
  buildTaskReport,
  canStartSelectedTask,
  completePomodoro,
  createInitialState,
  deleteActivity,
  deleteInterrupt,
  deleteMarker,
  deleteTask,
  getRecentDailyRecords,
  moveActivityToToday,
  normalizeState,
  rollToDate,
  selectTask,
  toggleMarker,
  toggleTaskDone,
  updateDailySummary,
  updateActivityText,
  updateSettings,
  updateTaskText,
} from './domain.js?v=20260624-daily-records';
import { loadState, saveState } from './storage.js?v=20260624-daily-records';
import {
  phaseSeconds,
  transitionAfterCompletedPhase,
} from './timer.js?v=20260624-daily-records';

const refs = {
  activityInput: document.querySelector('#activity-input'),
  activityList: document.querySelector('#activity-list'),
  plannedInput: document.querySelector('#planned-input'),
  plannedList: document.querySelector('#planned-list'),
  urgentInput: document.querySelector('#urgent-input'),
  urgentList: document.querySelector('#urgent-list'),
  selectedTaskTools: document.querySelector('#selected-task-tools'),
  logList: document.querySelector('#log-list'),
  workMinutes: document.querySelector('#work-minutes'),
  breakMinutes: document.querySelector('#break-minutes'),
  timerDisplay: document.querySelector('#timer-display'),
  phaseLabel: document.querySelector('#phase-label'),
  currentTask: document.querySelector('#current-task'),
  startPause: document.querySelector('#start-pause'),
  resetTimer: document.querySelector('#reset-timer'),
  focusMode: document.querySelector('#focus-mode'),
  focusDisplay: document.querySelector('#focus-display'),
  focusTaskName: document.querySelector('#focus-task-name'),
  focusPhase: document.querySelector('#focus-phase'),
  focusStatus: document.querySelector('#focus-status'),
  focusPause: document.querySelector('#focus-pause'),
  focusExit: document.querySelector('#focus-exit'),
  focusSidebarToggle: document.querySelector('#focus-sidebar-toggle'),
  focusSidebarPanel: document.querySelector('#focus-sidebar-panel'),
  focusInternal: document.querySelector('#focus-internal'),
  focusInternalUndo: document.querySelector('#focus-internal-undo'),
  focusInternalCount: document.querySelector('#focus-internal-count'),
  focusExternal: document.querySelector('#focus-external'),
  focusExternalUndo: document.querySelector('#focus-external-undo'),
  focusExternalCount: document.querySelector('#focus-external-count'),
  focusUrgentInput: document.querySelector('#focus-urgent-input'),
  focusBgSelect: document.querySelector('#focus-bg-select'),
  focusClockSelect: document.querySelector('#focus-clock-select'),
};

let state = rollToDate(normalizeState(loadState() ?? createInitialState()));
let timer = {
  phase: 'work',
  running: false,
  remainingSeconds: state.settings.workMinutes * 60,
  intervalId: null,
};
let focusModeActive = false;
let focusSession = {
  taskId: null,
  internal: [],
  external: [],
};
let focusSidebarOpen = false;
let audioContext = null;

function ensureAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  audioContext ??= new AudioCtor();
  return audioContext;
}

function commit(nextState) {
  state = rollToDate(normalizeState(nextState));
  saveState(state);
  render();
}

function syncDayBoundary() {
  const nextState = rollToDate(state);
  if (nextState.currentDate !== state.currentDate) {
    commit(nextState);
  }
}

function selectedTask() {
  return [...state.today.planned, ...state.today.urgent]
    .find((task) => task.id === state.selectedTaskId) ?? null;
}

function taskById(sourceState, taskId) {
  return [...sourceState.today.planned, ...sourceState.today.urgent]
    .find((task) => task.id === taskId) ?? null;
}

function resetFocusSession(taskId) {
  focusSession = {
    taskId,
    internal: [],
    external: [],
  };
}

function syncFocusAppearance() {
  const background = state.settings.focusBackground ?? 'midnight';
  const clock = state.settings.focusClock ?? 'classic';
  refs.focusMode.dataset.background = background;
  refs.focusMode.dataset.clock = clock;
  refs.focusBgSelect.value = background;
  refs.focusClockSelect.value = clock;
}

function setFocusSidebar(open) {
  focusSidebarOpen = open;
  refs.focusMode.classList.toggle('sidebar-open', open);
  refs.focusMode.classList.toggle('sidebar-collapsed', !open);
  refs.focusSidebarToggle.setAttribute('aria-expanded', String(open));
  refs.focusSidebarToggle.textContent = open ? '收起' : '工具';
  refs.focusSidebarPanel.setAttribute('aria-hidden', String(!open));
  if ('inert' in refs.focusSidebarPanel) {
    refs.focusSidebarPanel.inert = !open;
  }
}

function addFocusInterrupt(type) {
  const task = selectedTask();
  if (!task) return;

  const nextState = addInterrupt(state, task.id, type);
  const nextTask = taskById(nextState, task.id);
  const interrupt = [...nextTask.interruptions].reverse()
    .find((item) => item.type === type);
  if (interrupt) focusSession[type].push(interrupt.id);
  commit(nextState);
}

function removeFocusInterrupt(type) {
  const task = selectedTask();
  if (!task) return;

  const trackedId = focusSession[type].pop();
  const fallback = [...task.interruptions].reverse()
    .find((interrupt) => interrupt.type === type);
  const interruptId = trackedId ?? fallback?.id;
  if (!interruptId) {
    renderTimer();
    return;
  }

  commit(deleteInterrupt(state, task.id, interruptId));
}

function taskMarkersOfType(task, type) {
  return task.markers.filter((marker) => marker.type === type);
}

function allChecked(markers) {
  return markers.length > 0 && markers.every((marker) => marker.checked);
}

function canAddSquareEstimate(task) {
  const circles = taskMarkersOfType(task, 'circle');
  const triangles = taskMarkersOfType(task, 'triangle');
  return task.pomodoros === 0 && circles.length === 0 && triangles.length === 0;
}

function canAddCircleEstimate(task) {
  const squares = taskMarkersOfType(task, 'square');
  const triangles = taskMarkersOfType(task, 'triangle');
  return allChecked(squares) && triangles.length === 0;
}

function canAddTriangleEstimate(task) {
  const squares = taskMarkersOfType(task, 'square');
  const circles = taskMarkersOfType(task, 'circle');
  return allChecked(squares) && allChecked(circles);
}

function formatSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function phaseDuration(phase = timer.phase) {
  return phaseSeconds(state.settings, phase);
}

function resetRemainingForPhase(phase = timer.phase) {
  timer.remainingSeconds = phaseDuration(phase);
}

function syncSettingsInputs() {
  refs.workMinutes.value = state.settings.workMinutes;
  refs.breakMinutes.value = state.settings.breakMinutes;
}

function playBell() {
  const context = ensureAudioContext();
  if (!context) return;

  const notes = [880, 660, 880];
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.0001, context.currentTime + index * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.28, context.currentTime + index * 0.18 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + index * 0.18 + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(context.currentTime + index * 0.18);
    oscillator.stop(context.currentTime + index * 0.18 + 0.18);
  });
}

function tick() {
  timer.remainingSeconds -= 1;

  if (timer.remainingSeconds <= 0) {
    const finishedPhase = timer.phase;
    playBell();
    commit(completePomodoro(state, finishedPhase));
    const nextTimer = transitionAfterCompletedPhase(timer, state.settings, finishedPhase);
    timer.phase = nextTimer.phase;
    timer.running = nextTimer.running;
    timer.remainingSeconds = nextTimer.remainingSeconds;
    if (!timer.running) {
      window.clearInterval(timer.intervalId);
      timer.intervalId = null;
    }
    if (finishedPhase === 'work') exitFocusMode();
  }

  renderTimer();
}

function enterFocusMode(resetSession = false) {
  const task = selectedTask();
  if (resetSession || focusSession.taskId !== task?.id) {
    resetFocusSession(task?.id ?? null);
  }
  focusModeActive = true;
  refs.focusMode.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-focus-mode');
  setFocusSidebar(false);
  renderTimer();
}

function exitFocusMode() {
  focusModeActive = false;
  refs.focusMode.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('is-focus-mode');
  setFocusSidebar(false);
  renderTimer();
}

function startTimer() {
  if (timer.running) return;
  if (timer.phase === 'work') {
    const status = canStartSelectedTask(state);
    if (!status.ok) {
      refs.currentTask.textContent = status.message;
      refs.currentTask.classList.add('warning');
      return;
    }
  }

  ensureAudioContext();
  const shouldResetFocusSession =
    timer.phase === 'work' && timer.remainingSeconds === phaseDuration('work') && !focusModeActive;
  timer.running = true;
  refs.startPause.textContent = '暂停';
  timer.intervalId = window.setInterval(tick, 1000);
  if (timer.phase === 'work') enterFocusMode(shouldResetFocusSession);
}

function pauseTimer() {
  timer.running = false;
  refs.startPause.textContent = '开始';
  if (timer.intervalId) {
    window.clearInterval(timer.intervalId);
    timer.intervalId = null;
  }
}

function resetTimer() {
  pauseTimer();
  timer.phase = 'work';
  resetRemainingForPhase('work');
  resetFocusSession(null);
  exitFocusMode();
  renderTimer();
}

function renderTimer() {
  const displayText = formatSeconds(timer.remainingSeconds);
  refs.timerDisplay.textContent = displayText;
  refs.phaseLabel.textContent = timer.phase === 'work' ? '工作' : '休息';
  refs.startPause.textContent = timer.running ? '暂停' : '开始';

  const task = selectedTask();
  const status = canStartSelectedTask(state);
  refs.currentTask.classList.toggle('warning', Boolean(task) && timer.phase === 'work' && !status.ok);
  refs.currentTask.textContent = task
    ? (timer.phase === 'work' && !status.ok ? status.message : `当前任务：${task.text}`)
    : '未选中任务';
  refs.focusDisplay.textContent = displayText;
  refs.focusPhase.textContent = timer.phase === 'work' ? '工作番茄' : '休息';
  refs.focusTaskName.textContent = task ? task.text : '未选中任务';
  refs.focusPause.textContent = timer.running ? '暂停' : '继续';
  refs.focusStatus.textContent = timer.running ? '专注中' : '已暂停';
  refs.focusMode.classList.toggle('paused', !timer.running);
  refs.focusInternalCount.textContent = String(focusSession.internal.length);
  refs.focusExternalCount.textContent = String(focusSession.external.length);
  refs.focusInternalUndo.disabled = focusSession.internal.length === 0;
  refs.focusExternalUndo.disabled = focusSession.external.length === 0;
  refs.focusSidebarToggle.setAttribute('aria-expanded', String(focusSidebarOpen));
  syncFocusAppearance();
  document.title = `${formatSeconds(timer.remainingSeconds)} 番茄工作台`;
}

function editableInput(value, onCommit) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => onCommit(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  return input;
}

function renderActivities() {
  refs.activityList.replaceChildren();

  if (state.activities.length === 0) {
    refs.activityList.append(emptyState('还没有活动'));
    return;
  }

  state.activities.forEach((activity) => {
    const item = document.createElement('article');
    item.className = 'activity-line';

    const text = document.createElement('div');
    text.className = 'activity-text';
    text.append(editableInput(activity.text, (value) => {
      commit(updateActivityText(state, activity.id, value));
    }));
    item.append(text);

    const actions = document.createElement('div');
    actions.className = 'activity-actions';
    actions.append(
      button('计划', () => commit(moveActivityToToday(state, activity.id, 'planned')), 'mini-button'),
      button('紧急', () => commit(moveActivityToToday(state, activity.id, 'urgent')), 'mini-button'),
      button('删', () => commit(deleteActivity(state, activity.id)), 'mini-button danger'),
    );
    item.append(actions);
    refs.activityList.append(item);
  });
}

function markerLabel(marker) {
  return marker.checked ? '×' : marker.symbol;
}

function renderTasks(sectionName, container, tasks) {
  container.replaceChildren();

  if (tasks.length === 0) {
    container.append(emptyState(sectionName === 'planned' ? '今天计划为空' : '没有计划外紧急事项'));
    return;
  }

  tasks.forEach((task) => {
    const item = document.createElement('article');
    item.className = [
      'task-line',
      task.id === state.selectedTaskId ? 'selected' : '',
      task.done ? 'done' : '',
    ].filter(Boolean).join(' ');
    item.addEventListener('click', (event) => {
      if (event.target.closest('button, input')) return;
      commit(selectTask(state, task.id));
    });

    const main = document.createElement('div');
    main.className = 'task-main';
    const selectButton = button('', () => commit(selectTask(state, task.id)), 'select-dot');
    selectButton.title = '设为当前任务';
    selectButton.setAttribute('aria-label', '设为当前任务');
    main.append(selectButton);

    const text = document.createElement('div');
    text.className = 'task-text';
    text.append(editableInput(task.text, (value) => {
      commit(updateTaskText(state, task.id, value));
    }));
    main.append(text);

    const marks = document.createElement('div');
    marks.className = 'inline-marks';
    task.markers.forEach((marker) => {
      const chip = document.createElement('span');
      chip.className = `marker-chip${marker.checked ? ' checked' : ''}`;

      const toggle = button(markerLabel(marker), () => {
        commit(toggleMarker(state, task.id, marker.id));
      }, 'marker-toggle');
      toggle.title = marker.checked ? '取消打叉' : '打叉';
      toggle.setAttribute('aria-label', marker.checked ? '取消打叉' : '打叉');

      const remove = button('删', () => {
        commit(deleteMarker(state, task.id, marker.id));
      }, 'marker-remove');
      remove.title = '删除这个标记';
      remove.setAttribute('aria-label', '删除这个标记');

      chip.append(toggle, remove);
      marks.append(chip);
    });
    task.interruptions.forEach((interrupt) => {
      const chip = document.createElement('span');
      chip.className = 'interrupt-chip';

      const symbol = document.createElement('span');
      symbol.className = 'interrupt-token';
      symbol.textContent = interrupt.symbol;

      const remove = button('删', () => {
        commit(deleteInterrupt(state, task.id, interrupt.id));
      }, 'interrupt-remove');
      remove.title = '删除这次打断';
      remove.setAttribute('aria-label', '删除这次打断');

      chip.append(symbol, remove);
      marks.append(chip);
    });
    main.append(marks);

    const count = document.createElement('span');
    count.className = 'pomodoro-count';
    count.textContent = `${task.pomodoros} 番茄`;
    main.append(count);
    item.append(main);

    container.append(item);
  });
}

function renderSelectedTaskTools() {
  refs.selectedTaskTools.replaceChildren();
  const task = selectedTask();

  if (!task) {
    const hint = document.createElement('div');
    hint.className = 'tool-hint';
    hint.textContent = '选中一行待办后，在这里添加 □、○、△、打断或划掉任务。';
    refs.selectedTaskTools.append(hint);
    return;
  }

  const label = document.createElement('div');
  label.className = 'tool-current';
  label.textContent = `当前行：${task.text}`;

  const status = canStartSelectedTask(state);
  const statusLine = document.createElement('div');
  statusLine.className = `tool-status${status.ok ? '' : ' warning'}`;
  statusLine.textContent = task.done
    ? '这个待办已划掉'
    : (status.ok ? '估算格就绪，可以开始番茄钟' : status.message);

  const estimateGroup = document.createElement('div');
  estimateGroup.className = 'tool-group';
  if (canAddSquareEstimate(task)) {
    estimateGroup.append(labelButton('初估 □', () => commit(addMarker(state, task.id, 'square'))));
  }
  if (canAddCircleEstimate(task)) {
    estimateGroup.append(labelButton('二次预估 ○', () => commit(addMarker(state, task.id, 'circle'))));
  }
  if (canAddTriangleEstimate(task)) {
    estimateGroup.append(labelButton('三次预估 △', () => commit(addMarker(state, task.id, 'triangle'))));
  }
  if (estimateGroup.children.length === 0 && !task.done) {
    const hint = document.createElement('span');
    hint.className = 'tool-hint';
    hint.textContent = '当前估算格还没用完；完成一个工作番茄后会自动打叉。';
    estimateGroup.append(hint);
  }

  const interruptGroup = document.createElement('div');
  interruptGroup.className = 'tool-group';
  interruptGroup.append(
    labelButton("内部打断 '", () => commit(addInterrupt(state, task.id, 'internal'))),
    labelButton('外部打断 -', () => commit(addInterrupt(state, task.id, 'external'))),
  );

  const taskGroup = document.createElement('div');
  taskGroup.className = 'tool-group';
  taskGroup.append(
    labelButton(task.done ? '恢复任务' : '划掉任务', () => commit(toggleTaskDone(state, task.id))),
    labelButton('删除任务', () => commit(deleteTask(state, task.id)), 'danger'),
  );

  refs.selectedTaskTools.append(label, statusLine, estimateGroup, interruptGroup, taskGroup);
}

function renderLogs() {
  refs.logList.replaceChildren();
  getRecentDailyRecords(state).forEach((dailyRecord) => {
    refs.logList.append(dailyRecordBlock(dailyRecord));
  });
}

function dailyRecordBlock(dailyRecord) {
  const wrapper = document.createElement('section');
  wrapper.className = 'daily-record';

  const header = document.createElement('div');
  header.className = 'daily-record-header';
  const title = document.createElement('h3');
  title.textContent = dailyRecord.date === state.currentDate
    ? `${dailyRecord.date} 今天`
    : dailyRecord.date;
  header.append(title);

  const report = buildTaskReport(dailyRecord);
  wrapper.append(
    header,
    reportBlock(
      '任务记录',
      ['待办', '内断', '外断', '番茄'],
      report.taskRows.map((row) => [
        row.name,
        String(row.internalInterruptions),
        String(row.externalInterruptions),
        String(row.pomodoros),
      ]),
      '还没有待办记录',
    ),
    reportBlock(
      '估算差异',
      ['完成的待办', '差异'],
      report.varianceRows.map((row) => [row.name, row.varianceLabel]),
      '还没有划掉的待办',
    ),
    reportSummary(report),
    dailySummaryEditor(dailyRecord),
  );

  return wrapper;
}

function dailySummaryEditor(dailyRecord) {
  const block = document.createElement('section');
  block.className = 'daily-summary';

  const label = document.createElement('label');
  label.textContent = '每日总结';
  label.htmlFor = `summary-${dailyRecord.date}`;

  const textarea = document.createElement('textarea');
  textarea.id = `summary-${dailyRecord.date}`;
  textarea.rows = 4;
  textarea.placeholder = '写下今天的节奏、收获或要调整的地方';
  textarea.value = dailyRecord.summary ?? '';
  textarea.addEventListener('change', () => {
    commit(updateDailySummary(state, dailyRecord.date, textarea.value));
  });

  block.append(label, textarea);
  return block;
}

function reportBlock(title, headers, rows, emptyText) {
  const block = document.createElement('section');
  block.className = 'report-block';

  const heading = document.createElement('h3');
  heading.textContent = title;
  block.append(heading);

  if (rows.length === 0) {
    block.append(emptyState(emptyText));
    return block;
  }

  const table = document.createElement('table');
  table.className = 'report-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach((header) => {
    const cell = document.createElement('th');
    cell.textContent = header;
    headerRow.append(cell);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tableRow = document.createElement('tr');
    row.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      tableRow.append(cell);
    });
    tbody.append(tableRow);
  });
  table.append(tbody);
  block.append(table);
  return block;
}

function reportSummary(report) {
  const summary = document.createElement('div');
  summary.className = 'report-summary';
  summary.append(
    summaryItem('内部打断', report.totals.internalInterruptions),
    summaryItem('外部打断', report.totals.externalInterruptions),
    summaryItem('实际番茄', report.totals.pomodoros),
    summaryItem('估算差异', report.totals.varianceLabel),
  );
  return summary;
}

function summaryItem(label, value) {
  const item = document.createElement('div');
  item.className = 'summary-item';
  const name = document.createElement('span');
  name.textContent = label;
  const number = document.createElement('strong');
  number.textContent = String(value);
  item.append(name, number);
  return item;
}

function emptyState(text) {
  const node = document.createElement('div');
  node.className = 'empty-state';
  node.textContent = text;
  return node;
}

function button(text, onClick, className = '') {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = text;
  node.addEventListener('click', onClick);
  return node;
}

function labelButton(text, onClick, extraClass = '') {
  return button(text, onClick, `tool-button ${extraClass}`.trim());
}

function addActivityLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((nextState, line) => addActivity(nextState, line), state);
}

function addTodoLines(sectionName, value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((nextState, line) => addTodayTask(nextState, sectionName, line), state);
}

function handleForm(selector, callback) {
  document.querySelector(selector).addEventListener('submit', (event) => {
    event.preventDefault();
    callback();
  });
}

function render() {
  syncSettingsInputs();
  renderTimer();
  renderSelectedTaskTools();
  renderActivities();
  renderTasks('planned', refs.plannedList, state.today.planned);
  renderTasks('urgent', refs.urgentList, state.today.urgent);
  renderLogs();
}

handleForm('[data-form="activity"]', () => {
  commit(addActivityLines(refs.activityInput.value));
  refs.activityInput.value = '';
});

handleForm('[data-form="planned"]', () => {
  commit(addTodoLines('planned', refs.plannedInput.value));
  refs.plannedInput.value = '';
});

handleForm('[data-form="urgent"]', () => {
  commit(addTodoLines('urgent', refs.urgentInput.value));
  refs.urgentInput.value = '';
});

handleForm('[data-form="focus-urgent"]', () => {
  commit(addTodoLines('urgent', refs.focusUrgentInput.value));
  refs.focusUrgentInput.value = '';
});

refs.workMinutes.addEventListener('change', () => {
  commit(updateSettings(state, {
    workMinutes: refs.workMinutes.value,
    breakMinutes: refs.breakMinutes.value,
  }));
  if (!timer.running && timer.phase === 'work') resetRemainingForPhase('work');
  renderTimer();
});

refs.breakMinutes.addEventListener('change', () => {
  commit(updateSettings(state, {
    workMinutes: refs.workMinutes.value,
    breakMinutes: refs.breakMinutes.value,
  }));
  if (!timer.running && timer.phase === 'break') resetRemainingForPhase('break');
  renderTimer();
});

refs.startPause.addEventListener('click', () => {
  if (timer.running) {
    pauseTimer();
  } else {
    startTimer();
  }
});

refs.resetTimer.addEventListener('click', resetTimer);

refs.focusPause.addEventListener('click', () => {
  if (timer.running) {
    pauseTimer();
  } else {
    startTimer();
  }
});

refs.focusExit.addEventListener('click', () => {
  pauseTimer();
  exitFocusMode();
});

refs.focusSidebarToggle.addEventListener('click', () => {
  setFocusSidebar(!focusSidebarOpen);
});

refs.focusInternal.addEventListener('click', () => {
  addFocusInterrupt('internal');
});

refs.focusInternalUndo.addEventListener('click', () => {
  removeFocusInterrupt('internal');
});

refs.focusExternal.addEventListener('click', () => {
  addFocusInterrupt('external');
});

refs.focusExternalUndo.addEventListener('click', () => {
  removeFocusInterrupt('external');
});

refs.focusBgSelect.addEventListener('change', () => {
  commit(updateSettings(state, {
    focusBackground: refs.focusBgSelect.value,
  }));
});

refs.focusClockSelect.addEventListener('change', () => {
  commit(updateSettings(state, {
    focusClock: refs.focusClockSelect.value,
  }));
});

saveState(state);
setFocusSidebar(false);
window.setInterval(syncDayBoundary, 60 * 1000);
render();
