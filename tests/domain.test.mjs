import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addActivity,
  addInterrupt,
  addLog,
  addMarker,
  addTodayTask,
  buildTaskReport,
  canStartSelectedTask,
  completePomodoro,
  createInitialState,
  deleteInterrupt,
  deleteLog,
  deleteMarker,
  getRecentDailyRecords,
  moveActivityToToday,
  rollToDate,
  selectTask,
  toggleMarker,
  toggleTaskDone,
  updateDailySummary,
  updateLog,
  updateTaskText,
} from '../src/domain.js';

test('creates a usable default state', () => {
  const state = createInitialState();

  assert.equal(state.settings.workMinutes, 25);
  assert.equal(state.settings.breakMinutes, 5);
  assert.deepEqual(state.activities, []);
  assert.deepEqual(state.today.planned, []);
  assert.deepEqual(state.today.urgent, []);
  assert.deepEqual(state.logs, []);
  assert.equal(state.selectedTaskId, null);
});

test('rolls today into a daily record and clears the board on the next date', () => {
  let state = createInitialState('2026-06-23');
  state = addTodayTask(state, 'planned', '写日报');
  state = addTodayTask(state, 'urgent', '临时电话');
  state = addLog(state, '补充一条记录');
  state = updateDailySummary(state, '2026-06-23', '今天节奏不错');
  state = selectTask(state, state.today.planned[0].id);

  state = rollToDate(state, '2026-06-24');

  assert.equal(state.currentDate, '2026-06-24');
  assert.deepEqual(state.today, { planned: [], urgent: [] });
  assert.deepEqual(state.logs, []);
  assert.equal(state.dailySummary, '');
  assert.equal(state.selectedTaskId, null);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].date, '2026-06-23');
  assert.equal(state.records[0].today.planned[0].text, '写日报');
  assert.equal(state.records[0].today.urgent[0].text, '临时电话');
  assert.equal(state.records[0].summary, '今天节奏不错');
});

test('keeps recent daily records to today and the two previous archived days', () => {
  let state = createInitialState('2026-06-21');
  state = addTodayTask(state, 'planned', '第一天');
  state = rollToDate(state, '2026-06-22');
  state = addTodayTask(state, 'planned', '第二天');
  state = rollToDate(state, '2026-06-23');
  state = addTodayTask(state, 'planned', '第三天');
  state = rollToDate(state, '2026-06-24');

  const records = getRecentDailyRecords(state);

  assert.deepEqual(records.map((record) => record.date), [
    '2026-06-24',
    '2026-06-23',
    '2026-06-22',
  ]);
  assert.equal(state.records.length, 2);
});

test('updates daily summaries for today and archived records', () => {
  let state = createInitialState('2026-06-23');
  state = updateDailySummary(state, '2026-06-23', '今日总结');
  state = rollToDate(state, '2026-06-24');
  state = updateDailySummary(state, '2026-06-24', '新的一天');
  state = updateDailySummary(state, '2026-06-23', '归档后补写');

  assert.equal(state.dailySummary, '新的一天');
  assert.equal(state.records[0].summary, '归档后补写');
});

test('copies an activity item into today sections while keeping the activity list', () => {
  let state = createInitialState();
  state = addActivity(state, '整理项目思路');
  const activityId = state.activities[0].id;

  state = moveActivityToToday(state, activityId, 'planned');

  assert.equal(state.activities.length, 1);
  assert.equal(state.activities[0].id, activityId);
  assert.equal(state.activities[0].text, '整理项目思路');
  assert.equal(state.today.planned.length, 1);
  assert.equal(state.today.planned[0].text, '整理项目思路');
  assert.match(state.logs.at(-1).text, /加入今日计划/);

  state = moveActivityToToday(state, activityId, 'urgent');

  assert.equal(state.activities.length, 1);
  assert.equal(state.today.urgent.length, 1);
  assert.equal(state.today.urgent[0].text, '整理项目思路');
  assert.match(state.logs.at(-1).text, /加入计划外紧急/);
});

