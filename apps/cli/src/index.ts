/**
 * novel-editor / ne 命令行入口
 *
 * 独立于 Electron 运行，与 GUI 共享 @novel-editor/core 中的核心逻辑。
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CliError } from './errors';
import { runCli, type CliIO } from './run';

export { runCli } from './run';
export type { CliIO, RunCliOptions } from './run';

function readProcessStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return Promise.reject(
      new CliError(
        'USAGE',
        '没有检测到标准输入',
        '通过管道传入内容，例如: cat draft.md | ne file write a.md --stdin'
      )
    );
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const io: CliIO = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readStdin: readProcessStdin,
  };
  // 通过 `pnpm cli` / `pnpm dev` 从源码运行时，包管理器会切换到包目录，这里还原用户的原始目录
  const fromScript = ['cli', 'dev'].includes(process.env.npm_lifecycle_event ?? '');
  const cwd = fromScript && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
  const { exitCode } = await runCli(argv, { io, cwd });
  return exitCode;
}

/** 仅在作为可执行文件直接运行时执行（被测试 import 时不执行） */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`致命错误: ${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
