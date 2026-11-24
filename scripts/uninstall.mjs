import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoSymlinks, assertOwnedPath } from './install.mjs';

/**
 * Uninstall agy-i18n cleanly without touching config.json, shortcuts, or chat history.
 */
export function uninstallI18nPlugin({
  home = homedir(),
  purge = false
} = {}) {
  const geminiRoot = join(resolve(home), '.gemini');
  const destination = join(geminiRoot, 'config', 'plugins', 'agy-i18n');
  const dataDir = join(geminiRoot, 'antigravity', 'plugin_data', 'agy-i18n');
  const sidecarDir = join(geminiRoot, 'antigravity', 'sidecar_data', 'agy-i18n');
  const legacySidecarDir = join(geminiRoot, 'antigravity', 'sidecar_data', 'agy-i18n', 'i18n');

  let removedPlugin = false;
  let purgedData = false;

  if (existsSync(destination)) {
    assertOwnedPath(geminiRoot, destination);
    assertNoSymlinks(destination);
    const manifestPath = join(destination, 'plugin.json');
    if (!existsSync(manifestPath)) {
      throw new Error('目标目录缺少 plugin.json，无法确认归属');
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest?.name !== 'agy-i18n') {
      throw new Error('目标目录不属于 agy-i18n，已取消删除');
    }
    rmSync(destination, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
    removedPlugin = true;
  }

  if (purge) {
    for (const dir of [dataDir, legacySidecarDir, sidecarDir]) {
      if (existsSync(dir)) {
        assertOwnedPath(geminiRoot, dir);
        assertNoSymlinks(dir);
        rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
        purgedData = true;
      }
    }
  }

  return {
    removedPlugin,
    purgedData,
    destination
  };
}

const entryPath = resolve(fileURLToPath(import.meta.url));
const argPath = process.argv[1] ? resolve(process.argv[1]) : '';
const isMain = Boolean(argPath) && (process.platform === 'win32'
  ? entryPath.toLowerCase() === argPath.toLowerCase()
  : entryPath === argPath);

if (isMain) {
  try {
    const args = process.argv.slice(2);
    const homeIdx = args.indexOf('--home');
    const home = homeIdx >= 0 ? args[homeIdx + 1] : undefined;
    const purge = args.includes('--purge');
    const result = uninstallI18nPlugin({ home, purge });
    if (args.includes('--json')) {
      console.log(JSON.stringify(result));
    } else {
      console.log(result.removedPlugin ? `已卸载插件目录：${result.destination}` : '未检测到已安装的 Agy i18n 插件目录。');
      console.log(result.purgedData ? '已清理插件配置与本地词典数据。' : '已保留个人设置与自定义词典（如需一并清理请加 --purge）。');
    }
  } catch (error) {
    console.error(`卸载失败：${error.message}`);
    process.exitCode = 1;
  }
}