test('adds urgent unplanned task and selects it as current task', () => {
  let state = createInitialState();
  state = addTodayTask(state, 'urgent', '紧急处理电话');
  const taskId = state.today.urgent[0].id;

  state = selectTask(state, taskId);

  assert.equal(state.selectedTaskId, taskId);
  assert.match(state.logs.at(-1).text, /选中当前任务/);
});

test('edits task text, adds markers, toggles a marker, and logs marker changes', () => {
  let state = createInitialState();
  state = addTodayTask(state, 'planned', '写初稿');
  const taskId = state.today.planned[0].id;

  state = updateTaskText(state, taskId, '写番茄钟初稿');
  state = addMarker(state, taskId, 'square');
  state = addMarker(state, taskId, 'circle');
  const firstMarkerId = state.today.planned[0].markers[0].id;
  state = toggleMarker(state, taskId, firstMarkerId);

  assert.equal(state.today.planned[0].text, '写番茄钟初稿');
  assert.equal(state.today.planned[0].markers.length, 2);
  assert.equal(state.today.planned[0].markers[0].checked, true);
  assert.match(state.logs.at(-1).text, /标记/);
});

test('deletes a marker from a task and logs the removal', () => {
  let state = createInitialState();
  state = addTodayTask(state, 'planned', '整理标记');
  const taskId = state.today.planned[0].id;

  state = addMarker(state, taskId, 'square');
  state = addMarker(state, taskId, 'triangle');
  const markerId = state.today.planned[0].markers[0].id;
  state = deleteMarker(state, taskId, markerId);

  assert.equal(state.today.planned[0].markers.length, 1);
  assert.equal(state.today.planned[0].markers[0].type, 'triangle');
  assert.match(state.logs.at(-1).text, /删除标记/);
});

test('requires an open estimate marker before starting a selected task', () => {
  let state = createInitialState();
  state = addTodayTask(state, 'planned', 'Estimate required');
  const taskId = state.today.planned[0].id;
  state = selectTask(state, taskId);

  assert.equal(canStartSelectedTask(state).ok, false);
  assert.equal(canStartSelectedTask(state).neededType, 'square');

  state = addMarker(state, taskId, 'circle');
  assert.equal(canStartSelectedTask(state).ok, false);
  assert.equal(canStartSelectedTask(state).neededType, 'square');

  state = addMarker(state, taskId, 'square');
  assert.equal(canStartSelectedTask(state).ok, true);
});

test('completing pomodoros fills estimates in square circle triangle order', () => {
  let state = createInitialState();
  state = addTodayTask(state, 'planned', 'Use estimates');
  const taskId = state.today.planned[0].id;
  state = selectTask(state, taskId);
  state = addMarker(state, taskId, 'square');

  state = completePomodoro(state, 'work');
  assert.equal(state.today.planned[0].markers[0].checked, true);
  assert.equal(canStartSelectedTask(state).ok, false);
  assert.equal(canStartSelectedTask(state).neededType, 'circle');

  state = addMarker(state, taskId, 'circle');
  state = completePomodoro(state, 'work');
  assert.equal(state.today.planned[0].markers[1].checked, true);
  assert.equal(canStartSelectedTask(state).neededType, 'triangle');

  state = addMarker(state, taskId, 'triangle');
  state = completePomodoro(state, 'work');
  assert.equal(state.today.planned[0].markers[2].checked, true);
});

