import { readFile, readdir, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');

function getRolloutPercentage(channel) {
  const envMap = {
    latest: process.env.NOVEL_EDITOR_STABLE_STAGING_PERCENTAGE,
    beta: process.env.NOVEL_EDITOR_BETA_STAGING_PERCENTAGE,
    alpha: process.env.NOVEL_EDITOR_CANARY_STAGING_PERCENTAGE,
  };

  const parsed = Number.parseInt(envMap[channel] ?? '', 10);
  if (!Number.isNaN(parsed)) {
    return Math.max(1, Math.min(parsed, 100));
  }

  if (channel === 'alpha') {
    return 10;
  }

  return 100;
}

export async function applyUpdateMetadata(
  outputDir,
  channel = process.env.NOVEL_EDITOR_RELEASE_CHANNEL ?? 'latest'
) {
  const rolloutPercentage = getRolloutPercentage(channel);
  const entries = await readdir(outputDir, { withFileTypes: true });
  const targetPrefix = channel === 'latest' ? 'latest' : channel;
  const modifiedFiles = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.yml') || !entry.name.startsWith(targetPrefix)) {
      continue;
    }

    const filePath = join(outputDir, entry.name);
    const currentContent = await readFile(filePath, 'utf8');
    const nextContent = currentContent.includes('stagingPercentage:')
      ? currentContent.replace(
          /stagingPercentage:\s*\d+/u,
          `stagingPercentage: ${rolloutPercentage}`
        )
      : `${currentContent.trimEnd()}\nstagingPercentage: ${rolloutPercentage}\n`;

    await writeFile(filePath, nextContent, 'utf8');
    modifiedFiles.push(filePath);
  }

  return modifiedFiles;
}

export default async function afterAllArtifactBuild(context) {
  return applyUpdateMetadata(context.outDir);
}

// 允许在 CI 和本地预检里显式执行，避免只依赖 electron-builder hook。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputDir = process.argv[2] ? resolve(process.argv[2]) : join(appRoot, 'build');
  const channel = process.argv[3] ?? process.env.NOVEL_EDITOR_RELEASE_CHANNEL ?? 'latest';

  applyUpdateMetadata(outputDir, channel).catch((error) => {
    console.error('更新元数据处理失败:', error);
    process.exit(1);
  });
}
