import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manualLaunchCommand } from '../lib/paths.mjs';

const PLUGIN_ID = 'agy-zh';
const LEGACY_PLUGIN_ID = 'agy-i18n';
const RUNTIME_ITEMS = ['plugin.json', 'package.json', 'LICENSE', 'README.md', 'assets', 'lib', 'sidecars', 'skills'];
const LOCK_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));

async function renameWithRetry(from, to, renameFn = renameSync, { retries = 15, delayMs = 100 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameFn(from, to);
      return;
    } catch (error) {
      if (attempt >= retries || !LOCK_ERROR_CODES.has(error?.code)) {
        throw error;
      }
      await pause(delayMs);
    }
  }
}

function syncDirectoryInPlace(fromDir, toDir) {
  assertNoSymlinks(fromDir);
  assertNoSymlinks(toDir);
  mkdirSync(toDir, { recursive: true });

  function prepare(sourcePath, targetPath) {
    const isDir = lstatSync(sourcePath).isDirectory();
    if (existsSync(targetPath) && lstatSync(targetPath).isDirectory() !== isDir) {
      rmSync(targetPath, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
    }
    if (isDir) {
      mkdirSync(targetPath, { recursive: true });
      for (const name of readdirSync(sourcePath)) {
        prepare(join(sourcePath, name), join(targetPath, name));
      }
    }
  }

  prepare(fromDir, toDir);
  cpSync(fromDir, toDir, { recursive: true, force: true });

  function prune(sourcePath, targetPath) {
    for (const name of readdirSync(targetPath)) {
      const dstPath = join(targetPath, name);
      const srcPath = join(sourcePath, name);
      if (existsSync(srcPath)) {
        if (lstatSync(dstPath).isDirectory() && lstatSync(srcPath).isDirectory()) {
          prune(srcPath, dstPath);
        }
        continue;
      }
      if (lstatSync(dstPath).isDirectory()) {
        prune(srcPath, dstPath);
        try {
          rmdirSync(dstPath);
        } catch (error) {
          if (!LOCK_ERROR_CODES.has(error?.code)) throw error;
        }
      } else {
        unlinkSync(dstPath);
      }
    }
  }

  prune(fromDir, toDir);
}

export function assertOwnedPath(root, target) {
  const rel = relative(resolve(root), resolve(target));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('目标路径越界');
  }
  let cur = resolve(root);
  if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) {
    throw new Error('目标根目录不能是符号链接');
  }
  for (const part of rel.split(/[\\/]/)) {
    cur = join(cur, part);
    if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) {
      throw new Error('目标路径包含符号链接');
    }
  }
  return resolve(target);
}

export function assertNoSymlinks(target) {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`禁止包含符号链接: ${target}`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(target)) {
      assertNoSymlinks(join(target, name));
    }
  }
}

function hasAnyFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = lstatSync(full);
    if (!stat.isDirectory()) return true;
    if (hasAnyFiles(full)) return true;
  }
  return false;
}

function migrateLegacyData(geminiRoot) {
  const legacyDataDir = join(geminiRoot, 'antigravity', 'plugin_data', LEGACY_PLUGIN_ID);
  const dataDir = join(geminiRoot, 'antigravity', 'plugin_data', PLUGIN_ID);
  const migratedDataFiles = [];

  if (!existsSync(legacyDataDir)) {
    return { dataDir, migratedDataFiles };
  }

  assertOwnedPath(geminiRoot, legacyDataDir);
  assertNoSymlinks(legacyDataDir);

  for (const filename of ['settings.json', 'custom-dictionary.json']) {
    const src = join(legacyDataDir, filename);
    if (!existsSync(src) || !lstatSync(src).isFile()) continue;
    const dst = join(dataDir, filename);
    if (existsSync(dst)) continue;
    assertOwnedPath(geminiRoot, dataDir);
    mkdirSync(dataDir, { recursive: true });
    assertNoSymlinks(dataDir);
    cpSync(src, dst, { force: false });
    migratedDataFiles.push(filename);
  }

  return { dataDir, migratedDataFiles };
}

function detectLegacyPlugin(pluginsDir) {
  const legacyPluginDir = join(pluginsDir, LEGACY_PLUGIN_ID);
  const legacyManifestPath = join(legacyPluginDir, 'plugin.json');
  if (!existsSync(legacyPluginDir) || !existsSync(legacyManifestPath)) {
    return { legacyPluginDetected: false, legacyPluginDir };
  }
  try {
    if (lstatSync(legacyPluginDir).isSymbolicLink() || lstatSync(legacyManifestPath).isSymbolicLink()) {
      return { legacyPluginDetected: false, legacyPluginDir };
    }
    const existing = JSON.parse(readFileSync(legacyManifestPath, 'utf8'));
    return {
      legacyPluginDetected: existing?.name === LEGACY_PLUGIN_ID,
      legacyPluginDir
    };
  } catch {
    return { legacyPluginDetected: false, legacyPluginDir };
  }
}

/**
 * Install agy-zh runtime files into <home>/.gemini/config/plugins/agy-zh
 * without modifying config.json or OS shortcuts.
 */
