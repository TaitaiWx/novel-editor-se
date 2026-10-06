/**
 * 成长档案使用说明：应用内「使用说明」面板、「?」提示、首次引导与 docs/growth-guide.md 的唯一来源
 *
 * 修改文案后执行 `pnpm --filter @novel-editor/pc exec vitest run test/render/growth/growthGuide.test.ts`，
 * 单测会校验 docs/growth-guide.md 的章节标题与这里一致（可用 renderGrowthGuideMarkdown() 重新生成）。
 * 默认只展示「3 步上手」，进阶说明折叠显示，每节一两句话加一个例子（都围绕主角林舟），避免学习负担。
 */

export type GuideBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'example'; text: string }
  | { kind: 'faq'; items: Array<{ q: string; a: string }> };

export interface GuideSection {
  id: GrowthGuideSectionId;
  title: string;
  blocks: GuideBlock[];
}

export type GrowthGuideSectionId = 'level' | 'choices' | 'warnings' | 'simulate' | 'world' | 'faq';

export const GROWTH_GUIDE_TITLE = '成长档案使用说明';

export const GROWTH_GUIDE_SUMMARY =
  '像游戏角色卡一样记下角色的等级、经验和技能。几百章后也不会忘设定，战力涨太快时会提醒你。';

/** 默认展示的 3 步上手：读完这一段就能开始用，其余内容按需展开 */
export const GROWTH_QUICK_START: string[] = [
  '为主角建一张成长卡（左侧「成长档案」点 +）。',
  '每写完一章，点「记一笔」，填上获得的经验或新学的技能，按 Enter。',
  '出现淡色提醒时点开看看：战力涨太快，或某个配角很久没出场了。',
];

/** 进阶说明：默认折叠，每节一两句话 + 一个例子（例子都围绕主角林舟） */
export const GROWTH_GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'level',
    title: '等级、属性与技能',
    blocks: [
      {
        kind: 'p',
        text: '经验攒够自动升级，属性按规则每级自动成长；剧情里的额外变化用记一笔「属性变化」或「技能」。',
      },
      { kind: 'example', text: '林舟击败狼王，记「获得经验 300」，卡片立刻变成 Lv.2。' },
    ],
  },
  {
    id: 'choices',
    title: '抉择',
    blocks: [
      {
        kind: 'p',
        text: '二选一、三选一这类选了就不能回头的分支，在「抉择」卡片里点选项并确认，附带的技能和加成会自动加上。',
      },
      {
        kind: 'example',
        text: '林舟在「道途抉择」里选了「战士之道」，以后翻卡片就知道是第几章选的。',
      },
    ],
  },
  {
    id: 'warnings',
    title: '提醒',
    blocks: [
      {
        kind: 'p',
        text: '只有发现问题才会出现：一章连升太多级、属性超过合理上限、登记过的配角太久没出场。提醒不会阻止你写作。',
      },
      { kind: 'example', text: '林舟的队友苏晴已 15 章未出场，提醒会让你记得安排她回归。' },
    ],
  },
  {
    id: 'simulate',
    title: 'AI 推演',
    blocks: [
      {
        kind: 'p',
        text: '在「推演」里放进几个候选抉择，让 AI 预演接下来几章的成长；结果只是提案，点「采用」才会写入。需先在设置里开启 AI。',
      },
      {
        kind: 'example',
        text: '对比林舟走「战士之道」和「法师之道」到第 20 章的战力，再决定写哪条。',
      },
    ],
  },
  {
    id: 'world',
    title: '队伍、地图与规则',
    blocks: [
      {
        kind: 'p',
        text: '在顶部「世界」里：队伍记录谁和谁组过队（用于配角提醒），地图记录去过的地方，规则可以改经验曲线、属性和技能。刚开始用默认规则即可。',
      },
      { kind: 'example', text: '林舟、苏晴组成「青石小队」，之后苏晴久未出场就会被提醒。' },
    ],
  },
  {
    id: 'faq',
    title: '常见问题',
    blocks: [
      {
        kind: 'faq',
        items: [
          {
            q: '记错了怎么办？',
            a: '再记一笔反向的数值抵消，例如「获得经验 -300」；删错成长卡只能从 Git 恢复或重新建卡。',
          },
          {
            q: '数据存在哪里？',
            a: '在当前作品的「资料/记忆/」文件夹里，都是普通文件，可以用 Git 备份；命令行用 ne growth --novel <作品> 操作同一份数据。',
          },
          {
            q: '怎么改升级所需的经验？',
            a: '「⋯ → 编辑规则 → 经验曲线」。已有角色的等级不会自动改动，不一致时提醒里会告诉你。',
          },
        ],
      },
    ],
  },
];

