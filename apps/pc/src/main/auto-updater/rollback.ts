/**
 * 高可用回滚：解析回滚目标、预缓存当前版本安装包、清理缓存、执行回滚安装。
 */
import { app, shell } from 'electron';
import log from 'electron-log/main';
import { access, chmod, readdir, stat, unlink } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import type { RollbackTarget } from '../auto-updater-state';
import { download } from '../resilient-downloader';
import {
  getMirrorShortcutName,
  isRollbackCacheCandidate,
  selectCacheFilesToPrune,
  selectReleaseAsset,
} from './assets';
import type { ReleaseAssetLike } from './assets';
import {
  MAX_ROLLBACK_CACHE_ENTRIES,
  MIRROR_BASE_URL,
  ROLLBACK_DOWNLOAD_TIMEOUT_MS,
  UPDATE_REPO,
} from './constants';
import { clearPendingState } from './policy';
import { loadUpdaterState, persistUpdaterState } from './state-store';

interface GithubRelease {
  tag_name: string;
  assets: ReleaseAssetLike[];
}

async function resolveRollbackTarget(version: string) {
  // 优先尝试 GitHub API
  try {
    const response = await fetch(
      `https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/tags/v${version}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Novel-Editor-Updater',
        },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (response.ok) {
      const release = (await response.json()) as GithubRelease;
      const selectedAsset = selectReleaseAsset(release.assets);

      if (selectedAsset) {
        return {
          version,
          tag: release.tag_name,
          assetName: selectedAsset.name,
          assetUrl: selectedAsset.browser_download_url,
          cachedInstallerPath: null,
          cachedInstallerHash: null,
        } satisfies RollbackTarget;
      }
    }
  } catch (error) {
    log.warn(`GitHub API 不可达，尝试国内镜像: ${error}`);
  }

  // 兜底：国内镜像
  return resolveRollbackTargetFromMirror(version);
}

async function resolveRollbackTargetFromMirror(version: string) {
  const assetName = getMirrorShortcutName();
  if (!assetName) {
    throw new Error(`未找到适用于当前平台的回退安装包: ${version}`);
  }

  const mirrorUrl = `${MIRROR_BASE_URL}/${assetName}`;
  // 验证镜像资源是否存在
  const headResp = await fetch(mirrorUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(5000),
  });

  if (!headResp.ok) {
    throw new Error(`镜像回退包不可用: ${mirrorUrl} (${headResp.status})`);
  }

  return {
    version,
    tag: `v${version}`,
    assetName,
    assetUrl: mirrorUrl,
    cachedInstallerPath: null,
    cachedInstallerHash: null,
  } satisfies RollbackTarget;
}

export function getRollbackCacheDir() {
  return join(app.getPath('userData'), 'rollback-cache');
}

/** 计算文件的 SHA256 摘要 */
async function computeFileHash(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/** 检查本地缓存的安装包是否存在且完整 */
export async function isCachedInstallerValid(
  cachedPath: string | null,
  expectedHash?: string | null
): Promise<boolean> {
  if (!cachedPath) return false;
  try {
    const fileStat = await stat(cachedPath);
    // 文件必须 > 1MB 才算有效安装包（排除损坏的空文件）
    if (fileStat.size <= 1_048_576) return false;
    // 如果有预期的 hash，校验完整性
    if (expectedHash) {
      const actualHash = await computeFileHash(cachedPath);
      if (actualHash !== expectedHash) {
        log.warn(`缓存安装包 hash 不匹配: expected=${expectedHash}, actual=${actualHash}`);
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** 流式下载安装包到本地 — 支持断点续传 + 自动重试 + 弱网恢复 */
async function downloadRollbackAsset(
  target: RollbackTarget
): Promise<{ path: string; hash: string }> {
  const filePath = join(getRollbackCacheDir(), target.assetName);
  const result = await download({
    url: target.assetUrl,
    destPath: filePath,
    timeoutMs: ROLLBACK_DOWNLOAD_TIMEOUT_MS,
    maxRetries: 5,
  });

  log.info(`回退安装包已缓存: ${result.path} (sha256=${result.hash.slice(0, 16)}…)`);
  return { path: result.path, hash: result.hash };
}

/**
 * 在新版本下载完成后，预缓存当前版本的安装包到本地。
 * 这是高可用回滚的核心：确保回滚时不依赖网络。
 */
export async function preCacheCurrentVersion(): Promise<RollbackTarget | null> {
  const currentVersion = app.getVersion();
  try {
    const target = await resolveRollbackTarget(currentVersion);

    // 检查是否已有有效缓存
    const existingPath = join(getRollbackCacheDir(), target.assetName);
    if (await isCachedInstallerValid(existingPath)) {
      const hash = await computeFileHash(existingPath);
      log.info(`当前版本 ${currentVersion} 安装包已在缓存中: ${existingPath}`);
      return { ...target, cachedInstallerPath: existingPath, cachedInstallerHash: hash };
    }

    const { path: cachedPath, hash } = await downloadRollbackAsset(target);
    return { ...target, cachedInstallerPath: cachedPath, cachedInstallerHash: hash };
  } catch (error) {
    log.error(`预缓存版本 ${currentVersion} 安装包失败:`, error);
    // 降级：仍保存 URL 信息，回滚时尝试在线下载
    try {
      const target = await resolveRollbackTarget(currentVersion);
      return { ...target, cachedInstallerPath: null, cachedInstallerHash: null };
    } catch {
      return null;
    }
  }
}

/** 清理旧的回滚缓存，只保留最近 N 个版本 */
export async function pruneRollbackCache(keepAssetName?: string) {
  const cacheDir = getRollbackCacheDir();
  try {
    await access(cacheDir);
  } catch {
    return;
  }

  const entries = await readdir(cacheDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && isRollbackCacheCandidate(e.name));

  if (files.length <= MAX_ROLLBACK_CACHE_ENTRIES) return;

  // 按修改时间排序，保留最新的
  const fileStats = await Promise.all(
    files.map(async (f) => {
      const fullPath = join(cacheDir, f.name);
      const s = await stat(fullPath);
      return { name: f.name, path: fullPath, mtimeMs: s.mtimeMs };
    })
  );

  for (const file of selectCacheFilesToPrune(
    fileStats,
    MAX_ROLLBACK_CACHE_ENTRIES,
    keepAssetName
  )) {
    try {
      await unlink(file.path);
      log.info(`已清理旧回滚缓存: ${file.name}`);
    } catch (error) {
      log.warn(`清理回滚缓存失败: ${file.name}`, error);
    }
  }
}

async function openRollbackInstaller(filePath: string) {
  if (process.platform === 'linux' && filePath.toLowerCase().endsWith('.appimage')) {
    await chmod(filePath, 0o755);
    const child = spawn(filePath, [], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  const errorMessage = await shell.openPath(filePath);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
}

export async function rollbackToPreviousVersion() {
  const state = await loadUpdaterState();
  if (!state.rollbackTarget) {
    throw new Error('当前没有可用的回退版本');
  }

  let installerPath: string;

  // 优先使用本地缓存（高可用：不依赖网络），校验 SHA256 完整性
  const cachedPath = state.rollbackTarget.cachedInstallerPath;
  if (
    cachedPath &&
    (await isCachedInstallerValid(cachedPath, state.rollbackTarget.cachedInstallerHash))
  ) {
    installerPath = cachedPath;
    log.info(`使用本地缓存进行回滚: ${installerPath}`);
  } else {
    // 降级：从网络重新下载
    log.warn('本地回滚缓存不可用或校验失败，尝试从网络下载');
    const { path, hash } = await downloadRollbackAsset(state.rollbackTarget);
    installerPath = path;
    // 更新缓存路径和 hash
    state.rollbackTarget.cachedInstallerPath = installerPath;
    state.rollbackTarget.cachedInstallerHash = hash;
    await persistUpdaterState();
  }

  // 回滚后重置 pending 状态，避免老版本启动后被误判为异常
  clearPendingState(state);
  await persistUpdaterState();

  await openRollbackInstaller(installerPath);
  return {
    version: state.rollbackTarget.version,
    installerPath,
  };
}
