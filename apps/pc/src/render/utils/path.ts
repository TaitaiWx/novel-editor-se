/**
 * 渲染进程路径工具：同时兼容 POSIX（/）与 Windows（\）分隔符
 */

/** 取路径最后一级名称（文件名或文件夹名），忽略末尾分隔符；空路径返回空字符串 */
export function getPathBasename(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || trimmed || filePath;
}

/**
 * 判断 child 是否位于 dir 之内（含 dir 自身），按路径分隔符边界比较，
 * 避免 "/w/正文2" 被误判为 "/w/正文" 的子路径；同时兼容 / 与 \ 分隔符
 */
export function isPathInside(child: string, dir: string): boolean {
  const base = dir.replace(/[\\/]+$/, '');
  if (!base) return /^[\\/]/.test(child);
  if (child === base) return true;
  if (!child.startsWith(base)) return false;
  const next = child.charAt(base.length);
  return next === '/' || next === '\\';
}