// ─── 「?」提示（1~2 句 + 例子） ────────────────────────────────────────────

export type GrowthTipKey =
  | 'attributes'
  | 'skills'
  | 'choices'
  | 'timeline'
  | 'warnings'
  | 'exp'
  | 'attribute'
  | 'skill'
  | 'note'
  | 'skill-exp'
  | 'level'
  | 'notes'
  | 'simulate'
  | 'party'
  | 'map'
  | 'rules';

export const GROWTH_TIPS: Record<GrowthTipKey, string> = {
  attributes:
    '每升一级自动按规则成长；剧情里的额外变化用「记一笔 → 属性变化」。例：灵果让力量 +2。',
  skills: '显示技能等级和升到下一级还需要的技能经验。例：回气 Lv.1，下一级还需 200。',
  choices: '二选一、三选一的能力分支，选定后不可更改，点两次确认。例：道途抉择选「战士之道」。',
  timeline: '每一笔成长按章节归档，最新的在最上面。例：第 3 章 获得经验 +300（Lv.1 → 2）。',
  warnings: '战力涨得太快、违背核心规则，或配角很久没出场时才会出现。例：第 18 章连升 3 级。',
  exp: '攒够经验会自动升级，并按规则成长属性。例：击败狼王 +300。',
  attribute: '剧情带来的额外属性变化，可正可负。例：服下灵果 力量 +2。',
  skill: '学会新技能，或把已学技能升一级。例：学会「回气」。',
  note: '只留一条备忘，不改数值，AI 推演时会参考。例：左臂受伤，三章内不能用剑。',
  'skill-exp': '按练习累积技能经验，攒够自动升级。例：苦练回气 +150。',
  level: '剧情直接改变等级，不经过经验。例：传承让等级 +1。',
  notes: '伤势、装备、心境等长期状态，AI 推演时会参考。例：左臂旧伤未愈。',
  simulate: '让 AI 按你的规则推演接下来几章的成长，结果只是提案，采用后才写入。',
  party: '记录组队历史和要关注的配角，配角太久没出场时提醒你。',
  map: '记录地点和角色到访的章节。',
  rules: '属性、经验曲线、技能、抉择、核心规则和战力限制都在这里改。',
};

// ─── 首次引导 ──────────────────────────────────────────────────────────────

/** 引导是否已看过（localStorage）；删除该键即可在下次打开成长卡时重新显示 */
export const GROWTH_TOUR_STORAGE_KEY = 'novel-editor.growth.tour-done.v1';

export type GrowthTourTarget = 'list' | 'record' | 'warnings' | 'more';

export interface GrowthTourStep {
  target: GrowthTourTarget;
  title: string;
  text: string;
}

export const GROWTH_TOUR_STEPS: GrowthTourStep[] = [
  {
    target: 'record',
    title: '写完一章，记一笔',
    text: '填上获得的经验或新学的技能，按 Enter。章节会自动填好。',
  },
  {
    target: 'warnings',
    title: '有问题才会提醒',
    text: '战力涨太快或配角很久没出场时，这里会出现一条淡色提醒。',
  },
  {
    target: 'more',
    title: '其余功能都收在这里',
    text: '推演、队伍、地图、规则在顶部「推演 · 世界」；同步与删除在「⋯」。',
  },
];

// ─── Markdown 导出（docs/growth-guide.md） ─────────────────────────────────

function renderBlock(block: GuideBlock): string {
  switch (block.kind) {
    case 'p':
      return block.text;
    case 'list':
      return block.items.map((item) => `- ${item}`).join('\n');
    case 'steps':
      return block.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    case 'example':
      return `> 例：${block.text}`;
    case 'faq':
      return block.items.map((item) => `**${item.q}**\n\n${item.a}`).join('\n\n');
  }
}

/** 生成 docs/growth-guide.md 的完整内容 */
export function renderGrowthGuideMarkdown(): string {
  const header = [
    `# ${GROWTH_GUIDE_TITLE}`,
    '',
    '<!-- 由 apps/pc/src/render/components/RightPanel/GrowthView/growthGuide.ts 生成，请修改源文件后同步 -->',
    '',
    GROWTH_GUIDE_SUMMARY,
  ].join('\n');
  const quickStart = `## 3 步上手\n\n${GROWTH_QUICK_START.map(
    (item, index) => `${index + 1}. ${item}`
  ).join('\n')}`;
  const sections = GROWTH_GUIDE_SECTIONS.map(
    (section) => `## ${section.title}\n\n${section.blocks.map(renderBlock).join('\n\n')}`
  );
  return `${[header, quickStart, ...sections].join('\n\n')}\n`;
}
