// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StructureSection from '@/render/components/AppSettingsCenter/StructureSection';
import type { StructureConfig } from '@novel-editor/core/structure-rules';
import { getStructureRules, setStructureConfig } from '@/render/utils/structureRules';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

const FOLDER = '/tmp/project';

function mockMain(initial: StructureConfig = { presets: ['zh', 'en'], custom: [] }) {
  const state = { config: initial, stored: false };
  const info = () => ({
    folderPath: FOLDER,
    config: state.config,
    location: 'project' as const,
    file: `${FOLDER}/.novel-editor/config.json`,
    stored: state.stored,
    warnings: [],
  });
  const mock = installElectronMock((channel, ...args) => {
    if (channel === 'project-structure-get') return { ok: true, data: info() };
    if (channel === 'project-structure-set') {
      state.config = args[1] as StructureConfig;
      state.stored = true;
      return { ok: true, data: info() };
    }
    return undefined;
  });
  return { mock, state };
}

afterEach(() => {
  uninstallElectronMock();
  setStructureConfig(null);
});

describe('设置中心「正文结构」', () => {
  it('没有打开项目时只显示提示', () => {
    installElectronMock();
    render(<StructureSection folderPath={null} />);
    expect(screen.getByText(/先打开一个项目文件夹/)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('开关预设、添加自定义规则、测试框即时显示识别结果，保存写入项目并更新编辑器规则', async () => {
    const { mock, state } = mockMain();
    render(<StructureSection folderPath={FOLDER} />);
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(3));
    expect(screen.getByText('.novel-editor/config.json', { exact: false })).toBeTruthy();

    const english = screen.getByRole('switch', { name: 'English 规则' }) as HTMLInputElement;
    const numbered = screen.getByRole('switch', { name: '数字序号 规则' }) as HTMLInputElement;
    expect(english.checked).toBe(true);
    expect(numbered.checked).toBe(false);
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    // 测试框：默认样例里 English 行被识别
    const results = screen.getByRole('list', { name: '识别结果' });
    const rowOf = (text: string) =>
      within(results)
        .getAllByRole('listitem')
        .find((item) => item.textContent?.includes(text));
    expect(rowOf('Chapter 1: The Harbor')?.textContent).toMatch(/^章/);
    expect(rowOf('=== Dawn ===')?.textContent).toMatch(/^正文/);

    fireEvent.click(english);
    expect(rowOf('Chapter 1: The Harbor')?.textContent).toMatch(/^正文/);
    fireEvent.click(english);

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }));
    const pattern = screen.getByRole('textbox', { name: '规则 1 正则' });
    fireEvent.change(pattern, { target: { value: '(a+)+' } });
    expect(screen.getByText(/嵌套量词/)).toBeTruthy();
    expect(save.disabled).toBe(true);

    fireEvent.change(pattern, { target: { value: '^=== (.+) ===$' } });
    expect(rowOf('=== Dawn ===')?.textContent).toMatch(/^场/);
    expect(save.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(save);
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/已保存/));
    expect(mock.invoke).toHaveBeenCalledWith('project-structure-set', FOLDER, {
      presets: ['zh', 'en'],
      custom: [{ id: 'custom-1', kind: 'scene', pattern: '^=== (.+) ===$' }],
    });
    expect(state.stored).toBe(true);
    expect(getStructureRules().config.custom).toHaveLength(1);
  });

  it('删除规则与还原', async () => {
    mockMain({
      presets: ['zh'],
      custom: [{ id: 'a', kind: 'act', pattern: '^ACT' }],
    });
    render(<StructureSection folderPath={FOLDER} />);
    await waitFor(() => screen.getByRole('textbox', { name: '规则 1 正则' }));
    fireEvent.click(screen.getByRole('button', { name: '删除规则 1' }));
    expect(screen.queryByRole('textbox', { name: '规则 1 正则' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '还原' }));
    expect(screen.getByRole('textbox', { name: '规则 1 正则' })).toBeTruthy();
  });

  it('保存失败时显示主进程的错误', async () => {
    installElectronMock((channel) => {
      if (channel === 'project-structure-get') {
        return {
          ok: true,
          data: {
            folderPath: FOLDER,
            config: { presets: ['zh', 'en'], custom: [] },
            location: 'folder',
            file: `${FOLDER}/.novel-editor/structure.json`,
            stored: false,
            warnings: [],
          },
        };
      }
      return { ok: false, error: '只能修改当前打开的项目的正文结构' };
    });
    render(<StructureSection folderPath={FOLDER} />);
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(3));
    fireEvent.click(screen.getByRole('switch', { name: '数字序号 规则' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/当前打开的项目/));
  });
});
