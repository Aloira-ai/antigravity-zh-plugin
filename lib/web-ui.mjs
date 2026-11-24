import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

function findPreloadJs(env = process.env) {
  const candidates = [
    env.ANTIGRAVITY_APP_DATA_DIR && join(env.ANTIGRAVITY_APP_DATA_DIR, 'lib', 'node_modules', 'sidecar_sdk', 'preload.js'),
    join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'preload.js')
  ].filter(Boolean);
  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      try {
        return readFileSync(filePath, 'utf8');
      } catch {}
    }
  }
  return '';
}

function readJsonBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let oversized = false;
    req.on('data', chunk => {
      if (oversized) return;
      raw += chunk;
      if (raw.length > maxBytes) {
        oversized = true;
        const err = new Error('请求体过大');
        err.statusCode = 413;
        reject(err);
        req.destroy();
      }
    });
    req.on('end', () => {
      if (oversized) return;
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('请求 JSON 格式无效');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

/**
 * Render the minimal Aux Pane Web UI HTML for language toggling and status display.
 */
export function renderAuxPaneHtml({ version = '1.0.0', initialLanguage = 'zh-CN' } = {}) {
  const safeLang = initialLanguage === 'en' ? 'en' : 'zh-CN';
  const safeVersion = String(version || '1.0.0').replace(/[<>&"']/g, '');

  return `<!DOCTYPE html>
<html lang="${safeLang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agy i18n</title>
  <script src="/preload.js"></script>
  <style>
    :root {
      color-scheme: light dark;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 14px;
      background: var(--background, #0f172a);
      color: var(--foreground, #e2e8f0);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 520px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .title-group {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }
    .title {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
    }
    .version {
      font-size: 11px;
      color: var(--muted-foreground, #94a3b8);
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
      padding: 3px 9px;
      border-radius: 9999px;
      border: 1px solid var(--border, rgba(148, 163, 184, 0.25));
      background: var(--muted, rgba(148, 163, 184, 0.12));
      white-space: nowrap;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #f59e0b;
      flex-shrink: 0;
    }
    .status-pill.connected .dot {
      background: #22c55e;
    }
    .card {
      border: 1px solid var(--border, rgba(148, 163, 184, 0.22));
      background: var(--card, rgba(30, 41, 59, 0.55));
      color: var(--card-foreground, inherit);
      border-radius: 10px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted-foreground, #94a3b8);
    }
    .segmented {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 4px;
      border-radius: 9px;
      border: 1px solid var(--border, rgba(148, 163, 184, 0.24));
      background: var(--muted, rgba(15, 23, 42, 0.4));
    }
    .seg-btn {
      appearance: none;
      border: none;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      color: var(--muted-foreground, #94a3b8);
      background: transparent;
      transition: background 120ms ease, color 120ms ease;
    }
    .seg-btn.active {
      background: var(--primary, #2563eb);
      color: var(--primary-foreground, #ffffff);
    }
    .seg-btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .row-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .row-title {
      font-size: 13px;
      font-weight: 500;
    }
    .row-desc {
      font-size: 11px;
      color: var(--muted-foreground, #94a3b8);
    }
    .switch {
      position: relative;
      width: 38px;
      height: 22px;
      border-radius: 9999px;
      border: 1px solid var(--border, rgba(148, 163, 184, 0.35));
      background: var(--muted, rgba(148, 163, 184, 0.25));
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      transition: background 150ms ease;
    }
    .switch[aria-checked="true"] {
      background: var(--primary, #2563eb);
      border-color: var(--primary, #2563eb);
    }
    .switch::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      transition: transform 150ms ease;
    }
    .switch[aria-checked="true"]::after {
      transform: translateX(16px);
    }
    .btn {
      appearance: none;
      border: 1px solid var(--border, rgba(148, 163, 184, 0.3));
      background: var(--secondary, rgba(148, 163, 184, 0.14));
      color: var(--foreground, inherit);
      border-radius: 7px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn:hover {
      filter: brightness(1.08);
    }
    .code-box {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      padding: 8px;
      border-radius: 7px;
      border: 1px solid var(--border, rgba(148, 163, 184, 0.22));
      background: var(--background, rgba(15, 23, 42, 0.65));
      word-break: break-all;
      user-select: all;
    }
    details summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted-foreground, #94a3b8);
      user-select: none;
    }
    .feedback {
      font-size: 11px;
      color: var(--muted-foreground, #94a3b8);
      min-height: 16px;
    }
    .warn {
      border-color: rgba(245, 158, 11, 0.45);
    }
  </style>
</head>
<body>
  <div class="stack">
    <div class="header">
      <div class="title-group">
        <h1 class="title" id="ui-title">界面汉化</h1>
        <span class="version">v${safeVersion}</span>
      </div>
      <div class="status-pill" id="status-pill">
        <span class="dot"></span>
        <span id="status-text">检测中…</span>
      </div>
    </div>

    <div class="card">
      <div class="card-label" id="lang-label">界面语言</div>
      <div class="segmented" role="group" aria-label="Language toggle">
        <button type="button" class="seg-btn" id="btn-zh" data-lang="zh-CN">简体中文</button>
        <button type="button" class="seg-btn" id="btn-en" data-lang="en">English</button>
      </div>
      <div class="row">
        <div class="row-text">
          <div class="row-title" id="pill-title">主窗口悬浮切换按钮 (中 / EN)</div>
          <div class="row-desc" id="pill-desc">在客户端右下角显示可拖动的快速切换胶囊</div>
        </div>
        <button type="button" class="switch" id="floating-switch" role="switch" aria-checked="false"></button>
      </div>
    </div>

    <div class="card" id="setup-card">
      <details id="setup-details" open>
        <summary id="setup-summary">启用条件与启动命令</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
          <div class="row-desc" id="setup-desc"></div>
          <div class="code-box" id="launch-cmd"></div>
          <div class="row">
            <span class="feedback" id="copy-feedback"></span>
            <button type="button" class="btn" id="copy-cmd-btn">复制启动命令</button>
          </div>
        </div>
      </details>
    </div>

    <div class="card">
      <div class="row">
        <div class="row-text">
          <div class="row-title" id="dict-title">翻译词典</div>
          <div class="row-desc" id="dict-counts">-</div>
        </div>
        <button type="button" class="btn" id="reload-dict-btn">重新加载词典</button>
      </div>
      <div class="row-desc" id="dict-path" style="word-break:break-all;"></div>
      <div class="feedback" id="action-feedback"></div>
    </div>
  </div>

  <script>
    (() => {
      const params = new URLSearchParams(location.search);
      const token = params.get('token') || '';
      const copy = {
        'zh-CN': {
          title: '界面汉化',
          langLabel: '界面语言',
          pillTitle: '主窗口悬浮切换按钮 (中 / EN)',
          pillDesc: '在客户端右下角显示可拖动的快速切换胶囊',
          connected: n => '已连接 ' + n + ' 个窗口',
          waiting: '等待调试端口',
          setupSummary: '启用条件与启动命令',
          setupDescWaiting: '未检测到本地调试端口。请为 Antigravity 快捷方式添加 --remote-debugging-port=0 启动参数后完全重启客户端（本插件不会自动修改您的快捷方式）：',
          setupDescReady: '当前已接入本地调试接口。如需在其他快捷方式中保持生效，请确保包含启动参数：',
          copyCmd: '复制启动命令',
          copied: '已复制命令',
          dictTitle: '翻译词典',
          dictCounts: (b, c) => '内置 ' + b + ' 条 · 自定义 ' + c + ' 条',
          dictPathPrefix: '自定义词典文件：',
          reloadDict: '重新加载词典',
          reloaded: '词典已重新加载',
          actionError: '操作失败：'
        },
        en: {
          title: 'Agy i18n',
          langLabel: 'UI Language',
          pillTitle: 'Floating quick switch pill (中 / EN)',
          pillDesc: 'Show a draggable toggle pill at the bottom-right of the main window',
          connected: n => 'Connected (' + n + ' window' + (n === 1 ? '' : 's') + ')',
          waiting: 'Waiting for debug port',
          setupSummary: 'Setup & Launch Command',
          setupDescWaiting: 'Local debug port not detected. Add --remote-debugging-port=0 to your Antigravity shortcut and restart completely (this plugin never modifies your shortcuts):',
          setupDescReady: 'Connected to local debug port. Keep this flag on your Antigravity shortcut:',
          copyCmd: 'Copy launch command',
          copied: 'Copied',
          dictTitle: 'Dictionary',
          dictCounts: (b, c) => b + ' built-in · ' + c + ' custom',
          dictPathPrefix: 'Custom dictionary: ',
          reloadDict: 'Reload dictionary',
          reloaded: 'Dictionary reloaded',
          actionError: 'Failed: '
        }
      };

      let state = {
        settings: { language: ${JSON.stringify(safeLang)}, floatingButton: false },
        cdp: { connected: false, debugPortReached: false, hubCount: 0, swarmCount: 0 },
        dictionary: { builtinCount: 0, customCount: 0, customPath: '' },
        launchCommand: ''
      };
      let autoCollapsed = false;

      const $ = id => document.getElementById(id);

      async function api(path, options = {}) {
        const headers = new Headers(options.headers || {});
        if (options.body) headers.set('Content-Type', 'application/json');
        if (token) headers.set('X-Sidecar-Token', token);
        const res = await fetch(path, { ...options, headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }

      function render() {
        const lang = state.settings?.language === 'en' ? 'en' : 'zh-CN';
        const t = copy[lang];
        const floating = Boolean(state.settings?.floatingButton);
        const cdp = state.cdp || {};
        const dict = state.dictionary || {};

        $('ui-title').textContent = t.title;
        $('lang-label').textContent = t.langLabel;
        $('pill-title').textContent = t.pillTitle;
        $('pill-desc').textContent = t.pillDesc;
        $('btn-zh').classList.toggle('active', lang === 'zh-CN');
        $('btn-en').classList.toggle('active', lang === 'en');
        $('floating-switch').setAttribute('aria-checked', floating ? 'true' : 'false');

        const pill = $('status-pill');
        pill.classList.toggle('connected', Boolean(cdp.connected));
        const winCount = (cdp.hubCount || 0) + (cdp.swarmCount || 0);
        $('status-text').textContent = cdp.connected ? t.connected(winCount) : t.waiting;

        const setupCard = $('setup-card');
        setupCard.classList.toggle('warn', !cdp.debugPortReached);
        $('setup-summary').textContent = t.setupSummary;
        $('setup-desc').textContent = cdp.debugPortReached ? t.setupDescReady : t.setupDescWaiting;
        $('launch-cmd').textContent = state.launchCommand || 'Antigravity --remote-debugging-port=0';
        $('copy-cmd-btn').textContent = t.copyCmd;

        if (cdp.debugPortReached && !autoCollapsed) {
          $('setup-details').open = false;
          autoCollapsed = true;
        } else if (!cdp.debugPortReached) {
          $('setup-details').open = true;
          autoCollapsed = false;
        }

        $('dict-title').textContent = t.dictTitle;
        $('dict-counts').textContent = t.dictCounts(dict.builtinCount || 0, dict.customCount || 0);
        $('dict-path').textContent = dict.customPath ? (t.dictPathPrefix + dict.customPath) : '';
        $('reload-dict-btn').textContent = t.reloadDict;
      }

      async function updateSettings(patch) {
        $('btn-zh').disabled = true;
        $('btn-en').disabled = true;
        $('floating-switch').disabled = true;
        $('action-feedback').textContent = '';
        try {
          const next = await api('/api/settings', {
            method: 'POST',
            body: JSON.stringify(patch)
          });
          state = { ...state, ...next };
          render();
        } catch (err) {
          const lang = state.settings?.language === 'en' ? 'en' : 'zh-CN';
          $('action-feedback').textContent = copy[lang].actionError + (err?.message || err);
        } finally {
          $('btn-zh').disabled = false;
          $('btn-en').disabled = false;
          $('floating-switch').disabled = false;
        }
      }

      $('btn-zh').addEventListener('click', () => updateSettings({ language: 'zh-CN' }));
      $('btn-en').addEventListener('click', () => updateSettings({ language: 'en' }));
      $('floating-switch').addEventListener('click', () => {
        updateSettings({ floatingButton: !state.settings?.floatingButton });
      });

      $('copy-cmd-btn').addEventListener('click', async () => {
        const lang = state.settings?.language === 'en' ? 'en' : 'zh-CN';
        const cmd = $('launch-cmd').textContent || '';
        try {
          await navigator.clipboard.writeText(cmd);
          $('copy-feedback').textContent = copy[lang].copied;
          setTimeout(() => { $('copy-feedback').textContent = ''; }, 1800);
        } catch {}
      });

      $('reload-dict-btn').addEventListener('click', async () => {
        const lang = state.settings?.language === 'en' ? 'en' : 'zh-CN';
        $('action-feedback').textContent = '';
        try {
          const next = await api('/api/reload-dictionary', { method: 'POST', body: '{}' });
          state = { ...state, ...next };
          render();
          $('action-feedback').textContent = copy[lang].reloaded;
          setTimeout(() => { $('action-feedback').textContent = ''; }, 2000);
        } catch (err) {
          $('action-feedback').textContent = copy[lang].actionError + (err?.message || err);
        }
      });

      async function poll() {
        try {
          state = await api('/api/status');
          render();
        } catch {}
      }

      render();
      void poll();
      setInterval(poll, 2500);
    })();
  </script>
</body>
</html>`;
}

/**
 * Start the loopback-only HTTP server for the Sidecar Aux Pane Web UI.
 */
export function startWebUi({
  port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || 0),
  token = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '',
  version = '1.0.0',
  getStatus,
  onSetSettings,
  onReloadDictionary,
  env = process.env,
  allowEphemeral = false
} = {}) {
  const validPort = Number.isInteger(port) && (allowEphemeral ? (port >= 0 && port <= 65535) : (port >= 1 && port <= 65535));
  if (!validPort) {
    const noop = async () => {};
    noop.port = 0;
    return Promise.resolve(noop);
  }

  const preloadJs = findPreloadJs(env);

  const isAuthorized = (req, url) => {
    if (!token) return true;
    return (req.headers['x-sidecar-token'] || url.searchParams.get('token')) === token;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/preload.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(preloadJs);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const current = (await getStatus?.()) || {};
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderAuxPaneHtml({
        version,
        initialLanguage: current.settings?.language || 'zh-CN'
      }));
      return;
    }

    if (!isAuthorized(req, url)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      try {
        const current = (await getStatus?.()) || {};
        sendJson(res, 200, { version, ...current });
      } catch (error) {
        sendJson(res, 500, { error: error?.message || 'status failed' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/settings') {
      try {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          sendJson(res, 400, { error: '无效的设置参数' });
          return;
        }
        const result = await onSetSettings?.(body);
        sendJson(res, 200, { version, ...result });
      } catch (error) {
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
        sendJson(res, statusCode, { error: error?.message || 'invalid settings' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reload-dictionary') {
      try {
        const result = await onReloadDictionary?.();
        sendJson(res, 200, { version, ...result });
      } catch (error) {
        sendJson(res, 500, { error: error?.message || 'reload failed' });
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const boundPort = server.address()?.port || 0;
      const close = () => new Promise(done => server.close(() => done()));
      close.port = boundPort;
      resolve(close);
    });
  });
}
