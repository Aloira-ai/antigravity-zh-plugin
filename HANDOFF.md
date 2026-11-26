# Antigravity 界面汉化 (`agy-zh`) 项目交接文档

> 供新开会话的 Agent 快速恢复完整上下文。阅读本文件与 `README.md` 即可直接继续开发、补词条、测试与部署，无需回溯上一条会话历史。

---

## 1. 项目简介与设计红线

**Antigravity 界面汉化（`agy-zh`）** 是从 `WhiteBr1ck/agy-powertools`（MIT License）思路中剥离重构的 **Antigravity 2.0 极简纯汉化 Sidecar 插件**（GitHub 仓库：`Aloira-ai/antigravity-zh-plugin`），零第三方运行时依赖，提供 **简体中文 / English** 实时切换（支持右侧 Aux Pane 分段按钮 + 可选主窗口右下角可拖动 `中 / EN` 悬浮胶囊）。

### 绝对不能越过的架构红线

1. **只做纯 DOM 汉化**：仅通过 `MutationObserver` + `TreeWalker`（支持 `FILTER_REJECT` 子树剪枝与 React 拆散多文本节点合并翻译）替换 UI 文本节点与 `placeholder` / `title` / `data-tooltip-content` 属性。
2. **禁止高侵入耦合**：
   - 不做混淆内部组件签名扫描、不碰 React Fiber / TanStack Router 内部状态；
   - 不解码 Protobuf、不扫描 `conversations/*.db` SQLite；
   - 不拦截发送请求、不往模型 Prompt 注入任何系统规则；
   - 不读写系统凭据库（Credential Manager / Keychain）；
   - 不包含自动更新下载器、不发任何外部网络请求（运行时严格只连 `127.0.0.1` 回环地址；Web UI 顶部版本号链接仅为用户提供浏览器跳转）。
3. **不碰用户配置与系统快捷方式**：
   - `scripts/install.mjs` / `scripts/uninstall.mjs` **绝不**修改 `~/.gemini/config/config.json`，也**绝不**自动改写桌面/开始菜单快捷方式；
   - 插件启停统一由用户在 Antigravity 的 `Customizations` 界面中操作（链接 `[Antigravity 界面汉化](customization://agy-zh)`）；
   - `--remote-debugging-port=0` 启动参数由用户自行保留在快捷方式中。

---

## 2. 当前进度与本机环境

