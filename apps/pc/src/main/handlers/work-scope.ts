/**
 * 作品作用域准备（db-init 时调用）：人物 / 设定 / 大纲等数据库内容跟随作品。
 *
 * - 每部作品（`<novelsDir>/<作品>/`）一条 novels 记录（不存在时创建）
 * - 旧版数据：项目根记录下有内容、项目里恰好一部作品且该作品还没有内容时，整体迁移到该作品；
 *   项目根 `资料/` 同样只在一部作品时移入该作品（core migrateLegacyProjectMaterials）
 * - 其余情况保留在项目根，作为「未归属」继续可见（返回 unassignedRecords 供 GUI 展示）
 *
 * 普通文件夹（没有 `.novel-editor/config.json`）不做任何处理：整个文件夹是一部作品。
 */
import path from 'node:path';
import { migrateLegacyProjectMaterials, readProjectLayout } from '@novel-editor/core';
import {
  ensureNovelByFolder,
  hasNovelContentByFolder,
  migrateProjectContentToWork,
} from '@novel-editor/store';

export interface ProjectWorkScopeInfo {
  /** 是否是 `ne init` 项目 */
  configured: boolean;
  /** 项目根记录下是否还有不属于任何作品的人物 / 设定 / 大纲（GUI 显示「未归属」） */
  unassignedRecords: boolean;
  /** 本次是否把旧版内容迁移到了唯一的作品 */
  migratedRecords: boolean;
  migratedMaterials: boolean;
}

export async function prepareProjectWorkScopes(projectRoot: string): Promise<ProjectWorkScopeInfo> {
  const info: ProjectWorkScopeInfo = {
    configured: false,
    unassignedRecords: false,
    migratedRecords: false,
    migratedMaterials: false,
  };
  const layout = await readProjectLayout(projectRoot).catch(() => null);
  if (!layout) return info;
  info.configured = true;
  info.migratedMaterials = (
    await migrateLegacyProjectMaterials(projectRoot).catch(() => ({ migrated: false }))
  ).migrated;

  const works = layout.novels.map((name) => ({ name, path: path.join(layout.novelsPath, name) }));
  if (works.length === 1) {
    info.migratedRecords = migrateProjectContentToWork(
      projectRoot,
      works[0].path,
      works[0].name
    ).migrated;
  }
  for (const work of works) ensureNovelByFolder(work.path, work.name);
  info.unassignedRecords = hasNovelContentByFolder(projectRoot);
  return info;
}
