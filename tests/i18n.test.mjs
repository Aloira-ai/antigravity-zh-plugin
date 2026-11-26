import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildInjectionScript } from '../lib/cdp-host.mjs';
import { BUILTIN_PAIRS, mergeDictionaryPairs, translateDynamic } from '../lib/dictionary.mjs';
import { createDebugShortcutCommand } from '../lib/paths.mjs';
import { createSettingsStore, DEFAULT_SETTINGS } from '../lib/settings.mjs';
import { startWebUi } from '../lib/web-ui.mjs';

const CLIENT_SOURCE = readFileSync(new URL('../lib/i18n-client.js', import.meta.url), 'utf8');

function createDomMock() {
  const listeners = new Map();
  let observerInstance = null;

  class MockNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentElement = null;
      this.childNodes = [];
    }
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === doc || cur === doc.documentElement) return true;
        cur = cur.parentElement;
      }
      return false;
    }
  }

  class MockText extends MockNode {
    constructor(text) {
      super(3);
      this.nodeValue = text;
    }
  }

  class MockElement extends MockNode {
    constructor(tagName) {
      super(1);
      this.tagName = String(tagName).toUpperCase();
      this.attributes = new Map();
      this.style = {};
      this.listeners = new Map();
      this.id = '';
    }
    setAttribute(name, value) {
      const val = String(value);
      this.attributes.set(name, val);
      if (name === 'id') this.id = val;
    }
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    hasAttribute(name) {
      return this.attributes.has(name);
    }
    removeAttribute(name) {
      this.attributes.delete(name);
      if (name === 'id') this.id = '';
    }
    appendChild(child) {
      child.parentElement = this;
      this.childNodes.push(child);
      return child;
    }
    remove() {
      if (!this.parentElement) return;
      const idx = this.parentElement.childNodes.indexOf(this);
      if (idx >= 0) this.parentElement.childNodes.splice(idx, 1);
      this.parentElement = null;
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    dispatchEvent(type, event = {}) {
      for (const fn of this.listeners.get(type) || []) {
        fn(event);
      }
    }
    getBoundingClientRect() {
      return { left: 100, top: 100, width: 80, height: 28 };
    }
    set textContent(value) {
      this.childNodes = [];
      if (value !== '') {
        this.appendChild(new MockText(String(value)));
      }
    }
    get textContent() {
      return this.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
    }
    matchesSingle(sel) {
      const s = sel.trim();
      if (!s) return false;
      const attrMatch = s.match(/^\[([a-zA-Z0-9_-]+)(?:(\^?=)"([^"]*)")?\]$/);
      if (attrMatch) {
        const [, attr, op, expected] = attrMatch;
        if (!this.hasAttribute(attr)) return false;
        if (!op) return true;
        const actual = this.getAttribute(attr);
        return op === '^=' ? actual.startsWith(expected) : actual === expected;
      }
      if (s.startsWith('.')) return (this.getAttribute('class') || '').split(/\s+/).includes(s.slice(1));
      if (s.startsWith('#')) return this.id === s.slice(1);
      return this.tagName === s.toUpperCase();
    }
    closest(selectorList) {
      const selectors = selectorList.split(',').map(s => s.trim()).filter(Boolean);
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (selectors.some(sel => cur.matchesSingle(sel))) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(selectorList) {
      const selectors = selectorList.split(',').map(s => s.trim()).filter(Boolean);
      const out = [];
      const walk = node => {
        for (const child of node.childNodes || []) {
          if (child.nodeType === 1) {
            if (selectors.some(sel => child.matchesSingle(sel))) out.push(child);
            walk(child);
          }
        }
      };
      walk(this);
      return out;
    }
  }

  const doc = {
    nodeType: 9,
    readyState: 'complete',
    documentElement: new MockElement('html'),
    body: new MockElement('body'),
    createElement(tag) {
      return new MockElement(tag);
    },
    createTextNode(text) {
      return new MockText(text);
    },
    createTreeWalker(root, whatToShow = 4, filter = null) {
      const collected = [];
      const SHOW_ELEMENT = 1;
      const SHOW_TEXT = 4;
      const FILTER_ACCEPT = 1;
      const FILTER_REJECT = 2;

      const visit = (node, includeSelf) => {
        if (includeSelf) {
          const matchesMask =
            (node.nodeType === 1 && (whatToShow & SHOW_ELEMENT)) ||
            (node.nodeType === 3 && (whatToShow & SHOW_TEXT));
          if (matchesMask) {
            const verdict = filter?.acceptNode ? filter.acceptNode(node) : FILTER_ACCEPT;
            if (verdict === FILTER_REJECT) return;
            if (verdict === FILTER_ACCEPT) collected.push(node);
          }
        }
        for (const child of node.childNodes || []) {
          visit(child, true);
        }
      };
      visit(root, false);
      let idx = 0;
      return {
        nextNode() {
          return idx < collected.length ? collected[idx++] : null;
        }
      };
    },
    querySelectorAll(selectorList) {
      return this.documentElement.querySelectorAll(selectorList);
    }
  };
  doc.documentElement.parentElement = null;
  doc.documentElement.appendChild(doc.body);

  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.disconnected = false;
      observerInstance = this;
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
    trigger(records) {
      if (!this.disconnected) this.cb(records);
    }
  }

  const storage = new Map();
  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    }
  };
  win.top = win;

  return {
    doc,
    win,
    storage,
    MockText,
    MockElement,
    getObserver: () => observerInstance,
    MockMutationObserver
  };
}

