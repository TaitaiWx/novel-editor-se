// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createBlankRuleset } from '@novel-editor/core/growth';
import {
  clickSave,
  lastSaved,
  renderRulesPanel,
  section,
  setNumber,
  setText,
  unsavedBar,
} from './rulesPanelHelpers';

describe('规则之书：通用', () => {
  it('不显示原始 JSON，只显示可视化分区', () => {
    renderRulesPanel();
    expect(screen.queryByLabelText('规则 JSON')).toBeNull();
    expect(screen.queryByText(/编辑规则 JSON/)).toBeNull();
    for (const name of ['核心规则', '属性', '等级曲线', '技能', '能力抉择', '战力限制']) {
      expect(section(name)).toBeTruthy();
    }
    expect(unsavedBar()).toBeNull();
  });

  it('分区可以折叠', () => {
    renderRulesPanel();
    const toggle = within(section('技能')).getByRole('button', { name: /^技能 \d+ 个/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(section('技能')).queryByLabelText('技能 1 名称')).toBeNull();
  });

  it('空规则显示「从 DND 模板开始」，载入模板后保存', async () => {
    const view = renderRulesPanel({ ruleset: createBlankRuleset(), sheets: [] });
    const empty = screen.getByRole('region', { name: '规则之书还是空的' });
    fireEvent.click(within(empty).getByRole('button', { name: '从 DND 模板开始' }));
    expect(unsavedBar()).toBeTruthy();
    expect(screen.getByLabelText('属性 1 名称')).toHaveProperty('value', '力量');
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalledTimes(1));
    expect(lastSaved(view.onSave).attributes).toHaveLength(6);
    await waitFor(() => expect(unsavedBar()).toBeNull());
  });

  it('「从空白开始」直接显示各分区', () => {
    renderRulesPanel({ ruleset: createBlankRuleset(), sheets: [] });
    fireEvent.click(screen.getByRole('button', { name: '从空白开始' }));
    expect(section('属性')).toBeTruthy();
    expect(screen.getByText(/还没有属性/)).toBeTruthy();
  });

  it('保存失败时显示主进程返回的错误，草稿保留', async () => {
    const view = renderRulesPanel({ saveError: '规则未保存：磁盘已满' });
    setText('规则之书名称', '新名字');
    clickSave();
    expect(await screen.findByText('规则未保存：磁盘已满')).toBeTruthy();
    expect(view.onSave).toHaveBeenCalledTimes(1);
    expect(unsavedBar()).toBeTruthy();
  });
});

