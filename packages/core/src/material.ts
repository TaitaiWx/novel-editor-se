/**
 * 生成资料目录约定（纯函数，不依赖 Node API，GUI 渲染进程与 CLI 共用）
 *
 * `<project>/资料/` 存放 AI 生成资料、记忆库（资料/记忆/）等非正文内容，
 * 收集「作品正文」语料（人物时间线、章节统计等）时必须整体排除。
 */

/** AI 生成资料的根目录名 */
export const GENERATED_MATERIAL_ROOT_NAME = '资料';

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * 判断文件/目录是否位于项目的生成资料根目录（`<root>/资料`）内，包含根目录本身。
 * 只按项目根下的第一级目录判断，不会误伤项目外层恰好叫「资料」的路径。
 */
export function isGeneratedMaterialPath(filePath: string, projectRoot: string): boolean {
  const root = normalizeSlashes(projectRoot);
  const target = normalizeSlashes(filePath);
  if (!root || !target) return false;
  const materialRoot = `${root}/${GENERATED_MATERIAL_ROOT_NAME}`;
  return target === materialRoot || target.startsWith(`${materialRoot}/`);
}