test('dictionary integrity: pruned, deduplicated, and dynamic rules work', () => {
  assert.ok(BUILTIN_PAIRS.length >= 2500, `expected >= 2500 pairs, got ${BUILTIN_PAIRS.length}`);
  const map = new Map(BUILTIN_PAIRS);
  assert.equal(map.size, BUILTIN_PAIRS.length, 'BUILTIN_PAIRS must not contain duplicate keys');

  for (const excluded of ['Compact layout', 'Context ring', 'Usage heatmap', 'Official prices', 'API equivalent']) {
    assert.equal(map.has(excluded), false, `Powertools-only entry should be pruned: ${excluded}`);
  }
  for (const [k, v] of BUILTIN_PAIRS) {
    assert.equal(/TeacherXu|徐老师/i.test(v), false, `Third-party branding should be filtered: ${k}`);
  }
  for (const kept of [
    'Settings', 'Copy', 'Close', 'Cancel', 'Delete', 'Rename',
    'Files Changed', 'Terminals', 'Plan Mode', 'Thinking effort',
    'No Model Selected', 'Permission Preset', 'Allow Once', 'Discard'
  ]) {
    assert.equal(map.has(kept), true, `Expected UI entry should be present: ${kept}`);
  }
  assert.equal(map.get('Explored files'), '已探索文件');
  assert.equal(map.get('Analyzed'), '已分析');
  assert.equal(map.get('Exploring files'), '正在探索文件');
  assert.equal(map.get('Ran command'), '已运行命令');
  assert.equal(map.get('Edited files'), '已编辑文件');
  assert.equal(map.get('Waiting for approval'), '等待批准');
  assert.equal(map.get('Background Task Output'), '后台任务输出');
  assert.equal(map.get('+ Add Hook'), '+ 添加钩子');
  assert.equal(map.get('Access rules'), '访问规则');
  assert.equal(map.get('Orchestrator'), '编排器（Orchestrator）');
  assert.equal(map.get('Inbox Mode'), '收件箱模式');
  assert.equal(map.get('Auto-Resolve'), '自动解决');
  assert.equal(map.get('Plugin permissions'), '插件权限');
  assert.equal(map.get('Dictation languages'), '听写语言');
  assert.equal(map.get('Yes, allow for this task'), '是，仅在本次任务中允许');
  assert.equal(map.get('Could not load earlier posts'), '无法加载更早消息');
  assert.equal(map.get('Save Image As...'), '图片另存为…');
  assert.equal(map.get('Conversation Log'), '对话日志');
  assert.equal(map.get('Extra High'), '极高');
  assert.equal(map.get('Leaving Soon'), '即将下线');
  assert.equal(map.get('Applies to /btw and messages sent after this turn'), '适用于 /btw 及本轮之后发送的消息');
  assert.equal(map.get('Applies to messages sent after this turn'), '适用于本轮之后发送的消息');
  assert.equal(map.get('Delete Skill'), '删除技能');
  assert.equal(map.get('Enable Recommended Skills'), '启用推荐技能');
  assert.equal(map.get('Copy Config File Path'), '复制配置文件路径');
  assert.equal(map.get('Marketplace notice'), '市场提示');
  assert.equal(map.get('Starting...'), '正在启动…');
  assert.equal(map.get('Stopping...'), '正在停止…');

  assert.equal(translateDynamic('Your Plan: Ultra'), '当前套餐：Ultra');
  assert.equal(translateDynamic('Resets in 2h 30m'), '2 小时 30 分钟后重置');
  assert.equal(translateDynamic('5 tools'), '5 个工具');
  assert.equal(translateDynamic('See all (12)'), '查看全部 (12)');
  assert.equal(translateDynamic('View all (8)'), '查看全部 (8)');
  assert.equal(translateDynamic('Available AI Credits: $10.00'), '可用 AI 积分：$10.00');
  assert.equal(translateDynamic('3 files changed'), '3 个文件已更改');
  assert.equal(translateDynamic('45% left'), '剩余 45%');
  assert.equal(translateDynamic('3 minutes ago'), '3 分钟前');
  assert.equal(translateDynamic('2h ago'), '2 小时前');
  assert.equal(translateDynamic('2y ago'), '2 年前');
  assert.equal(translateDynamic('Thought for 12s'), '思考了 12 秒');
  assert.equal(translateDynamic('Worked for 1m 20s'), '已工作 1 分钟 20 秒');
  assert.equal(translateDynamic('Working for 45s'), '正在工作 45 秒');
  assert.equal(translateDynamic('Running for 2m 5s'), '已运行 2 分钟 5 秒');
  assert.equal(translateDynamic('Thought for <1s'), '思考了 <1 秒');
  assert.equal(translateDynamic('Thought for less than a second'), '思考了不到 1 秒');
  assert.equal(translateDynamic('Thought for less than a minute'), '思考了不到 1 分钟');
  assert.equal(translateDynamic('Explored 3 files'), '已探索 3 个文件');
  assert.equal(translateDynamic('Analyzed 2 files'), '已分析 2 个文件');
  assert.equal(translateDynamic('Ran 4 commands'), '已运行 4 条命令');
  assert.equal(translateDynamic('Explored 2 files, 1 search'), '已探索 2 个文件、1 次搜索');
  assert.equal(translateDynamic('Explored 1 file and 2 searches'), '已探索 1 个文件、2 次搜索');
  assert.equal(translateDynamic('Analyzed dictionary.mjs #L1-120'), '已分析 dictionary.mjs #L1-120');
  assert.equal(translateDynamic('Analyzed Task Logs'), '已分析 任务日志');
  assert.equal(translateDynamic('Hi Alice, what can we get done today?'), '你好，Alice，今天想完成什么？');
  assert.equal(translateDynamic('Welcome back, Bob. Where should we pick up?'), '欢迎回来，Bob，我们从哪里继续？');
  assert.equal(translateDynamic("You haven't used any of your weekly limit."), '你尚未使用周额度。');
  assert.equal(translateDynamic('10m limit'), '10 分钟限额');
  assert.equal(translateDynamic('Rules: 1,200 tokens'), '规则：1,200 tokens');
  assert.equal(translateDynamic('3 excluded'), '3 项已排除');
  assert.equal(translateDynamic('See 5 more'), '再看 5 项');
  assert.equal(translateDynamic('Step 2 of 5'), '第 2 步，共 5 步');
  assert.equal(translateDynamic('Connecting to dev-box…'), '正在连接到 dev-box…');
  assert.equal(translateDynamic('More options for GitHub'), 'GitHub 的更多选项');
  assert.equal(translateDynamic('4 subagents'), '4 个子智能体');
  assert.equal(translateDynamic('2 warnings'), '2 条警告');
  assert.equal(translateDynamic('Version 2.34.0'), '版本 2.34.0');
  assert.equal(translateDynamic('Version 2.35.1'), '版本 2.35.1');
  assert.equal(translateDynamic('Version 2.35.2'), '版本 2.35.2');
  assert.equal(translateDynamic('+3 more'), '还有 3 项');
  assert.equal(translateDynamic('Move this conversation to "My Project"?'), '要将此对话移至“My Project”吗？');
  assert.equal(translateDynamic('Revoke all: GitHub'), '全部撤销：GitHub');
  assert.equal(translateDynamic('All 3 will be revoked. The plugin will ask before doing this again.'), '将撤销全部 3 项权限。之后此插件在执行相关操作前会重新向你询问。');
  assert.equal(translateDynamic('Allowed in demo-repo'), '已在 demo-repo 中允许');
  assert.equal(translateDynamic('Allowed in this conversation'), null);
  assert.equal(translateDynamic('No matching languages for "xyz"'), '未找到与“xyz”匹配的语言');
  assert.equal(translateDynamic('Show 20 earlier posts (45 older)'), '显示更早的 20 条消息（还有 45 条较早消息）');
  assert.equal(translateDynamic('Loading earlier posts… (45 older)'), '正在加载更早消息…（还有 45 条较早消息）');
  assert.equal(translateDynamic('Retry loading 20 earlier posts'), '重试加载 20 条更早消息');
  assert.equal(translateDynamic('20 earlier posts could not be loaded.'), '有 20 条更早消息未能加载。');
  assert.equal(translateDynamic('2 waiting'), '2 项待处理');
  assert.equal(translateDynamic('Gemini 4 Neon Extra High'), 'Gemini 4 Neon 极高');
  assert.equal(translateDynamic('Claude Opus 5.5 Medium'), 'Claude Opus 5.5 中');
  assert.equal(translateDynamic('GPT-OSS 120B (Medium)'), null);
  assert.equal(translateDynamic('3/3 steps'), '3/3 步');
  assert.equal(translateDynamic('Open the agy-zh plugin'), '打开 agy-zh 插件');
});

