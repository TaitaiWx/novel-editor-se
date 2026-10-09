// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LoreEntryDetail } from '@/render/components/RightPanel/LoreEntryDetail';
import type { LoreEntry } from '@/render/components/RightPanel/types';

describe('设定详情分组', () => {
  it('内容保存回填时保留正在编辑的标题与目录', () => {
    const entry: LoreEntry = {
      id: 1,
      title: '北境',
      summary: '旧内容',
      category: 'world',
      tags: [],
      folder: '',
      media: [],
      createdAt: '',
      updatedAt: '',
    };
    const props = {
      entry,
      entries: [entry],
      workPath: null,
      onUpdate: async () => undefined,
      onDelete: () => undefined,
      onOpenEntry: () => undefined,
    };
    const { rerender } = render(<LoreEntryDetail {...props} />);
    fireEvent.change(screen.getByLabelText('设定标题'), { target: { value: '北境草稿' } });
    fireEvent.change(screen.getByLabelText('设定目录'), { target: { value: '地理/北境' } });
    // 模拟此前的内容保存请求返回；标题与目录仍是保存前的服务器值。
    rerender(<LoreEntryDetail {...props} entry={{ ...entry, summary: '已保存的新内容' }} />);
    expect((screen.getByLabelText('设定标题') as HTMLInputElement).value).toBe('北境草稿');
    expect((screen.getByLabelText('设定目录') as HTMLInputElement).value).toBe('地理/北境');
  });

  it.each(['世界观', '势力', '体系', '术语'])('同名自定义分组 %s 显示并选中默认标签', (group) => {
    const entry: LoreEntry = {
      id: 1,
      title: '北境',
      summary: '一处设定',
      category: 'world',
      group,
      tags: [],
      folder: '',
      media: [],
      createdAt: '',
      updatedAt: '',
    };
    const update = vi.fn(async () => undefined);
    render(
      <LoreEntryDetail
        entry={entry}
        entries={[entry]}
        workPath={null}
        onUpdate={update}
        onDelete={() => undefined}
        onOpenEntry={() => undefined}
      />
    );
    const select = screen.getByRole('combobox', { name: '设定分组' });
    expect(select.textContent).toBe(group);
    fireEvent.click(select);
    const options = screen.getAllByRole('option', { name: group });
    expect(options).toHaveLength(1);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(update).not.toHaveBeenCalled();
  });
});
