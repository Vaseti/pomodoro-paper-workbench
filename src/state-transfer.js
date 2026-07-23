import {
  MAX_TIMER_MINUTES,
  MIN_TIMER_MINUTES,
  normalizeState,
} from './domain.js';

export const EXPORT_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function createExportDocument(state, exportedAt = new Date().toISOString()) {
  return { schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt, state };
}

export function serializeStateExport(state, exportedAt) {
  return JSON.stringify(createExportDocument(state, exportedAt), null, 2);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptionalObject(owner, key, path, validate) {
  if (!Object.hasOwn(owner, key)) return;
  const value = owner[key];
  if (!isObject(value)) throw new Error(`Invalid state: ${path} must be an object.`);
  validate?.(value, path);
}

function assertOptionalObjectArray(owner, key, path, validateItem) {
  if (!Object.hasOwn(owner, key)) return;
  const value = owner[key];
  if (!Array.isArray(value)) throw new Error(`Invalid state: ${path} must be an array.`);
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isObject(item)) throw new Error(`Invalid state: ${itemPath} must be an object.`);
    validateItem?.(item, itemPath);
  });
}

function assertOptionalTimerMinutes(owner, key, path) {
  if (!Object.hasOwn(owner, key)) return;
  const value = owner[key];
  const number = Number(value);
  const inRange = Number.isFinite(number)
    && number >= MIN_TIMER_MINUTES
    && number <= MAX_TIMER_MINUTES;
  if (!['number', 'string'].includes(typeof value) || !inRange) {
    throw new Error(
      `Invalid state: ${path} must be between ${MIN_TIMER_MINUTES} and ${MAX_TIMER_MINUTES}.`,
    );
  }
}

function validateSettings(settings, path) {
  assertOptionalTimerMinutes(settings, 'workMinutes', `${path}.workMinutes`);
  assertOptionalTimerMinutes(settings, 'breakMinutes', `${path}.breakMinutes`);
}

function validateTask(task, path) {
  assertOptionalObjectArray(task, 'markers', `${path}.markers`);
  assertOptionalObjectArray(task, 'interruptions', `${path}.interruptions`);
}

function validateToday(today, path) {
  assertOptionalObjectArray(today, 'planned', `${path}.planned`, validateTask);
  assertOptionalObjectArray(today, 'urgent', `${path}.urgent`, validateTask);
}

function validateDailyRecord(record, path) {
  assertOptionalObject(record, 'today', `${path}.today`, validateToday);
  assertOptionalObjectArray(record, 'logs', `${path}.logs`);
}

function validateImportState(state) {
  assertOptionalObject(state, 'settings', 'settings', validateSettings);
  assertOptionalObjectArray(state, 'activities', 'activities');
  assertOptionalObject(state, 'today', 'today', validateToday);
  assertOptionalObjectArray(state, 'logs', 'logs');
  assertOptionalObjectArray(state, 'records', 'records', validateDailyRecord);
  assertOptionalObjectArray(state, 'dailyRecords', 'dailyRecords', validateDailyRecord);
}

export function parseStateImport(text, currentDate) {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Import file is too large.');
  }
  let document;
  try { document = JSON.parse(text); }
  catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Import document must be an object.');
  }
  if (document.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${document.schemaVersion}`);
  }
  if (!document.state || typeof document.state !== 'object' || Array.isArray(document.state)) {
    throw new Error('Import document must contain an object state.');
  }
  validateImportState(document.state);
  return normalizeState(document.state, currentDate);
}
