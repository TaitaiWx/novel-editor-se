import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/run';

interface RunOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: { ok: boolean; data?: unknown; error?: { code: string; message: string; hint?: string } };
}

let dir: string;

async function ne(argv: string[], stdin?: string): Promise<RunOutput> {
  let stdout = '';
  let stderr = '';
  const { exitCode, envelope } = await runCli(argv, {
    cwd: dir,
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      readStdin: async () => stdin ?? '',
    },
  });
  return { exitCode, stdout, stderr, json: envelope as RunOutput['json'] };
}

function data<T>(output: RunOutput): T {
  return output.json.data as T;
}

const memoryDir = () => path.join(dir, '资料', '记忆');

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-growth-cli-'));
  await ne(['init', '.']);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ne growth', () => {
  it('未初始化时给出提示', async () => {
    const out = await ne(['growth', 'list', '--json']);
    expect(out.exitCode).toBe(3);
    expect(out.json.error?.hint).toContain('ne growth init');
  });

  it('init → exp 自动建卡并升级 → show / list', async () => {
    const init = await ne(['growth', 'init']);
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain('规则.json');

    const exp = await ne([
      'growth',
      'exp',
      '阿尔',
      '400',
      '--chapter',
      '3',
      '--note',
      '击败哥布林',
      '--json',
    ]);
    expect(exp.exitCode).toBe(0);
    expect(
      data<{ created: boolean; levelUps: number; progress: { expToNext: number } }>(exp)
    ).toMatchObject({
      created: true,
      levelUps: 1,
      progress: { expToNext: 500 },
    });
    const sheetJson = JSON.parse(
      await readFile(path.join(memoryDir(), '角色', '阿尔.json'), 'utf-8')
    );
    expect(sheetJson.events[0]).toMatchObject({
      type: 'exp',
      delta: 400,
      chapter: 3,
      source: 'cli',
    });

    const show = await ne(['growth', 'show', '阿尔']);
    expect(show.stdout).toContain('距下一级 500 经验');
    expect(show.stdout).toContain('击败哥布林');

    const listed = await ne(['growth', 'list', '--json']);
    expect(data<{ characters: Array<{ name: string; level: number }> }>(listed).characters).toEqual(
      [expect.objectContaining({ name: '阿尔', level: 2 })]
    );
    expect((await ne(['growth', 'show', '无名'])).exitCode).toBe(3);
  });

  it('负数经验、属性、技能、抉择与规则校验', async () => {
    await ne(['growth', 'init']);
    expect((await ne(['growth', 'exp', '阿尔', '-50'])).exitCode).toBe(0);
    expect((await ne(['growth', 'exp', '阿尔', 'abc'])).exitCode).toBe(2);

    const attr = await ne(['growth', 'attr', '阿尔', '力量', '2', '--json']);
    expect(data<{ sheet: { attributes: Record<string, number> } }>(attr).sheet.attributes.str).toBe(
      12
    );

    const blocked = await ne(['growth', 'skill', '阿尔', 'fireball', '--json']);
    expect(blocked.exitCode).toBe(2);
    expect(blocked.json.error?.message).toContain('角色等级 5');

    const forced = await ne(['growth', 'skill', '阿尔', 'fireball', '--force', '--json']);
    expect(forced.exitCode).toBe(0);
    expect(
      data<{ warnings: Array<{ code: string }> }>(forced).warnings.map((w) => w.code)
    ).toContain('SKILL_PREREQUISITE');

    const skillExp = await ne(['growth', 'skill', '阿尔', '回气', '--exp', '250', '--json']);
    expect(
      data<{ sheet: { skills: Array<{ id: string; level: number }> } }>(skillExp).sheet.skills
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'second-wind', level: 2 })]));
    expect(
      (await ne(['growth', 'skill', '阿尔', 'x', '--exp', '1', '--levels', '1'])).exitCode
    ).toBe(2);

    const choose = await ne([
      'growth',
      'choose',
      '阿尔',
      'path',
      '法师之道',
      '--chapter',
      '9',
      '--json',
    ]);
    expect(choose.exitCode).toBe(0);
    const again = await ne(['growth', 'choose', '阿尔', 'path', 'warrior', '--json']);
    expect(again.exitCode).toBe(2);
    expect(again.json.error?.message).toContain('只能选择 1 项');

    const note = await ne(['growth', 'note', '阿尔', '左臂受伤', '--status', '--json']);
    expect(note.exitCode).toBe(0);
    const shown = await ne(['growth', 'show', '阿尔', '--json']);
    expect(data<{ sheet: { notes: string[] } }>(shown).sheet.notes).toEqual(['左臂受伤']);
  });

  it('rules 增删核心规则', async () => {
    await ne(['growth', 'init', '--template', 'blank']);
    const added = await ne(['growth', 'rules', '--add', '主角不能飞', '--json']);
    expect(data<{ coreRules: Array<{ id: string; text: string }> }>(added).coreRules).toEqual([
      { id: 'rule-1', text: '主角不能飞' },
    ]);
    const removed = await ne(['growth', 'rules', '--remove', 'rule-1', '--json']);
    expect(data<{ coreRules: unknown[] }>(removed).coreRules).toEqual([]);
    expect((await ne(['growth', 'rules', '--remove', 'nope'])).exitCode).toBe(3);
  });

  it('party / map / check：队伍历史、足迹与被遗忘的配角', async () => {
    await ne(['growth', 'init']);
    const party = await ne([
      'growth',
      'party',
      'add',
      '银月小队',
      '--members',
      '阿尔,莉娜',
      '--from',
      '3',
      '--json',
    ]);
    expect(party.exitCode).toBe(0);
    expect((await ne(['growth', 'party', 'end', '银月小队', '--to', '10'])).exitCode).toBe(0);
    expect((await ne(['growth', 'party', 'seen', '莉娜', '12', '--important'])).exitCode).toBe(0);
    expect((await ne(['growth', 'party', 'fly'])).exitCode).toBe(2);
    expect(
      (await ne(['growth', 'map', 'add', '霜城', '--region', '北境', '--chapter', '5'])).exitCode
    ).toBe(0);
    expect((await ne(['growth', 'map', 'visit', '霜城', '阿尔', '--chapter', '80'])).exitCode).toBe(
      0
    );
    const map = await ne(['growth', 'map', '--json']);
    expect(
      data<{ locations: Array<{ name: string; visits: unknown[] }> }>(map).locations[0].visits
    ).toHaveLength(1);

    const check = await ne(['growth', 'check', '--json']);
    const result = data<{
      currentChapter: number;
      forgotten: Array<{ name: string; important: boolean; parties: string[] }>;
    }>(check);
    expect(result.currentChapter).toBe(80);
    expect(result.forgotten[0]).toMatchObject({
      name: '莉娜',
      important: true,
      parties: ['银月小队'],
    });
    const text = await ne(['growth', 'check']);
    expect(text.stdout).toContain('★ 莉娜');
  });

  it('check --strict 在存在错误时失败', async () => {
    await ne(['growth', 'init']);
    await ne(['growth', 'exp', '阿尔', '1']);
    expect((await ne(['growth', 'check', '--strict'])).exitCode).toBe(0);
    await ne(['growth', 'level', '阿尔', '15', '--force']);
    const strict = await ne(['growth', 'check', '--strict', '--json']);
    expect(strict.exitCode).toBe(2);
    expect(strict.json.error?.message).toContain('战力一致性错误');
  });

  it('simulate 输出 prompt 与 schema，apply-sim 预览并采用分支', async () => {
    await ne(['growth', 'init']);
    await ne(['growth', 'exp', '阿尔', '900', '--chapter', '20']);
    expect((await ne(['growth', 'simulate', '阿尔'])).exitCode).toBe(2);
    const sim = await ne([
      'growth',
      'simulate',
      '阿尔',
      '--choices',
      'warrior,mage',
      '--horizon',
      '5',
      '--rule',
      '不能死;不能飞',
      '--json',
    ]);
    expect(sim.exitCode).toBe(0);
    const built = data<{
      prompt: string;
      schema: { required: string[] };
      startChapter: number;
      next: string;
    }>(sim);
    expect(built.startChapter).toBe(21);
    expect(built.prompt).toContain('不能飞');
    expect(built.schema.required).toEqual(['branches']);
    expect(built.next).toContain('apply-sim');

    const aiResult = JSON.stringify({
      branches: [
        {
          id: 'warrior',
          title: '铁壁',
          summary: '前排',
          events: [{ chapter: 21, type: 'exp', delta: 2000 }],
        },
        {
          id: 'mage',
          title: '元素',
          summary: '法师',
          events: [{ chapter: 22, type: 'attribute', target: 'int', delta: 1 }],
        },
      ],
    });
    const file = path.join(dir, 'ai.json');
    await writeFile(file, `结果如下\n\`\`\`json\n${aiResult}\n\`\`\``, 'utf-8');

    const preview = await ne(['growth', 'apply-sim', '阿尔', 'ai.json', '--dry-run', '--json']);
    expect(preview.exitCode).toBe(0);
    expect(data<{ applied: boolean; result: { branches: unknown[] } }>(preview)).toMatchObject({
      applied: false,
    });
    expect((await ne(['growth', 'apply-sim', '阿尔', 'ai.json'])).exitCode).toBe(2);
    expect((await ne(['growth', 'apply-sim', '阿尔', 'ai.json', '--branch', 'x'])).exitCode).toBe(
      3
    );
    expect(
      (await ne(['growth', 'apply-sim', '阿尔', '--stdin', '--branch', 'a'], 'garbage')).exitCode
    ).toBe(2);

    const applied = await ne(
      ['growth', 'apply-sim', '阿尔', '--stdin', '--branch', 'warrior', '--json'],
      aiResult
    );
    expect(applied.exitCode).toBe(0);
    const sheet = data<{
      applied: boolean;
      sheet: { choices: Array<{ optionId: string }>; level: number };
    }>(applied);
    expect(sheet.applied).toBe(true);
    expect(sheet.sheet.choices).toEqual([expect.objectContaining({ optionId: 'warrior' })]);
    expect(sheet.sheet.level).toBe(4);
    const shown = await ne(['growth', 'show', '阿尔', '--json']);
    expect(data<{ sheet: { level: number } }>(shown).sheet.level).toBe(4);
  });

  it('帮助中列出 growth 命令组', async () => {
    const help = await ne(['help']);
    expect(help.stdout).toContain('成长记录器 / 记忆库 (growth)');
    expect(help.stdout).toContain('growth simulate');
  });
});
