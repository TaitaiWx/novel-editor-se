// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createDndRuleset } from '@novel-editor/core/growth';
import { chooseOption, selectOptionTexts } from '../helpers/select';
import {
  clickSave,
  lastSaved,
  renderRulesPanel,
  section,
  setNumber,
  setText,
  unsavedBar,
} from './rulesPanelHelpers';

function withoutCoreRules() {
  return { ...createDndRuleset(), coreRules: [] };
}

describe('规则之书：技能', () => {
  it('添加技能：最高等级决定升级经验格数，前置技能与新建互斥组', async () => {
    const view = renderRulesPanel();
    const skills = section('技能');
    fireEvent.click(within(skills).getByRole('button', { name: /添加技能/ }));
    setText('技能 5 名称', '望气术', skills);
    setNumber('望气术 最高等级', 3, skills);
    expect(within(skills).getAllByRole('spinbutton', { name: /^望气术 \d 级升/ })).toHaveLength(3);
    setNumber('望气术 1 级升 2 级经验', 120, skills);
    setNumber('望气术 2 级升 3 级经验', 240, skills);

    const item = within(skills).getByLabelText('望气术 的前置条件');
    fireEvent.click(within(item).getByRole('button', { name: /前置技能/ }));
    chooseOption(within(item).getByRole('combobox', { name: '望气术 的前置技能' }), '火球术');
    setNumber('望气术 的前置技能等级', 2, item);
    setNumber('望气术 需要的角色等级', 3, item);

    chooseOption(within(skills).getByRole('combobox', { name: '望气术 互斥组' }), '新建互斥组…');
    setText('望气术 新互斥组名称', '观测', skills);
    fireEvent.click(within(skills).getByRole('button', { name: '确定' }));

    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    expect(lastSaved(view.onSave).skills.at(-1)).toEqual({
      id: 'skill-1',
      name: '望气术',
      maxLevel: 3,
      costPerLevel: [0, 120, 240],
      prerequisites: { characterLevel: 3, skills: { fireball: 2 } },
      exclusiveGroup: '观测',
    });
  });

  it('前置技能等级超过该技能最高等级时提醒；互斥组可选已有的组', () => {
    renderRulesPanel();
    const skills = section('技能');
    const heal = within(skills).getByLabelText('治愈真言 的前置条件');
    fireEvent.click(within(heal).getByRole('button', { name: /前置技能/ }));
    setNumber('治愈真言 的前置技能等级', 9, heal);
    expect(within(skills).getByText(/最高只有 3 级/)).toBeTruthy();
    expect(
      selectOptionTexts(within(skills).getByRole('combobox', { name: '治愈真言 互斥组' }))
    ).toEqual(['不互斥', 'school', '新建互斥组…']);
  });

  it('删除被成长卡用到的技能要确认，并移除抉择奖励中的该技能', async () => {
    const view = renderRulesPanel();
    fireEvent.click(screen.getByRole('button', { name: '删除技能 回气' }));
    const confirm = screen.getByRole('alertdialog', { name: '确认删除' });
    expect(within(confirm).getByText(/林舟 的成长卡用到了技能「回气」/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: '仍然删除' }));
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    const saved = lastSaved(view.onSave);
    expect(saved.skills.some((skill) => skill.id === 'second-wind')).toBe(false);
    expect(saved.choiceGroups[0].options[0].grants).toEqual({ attributes: { str: 2, con: 1 } });
  });

  it('名称为空时报错，不能保存', () => {
    renderRulesPanel();
    setText('技能 1 名称', '');
    expect(within(section('技能')).getByText('请填写技能名称')).toBeTruthy();
    const save = within(unsavedBar() as HTMLElement).getByRole('button', { name: '保存' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('规则之书：能力抉择', () => {
  it('添加二选一：选项名称、属性加成行、技能奖励、建议等级', async () => {
    const view = renderRulesPanel();
    const choices = section('能力抉择');
    fireEvent.click(within(choices).getByRole('button', { name: /添加抉择/ }));
    setText('抉择 2 名称', '心法抉择', choices);
    const group = within(choices).getByLabelText('抉择 心法抉择');
    setNumber('心法抉择 建议等级', 6, group);
    setText('选项 1 名称', '刚', group);
    setText('选项 2 名称', '柔', group);

    const hard = within(group).getByLabelText('选项 刚');
    fireEvent.click(within(hard).getByRole('button', { name: /属性加成/ }));
    chooseOption(within(hard).getByRole('combobox', { name: '刚 奖励属性' }), '体质');
    setNumber('刚 奖励数值', 2, hard);
    chooseOption(within(hard).getByRole('combobox', { name: '刚 添加技能奖励' }), '回气');
    expect(within(hard).getByText(/学会 回气/)).toBeTruthy();

    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    expect(lastSaved(view.onSave).choiceGroups.at(-1)).toEqual({
      id: 'choice-1',
      name: '心法抉择',
      pick: 1,
      unlockLevel: 6,
      options: [
        { id: 'option-1', name: '刚', grants: { skills: ['second-wind'], attributes: { con: 2 } } },
        { id: 'option-2', name: '柔' },
      ],
    });
  });

  it('移除属性加成与技能奖励；添加第三个选项后可三选二', async () => {
    const view = renderRulesPanel();
    const group = within(section('能力抉择')).getByLabelText('抉择 道途抉择（三选一）');
    const warrior = within(group).getByLabelText('选项 战士之道');
    fireEvent.click(within(warrior).getAllByRole('button', { name: '移除属性加成' })[0]);
    fireEvent.click(within(warrior).getByRole('button', { name: '移除技能奖励 回气' }));
    fireEvent.click(within(group).getByRole('button', { name: /添加选项/ }));
    setText('选项 4 名称', '游侠之道', group);
    setNumber('道途抉择（三选一） 可选数量', 2, group);
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    const saved = lastSaved(view.onSave).choiceGroups[0];
    expect(saved.pick).toBe(2);
    expect(saved.options[0].grants).toEqual({ attributes: { con: 1 } });
    expect(saved.options.at(-1)).toEqual({ id: 'option-1', name: '游侠之道' });
  });

  it('删除已被角色选过的选项要确认', () => {
    renderRulesPanel();
    fireEvent.click(screen.getByRole('button', { name: '删除选项 战士之道' }));
    expect(screen.getByRole('alertdialog', { name: '确认删除' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '删除选项 法师之道' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByLabelText('选项 法师之道')).toBeNull();
  });
});

describe('规则之书：核心规则', () => {
  it('添加文字规则，设为自动校验「禁用技能」并限定角色', async () => {
    const view = renderRulesPanel({ ruleset: withoutCoreRules() });
    const core = section('核心规则');
    setText('新增核心规则', '林舟不学冰霜新星', core);
    fireEvent.click(within(core).getByRole('button', { name: '添加' }));
    const rule = within(core).getByLabelText('核心规则 1');
    expect((within(rule).getByLabelText('规则 1 内容') as HTMLInputElement).value).toBe(
      '林舟不学冰霜新星'
    );
    chooseOption(within(rule).getByRole('combobox', { name: '规则 1 自动校验' }), /禁用技能/);
    chooseOption(within(rule).getByRole('combobox', { name: '规则 1 禁用的技能' }), '冰霜新星');
    chooseOption(within(rule).getByRole('combobox', { name: '规则 1 限定角色' }), '林舟');
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    expect(lastSaved(view.onSave).coreRules).toEqual([
      {
        id: 'rule-1',
        text: '林舟不学冰霜新星',
        appliesTo: ['林舟'],
        check: { kind: 'forbid-skill', skillId: 'frost-nova' },
      },
    ]);
  });

  it('各种校验类型的参数；没有可选项时提示错误；删除规则', () => {
    renderRulesPanel({ ruleset: withoutCoreRules() });
    const core = section('核心规则');
    setText('新增核心规则', '十级封顶', core);
    fireEvent.click(within(core).getByRole('button', { name: '添加' }));
    const rule = within(core).getByLabelText('核心规则 1');
    chooseOption(within(rule).getByRole('combobox', { name: '规则 1 自动校验' }), /^等级上限/);
    setNumber('规则 1 等级上限', 10, rule);
    chooseOption(within(rule).getByRole('combobox', { name: '规则 1 自动校验' }), /^属性上限/);
    expect(within(rule).getByRole('combobox', { name: '规则 1 限制的属性' })).toBeTruthy();
    chooseOption(within(rule).getByRole('combobox', { name: '规则 1 自动校验' }), /限期抉择/);
    setNumber('规则 1 截止等级', 4, rule);
    chooseOption(within(rule).getByRole('combobox', { name: '规则 1 自动校验' }), /^技能等级上限/);
    setNumber('规则 1 技能等级上限', 2, rule);
    setText('规则 1 内容', '', core);
    expect(within(core).getByText('请填写规则内容')).toBeTruthy();
    fireEvent.click(within(core).getByRole('button', { name: '删除规则 1' }));
    expect(within(core).queryByLabelText('核心规则 1')).toBeNull();
    expect(unsavedBar()).toBeNull();
  });
});

describe('规则之书：战力限制', () => {
  it('修改每章上限后保存', async () => {
    const view = renderRulesPanel();
    setNumber('每章最多升级', 3, section('战力限制'));
    setNumber('配角遗忘阈值（章）', 12, section('战力限制'));
    clickSave();
    await waitFor(() => expect(view.onSave).toHaveBeenCalled());
    expect(lastSaved(view.onSave).limits).toMatchObject({
      maxLevelsPerChapter: 3,
      forgottenAfterChapters: 12,
    });
  });
});
