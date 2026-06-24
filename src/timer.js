export function phaseSeconds(settings, phase) {
  const minutes = phase === 'work'
    ? settings.workMinutes
    : settings.breakMinutes;
  return Math.max(1, Number(minutes)) * 60;
}

export function transitionAfterCompletedPhase(timerState, settings, completedPhase) {
  const nextPhase = completedPhase === 'work' ? 'break' : 'work';

  return {
    ...timerState,
    phase: nextPhase,
    running: completedPhase === 'work',
    remainingSeconds: phaseSeconds(settings, nextPhase),
  };
}
