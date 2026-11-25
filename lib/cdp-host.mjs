import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateDynamic } from './dictionary.mjs';
import { devToolsPortFile } from './paths.mjs';

const CLIENT_SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'i18n-client.js');

const HUB_TITLE_RE = /(?:(?:^| - |\(\d+\) )Antigravity(?:\s*(?:\([^)]+\)|\[[^\]]+\]))?|(?:\s|^)(?:\((?:SSH|WSL):\s*[^)]+\)|\[(?:SSH|WSL):\s*[^\]]+\]))$/;
const HUB_PATH_RE = /^\/(?:c\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}|customizations|automations)(?:\/|$)/;
const SWARM_TARGET_RE = /^plugin:\/\/swarm--swarm_board-/i;

let cachedClientSource = '';
function getClientSource() {
  if (!cachedClientSource) {
    cachedClientSource = readFileSync(CLIENT_SCRIPT_PATH, 'utf8');
  }
  return cachedClientSource;
}

export function isLoopbackHttpsPage(target) {
  if (!target || target.type !== 'page' || typeof target.url !== 'string') return false;
  try {
    const url = new URL(target.url);
    return url.protocol === 'https:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isHubTarget(target) {
  if (!isLoopbackHttpsPage(target)) return false;
  try {
    const pathname = new URL(target.url).pathname;
    return HUB_TITLE_RE.test(target.title || '') || HUB_PATH_RE.test(pathname) || pathname === '/';
  } catch {
    return false;
  }
}

export function isSwarmTarget(target) {
  return target?.type === 'iframe' && SWARM_TARGET_RE.test(target?.url || '');
}

/**
 * Connect to a Chrome DevTools Protocol WebSocket target.
 */
export function connectCdp(url, WebSocketImpl = globalThis.WebSocket) {
  if (typeof WebSocketImpl !== 'function') {
    return Promise.reject(new Error('当前 Node 环境不支持 WebSocket'));
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    const pending = new Map();
    const listeners = new Set();
    let sequence = 0;
    let opened = false;

    const timeout = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error('调试接口连接超时'));
    }, 4000);

    const failPending = () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('调试接口已断开'));
      }
      pending.clear();
    };

    socket.addEventListener('error', () => {
      if (!opened) {
        clearTimeout(timeout);
        reject(new Error('调试接口不可用'));
      }
    });

    socket.addEventListener('close', failPending);

    socket.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const entry = pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message || 'CDP error'));
        else entry.resolve(message.result);
      } else {
        for (const listener of listeners) {
          listener(message);
        }
      }
    });

    socket.addEventListener('open', () => {
      opened = true;
      clearTimeout(timeout);
      resolve({
        socket,
        onEvent: listener => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(method, params = {}) {
          if (socket.readyState !== 1) {
            return Promise.reject(new Error('调试接口已断开'));
          }
          return new Promise((res, rej) => {
            const id = ++sequence;
            const timeoutMs = method === 'Runtime.evaluate' ? 15000 : 5000;
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`${method} 超时`));
            }, timeoutMs);
            pending.set(id, { resolve: res, reject: rej, timer });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          try { socket.close(); } catch {}
        }
      });
    });
  });
}

