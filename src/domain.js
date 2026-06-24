const MARKER_SYMBOLS = {
  square: '□',
  circle: '○',
  triangle: '△',
};

const INTERRUPT_SYMBOLS = {
  internal: "'",
  external: '-',
};

const INTERRUPT_LABELS = {
  internal: '内部打断',
  external: '外部打断',
};

const ESTIMATE_TYPES = ['square', 'circle', 'triangle'];

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneState(state) {
  return typeof structuredClone === 'function'
    ? structuredClone(state)
    : JSON.parse(JSON.stringify(state));
}

function nowText() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createTask(text) {
  return {
    id: makeId('task'),
    text: text.trim(),
    markers: [],
    interruptions: [],
    pomodoros: 0,
    done: false,
  };
}

function createActivity(text) {
  return {
    id: makeId('activity'),
    text: text.trim(),
  };
}

function createLog(text) {
  return {
    id: makeId('log'),
    text,
    createdAt: nowText(),
  };
}

function normalizeTask(task) {
  return {
    id: task.id ?? makeId('task'),
    text: task.text ?? '',
    markers: (task.markers ?? []).map((marker) => ({
      id: marker.id ?? makeId('marker'),
      type: marker.type,
      symbol: marker.symbol ?? MARKER_SYMBOLS[marker.type],
      checked: Boolean(marker.checked),
    })),
    interruptions: (task.interruptions ?? []).map((interrupt) => ({
      id: interrupt.id ?? makeId('interrupt'),
      type: interrupt.type,
      symbol: interrupt.symbol ?? INTERRUPT_SYMBOLS[interrupt.type],
    })),
    pomodoros: Number(task.pomodoros) || 0,
    done: Boolean(task.done),
  };
}

function normalizeToday(today = {}) {
  return {
    planned: (today.planned ?? []).map(normalizeTask),
    urgent: (today.urgent ?? []).map(normalizeTask),
  };
}

function normalizeDailyRecord(record) {
  return {
    date: record.date ?? todayKey(),
    today: normalizeToday(record.today),
    logs: record.logs ?? [],
    summary: record.summary ?? '',
  };
}

function pushLog(draft, text) {
  draft.logs.push(createLog(text));
}

function taskSections(draft) {
  return [draft.today.planned, draft.today.urgent];
}

function findTask(draft, taskId) {
  for (const section of taskSections(draft)) {
    const task = section.find((item) => item.id === taskId);
    if (task) return task;
  }

  return null;
}

function findTaskWithSection(draft, taskId) {
  for (const [sectionName, section] of [
    ['planned', draft.today.planned],
    ['urgent', draft.today.urgent],
  ]) {
    const index = section.findIndex((item) => item.id === taskId);
    if (index >= 0) return { sectionName, section, index, task: section[index] };
  }

  return null;
}

function allTasks(state) {
  return [
    ...(state.today?.planned ?? []),
    ...(state.today?.urgent ?? []),
  ];
}

function markersOfType(task, type) {
  return task.markers.filter((marker) => marker.type === type);
}

function firstUncheckedEstimateMarker(task) {
  for (const type of ESTIMATE_TYPES) {
    const marker = task.markers.find((item) => item.type === type && !item.checked);
    if (marker) return marker;
  }

  return null;
}

function estimateStatus(task) {
  if (!task) {
    return { ok: false, neededType: null, message: '请先选中一个待办' };
  }

  if (task.done) {
    return { ok: false, neededType: null, message: '这个待办已经完成' };
  }

  if (markersOfType(task, 'square').length === 0) {
    return { ok: false, neededType: 'square', message: '开始前先添加 □ 做初次预估' };
  }

  const openMarker = firstUncheckedEstimateMarker(task);
  if (openMarker) {
    return { ok: true, neededType: null, message: '' };
  }

  if (markersOfType(task, 'circle').length === 0) {
    return { ok: false, neededType: 'circle', message: '□ 已用完，请用 ○ 做二次预估' };
  }

  return { ok: false, neededType: 'triangle', message: '估算再次用完，请用 △ 做第三次预估' };
}

