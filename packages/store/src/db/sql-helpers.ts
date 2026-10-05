/** 纯 SQL 构建与行映射工具（不依赖数据库连接，便于单测） */
import type { OutlineScope, OutlineTreeNode } from './types';

/**
 * 按白名单构建 UPDATE 的 SET 片段：忽略 undefined 与不在白名单中的字段，
 * 防止调用方通过字段名注入任意列。
 */
export function buildAllowedUpdate(
  fields: Record<string, string | number | undefined>,
  allowedCols: ReadonlySet<string>
): { updates: string[]; values: (string | number)[] } {
  const updates: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && allowedCols.has(key)) {
      updates.push(`${key} = ?`);
      values.push(val);
    }
  }
  return { updates, values };
}

/** 统计大纲树节点总数（含所有子孙） */
export function countOutlineNodes(entries: OutlineTreeNode[]): number {
  let total = 0;
  const visit = (nodes: OutlineTreeNode[]) => {
    nodes.forEach((node) => {
      total += 1;
      if (Array.isArray(node.children) && node.children.length > 0) {
        visit(node.children);
      }
    });
  };
  visit(entries);
  return total;
}

/** 补全大纲作用域的默认值（默认项目级） */
export function normalizeOutlineScope(scope?: OutlineScope): OutlineScope {
  return {
    kind: scope?.kind || 'project',
    path: scope?.path || '',
  };
}

/** 构建按作用域过滤大纲的 WHERE 子句；项目级兼容旧数据中空 scope_path */
export function buildOutlineScopeWhere(scope: OutlineScope): {
  clause: string;
  values: Array<string | number>;
} {
  if (scope.kind === 'project') {
    return {
      clause: "scope_kind = 'project' AND (scope_path = '' OR scope_path = ?)",
      values: [scope.path],
    };
  }

  return {
    clause: 'scope_kind = ? AND scope_path = ?',
    values: [scope.kind, scope.path],
  };
}

/** 解析大纲版本中存储的 tree_json；损坏或非数组时返回空数组 */
export function parseOutlineTree(treeJson: string): OutlineTreeNode[] {
  try {
    const parsed = JSON.parse(treeJson) as OutlineTreeNode[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 构建导入时使用的 INSERT 语句 */
export function buildInsertSql(table: string, columns: string[]): string {
  const placeholders = columns.map(() => '?').join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
}
