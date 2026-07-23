import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskReport,
  createInitialState,
  getRecentDailyRecords,
  normalizeState,
  rollToDate,
} from '../src/domain.js';
import {
  EXPORT_SCHEMA_VERSION, MAX_IMPORT_BYTES, createExportDocument,
  parseStateImport, serializeStateExport,
} from '../src/state-transfer.js';

test('creates a versioned export document', () => {
  const state = createInitialState('2026-07-23');
  const document = createExportDocument(state, '2026-07-23T10:00:00.000Z');
  assert.equal(document.schemaVersion, EXPORT_SCHEMA_VERSION);
  assert.equal(document.exportedAt, '2026-07-23T10:00:00.000Z');
  assert.deepEqual(document.state, state);
});

test('serializes and parses a normalized state', () => {
  const state = createInitialState('2026-07-23');
  state.settings.workMinutes = 45;
  const parsed = parseStateImport(
    serializeStateExport(state, '2026-07-23T10:00:00.000Z'), '2026-07-23');
  assert.equal(parsed.settings.workMinutes, 45);
  assert.deepEqual(parsed.today, { planned: [], urgent: [] });
});

test('rejects invalid JSON', () => {
  assert.throws(() => parseStateImport('{broken'), /JSON/);
});

test('rejects unsupported schema versions', () => {
  assert.throws(() => parseStateImport(JSON.stringify({ schemaVersion: 99, state: {} })), /schema version/i);
});

test('rejects documents without an object state', () => {
  assert.throws(() => parseStateImport(JSON.stringify({ schemaVersion: 1, state: [] })), /state/i);
});

test('rejects oversized imports', () => {
  assert.throws(() => parseStateImport('x'.repeat(MAX_IMPORT_BYTES + 1)), /too large/i);
});

for (const setting of ['workMinutes', 'breakMinutes']) {
  for (const value of [0, 181, 1e308]) {
    test(`rejects imported ${setting} value ${value} outside 1 to 180`, () => {
      const text = JSON.stringify({
        schemaVersion: EXPORT_SCHEMA_VERSION,
        state: { settings: { [setting]: value } },
      });
      assert.throws(
        () => parseStateImport(text, '2026-07-23'),
        /between 1 and 180/i,
      );
    });
  }
}

test('rejects malformed imported collections and nested items', () => {
  const malformedStates = [
    { activities: {} },
    { activities: [null] },
    { settings: [] },
    { settings: { workMinutes: {} } },
    { today: [] },
    { today: { planned: {} } },
    { today: { planned: [null] } },
    { today: { planned: [{ markers: {} }] } },
    { today: { planned: [{ markers: [null] }] } },
    { today: { urgent: [{ interruptions: {} }] } },
    { today: { urgent: [{ interruptions: [null] }] } },
    { logs: {} },
    { logs: [null] },
    { records: {} },
    { records: [null] },
    { records: [{ today: [] }] },
    { records: [{ today: { urgent: {} } }] },
    { records: [{ logs: {} }] },
  ];

  for (const state of malformedStates) {
    const text = JSON.stringify({ schemaVersion: EXPORT_SCHEMA_VERSION, state });
    assert.throws(() => parseStateImport(text, '2026-07-23'), /invalid state/i);
  }
});

test('defensively normalizes malformed local nested collections', () => {
  const normalized = normalizeState({
    activities: {},
    today: { planned: {}, urgent: [null, { text: 'safe', markers: {}, interruptions: [null] }] },
    logs: {},
    records: [{ date: '2026-07-22', today: [], logs: {} }, null],
  }, '2026-07-23');

  assert.deepEqual(normalized.activities, []);
  assert.deepEqual(normalized.today.planned, []);
  assert.equal(normalized.today.urgent.length, 1);
  assert.deepEqual(normalized.today.urgent[0].markers, []);
  assert.deepEqual(normalized.today.urgent[0].interruptions, []);
  assert.deepEqual(normalized.logs, []);
  assert.equal(normalized.records.length, 1);
  assert.deepEqual(normalized.records[0].today, { planned: [], urgent: [] });
  assert.deepEqual(normalized.records[0].logs, []);
});

test('defensively normalizes malformed scalar fields used by timer and rendering', () => {
  const normalized = normalizeState({
    settings: {
      workMinutes: {},
      breakMinutes: [],
      focusBackground: {},
      focusClock: [],
    },
    today: {
      planned: [{
        text: {},
        markers: [{ id: {}, type: {}, symbol: {} }],
        interruptions: [{ id: [], type: {}, symbol: [] }],
      }],
    },
  }, '2026-07-23');

  assert.equal(normalized.settings.workMinutes, 25);
  assert.equal(normalized.settings.breakMinutes, 5);
  assert.equal(normalized.settings.focusBackground, 'midnight');
  assert.equal(normalized.settings.focusClock, 'classic');
  assert.equal(normalized.today.planned[0].text, '');
  for (const item of [
    normalized.today.planned[0].markers[0],
    normalized.today.planned[0].interruptions[0],
  ]) {
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.type, 'string');
    assert.equal(typeof item.symbol, 'string');
  }
});

test('normalizes a valid legacy import for safe domain consumption', () => {
  const parsed = parseStateImport(JSON.stringify({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    state: {
      date: '2026-07-23',
      summary: 'legacy summary',
      today: { planned: [{ text: 'legacy task' }] },
      dailyRecords: [{ date: '2026-07-22', today: {}, logs: [], summary: 'older' }],
    },
  }), '2026-07-23');

  assert.doesNotThrow(() => buildTaskReport(parsed));
  assert.doesNotThrow(() => getRecentDailyRecords(parsed));
  assert.doesNotThrow(() => rollToDate(parsed, '2026-07-24'));
  assert.equal(parsed.today.planned[0].text, 'legacy task');
  assert.deepEqual(parsed.today.planned[0].markers, []);
  assert.deepEqual(parsed.today.planned[0].interruptions, []);
});
