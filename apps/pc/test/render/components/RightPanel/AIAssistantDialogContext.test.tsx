// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AssistantContextSectionProps } from '@/render/components/RightPanel/AssistantContextSection';

vi.mock('@/render/components/RightPanel/AIView', () => ({
  AIView: () => <div data-testid="ai-view" />,
}));

const { AIAssistantDialog } = await import('@/render/components/RightPanel/AIAssistantDialog');

function buildContext(
  overrides: Partial<AssistantContextSectionProps> = {}
): AssistantContextSectionProps {
  return {
    scope: { kind: 'chapter', path: '/n/正文/001-少年.md', label: '001-少年' },
    characters: [{ name: '沈砚', role: '主角', description: '等说书人的少年' }],
    loreEntries: [],
    materials: [],
    materialFiles: [
      { path: '/n/资料/地图.png', name: '地图.png' },
      { path: '/n/资料/年表.md', name: '年表.md' },
    ],
    linkedMaterialPaths: ['/n/资料/地图.png'],
    onGenerate: vi.fn(),
    onOpenMaterial: vi.fn(),
    onAddMaterial: vi.fn(),
    onRemoveMaterial: vi.fn(),
    ...overrides,
  };
}

function renderDialog(context?: AssistantContextSectionProps) {
  return render(
    <AIAssistantDialog visible onClose={vi.fn()} folderPath="/n" content="" context={context} />
  );
}

afterEach(() => cleanup());

describe('AI 助手「上下文」分区', () => {
  it('默认折叠，只显示作用域与计数', () => {
    renderDialog(buildContext());
    const section = screen.getByRole('region', { name: '上下文' });
    const toggle = within(section).getByRole('button', { name: /上下文/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('当前章：001-少年');
    expect(toggle.textContent).toContain('人物 1 · 设定 0 · 资料 1');
    expect(within(section).queryByText('沈砚')).toBeNull();
    expect(screen.getByTestId('ai-view')).toBeTruthy();
  });

  it('展开后可生成上下文、打开 / 移除 / 关联章节资料', () => {
    const context = buildContext();
    renderDialog(context);
    fireEvent.click(screen.getByRole('button', { name: /上下文/ }));
    expect(screen.getByText('沈砚')).toBeTruthy();
    expect(screen.getByText('主角 · 等说书人的少年')).toBeTruthy();

    const generateButtons = screen.getAllByRole('button', { name: 'AI 生成' });
    expect(generateButtons).toHaveLength(3);
    fireEvent.click(generateButtons[1]);
    expect(context.onGenerate).toHaveBeenCalledWith('lore');

    fireEvent.click(screen.getByRole('button', { name: '地图.png' }));
    expect(context.onOpenMaterial).toHaveBeenCalledWith('/n/资料/地图.png');
    fireEvent.click(screen.getByRole('button', { name: '从当前章移除 地图.png' }));
    expect(context.onRemoveMaterial).toHaveBeenCalledWith('/n/资料/地图.png');

    const select = screen.getByLabelText('选择要关联到当前章的资料') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      '选择一份资料关联到当前章',
      '年表.md',
    ]);
    fireEvent.change(select, { target: { value: '/n/资料/年表.md' } });
    fireEvent.click(screen.getByRole('button', { name: '关联' }));
    expect(context.onAddMaterial).toHaveBeenCalledWith('/n/资料/年表.md');
  });

  it('人物生成进行中时显示进度并禁用人物的生成按钮', () => {
    renderDialog(
      buildContext({
        characterGenerationStatus: {
          artifact: 'characters',
          scopeKind: 'chapter',
          scopePath: '/n/正文/001-少年.md',
          state: 'running',
          message: '正在分析 001-少年',
          totalSteps: 4,
          completedSteps: 1,
          resultCount: 0,
          libraryCount: 0,
          createdCount: 0,
          updatedCount: 0,
          startedAt: '2026-10-07T00:00:00.000Z',
          finishedAt: null,
          scopeLabel: '001-少年',
        },
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /上下文/ }));
    expect(screen.getByText('正在分析 001-少年')).toBeTruthy();
    expect(
      (screen.getAllByRole('button', { name: 'AI 生成' })[0] as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('没有作用域或未提供上下文时不显示该分区', () => {
    renderDialog(buildContext({ scope: null }));
    expect(screen.queryByRole('region', { name: '上下文' })).toBeNull();
    cleanup();
    renderDialog();
    expect(screen.queryByRole('region', { name: '上下文' })).toBeNull();
  });
});