function estimateVariance(task) {
  const extraEstimateCount =
    markersOfType(task, 'circle').length + markersOfType(task, 'triangle').length;

  if (extraEstimateCount > 0) {
    return -extraEstimateCount;
  }

  return markersOfType(task, 'square').filter((marker) => !marker.checked).length;
}

function signedNumber(value) {
  return value > 0 ? `+${value}` : String(value);
}

function emptyToday() {
  return {
    planned: [],
    urgent: [],
  };
}

function hasDailyContent(record) {
  return record.today.planned.length > 0
    || record.today.urgent.length > 0
    || record.logs.length > 0
    || Boolean(record.summary.trim());
}

function dailyRecordFromState(state) {
  return {
    date: state.currentDate,
    today: normalizeToday(state.today),
    logs: state.logs ?? [],
    summary: state.dailySummary ?? '',
  };
}

function sortRecordsNewestFirst(records) {
  return [...records].sort((first, second) => second.date.localeCompare(first.date));
}

function mergeDailyRecord(records, record) {
  const normalized = normalizeDailyRecord(record);
  return [
    normalized,
    ...records.filter((item) => item.date !== normalized.date),
  ];
}

function pruneArchivedRecords(records, currentDate) {
  return sortRecordsNewestFirst(records)
    .filter((record) => record.date !== currentDate)
    .slice(0, 2);
}

export function currentDateKey(date = new Date()) {
  return todayKey(date);
}

export function createInitialState(currentDate = todayKey()) {
  return {
    settings: {
      workMinutes: 25,
      breakMinutes: 5,
      focusBackground: 'midnight',
      focusClock: 'classic',
    },
    activities: [],
    today: {
      planned: [],
      urgent: [],
    },
    currentDate,
    dailySummary: '',
    records: [],
    selectedTaskId: null,
    logs: [],
  };
}

export function normalizeState(savedState, currentDate = todayKey()) {
  const initial = createInitialState(currentDate);
  const savedCurrentDate = savedState?.currentDate ?? savedState?.date ?? currentDate;
  const draft = {
    ...initial,
    ...savedState,
    currentDate: savedCurrentDate,
    settings: {
      ...initial.settings,
      ...(savedState?.settings ?? {}),
    },
    today: normalizeToday(savedState?.today),
    activities: savedState?.activities ?? [],
    logs: savedState?.logs ?? [],
    dailySummary: savedState?.dailySummary ?? savedState?.summary ?? '',
    records: (savedState?.records ?? savedState?.dailyRecords ?? []).map(normalizeDailyRecord),
  };

  return draft;
}

export function rollToDate(state, currentDate = todayKey()) {
  const draft = normalizeState(state, currentDate);
  if (draft.currentDate === currentDate) {
    draft.records = pruneArchivedRecords(draft.records, currentDate);
    return draft;
  }

  const archivedRecord = dailyRecordFromState(draft);
  const nextRecords = hasDailyContent(archivedRecord)
    ? mergeDailyRecord(draft.records, archivedRecord)
    : draft.records;

  return {
    ...draft,
    currentDate,
    today: emptyToday(),
    selectedTaskId: null,
    logs: [],
    dailySummary: '',
    records: pruneArchivedRecords(nextRecords, currentDate),
  };
}

export function getRecentDailyRecords(state) {
  const draft = normalizeState(state);
  return [
    dailyRecordFromState(draft),
    ...pruneArchivedRecords(draft.records, draft.currentDate),
  ].slice(0, 3);
}

export function updateSettings(state, settings) {
  const draft = cloneState(state);
  draft.settings.workMinutes = Number(settings.workMinutes) || draft.settings.workMinutes;
  draft.settings.breakMinutes = Number(settings.breakMinutes) || draft.settings.breakMinutes;
  draft.settings.focusBackground = settings.focusBackground ?? draft.settings.focusBackground;
  draft.settings.focusClock = settings.focusClock ?? draft.settings.focusClock;
  return draft;
}

