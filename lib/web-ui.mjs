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
  <title>Antigravity 界面汉化</title>
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
    .version-link {
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 1px 5px;
      text-decoration: none;
      cursor: pointer;
      transition: color 0.15s ease, border-color 0.15s ease;
    }
    .version-link:hover {
      color: var(--foreground, #e2e8f0);
      border-color: rgba(59, 130, 246, 0.55);
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
    .input-grid {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 6px;
      align-items: center;
    }
    .text-input {
      width: 100%;
      min-width: 0;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--border, rgba(148, 163, 184, 0.3));
      background: var(--background, rgba(15, 23, 42, 0.65));
      color: var(--foreground, inherit);
      font-size: 12px;
      outline: none;
    }
    .text-input:focus {
      border-color: var(--primary, #2563eb);
    }
    .custom-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 180px;
      overflow-y: auto;
    }
    .custom-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 8px;
      border-radius: 6px;
      border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
      background: var(--background, rgba(15, 23, 42, 0.35));
      font-size: 12px;
    }
    .custom-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .btn-ghost {
      padding: 2px 7px;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="stack">
    <div class="header">
      <div class="title-group">
        <h1 class="title" id="ui-title">界面汉化</h1>
        <a class="version version-link" id="releases-link" href="https://github.com/Aloira-ai/antigravity-zh-plugin/releases" target="_blank" rel="noopener noreferrer" title="在 GitHub 查看更新日志与新版本">v${safeVersion}</a>
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
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
              <button type="button" class="btn" id="copy-shortcut-btn" style="display:none;">复制桌面快捷方式命令</button>
              <button type="button" class="btn" id="copy-cmd-btn">复制启动命令</button>
            </div>
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
      <div class="input-grid">
        <input type="text" class="text-input" id="custom-en" placeholder="英文原文 (English)" maxlength="500" />
        <input type="text" class="text-input" id="custom-zh" placeholder="中文译文 (简体中文)" maxlength="500" />
        <button type="button" class="btn" id="custom-add-btn">添加</button>
      </div>
      <div class="custom-list" id="custom-list"></div>
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
          copyShortcut: '复制桌面快捷方式命令',
          copied: '已复制命令',
          copiedShortcut: '已复制快捷方式创建命令',
          dictTitle: '翻译词典',
          dictCounts: (b, c) => '内置 ' + b + ' 条 · 自定义 ' + c + ' 条',
          dictPathPrefix: '自定义词典文件：',
          reloadDict: '重新加载词典',
          reloaded: '词典已重新加载',
          customEnPh: '英文原文',
          customZhPh: '中文译文',
          customAdd: '添加',
          deleteEntry: '删除',
          entrySaved: '词条已保存并热生效',
          entryDeleted: '词条已删除并热生效',
          customEmpty: '暂无自定义词条，可直接在上方添加（点击已有词条可编辑）。',
          actionError: '操作失败：',
          releasesTitle: '在 GitHub 查看更新日志与新版本'
        },
        en: {
          title: 'Antigravity ZH',
          langLabel: 'UI Language',
          pillTitle: 'Floating quick switch pill (中 / EN)',
          pillDesc: 'Show a draggable toggle pill at the bottom-right of the main window',
          connected: n => 'Connected (' + n + ' window' + (n === 1 ? '' : 's') + ')',
          waiting: 'Waiting for debug port',
          setupSummary: 'Setup & Launch Command',
          setupDescWaiting: 'Local debug port not detected. Add --remote-debugging-port=0 to your Antigravity shortcut and restart completely (this plugin never modifies your shortcuts):',
          setupDescReady: 'Connected to local debug port. Keep this flag on your Antigravity shortcut:',
          copyCmd: 'Copy launch command',
          copyShortcut: 'Copy desktop shortcut cmd',
          copied: 'Copied',
          copiedShortcut: 'Copied shortcut command',
          dictTitle: 'Dictionary',
          dictCounts: (b, c) => b + ' built-in · ' + c + ' custom',
          dictPathPrefix: 'Custom dictionary: ',
          reloadDict: 'Reload dictionary',
          reloaded: 'Dictionary reloaded',
          customEnPh: 'English text',
          customZhPh: 'Chinese translation',
          customAdd: 'Add',
          deleteEntry: 'Delete',
          entrySaved: 'Entry saved & applied',
          entryDeleted: 'Entry deleted & applied',
          customEmpty: 'No custom entries yet. Add one above (click any row to edit).',
          actionError: 'Failed: ',
          releasesTitle: 'View releases & updates on GitHub'
        }
      };

      let state = {
        settings: { language: ${JSON.stringify(safeLang)}, floatingButton: false },
        cdp: { connected: false, debugPortReached: false, hubCount: 0, swarmCount: 0 },
        dictionary: { builtinCount: 0, customCount: 0, customPath: '', customEntries: [] },
        launchCommand: '',
        shortcutCommand: ''
      };
      let autoCollapsed = false;
      let lastEntriesSignature = '';

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

      function renderCustomList(entries, lang, t) {
        const listEl = $('custom-list');
        const sig = JSON.stringify(entries || []) + '|' + lang;
        if (sig === lastEntriesSignature) return;
        lastEntriesSignature = sig;
        while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

        if (!Array.isArray(entries) || entries.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'row-desc';
          empty.style.padding = '2px 0';
          empty.textContent = t.customEmpty;
          listEl.appendChild(empty);
          return;
        }

        for (const pair of entries) {
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const [en, zh] = pair;
          const item = document.createElement('div');
          item.className = 'custom-item';

          const textSpan = document.createElement('span');
          textSpan.className = 'custom-text';
          textSpan.textContent = en + ' → ' + zh;
          textSpan.title = en + ' → ' + zh;
          textSpan.addEventListener('click', () => {
            $('custom-en').value = en;
            $('custom-zh').value = zh;
            $('custom-zh').focus();
          });

          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn btn-ghost';
          delBtn.textContent = t.deleteEntry;
          delBtn.addEventListener('click', async () => {
            delBtn.disabled = true;
            $('action-feedback').textContent = '';
            try {
              const next = await api('/api/custom-dictionary', {
                method: 'DELETE',
                body: JSON.stringify({ en })
              });
              state = { ...state, ...next };
              render();
              $('action-feedback').textContent = copy[state.settings?.language === 'en' ? 'en' : 'zh-CN'].entryDeleted;
              setTimeout(() => { $('action-feedback').textContent = ''; }, 2000);
            } catch (err) {
              $('action-feedback').textContent = t.actionError + (err?.message || err);
              delBtn.disabled = false;
            }
          });

          item.appendChild(textSpan);
          item.appendChild(delBtn);
          listEl.appendChild(item);
        }
      }

      function render() {
        const lang = state.settings?.language === 'en' ? 'en' : 'zh-CN';
        const t = copy[lang];
        const floating = Boolean(state.settings?.floatingButton);
        const cdp = state.cdp || {};
        const dict = state.dictionary || {};

        $('ui-title').textContent = t.title;
        $('releases-link').title = t.releasesTitle;
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

        const shortcutBtn = $('copy-shortcut-btn');
        shortcutBtn.textContent = t.copyShortcut;
        shortcutBtn.style.display = state.shortcutCommand ? 'inline-block' : 'none';

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
        $('custom-en').placeholder = t.customEnPh;
        $('custom-zh').placeholder = t.customZhPh;
        $('custom-add-btn').textContent = t.customAdd;
        renderCustomList(dict.customEntries || [], lang, t);
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

      async function saveCustomEntry() {
        const lang = state.settings?.language === 'en' ? 'en' : 'zh-CN';
        const en = $('custom-en').value.trim();
        const zh = $('custom-zh').value.trim();
        $('custom-add-btn').disabled = true;
        $('action-feedback').textContent = '';
        try {
          const next = await api('/api/custom-dictionary', {
            method: 'POST',
            body: JSON.stringify({ en, zh })
          });
          $('custom-en').value = '';
          $('custom-zh').value = '';
          state = { ...state, ...next };
          render();
          $('action-feedback').textContent = copy[lang].entrySaved;
          setTimeout(() => { $('action-feedback').textContent = ''; }, 2000);
        } catch (err) {
          $('action-feedback').textContent = copy[lang].actionError + (err?.message || err);
        } finally {
          $('custom-add-btn').disabled = false;
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

      $('copy-shortcut-btn').addEventListener('click', async () => {
        const lang = state.settings?.language === 'en' ? 'en' : 'zh-CN';
        const cmd = state.shortcutCommand || '';
        if (!cmd) return;
        try {
          await navigator.clipboard.writeText(cmd);
          $('copy-feedback').textContent = copy[lang].copiedShortcut;
          setTimeout(() => { $('copy-feedback').textContent = ''; }, 2200);
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

      $('custom-add-btn').addEventListener('click', () => { void saveCustomEntry(); });
      for (const inputId of ['custom-en', 'custom-zh']) {
        $(inputId).addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void saveCustomEntry();
          }
        });
      }

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
  onUpsertCustomEntry,
  onDeleteCustomEntry,
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

    if (req.method === 'POST' && url.pathname === '/api/custom-dictionary') {
      try {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            typeof body.en !== 'string' || typeof body.zh !== 'string') {
          sendJson(res, 400, { error: '请提供有效的英文原文与中文译文' });
          return;
        }
        if (typeof onUpsertCustomEntry !== 'function') {
          sendJson(res, 501, { error: '未启用词典编辑接口' });
          return;
        }
        const result = await onUpsertCustomEntry({ en: body.en, zh: body.zh });
        sendJson(res, 200, { version, ...result });
      } catch (error) {
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
        sendJson(res, statusCode, { error: error?.message || 'save entry failed' });
      }
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/custom-dictionary') {
      try {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.en !== 'string') {
          sendJson(res, 400, { error: '请提供要删除的英文原文' });
          return;
        }
        if (typeof onDeleteCustomEntry !== 'function') {
          sendJson(res, 501, { error: '未启用词典删除接口' });
          return;
        }
        const result = await onDeleteCustomEntry({ en: body.en });
        sendJson(res, 200, { version, ...result });
      } catch (error) {
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
        sendJson(res, statusCode, { error: error?.message || 'delete entry failed' });
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
