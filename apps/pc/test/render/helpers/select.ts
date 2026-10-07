/**
 * 自绘 Select（components/Select）的测试辅助：打开下拉并点击选项。
 * 下拉列表渲染在 document.body 下，所以选项总是在 screen 范围内查找。
 */
import { fireEvent, screen, within } from '@testing-library/react';

type Container = { getByRole: typeof screen.getByRole };

/** 找到下拉触发器（role="combobox"） */
export function getCombobox(label: string | RegExp, container: Container = screen): HTMLElement {
  return container.getByRole('combobox', { name: label });
}

/** 打开下拉，返回弹出的 listbox */
export function openSelect(
  labelOrTrigger: string | RegExp | HTMLElement,
  container: Container = screen
): HTMLElement {
  const trigger =
    labelOrTrigger instanceof HTMLElement ? labelOrTrigger : getCombobox(labelOrTrigger, container);
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  const listboxId = trigger.getAttribute('aria-controls');
  const listbox = listboxId ? document.getElementById(listboxId) : null;
  if (!listbox) throw new Error('下拉列表没有打开');
  return listbox;
}

/** 列出下拉中所有选项的文本 */
export function selectOptionTexts(
  labelOrTrigger: string | RegExp | HTMLElement,
  container: Container = screen
): string[] {
  const trigger =
    labelOrTrigger instanceof HTMLElement ? labelOrTrigger : getCombobox(labelOrTrigger, container);
  const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
  const listbox = openSelect(trigger);
  const texts = within(listbox)
    .getAllByRole('option')
    .map((option) => option.textContent ?? '');
  if (!wasOpen) fireEvent.click(trigger);
  return texts;
}

/** 打开下拉并点击文本匹配的选项 */
export function chooseOption(
  labelOrTrigger: string | RegExp | HTMLElement,
  optionText: string | RegExp,
  container: Container = screen
): void {
  const listbox = openSelect(labelOrTrigger, container);
  fireEvent.click(within(listbox).getByRole('option', { name: optionText }));
}
