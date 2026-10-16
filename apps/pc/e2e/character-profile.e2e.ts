/** Real Electron/SQLite character draft workflow, with only the external AI replaced by local HTTP. */
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_WORK, FIXTURE_WORK_DIR } from './support/fixture';
import { GROWTH_SECTION, setupAppSuite } from './support/suite';
import { selectWork } from './support/workbench';

type Target = { type: 'design' | 'voice' | 'entry' | 'relation'; key: string };
type StoredProfile = {
  design: Record<string, string>;
  voice: Record<string, string>;
  development?: Record<string, string>;
  media?: unknown;
};
const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-profile-' } });
const TABS = '[role="tablist"][aria-label="人物详情"]';
const APPEARANCE = '[role="textbox"][aria-label="人物外貌"]';
const API_KEY = 'profile-e2e-local-key';
const NEW_APPEARANCE = '黑发，蓝色长袍。\n左眉有疤。';
const ENVIRONMENT_KEYS = [
  'environment',
  'background',
  'family',
  'education',
  'influences',
  'socialPosition',
  'identity',
];
const requests: Target[][] = [];
let server: Server;
let baseUrl = '';
let held: (() => void) | undefined;
let holdFirst = true;
let truncateFirst = true;
let failEnvironment = false;
let characterId = 0;
let initial: Record<string, unknown>;
const workPath = () => suite.fixture.resolve(FIXTURE_WORK_DIR);

