/**
 * `get-files-exist`：一次判断多个候选路径是否为已存在的文件（参考窗格 / 实时渲染解析正文媒体引用时批量探测，
 * 代替逐个 `get-file-info`，减少往返）。
 *
 * 校验：参数必须是字符串数组、最多 FILES_EXIST_MAX 个；只回答位于该窗口工作区内的绝对路径，
 * 其余（相对路径、工作区外、窗口尚未上报工作区）返回 null，由渲染进程自行回退到逐个查询。
 */
import { stat } from 'fs/promises';
import path from 'path';

export const FILES_EXIST_MAX = 200;

/** 校验请求参数，非法时抛错 */
export function validateFilesExistRequest(paths: unknown): string[] {
  if (!Array.isArray(paths)) throw new Error('参数必须是路径数组');
  if (paths.length > FILES_EXIST_MAX) throw new Error(`一次最多查询 ${FILES_EXIST_MAX} 个路径`);
  for (const item of paths) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 4096) {
      throw new Error('路径必须是非空字符串');
    }
  }
  return paths as string[];
}

/** target 是否为 root 内（含 root 本身）的绝对路径 */
export function isInsideRoot(target: string, root: string): boolean {
  if (!path.isAbsolute(target) || !path.isAbsolute(root)) return false;
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function isExistingFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

/** 逐个回答：true / false 为已检查结果，null 表示不在工作区内（未检查） */
export async function checkFilesExist(
  paths: unknown,
  workspaceRoot: string | null
): Promise<Array<boolean | null>> {
  const list = validateFilesExistRequest(paths);
  return Promise.all(
    list.map((target) =>
      workspaceRoot && isInsideRoot(target, workspaceRoot)
        ? isExistingFile(target)
        : Promise.resolve(null)
    )
  );
}
