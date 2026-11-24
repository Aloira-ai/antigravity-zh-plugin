import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, win32 } from 'node:path';

export const DEBUG_FLAG = '--remote-debugging-port=0';

/**
 * Resolve Antigravity's OS-specific user data directory.
 */
export function antigravityUserDataDir({
  platform = process.platform,
  env = process.env,
  home = homedir()
} = {}) {
  if (env.ANTIGRAVITY_USER_DATA_DIR) {
    return env.ANTIGRAVITY_USER_DATA_DIR;
  }
  const pathImpl = platform === 'win32' ? win32 : posix;
  if (platform === 'win32') {
    return pathImpl.join(env.APPDATA || pathImpl.join(home, 'AppData', 'Roaming'), 'Antigravity');
  }
  if (platform === 'darwin') {
    return pathImpl.join(home, 'Library', 'Application Support', 'Antigravity');
  }
  return pathImpl.join(env.XDG_CONFIG_HOME || pathImpl.join(home, '.config'), 'Antigravity');
}

/**
 * Resolve the DevToolsActivePort file path used by Chromium/Electron CDP.
 */
export function devToolsPortFile(options = {}) {
  const env = options.env || process.env;
  if (options.portFile) return options.portFile;
  if (env.ANTIGRAVITY_CDP_PORT_FILE) return env.ANTIGRAVITY_CDP_PORT_FILE;
  if (env.AGY_BROWSER_ACTIVE_PORT_FILE) return env.AGY_BROWSER_ACTIVE_PORT_FILE;
  const platform = options.platform || process.platform;
  const pathImpl = platform === 'win32' ? win32 : posix;
  return pathImpl.join(antigravityUserDataDir({ ...options, platform, env }), 'DevToolsActivePort');
}

/**
 * Resolve the persistent plugin/sidecar data directory.
 */
export function pluginDataDir({
  home = homedir(),
  env = process.env
} = {}) {
  if (env.ANTIGRAVITY_EXECUTABLE_DATA_DIR) {
    return env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  }
  return join(home, '.gemini', 'antigravity', 'plugin_data', 'agy-i18n');
}

/**
 * Read-only lookup for the Antigravity desktop executable path.
 */
export function resolveAntigravityExecutable({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  execPath = process.execPath,
  exists = existsSync
} = {}) {
  const agentExe = env.ANTIGRAVITY_AGENTAPI_EXE || '';
  if (platform === 'win32') {
    if (agentExe) {
      const candidate = win32.join(win32.dirname(win32.dirname(win32.dirname(agentExe))), 'Antigravity.exe');
      if (exists(candidate)) return candidate;
    }
    if (execPath && /^antigravity\.exe$/i.test(basename(execPath)) && exists(execPath)) {
      return execPath;
    }
    const candidates = [
      win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'Programs', 'antigravity', 'Antigravity.exe'),
      env.ProgramFiles && win32.join(env.ProgramFiles, 'Antigravity', 'Antigravity.exe'),
      env.ProgramFiles && win32.join(env.ProgramFiles, 'antigravity', 'Antigravity.exe'),
      env['ProgramFiles(x86)'] && win32.join(env['ProgramFiles(x86)'], 'Antigravity', 'Antigravity.exe')
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (exists(candidate)) return candidate;
    }
    return '';
  }

  if (platform === 'darwin') {
    for (const seed of [agentExe, execPath].filter(Boolean)) {
      for (let cur = dirname(seed); cur && cur !== dirname(cur); cur = dirname(cur)) {
        if (/Antigravity.*\.app$/i.test(basename(cur)) && exists(cur)) return cur;
      }
    }
    for (const candidate of ['/Applications/Antigravity.app', posix.join(home, 'Applications', 'Antigravity.app')]) {
      if (exists(candidate)) return candidate;
    }
    return '';
  }

  if (env.APPIMAGE && exists(env.APPIMAGE)) return env.APPIMAGE;
  if (agentExe) {
    const candidate = posix.join(posix.dirname(posix.dirname(posix.dirname(agentExe))), 'antigravity');
    if (exists(candidate)) return candidate;
  }
  if (execPath && /^antigravity$/i.test(basename(execPath)) && exists(execPath)) {
    return execPath;
  }
  for (const candidate of ['/usr/share/antigravity/antigravity', '/opt/Antigravity/antigravity', '/usr/bin/antigravity']) {
    if (exists(candidate)) return candidate;
  }
  return '';
}

/**
 * Format a copyable manual launch command with --remote-debugging-port=0.
 */
export function manualLaunchCommand(options = {}) {
  const platform = options.platform || process.platform;
  const target = resolveAntigravityExecutable({ ...options, platform });
  if (platform === 'darwin') {
    const appPath = target || '/Applications/Antigravity.app';
    return `open -n -a "${appPath}" --args ${DEBUG_FLAG}`;
  }
  if (platform === 'win32') {
    const exePath = target || '%LOCALAPPDATA%\\Programs\\antigravity\\Antigravity.exe';
    return `"${exePath}" ${DEBUG_FLAG}`;
  }
  const binPath = target || 'antigravity';
  return `"${binPath}" ${DEBUG_FLAG}`;
}

/**
 * Format a copyable read-only command to create a separate Windows desktop debug shortcut
 * without touching the user's original shortcuts.
 */
export function createDebugShortcutCommand(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return '';
  const exePath = resolveAntigravityExecutable({ ...options, platform })
    || '%LOCALAPPDATA%\\Programs\\antigravity\\Antigravity.exe';
  const safeExe = exePath.replace(/'/g, "''");
  return `powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\Antigravity (调试模式).lnk');$s.TargetPath='${safeExe}';$s.Arguments='${DEBUG_FLAG}';$s.Save()"`;
}