export async function installI18nPlugin({
  source = resolve(fileURLToPath(new URL('..', import.meta.url))),
  home = homedir(),
  renameFn = renameSync,
  rmFn = rmSync,
  renameRetries = 15,
  renameDelayMs = 100
} = {}) {
  const sourceRoot = resolve(source);
  const manifestPath = join(sourceRoot, 'plugin.json');
  if (!existsSync(manifestPath)) throw new Error('缺少 plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.name !== PLUGIN_ID) throw new Error(`plugin.json 中的 name 必须是 ${PLUGIN_ID}`);

  const geminiRoot = join(resolve(home), '.gemini');
  const pluginsDir = join(geminiRoot, 'config', 'plugins');
  const destination = join(pluginsDir, PLUGIN_ID);
  assertOwnedPath(geminiRoot, destination);

  if (existsSync(destination)) {
    assertNoSymlinks(destination);
    const existingManifestPath = join(destination, 'plugin.json');
    if (existsSync(existingManifestPath)) {
      const existing = JSON.parse(readFileSync(existingManifestPath, 'utf8'));
      if (existing?.name !== PLUGIN_ID) {
        throw new Error('安装位置已存在其他插件，已中止安装');
      }
    } else if (hasAnyFiles(destination)) {
      throw new Error('安装位置已存在未知目录，已中止安装');
    }
  }

  mkdirSync(pluginsDir, { recursive: true });
  const stageDir = join(pluginsDir, `.${PLUGIN_ID}-staging-${randomUUID()}`);
  const backupDir = join(pluginsDir, `.${PLUGIN_ID}-backup-${randomUUID()}`);
  assertOwnedPath(geminiRoot, stageDir);
  assertOwnedPath(geminiRoot, backupDir);

  let replacement = 'directory';
  let movedToBackup = false;
  try {
    mkdirSync(stageDir, { recursive: true });
    for (const item of RUNTIME_ITEMS) {
      const srcItem = join(sourceRoot, item);
      if (!existsSync(srcItem)) continue;
      assertNoSymlinks(srcItem);
      cpSync(srcItem, join(stageDir, item), { recursive: true, force: true });
    }
    try {
      if (existsSync(destination)) {
        await renameWithRetry(destination, backupDir, renameFn, {
          retries: renameRetries,
          delayMs: renameDelayMs
        });
        movedToBackup = true;
      }
      await renameWithRetry(stageDir, destination, renameFn, {
        retries: renameRetries,
        delayMs: renameDelayMs
      });
      if (movedToBackup && existsSync(backupDir)) {
        try {
          rmFn(backupDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
        } catch {}
      }
    } catch (error) {
      if (movedToBackup && !existsSync(destination) && existsSync(backupDir)) {
        try {
          renameSync(backupDir, destination);
          movedToBackup = false;
        } catch {}
      }
      if (!LOCK_ERROR_CODES.has(error?.code)) throw error;
      syncDirectoryInPlace(stageDir, destination);
      replacement = 'in-place';
    }
  } finally {
    for (const leftover of [stageDir, backupDir]) {
      try {
        if (existsSync(leftover)) {
          rmFn(leftover, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
        }
      } catch {}
    }
  }

  const { dataDir, migratedDataFiles } = migrateLegacyData(geminiRoot);
  const { legacyPluginDetected, legacyPluginDir } = detectLegacyPlugin(pluginsDir);

  return {
    name: manifest.name,
    version: manifest.version,
    destination,
    replacement,
    dataDir,
    migratedDataFiles,
    legacyPluginDetected,
    legacyPluginDir
  };
}

const entryPath = resolve(fileURLToPath(import.meta.url));
const argPath = process.argv[1] ? resolve(process.argv[1]) : '';
const isMain = Boolean(argPath) && (process.platform === 'win32'
  ? entryPath.toLowerCase() === argPath.toLowerCase()
  : entryPath === argPath);

if (isMain) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  try {
    if (major < 22 || (major === 22 && minor < 13)) {
      throw new Error('需要 Node.js 22.13 或更高版本');
    }
    const args = process.argv.slice(2);
    const homeIdx = args.indexOf('--home');
    const home = homeIdx >= 0 ? args[homeIdx + 1] : undefined;
    const result = await installI18nPlugin({ home });
    if (args.includes('--json')) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`已安装 Antigravity 界面汉化 (${result.name}) v${result.version} -> ${result.destination}`);
      if (result.migratedDataFiles.length > 0) {
        console.log(`已自动从旧版 ${LEGACY_PLUGIN_ID} 迁移个人数据 (${result.migratedDataFiles.join(', ')}) -> ${result.dataDir}`);
      }
      if (result.legacyPluginDetected) {
        console.log(`提示：检测到旧版插件目录 ${result.legacyPluginDir}，请在 Antigravity 的 Customizations → 已安装 中卸载旧版 "Agy i18n"，避免新旧插件同时运行。`);
      }
      console.log('说明：本安装器不会修改 config.json 或您的系统快捷方式。');
      console.log('下一步：');
      console.log('1. 在 Antigravity 的 Customizations 页面中启用 "Antigravity 界面汉化" 插件（及其 Sidecar）。');
      console.log('2. 请确保使用调试参数启动 Antigravity：');
      console.log(`   ${manualLaunchCommand({ home })}`);
    }
  } catch (error) {
    console.error(`安装失败：${error.message}`);
    process.exitCode = 1;
  }
}
