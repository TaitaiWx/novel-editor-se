// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InspirationDialog from '@/render/components/InspirationDialog';
import { BUILTIN_INSPIRATION_POOLS } from '@/render/components/InspirationDialog/inspiration';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

const FOLDER = '/novels/剑与诗';

function renderDialog(props: Partial<React.ComponentProps<typeof InspirationDialog>> = {}) {
  const onInsert = vi.fn(() => true);
  const onClose = vi.fn();
  const utils = render(
    <InspirationDialog
      visible
      onClose={onClose}
      folderPath={FOLDER}
      dbReady
      content="少年握紧了手中的木剑。"
      onInsert={onInsert}
      random={() => 0}
      {...props}
    />
  );
  return { ...utils, onInsert, onClose };
}

const term = (slot: string) => screen.getByTestId(`inspiration-${slot}`).textContent;

afterEach(() => {
  cleanup();
  uninstallElectronMock();
});

describe('灵感弹窗', () => {
  it('不需要任何输入：点「抽一签」立即出现 人物 / 地点 / 冲突 三张签', () => {
    installElectronMock(() => null);
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: '灵感' });
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '抽一签' }));
    expect(term('person')).toBe(BUILTIN_INSPIRATION_POOLS.person[0]);
    expect(term('place')).toBe(BUILTIN_INSPIRATION_POOLS.place[0]);
    expect(term('conflict')).toBe(BUILTIN_INSPIRATION_POOLS.conflict[0]);
    expect(screen.getByRole('button', { name: '全部重抽' })).toBeTruthy();
  });

  it('换一签只重抽对应的那一张', () => {
    installElectronMock(() => null);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '抽一签' }));
    const before = { person: term('person'), place: term('place'), conflict: term('conflict') };
    fireEvent.click(screen.getByRole('button', { name: '换一张地点签' }));
    expect(term('place')).not.toBe(before.place);
    expect(term('person')).toBe(before.person);
    expect(term('conflict')).toBe(before.conflict);
  });

  it('插入到光标处：回调收到格式化文本、记入历史并关闭；没有编辑器时提示', async () => {
    const electron = installElectronMock(() => null);
    const { onInsert, onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '抽一签' }));
    fireEvent.click(screen.getByRole('button', { name: '插入到光标处' }));
    expect(onInsert).toHaveBeenCalledWith(
      `人物：${BUILTIN_INSPIRATION_POOLS.person[0]}｜地点：${BUILTIN_INSPIRATION_POOLS.place[0]}｜冲突：${BUILTIN_INSPIRATION_POOLS.conflict[0]}`
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(electron.invoke).toHaveBeenCalledWith(
        'db-story-idea-card-create-by-folder',
        FOLDER,
        expect.objectContaining({ themeSeed: BUILTIN_INSPIRATION_POOLS.person[0] })
      )
    );

    cleanup();
    const failing = renderDialog({ onInsert: vi.fn(() => false) });
    fireEvent.click(screen.getByRole('button', { name: '抽一签' }));
    fireEvent.click(screen.getByRole('button', { name: '插入到光标处' }));
    expect(screen.getByRole('status').textContent).toContain('先打开一个章节');
    expect(failing.onClose).not.toHaveBeenCalled();
  });

  it('高级选项默认收起；展开后可切换词源、加入词池、回填历史', async () => {
    const history = [
      {
        id: 3,
        title: '灵感 10/1 08:00',
        theme_seed: '老船夫',
        twist_seed: '漏雨的书铺',
        conflict_seed: '债主上门',
        tags_json: '[]',
      },
    ];
    const electron = installElectronMock((channel) =>
      channel === 'db-story-idea-card-list-by-folder' ? history : null
    );
    renderDialog();
    const disclosure = screen.getByRole('button', { name: '更多选项' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radiogroup', { name: '词源' })).toBeNull();

    fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    const sources = screen.getByRole('radiogroup', { name: '词源' });
    fireEvent.click(within(sources).getByRole('radio', { name: '只用我的词池' }));
    expect(
      within(sources).getByRole('radio', { name: '只用我的词池' }).getAttribute('aria-checked')
    ).toBe('true');

    fireEvent.change(screen.getByLabelText('新词'), { target: { value: '守夜人' } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await screen.findByText('已把「守夜人」加入人物词池');
    expect(electron.invoke).toHaveBeenCalledWith(
      'db-settings-set',
      `novel-editor:story-idea-term-pool:${FOLDER}`,
      expect.stringContaining('守夜人')
    );

    fireEvent.click(await screen.findByText('人物：老船夫｜地点：漏雨的书铺｜冲突：债主上门'));
    expect(term('person')).toBe('老船夫');
    expect(term('place')).toBe('漏雨的书铺');
  });

  it('打开时回填指定的三签卡（大纲版本「回到灵感」）', async () => {
    installElectronMock((channel) =>
      channel === 'db-story-idea-card-list-by-folder'
        ? [{ id: 9, title: '旧卡', theme_seed: '白衣客', twist_seed: '', conflict_seed: '' }]
        : null
    );
    renderDialog({ initialCardId: 9 });
    await waitFor(() => expect(term('person')).toBe('白衣客'));
    expect(screen.getByRole('button', { name: '更多选项' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
  });

  it('Esc 关闭', () => {
    installElectronMock(() => null);
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
