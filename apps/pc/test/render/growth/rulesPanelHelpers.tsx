import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  applyGrowthEvent,
  createDndRuleset,
  createSheet,
  type GrowthRuleset,
  type GrowthSheet,
} from '@novel-editor/core/growth';
import { GrowthRulesPanel } from '@/render/components/RightPanel/GrowthView/GrowthRulesPanel';

/** 林舟：走战士之道（学会回气、力量 / 体质加成） */
export function sampleSheets(ruleset: GrowthRuleset = createDndRuleset()): GrowthSheet[] {
  const sheet = applyGrowthEvent(ruleset, createSheet(ruleset, '林舟'), {
    type: 'choice',
    target: 'path',
    value: 'warrior',
  }).sheet;
  return [sheet];
}

/**
 * 渲染规则之书编辑器：onSave 成功时用保存的规则重新渲染（模拟主进程返回最新快照）
 */
export function renderRulesPanel(
  options: {
    ruleset?: GrowthRuleset;
    sheets?: GrowthSheet[];
    characterNames?: string[];
    saveError?: string | null;
  } = {}
) {
  let ruleset = options.ruleset ?? createDndRuleset();
  const sheets = options.sheets ?? sampleSheets(ruleset);
  const onSave = vi.fn(async (next: GrowthRuleset) => {
    if (options.saveError) return options.saveError;
    ruleset = next;
    view.rerender(element());
    return null;
  });
  const element = () => (
    <GrowthRulesPanel
      ruleset={ruleset}
      sheets={sheets}
      characterNames={options.characterNames ?? ['林舟', '苏晴']}
      busy={false}
      onSave={onSave}
    />
  );
  const view = render(element());
  return {
    ...view,
    onSave,
    get ruleset() {
      return ruleset;
    },
  };
}

export function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

export function setText(
  label: string | RegExp,
  value: string,
  container: HTMLElement = document.body
) {
  fireEvent.change(within(container).getByLabelText(label), { target: { value } });
}

/** 修改自绘数字输入（role="spinbutton"）并提交 */
export function setNumber(
  label: string | RegExp,
  value: number,
  container: HTMLElement = document.body
) {
  const input = within(container).getByRole('spinbutton', { name: label });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: String(value) } });
  fireEvent.blur(input);
}

export function unsavedBar(): HTMLElement | null {
  return screen.queryByRole('region', { name: '未保存的更改' });
}

export function clickSave(): void {
  const bar = unsavedBar();
  if (!bar) throw new Error('没有未保存的更改');
  fireEvent.click(within(bar).getByRole('button', { name: '保存' }));
}

/** 最近一次保存的规则 */
export function lastSaved(onSave: ReturnType<typeof renderRulesPanel>['onSave']): GrowthRuleset {
  const calls = onSave.mock.calls;
  if (calls.length === 0) throw new Error('还没有保存');
  return calls[calls.length - 1][0];
}
