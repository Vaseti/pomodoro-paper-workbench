import test from 'node:test';
import assert from 'node:assert/strict';

import {
  phaseSeconds,
  transitionAfterCompletedPhase,
} from '../src/timer.js';

test('calculates phase seconds from minute settings', () => {
  assert.equal(phaseSeconds({ workMinutes: 25, breakMinutes: 5 }, 'work'), 1500);
  assert.equal(phaseSeconds({ workMinutes: 25, breakMinutes: 5 }, 'break'), 300);
});

test('continues into break after a work phase finishes', () => {
  const nextTimer = transitionAfterCompletedPhase(
    { phase: 'work', running: true },
    { workMinutes: 25, breakMinutes: 5 },
    'work',
  );

  assert.equal(nextTimer.phase, 'break');
  assert.equal(nextTimer.running, true);
  assert.equal(nextTimer.remainingSeconds, 300);
});

test('stops and waits for the user after a full work and break cycle', () => {
  const nextTimer = transitionAfterCompletedPhase(
    { phase: 'break', running: true },
    { workMinutes: 25, breakMinutes: 5 },
    'break',
  );

  assert.equal(nextTimer.phase, 'work');
  assert.equal(nextTimer.running, false);
  assert.equal(nextTimer.remainingSeconds, 1500);
});
