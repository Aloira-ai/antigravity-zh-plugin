import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCdpHost } from '../../lib/cdp-host.mjs';
import { BUILTIN_PAIRS, mergeDictionaryPairs } from '../../lib/dictionary.mjs';
import { createDebugShortcutCommand, manualLaunchCommand } from '../../lib/paths.mjs';
import { createSettingsStore } from '../../lib/settings.mjs';
import { startWebUi } from '../../lib/web-ui.mjs';

const entryPath = resolve(fileURLToPath(import.meta.url));
const argPath = process.argv[1] ? resolve(process.argv[1]) : '';
const isMain = Boolean(argPath) && (process.platform === 'win32'
  ? entryPath.toLowerCase() === argPath.toLowerCase()
  : entryPath === argPath);

if (isMain) {
  const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  const settings = createSettingsStore();

  let customPairs = settings.loadCustomDictionary();
  let mergedPairs = mergeDictionaryPairs(customPairs);

  const getPairs = () => mergedPairs;

  const cdpHost = startCdpHost({
    version,
    settings,
    getPairs
  });

  const getSnapshot = () => ({
    settings: settings.get(),
    cdp: cdpHost.status(),
    dictionary: {
      builtinCount: BUILTIN_PAIRS.length,
      customCount: customPairs.length,
      totalCount: mergedPairs.length,
      customPath: settings.customDictionaryPath,
      customEntries: customPairs.slice(0, 200)
    },
    launchCommand: manualLaunchCommand(),
    shortcutCommand: createDebugShortcutCommand()
  });

  const closeWebUi = await startWebUi({
    version,
    getStatus: getSnapshot,
    onSetSettings: async patch => {
      const next = settings.set(patch);
      await cdpHost.applySettings(next);
      return getSnapshot();
    },
    onReloadDictionary: async () => {
      customPairs = settings.loadCustomDictionary();
      mergedPairs = mergeDictionaryPairs(customPairs);
      await cdpHost.reloadDictionary();
      return getSnapshot();
    },
    onUpsertCustomEntry: async ({ en, zh }) => {
      customPairs = settings.setCustomEntry(en, zh);
      mergedPairs = mergeDictionaryPairs(customPairs);
      await cdpHost.reloadDictionary();
      return getSnapshot();
    },
    onDeleteCustomEntry: async ({ en }) => {
      customPairs = settings.removeCustomEntry(en);
      mergedPairs = mergeDictionaryPairs(customPairs);
      await cdpHost.reloadDictionary();
      return getSnapshot();
    }
  }).catch(() => async () => {});

  const shutdown = async () => {
    await cdpHost.stop();
    await closeWebUi();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
