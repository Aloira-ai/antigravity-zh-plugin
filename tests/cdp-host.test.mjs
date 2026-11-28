import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { isHubTarget, isSwarmTarget, startCdpHost } from '../lib/cdp-host.mjs';
import { BUILTIN_PAIRS } from '../lib/dictionary.mjs';
import { createSettingsStore } from '../lib/settings.mjs';
import { installI18nPlugin } from '../scripts/install.mjs';
import { uninstallI18nPlugin } from '../scripts/uninstall.mjs';

function createMockCdpClient(id, { frameId = 'frame-main', isHub = true } = {}) {
  const calls = [];
  const listeners = new Set();
  const socketListeners = new Map();
  let closed = false;
  let scriptSeq = 0;

  return {
    id,
    calls,
    get closed() {
      return closed;
    },
    socket: {
      addEventListener(type, fn) {
        if (!socketListeners.has(type)) socketListeners.set(type, new Set());
        socketListeners.get(type).add(fn);
      }
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emitEvent(event) {
      for (const fn of listeners) fn(event);
    },
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        if (String(params.expression || '').includes('navigator.userAgent')) {
          return { result: { value: isHub } };
        }
        if (String(params.expression || '').includes('!globalThis.__agyI18n')) {
          return { result: { value: false } };
        }
        if (String(params.expression || '').includes('ready:')) {
          return { result: { value: { ready: true, lang: 'zh-CN' } } };
        }
        return { result: { value: undefined } };
      }
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: frameId } } };
      }
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        return { identifier: `script-${++scriptSeq}` };
      }
      return {};
    },
    close() {
      closed = true;
    }
  };
}

test('target matchers identify hub pages and swarm iframes accurately', () => {
  assert.equal(isHubTarget({ type: 'page', url: 'https://127.0.0.1:443/c/abc123', title: 'Antigravity' }), true);
  assert.equal(isHubTarget({ type: 'page', url: 'https://localhost:8443/customizations', title: 'Custom' }), true);
  assert.equal(isHubTarget({ type: 'page', url: 'https://127.0.0.1:8443/settings-standalone', title: 'Settings' }), true);
  assert.equal(isHubTarget({ type: 'page', url: 'https://127.0.0.1:8443/sidecars/triggers/t1', title: 'Triggers' }), true);
  assert.equal(isHubTarget({ type: 'page', url: 'https://127.0.0.1:8443/feeds', title: 'Feeds' }), true);
  assert.equal(isHubTarget({ type: 'page', url: 'https://127.0.0.1:8443/forked/a/b', title: 'Forked' }), true);
  assert.equal(isHubTarget({ type: 'page', url: 'http://127.0.0.1:8443/settings-standalone', title: 'Settings' }), false);
  assert.equal(isHubTarget({ type: 'page', url: 'https://example.com/settings', title: 'Settings' }), false);
  assert.equal(isHubTarget({ type: 'page', url: 'http://127.0.0.1:3000/', title: 'Other' }), false);
  assert.equal(isHubTarget({ type: 'page', url: 'https://example.com/', title: 'Antigravity' }), false);
  assert.equal(isSwarmTarget({ type: 'iframe', url: 'plugin://swarm--swarm_board-1/index.html' }), true);
  assert.equal(isSwarmTarget({ type: 'page', url: 'plugin://swarm--swarm_board-1/index.html' }), false);
});