export function addActivity(state, text) {
  if (!text.trim()) return state;

  const draft = cloneState(state);
  draft.activities.push(createActivity(text));
  return draft;
}

export function updateActivityText(state, activityId, text) {
  const draft = cloneState(state);
  const activity = draft.activities.find((item) => item.id === activityId);
  if (!activity || !text.trim()) return state;

  activity.text = text.trim();
  return draft;
}

export function deleteActivity(state, activityId) {
  const draft = cloneState(state);
  draft.activities = draft.activities.filter((item) => item.id !== activityId);
  return draft;
}

export function addTodayTask(state, sectionName, text) {
  if (!text.trim()) return state;
  if (!['planned', 'urgent'].includes(sectionName)) return state;

  const draft = cloneState(state);
  const task = createTask(text);
  draft.today[sectionName].push(task);
  const label = sectionName === 'planned' ? '计划区' : '计划外紧急区';
  pushLog(draft, `加入${label}：${task.text}`);
  return draft;
}

export function moveActivityToToday(state, activityId, sectionName = 'planned') {
  if (!['planned', 'urgent'].includes(sectionName)) return state;

  const draft = cloneState(state);
  const activity = draft.activities.find((item) => item.id === activityId);
  if (!activity) return state;

  const task = createTask(activity.text);
  draft.today[sectionName].push(task);
  const label = sectionName === 'planned' ? '今日计划' : '计划外紧急';
  pushLog(draft, `从活动清单加入${label}：${task.text}`);
  return draft;
}

export function updateTaskText(state, taskId, text) {
  const draft = cloneState(state);
  const task = findTask(draft, taskId);
  if (!task || !text.trim()) return state;

  task.text = text.trim();
  pushLog(draft, `编辑任务：${task.text}`);
  return draft;
}

export function deleteTask(state, taskId) {
  const draft = cloneState(state);
  const found = findTaskWithSection(draft, taskId);
  if (!found) return state;

  const [task] = found.section.splice(found.index, 1);
  if (draft.selectedTaskId === taskId) draft.selectedTaskId = null;
  pushLog(draft, `删除任务：${task.text}`);
  return draft;
}

export function selectTask(state, taskId) {
  const draft = cloneState(state);
  const task = findTask(draft, taskId);
  if (!task) return state;

  draft.selectedTaskId = taskId;
  pushLog(draft, `选中当前任务：${task.text}`);
  return draft;
}

export function canStartSelectedTask(state) {
  const task = state.selectedTaskId
    ? allTasks(state).find((item) => item.id === state.selectedTaskId)
    : null;

  return estimateStatus(task);
}

export function addMarker(state, taskId, markerType) {
  if (!MARKER_SYMBOLS[markerType]) return state;

  const draft = cloneState(state);
  const task = findTask(draft, taskId);
  if (!task) return state;

  task.markers.push({
    id: makeId('marker'),
    type: markerType,
    symbol: MARKER_SYMBOLS[markerType],
    checked: false,
  });
  pushLog(draft, `给任务添加${MARKER_SYMBOLS[markerType]}标记：${task.text}`);
  return draft;
}

export function toggleMarker(state, taskId, markerId) {
  const draft = cloneState(state);
  const task = findTask(draft, taskId);
  const marker = task?.markers.find((item) => item.id === markerId);
  if (!task || !marker) return state;

  marker.checked = !marker.checked;
  pushLog(draft, `${marker.checked ? '打叉' : '取消打叉'}标记 ${marker.symbol}：${task.text}`);
  return draft;
}

export function deleteMarker(state, taskId, markerId) {
  const draft = cloneState(state);
  const task = findTask(draft, taskId);
  if (!task) return state;

  const marker = task.markers.find((item) => item.id === markerId);
  if (!marker) return state;

  task.markers = task.markers.filter((item) => item.id !== markerId);
  pushLog(draft, `删除标记 ${marker.symbol}：${task.text}`);
  return draft;
}

