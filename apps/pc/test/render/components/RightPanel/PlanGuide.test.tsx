// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PlanGuide, {
  OUTLINE_GUIDE,
  VOLUME_GUIDE,
  type PlanGuideContent,
} from '@/render/components/RightPanel/PlanGuide';

describe('PlanGuide', () => {
  it('章纲 / 卷纲各有一句话说明与 3 步用法', () => {
    for (const guide of [OUTLINE_GUIDE, VOLUME_GUIDE]) {
      expect(guide.summary.length).toBeGreaterThan(0);
      expect(guide.steps).toHaveLength(3);
    }
  });

  it('显示一句话说明；点「怎么用」弹出步骤，再点收起', () => {
    const guide: PlanGuideContent = { summary: '这是测试说明。', steps: ['第一步', '第二步'] };
    render(<PlanGuide guide={guide} label="章纲" />);
    const root = screen.getByTestId('plan-guide');
    expect(within(root).getByText('这是测试说明。')).toBeTruthy();
    const button = screen.getByRole('button', { name: '章纲怎么用' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('第一步')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['第一步', '第二步']);

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('第一步')).toBeNull();
  });

  it('Esc 关闭弹窗', () => {
    render(<PlanGuide guide={VOLUME_GUIDE} label="卷纲" />);
    const button = screen.getByRole('button', { name: '卷纲怎么用' });
    fireEvent.click(button);
    expect(screen.getByText(VOLUME_GUIDE.steps[0])).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(VOLUME_GUIDE.steps[0])).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