- **插件版本**：`1.3.2`（`plugin.json` `name: "agy-zh"`、`displayName: "Antigravity 界面汉化"` / `package.json`）
- **源码工作区**：本地开发目录（GitHub 仓库为 `Aloira-ai/antigravity-zh-plugin`）
- **已安装插件目录**：`~/.gemini/config/plugins/agy-zh`（Windows 为 `%USERPROFILE%\.gemini\config\plugins\agy-zh`）
- **用户设置与自定义词典目录**：`~/.gemini/antigravity/plugin_data/agy-zh/`（Windows 为 `%USERPROFILE%\.gemini\antigravity\plugin_data\agy-zh\`；安装脚本会自动从旧版 `agy-i18n` 非破坏式迁移）
  - `settings.json`：`{ "language": "zh-CN" | "en", "floatingButton": boolean }`
  - `custom-dictionary.json`：可选用户自定义覆盖词典（`{ "英文原文": "中文译文" }`，最多 5000 条）
- **Node.js 运行环境（重要）**：
  - 若本机全局 `PATH` 中**没有** `node`，开发、校验和跑测试可直接使用 Antigravity 内置 Node（支持原生 `node:test`、`fetch`、`WebSocket`、`node:vm`，要求 `>=22.13`）：
    ```powershell
    $env:APPDATA\Antigravity\bin\agy-node.cmd
    ```
  - `install.ps1` / `uninstall.ps1` 与 `install.sh` / `uninstall.sh` 会自动优先查找 `node`，找不到时回退到 Antigravity 内置 Node。
- **当前词典与测试状态**：
  - `BUILTIN_PAIRS` 共 **2,936 条**（960 条裁剪后的 `agy-powertools` MIT 词条 + 331 条 Antigravity 2.0–2.35 原生补充词条 + 1,645 条精选 `zhangsubo/antigravity-chinese-patch` MIT 词条，已去重）；
  - 动态句式 `translateDynamic` 覆盖套餐/积分/额度重置/欢迎问候/工具与文件数/相对时间（`... ago`）/思考与工作耗时（`Thought for ...`、`Worked for ...`、`Working for ...`、`Running for ...`）/执行步骤树汇总与单节点动作文件（`Explored 2 files, 1 search`、`Analyzed ...` 等）/权限与 SSH/计数单位/版本号等；
  - 单元测试 `tests/i18n.test.mjs` + `tests/cdp-host.test.mjs` 共 **11/11 全部通过**。

---

## 3. 文件结构一览

```text
antigravity-zh-plugin/
├── .gitignore
├── .gitattributes
├── .github/workflows/
│   └── test.yml               # 跨平台 CI（Ubuntu / macOS / Windows，Node 22 & 24）
├── plugin.json                # Antigravity 插件清单（name: "agy-zh", displayName: "Antigravity 界面汉化"）
├── package.json               # 包信息（type: "module", engines: >=22.13, 无第三方依赖）
├── LICENSE                    # MIT 协议（含 WhiteBr1ck/agy-powertools、zhangsubo/antigravity-chinese-patch、guuguo/antigravity-zh-launcher 致谢）
├── README.md                  # 用户安装、启动参数、自定义词典、更新与卸载说明
├── CHANGELOG.md               # 版本变更记录
├── HANDOFF.md                 # 本交接文档
├── install.ps1 / uninstall.ps1# Windows 远程一行安装与独立安全卸载脚本（自动回退 agy-node.cmd）
├── install.sh / uninstall.sh  # macOS / Linux 远程一行安装与独立安全卸载脚本（自动回退 agy-node）
├── assets/
│   └── logo.svg               # 128x128 插件图标（中/A）
├── skills/agy-zh/
│   └── SKILL.md               # 内置助手技能（检查汉化状态、检查更新/原地升级、管理自定义词典、引导调试端口配置）
├── sidecars/i18n/
│   ├── sidecar.json           # Sidecar 配置（Aux Pane Web UI: "界面汉化"）
│   └── main.mjs               # Sidecar 入口：串联 settings、dictionary、cdp-host、web-ui
├── lib/
│   ├── paths.mjs              # 跨平台路径解析、DevToolsActivePort 查找、只读启动与快捷方式命令生成
│   ├── settings.mjs           # 原子写入 settings.json 与增删改/解析 custom-dictionary.json
│   ├── community-pairs.json   # 精选社区 Antigravity Desktop 补充词条（1645条，MIT）
│   ├── dictionary.mjs         # BASE_PAIRS + EXTRA_PAIRS + community-pairs.json -> BUILTIN_PAIRS (2936条)、translateDynamic、mergeDictionaryPairs
│   ├── i18n-client.js         # 注入浏览器的纯 DOM 汉化脚本（多文本节点合并、子树剪枝、精细边界排除、data-tooltip-content 与可选悬浮胶囊）
│   ├── cdp-host.mjs           # 轮询 DevToolsActivePort、注入 Hub 主窗口与 Swarm iframe、__agyI18nHost 绑定
│   └── web-ui.mjs             # 127.0.0.1 Sidecar Aux Pane HTTP 服务（加载 /preload.js、token 鉴权、中/英按钮与可视化词典编辑）
├── scripts/
│   ├── install.mjs            # 安全安装到 ~/.gemini/config/plugins/agy-zh（含旧版 agy-i18n 数据迁移、锁定重试与原地回退）
│   └── uninstall.mjs          # 安全卸载（默认保留 settings/自定义词典，--purge 一并清理）
└── tests/
    ├── i18n.test.mjs          # 词典完整性、设置存储、node:vm DOM 模拟、Aux Pane HTTP 接口与脚本序列化测试
    └── cdp-host.test.mjs      # Target 匹配、Mock CDP 注入与上下文校验、安装/卸载、旧版迁移及 EPERM/ENOTEMPTY 回退测试