test('settings store validates, persists atomically, and merges custom dictionary', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agy-i18n-settings-'));
  try {
    const store = createSettingsStore(tempDir);
    assert.deepEqual(store.get(), DEFAULT_SETTINGS);

    const updated = store.set({ language: 'en', floatingButton: true });
    assert.deepEqual(updated, { language: 'en', floatingButton: true });
    assert.deepEqual(createSettingsStore(tempDir).get(), { language: 'en', floatingButton: true });

    assert.throws(() => store.set({ language: 'zh-TW' }));
    assert.throws(() => store.set({ floatingButton: 'yes' }));
    assert.throws(() => store.set({ unknownKey: true }));
    assert.throws(() => store.set([]));

    writeFileSync(
      store.customDictionaryPath,
      JSON.stringify({
        Settings: '偏好设置',
        'Custom Item': '自定义条目',
        BadNumber: 123,
        Empty: '   '
      }),
      'utf8'
    );
    const customPairs = store.loadCustomDictionary();
    assert.deepEqual(customPairs, [
      ['Settings', '偏好设置'],
      ['Custom Item', '自定义条目']
    ]);

    const merged = new Map(mergeDictionaryPairs(customPairs));
    assert.equal(merged.get('Settings'), '偏好设置');
    assert.equal(merged.get('Custom Item'), '自定义条目');
    assert.equal(merged.get('Copy'), '复制');

    writeFileSync(store.customDictionaryPath, '{invalid json', 'utf8');
    assert.deepEqual(store.loadCustomDictionary(), []);

    // Custom entry upsert, overwrite, and delete
    assert.deepEqual(store.setCustomEntry('  Hello  ', '  你好  '), [['Hello', '你好']]);
    assert.deepEqual(store.setCustomEntry('Hello', '哈喽'), [['Hello', '哈喽']]);
    assert.deepEqual(store.setCustomEntry('World', '世界'), [['Hello', '哈喽'], ['World', '世界']]);
    assert.deepEqual(createSettingsStore(tempDir).loadCustomDictionary(), [['Hello', '哈喽'], ['World', '世界']]);
    assert.throws(() => store.setCustomEntry('', '空'));
    assert.throws(() => store.setCustomEntry('EmptyVal', '   '));
    assert.deepEqual(store.removeCustomEntry('Hello'), [['World', '世界']]);
    assert.deepEqual(createSettingsStore(tempDir).loadCustomDictionary(), [['World', '世界']]);
    assert.throws(() => store.removeCustomEntry('   '));

    const winShortcutCmd = createDebugShortcutCommand({ platform: 'win32', env: {}, home: 'C:\\DemoHome', exists: () => false });
    assert.ok(winShortcutCmd.includes('--remote-debugging-port=0'));
    assert.ok(winShortcutCmd.includes('Antigravity (调试模式).lnk'));
    assert.equal(createDebugShortcutCommand({ platform: 'darwin' }), '');
    assert.equal(createDebugShortcutCommand({ platform: 'linux' }), '');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('DOM localizer translates UI, respects exclusions and aria-label, toggles EN/ZH, and disposes cleanly', () => {
  const { doc, win, storage, MockText, MockElement, getObserver, MockMutationObserver } = createDomMock();

  const sidebar = new MockElement('nav');
  sidebar.setAttribute('aria-label', 'Sidebar');
  const settingsBtn = new MockElement('button');
  const settingsText = new MockText('  Settings  ');
  settingsBtn.appendChild(settingsText);
  settingsBtn.setAttribute('title', 'Resets in 2h 30m');
  const searchInput = new MockElement('input');
  searchInput.setAttribute('placeholder', 'Search projects');
  const multilineBtn = new MockElement('span');
  const multilineText = new MockText('Check for\n  updates');
  multilineBtn.appendChild(multilineText);
  const uppercaseHeading = new MockElement('span');
  const uppercaseText = new MockText('GLOBAL SETTINGS');
  uppercaseHeading.appendChild(uppercaseText);
  const lowerHeading = new MockElement('span');
  const lowerText = new MockText('new conversation');
  lowerHeading.appendChild(lowerText);
  const singleUnknown = new MockElement('span');
  const singleUnknownText = new MockText('settings-custom-token');
  singleUnknown.appendChild(singleUnknownText);
  const colonLabel = new MockElement('span');
  const colonText = new MockText('Model:');
  colonLabel.appendChild(colonText);
  const ellipsisLabel = new MockElement('span');
  const ellipsisText = new MockText('Loading…');
  ellipsisLabel.appendChild(ellipsisText);
  const exploredFilesLabel = new MockElement('span');
  const exploredFilesText = new MockText('Explored files');
  exploredFilesLabel.appendChild(exploredFilesText);
  const analyzedRow = new MockElement('div');
  const analyzedVerb = new MockElement('span');
  const analyzedVerbText = new MockText('Analyzed ');
  analyzedVerb.appendChild(analyzedVerbText);
  const analyzedTarget = new MockElement('span');
  const analyzedTargetText = new MockText('i18n-client.js #L1-505');
  analyzedTarget.appendChild(analyzedTargetText);
  analyzedRow.appendChild(analyzedVerb);
  analyzedRow.appendChild(analyzedTarget);
  const tooltipBtn = new MockElement('button');
  tooltipBtn.setAttribute('aria-label', 'Copy');
  tooltipBtn.setAttribute('data-tooltip-content', 'Copy link');
  const tooltipBtnText = new MockText('Copy');
  tooltipBtn.appendChild(tooltipBtnText);

  const multiLabel = new MockElement('span');
  const multiPrefix = new MockText('Thought for ');
  const multiNum = new MockText('12s');
  multiLabel.appendChild(multiPrefix);
  multiLabel.appendChild(multiNum);

  const creditsLabel = new MockElement('span');
  const creditsText = new MockText('Available AI Credits: $10.00');
  creditsLabel.appendChild(creditsText);

  const convRow = new MockElement('div');
  convRow.setAttribute('data-testid', 'conversation-row-1');
  const convTitle = new MockElement('span');
  const convTitleText = new MockText('Settings');
  convTitle.appendChild(convTitleText);
  const convTime = new MockElement('time');
  const convTimeText = new MockText('2h ago');
  convTime.appendChild(convTimeText);
  const convBtn = new MockElement('button');
  convBtn.setAttribute('title', 'More options');
  const convBtnText = new MockText('Rename');
  convBtn.appendChild(convBtnText);
  convRow.appendChild(convTitle);
  convRow.appendChild(convTime);
  convRow.appendChild(convBtn);

  const accountBtn = new MockElement('button');
  const accountSpan1 = new MockElement('span');
  const accountSpan1Text = new MockText('Default');
  accountSpan1.appendChild(accountSpan1Text);
  const accountSpan2 = new MockElement('span');
  const accountSpan2Text = new MockText('alice@example.com');
  accountSpan2.appendChild(accountSpan2Text);
  accountBtn.appendChild(accountSpan1);
  accountBtn.appendChild(accountSpan2);

  const feedbackBtn = new MockElement('button');
  const feedbackText = new MockText('Send feedback as alice@example.com');
  feedbackBtn.appendChild(feedbackText);

  const breadcrumbSegment = new MockElement('span');
  breadcrumbSegment.setAttribute('data-testid', 'breadcrumb-segment');
  breadcrumbSegment.setAttribute('role', 'button');
  const breadcrumbLabel = new MockElement('span');
  const breadcrumbText = new MockText('Settings');
  breadcrumbLabel.appendChild(breadcrumbText);
  breadcrumbSegment.appendChild(breadcrumbLabel);

  const permTriggerCmd = new MockElement('div');
  permTriggerCmd.setAttribute('data-testid', 'permission-trigger-command');
  const permLabel = new MockElement('span');
  const permLabelText = new MockText('Permission');
  permLabel.appendChild(permLabelText);
  const permMono = new MockElement('span');
  permMono.setAttribute('class', 'font-mono');
  const permMonoText = new MockText('Settings');
  permMono.appendChild(permMonoText);
  permTriggerCmd.appendChild(permLabel);
  permTriggerCmd.appendChild(permMono);

  const dictationOption = new MockElement('div');
  dictationOption.setAttribute('data-testid', 'dictation-language-option-en');
  const dictationSpan = new MockElement('span');
  const dictationText = new MockText('English');
  dictationSpan.appendChild(dictationText);
  dictationOption.appendChild(dictationSpan);

  const coordHoverTitle = new MockElement('div');
  coordHoverTitle.setAttribute('data-testid', 'coordinator-hover-card-title');
  const coordHoverSpan = new MockElement('span');
  const coordHoverText = new MockText('Settings');
  coordHoverSpan.appendChild(coordHoverText);
  coordHoverTitle.appendChild(coordHoverSpan);

  sidebar.appendChild(settingsBtn);
  sidebar.appendChild(searchInput);
  sidebar.appendChild(multilineBtn);
  sidebar.appendChild(uppercaseHeading);
  sidebar.appendChild(lowerHeading);
  sidebar.appendChild(singleUnknown);
  sidebar.appendChild(colonLabel);
  sidebar.appendChild(ellipsisLabel);
  sidebar.appendChild(exploredFilesLabel);
  sidebar.appendChild(analyzedRow);
  sidebar.appendChild(tooltipBtn);
  sidebar.appendChild(multiLabel);
  sidebar.appendChild(creditsLabel);
  sidebar.appendChild(convRow);
  sidebar.appendChild(accountBtn);
  sidebar.appendChild(feedbackBtn);
  sidebar.appendChild(breadcrumbSegment);
  sidebar.appendChild(permTriggerCmd);
  sidebar.appendChild(dictationOption);
  sidebar.appendChild(coordHoverTitle);

  const chatReply = new MockElement('div');
  chatReply.setAttribute('data-testid', 'planner-response-text');
  const chatText = new MockText('Settings');
  chatReply.appendChild(chatText);

  const codeBlock = new MockElement('pre');
  const codeText = new MockText('Cancel');
  codeBlock.appendChild(codeText);

  const editable = new MockElement('div');
  editable.setAttribute('contenteditable', 'true');
  const editableText = new MockText('Copy');
  editable.appendChild(editableText);

  const monaco = new MockElement('div');
  monaco.setAttribute('class', 'monaco-editor');
  const monacoText = new MockText('Settings');
  monaco.appendChild(monacoText);

  const xterm = new MockElement('div');
  xterm.setAttribute('class', 'xterm');
  const xtermText = new MockText('Settings');
  xterm.appendChild(xtermText);

  const monacoDiff = new MockElement('div');
  monacoDiff.setAttribute('class', 'monaco-diff-editor');
  const monacoDiffText = new MockText('Settings');
  monacoDiff.appendChild(monacoDiffText);

  const viewLines = new MockElement('div');
  viewLines.setAttribute('class', 'view-lines');
  const viewLinesText = new MockText('Copy');
  viewLines.appendChild(viewLinesText);

  const codeBlockCls = new MockElement('div');
  codeBlockCls.setAttribute('class', 'code-block');
  const codeBlockClsText = new MockText('Settings');
  codeBlockCls.appendChild(codeBlockClsText);

  const kbdEl = new MockElement('kbd');
  const kbdText = new MockText('Copy');
  kbdEl.appendChild(kbdText);

  doc.body.appendChild(sidebar);
  doc.body.appendChild(chatReply);
  doc.body.appendChild(codeBlock);
  doc.body.appendChild(editable);
  doc.body.appendChild(monaco);
  doc.body.appendChild(xterm);
  doc.body.appendChild(monacoDiff);
  doc.body.appendChild(viewLines);
  doc.body.appendChild(codeBlockCls);
  doc.body.appendChild(kbdEl);

  const hostEvents = [];
  const context = vm.createContext({
    document: doc,
    window: win,
    MutationObserver: MockMutationObserver,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    localStorage: {
      getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v))
    },
    __agyI18nHost: payload => hostEvents.push(JSON.parse(payload)),
    __agyI18nConfig: {
      version: '1.1.0',
      language: 'zh-CN',
      floatingButton: true,
      isTopFrame: true,
      pairs: mergeDictionaryPairs([['Custom Entry', '自定义项']]),
      translateDynamic
    }
  });
  context.globalThis = context;
  vm.runInContext(CLIENT_SOURCE, context);

  // Regular UI translated while whitespace preserved
  assert.equal(settingsText.nodeValue, '  设置  ');
  assert.equal(settingsBtn.getAttribute('title'), '2 小时 30 分钟后重置');
  assert.equal(searchInput.getAttribute('placeholder'), '搜索项目');
  assert.equal(multilineText.nodeValue, '检查更新');
  assert.equal(uppercaseText.nodeValue, '全局设置');
  assert.equal(lowerText.nodeValue, '新建会话');
  assert.equal(singleUnknownText.nodeValue, 'settings-custom-token');
  assert.equal(colonText.nodeValue, '模型：');
  assert.equal(ellipsisText.nodeValue, '正在加载…');
  assert.equal(exploredFilesText.nodeValue, '已探索文件');
  assert.equal(analyzedVerbText.nodeValue, '已分析 ');
  assert.equal(analyzedTargetText.nodeValue, 'i18n-client.js #L1-505');
  assert.equal(tooltipBtn.getAttribute('data-tooltip-content'), '复制链接');
  assert.equal(tooltipBtn.getAttribute('aria-label'), 'Copy');
  assert.equal(tooltipBtnText.nodeValue, '复制');
  assert.equal(multiPrefix.nodeValue, '思考了 12 秒');
  assert.equal(multiNum.nodeValue, '');
  assert.equal(creditsText.nodeValue, '可用 AI 积分：$10.00');
  assert.equal(convTitleText.nodeValue, 'Settings');
  assert.equal(convTimeText.nodeValue, '2 小时前');
  assert.equal(convBtnText.nodeValue, '重命名');
  assert.equal(convBtn.getAttribute('title'), '更多操作');
  assert.equal(accountSpan1Text.nodeValue, 'Default');
  assert.equal(accountSpan2Text.nodeValue, 'alice@example.com');
  assert.equal(feedbackText.nodeValue, '以 alice@example.com 提交反馈');
  assert.equal(breadcrumbText.nodeValue, 'Settings');
  assert.equal(permLabelText.nodeValue, '权限');
  assert.equal(permMonoText.nodeValue, 'Settings');
  assert.equal(dictationText.nodeValue, 'English');
  assert.equal(coordHoverText.nodeValue, 'Settings');

  // Simulate React updating split text child node
  multiNum.nodeValue = '13s';
  getObserver().trigger([{ type: 'characterData', target: multiNum }]);
  assert.equal(multiPrefix.nodeValue, '思考了 13 秒');
  assert.equal(multiNum.nodeValue, '');

  // aria-label untouched
  assert.equal(sidebar.getAttribute('aria-label'), 'Sidebar');

  // Excluded nodes untouched
  assert.equal(chatText.nodeValue, 'Settings');
  assert.equal(codeText.nodeValue, 'Cancel');
  assert.equal(editableText.nodeValue, 'Copy');
  assert.equal(monacoText.nodeValue, 'Settings');
  assert.equal(xtermText.nodeValue, 'Settings');
  assert.equal(monacoDiffText.nodeValue, 'Settings');
  assert.equal(viewLinesText.nodeValue, 'Copy');
  assert.equal(codeBlockClsText.nodeValue, 'Settings');
  assert.equal(kbdText.nodeValue, 'Copy');

  // Floating pill mounted and toggles language + notifies host
  const pill = doc.body.childNodes.find(el => el.id === 'agy-i18n-floating-pill');
  assert.ok(pill, 'floating pill should be mounted');
  assert.equal(pill.getAttribute('data-agy-i18n-ui'), 'true');
  pill.dispatchEvent('click', {});
  assert.equal(context.__agyI18n.language, 'en');
  assert.deepEqual(hostEvents, [{ type: 'setLanguage', language: 'en' }]);
  assert.equal(settingsText.nodeValue, '  Settings  ');
  assert.equal(exploredFilesText.nodeValue, 'Explored files');
  assert.equal(analyzedVerbText.nodeValue, 'Analyzed ');
  assert.equal(analyzedTargetText.nodeValue, 'i18n-client.js #L1-505');
  assert.equal(tooltipBtn.getAttribute('data-tooltip-content'), 'Copy link');
  assert.equal(tooltipBtnText.nodeValue, 'Copy');
  assert.equal(multiPrefix.nodeValue, 'Thought for ');
  assert.equal(multiNum.nodeValue, '13s');
  assert.equal(feedbackText.nodeValue, 'Send feedback as alice@example.com');
  assert.equal(settingsBtn.getAttribute('title'), 'Resets in 2h 30m');
  assert.equal(searchInput.getAttribute('placeholder'), 'Search projects');

  // Switch back to zh-CN and test MutationObserver + updatePairs
  context.__agyI18n.apply('zh-CN', true);
  assert.equal(settingsText.nodeValue, '  设置  ');
  assert.equal(exploredFilesText.nodeValue, '已探索文件');
  assert.equal(analyzedVerbText.nodeValue, '已分析 ');
  assert.equal(tooltipBtn.getAttribute('data-tooltip-content'), '复制链接');
  assert.equal(multiPrefix.nodeValue, '思考了 13 秒');
  assert.equal(multiNum.nodeValue, '');
  assert.equal(feedbackText.nodeValue, '以 alice@example.com 提交反馈');

  const addedLabel = new MockElement('span');
  const addedText = new MockText('Custom Entry');
  addedLabel.appendChild(addedText);
  sidebar.appendChild(addedLabel);
  getObserver().trigger([{ type: 'childList', addedNodes: [addedLabel] }]);
  assert.equal(addedText.nodeValue, '自定义项');

  // Remove custom entry via updatePairs -> restores original English for that node
  context.__agyI18n.updatePairs(BUILTIN_PAIRS);
  assert.equal(addedText.nodeValue, 'Custom Entry');
  assert.equal(settingsText.nodeValue, '  设置  ');

  // Dispose restores everything and disconnects observer
  context.__agyI18n.dispose();
  assert.equal(getObserver().disconnected, true);
  assert.equal(settingsText.nodeValue, '  Settings  ');
  assert.equal(multilineText.nodeValue, 'Check for\n  updates');
  assert.equal(uppercaseText.nodeValue, 'GLOBAL SETTINGS');
  assert.equal(colonText.nodeValue, 'Model:');
  assert.equal(ellipsisText.nodeValue, 'Loading…');
  assert.equal(exploredFilesText.nodeValue, 'Explored files');
  assert.equal(analyzedVerbText.nodeValue, 'Analyzed ');
  assert.equal(analyzedTargetText.nodeValue, 'i18n-client.js #L1-505');
  assert.equal(tooltipBtn.getAttribute('data-tooltip-content'), 'Copy link');
  assert.equal(tooltipBtn.hasAttribute('data-agy-i18n-orig-data-tooltip-content'), false);
  assert.equal(tooltipBtn.getAttribute('aria-label'), 'Copy');
  assert.equal(multiPrefix.nodeValue, 'Thought for ');
  assert.equal(multiNum.nodeValue, '13s');
  assert.equal(feedbackText.nodeValue, 'Send feedback as alice@example.com');
  assert.equal(settingsBtn.getAttribute('title'), 'Resets in 2h 30m');
  assert.equal(searchInput.getAttribute('placeholder'), 'Search projects');
  assert.equal(settingsBtn.hasAttribute('data-agy-i18n-orig-title'), false);
  assert.equal(doc.body.childNodes.some(el => el.id === 'agy-i18n-floating-pill'), false);
  assert.equal(context.__agyI18n, undefined);
});