function answer(res: ServerResponse, targets: Target[]) {
  const environment = targets.some((target) => ENVIRONMENT_KEYS.includes(target.key));
  const invalid = failEnvironment && environment;
  const truncated = truncateFirst;
  truncateFirst = false;
  const design: Record<string, string> = {};
  const voice: Record<string, string> = {};
  const entries: Array<Record<string, unknown>> = [];
  for (const target of targets) {
    if (target.type === 'design') {
      const values: Record<string, string> = {
        appearance: NEW_APPEARANCE,
        species: '人类，寿命约八十岁。',
        background: '在海边铁匠铺长大。',
        environment: '小镇靠海，风多雨急。',
      };
      if (values[target.key]) design[target.key] = values[target.key];
    }
    if (target.type === 'voice' && target.key === 'age') voice.age = '17岁（少年）';
    if (target.type === 'entry' && ['identity', 'equipment', 'goal'].includes(target.key))
      entries.push({
        id: '',
        kind: target.key,
        name: { identity: '海港学徒', equipment: '回声罗盘', goal: '寻找旧航线' }[target.key]!,
        description: '跟随航线探索，记住同行者留下的线索。',
        stage: '离乡后',
        status: target.key === 'goal' ? 'planned' : 'active',
        relatedIds: [],
        chapterPaths: [],
      });
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: truncated ? 'length' : 'stop',
          message: {
            content:
              invalid || truncated
                ? '{"design":{"background":"未结束'
                : JSON.stringify({ design, voice, entries, relationNotes: {}, newRelations: [] }),
          },
        },
      ],
    })
  );
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${API_KEY}`) {
        res.writeHead(401);
        res.end('{}');
        return;
      }
      const body = JSON.parse(raw) as { messages: Array<{ content: string }> };
      const prompt = body.messages.map((message) => message.content).join('\n');
      const matched = prompt.match(/本批目标：(\[[^\n]+?\])。/);
      if (!matched) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: { message: 'Missing batch contract' } }));
        return;
      }
      const targets = JSON.parse(matched[1]) as Target[];
      requests.push(targets);
      if (holdFirst) {
        holdFirst = false;
        held = () => answer(res, targets);
      } else answer(res, targets);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  await selectWork(suite.page, FIXTURE_WORK);
  const seeded = await suite.page.evaluate<{ id: number; attributes: Record<string, unknown> }>(
    async (root: string, url: string, key: string) => {
      const rows = await window.electron.ipcRenderer.invoke('db-character-list-by-folder', root);
      const person = rows.find((row) => row.name === '林舟')!;
      const attributes = JSON.parse(person.attributes || '{}') as Record<string, unknown>;
      const next = {
        ...attributes,
        design: {
          ...(attributes.design as Record<string, string>),
          appearance: '黑发，旧布衣。',
          species: '',
        },
      };
      await window.electron.ipcRenderer.invoke('db-character-update', person.id, {
        attributes: JSON.stringify(next),
      });
      const configured = await window.electron.ipcRenderer.invoke('ai-providers-set', 'grok', {
        apiKey: key,
        baseUrl: url,
        enabled: true,
      });
      if (!configured.ok) throw new Error(configured.error.message);
      return { id: person.id, attributes: next };
    },
    workPath(),
    baseUrl,
    API_KEY
  );
  characterId = seeded.id;
  initial = seeded.attributes;
  await suite.page.click({ text: '林舟', within: GROWTH_SECTION, exact: true });
  await suite.page.waitForTarget(APPEARANCE);
});

afterAll(async () => {
  held?.();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function stored() {
  return suite.page.evaluate<StoredProfile>(
    async (root: string, id: number) => {
      const rows = await window.electron.ipcRenderer.invoke('db-character-list-by-folder', root);
      return JSON.parse(rows.find((row) => row.id === id)!.attributes) as StoredProfile;
    },
    workPath(),
    characterId
  );
}
async function tab(label: string) {
  await suite.page.click({ text: label, within: TABS });
}
async function generate() {
  await suite.page.click({ text: 'AI 丰富人物', exact: true });
  await suite.page.click({ text: '生成并填入', exact: true });
}
async function complete() {
  await suite.page.waitForTarget({ text: 'AI 丰富人物', exact: true }, 30_000);
}
async function cleanText(selector: string): Promise<string> {
  return suite.page.evaluate(
    (target: string) =>
      Array.from(document.querySelectorAll(`${target} .cm-line`))
        .map((line) => {
          const clone = line.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('.diff-text-deleted').forEach((node) => node.remove());
          return clone.textContent ?? '';
        })
        .join('\n'),
    selector
  );
}

describe('人物资料：生成、差异、保存与切换保护', () => {
  it('生成关闭浮层并锁定输入；截断自动拆分，覆盖五页但不改图集/成长', async () => {
    await generate();
    await suite.page.waitUntil(() => Boolean(held), { message: '首个 AI 请求到达本地服务' });
    expect(await suite.page.exists({ text: '生成并填入', exact: true })).toBe(false);
    expect(
      await suite.page.evaluate(
        (selector: string) => document.querySelector(selector)?.getAttribute('aria-disabled'),
        APPEARANCE
      )
    ).toBe('true');
    expect(
      await suite.page.evaluate(
        (selector: string) =>
          Array.from(document.querySelectorAll(`${selector} [role="tab"]`))
            .filter((el) =>
              ['成长档案', '人物图集', '设置'].some((label) => el.textContent?.startsWith(label))
            )
            .map((el) => Boolean(el.querySelector('[aria-label="生成中"]'))),
        TABS
      )
    ).toEqual([false, false, false]);
    const release = held!;
    held = undefined;
    release();
    await complete();
    expect(requests[0].length).toBe(4);
    expect(requests[1].length).toBe(2);
    const keys = requests.flat().map((target) => target.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'species',
        'health',
        'family',
        'education',
        'equipment',
        'foreshadow',
        'arc',
        'age',
      ])
    );
    expect(keys).not.toContain('media');
    expect(requests.flat()).toContainEqual({ type: 'relation', key: 'note' });
    for (const obsolete of ['relationships', 'socialStyle', 'intimacyStyle'])
      expect(keys).not.toContain(obsolete);
    expect(await suite.page.exists(`${TABS} [data-failed="true"]`)).toBe(false);
    expect(await cleanText(APPEARANCE)).toBe(NEW_APPEARANCE);
    const diff = await suite.page.evaluate<{ added: string; deleted: string }>(
      (selector: string) => {
        const field = document.querySelector(selector)!;
        return {
          added: Array.from(field.querySelectorAll('.diff-text-added'))
            .map((el) => el.textContent)
            .join(''),
          deleted: Array.from(field.querySelectorAll('.diff-text-deleted'))
            .map((el) => el.textContent)
            .join(''),
        };
      },
      APPEARANCE
    );
    expect(diff.added).toContain('蓝色长袍');
    expect(diff.deleted).toBe('旧布衣');
    expect((await stored()).design.appearance).toBe('黑发，旧布衣。');
    expect((await stored()).media).toEqual(initial.media);
    expect((await stored()).development).toEqual(initial.development);
  });

  it('未保存时切换角色会定位提示；直接修改后只保存人物页，其他页可分别取消或保存', async () => {
    const { page } = suite;
    await page.click({ text: '苏晴', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget('[role="alert"]');
    await page.waitFor(
      () =>
        Array.from(document.querySelectorAll('[role="alert"]')).some((notice) =>
          notice.textContent?.includes('尚未保存')
        ),
      { message: '切换人物时显示未保存草稿提示' }
    );
    expect(await cleanText(APPEARANCE)).toBe(NEW_APPEARANCE);
    await page.click(APPEARANCE);
    await page.press('a', [process.platform === 'darwin' ? 'Meta' : 'Control']);
    await page.type('黑发，作者修改的蓝袍。\n保留换行。');
    await page.click('[aria-label="保存人物修改"]');
    await page.waitUntil(
      async () => (await stored()).design.appearance === '黑发，作者修改的蓝袍。\n保留换行。',
      { message: '人物页纯文本持久化' }
    );
    expect(
      await page.evaluate(
        (selector: string) =>
          document.querySelector(selector)?.querySelectorAll('.diff-text-added, .diff-text-deleted')
            .length,
        APPEARANCE
      )
    ).toBe(0);
    expect((await stored()).voice.age).toBe('17岁（少年）');
    expect((await stored()).design.background).toBe(
      (initial.design as Record<string, string>).background
    );
    await tab('背景');
    await page.click('[aria-label="取消背景修改"]');
    expect((await stored()).design.background).toBe(
      (initial.design as Record<string, string>).background
    );
    await tab('能力与资源');
    await page.waitForTarget({ text: '回声罗盘', exact: true });
    await page.click('[aria-label="保存能力与资源修改"]');
    await page.waitUntil(
      async () =>
        Object.values((await stored()).development ?? {}).some((value) =>
          value.includes('回声罗盘')
        ),
      { message: '装备条目已保存' }
    );
    expect(
      Object.values((await stored()).development ?? {})
        .filter(Boolean)
        .map((value) => JSON.parse(value))
        .find((entry) => entry.name === '回声罗盘')
    ).toMatchObject({ kind: 'equipment', status: 'active', stage: '离乡后' });
    await tab('剧情发展');
    await page.click('[aria-label="取消剧情发展修改"]');
    expect(JSON.stringify((await stored()).development)).not.toContain('寻找旧航线');
    await page.click({ text: '苏晴', within: GROWTH_SECTION, exact: true });
    await page.waitFor(
      () =>
        !document
          .querySelector('[aria-label="资料摘要"]')
          ?.textContent?.includes('青石镇长大的少年'),
      { message: '已允许离开林舟' }
    );
    await page.click({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitFor(
      async () =>
        document.querySelector('[aria-label="人物外貌"]')?.textContent?.includes('作者修改的蓝袍'),
      { message: '重开角色读取已保存资料' }
    );
    expect(await cleanText(APPEARANCE)).toBe('黑发，作者修改的蓝袍。\n保留换行。');
  });

  it('格式失败显示中文原因和红色状态；只重试失败页并保留其他页草稿', async () => {
    failEnvironment = true;
    const failedRunStart = requests.length;
    await generate();
    await complete();
    expect(
      requests
        .slice(failedRunStart)
        .filter((targets) => targets.some((target) => ENVIRONMENT_KEYS.includes(target.key)))
        .map((targets) => targets.length)
    ).toEqual([4, 2, 1]);
    await tab('背景');
    await suite.page.waitForTarget({ text: '模型返回的资料格式', within: '[role="alert"]' });
    expect(
      await suite.page.evaluate(
        (selector: string) =>
          document.querySelector(`${selector} [aria-selected="true"]`)?.getAttribute('data-failed'),
        TABS
      )
    ).toBe('true');
    expect(await suite.page.bodyText()).not.toContain('Unterminated string');
    const start = requests.length;
    failEnvironment = false;
    await suite.page.click({ text: '重试此页', exact: true });
    await complete();
    expect(
      requests
        .slice(start)
        .flat()
        .map((target) => target.key)
    ).toEqual(ENVIRONMENT_KEYS);
    expect(await suite.page.exists(`${TABS} [data-failed="true"]`)).toBe(false);
    await suite.page.click('[aria-label="保存背景修改"]');
    await suite.page.waitUntil(
      async () => (await stored()).design.background === '在海边铁匠铺长大。',
      { message: '失败页重试后可以独立保存' }
    );
    await tab('人物');
    expect(await cleanText(APPEARANCE)).toBe(NEW_APPEARANCE);
    await suite.page.click('[aria-label="取消人物修改"]');
    for (const label of ['能力与资源', '剧情发展']) {
      await tab(label);
      const selector = `[aria-label="取消${label}修改"]`;
      if (await suite.page.exists(selector)) await suite.page.click(selector);
    }
  });
});