```

---

## 4. 关键技术约束与已知边界（避免踩坑）

1. **会话列表右键菜单仍是英文（已知边界，用户已确认暂不处理）**：
   - 在会话条目上点击**鼠标右键**弹出的是 Electron 主进程调用的 **Windows 系统原生上下文菜单**，不经过网页 DOM，因此纯 DOM 方案无法翻译（而点击会话行右侧的 **`⋮` 按钮** 若走网页内浮层则可被 DOM 翻译）。
   - **不要**为了翻译原生右键菜单去修改客户端 `app.asar` 或劫持混淆构造函数。
2. **`translateDynamic` 必须 100% 自包含**：
   - `lib/cdp-host.mjs` 的 `buildInjectionScript()` 会通过 `${translateDynamic.toString()}` 直接把该函数源码注入浏览器执行上下文。
   - **严禁**在 `translateDynamic` 内部引用模块外层辅助函数、模块级常量或外部导入，否则浏览器中会抛 `ReferenceError`。所有子函数和映射表必须写在 `translateDynamic` 函数体内部（已有单测 `buildInjectionScript serializes self-contained translateDynamic and runs in isolated VM` 防回归）。
3. **DOM 排除与属性规则不可混淆**：
   - `TEXT_EXCLUDED_SELECTOR` 排除 `textarea`、`input`、`[contenteditable]`、`pre`、`code`、`[data-testid="planner-response-text"]`、`[data-testid="user-input-step"]`、`[data-agy-i18n-ui]` 等，防止破坏用户输入与聊天正文；
   - `ATTR_EXCLUDED_SELECTOR` **不能**包含 `textarea` 和 `input`，否则搜索框的 `placeholder` 无法翻译；
   - 绝不翻译 `aria-label`（避免影响客户端或辅助功能依赖的选择器）。
   - 内部 DOM 属性/全局命名（`data-agy-i18n-*`、`__agyI18n`、`agy-i18n-pill-pos`）与 `sidecars/i18n/` 目录保持不变，避免破坏已有浏览器状态和悬浮胶囊位置记忆。
4. **客户端查找规范化规则（`lib/i18n-client.js`）**：
   - 优先级：`zhMap` 精确匹配 → 规整空白与弯引号（`norm`）后匹配（含 `...` ↔ `…` 互转）→ 多词短语（`norm.includes(' ') && norm.length >= 5`）大小写无关匹配 `zhLowerMap` → 尾冒号词干匹配（如 `Model:` → `模型：`）→ `translateDynamic(norm)`。
   - 不要对单词（无空格或长度 `< 5`）开启全局大小写无关匹配，以防误伤代码或专有名词缩写。
5. **Windows 目录锁定防护（`scripts/install.mjs`）**：
   - Antigravity Sidecar 运行中或实时杀毒扫描可能锁定插件目录导致 `renameSync` 报 `EPERM`/`EBUSY`/`ENOTEMPTY`。`install.mjs` 已实现非破坏式备份重命名 + `renameWithRetry`（15 次 × 100 ms）+ `syncDirectoryInPlace` 原地覆盖并清理多余旧文件；保留这一机制。
6. **热更新生效方式**：
   - 每次修改仓库源码后，不会自动同步到已安装插件目录，必须重新执行 `install.ps1`（或 `bash ./install.sh`）；
   - 仅修改用户的 `custom-dictionary.json` 时，可在右侧 **界面汉化** 面板直接点 **重新加载词典** 热更新；
   - 修改了内置 `dictionary.mjs` / `i18n-client.js` / `cdp-host.mjs` 并重装后，需在 `[Antigravity 界面汉化](customization://agy-zh)` 停用再重新启用插件（或带 `--remote-debugging-port=0` 重启 Antigravity）让 Sidecar 进程重载新代码。

---

## 5. 常用开发、校验与部署命令（PowerShell）

```powershell
$node = "$env:APPDATA\Antigravity\bin\agy-node.cmd"
$root = (Get-Location).Path

# 1. 语法检查全部 JS/MJS
Get-ChildItem $root -Recurse -Include *.mjs,*.js | ForEach-Object { & $node --check $_.FullName }

# 2. 运行全部单元测试（预期 11/11 通过）
& $node --test "$root\tests\i18n.test.mjs" "$root\tests\cdp-host.test.mjs"

# 3. 校验全部 JSON（注意 PowerShell 5.1 的 ConvertFrom-Json 默认区分不了大小写键名，lib/community-pairs.json 请用 Node 校验）
& $node -e "import { readFileSync } from 'node:fs'; for (const p of ['plugin.json','package.json','sidecars/i18n/sidecar.json','lib/community-pairs.json']) JSON.parse(readFileSync(p, 'utf8'));"

# 4. 重新安装到 ~/.gemini/config/plugins/agy-zh
powershell -NoProfile -ExecutionPolicy Bypass -File "$root\install.ps1"
```

---

## 6. 后续常见维护方向

- **补充新界面漏翻词条**：用户发来新截图/英文词条时，添加到 `lib/dictionary.mjs` 的 `EXTRA_PAIRS`（或动效/动态数字格式加入 `translateDynamic`），确保不与 `BASE_PAIRS` 重复，补测并运行 `install.ps1`。
- **同步上游词库**：可按需抓取 `https://raw.githubusercontent.com/WhiteBr1ck/agy-powertools/main/lib/native-i18n.js` 对比新增词条（注意继续剔除 Powertools 专属面板词汇，并保持 MIT 版权声明）。
- **Antigravity 客户端升级后“等待调试端口”排查**：99% 是升级重启未带参数或安装器覆盖了快捷方式，确认快捷方式目标末尾仍保留 `--remote-debugging-port=0` 后完全退出客户端（含托盘）重启即可。