test('CDP host attaches to hub/swarm targets, handles trusted binding toggles, and disposes cleanly', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agy-i18n-cdp-'));
  try {
    const portFile = join(tempDir, 'DevToolsActivePort');
    writeFileSync(portFile, '45678\n/devtools/browser/test\n', 'utf8');

    const settings = createSettingsStore(join(tempDir, 'data'));
    const hubTarget = {
      id: 'hub-1',
      type: 'page',
      url: 'https://127.0.0.1:9443/c/conv-1',
      title: 'Antigravity',
      webSocketDebuggerUrl: 'ws://127.0.0.1:45678/devtools/page/hub-1'
    };
    const swarmTarget = {
      id: 'swarm-1',
      type: 'iframe',
      url: 'plugin://swarm--swarm_board-abc/index.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:45678/devtools/page/swarm-1'
    };

    const mockClients = new Map([
      [hubTarget.webSocketDebuggerUrl, createMockCdpClient('hub-1', { frameId: 'main-frame-1', isHub: true })],
      [swarmTarget.webSocketDebuggerUrl, createMockCdpClient('swarm-1')]
    ]);

    const host = startCdpHost({
      version: '1.0.0',
      settings,
      getPairs: () => BUILTIN_PAIRS.slice(0, 10),
      portFile,
      pollIntervalMs: 0,
      connect: async url => mockClients.get(url),
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => [hubTarget, swarmTarget]
      })
    });

    await host.ready;
    const status = host.status();
    assert.equal(status.connected, true);
    assert.equal(status.debugPortReached, true);
    assert.equal(status.hubCount, 1);
    assert.equal(status.swarmCount, 1);

    const hubClient = mockClients.get(hubTarget.webSocketDebuggerUrl);
    const swarmClient = mockClients.get(swarmTarget.webSocketDebuggerUrl);

    assert.ok(hubClient.calls.some(c => c.method === 'Runtime.addBinding' && c.params.name === '__agyI18nHost'));
    assert.ok(hubClient.calls.some(c => c.method === 'Page.addScriptToEvaluateOnNewDocument'));
    assert.ok(swarmClient.calls.some(c => c.method === 'Page.addScriptToEvaluateOnNewDocument'));

    // Register main-frame default context vs untrusted context
    hubClient.emitEvent({
      method: 'Runtime.executionContextCreated',
      params: {
        context: {
          id: 101,
          origin: 'https://127.0.0.1:9443',
          auxData: { isDefault: true, frameId: 'main-frame-1' }
        }
      }
    });
    hubClient.emitEvent({
      method: 'Runtime.executionContextCreated',
      params: {
        context: {
          id: 202,
          origin: 'https://untrusted.example',
          auxData: { isDefault: true, frameId: 'subframe-9' }
        }
      }
    });

    // Untrusted context call must be ignored
    hubClient.emitEvent({
      method: 'Runtime.bindingCalled',
      params: {
        name: '__agyI18nHost',
        executionContextId: 202,
        payload: JSON.stringify({ type: 'setLanguage', language: 'en' })
      }
    });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(settings.get().language, 'zh-CN');

    // Trusted context call updates settings & broadcasts to both hub and swarm
    hubClient.emitEvent({
      method: 'Runtime.bindingCalled',
      params: {
        name: '__agyI18nHost',
        executionContextId: 101,
        payload: JSON.stringify({ type: 'setLanguage', language: 'en' })
      }
    });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(settings.get().language, 'en');
    assert.ok(hubClient.calls.some(c => c.method === 'Runtime.evaluate' && String(c.params.expression).includes('apply("en", false)')));
    assert.ok(swarmClient.calls.some(c => c.method === 'Runtime.evaluate' && String(c.params.expression).includes('apply("en", false)')));

    // Explicit settings push & dictionary reload
    await host.applySettings({ language: 'zh-CN', floatingButton: true });
    assert.ok(hubClient.calls.some(c => c.method === 'Runtime.evaluate' && String(c.params.expression).includes('apply("zh-CN", true)')));
    await host.reloadDictionary();
    assert.ok(hubClient.calls.some(c => c.method === 'Runtime.evaluate' && String(c.params.expression).includes('updatePairs(')));

    await host.stop();
    assert.equal(hubClient.closed, true);
    assert.equal(swarmClient.closed, true);
    assert.ok(hubClient.calls.some(c => c.method === 'Page.removeScriptToEvaluateOnNewDocument'));
    assert.ok(hubClient.calls.some(c => c.method === 'Runtime.evaluate' && c.params.expression === 'globalThis.__agyI18n?.dispose()'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('install and uninstall manage plugin files safely without touching config.json', async () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'agy-zh-home-'));
  try {
    const installed = await installI18nPlugin({ home: tempHome });
    assert.equal(installed.name, 'agy-zh');
    assert.equal(installed.replacement, 'directory');
    assert.ok(existsSync(join(installed.destination, 'plugin.json')));
    assert.ok(existsSync(join(installed.destination, 'sidecars', 'i18n', 'sidecar.json')));
    assert.ok(existsSync(join(installed.destination, 'sidecars', 'i18n', 'main.mjs')));
    assert.ok(existsSync(join(installed.destination, 'lib', 'community-pairs.json')));
    assert.ok(existsSync(join(installed.destination, 'lib', 'dictionary.mjs')));
    assert.ok(existsSync(join(installed.destination, 'lib', 'i18n-client.js')));
    assert.ok(existsSync(join(installed.destination, 'skills', 'agy-zh', 'SKILL.md')));

    const configPath = join(tempHome, '.gemini', 'config', 'config.json');
    assert.equal(existsSync(configPath), false, 'installer must never create or modify config.json');

    // Create plugin_data to verify --purge behavior
    const dataDir = join(tempHome, '.gemini', 'antigravity', 'plugin_data', 'agy-zh');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'settings.json'), '{"language":"en"}\n', 'utf8');

    const resKeep = uninstallI18nPlugin({ home: tempHome, purge: false });
    assert.equal(resKeep.removedPlugin, true);
    assert.equal(resKeep.purgedData, false);
    assert.equal(existsSync(installed.destination), false);
    assert.equal(existsSync(dataDir), true);

    // Protect unrelated plugin directories
    mkdirSync(installed.destination, { recursive: true });
    writeFileSync(join(installed.destination, 'plugin.json'), '{"name":"other-plugin"}', 'utf8');
    await assert.rejects(() => installI18nPlugin({ home: tempHome }), /其他插件/);
    assert.throws(() => uninstallI18nPlugin({ home: tempHome, purge: true }), /不属于 agy-zh/);

    // Clean up unrelated test folder and verify purge
    rmSync(installed.destination, { recursive: true, force: true });
    await installI18nPlugin({ home: tempHome });
    const resPurge = uninstallI18nPlugin({ home: tempHome, purge: true });
    assert.equal(resPurge.removedPlugin, true);
    assert.equal(resPurge.purgedData, true);
    assert.equal(existsSync(dataDir), false);
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('install falls back to in-place sync on EPERM directory lock and prunes stale files', async () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'agy-zh-eperm-'));
  try {
    const first = await installI18nPlugin({ home: tempHome });
    const staleFile = join(first.destination, 'stale.txt');
    const staleDir = join(first.destination, 'stale-dir');
    writeFileSync(staleFile, 'old', 'utf8');
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'nested.txt'), 'old-nested', 'utf8');

    const lockError = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    const second = await installI18nPlugin({
      home: tempHome,
      renameRetries: 2,
      renameDelayMs: 5,
      renameFn: () => {
        throw lockError();
      },
      rmFn: (target, options) => {
        if (target === first.destination) throw lockError();
        return rmSync(target, options);
      }
    });

    assert.equal(second.replacement, 'in-place');
    assert.ok(existsSync(join(second.destination, 'plugin.json')));
    assert.ok(existsSync(join(second.destination, 'sidecars', 'i18n', 'sidecar.json')));
    assert.ok(existsSync(join(second.destination, 'lib', 'i18n-client.js')));
    assert.equal(existsSync(staleFile), false, 'stale file should be pruned during in-place sync');
    assert.equal(existsSync(staleDir), false, 'stale directory should be pruned during in-place sync');
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('install falls back to in-place sync on ENOTEMPTY lock and reclaims empty dirs safely', async () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'agy-zh-enotempty-'));
  try {
    const dest = join(tempHome, '.gemini', 'config', 'plugins', 'agy-zh');
    mkdirSync(join(dest, 'sidecars'), { recursive: true });

    const lockError = () => Object.assign(new Error('ENOTEMPTY: directory not empty'), { code: 'ENOTEMPTY' });
    const res = await installI18nPlugin({
      home: tempHome,
      renameRetries: 1,
      renameDelayMs: 5,
      renameFn: () => {
        throw lockError();
      }
    });

    assert.equal(res.replacement, 'in-place');
    assert.ok(existsSync(join(dest, 'plugin.json')));
    assert.ok(existsSync(join(dest, 'lib', 'community-pairs.json')));

    const tempHomeUnknown = mkdtempSync(join(tmpdir(), 'agy-zh-unknown-'));
    try {
      const unknownDest = join(tempHomeUnknown, '.gemini', 'config', 'plugins', 'agy-zh');
      mkdirSync(unknownDest, { recursive: true });
      writeFileSync(join(unknownDest, 'unrelated.txt'), 'keep me', 'utf8');
      await assert.rejects(() => installI18nPlugin({ home: tempHomeUnknown }), /未知目录/);
    } finally {
      rmSync(tempHomeUnknown, { recursive: true, force: true });
    }
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('install migrates legacy agy-i18n data without overwriting existing agy-zh files and detects legacy plugin', async () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'agy-zh-migrate-'));
  try {
    const legacyDataDir = join(tempHome, '.gemini', 'antigravity', 'plugin_data', 'agy-i18n');
    const legacyPluginDir = join(tempHome, '.gemini', 'config', 'plugins', 'agy-i18n');
    mkdirSync(legacyDataDir, { recursive: true });
    mkdirSync(legacyPluginDir, { recursive: true });
    writeFileSync(join(legacyDataDir, 'settings.json'), '{"language":"en"}\n', 'utf8');
    writeFileSync(join(legacyDataDir, 'custom-dictionary.json'), '{"Foo":"福"}\n', 'utf8');
    writeFileSync(join(legacyPluginDir, 'plugin.json'), '{"name":"agy-i18n","version":"1.2.0"}\n', 'utf8');

    const first = await installI18nPlugin({ home: tempHome });
    assert.equal(first.legacyPluginDetected, true);
    assert.deepEqual(first.migratedDataFiles.sort(), ['custom-dictionary.json', 'settings.json']);

    const newSettingsPath = join(tempHome, '.gemini', 'antigravity', 'plugin_data', 'agy-zh', 'settings.json');
    const newDictPath = join(tempHome, '.gemini', 'antigravity', 'plugin_data', 'agy-zh', 'custom-dictionary.json');
    assert.equal(readFileSync(newSettingsPath, 'utf8'), '{"language":"en"}\n');
    assert.equal(readFileSync(newDictPath, 'utf8'), '{"Foo":"福"}\n');
    assert.ok(existsSync(legacyDataDir), 'legacy data dir must stay intact');

    writeFileSync(newSettingsPath, '{"language":"zh-CN"}\n', 'utf8');
    const second = await installI18nPlugin({ home: tempHome });
    assert.deepEqual(second.migratedDataFiles, []);
    assert.equal(readFileSync(newSettingsPath, 'utf8'), '{"language":"zh-CN"}\n', 'existing agy-zh settings must not be overwritten');
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});
