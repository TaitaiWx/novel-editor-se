/**
 * 自绘下拉（components/Select）的 E2E 操作：应用里没有原生 <select>，
 * 触发器是 role="combobox" 的按钮，弹出的 listbox 渲染在 body 下、aria-label 与触发器相同。
 */
import type { Page } from './page';

/** 下拉触发器的选择器（按 aria-label） */
export function comboboxSelector(label: string): string {
  return `[role="combobox"][aria-label="${label}"]`;
}

/** 下拉弹出列表的选择器（按 aria-label） */
export function listboxSelector(label: string): string {
  return `[role="listbox"][aria-label="${label}"]`;
}

/** 读取下拉当前显示的文本 */
export function selectedOptionText(page: Page, label: string): Promise<string> {
  return page.evaluate<string>(
    (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? '',
    comboboxSelector(label)
  );
}

/** 打开下拉并点击文本完全一致的选项，等待列表收起 */
export async function chooseSelectOption(
  page: Page,
  label: string,
  optionText: string
): Promise<void> {
  const listbox = listboxSelector(label);
  if (!(await page.exists(listbox))) await page.click(comboboxSelector(label));
  await page.waitForTarget(listbox);
  await page.click({ text: optionText, within: listbox, exact: true });
  await page.waitForGone(listbox);
}
