---
name: agy-zh
description: Check Antigravity 界面汉化 (agy-zh) status, check for GitHub updates and upgrade in-place, manage Simplified Chinese / English language settings and custom dictionary entries, or guide --remote-debugging-port=0 setup.
---

# Antigravity 界面汉化 (`agy-zh`) 助手技能

用于帮助用户快速检查 `agy-zh` 纯 DOM 界面汉化插件的运行状态、检查与更新最新版本、管理简体中文 / English 语言设置与自定义翻译词条，或配置 `--remote-debugging-port=0` 调试启动参数。

## 核心状态与文件位置

- **已安装插件目录**：`~/.gemini/config/plugins/agy-zh/`（旧版目录名可能为 `agy-i18n`）
- **设置与自定义词典目录**：
  - Windows：`%USERPROFILE%\.gemini\antigravity\plugin_data\agy-zh\`
  - macOS / Linux：`~/.gemini/antigravity/plugin_data/agy-zh/`
  - `settings.json`：`{ "language": "zh-CN" | "en", "floatingButton": boolean }`
  - `custom-dictionary.json`：用户覆盖/补充词典，格式为纯 JSON 对象 `{"English": "中文"}`（最多 5,000 条）
- **本地调试端口状态文件（`DevToolsActivePort`）**：
  - Windows：`%APPDATA%\Antigravity\DevToolsActivePort`
  - macOS：`~/Library/Application Support/Antigravity/DevToolsActivePort`
  - Linux：`${XDG_CONFIG_HOME:-~/.config}/Antigravity/DevToolsActivePort`
- **插件管理入口**：给用户提供直达链接 `[Antigravity 界面汉化](customization://agy-zh)`。

## 工作流指南

### 1. 检查汉化状态与调试端口
1. 读取 `~/.gemini/antigravity/plugin_data/agy-zh/settings.json` 与 `custom-dictionary.json`（若不存在则说明尚未修改过默认值），确认当前语言设置、悬浮按钮开关与自定义词条数量。
2. 读取 `~/.gemini/config/plugins/agy-zh/plugin.json`（若不存在则查看旧目录 `agy-i18n`）确认已安装版本。
3. 检查对应平台的 `DevToolsActivePort` 文件是否存在（第一行为调试端口）：
   - 若不存在，说明 Antigravity 当前未使用 `--remote-debugging-port=0` 启动，按下方第 4 节给出对应平台的配置方法。
   - 若存在且语言异常，提示用户在右侧 Aux Pane 打开 **界面汉化** 面板查看连接状态，或在 `[Antigravity 界面汉化](customization://agy-zh)` 切换启停。

### 2. 检查新版本与原地更新
当用户询问是否有更新、检查新版本或请求升级插件时：
1. 读取本地 `~/.gemini/config/plugins/agy-zh/plugin.json` 获取当前 `version`（若只检测到旧版 `agy-i18n/plugin.json`，同样记录版本号并提示可无缝迁移升级）。
2. 请求 GitHub 最新 Release 元数据：
   - 优先查询 `https://api.github.com/repos/Aloira-ai/antigravity-zh-plugin/releases/latest`（提取 `tag_name`、`html_url`、`body`）；
   - 若 GitHub API 限流或暂不可达，回退读取 `https://raw.githubusercontent.com/Aloira-ai/antigravity-zh-plugin/main/plugin.json` 的 `version`。
3. 对比本地与远程版本：
   - 若已是最新版本，直接告知用户当前已是最新版并附上版本号；
   - 若存在新版本，向用户简要展示新版本号与更新要点。
4. 用户请求更新或确认升级后，按当前操作系统执行对应的一行官方安装脚本原地覆盖升级（个人语言设置与 `custom-dictionary.json` 会完整保留，不会被覆盖）：
   - **Windows (PowerShell)**：`irm https://raw.githubusercontent.com/Aloira-ai/antigravity-zh-plugin/main/install.ps1 | iex`
   - **macOS / Linux (Bash)**：`curl -fsSL https://raw.githubusercontent.com/Aloira-ai/antigravity-zh-plugin/main/install.sh | bash`
5. 安装完成后，给用户提供直达链接 `[Antigravity 界面汉化](customization://agy-zh)`，提醒先**停用再重新启用**一次开关（或重启 Antigravity）让 Sidecar 重载新版代码；若是从旧版 `agy-i18n` 迁移而来，同时提供 `[Agy i18n (旧版)](customization://agy-i18n)` 提醒用户顺手点卸载，避免新旧两个插件同时运行。

### 3. 添加 / 修改 / 删除自定义翻译词条
当用户希望将某个界面英文词条译为指定中文（或覆盖内置译文、移除自定义词条）时：
1. 读取 `custom-dictionary.json`（若文件不存在，则从 `{}` 开始）。
2. 解析为普通 JSON 对象后更新对应键值对（保留已有词条，键与值均为非空去空白字符串），并以 UTF-8 格式化写回 `custom-dictionary.json`。
3. 向用户反馈已写入的键值对，并提醒可在右侧 **界面汉化** Aux Pane 面板点击 **重新加载词典** 立即热生效（也可直接在面板内使用可视化输入框增删词条）。

### 4. 引导配置 `--remote-debugging-port=0`
- **Windows**：右键 Antigravity 快捷方式 → **属性** → 在“目标(T)”末尾加空格和 `--remote-debugging-port=0`（不要直接强行改写用户原有快捷方式；如需独立调试快捷方式，可提醒用户在右侧 **界面汉化** 面板点击「复制桌面快捷方式命令」自行执行）。
- **macOS**：`open -n -a "/Applications/Antigravity.app" --args --remote-debugging-port=0`
- **Linux**：`antigravity --remote-debugging-port=0`
- 修改后需**完全退出客户端（含系统托盘）**再重新启动生效。

## 安全红线（必须遵守）
- **绝不**手动修改 `~/.gemini/config/config.json`。
- **绝不**修改 Antigravity 官方 `app.asar` 或安装包文件。
- **绝不**在未经用户明确授权下自动覆盖桌面/开始菜单快捷方式。
