/**
 * E2E fixture：每次运行把示例作品集（apps/pc/sample-data）完整拷贝到临时目录
 *
 * 示例作品集是唯一的数据源——首次启动展示给用户的就是同一份内容，E2E 直接在它上面验证所有功能。
 * 拷贝时跳过开发时可能残留的本机数据库 / 会话 / 写作日志（与应用播种示例时的规则相同）。
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSeedRuntimeArtifact } from '@novel-editor/core';

export const SAMPLE_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../sample-data'
);

export interface FixtureProject {
  root: string;
  /** 项目内相对路径 → 绝对路径 */
  resolve(...segments: string[]): string;
  dispose(): Promise<void>;
}

/**
 * 「星河旅人」第一卷在磁盘与正文树中的路径。示例是 `ne init` 项目：文件面板顶部的作品切换器选择
 * 当前作品，正文树只显示当前作品的「卷 / 章」（不显示 novels 容器与作品节点本身）
 */
export const FIXTURE_WORK = '星河旅人';
export const FIXTURE_WORK_DIR = 'novels/星河旅人';
export const FIXTURE_VOLUME_DIR = 'novels/星河旅人/第一卷-离乡';
export const FIXTURE_CHAPTER_TREE = ['第一卷-离乡'] as const;
/** 资料与成长档案跟随作品：星河旅人的资料 / 记忆库 */
export const FIXTURE_MATERIAL_DIR = 'novels/星河旅人/资料';
export const FIXTURE_MEMORY_DIR = 'novels/星河旅人/资料/记忆';

export const FIXTURE_CHAPTERS = {
  first: { file: `${FIXTURE_VOLUME_DIR}/001-启程.md`, title: '001-启程.md' },
  second: { file: `${FIXTURE_VOLUME_DIR}/002-迷雾森林.md`, title: '002-迷雾森林.md' },
  other: { file: 'novels/剑与诗/001-少年.md', title: '001-少年.md' },
} as const;

export interface FixtureOptions {
  prefix?: string;
  /** 不拷贝这些相对路径（例如 `novels/星河旅人/资料/记忆`，用于验证首次使用流程） */
  exclude?: string[];
}

export async function createFixtureProject(
  options: FixtureOptions | string = {}
): Promise<FixtureProject> {
  const { prefix = 'novel-editor-e2e-project-', exclude = [] } =
    typeof options === 'string' ? { prefix: options } : options;
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const excluded = exclude.map((item) => item.split(/[\\/]/).join(path.sep));
  await cp(SAMPLE_DATA_DIR, root, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(SAMPLE_DATA_DIR, source);
      if (isSeedRuntimeArtifact(relative)) return false;
      return !excluded.some(
        (item) => relative === item || relative.startsWith(`${item}${path.sep}`)
      );
    },
  });
  return {
    root,
    resolve: (...segments) => path.join(root, ...segments),
    dispose: () => rm(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}
