(() => {
  const cfg = globalThis.__agyI18nConfig || {};
  const version = typeof cfg.version === 'string' ? cfg.version : '1.0.0';
  const buildId = typeof cfg.buildId === 'string' ? cfg.buildId : '';
  let language = cfg.language === 'en' ? 'en' : 'zh-CN';
  let floatingButton = Boolean(cfg.floatingButton);
  const isTopFrame = cfg.isTopFrame !== undefined
    ? Boolean(cfg.isTopFrame)
    : (typeof window === 'undefined' || window === window.top);
  const translateDynamic = typeof cfg.translateDynamic === 'function' ? cfg.translateDynamic : null;

  function normalizeLookupKey(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .trim();
  }

  function buildLookupMaps(pairs) {
    const exact = new Map();
    const lower = new Map();
    if (Array.isArray(pairs)) {
      for (const entry of pairs) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const [k, v] = entry;
        if (typeof k !== 'string' || typeof v !== 'string') continue;
        exact.set(k, v);
        const normKey = normalizeLookupKey(k);
        if (normKey !== k && !exact.has(normKey)) {
          exact.set(normKey, v);
        }
        if (normKey.includes(' ') && normKey.length >= 5) {
          const lk = normKey.toLowerCase();
          if (!lower.has(lk)) lower.set(lk, v);
        }
      }
    }
    return { exact, lower };
  }

  let { exact: zhMap, lower: zhLowerMap } = buildLookupMaps(cfg.pairs);
  let disposed = false;

  const ATTR_EXCLUDED_ITEMS = [
    '[data-agy-i18n-ui]',
    '[data-no-translate]',
    '[translate="no"]',
    '[data-testid="planner-response-text"]',
    '[data-testid="progress-update-response-text"]',
    '[data-testid="user-input-step"]',
    '[data-testid="user-message-bubble"]',
    '[data-testid="user-message-content"]',
    '[data-testid="side-question-followup-user"]',
    '[data-testid="browser-subagent-thinking"]',
    '[data-testid="background-task-command"]',
    '[data-testid="setup-script-output"]',
    '[data-testid="comment-card-text"]',
    '[data-testid="markdown-code-block-preview"]',
    '[data-testid="voice-transcript-summary"]',
    '[data-testid="terminal-tab-surface"]',
    '[data-testid="csv-scroll-viewport"]',
    '[data-testid="browser-url-display"]',
    '[data-testid="project-selector-item"]',
    '[data-testid="branch-option"]',
    '[data-testid="ssh-host-project-item"]',
    '[data-testid="project-selector-github-repo-item"]',
    '[data-testid="webview-download-filename"]',
    '[data-testid="url-security-host"]',
    '[data-testid="url-security-origin"]',
    '[data-testid="automation-name"]',
    '[data-testid="automation-instructions-markdown"]',
    '[data-testid="automation-instructions-text"]',
    '[data-testid="voice-picker-name"]',
    '[data-testid="plugin-sidebar-item"]',
    '[data-testid="plugin-sidebar-mcp-app-item"]',
    '[data-testid="resource-link"]',
    '[data-testid="coordinator-hover-card-title"]',
    '[data-testid="coordinator-hover-card-description"]',
    '[data-testid="sidebar-agent-hover-card-title"]',
    '[data-testid="sidebar-agent-hover-card-description"]',
    '[data-testid="coordinators-show-item"]',
    '[data-testid="sidebar-wsl-label"]',
    '[data-testid="running-group-title"]',
    '[data-testid="inline-card-freeform-answer"]',
    '[data-testid="ask-question-entry-readonly"]',
    '[data-testid="plugin-permission-name"]',
    '[data-testid="plugin-permission-default-row"]',
    '[data-testid^="dictation-language-option-"]',
    '[data-testid^="dictation-language-pill-"]',
    '[data-testid="project-selector-clone-remote-item"]',
    '[data-testid="project-selector-clone-local-item"]',
    '[contenteditable]',
    'pre',
    'code',
    'script',
    'style',
    'iframe',
    'webview',
    '.monaco-editor',
    '.xterm',
    '[data-markdown-root]',
    '.post-body',
    '.post-md',
    '#ov-frame',
    '.raw',
    '.raw-pre',
    '.swarm-title'
  ];

  const DYNAMIC_TITLE_CONTAINERS = [
    '[data-testid^="conversation-row-"]',
    '[data-testid="side-question-row"]',
    '[data-testid="breadcrumb-segment"]',
    '[data-testid="subagent-node"]'
  ].join(',');

  const TEXT_EXCLUDED_SELECTOR = [...ATTR_EXCLUDED_ITEMS, 'textarea', 'input'].join(',');
  const ATTR_EXCLUDED_SELECTOR = ATTR_EXCLUDED_ITEMS.join(',');

  const TRANSLATED_ATTRS = ['placeholder', 'title', 'data-tooltip-content'];
  const PILL_STORAGE_KEY = 'agy-i18n-pill-pos';

  const originals = new Map();
  const attrs = new Map();

  let pillEl = null;
  let zhBadge = null;
  let enBadge = null;
  let lastPruneAt = 0;

  function lookupStatic(candidate) {
    if (!candidate) return null;
    if (zhMap.has(candidate)) return zhMap.get(candidate);
    if (candidate.includes('...')) {
      const unicodeEllipsis = candidate.replace(/\.\.\./g, '…');
      if (zhMap.has(unicodeEllipsis)) return zhMap.get(unicodeEllipsis);
    } else if (candidate.includes('…')) {
      const asciiEllipsis = candidate.replace(/…/g, '...');
      if (zhMap.has(asciiEllipsis)) return zhMap.get(asciiEllipsis);
    }
    if (candidate.includes(' ') && candidate.length >= 5) {
      const lower = candidate.toLowerCase();
      if (zhLowerMap.has(lower)) return zhLowerMap.get(lower);
      if (lower.includes('...')) {
        const lowerUnicode = lower.replace(/\.\.\./g, '…');
        if (zhLowerMap.has(lowerUnicode)) return zhLowerMap.get(lowerUnicode);
      } else if (lower.includes('…')) {
        const lowerAscii = lower.replace(/…/g, '...');
        if (zhLowerMap.has(lowerAscii)) return zhLowerMap.get(lowerAscii);
      }
    }
    return null;
  }

  function translateExactOrDynamic(text) {
    if (!text) return null;
    if (zhMap.has(text)) return zhMap.get(text);
    const norm = normalizeLookupKey(text);
    if (!norm || !/[A-Za-z]/.test(norm)) return null;
    const direct = lookupStatic(norm);
    if (direct != null) return direct;
    if (norm.endsWith(':') && norm.length > 1) {
      const stem = norm.slice(0, -1).trim();
      const stemTranslation = lookupStatic(stem);
      if (stemTranslation != null) return `${stemTranslation}：`;
    }
    return translateDynamic ? translateDynamic(norm) : null;
  }

  function isHardExcluded(el, selector = TEXT_EXCLUDED_SELECTOR) {
    if (!el || typeof el.closest !== 'function') return false;
    if (el.closest(selector)) return true;
    if (el.closest('.font-mono') && el.closest('[data-testid="permission-trigger-command"]')) return true;
    return false;
  }

  function isExcludedElement(el, selector = TEXT_EXCLUDED_SELECTOR) {
    if (!el || typeof el.closest !== 'function') return false;
    if (isHardExcluded(el, selector)) return true;
    const dynamicContainer = el.closest(DYNAMIC_TITLE_CONTAINERS);
    if (dynamicContainer) {
      const interactive = el.closest('button,[role="button"],time');
      if (!interactive || interactive === dynamicContainer) return true;
    }
    const btn = el.closest('button');
    if (btn) {
      const btnText = btn.textContent || '';
      if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(btnText) &&
          !/^\s*(?:Send feedback as |以\s+[^\s@]+@[^\s@]+\.[^\s@]+\s+提交反馈\s*$)/i.test(btnText)) {
        return true;
      }
    }
    return false;
  }

  function processTextNode(node) {
    if (!node || node.nodeType !== 3) return;
    const parent = node.parentElement;
    if (!parent || isExcludedElement(parent, TEXT_EXCLUDED_SELECTOR)) return;

    const entry = originals.get(node);
    const current = node.nodeValue ?? '';
    const original = entry && current === entry.last ? entry.original : current;
    const trimmed = original.trim();
    const translation = translateExactOrDynamic(trimmed);

    if (language === 'en' || translation == null) {
      if (entry && current === entry.last && current !== entry.original) {
        node.nodeValue = entry.original;
      }
      originals.delete(node);
      return;
    }

    const translated = original.replace(trimmed, () => translation);
    if (current !== translated) {
      node.nodeValue = translated;
    }
    originals.set(node, { original, last: translated });
  }

  function translateMultiTextElement(el) {
    if (!el || el.nodeType !== 1 || isExcludedElement(el, TEXT_EXCLUDED_SELECTOR)) return false;
    const children = el.childNodes;
    if (!children || children.length < 2) return false;

    const textNodes = [];
    for (const child of children) {
      if (child.nodeType === 1) return false;
      if (child.nodeType === 3) textNodes.push(child);
    }
    if (textNodes.length < 2) return false;

    let hadMulti = false;
    const origParts = textNodes.map(n => {
      const entry = originals.get(n);
      const cur = n.nodeValue ?? '';
      if (entry?.multi) hadMulti = true;
      return entry && cur === entry.last ? entry.original : cur;
    });
    const combined = origParts.join('');
    const trimmed = combined.trim();
    const translation = translateExactOrDynamic(trimmed);

    if (language === 'en' || translation == null) {
      if (hadMulti) {
        for (let i = 0; i < textNodes.length; i++) {
          const n = textNodes[i];
          const entry = originals.get(n);
          const cur = n.nodeValue ?? '';
          if (entry && cur === entry.last && cur !== entry.original) {
            n.nodeValue = entry.original;
          }
          if (entry?.multi) originals.delete(n);
        }
        return true;
      }
      return false;
    }

    const translated = combined.replace(trimmed, () => translation);
    for (let i = 0; i < textNodes.length; i++) {
      const n = textNodes[i];
      const nextVal = i === 0 ? translated : '';
      if ((n.nodeValue ?? '') !== nextVal) {
        n.nodeValue = nextVal;
      }
      originals.set(n, { original: origParts[i], last: nextVal, multi: true });
    }
    return true;
  }

  function processAttributes(el) {
    if (!el || el.nodeType !== 1 || isExcludedElement(el, ATTR_EXCLUDED_SELECTOR)) return;

    let state = attrs.get(el);
    for (const attrName of TRANSLATED_ATTRS) {
      const origAttr = `data-agy-i18n-orig-${attrName}`;
      const current = el.getAttribute?.(attrName);
      if (current == null) {
        if (el.hasAttribute?.(origAttr)) el.removeAttribute(origAttr);
        if (state) delete state[attrName];
        continue;
      }

      const prev = state?.[attrName];
      const storedOrig = el.getAttribute?.(origAttr);
      const original = prev && current === prev.last
        ? prev.original
        : (storedOrig && !prev ? storedOrig : current);

      const trimmed = original.trim();
      const translation = translateExactOrDynamic(trimmed);

      if (language === 'en' || translation == null) {
        if (prev && current === prev.last && current !== prev.original) {
          el.setAttribute(attrName, prev.original);
        } else if (storedOrig && current !== storedOrig && !prev) {
          el.setAttribute(attrName, storedOrig);
        }
        if (el.hasAttribute?.(origAttr)) el.removeAttribute(origAttr);
        if (state) delete state[attrName];
        continue;
      }

      const translated = original.replace(trimmed, () => translation);
      el.setAttribute(origAttr, original);
      if (current !== translated) {
        el.setAttribute(attrName, translated);
      }
      if (!state) {
        state = {};
        attrs.set(el, state);
      }
      state[attrName] = { original, last: translated };
    }

    if (state && !TRANSLATED_ATTRS.some(name => state[name])) {
      attrs.delete(el);
    }
  }

  function scan(root) {
    if (disposed || !root || typeof document === 'undefined') return;
    if (root.nodeType === 3) {
      if (root.parentElement && translateMultiTextElement(root.parentElement)) return;
      processTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;

    let skipWalker = false;
    if (root.nodeType === 1) {
      if (isHardExcluded(root, ATTR_EXCLUDED_SELECTOR)) return;
      processAttributes(root);
      if (isHardExcluded(root, TEXT_EXCLUDED_SELECTOR)) return;
      skipWalker = translateMultiTextElement(root);
    }

    if (!skipWalker && typeof document.createTreeWalker === 'function') {
      const hasFilter = typeof NodeFilter !== 'undefined';
      const SHOW_ELEMENT = hasFilter && NodeFilter.SHOW_ELEMENT ? NodeFilter.SHOW_ELEMENT : 1;
      const SHOW_TEXT = hasFilter && NodeFilter.SHOW_TEXT ? NodeFilter.SHOW_TEXT : 4;
      const FILTER_ACCEPT = hasFilter && NodeFilter.FILTER_ACCEPT ? NodeFilter.FILTER_ACCEPT : 1;
      const FILTER_REJECT = hasFilter && NodeFilter.FILTER_REJECT ? NodeFilter.FILTER_REJECT : 2;
      const FILTER_SKIP = hasFilter && NodeFilter.FILTER_SKIP ? NodeFilter.FILTER_SKIP : 3;

      const walker = document.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
        acceptNode(node) {
          if (node.nodeType === 1) {
            if (isHardExcluded(node, TEXT_EXCLUDED_SELECTOR)) return FILTER_REJECT;
            if (translateMultiTextElement(node)) return FILTER_REJECT;
            return FILTER_SKIP;
          }
          return FILTER_ACCEPT;
        }
      });
      let node;
      while ((node = walker.nextNode())) {
        processTextNode(node);
      }
    }

    if (typeof root.querySelectorAll === 'function') {
      const elements = root.querySelectorAll('[placeholder],[title],[data-tooltip-content]');
      for (const el of elements) {
        processAttributes(el);
      }
    }
  }

  function pruneDisconnected() {
    for (const [node] of originals) {
      if (node.isConnected === false) originals.delete(node);
    }
    for (const [el] of attrs) {
      if (el.isConnected === false) attrs.delete(el);
    }
  }

  function updatePillStyle() {
    if (!pillEl || !zhBadge || !enBadge) return;
    const isZh = language === 'zh-CN';
    const activeStyle = 'padding:3px 9px;border-radius:9999px;background:var(--primary,#2563eb);color:var(--primary-foreground,#ffffff);transition:all 120ms ease;';
    const inactiveStyle = 'padding:3px 9px;border-radius:9999px;background:transparent;color:inherit;opacity:0.72;transition:all 120ms ease;';
    zhBadge.style.cssText = isZh ? activeStyle : inactiveStyle;
    enBadge.style.cssText = isZh ? inactiveStyle : activeStyle;
    pillEl.setAttribute(
      'title',
      isZh ? '点击切换界面语言（简体中文 / English），可拖动' : 'Click to toggle UI language (中文 / EN), drag to move'
    );
  }

  function restorePillPosition(el) {
    try {
      const raw = globalThis.localStorage?.getItem?.(PILL_STORAGE_KEY);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (typeof pos?.left === 'number' && typeof pos?.top === 'number' && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        const maxX = Math.max(8, (globalThis.innerWidth || 1200) - 96);
        const maxY = Math.max(8, (globalThis.innerHeight || 800) - 40);
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.left = `${Math.min(maxX, Math.max(8, pos.left))}px`;
        el.style.top = `${Math.min(maxY, Math.max(8, pos.top))}px`;
      }
    } catch {}
  }

  function syncFloatingPill() {
    if (disposed || typeof document === 'undefined') return;
    if (!floatingButton || !isTopFrame || !document.body) {
      if (pillEl) {
        pillEl.remove?.();
        pillEl = null;
        zhBadge = null;
        enBadge = null;
      }
      return;
    }

    if (pillEl && pillEl.isConnected !== false) {
      updatePillStyle();
      return;
    }

    pillEl = document.createElement('button');
    pillEl.type = 'button';
    pillEl.id = 'agy-i18n-floating-pill';
    pillEl.setAttribute('data-agy-i18n-ui', 'true');
    pillEl.setAttribute('aria-label', 'Toggle UI Language');
    pillEl.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483000',
      'display:inline-flex',
      'align-items:center',
      'gap:2px',
      'padding:3px',
      'border-radius:9999px',
      'border:1px solid var(--border,rgba(148,163,184,0.35))',
      'background:var(--popover,rgba(15,23,42,0.88))',
      'color:var(--popover-foreground,#f8fafc)',
      'box-shadow:0 4px 16px rgba(0,0,0,0.22)',
      'backdrop-filter:blur(8px)',
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif',
      'font-size:12px',
      'font-weight:600',
      'line-height:1.2',
      'cursor:pointer',
      'user-select:none'
    ].join(';');

    zhBadge = document.createElement('span');
    zhBadge.textContent = '中';
    enBadge = document.createElement('span');
    enBadge.textContent = 'EN';
    pillEl.appendChild(zhBadge);
    pillEl.appendChild(enBadge);

    restorePillPosition(pillEl);
    updatePillStyle();

    let dragState = null;
    let suppressNextClick = false;

    const onPointerMove = event => {
      if (!dragState || !pillEl) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (!dragState.moved && Math.hypot(dx, dy) > 5) {
        dragState.moved = true;
      }
      if (!dragState.moved) return;
      const maxX = Math.max(8, (globalThis.innerWidth || 1200) - dragState.width - 8);
      const maxY = Math.max(8, (globalThis.innerHeight || 800) - dragState.height - 8);
      const nextLeft = Math.min(maxX, Math.max(8, dragState.origLeft + dx));
      const nextTop = Math.min(maxY, Math.max(8, dragState.origTop + dy));
      pillEl.style.right = 'auto';
      pillEl.style.bottom = 'auto';
      pillEl.style.left = `${Math.round(nextLeft)}px`;
      pillEl.style.top = `${Math.round(nextTop)}px`;
    };

    const onPointerUp = () => {
      if (!dragState) return;
      const moved = dragState.moved;
      dragState = null;
      globalThis.removeEventListener?.('pointermove', onPointerMove);
      globalThis.removeEventListener?.('pointerup', onPointerUp);
      if (moved && pillEl) {
        suppressNextClick = true;
        try {
          const rect = pillEl.getBoundingClientRect();
          globalThis.localStorage?.setItem?.(PILL_STORAGE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
        } catch {}
      }
    };

    pillEl.addEventListener?.('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = pillEl.getBoundingClientRect?.() || { left: 0, top: 0, width: 84, height: 28 };
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        origLeft: rect.left,
        origTop: rect.top,
        width: rect.width || 84,
        height: rect.height || 28,
        moved: false
      };
      globalThis.addEventListener?.('pointermove', onPointerMove);
      globalThis.addEventListener?.('pointerup', onPointerUp);
    });

    pillEl.addEventListener?.('click', () => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      const nextLang = language === 'zh-CN' ? 'en' : 'zh-CN';
      apply(nextLang, floatingButton);
      try {
        globalThis.__agyI18nHost?.(JSON.stringify({ type: 'setLanguage', language: nextLang }));
      } catch {}
    });

    document.body.appendChild(pillEl);
  }

  let observer = null;
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
    observer = new MutationObserver(records => {
      if (disposed) return;
      const dirtyParents = new Set();
      const dirtyTexts = new Set();
      const dirtyAttrs = new Set();
      const dirtyElements = new Set();

      for (const record of records) {
        if (record.type === 'characterData') {
          const target = record.target;
          if (target) {
            dirtyTexts.add(target);
            if (target.parentElement?.childNodes?.length >= 2) {
              dirtyParents.add(target.parentElement);
            }
          }
        } else if (record.type === 'attributes') {
          if (record.target) dirtyAttrs.add(record.target);
        } else if (record.type === 'childList') {
          if (record.target?.nodeType === 1 && record.target.childNodes?.length >= 2) {
            dirtyParents.add(record.target);
          }
          if (record.addedNodes) {
            for (const node of record.addedNodes) {
              if (node?.nodeType === 3) dirtyTexts.add(node);
              else if (node?.nodeType === 1) dirtyElements.add(node);
            }
          }
        }
      }

      const handledParents = new Set();
      for (const parent of dirtyParents) {
        if (translateMultiTextElement(parent)) {
          handledParents.add(parent);
        }
      }
      for (const textNode of dirtyTexts) {
        if (!handledParents.has(textNode.parentElement)) {
          processTextNode(textNode);
        }
      }
      for (const el of dirtyAttrs) {
        processAttributes(el);
      }
      for (const el of dirtyElements) {
        scan(el);
      }

      const now = Date.now();
      if (now - lastPruneAt >= 2000) {
        lastPruneAt = now;
        pruneDisconnected();
      }
      if (floatingButton && (!pillEl || pillEl.isConnected === false)) {
        syncFloatingPill();
      }
    });
    const observeTarget = document;
    if (observeTarget) {
      observer.observe(observeTarget, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: TRANSLATED_ATTRS
      });
    }
  }

  function apply(nextLang, nextFloating = floatingButton) {
    if (disposed) return;
    const normalizedLang = nextLang === 'en' ? 'en' : 'zh-CN';
    const normalizedFloating = Boolean(nextFloating);
    const langChanged = language !== normalizedLang;
    language = normalizedLang;
    floatingButton = normalizedFloating;
    if (typeof document !== 'undefined') {
      if (langChanged || language === 'zh-CN') {
        scan(document.body || document.documentElement || document);
      }
      syncFloatingPill();
    }
  }

  function updatePairs(nextPairs) {
    if (disposed || !Array.isArray(nextPairs)) return;
    ({ exact: zhMap, lower: zhLowerMap } = buildLookupMaps(nextPairs));
    if (typeof document !== 'undefined') {
      scan(document.body || document.documentElement || document);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect?.();
    for (const [node, entry] of originals) {
      if (node.isConnected !== false && node.nodeValue === entry.last) {
        node.nodeValue = entry.original;
      }
    }
    for (const [el, state] of attrs) {
      for (const attrName of TRANSLATED_ATTRS) {
        const entry = state?.[attrName];
        if (entry && el.isConnected !== false && el.getAttribute?.(attrName) === entry.last) {
          el.setAttribute(attrName, entry.original);
        }
        const origAttr = `data-agy-i18n-orig-${attrName}`;
        if (el.hasAttribute?.(origAttr)) {
          el.removeAttribute(origAttr);
        }
      }
    }
    originals.clear();
    attrs.clear();
    if (pillEl) {
      pillEl.remove?.();
      pillEl = null;
      zhBadge = null;
      enBadge = null;
    }
    if (globalThis.__agyI18n === api) {
      delete globalThis.__agyI18n;
    }
  }

  globalThis.__agyI18n?.dispose?.();
  const api = {
    version,
    buildId,
    apply,
    updatePairs,
    dispose,
    get language() {
      return language;
    },
    get floatingButton() {
      return floatingButton;
    },
    get stats() {
      return {
        textNodes: originals.size,
        attributes: attrs.size,
        dictionarySize: zhMap.size
      };
    }
  };
  globalThis.__agyI18n = api;

  if (typeof document !== 'undefined') {
    const startDom = () => {
      if (disposed) return;
      scan(document.body || document.documentElement || document);
      syncFloatingPill();
    };
    if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', startDom, { once: true });
    } else {
      startDom();
    }
  }
})();