test('buildInjectionScript serializes self-contained translateDynamic and runs in isolated VM', () => {
  const { doc, win, MockElement, MockText, MockMutationObserver } = createDomMock();
  const label = new MockElement('span');
  const txt = new MockText('Thought for 1m 20s');
  label.appendChild(txt);
  const comboLabel = new MockElement('span');
  const comboTxt = new MockText('Explored 2 files, 1 search');
  comboLabel.appendChild(comboTxt);
  const actionLabel = new MockElement('span');
  const actionTxt = new MockText('Analyzed dictionary.mjs #L1-120');
  actionLabel.appendChild(actionTxt);
  const splitLabel = new MockElement('span');
  const splitPrefix = new MockText('Thought for ');
  const splitDur = new MockText('5s');
  splitLabel.appendChild(splitPrefix);
  splitLabel.appendChild(splitDur);
  const swarmEarlierLabel = new MockElement('span');
  const swarmEarlierTxt = new MockText('Show 20 earlier posts (45 older)');
  swarmEarlierLabel.appendChild(swarmEarlierTxt);
  const modelEffortLabel = new MockElement('span');
  modelEffortLabel.setAttribute('class', 'opacity-70');
  const modelEffortLead = new MockText(' ');
  const modelEffortTxt = new MockText('Gemini 4 Neon Extra High');
  modelEffortLabel.appendChild(modelEffortLead);
  modelEffortLabel.appendChild(modelEffortTxt);
  doc.body.appendChild(label);
  doc.body.appendChild(comboLabel);
  doc.body.appendChild(actionLabel);
  doc.body.appendChild(splitLabel);
  doc.body.appendChild(swarmEarlierLabel);
  doc.body.appendChild(modelEffortLabel);

  const script = buildInjectionScript({
    version: '1.3.2',
    language: 'zh-CN',
    floatingButton: false,
    pairs: BUILTIN_PAIRS,
    origin: 'https://127.0.0.1:8443',
    isSwarm: false
  });
  const vmWin = { ...win };
  vmWin.top = vmWin;
  let staleDisposed = false;
  const ctx = vm.createContext({
    document: doc,
    window: vmWin,
    location: { origin: 'https://127.0.0.1:8443', href: 'https://127.0.0.1:8443/c/1' },
    MutationObserver: MockMutationObserver,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    __agyI18n: {
      version: '1.3.2',
      dispose() {
        staleDisposed = true;
      }
    }
  });
  ctx.globalThis = ctx;
  vm.runInContext(script, ctx);

  assert.equal(staleDisposed, true);
  assert.match(ctx.__agyI18n.buildId, /^[0-9a-f]{12}$/);

  const freshInstance = ctx.__agyI18n;
  let freshDisposed = false;
  const origDispose = freshInstance.dispose;
  freshInstance.dispose = () => {
    freshDisposed = true;
    origDispose();
  };
  vm.runInContext(script, ctx);
  assert.equal(freshDisposed, false);
  assert.equal(ctx.__agyI18n, freshInstance);
  freshInstance.dispose = origDispose;

  assert.equal(txt.nodeValue, '思考了 1 分钟 20 秒');
  assert.equal(comboTxt.nodeValue, '已探索 2 个文件、1 次搜索');
  assert.equal(actionTxt.nodeValue, '已分析 dictionary.mjs #L1-120');
  assert.equal(splitPrefix.nodeValue, '思考了 5 秒');
  assert.equal(splitDur.nodeValue, '');
  assert.equal(swarmEarlierTxt.nodeValue, '显示更早的 20 条消息（还有 45 条较早消息）');
  assert.equal(modelEffortLead.nodeValue, ' Gemini 4 Neon 极高');
  assert.equal(modelEffortTxt.nodeValue, '');
  ctx.__agyI18n.dispose();
  assert.equal(splitPrefix.nodeValue, 'Thought for ');
  assert.equal(splitDur.nodeValue, '5s');
  assert.equal(modelEffortLead.nodeValue, ' ');
  assert.equal(modelEffortTxt.nodeValue, 'Gemini 4 Neon Extra High');
});

