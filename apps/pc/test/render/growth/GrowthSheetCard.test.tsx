// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GrowthSheetCard } from '@/render/components/RightPanel/GrowthView/GrowthSheetCard';
import { GrowthWarningList } from '@/render/components/RightPanel/GrowthView/GrowthWarningList';
import { GrowthEventForm } from '@/render/components/RightPanel/GrowthView/GrowthEventForm';
import { buildSnapshot } from './fixtures';

describe('GrowthSheetCard', () => {
  it('渲染等级徽章、经验条与「距下一级」文案', () => {
    const snapshot = buildSnapshot();
    render(
      <GrowthSheetCard
        ruleset={snapshot.ruleset}
        sheet={snapshot.sheets[0]}
        busy={false}
        onChoose={() => undefined}
      />
    );
    expect(screen.getByText('阿尔')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    // 2 级区间 300~900：已获得 100 / 600
    expect(screen.getByText('经验 100 / 600')).toBeTruthy();
    expect(screen.getByText('距下一级 500 经验')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('17');
    expect(screen.getByText('力量')).toBeTruthy();
    expect(screen.getByText('尚未掌握技能')).toBeTruthy();
    // 未满足前置条件的技能以灰色 chip 展示，tooltip 给出原因
    expect(screen.getByText('火球术').getAttribute('title')).toContain('需要角色等级 5');
  });

  it('技能显示下一级所需技能经验', () => {
    const snapshot = buildSnapshot();
    const sheet = { ...snapshot.sheets[0], skills: [{ id: 'second-wind', level: 1, exp: 50 }] };
    render(
      <GrowthSheetCard
        ruleset={snapshot.ruleset}
        sheet={sheet}
        busy={false}
        onChoose={() => undefined}
      />
    );
    expect(screen.getByText('Lv 1/3')).toBeTruthy();
    expect(screen.getByText('下一级需 200 技能经验（还差 150）')).toBeTruthy();
  });

  it('抉择需要二次确认', () => {
    const snapshot = buildSnapshot();
    const onChoose = vi.fn();
    render(
      <GrowthSheetCard
        ruleset={snapshot.ruleset}
        sheet={snapshot.sheets[0]}
        busy={false}
        onChoose={onChoose}
      />
    );
    fireEvent.click(screen.getByText('法师之道'));
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('确认选择「法师之道」'));
    expect(onChoose).toHaveBeenCalledWith('path', 'mage');
  });
});

describe('GrowthWarningList', () => {
  it('按严重程度展示警告与提示', () => {
    render(
      <GrowthWarningList
        showCharacter
        warnings={[
          { severity: 'error', code: 'CORE_RULE', message: '违反核心规则', character: '阿尔' },
          {
            severity: 'warning',
            code: 'LEVEL_SPIKE',
            message: '第 7 章连升 3 级',
            hint: '分散到多章',
          },
        ]}
      />
    );
    expect(screen.getByText('错误')).toBeTruthy();
    expect(screen.getByText('警告')).toBeTruthy();
    expect(screen.getByText(/阿尔：违反核心规则/)).toBeTruthy();
    expect(screen.getByText('分散到多章')).toBeTruthy();
    expect(screen.getByText('2 项')).toBeTruthy();
  });

  it('没有警告时给出正向提示', () => {
    render(<GrowthWarningList warnings={[]} />);
    expect(screen.getByText('没有发现战力崩溃的迹象')).toBeTruthy();
  });
});

describe('GrowthEventForm', () => {
  it('校验输入，提交事件，违规时提供「仍然记录」', async () => {
    const snapshot = buildSnapshot();
    const onSubmit = vi
      .fn<(event: unknown, force: boolean) => Promise<string | null>>()
      .mockResolvedValueOnce('力量 99 超过上限 30')
      .mockResolvedValueOnce(null);
    render(
      <GrowthEventForm
        ruleset={snapshot.ruleset}
        busy={false}
        defaultChapter={3}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '属性' }));
    fireEvent.click(screen.getByText('记录'));
    expect(await screen.findByText('请选择属性')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('属性'), { target: { value: 'str' } });
    fireEvent.change(screen.getByLabelText('数值'), { target: { value: '89' } });
    fireEvent.click(screen.getByText('记录'));
    expect(await screen.findByText('力量 99 超过上限 30')).toBeTruthy();
    expect(onSubmit).toHaveBeenLastCalledWith(
      { type: 'attribute', target: 'str', delta: 89, chapter: 3 },
      false
    );

    fireEvent.click(screen.getByText('仍然记录'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][1]).toBe(true);
  });
});
