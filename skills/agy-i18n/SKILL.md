---
name: agy-i18n
description: Check Agy i18n UI localization status, manage Simplified Chinese / English language settings and custom dictionary entries, or guide --remote-debugging-port=0 setup.
---

# Agy i18n (界面汉化) 助手技能

用于帮助用户快速检查 `agy-i18n` 纯 DOM 界面汉化插件的运行状态、管理简体中文 / English 语言设置与自定义翻译词条，或配置 `--remote-debugging-port=0` 调试启动参数。

## 核心状态与文件位置

- **设置与自定义词典目录**：
  - Windows：`%USERPROFILE%\.gemini\antigravity\plugin_data\agy-i18n\`
  - macOS / Linux：`~/.gemini/antigravity/plugin_data/agy-i18n/`
  - `settings.json`：`{ "language": "zh-CN" | "en", "floatingButton": boolean }`
  - `custom-dictionary.json`：用户覆盖/补充词典，格式为纯 JSON 对象 `{"English": "中文"}`（最多 5,000 条）
- **本地调试端口状态文件（`DevToolsActivePort`）**：
  - Windows：`%APPDATA%\Antigravity\DevToolsActivePort`
  - macOS：`~/Library/Application Support/Antigravity/DevToolsActivePort`
  - Linux：`${XDG_CONFIG_HOME:-~/.config}/Antigravity/DevToolsActivePort`
- **插件管理入口**：给用户提供直达链接 `[Agy i18n (界面汉化)](customization://agy-i18n)`。

## 工作流指南

### 1. 检查汉化状态与调试端口
1. 读取 `~/.gemini/antigravity/plugin_data/agy-i18n/settings.json` 与 `custom-dictionary.json`（不存在则说明尚未修改过默认值），确认当前语言设置、悬浮按钮开关与自定义词条数量。
2. 检查对应平台的 `DevToolsActivePort` 文件是否存在（第一行为调试端口）：
   - 若不存在，说明 Antigravity 当前未使用 `--remote-debugging-port=0` 启动，按下方第 3 节给出对应平台的配置方法。
   - 若存在且语言异常，提示用户在右侧 Aux Pane 打开 **界面汉化** 面板查看连接状态，或在 `[Agy i18n (界面汉化)](customization://agy-i18n)` 切换启停。

### 2. 添加 / 修改 / 删除自定义翻译词条
当用户希望将某个界面英文词条译为指定中文（或覆盖内置译文、移除自定义词条）时：
1. 读取 `custom-dictionary.json`（若文件不存在，则从 `{}` 开始）。
2. 解析为普通 JSON 对象后更新对应键值对（保留已有词条，键与值均为非空去空白字符串），并以 UTF-8 格式化写回 `custom-dictionary.json`。
3. 向用户反馈已写入的键值对，并提醒其两种立即生效方式之一：
   - 在右侧 **界面汉化** Aux Pane 面板点击 **重新加载词典**（或直接在面板内使用可视化输入框增删词条，保存即热生效）。

### 3. 引导配置 `--remote-debugging-port=0`
- **Windows**：右键 Antigravity 快捷方式 → **属性** → 在“目标(T)”末尾加空格和 `--remote-debugging-port=0`（不要直接强行改写用户原有快捷方式；如需独立调试快捷方式，可提醒用户在右侧 **界面汉化** 面板点击「复制桌面快捷方式命令」自行执行）。
- **macOS**：`open -n -a "/Applications/Antigravity.app" --args --remote-debugging-port=0`
- **Linux**：`antigravity --remote-debugging-port=0`
- 修改后需**完全退出客户端（含系统托盘）**再重新启动生效。

## 安全红线（必须遵守）
- **绝不**手动修改 `~/.gemini/config/config.json`。
- **绝不**修改 Antigravity 官方 `app.asar` 或安装包文件。
- **绝不**在未经用户明确授权下自动覆盖桌面/开始菜单快捷方式。
