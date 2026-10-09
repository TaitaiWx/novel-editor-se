import { withWorkspaceLease } from './workspace-lock';
/**
 * 作品作用域：资料、记忆库（成长档案）以及 GUI 数据库中的人物 / 设定 / 大纲都「跟随作品」。
 *
 * - `ne init` 项目（有 .novel-editor/config.json）：每部作品 `<novelsDir>/<作品>/` 是一个作用域，
 *   资料在 `<作品>/资料/`，记忆库在 `<作品>/资料/记忆/`
 * - 普通文件夹：整个文件夹就是一部作品（资料在 `<folder>/资料/`，与旧行为一致）
 * - 旧版项目把资料放在项目根 `<project>/资料/`：
 *   · 只有一部作品、且该作品还没有自己的 `资料/` 时，自动整体移入该作品（`migrateLegacyProjectMaterials`）
 *   · 否则保留在原处，作为「未归属」作用域（root = 项目根）继续可见、可用，由作者自行整理
 *
 * GUI 与 CLI（`ne growth --novel <作品>`）共用这里的解析规则。
 */
import { readdir, rename, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './errors';
import { GENERATED_MATERIAL_ROOT_NAME } from './material';
import { MEMORY_DIR_SEGMENTS } from './growth/types';
import { cleanupEmptyGeneratedMaterialDirectories } from './fs-workspace';
import { isInside, listNovelNames, resolveProject, type Project } from './project';

/** 旧版项目根资料（不属于任何作品）的作用域名称 */
export const UNASSIGNED_WORK_NAME = '未归属';

export type WorkScopeKind = 'work' | 'unassigned' | 'folder';

export interface WorkScope {
  /** work：项目中的一部作品；unassigned：项目根的旧版资料；folder：普通文件夹（整体是一部作品） */
  kind: WorkScopeKind;
  /** 作品名（未归属为「未归属」，普通文件夹为目录名） */
  name: string;
  /** 作用域根目录：资料、记忆库都相对它（growth storage 的 root 参数） */
  root: string;
  /** 项目根（普通文件夹时与 root 相同） */
  projectRoot: string;
  /** `<root>/资料` */
  materialDir: string;
  /** `<root>/资料/记忆` */
  memoryDir: string;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isNonEmptyDirectory(target: string): Promise<boolean> {
  try {
    return (await readdir(target)).length > 0;
  } catch {
    return false;
  }
}

function toScope(kind: WorkScopeKind, name: string, root: string, projectRoot: string): WorkScope {
  const materialDir = path.join(root, GENERATED_MATERIAL_ROOT_NAME);
  return {
    kind,
    name,
    root,
    projectRoot,
    materialDir,
    memoryDir: path.join(root, ...MEMORY_DIR_SEGMENTS),
  };
}

/** 项目根是否还有旧版布局的 `资料/`（不属于任何作品） */
export async function hasLegacyProjectMaterials(projectRoot: string): Promise<boolean> {
  return isDirectory(path.join(projectRoot, GENERATED_MATERIAL_ROOT_NAME));
}

/** 项目中所有作品的作用域；项目根有旧版资料时在末尾附加「未归属」 */
export async function listWorkScopes(project: Project): Promise<WorkScope[]> {
  const names = await listNovelNames(project);
  const scopes = names.map((name) =>
    toScope('work', name, path.join(project.novelsPath, name), project.root)
  );
  if (await hasLegacyProjectMaterials(project.root)) {
    scopes.push(toScope('unassigned', UNASSIGNED_WORK_NAME, project.root, project.root));
  }
  return scopes;
}

export interface ResolveWorkScopeOptions {
  /** 文件或目录路径：返回它所在的作品（不在任何作品中时返回「未归属」） */
  filePath?: string;
  /** 作品名（`--novel`）；「未归属」指向项目根的旧版资料 */
  workName?: string;
}

/**
 * 解析作用域。
 * - folderPath 不是 `ne init` 项目（没有 config.json，也不在项目中）：整个文件夹是一部作品
 * - 指定 workName：按名称查找；不存在时抛出 NOT_FOUND 并列出现有作品
 * - 指定 filePath：所在作品；在项目中但不属于任何作品时返回「未归属」
 * - 都不指定：folderPath 位于某部作品内时为该作品；否则为唯一的作品；没有作品但有旧版资料时返回「未归属」；
 *   多部作品时抛出 INVALID_ARGUMENT，提示用 `--novel <作品>` 指定
 */
export async function resolveWorkScope(
  folderPath: string,
  options: ResolveWorkScopeOptions = {}
): Promise<WorkScope> {
  const absFolder = path.resolve(folderPath);
  const project = await resolveProject({ cwd: absFolder });
  if (!project) {
    if (options.workName) {
      throw new CoreError(
        'NOT_A_PROJECT',
        `当前目录不是 ne 项目，不能用 --novel 指定作品: ${absFolder}`,
        '普通文件夹整体就是一部作品，去掉 --novel 即可；或先运行 `ne init`'
      );
    }
    return toScope('folder', path.basename(absFolder), absFolder, absFolder);
  }

  const scopes = await listWorkScopes(project);
  const works = scopes.filter((scope) => scope.kind === 'work');
  const unassigned = scopes.find((scope) => scope.kind === 'unassigned') ?? null;
  const workList = works.map((scope) => scope.name).join(', ') || '（无）';

  if (options.workName !== undefined) {
    const name = options.workName.trim();
    const matched = works.find((scope) => scope.name === name);
    if (matched) return matched;
    if (name === UNASSIGNED_WORK_NAME) {
      return unassigned ?? toScope('unassigned', UNASSIGNED_WORK_NAME, project.root, project.root);
    }
    throw new CoreError('NOT_FOUND', `作品不存在: "${name}"（现有作品: ${workList}）`);
  }

  if (options.filePath) {
    const target = path.resolve(absFolder, options.filePath);
    const owner = works.find((scope) => isInside(scope.root, target));
    if (owner) return owner;
    return unassigned ?? toScope('unassigned', UNASSIGNED_WORK_NAME, project.root, project.root);
  }

  // 在某部作品目录里执行（例如 cd novels/星河旅人）时就是这部作品
  const containing = works.find((scope) => isInside(scope.root, absFolder));
  if (containing) return containing;
  if (works.length === 1) return works[0];
  if (works.length === 0) {
    if (unassigned) return unassigned;
    throw new CoreError(
      'NOT_FOUND',
      '项目中还没有作品，资料与成长档案需要跟随作品保存',
      '先运行 `ne novel create <作品名>`'
    );
  }
  throw new CoreError(
    'INVALID_ARGUMENT',
    `项目中有多部作品（${workList}），请指定要操作的作品`,
    `加上 --novel <作品>，例如 --novel ${works[0].name}`
  );
}

export interface LegacyMaterialMigration {
  migrated: boolean;
  /** 迁移（或未迁移）的原因，便于日志与提示 */
  reason: 'migrated' | 'not-project' | 'no-legacy' | 'multiple-works' | 'no-work' | 'target-exists';
  from?: string;
  to?: string;
}

/**
 * 旧版项目资料迁移：项目根有 `资料/`、项目里恰好一部作品、且该作品还没有 `资料/`（或为空目录）时，
 * 把整个 `<project>/资料/` 移动为 `<作品>/资料/`（同一文件系统内 rename，不复制、不丢数据）。
 * 其他情况不做任何改动，旧资料作为「未归属」继续可见。幂等，可在每次打开项目时调用。
 */
export async function migrateLegacyProjectMaterials(
  projectRoot: string
): Promise<LegacyMaterialMigration> {
  return withWorkspaceLease(
    async () => {
      const project = await resolveProject({ cwd: projectRoot });
      if (!project || path.resolve(project.root) !== path.resolve(projectRoot)) {
        return { migrated: false, reason: 'not-project' };
      }
      const from = path.join(project.root, GENERATED_MATERIAL_ROOT_NAME);
      if (!(await isDirectory(from))) return { migrated: false, reason: 'no-legacy' };
      const names = await listNovelNames(project);
      if (names.length === 0) return { migrated: false, reason: 'no-work', from };
      if (names.length > 1) return { migrated: false, reason: 'multiple-works', from };
      const to = path.join(project.novelsPath, names[0], GENERATED_MATERIAL_ROOT_NAME);
      if (await isNonEmptyDirectory(to))
        return { migrated: false, reason: 'target-exists', from, to };
      if (await isDirectory(to)) {
        // 空目录：先移除再整体移动（rmdir 只能删空目录，不会误删内容）
        await rmdir(to);
      }
      await rename(from, to);
      return { migrated: true, reason: 'migrated', from, to };
    },
    {
      resources: [
        projectRoot,
        (await resolveProject({ cwd: projectRoot }))?.novelsPath ?? projectRoot,
      ],
    }
  );
}

/**
 * 清理空的生成资料目录：项目根（普通文件夹 / 未归属）以及每部作品的 `资料/`
 * 只删除已知作用域的空子目录（见 `cleanupEmptyGeneratedMaterialDirectories`）。
 */
export async function cleanupEmptyWorkMaterialDirectories(folderPath: string): Promise<string[]> {
  return withWorkspaceLease(
    async () => {
      const removed = await cleanupEmptyGeneratedMaterialDirectories(folderPath);
      const project = await resolveProject({ cwd: folderPath });
      if (!project || path.resolve(project.root) !== path.resolve(folderPath)) return removed;
      for (const scope of await listWorkScopes(project)) {
        if (scope.kind !== 'work') continue;
        removed.push(...(await cleanupEmptyGeneratedMaterialDirectories(scope.root)));
      }
      return removed;
    },
    {
      resources: [
        folderPath,
        (await resolveProject({ cwd: folderPath }))?.novelsPath ?? folderPath,
      ],
    }
  );
}
