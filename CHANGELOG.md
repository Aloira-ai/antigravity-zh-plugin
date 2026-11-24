# Changelog

## [1.3.0] - 2026-11-24

### Changed
- **统一对外展示与内部命名**：应用内展示名调整为 **Antigravity 界面汉化**，插件 ID、安装目录、数据目录、技能名（`/agy-zh`）与环境变量前缀（`AGY_ZH_*`）统一为 **`agy-zh`**，与 GitHub 仓库 `antigravity-zh-plugin` 语义对齐（安装/卸载脚本仍兼容 `AGY_I18N_*` 环境变量）。

### Added
- **检查更新与原地升级体验**：在 [skills/agy-zh/SKILL.md](skills/agy-zh/SKILL.md) 新增对比 GitHub 最新 Release 与本地版本并一键原地升级的工作流，更新 [plugin.json](plugin.json) 推荐提示词实现详情页一键触发检查更新，并在右侧 Aux Pane 顶部版本号旁增加直达 GitHub Releases 的纯点击跳转链接（[lib/web-ui.mjs](lib/web-ui.mjs)）。
- **旧版个人数据无缝迁移**：[scripts/install.mjs](scripts/install.mjs) 安装 `agy-zh` 时自动从旧版 `plugin_data/agy-i18n` 非破坏式复制 `settings.json` 与 `custom-dictionary.json`，并在检测到旧版 `plugins/agy-i18n` 目录时提示用户在 Customizations 页面卸载旧版。

## [1.2.0] - 2026-11-24

### Added
- **远程一行安装与独立卸载**：[install.ps1](install.ps1) / [install.sh](install.sh) 支持 `irm ... | iex` 与 `curl -fsSL ... | bash` 自动拉取仓库压缩包安装（无需 Git 或本地源码目录）；[uninstall.ps1](uninstall.ps1) / [uninstall.sh](uninstall.sh) 支持脱离源码目录独立安全卸载（含 `--purge` / `AGY_I18N_PURGE=1`）。
- **Aux Pane 可视化自定义词典管理**：在 [lib/settings.mjs](lib/settings.mjs)、[sidecars/i18n/main.mjs](sidecars/i18n/main.mjs) 与 [lib/web-ui.mjs](lib/web-ui.mjs) 新增 `POST/DELETE /api/custom-dictionary` 接口与面板内联增删改界面，保存即原子写入并热生效。
- **独立调试快捷方式命令复制**：在 [lib/paths.mjs](lib/paths.mjs) 新增只读 `createDebugShortcutCommand`（并在 Windows Aux Pane 提供复制按钮），不修改用户原快捷方式即可按需创建独立的调试快捷方式。
- **内置助手技能**：新增 [skills/agy-i18n/SKILL.md](skills/agy-i18n/SKILL.md)，配合 [plugin.json](plugin.json) 的 `suggestedPrompts` 支持通过对话检查汉化状态、添加自定义词条或配置调试启动参数。

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