function computeBuildId(version, clientSource, dynamicSource) {
  return createHash('sha256')
    .update(`${version}\0${clientSource}\0${dynamicSource}`)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Build the browser-side injection payload wrapping lib/i18n-client.js.
 */
export function buildInjectionScript({
  version = '1.0.0',
  language = 'zh-CN',
  floatingButton = false,
  pairs = [],
  origin = '',
  isSwarm = false
} = {}) {
  const guard = isSwarm
    ? '/^plugin:\\/\\/swarm--swarm_board-/i.test(location.href)'
    : `location.origin === ${JSON.stringify(origin)} && window === window.top`;
  const clientSource = getClientSource();
  const dynamicSource = translateDynamic.toString();
  const buildId = computeBuildId(version, clientSource, dynamicSource);
  const config = {
    version,
    buildId,
    language: language === 'en' ? 'en' : 'zh-CN',
    floatingButton: isSwarm ? false : Boolean(floatingButton),
    isTopFrame: !isSwarm,
    pairs
  };
  return [
    `if (${guard} && (!globalThis.__agyI18n || globalThis.__agyI18n.version !== ${JSON.stringify(version)} || globalThis.__agyI18n.buildId !== ${JSON.stringify(buildId)})) {`,
    `  globalThis.__agyI18nConfig = ${JSON.stringify(config)};`,
    `  globalThis.__agyI18nConfig.translateDynamic = ${dynamicSource};`,
    clientSource,
    '}'
  ].join('\n');
}

/**
 * Start the minimal CDP host bridge polling DevToolsActivePort and managing i18n scripts.
 */
export function startCdpHost({
  version = '1.0.0',
  settings,
  getPairs,
  portFile,
  pollIntervalMs = 3000,
  connect = connectCdp,
  fetcher = fetch,
  onStateChange
} = {}) {
  const activePortFile = devToolsPortFile({ portFile });
  const clients = new Map();
  const swarmClients = new Map();

  let stopped = false;
  let polling = false;
  let debugPortReached = false;
  let lastError = '';

  const getStatus = () => ({
    connected: clients.size > 0 || swarmClients.size > 0,
    debugPortReached,
    hubCount: clients.size,
    swarmCount: swarmClients.size,
    portFile: activePortFile,
    lastError
  });

  const emitState = () => {
    try {
      onStateChange?.({ settings: settings.get(), status: getStatus() });
    } catch {}
  };

  async function replaceBootScript(client, { origin = '', isSwarm = false } = {}) {
    const current = settings.get();
    const source = buildInjectionScript({
      version,
      language: current.language,
      floatingButton: current.floatingButton,
      pairs: getPairs(),
      origin,
      isSwarm
    });
    try {
      if (client.scriptId) {
        await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId }).catch(() => {});
      }
      const installed = await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
      client.scriptId = installed?.identifier || '';
    } catch {
      /* Some targets/iframes do not support addScriptToEvaluateOnNewDocument. */
    }
    return source;
  }

  async function applySettings(nextSettings) {
    const lang = nextSettings.language === 'en' ? 'en' : 'zh-CN';
    const floating = Boolean(nextSettings.floatingButton);
    await Promise.all([
      ...[...clients.values()].map(async client => {
        try {
          await client.send('Runtime.evaluate', {
            expression: `globalThis.__agyI18n?.apply(${JSON.stringify(lang)}, ${JSON.stringify(floating)})`
          });
          await replaceBootScript(client, { origin: client.origin, isSwarm: false });
        } catch {}
      }),
      ...[...swarmClients.values()].map(async client => {
        try {
          await client.send('Runtime.evaluate', {
            expression: `globalThis.__agyI18n?.apply(${JSON.stringify(lang)}, false)`
          });
          await replaceBootScript(client, { isSwarm: true });
        } catch {}
      })
    ]);
    emitState();
  }

  async function reloadDictionary() {
    const pairs = getPairs();
    const serialized = JSON.stringify(pairs);
    await Promise.all([
      ...[...clients.values()].map(async client => {
        try {
          await client.send('Runtime.evaluate', {
            expression: `globalThis.__agyI18n?.updatePairs(${serialized})`
          });
          await replaceBootScript(client, { origin: client.origin, isSwarm: false });
        } catch {}
      }),
      ...[...swarmClients.values()].map(async client => {
        try {
          await client.send('Runtime.evaluate', {
            expression: `globalThis.__agyI18n?.updatePairs(${serialized})`
          });
          await replaceBootScript(client, { isSwarm: true });
        } catch {}
      })
    ]);
    emitState();
  }

  async function attachHub(target) {
    const client = await connect(target.webSocketDebuggerUrl);
    const origin = new URL(target.url).origin;
    client.origin = origin;
    client.endpoint = target.webSocketDebuggerUrl;
    clients.set(target.id, client);
    client.socket?.addEventListener?.('close', () => {
      if (clients.get(target.id) === client) {
        clients.delete(target.id);
        emitState();
      }
    });

    const probe = await client.send('Runtime.evaluate', {
      expression: `Boolean(/Antigravity\\//.test(navigator.userAgent||'')||globalThis.electronNative||globalThis.sshRemote||globalThis.createFileRoute)`,
      returnByValue: true
    });
    if (probe?.result?.value === false) {
      client.close?.();
      clients.delete(target.id);
      return;
    }

    await client.send('Page.enable');
    const frameTree = await client.send('Page.getFrameTree');
    const mainFrame = frameTree?.frameTree?.frame?.id || '';
    const contexts = new Set();

    client.onEvent(async event => {
      if (event.method === 'Runtime.executionContextCreated') {
        const ctx = event.params?.context;
        if (ctx && ctx.origin === origin && ctx.auxData?.isDefault && ctx.auxData.frameId === mainFrame) {
          contexts.add(ctx.id);
        }
        return;
      }
      if (event.method === 'Runtime.executionContextDestroyed') {
        contexts.delete(event.params?.executionContextId);
        return;
      }
      if (event.method === 'Runtime.executionContextsCleared') {
        contexts.clear();
        return;
      }
      if (event.method !== 'Runtime.bindingCalled' || event.params?.name !== '__agyI18nHost') return;
      if (!contexts.has(event.params.executionContextId)) return;

      const raw = event.params.payload;
      if (typeof raw !== 'string' || raw.length > 4096) return;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || msg.type !== 'setLanguage' || (msg.language !== 'zh-CN' && msg.language !== 'en')) return;

      try {
        const next = settings.set({ language: msg.language });
        await applySettings(next);
      } catch {}
    });

    await client.send('Runtime.enable');
    await client.send('Runtime.addBinding', { name: '__agyI18nHost' });

    const source = await replaceBootScript(client, { origin, isSwarm: false });
    const evalRes = await client.send('Runtime.evaluate', { expression: source });
    if (evalRes?.exceptionDetails) {
      throw new Error(evalRes.exceptionDetails.text || '注入汉化脚本失败');
    }
    emitState();
  }

  async function attachSwarm(target) {
    const client = await connect(target.webSocketDebuggerUrl);
    client.url = target.url;
    client.endpoint = target.webSocketDebuggerUrl;
    swarmClients.set(target.id, client);
    client.socket?.addEventListener?.('close', () => {
      if (swarmClients.get(target.id) === client) {
        swarmClients.delete(target.id);
        emitState();
      }
    });

    await client.send('Page.enable').catch(() => {});
    const source = await replaceBootScript(client, { isSwarm: true });
    const evalRes = await client.send('Runtime.evaluate', { expression: source });
    if (evalRes?.exceptionDetails) {
      throw new Error(evalRes.exceptionDetails.text || '注入 Swarm 汉化脚本失败');
    }
    emitState();
  }

  async function poll() {
    if (stopped || polling) return;
    polling = true;
    try {
      const portText = readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0];
      const port = Number(portText);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('调试端口不可用');
      }
      const res = await fetcher(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok === false) throw new Error(`调试接口返回异常 (${res.status})`);
      const targets = await res.json();
      if (!Array.isArray(targets)) throw new Error('调试接口返回格式无效');

      debugPortReached = true;
      lastError = '';

      const hubs = targets.filter(t =>
        isHubTarget(t) || (isLoopbackHttpsPage(t) && clients.get(t.id)?.origin === new URL(t.url).origin)
      );

      for (const target of hubs) {
        let client = clients.get(target.id);
        try {
          if (client && (client.origin !== new URL(target.url).origin || client.endpoint !== target.webSocketDebuggerUrl)) {
            client.close?.();
            clients.delete(target.id);
            client = null;
          }
          if (!client) {
            await attachHub(target);
          } else {
            const check = await client.send('Runtime.evaluate', {
              expression: `location.origin === ${JSON.stringify(client.origin)} && !globalThis.__agyI18n && document.readyState !== 'loading'`,
              returnByValue: true
            });
            if (check?.result?.value === true) {
              const source = await replaceBootScript(client, { origin: client.origin, isSwarm: false });
              await client.send('Runtime.evaluate', { expression: source });
            }
          }
        } catch (error) {
          clients.get(target.id)?.close?.();
          clients.delete(target.id);
          lastError = error?.message || String(error);
        }
      }

      const activeHubIds = new Set(hubs.map(t => t.id));
      for (const [id, client] of clients) {
        if (!activeHubIds.has(id)) {
          client.close?.();
          clients.delete(id);
        }
      }

      const swarms = targets.filter(isSwarmTarget);
      for (const target of swarms) {
        let swarmClient = swarmClients.get(target.id);
        try {
          if (swarmClient && (swarmClient.url !== target.url || swarmClient.endpoint !== target.webSocketDebuggerUrl)) {
            swarmClient.close?.();
            swarmClients.delete(target.id);
            swarmClient = null;
          }
          if (!swarmClient) {
            await attachSwarm(target);
          } else {
            const current = settings.get();
            const wantLang = current.language === 'en' ? 'en' : 'zh-CN';
            const check = await swarmClient.send('Runtime.evaluate', {
              expression: `({ ready: Boolean(globalThis.__agyI18n), lang: globalThis.__agyI18n?.language || '' })`,
              returnByValue: true
            });
            const val = check?.result?.value;
            if (!val?.ready) {
              const source = await replaceBootScript(swarmClient, { isSwarm: true });
              await swarmClient.send('Runtime.evaluate', { expression: source });
            } else if (val.lang !== wantLang) {
              await swarmClient.send('Runtime.evaluate', {
                expression: `globalThis.__agyI18n?.apply(${JSON.stringify(wantLang)}, false)`
              });
            }
          }
        } catch {
          swarmClients.get(target.id)?.close?.();
          swarmClients.delete(target.id);
        }
      }

      const activeSwarmIds = new Set(swarms.map(t => t.id));
      for (const [id, swarmClient] of swarmClients) {
        if (!activeSwarmIds.has(id)) {
          swarmClient.close?.();
          swarmClients.delete(id);
        }
      }
      emitState();
    } catch (error) {
      debugPortReached = false;
      lastError = error?.message || String(error);
      emitState();
    } finally {
      polling = false;
    }
  }

  const timer = pollIntervalMs > 0 ? setInterval(poll, pollIntervalMs) : null;
  timer?.unref?.();
  const initialPoll = poll();

  return {
    ready: initialPoll,
    checkNow: poll,
    status: getStatus,
    applySettings,
    reloadDictionary,
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      for (const client of clients.values()) {
        try {
          if (client.scriptId) {
            await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId }).catch(() => {});
          }
          await client.send('Runtime.evaluate', { expression: 'globalThis.__agyI18n?.dispose()' }).catch(() => {});
        } catch {}
        client.close?.();
      }
      clients.clear();

      for (const swarmClient of swarmClients.values()) {
        try {
          if (swarmClient.scriptId) {
            await swarmClient.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: swarmClient.scriptId }).catch(() => {});
          }
          await swarmClient.send('Runtime.evaluate', { expression: 'globalThis.__agyI18n?.dispose()' }).catch(() => {});
        } catch {}
        swarmClient.close?.();
      }
      swarmClients.clear();
      emitState();
    }
  };
}