test('builds task report with interruptions, pomodoros, variance, and totals', () => {
  let state = createInitialState();
  state = addTodayTask(state, 'planned', 'Under estimate');
  state = addTodayTask(state, 'planned', 'Over estimate');
  const underId = state.today.planned[0].id;
  const overId = state.today.planned[1].id;

  state = addMarker(state, underId, 'square');
  state = addMarker(state, underId, 'circle');
  state = selectTask(state, underId);
  state = completePomodoro(state, 'work');
  state = completePomodoro(state, 'work');
  state = addInterrupt(state, underId, 'internal');
  state = addInterrupt(state, underId, 'external');
  state = toggleTaskDone(state, underId);

  state = addMarker(state, overId, 'square');
  state = addMarker(state, overId, 'square');
  state = addMarker(state, overId, 'square');
  state = selectTask(state, overId);
  state = completePomodoro(state, 'work');
  state = completePomodoro(state, 'work');
  state = toggleTaskDone(state, overId);

  const report = buildTaskReport(state);

  assert.deepEqual(report.taskRows.map((row) => ({
    name: row.name,
    internalInterruptions: row.internalInterruptions,
    externalInterruptions: row.externalInterruptions,
    pomodoros: row.pomodoros,
  })), [
    { name: 'Under estimate', internalInterruptions: 1, externalInterruptions: 1, pomodoros: 2 },
    { name: 'Over estimate', internalInterruptions: 0, externalInterruptions: 0, pomodoros: 2 },
  ]);
  assert.deepEqual(report.varianceRows.map((row) => [row.name, row.varianceLabel]), [
    ['Under estimate', '-1'],
    ['Over estimate', '+1'],
  ]);
  assert.equal(report.totals.internalInterruptions, 1);
  assert.equal(report.totals.externalInterruptions, 1);
  assert.equal(report.totals.pomodoros, 4);
  assert.equal(report.totals.variance, 0);
});

test('adds internal and external interruptions', () => {
  let state = createInitialState();
  state = addTodayTask(state, 'planned', '深度工作');
  const taskId = state.today.planned[0].id;

  state = addInterrupt(state, taskId, 'internal');
  state = addInterrupt(state, taskId, 'external');

  assert.deepEqual(state.today.planned[0].interruptions.map(({ type, symbol }) => ({ type, symbol })), [
    { type: 'internal', symbol: "'" },
    { type: 'external', symbol: '-' },
  ]);
  assert.ok(state.today.planned[0].interruptions[0].id);
  assert.match(state.logs.at(-1).text, /外部打断/);
});

test('deletes one interruption from a task and updates report counts', () => {
  let state = createInitialState();
  state = addTodayTask(state, 'planned', 'Undo interruption');
  const taskId = state.today.planned[0].id;

  state = addInterrupt(state, taskId, 'internal');
  state = addInterrupt(state, taskId, 'internal');
  state = addInterrupt(state, taskId, 'external');
  const firstInternalId = state.today.planned[0].interruptions[0].id;
  const externalId = state.today.planned[0].interruptions[2].id;

  state = deleteInterrupt(state, taskId, firstInternalId);
  state = deleteInterrupt(state, taskId, externalId);
  const report = buildTaskReport(state);

  assert.deepEqual(state.today.planned[0].interruptions.map((interrupt) => interrupt.type), ['internal']);
  assert.equal(report.taskRows[0].internalInterruptions, 1);
  assert.equal(report.taskRows[0].externalInterruptions, 0);
});

test('strikes through a task and records completed pomodoro against selected task', () => {
  let state = createInitialState();
  state = addTodayTask(state, 'planned', '完成版本');
  const taskId = state.today.planned[0].id;

  state = selectTask(state, taskId);
  state = completePomodoro(state, 'work');
  state = toggleTaskDone(state, taskId);

  assert.equal(state.today.planned[0].pomodoros, 1);
  assert.equal(state.today.planned[0].done, true);
  assert.match(state.logs.at(-2).text, /完成 1 个番茄/);
  assert.match(state.logs.at(-1).text, /划掉任务/);
});

test('supports manual log editing and deleting', () => {
  let state = createInitialState();
  state = addLog(state, '手动补充记录');
  const logId = state.logs[0].id;

  state = updateLog(state, logId, '修改后的记录');
  assert.equal(state.logs[0].text, '修改后的记录');

  state = deleteLog(state, logId);
  assert.deepEqual(state.logs, []);
});
