/**
 * CLI 版本号：构建时由 vite define 注入；从源码运行时读取 package.json
 */
import { readFileSync } from 'node:fs';

declare const __NE_CLI_VERSION__: string | undefined;

function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf-8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const CLI_VERSION: string =
  typeof __NE_CLI_VERSION__ === 'string' ? __NE_CLI_VERSION__ : readPackageVersion();
