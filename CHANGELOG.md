# Changelog

## [1.1.0] - 2026-11-24

### Added
- 补充 1,480 条精选社区 Antigravity Desktop 中文词条（[lib/community-pairs.json](lib/community-pairs.json)，来源 `zhangsubo/antigravity-chinese-patch`，MIT），连同新增执行步骤树/工具状态词条与 `Background Task Output`，内置词典去重后达 **2,703 条**。
- 在 [lib/dictionary.mjs](lib/dictionary.mjs) 的 `translateDynamic` 中新增欢迎问候语、完整配额刷新/剩余语句、执行步骤树汇总（如 `Explored 2 files, 1 search`）、单节点动作文件名（如 `Analyzed ...`）、`Running for ...`、`... years ago`、Token 用量与 SSH/冲突提示等动态匹配。
- 在 [lib/i18n-client.js](lib/i18n-client.js) 中新增 `translateMultiTextElement`（支持 React 拆散多文本节点合并翻译）、`data-tooltip-content` 悬浮提示属性翻译、`TreeWalker` `FILTER_REJECT` 子树剪枝、更细致的防误伤排除边界（`.monaco-editor`、`.xterm`、会话/分支/项目标题与邮箱账号按钮防护）、非 ASCII O(1) 快路、`$` 字符安全替换回调及 `MutationObserver` 批内去重与节流清理。
- 新增 macOS / Linux 安装卸载脚本 [install.sh](install.sh) / [uninstall.sh](uninstall.sh)，以及 `.gitignore`、`.gitattributes` 和跨平台 GitHub Actions CI 工作流 [.github/workflows/test.yml](.github/workflows/test.yml)。

### Fixed
- 加固 [scripts/install.mjs](scripts/install.mjs)：支持 `ENOTEMPTY` 目录锁码回退、空残留目录安全回收以及非破坏式备份重命名，避免 Sidecar 运行时更新安装被局部锁定中断。

## [1.0.0] - 2026-11-23

### Added
- 初始版本：Antigravity 2.0 极简纯 DOM 汉化 Sidecar 插件，零第三方运行时依赖。
- 提供右侧 Aux Pane **界面汉化**管理面板与可选主窗口右下角可拖动 `中 / EN` 悬浮胶囊，支持简体中文 / English 实时无损切换及 `custom-dictionary.json` 热重载。
- 内置 1,108 条基础界面词典与核心动态句式翻译，配套安装/卸载脚本与单元测试。
