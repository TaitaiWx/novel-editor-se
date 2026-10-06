import { describe, expect, it } from 'vitest';
import { unwrapMaterialRoot } from '@/render/components/FilePanel/hooks/useWorkScopedNodes';
import type { FileNode } from '@/render/types';

const file = (name: string): FileNode => ({ name, path: `/w/资料/${name}`, type: 'file' });

describe('unwrapMaterialRoot', () => {
  it('只有一个「资料」根目录时直接展示其子项', () => {
    const root: FileNode = {
      name: '资料',
      path: '/w/资料',
      type: 'directory',
      children: [file('世界观.md'), file('名词表.md')],
    };
    expect(unwrapMaterialRoot([root]).map((node) => node.name)).toEqual(['世界观.md', '名词表.md']);
  });

  it('多个顶层节点或非「资料」目录时保持原样', () => {
    const other: FileNode = { name: '素材', path: '/w/素材', type: 'directory', children: [] };
    expect(unwrapMaterialRoot([other])).toEqual([other]);
    const two = [file('a.png'), file('b.png')];
    expect(unwrapMaterialRoot(two)).toBe(two);
    expect(unwrapMaterialRoot([file('资料')])).toEqual([file('资料')]);
  });
});
