/**
 * 高可用回滚：解析回滚目标、预缓存当前版本安装包、清理缓存、执行回滚安装。
 */
import { app } from 'electron';
import log from 'electron-log/main';
import { access, mkdir, readdir, stat, unlink } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { createReadStream } from 'fs';
import type { RollbackTarget } from '../auto-updater-state';
import { download } from '../resilient-downloader';
import { isRollbackCacheCandidate, selectCacheFilesToPrune } from './assets';
import type { ReleaseAssetLike } from './assets';
import {
  MAX_ROLLBACK_CACHE_ENTRIES,
  MIRROR_BASE_URL,
  ROLLBACK_DOWNLOAD_TIMEOUT_MS,
  UPDATE_REPO,
} from './constants';
import {
  assertRollbackVersion,
  isBoundRollbackTarget,
  rollbackAssetNames,
  targetFromManifest,
  supportsNativeRollback,
} from './rollback-metadata';
import { installRollbackArtifact } from './rollback-install';
import { loadUpdaterState, persistUpdaterState } from './state-store';

interface GithubRelease {
  tag_name: string;
  assets: (ReleaseAssetLike & { digest?: string })[];
}

export async function resolveRollbackTarget(version: string): Promise<RollbackTarget> {
  assertRollbackVersion(version);
  if (!supportsNativeRollback())
    throw new Error('当前安装形式不支持自动回退，请使用 AppImage 或系统安装包恢复旧版本');
  try {
    const response = await fetch(
      `https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/tags/v${version}`,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Novel-Editor-Updater' },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (response.ok) {
      const release = (await response.json()) as GithubRelease;
      const asset =
        release.tag_name === `v${version}` &&
        release.assets?.find(
          (a) =>
            rollbackAssetNames(version).includes(a.name) &&
            /^sha256:[a-f0-9]{64}$/.test(a.digest ?? '')
        );
      const protocolAsset = release.assets?.find((a) => a.name === 'rollback-protocol.json');
      let protocolCompatible = false;
      if (
        asset &&
        protocolAsset &&
        new URL(protocolAsset.browser_download_url).protocol === 'https:'
      ) {
        const protocolResponse = await fetch(protocolAsset.browser_download_url, {
          signal: AbortSignal.timeout(8000),
        });
        if (protocolResponse.ok) {
          const protocol = (await protocolResponse.json()) as {
            version?: string;
            rollbackProtocol?: number;
          };
          protocolCompatible = protocol.version === version && protocol.rollbackProtocol === 1;
        }
      }
      if (asset && protocolCompatible) {
        const target: RollbackTarget = {
          rollbackProtocol: 1,
          version,
          tag: release.tag_name,
          assetName: asset.name,
          assetUrl: asset.browser_download_url,
          sha256: asset.digest!.slice(7),
          platform: process.platform,
          arch: process.arch,
          cachedInstallerPath: null,
          cachedInstallerHash: null,
        };
        if (isBoundRollbackTarget(target)) return target;
      }
    }
  } catch (error) {
    log.warn(`GitHub 回退信息不可用，尝试版本镜像: ${error}`);
  }
  const baseUrl = `${MIRROR_BASE_URL.replace(/\/latest\/?$/, '')}/releases/v${version}`;
  const response = await fetch(`${baseUrl}/manifest.json`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`版本镜像不可用: ${version} (${response.status})`);
  return targetFromManifest(await response.json(), version, baseUrl);
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
  if (!cachedPath || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) return false;
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
  if (!isBoundRollbackTarget(target)) throw new Error('回退包缺少可信的版本、架构或摘要');
  const filePath = getRollbackCachePath(target);
  await mkdir(getRollbackCacheDir(), { recursive: true });
  const result = await download({
    url: target.assetUrl,
    destPath: filePath,
    timeoutMs: ROLLBACK_DOWNLOAD_TIMEOUT_MS,
    maxRetries: 5,
  });

  if (!(await isCachedInstallerValid(result.path, target.sha256))) {
    await unlink(result.path).catch(() => undefined);
    throw new Error('回退包与发布摘要不匹配，已拒绝使用');
  }
  log.info(`回退安装包已缓存: ${result.path} (sha256=${result.hash.slice(0, 16)}…)`);
  return { path: result.path, hash: target.sha256! };
}

/**
 * 在新版本下载完成后，预缓存当前版本的安装包到本地。
 * 这是高可用回滚的核心：确保回滚时不依赖网络。
 */
export function getRollbackCachePath(target: RollbackTarget) {
  if (!isBoundRollbackTarget(target)) throw new Error('回退包身份无效');
  return join(getRollbackCacheDir(), `${target.platform}-${target.arch}-${target.assetName}`);
}

export async function preCacheCurrentVersion(): Promise<RollbackTarget | null> {
  const currentVersion = app.getVersion();
  try {
    const target = await resolveRollbackTarget(currentVersion);

    // 检查是否已有有效缓存
    const existingPath = getRollbackCachePath(target);
    if (await isCachedInstallerValid(existingPath, target.sha256)) {
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

let rollbackInFlight: Promise<{ version: string; installerPath: string }> | null = null;
let rollbackActive = false;
export function isRollbackInProgress() {
  return rollbackActive;
}

export function rollbackToPreviousVersion() {
  if (rollbackInFlight) return rollbackInFlight;
  rollbackActive = true;
  rollbackInFlight = performRollback()
    .catch((error) => {
      rollbackActive = false;
      throw error;
    })
    .finally(() => {
      rollbackInFlight = null;
    });
  return rollbackInFlight;
}

async function performRollback() {
  const state = await loadUpdaterState();
  if (!state.rollbackTarget) throw new Error('当前没有可用的回退版本');
  let target = state.rollbackTarget;
  // Legacy cache hashes only attested to the downloaded bytes, not the requested release.
  if (!isBoundRollbackTarget(target)) target = await resolveRollbackTarget(target.version);
  if (target.version === app.getVersion()) throw new Error('回退目标与当前版本相同');
  const expectedPath = getRollbackCachePath(target);
  if (
    target.cachedInstallerPath !== expectedPath ||
    !(await isCachedInstallerValid(expectedPath, target.sha256))
  ) {
    const cached = await downloadRollbackAsset(target);
    target = { ...target, cachedInstallerPath: cached.path, cachedInstallerHash: cached.hash };
  }
  state.rollbackTarget = target;
  state.rollbackPendingVersion = target.version;
  state.rejectedVersion = state.pendingVersion ?? app.getVersion();
  await persistUpdaterState();
  // Keep pendingVersion and failure counts until this exact old version reports healthy.
  await installRollbackArtifact(target, expectedPath);
  return { version: target.version, installerPath: expectedPath };
}
