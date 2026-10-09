import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { isAbsolute } from 'node:path';
/** System polkit owns the authorization prompt. No sudo shell and no apt trust bypass. */
export async function installDebianArtifact(
  path: string,
  expected: { algorithm: 'sha256' | 'sha512'; value: string }
) {
  if (!isAbsolute(path) || !path.endsWith('.deb')) throw new Error('Debian 安装包路径无效');
  const hash = createHash(expected.algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest(expected.algorithm === 'sha256' ? 'hex' : 'base64') !== expected.value)
    throw new Error('Debian 安装包校验失败');
  await new Promise<void>((resolve, reject) => {
    execFile(
      '/usr/bin/pkexec',
      ['/usr/bin/dpkg', '--install', path],
      { timeout: 120_000 },
      (error) => (error ? reject(error) : resolve())
    );
  });
}
