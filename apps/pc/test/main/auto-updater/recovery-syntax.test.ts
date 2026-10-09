// @vitest-environment node
import { it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
const run = promisify(execFile);
it.skipIf(process.platform === 'win32')(
  'parses all packaged POSIX guardian entry points with the system shell',
  async () => {
    for (const file of ['guardian.sh', 'restore.sh', 'publish-mac.sh'])
      await run('/bin/sh', ['-n', resolve('apps/pc/recovery', file)]);
  }
);
it.skipIf(process.platform !== 'win32')(
  'parses packaged PowerShell entry points on Windows without executing them',
  async () => {
    for (const file of ['guardian.ps1', 'launch.ps1']) {
      const path = resolve('apps/pc/recovery', file).replace(/'/g, "''");
      await run(
        join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe'
        ),
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile('${path}', [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | Out-String | Write-Error; exit 1 }`,
        ]
      );
    }
  }
);
