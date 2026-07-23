import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('declares and wires all data transfer controls', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
  ]);
  for (const id of ['export-data', 'import-data', 'undo-import', 'import-file', 'data-message']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(app, /serializeStateExport/);
  assert.match(app, /parseStateImport/);
  assert.match(app, /refs\.exportData\.addEventListener/);
  assert.match(app, /refs\.importFile\.addEventListener/);
  assert.match(app, /refs\.undoImport\.addEventListener/);
});

test('persists normalized state before replacing in-memory state', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

  assert.match(app, /function commit\(nextState\) \{\s*const committedState = rollToDate\(normalizeState\(nextState\)\);\s*saveState\(committedState\);\s*state = committedState;\s*render\(\);\s*\}/);
});

test('publishes the import snapshot only after commit succeeds', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

  assert.match(
    app,
    /const importSnapshot = structuredClone\(state\);\s*commit\(nextState\);[\s\S]*?preImportState = importSnapshot;/,
  );
});

test('synchronizes timer and focus runtime after import and undo commits', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const helper = app.match(
    /function synchronizeRuntimeAfterStateReplacement\(\) \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(helper, 'state replacement runtime helper must exist');
  const orderedCalls = [
    'pauseTimer();',
    "timer.phase = 'work';",
    "resetRemainingForPhase('work');",
    'resetFocusSession(null);',
    'exitFocusMode();',
    'renderTimer();',
  ];
  let previousIndex = -1;
  for (const call of orderedCalls) {
    const index = helper.indexOf(call);
    assert.ok(index > previousIndex, `${call} must appear in integration order`);
    previousIndex = index;
  }

  assert.match(
    app,
    /commit\(nextState\);\s*synchronizeRuntimeAfterStateReplacement\(\);\s*preImportState = importSnapshot;/,
  );
  assert.match(
    app,
    /commit\(preImportState\);\s*synchronizeRuntimeAfterStateReplacement\(\);\s*preImportState = null;/,
  );
});
