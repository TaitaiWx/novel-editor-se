import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const mode = process.argv[2];
const artifactsDir = process.env.ARTIFACTS_DIR ?? 'artifacts';
const repository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;

if (!mode || !['local', 'github'].includes(mode)) {
  throw new Error('Usage: node scripts/validate-release-assets.mjs <local|github>');
}

function inferChannelFromVersion(version) {
  if (version.includes('-alpha.')) {
    return 'alpha';
  }
  if (version.includes('-beta.')) {
    return 'beta';
  }
  return 'latest';
}

function expectedMetadataFiles(channel) {
  if (channel === 'alpha') {
    return ['alpha.yml', 'alpha-mac.yml', 'alpha-linux.yml'];
  }
  if (channel === 'beta') {
    return ['beta.yml', 'beta-mac.yml', 'beta-linux.yml'];
  }
  return ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
}

function requiredPredicates() {
  return [
    {
      description: 'Windows installer (.exe)',
      test: (name) => name.toLowerCase().endsWith('.exe'),
    },
    {
      description: 'macOS dmg (.dmg)',
      test: (name) => name.toLowerCase().endsWith('.dmg'),
    },
    {
      description: 'macOS zip (.zip)',
      test: (name) => name.toLowerCase().endsWith('.zip'),
    },
    {
      description: 'Linux AppImage (.AppImage)',
      test: (name) => name.endsWith('.AppImage'),
    },
    {
      description: 'Linux deb (.deb)',
      test: (name) => name.toLowerCase().endsWith('.deb'),
    },
  ];
}

function ensureExpectedAssets(assetNames, sourceLabel) {
  const missing = [];

  for (const metadataFile of expectedMetadataFiles(releaseChannel)) {
    if (!assetNames.includes(metadataFile)) {
      missing.push(`missing metadata file ${metadataFile}`);
    }
  }

  for (const requirement of requiredPredicates()) {
    if (!assetNames.some(requirement.test)) {
      missing.push(`missing ${requirement.description}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`${sourceLabel} validation failed:\n- ${missing.join('\n- ')}`);
  }
}

async function listLocalArtifacts() {
  try {
    const entries = await readdir(artifactsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `Artifacts directory not found: ${join(process.cwd(), artifactsDir)}. Run this in CI after artifact download, or set ARTIFACTS_DIR to a populated directory.`
      );
    }

    throw error;
  }
}

async function resolveReleaseContext() {
  if (process.env.RELEASE_TAG && process.env.RELEASE_CHANNEL) {
    return {
      releaseTag: process.env.RELEASE_TAG,
      releaseChannel: process.env.RELEASE_CHANNEL,
    };
  }

  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  const version = packageJson.version;

  return {
    releaseTag: process.env.RELEASE_TAG ?? `v${version}`,
    releaseChannel: process.env.RELEASE_CHANNEL ?? inferChannelFromVersion(version),
  };
}

async function fetchReleaseAssets() {
  if (!repository || !githubToken) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required for github mode');
  }

  const url = `https://api.github.com/repos/${repository}/releases/tags/${releaseTag}`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'User-Agent': 'novel-editor-release-validator',
      },
    });

    if (response.ok) {
      const release = await response.json();
      return release.assets.map((asset) => asset.name);
    }

    if (attempt === 5) {
      throw new Error(`Failed to fetch release assets for ${releaseTag}: ${response.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }

  return [];
}

const { releaseTag, releaseChannel } = await resolveReleaseContext();
const assetNames = mode === 'local' ? await listLocalArtifacts() : await fetchReleaseAssets();
ensureExpectedAssets(
  assetNames,
  mode === 'local'
    ? `Local artifacts in ${join(process.cwd(), artifactsDir)}`
    : `Published GitHub release ${releaseTag}`
);
console.log(`[release-validator] ${mode} validation passed for ${releaseTag} (${releaseChannel})`);
