/**
 * 生成资料目录约定（纯函数，不依赖 Node API，GUI 渲染进程与 CLI 共用）
 *
 * 资料跟随作品：`ne init` 项目中每部作品有自己的 `<novelsDir>/<作品>/资料/`
 * （AI 生成资料、设定笔记、素材、记忆库 `资料/记忆/`）；项目根下的 `<project>/资料/`
 * 是旧版布局遗留的「未归属」资料（普通文件夹则整个文件夹就是一部作品，资料在 `<folder>/资料/`）。
 * 收集「作品正文」语料（人物时间线、章节统计、写作日志等）时必须整体排除这些目录。
 */

/** AI 生成资料的根目录名 */
export const GENERATED_MATERIAL_ROOT_NAME = '资料';

/** 默认的作品根目录（与 core project.ts 的 DEFAULT_NOVELS_DIR 一致） */
const DEFAULT_NOVELS_DIR = 'novels';

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function splitSegments(value: string): string[] {
  return normalizeSlashes(value)
    .split('/')
    .filter((segment) => segment && segment !== '.');
}

/**
 * 判断文件/目录是否位于生成资料目录内（包含资料目录本身）。按相对 root 的路径判断：
 * 1. `<root>/资料/…`：root 是作品目录（或普通文件夹、旧版项目根）时的资料目录
 * 2. `<root>/<novelsDir>/<作品>/资料/…`：root 是 `ne init` 项目根时各作品的资料目录
 *
 * 不会误伤项目外层恰好叫「资料」的路径，也不会把名为「资料」的作品当成资料目录。
 * novelsDir 默认为 `novels`，为 `.` 时作品直接位于项目根下。
 */
export function isGeneratedMaterialPath(
  filePath: string,
  projectRoot: string,
  novelsDir: string = DEFAULT_NOVELS_DIR
): boolean {
  const root = normalizeSlashes(projectRoot);
  const target = normalizeSlashes(filePath);
  if (!root || !target) return false;
  if (target !== root && !target.startsWith(`${root}/`)) return false;
  const segments = splitSegments(target.slice(root.length));
  if (segments[0] === GENERATED_MATERIAL_ROOT_NAME) return true;
  const novelsSegments = splitSegments(novelsDir);
  if (novelsSegments.some((segment, index) => segments[index] !== segment)) return false;
  const rest = segments.slice(novelsSegments.length);
  return rest.length >= 2 && rest[1] === GENERATED_MATERIAL_ROOT_NAME;
}

/** 作品（或普通文件夹 / 未归属项目根）的资料目录路径（纯字符串拼接，沿用 root 的分隔符） */
export function getMaterialRootPath(scopeRoot: string): string {
  const separator = scopeRoot.includes('\\') && !scopeRoot.includes('/') ? '\\' : '/';
  return `${scopeRoot.replace(/[\\/]+$/, '')}${separator}${GENERATED_MATERIAL_ROOT_NAME}`;
}
