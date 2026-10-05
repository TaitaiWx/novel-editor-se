import { describe, expect, it } from 'vitest';
import {
  buildAllowedUpdate,
  buildInsertSql,
  buildOutlineScopeWhere,
  countOutlineNodes,
  normalizeOutlineScope,
  parseOutlineTree,
} from '../src/db/sql-helpers';

describe('store/sql-helpers', () => {
  it('buildAllowedUpdate 只保留白名单内且非 undefined 的字段', () => {
    const result = buildAllowedUpdate(
      { name: '林动', role: undefined, evil: 'x; DROP TABLE novels', attributes: '{}' },
      new Set(['name', 'role', 'attributes'])
    );
    expect(result).toEqual({
      updates: ['name = ?', 'attributes = ?'],
      values: ['林动', '{}'],
    });
  });

  it('countOutlineNodes 统计所有层级节点', () => {
    expect(countOutlineNodes([])).toBe(0);
    expect(
      countOutlineNodes([
        { title: 'A', children: [{ title: 'A1' }, { title: 'A2', children: [{ title: 'A2a' }] }] },
        { title: 'B', children: [] },
      ])
    ).toBe(5);
  });

  it('normalizeOutlineScope 默认项目级', () => {
    expect(normalizeOutlineScope()).toEqual({ kind: 'project', path: '' });
    expect(normalizeOutlineScope({ kind: 'chapter', path: 'a.md' })).toEqual({
      kind: 'chapter',
      path: 'a.md',
    });
  });

  it('buildOutlineScopeWhere 项目级兼容空路径', () => {
    expect(buildOutlineScopeWhere({ kind: 'project', path: '/p' })).toEqual({
      clause: "scope_kind = 'project' AND (scope_path = '' OR scope_path = ?)",
      values: ['/p'],
    });
    expect(buildOutlineScopeWhere({ kind: 'volume', path: 'v1' })).toEqual({
      clause: 'scope_kind = ? AND scope_path = ?',
      values: ['volume', 'v1'],
    });
  });

  it('parseOutlineTree 容错损坏 JSON 与非数组', () => {
    expect(parseOutlineTree('[{"title":"A"}]')).toEqual([{ title: 'A' }]);
    expect(parseOutlineTree('{"title":"A"}')).toEqual([]);
    expect(parseOutlineTree('not json')).toEqual([]);
  });

  it('buildInsertSql 生成占位符', () => {
    expect(buildInsertSql('settings', ['key', 'value'])).toBe(
      'INSERT INTO settings (key, value) VALUES (?, ?)'
    );
  });
});
