import { appendFile } from 'fs/promises';

function normalizeTagName(rawTagName) {
  return (rawTagName ?? '').replace(/^v/u, '');
}

function resolveReleaseChannel(tagName) {
  if (tagName.includes('-alpha.')) {
    return {
      publishChannel: 'alpha',
      releaseType: 'prerelease',
    };
  }

  if (tagName.includes('-beta.')) {
    return {
      publishChannel: 'beta',
      releaseType: 'prerelease',
    };
  }

  return {
    publishChannel: 'latest',
    releaseType: 'release',
  };
}

async function main() {
  const githubOutputPath = process.env.GITHUB_OUTPUT;
  const tagName = normalizeTagName(process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME);

  if (!tagName) {
    throw new Error('RELEASE_TAG or GITHUB_REF_NAME is required');
  }

  const { publishChannel, releaseType } = resolveReleaseChannel(tagName);

  if (githubOutputPath) {
    await appendFile(
      githubOutputPath,
      `publish_channel=${publishChannel}\nrelease_type=${releaseType}\n`,
      'utf8'
    );
  } else {
    process.stdout.write(`${JSON.stringify({ publishChannel, releaseType })}\n`);
  }
}

await main();