test('Web UI HTTP server handles auth, language toggle, validation, and dictionary reload', async () => {
  let state = { language: 'zh-CN', floatingButton: false };
  let reloads = 0;
  let customMap = new Map();

  const buildSnapshot = () => ({
    settings: state,
    cdp: { connected: true, debugPortReached: true, hubCount: 1, swarmCount: 0 },
    dictionary: {
      builtinCount: BUILTIN_PAIRS.length,
      customCount: customMap.size,
      customEntries: [...customMap.entries()]
    },
    launchCommand: 'Antigravity.exe --remote-debugging-port=0',
    shortcutCommand: 'powershell -NoProfile -Command "..."'
  });

  const close = await startWebUi({
    port: 0,
    allowEphemeral: true,
    token: 'secret-token',
    version: '1.3.2',
    getStatus: buildSnapshot,
    onSetSettings: async patch => {
      if (patch.language && !['zh-CN', 'en'].includes(patch.language)) {
        throw new Error('无效语言');
      }
      state = { ...state, ...patch };
      return buildSnapshot();
    },
    onReloadDictionary: async () => {
      reloads++;
      return {
        settings: state,
        dictionary: { builtinCount: BUILTIN_PAIRS.length, customCount: 2, customEntries: [...customMap.entries()] }
      };
    },
    onUpsertCustomEntry: async ({ en, zh }) => {
      if (!en.trim() || !zh.trim()) throw new Error('词条不能为空');
      customMap.set(en.trim(), zh.trim());
      return buildSnapshot();
    },
    onDeleteCustomEntry: async ({ en }) => {
      if (!en.trim()) throw new Error('英文原文不能为空');
      customMap.delete(en.trim());
      return buildSnapshot();
    }
  });

  try {
    const base = `http://127.0.0.1:${close.port}`;

    const htmlRes = await fetch(`${base}/?token=secret-token`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('<script src="/preload.js"></script>'));
    assert.ok(html.includes('简体中文'));
    assert.ok(html.includes('English'));
    assert.ok(html.includes('id="custom-en"'));
    assert.ok(html.includes('id="custom-zh"'));
    assert.ok(html.includes('id="custom-add-btn"'));
    assert.ok(html.includes('https://github.com/Aloira-ai/antigravity-zh-plugin/releases'));
    assert.ok(html.includes('Antigravity 界面汉化'));

    const unauth = await fetch(`${base}/api/status`);
    assert.equal(unauth.status, 401);

    const unauthDict = await fetch(`${base}/api/custom-dictionary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ en: 'Test', zh: '测试' })
    });
    assert.equal(unauthDict.status, 401);

    const statusRes = await fetch(`${base}/api/status`, {
      headers: { 'x-sidecar-token': 'secret-token' }
    });
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.settings.language, 'zh-CN');

    const badRes = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'ja' })
    });
    assert.equal(badRes.status, 400);

    const toggleRes = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'en', floatingButton: true })
    });
    assert.equal(toggleRes.status, 200);
    const toggleJson = await toggleRes.json();
    assert.deepEqual(toggleJson.settings, { language: 'en', floatingButton: true });

    const reloadRes = await fetch(`${base}/api/reload-dictionary`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'content-type': 'application/json' },
      body: '{}'
    });
    assert.equal(reloadRes.status, 200);
    assert.equal(reloads, 1);

    const badCustomRes = await fetch(`${base}/api/custom-dictionary`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'content-type': 'application/json' },
      body: JSON.stringify({ en: 'OnlyEn' })
    });
    assert.equal(badCustomRes.status, 400);

    const addCustomRes = await fetch(`${base}/api/custom-dictionary`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'content-type': 'application/json' },
      body: JSON.stringify({ en: 'Workspace', zh: '工作空间' })
    });
    assert.equal(addCustomRes.status, 200);
    const addCustomJson = await addCustomRes.json();
    assert.equal(addCustomJson.dictionary.customCount, 1);
    assert.deepEqual(addCustomJson.dictionary.customEntries, [['Workspace', '工作空间']]);

    const badDelRes = await fetch(`${base}/api/custom-dictionary`, {
      method: 'DELETE',
      headers: { 'x-sidecar-token': 'secret-token', 'content-type': 'application/json' },
      body: JSON.stringify({ en: '  ' })
    });
    assert.equal(badDelRes.status, 400);

    const delCustomRes = await fetch(`${base}/api/custom-dictionary`, {
      method: 'DELETE',
      headers: { 'x-sidecar-token': 'secret-token', 'content-type': 'application/json' },
      body: JSON.stringify({ en: 'Workspace' })
    });
    assert.equal(delCustomRes.status, 200);
    const delCustomJson = await delCustomRes.json();
    assert.equal(delCustomJson.dictionary.customCount, 0);
    assert.deepEqual(delCustomJson.dictionary.customEntries, []);
  } finally {
    await close();
  }
});
