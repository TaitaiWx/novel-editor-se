/**
 * 轻量 glob 匹配（不引入第三方依赖）
 *
 * 支持：`**`（跨目录）、`*`（单层任意字符）、`?`、`[abc]`、`{a,b}`。
 * 若模式中不含 `/`，则只匹配文件名（与 .gitignore 习惯一致），例如 `*.md`。
 */

function escapeRegExp(char: string): string {
  return /[.+^${}()|[\]\\/]/.test(char) ? `\\${char}` : char;
}

export function globToRegExp(pattern: string): RegExp {
  let source = '';
  let braceDepth = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` 匹配零到多层目录，单独的 `**` 匹配任意内容
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        source += '\\[';
      } else {
        const body = pattern.slice(i + 1, end).replace(/\\/g, '\\\\');
        source += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`;
        i = end;
      }
    } else if (char === '{') {
      braceDepth += 1;
      source += '(?:';
    } else if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
      source += ')';
    } else if (char === ',' && braceDepth > 0) {
      source += '|';
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`, 'u');
}

/** 是否看起来像 glob 模式 */
export function isGlobPattern(value: string): boolean {
  return /[*?[{]/.test(value);
}

/** 创建匹配函数，输入为相对路径（任意分隔符） */
export function createGlobMatcher(pattern: string): (relativePath: string) => boolean {
  const regex = globToRegExp(pattern.replace(/\\/g, '/'));
  const basenameOnly = !pattern.includes('/');
  return (relativePath: string) => {
    const normalized = relativePath.replace(/\\/g, '/');
    const target = basenameOnly ? normalized.slice(normalized.lastIndexOf('/') + 1) : normalized;
    return regex.test(target);
  };
}
