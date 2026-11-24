# Agy i18n — Antigravity 2.0 极简纯汉化插件

一个轻量、透明、零第三方运行时依赖的 **Antigravity 2.0** 简体中文 / English 界面汉化插件，内置 **2,703** 条桌面端 UI 词条与动态句式规则，提供一键无重启中英切换。

## 为什么做这个插件

- **纯 DOM 层翻译**：仅通过 `MutationObserver` 与 `TreeWalker` 替换客户端 UI 文本（支持 React 拆散多文本节点合并翻译）与 `placeholder` / `title` / `data-tooltip-content` 属性，**跳过且不篡改**对话正文、用户提问、输入框、终端、代码编辑器、会话标题与代码块，也**不改动** `aria-label`。
- **抗升级、零冗余侵入**：不修改 `app.asar`、不绑定未公开 React Fiber / 混淆组件 / Protobuf 字段，不注入模型 Prompt，不读取会话 SQLite，不修改 `config.json` 或快捷方式，不调用系统凭据库，不自动下载更新。
- **零外部网络请求**：运行时仅访问本机 `127.0.0.1` 回环地址（本地 CDP 调试端口与 Sidecar 辅助面板）。

### 与常见汉化方案对比

| 对比维度 | 修改 `app.asar` 补丁 | 外置启动器方案 | **Agy i18n（本插件）** |
| :--- | :--- | :--- | :--- |
| **原版安装包与签名** | 需解包覆盖，macOS 需重签名 | 不改原版包体 | **100% 不碰原版包体与签名** |
| **客户端升级兼容性** | 升级即失效，常绑定版本号指纹 | 外挂生效，不改原版 | **纯 DOM 抗升级，无需重打补丁** |
| **中 / 英切换方式** | 运行时切换或还原卸载 | 双图标重启切换 | **原生面板 + 可选悬浮胶囊免重启秒切** |
| **系统配置侵入度** | 改写安装目录文件 | 生成新启动入口/快捷方式 | **不改 `config.json` 与快捷方式** |

## 安装方法

1. 克隆仓库（或下载 Release / Code ZIP 并解压后进入目录）：
   ```bash
   git clone https://github.com/Aloira-ai/antigravity-zh-plugin.git
   cd antigravity-zh-plugin
   ```
2. 在项目目录运行对应平台的安装脚本（仅复制插件文件到 `~/.gemini/config/plugins/agy-i18n`，**不会**修改 `config.json` 或系统快捷方式）：
   - **Windows (PowerShell)**：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
     ```
   - **macOS / Linux (Bash)**：
     ```bash
     bash ./install.sh
     ```
   （脚本会自动优先使用系统 `node` `>=22.13`，若未安装则自动回退到 Antigravity 内置的 `agy-node`。）
3. 打开 Antigravity，进入 **Customizations**（自定义）页面，开启 **Agy i18n (界面汉化)** 插件及其 Sidecar。

## 启用前提：本地调试端口

由于 Antigravity 目前没有官方的界面多语言扩展 API，本插件需要通过本机 CDP 接口把汉化脚本注入到客户端窗口中。请手动为您平时使用的 Antigravity 启动入口加上 `--remote-debugging-port=0` 并完全重启客户端：

- **Windows 快捷方式**：右键快捷方式 → **属性** → 在“目标(T)”末尾加上空格与 `--remote-debugging-port=0`，例如：
  ```text
  "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" --remote-debugging-port=0
  ```
- **macOS 终端启动**：
  ```bash
  open -n -a "/Applications/Antigravity.app" --args --remote-debugging-port=0
  ```
- **Linux 终端 / `.desktop`**：
  ```bash
  antigravity --remote-debugging-port=0
  ```

> 注意：开启 `--remote-debugging-port=0` 仅限本机同权限进程访问 `DevToolsActivePort`；不建议在不受信任的多用户或高敏受控终端上长期开启。

## 简 / 英切换按钮

插件提供两种切换方式，状态实时持久化并同步到所有已连接的窗口：

1. **右侧辅助面板（默认提供）**：在 Antigravity 右侧 Aux Pane 打开 **界面汉化** 面板，直接点击顶部的 **「简体中文 / English」** 分段切换按钮即可一键切换（切换回 English 时会原样还原所有已替换节点）。
2. **主窗口右下角悬浮胶囊（可选）**：在 **界面汉化** 面板中打开「主窗口悬浮切换按钮 (`中 / EN`)」开关后，主窗口右下角会出现一个可拖动位置的轻量胶囊按钮，点击即可一键中/英切换。

## 自定义词典

插件已内置 **2,703 条**常见界面词条。如需补充或覆盖内置词条，可在以下路径创建或编辑 JSON 文件（键值对为 `"英文原文": "中文译文"`）：

- Windows：`%USERPROFILE%\.gemini\antigravity\plugin_data\agy-i18n\custom-dictionary.json`
- macOS / Linux：`~/.gemini/antigravity/plugin_data/agy-i18n/custom-dictionary.json`

示例：
```json
{
  "New Conversation": "新建对话",
  "Settings": "系统设置"
}
```
保存后，在右侧 **界面汉化** 面板点击 **重新加载词典** 即可立即生效。

## 常见问题与已知边界

- **客户端升级后显示“等待调试端口”**：99% 是升级覆盖或重启客户端时未带 `--remote-debugging-port=0`。请确认启动快捷方式末尾仍保留该参数，并完全退出 Antigravity（含系统托盘）后重新启动。
- **升级插件版本后如何生效**：重新运行安装脚本后，在 Antigravity 的 **Customizations → Agy i18n** 中先停用再重新启用插件（或重启客户端）即可让 Sidecar 重新加载新词典与脚本。
- **会话列表鼠标右键菜单仍是英文**：Windows / 原生桌面右键菜单由 Electron 主进程调用系统原生菜单弹出，不经过网页 DOM。为守住“不修改 `app.asar`”红线，本插件不劫持原生菜单（会话行右侧 `⋮` 按钮若渲染在网页浮层内则可正常汉化）。

## 卸载

1. 先在 Antigravity 的 **Customizations** 页面停用 **Agy i18n** 插件。
2. 运行对应平台的卸载脚本：
   - **Windows (PowerShell)**：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
     ```
     若希望连同 `settings.json` 与 `custom-dictionary.json` 一并清除，可加 `--purge`：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1 --purge
     ```
   - **macOS / Linux (Bash)**：
     ```bash
     bash ./uninstall.sh
     # 或连同个人设置与自定义词典一并清除：
     bash ./uninstall.sh --purge
     ```

## 开源协议与致谢

- 本项目基于 [MIT License](LICENSE) 开源，欢迎通过 Issue / PR 补充漏翻词条或修正译文。
- 内置界面翻译词典与纯 DOM 规则参考并致谢以下 MIT 开源项目：
  - [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools)（`lib/native-i18n.js`, Copyright (c) 2026 WhiteBr1ck）
  - [zhangsubo/antigravity-chinese-patch](https://github.com/zhangsubo/antigravity-chinese-patch)（`locales/src/`, Copyright (c) 2026 TeacherXuAI）
  - [guuguo/antigravity-zh-launcher](https://github.com/guuguo/antigravity-zh-launcher)（动态问候/提示词条与多节点思路参考, Copyright (c) 2026 guuguo）
