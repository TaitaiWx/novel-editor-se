import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { rebuild } from '@electron/rebuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const electronPackage = require('electron/package.json');
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const forceRebuild = process.env.FORCE_ELECTRON_REBUILD === 'true';

if (isCi && !forceRebuild) {
  console.log('[rebuild-native] Skip Electron native rebuild in CI install phase.');
  console.log(
    '[rebuild-native] Release packaging will rebuild native modules for the target arch.'
  );
  process.exit(0);
}

console.log(
  `[rebuild-native] Rebuilding native modules for Electron ${electronPackage.version} in ${appRoot}`
);

await rebuild({
  buildPath: appRoot,
  electronVersion: electronPackage.version,
  force: true,
  onlyModules: ['better-sqlite3'],
});

console.log('[rebuild-native] Native modules rebuilt successfully.');