describe('规则之书：属性', () => {
  it('添加属性：键名自动生成，保存后写入', async () => {
    const view = renderRulesPanel();
    const attrs = section('属性');
    fireEvent.click(within(attrs).getByRole('button', { name: /添加属性/ }));
    const name = screen.getByLabelText('属性 7 名称') as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    expect((screen.getByLabelText('属性 7 键名') as HTMLInputElement).value).toBe('attr-1');
    // 名称为空时有错误，不能保存
    expect(within(attrs).getByText('请填写属性名称')).toBeTruthy();
    const save = within(unsavedBar() as HTMLElement).getByRole('button', { name: '保存' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    setText('属性 7 名称', '气运');
    setNumber('气运 初始值', 5);
    setNumber('气运 最大值', 10);
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    expect(lastSaved(view.onSave).attributes.at(-1)).toMatchObject({
      key: 'attr-1',
      name: '气运',
      initial: 5,
      max: 10,
    });
  });

  it('已保存的键名只读，新属性的键名可改', () => {
    renderRulesPanel();
    expect((screen.getByLabelText('属性 1 键名') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /添加属性/ }));
    const key = screen.getByLabelText('属性 7 键名') as HTMLInputElement;
    expect(key.readOnly).toBe(false);
    setText('属性 7 键名', 'luck');
    expect(key.value).toBe('luck');
  });

  it('字段错误就地显示；撤销更改恢复原值', () => {
    renderRulesPanel();
    setNumber('力量 最大值', 0);
    expect(screen.getByText('最大值不能小于最小值')).toBeTruthy();
    expect(within(section('属性')).getByLabelText('1 处错误')).toBeTruthy();
    expect(within(unsavedBar() as HTMLElement).getByText(/1 处需要修改/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销更改' }));
    expect(unsavedBar()).toBeNull();
    expect(screen.queryByText('最大值不能小于最小值')).toBeNull();
    expect(
      (screen.getByRole('spinbutton', { name: '力量 最大值' }) as HTMLInputElement).value
    ).toBe('30');
  });

  it('重名属性报错', () => {
    renderRulesPanel();
    setText('属性 2 名称', '力量');
    expect(screen.getByText('属性「力量」重复')).toBeTruthy();
  });

  it('上移 / 下移调整顺序', async () => {
    const view = renderRulesPanel();
    fireEvent.click(within(section('属性')).getAllByRole('button', { name: '下移' })[0]);
    expect((screen.getByLabelText('属性 1 名称') as HTMLInputElement).value).toBe('敏捷');
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    expect(
      lastSaved(view.onSave)
        .attributes.map((attr) => attr.key)
        .slice(0, 2)
    ).toEqual(['dex', 'str']);
  });

  it('删除被成长卡与规则引用的属性要确认，并清理引用', async () => {
    const view = renderRulesPanel();
    fireEvent.click(screen.getByRole('button', { name: '删除属性 智力' }));
    const confirm = screen.getByRole('alertdialog', { name: '确认删除' });
    expect(within(confirm).getByText(/林舟 的成长卡用到了属性「智力」/)).toBeTruthy();
    expect(within(confirm).getByText(/技能「火球术」的前置条件/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: '删除属性 智力' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '删除属性 智力' }));
    fireEvent.click(screen.getByRole('button', { name: '仍然删除' }));
    expect(screen.queryByRole('button', { name: '删除属性 智力' })).toBeNull();
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    const saved = lastSaved(view.onSave);
    expect(saved.attributes.some((attr) => attr.key === 'int')).toBe(false);
    expect(saved.skills.find((skill) => skill.id === 'fireball')?.prerequisites).toEqual({
      characterLevel: 5,
    });
  });

  it('没人用到的新属性直接删除', () => {
    renderRulesPanel();
    fireEvent.click(screen.getByRole('button', { name: /添加属性/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除属性 属性 7' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByLabelText('属性 7 名称')).toBeNull();
    expect(unsavedBar()).toBeNull();
  });
});

describe('规则之书：等级曲线', () => {
  it('切换到公式，实时预览前几级', async () => {
    const view = renderRulesPanel();
    const levels = section('等级曲线');
    fireEvent.click(within(levels).getByRole('radio', { name: '公式' }));
    setNumber('基础经验（1 → 2 级）', 200, levels);
    setNumber('每级倍率', 2, levels);
    const preview = within(levels).getByLabelText('经验预览');
    expect(within(preview).getByText('累计 600')).toBeTruthy();
    expect(within(preview).getByText('400')).toBeTruthy();
    setNumber('最高等级', 3, levels);
    expect(within(preview).getAllByText(/→/)).toHaveLength(2);
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    expect(lastSaved(view.onSave).levels).toEqual({
      maxLevel: 3,
      curve: { kind: 'formula', base: 200, factor: 2 },
    });
  });

  it('经验表：修改、添加一级、删除一级', async () => {
    const view = renderRulesPanel();
    const levels = section('等级曲线');
    setNumber('1 级升 2 级经验', 250, levels);
    const before = within(levels).getAllByRole('spinbutton', { name: /级升/ }).length;
    fireEvent.click(within(levels).getByRole('button', { name: /添加一级/ }));
    expect(within(levels).getAllByRole('spinbutton', { name: /级升/ })).toHaveLength(before + 1);
    fireEvent.click(within(levels).getByRole('button', { name: '删除第 2 级' }));
    setNumber('1 级升 2 级经验', 0, levels);
    expect(within(levels).getByText('升级所需经验必须大于 0')).toBeTruthy();
    setNumber('1 级升 2 级经验', 250, levels);
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    const curve = lastSaved(view.onSave).levels.curve;
    expect(curve.kind).toBe('table');
    if (curve.kind === 'table') {
      expect(curve.perLevel[0]).toBe(250);
      expect(curve.perLevel).toHaveLength(before);
    }
  });

  it('切回经验表时按公式算出的数值预填', () => {
    renderRulesPanel();
    const levels = section('等级曲线');
    fireEvent.click(within(levels).getByRole('radio', { name: '公式' }));
    fireEvent.click(within(levels).getByRole('radio', { name: '经验表' }));
    expect(within(levels).getAllByRole('spinbutton', { name: /级升/ }).length).toBe(19);
  });
});
