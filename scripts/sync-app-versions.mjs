import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const rootPackagePath = path.join(repoRoot, 'package.json');
const appsDirectory = path.join(repoRoot, 'apps');

const readJson = async (filePath) => {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
};

const writeJson = async (filePath, data) => {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const rootPackage = await readJson(rootPackagePath);
const targetVersion = rootPackage.version;

if (!targetVersion) {
  throw new Error('Root package.json 缺少 version，无法同步 apps 版本号');
}

const appEntries = await fs.readdir(appsDirectory, { withFileTypes: true });
const updatedPackages = [];

for (const entry of appEntries) {
  if (!entry.isDirectory()) {
    continue;
  }

  const packageJsonPath = path.join(appsDirectory, entry.name, 'package.json');

  try {
    const appPackage = await readJson(packageJsonPath);
    if (appPackage.version === targetVersion) {
      continue;
    }

    appPackage.version = targetVersion;
    await writeJson(packageJsonPath, appPackage);
    updatedPackages.push(`apps/${entry.name}/package.json`);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      continue;
    }
    throw error;
  }
}

if (updatedPackages.length === 0) {
  console.log(`[sync-app-versions] apps 目录版本已与 root 一致: ${targetVersion}`);
} else {
  console.log(`[sync-app-versions] 已同步版本 ${targetVersion} 到: ${updatedPackages.join(', ')}`);
}
