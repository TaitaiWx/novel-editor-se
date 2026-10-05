/**
 * 为每次 E2E 运行在临时目录生成一个全新的示例项目（与 `ne init` 的目录约定一致）
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface FixtureProject {
  root: string;
  /** 项目内相对路径 → 绝对路径 */
  resolve(...segments: string[]): string;
  dispose(): Promise<void>;
}

export const FIXTURE_CHAPTERS = {
  first: { file: 'novels/星河旅人/001-启程.md', title: '001-启程.md' },
  second: { file: 'novels/星河旅人/002-迷雾森林.md', title: '002-迷雾森林.md' },
  other: { file: 'novels/剑与诗/001-少年.md', title: '001-少年.md' },
} as const;

const FILES: Record<string, string> = {
  '.novel-editor/config.json': `${JSON.stringify(
    {
      schemaVersion: 1,
      name: 'E2E 测试项目',
      createdAt: '2026-01-01T00:00:00.000Z',
      novelsDir: 'novels',
      chapterExtension: '.md',
    },
    null,
    2
  )}\n`,
  [FIXTURE_CHAPTERS.first.file]:
    '# 启程\n\n林舟背起行囊，走出了小镇。\n\n远处的山峦笼罩在晨雾之中。\n',
  [FIXTURE_CHAPTERS.second.file]: '# 迷雾森林\n\n森林里的雾气越来越浓。\n',
  [FIXTURE_CHAPTERS.other.file]: '# 少年\n\n少年握紧了手中的木剑。\n',
  '资料/世界观.md': '# 世界观\n\n星河大陆分为东西两境。\n',
};

export async function createFixtureProject(
  prefix = 'novel-editor-e2e-project-'
): Promise<FixtureProject> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  for (const [relative, content] of Object.entries(FILES)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf-8');
  }
  return {
    root,
    resolve: (...segments) => path.join(root, ...segments),
    dispose: () => rm(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}
