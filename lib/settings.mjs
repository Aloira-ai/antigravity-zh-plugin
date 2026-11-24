import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginDataDir } from './paths.mjs';

export const ALLOWED_LANGUAGES = Object.freeze(['zh-CN', 'en']);

export const DEFAULT_SETTINGS = Object.freeze({
  language: 'zh-CN',
  floatingButton: false
});

const MAX_CUSTOM_ENTRIES = 5000;

function isValidSetting(key, value) {
  if (key === 'language') return ALLOWED_LANGUAGES.includes(value);
  if (key === 'floatingButton') return typeof value === 'boolean';
  return false;
}

/**
 * Normalize raw settings object into a safe, validated settings snapshot.
 */
export function normalizeSettings(raw = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    language: isValidSetting('language', src.language) ? src.language : DEFAULT_SETTINGS.language,
    floatingButton: isValidSetting('floatingButton', src.floatingButton)
      ? src.floatingButton
      : DEFAULT_SETTINGS.floatingButton
  };
}

function writeAtomicJson(targetPath, value) {
  const dir = join(targetPath, '..');
  mkdirSync(dir, { recursive: true });
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, targetPath);
  } finally {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {}
  }
}

/**
 * Parse a custom dictionary JSON file (plain object mapping English -> Chinese).
 */
export function parseCustomDictionary(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }
  const pairs = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (pairs.length >= MAX_CUSTOM_ENTRIES) break;
    if (typeof key !== 'string' || typeof value !== 'string') continue;
    const cleanKey = key.trim();
    const cleanVal = value.trim();
    if (!cleanKey || !cleanVal) continue;
    pairs.push([cleanKey, cleanVal]);
  }
  return pairs;
}

/**
 * Create a persistent settings & custom dictionary store under the plugin data dir.
 */
export function createSettingsStore(directory = pluginDataDir()) {
  const settingsPath = join(directory, 'settings.json');
  const customDictionaryPath = join(directory, 'custom-dictionary.json');

  return {
    directory,
    settingsPath,
    customDictionaryPath,

    get() {
      try {
        if (!existsSync(settingsPath)) return { ...DEFAULT_SETTINGS };
        return normalizeSettings(JSON.parse(readFileSync(settingsPath, 'utf8')));
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },

    set(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('设置格式无效');
      }
      const entries = Object.entries(patch);
      for (const [key, value] of entries) {
        if (!Object.hasOwn(DEFAULT_SETTINGS, key) || !isValidSetting(key, value)) {
          throw new Error(`无效的设置项: ${key}`);
        }
      }
      const next = normalizeSettings({ ...this.get(), ...patch });
      writeAtomicJson(settingsPath, next);
      return next;
    },

    loadCustomDictionary() {
      try {
        if (!existsSync(customDictionaryPath)) return [];
        return parseCustomDictionary(readFileSync(customDictionaryPath, 'utf8'));
      } catch {
        return [];
      }
    }
  };
}