export function addInterrupt(state, taskId, interruptType) {
  if (!INTERRUPT_SYMBOLS[interruptType]) return state;

  const draft = cloneState(state);
  const task = findTask(draft, taskId);
  if (!task) return state;

  task.interruptions.push({
    id: makeId('interrupt'),
    type: interruptType,
    symbol: INTERRUPT_SYMBOLS[interruptType],
  });
  pushLog(draft, `${INTERRUPT_LABELS[interruptType]}：${task.text}`);
  return draft;
}

export function deleteInterrupt(state, taskId, interruptId) {
  const draft = cloneState(state);
  const task = findTask(draft, taskId);
  if (!task) return state;

  const interrupt = task.interruptions.find((item) => item.id === interruptId);
  if (!interrupt) return state;

  task.interruptions = task.interruptions.filter((item) => item.id !== interruptId);
  pushLog(draft, `删除${INTERRUPT_LABELS[interrupt.type]}：${task.text}`);
  return draft;
}

export function toggleTaskDone(state, taskId) {
  const draft = cloneState(state);
  const task = findTask(draft, taskId);
  if (!task) return state;

  task.done = !task.done;
  pushLog(draft, `${task.done ? '划掉任务' : '恢复任务'}：${task.text}`);
  return draft;
}

export function completePomodoro(state, phase) {
  const draft = cloneState(state);

  if (phase === 'work') {
    const task = draft.selectedTaskId ? findTask(draft, draft.selectedTaskId) : null;
    if (task) {
      task.pomodoros += 1;
      const marker = firstUncheckedEstimateMarker(task);
      if (marker) marker.checked = true;
      pushLog(draft, `完成 1 个番茄：${task.text}`);
    } else {
      pushLog(draft, '完成 1 个番茄：未选中任务');
    }
  } else {
    pushLog(draft, '休息结束');
  }

  return draft;
}

export function buildTaskReport(state) {
  const tasks = allTasks(state);
  const taskRows = tasks.map((task) => {
    const internalInterruptions = task.interruptions
      .filter((interrupt) => interrupt.type === 'internal').length;
    const externalInterruptions = task.interruptions
      .filter((interrupt) => interrupt.type === 'external').length;

    return {
      taskId: task.id,
      name: task.text,
      done: task.done,
      internalInterruptions,
      externalInterruptions,
      pomodoros: task.pomodoros,
    };
  });

  const varianceRows = tasks
    .filter((task) => task.done)
    .map((task) => {
      const variance = estimateVariance(task);
      return {
        taskId: task.id,
        name: task.text,
        variance,
        varianceLabel: signedNumber(variance),
      };
    });

  const totals = {
    internalInterruptions: taskRows.reduce((sum, row) => sum + row.internalInterruptions, 0),
    externalInterruptions: taskRows.reduce((sum, row) => sum + row.externalInterruptions, 0),
    pomodoros: taskRows.reduce((sum, row) => sum + row.pomodoros, 0),
    variance: varianceRows.reduce((sum, row) => sum + row.variance, 0),
  };

  return {
    taskRows,
    varianceRows,
    totals: {
      ...totals,
      varianceLabel: signedNumber(totals.variance),
    },
  };
}

export function addLog(state, text) {
  if (!text.trim()) return state;

  const draft = cloneState(state);
  draft.logs.push(createLog(text.trim()));
  return draft;
}

export function updateDailySummary(state, date, summary) {
  const draft = cloneState(state);
  if (date === draft.currentDate) {
    draft.dailySummary = summary;
    return draft;
  }

  const record = draft.records.find((item) => item.date === date);
  if (!record) return state;

  record.summary = summary;
  return draft;
}

export function updateLog(state, logId, text) {
  const draft = cloneState(state);
  const log = draft.logs.find((item) => item.id === logId);
  if (!log || !text.trim()) return state;

  log.text = text.trim();
  return draft;
}

export function deleteLog(state, logId) {
  const draft = cloneState(state);
  draft.logs = draft.logs.filter((item) => item.id !== logId);
  return draft;
}
