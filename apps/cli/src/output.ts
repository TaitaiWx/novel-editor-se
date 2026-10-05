/**
 * 人类可读输出的格式化工具
 */
import path from 'node:path';
import { formatNumber } from '@novel-editor/helpers';
import type { FileNode, TextStats } from '@novel-editor/core';

export { formatNumber };

/** 以树形结构渲染文件树 */
export function renderTree(root: FileNode, base?: string): string {
  const lines: string[] = [base ?? root.path];
  const walk = (nodes: FileNode[], prefix: string) => {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      const label = node.type === 'directory' ? `${node.name}/` : node.name;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${label}`);
      if (node.children) walk(node.children, `${prefix}${last ? '    ' : '│   '}`);
    });
  };
  walk(root.children ?? [], '');
  return lines.join('\n');
}

/** 简单的对齐表格 */
export function renderTable(headers: string[], rows: Array<Array<string | number>>): string {
  const cells = [headers, ...rows.map((row) => row.map((cell) => String(cell)))];
  // 中日韩字符按 2 个宽度计算，保证对齐
  const width = (text: string) =>
    Array.from(text).reduce((sum, char) => sum + (/[ᄀ-￿]/.test(char) ? 2 : 1), 0);
  const widths = headers.map((_, col) => Math.max(...cells.map((row) => width(row[col] ?? ''))));
  return cells
    .map((row) =>
      row
        .map((cell, col) =>
          col === row.length - 1 ? cell : cell + ' '.repeat(widths[col] - width(cell))
        )
        .join('  ')
        .trimEnd()
    )
    .join('\n');
}

export function renderStats(stats: TextStats): string {
  return renderTable(
    ['指标', '数值'],
    [
      ['字数', formatNumber(stats.chars)],
      ['中文字符', formatNumber(stats.cjkChars)],
      ['英文单词', formatNumber(stats.words)],
      ['行数', formatNumber(stats.lines)],
      ['段落数', formatNumber(stats.paragraphs)],
      ['字节', formatNumber(stats.bytes)],
    ]
  );
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

/** 显示用的相对路径（位于 cwd 内时使用相对路径） */
export function displayPath(target: string, cwd: string): string {
  const relative = path.relative(cwd, target);
  if (relative === '') return '.';
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : target;
}
