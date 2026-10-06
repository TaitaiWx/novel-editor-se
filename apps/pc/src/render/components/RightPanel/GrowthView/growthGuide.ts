/**
 * 成长档案使用说明：应用内「使用说明」面板、「?」提示、首次引导与 docs/growth-guide.md 的唯一来源
 *
 * 修改文案后执行 `pnpm --filter @novel-editor/pc exec vitest run test/render/growth/growthGuide.test.ts`，
 * 单测会校验 docs/growth-guide.md 的章节标题与这里一致（可用 renderGrowthGuideMarkdown() 重新生成）。
 * 全文用同一个例子贯穿：主角林舟，从第 1 章写到第 30 章。
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

export type GrowthGuideSectionId =
  | 'intro'
  | 'level'
  | 'attributes'
  | 'skills'
  | 'choices'
  | 'record'
  | 'warnings'
  | 'simulate'
  | 'world'
  | 'data'
  | 'workflow'
  | 'faq';

export const GROWTH_GUIDE_TITLE = '成长档案使用说明';

export const GROWTH_GUIDE_SUMMARY =
  '像游戏角色卡一样记下每个角色的等级、经验、属性、技能和关键抉择。写到几百章也不会忘记设定，战力涨得太快或违背规则时会提醒你。';

export const GROWTH_GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'intro',
    title: '什么是成长卡',
    blocks: [
      {
        kind: 'p',
        text: '成长卡就是一张「游戏角色卡」：记下角色的等级、经验、属性、技能和关键抉择。写到几百章时，不必翻回前文找「他现在几级、会什么」，打开成长卡一眼就能看到。',
      },
      {
        kind: 'p',
        text: '每个角色一张卡。在左侧「成长档案」列表里点角色名即可打开；点列表标题旁的总览按钮能看到所有角色。',
      },
      {
        kind: 'example',
        text: '主角林舟：第 1 章是刚出山的少年（Lv.1），到第 30 章成长为能独当一面的剑修。本说明的例子都围绕他展开。',
      },
    ],
  },
  {
    id: 'level',
    title: '等级与经验',
    blocks: [
      {
        kind: 'p',
        text: '经验攒够就会自动升级。卡片顶部的经验条写着「本级 x / y · 距下一级 N」：x 是这一级已经攒下的经验，y 是升到下一级一共需要的经验。',
      },
      {
        kind: 'list',
        items: [
          '记一笔「获得经验」后，系统按经验曲线自动计算等级；一次攒够好几级会连升。',
          '每一级需要多少经验由「经验曲线」决定，在「⋯ → 编辑规则 → 经验曲线」里修改。DND 模板默认 1→2 级需要 300，2→3 级需要 600，3→4 级需要 1800。',
          '剧情直接改变等级（传承、降级诅咒）时，在记一笔里展开「高级」，选「直接调整等级」。',
        ],
      },
      {
        kind: 'example',
        text: '第 3 章林舟击败狼王，记「获得经验 300」，卡片立刻变成 Lv.2；第 12 章再记 600，升到 Lv.3，经验条显示离 Lv.4 还差 1800。',
      },
    ],
  },
  {
    id: 'attributes',
    title: '属性',
    blocks: [
      {
        kind: 'p',
        text: '属性是力量、敏捷这类数值。每升一级，规则里设定的「每级成长」会自动加上，不需要手动记。',
      },
      {
        kind: 'list',
        items: [
          '剧情里额外的变化（吃了灵果、中了诅咒）用记一笔「属性变化」，写 +2 或 -1。',
          '每个属性有一条「成长上限」：初始值 + 每级上限 ×（等级 − 1）+ 抉择奖励。超过它说明这项属性涨得比等级还快，会出现提醒。',
          '属性本身还有绝对的最小值和最大值（DND 模板为 1~30），超出时会被拦下；确有必要可以点「仍然记录」。',
          '成长上限只是护栏，不会阻止你记录：它会在提醒里告诉你哪里涨快了，由你决定是否在剧情里给出理由。',
        ],
      },
      {
        kind: 'example',
        text: 'DND 模板里属性初始 10、每级最多 +2。林舟 Lv.3 时力量 12、上限 14；第 15 章写他吃下灵果力量 +6，记下后提醒会指出「力量 18 高于 3 级的合理上限 14」——你可以改成 +2，或在剧情里给足理由后保留。',
      },
    ],
  },
  {
    id: 'skills',
    title: '技能',
    blocks: [
      {
        kind: 'p',
        text: '技能有自己的等级。卡片上每个技能都显示当前等级，以及「下一级还需要多少技能经验」。',
      },
      {
        kind: 'list',
        items: [
          '学会或升一级：记一笔选「技能」，再选技能名。没学过的会「学会」，学过的会「升一级」。',
          '前置条件：有些技能要求角色等级、其他技能或属性达到某个值，不满足时会拦下并告诉你差什么。',
          '消耗：每一级需要的技能经验在规则里设定。想按「练习慢慢攒」来写，在「高级」里选「技能经验」，攒够会自动升级。',
          '互斥：同一互斥组的技能只能学一个，例如火球术和冰霜新星只能主修其一。',
        ],
      },
      {
        kind: 'example',
        text: '第 8 章林舟学会「回气」（Lv.1，下一级需 200 技能经验）。第 20 章想让他学「火球术」，系统提示需要 Lv.5 和智力 13——你就知道前面还得安排升级和修炼。',
      },
    ],
  },
  {
    id: 'choices',
    title: '抉择',
    blocks: [
      {
        kind: 'p',
        text: '抉择就是二选一、三选一这类「选了就不能回头」的能力分支，例如「战士之道 / 法师之道 / 牧师之道」。',
      },
      {
        kind: 'list',
        items: [
          '抉择组在规则里定义：名称、可选几个、每个选项附带哪些技能或属性加成。',
          '在成长卡的「抉择」卡片里点选项，再点一次确认，就会写进记录；选项附带的技能和属性会自动加上。',
          '为什么重要：几百章后最容易忘的就是「当初放弃了什么」。抉择记下后，一致性检查和 AI 推演都会以它为准。',
        ],
      },
      {
        kind: 'example',
        text: '第 10 章（林舟 Lv.3）在「道途抉择」里选了「战士之道」，自动学会回气、力量 +2、体质 +1。以后翻卡片就能看到这一笔发生在第 10 章。',
      },
    ],
  },
  {
    id: 'record',
    title: '记一笔：每章写完 30 秒',
    blocks: [
      {
        kind: 'steps',
        items: [
          '写完一章，在左侧「成长档案」里点开角色；也可以直接在右侧面板「成长」里点「记一笔」。',
          '点「记一笔」，选类型：获得经验、属性变化、技能、记事。',
          '填一个数值，可以再写一句「发生了什么」。章节会自动填成你正在写的那一章。',
          '按 Enter。右下角提示「林舟 获得 300 经验，升到 Lv.2」，时间线多出一条。',
        ],
      },
      {
        kind: 'p',
        text: '只想留个备忘（受了伤、得到一把剑）就用「记事」：它不改数值，但会出现在时间线里，AI 推演时也会参考。',
      },
      {
        kind: 'example',
        text: '第 3 章写完：点开林舟 → 记一笔 → 获得经验 → 填 300、「击败狼王」→ Enter。整个过程不到 30 秒。',
      },
    ],
  },
  {
    id: 'warnings',
    title: '提醒',
    blocks: [
      {
        kind: 'p',
        text: '只有发现问题时，成长卡顶部才会出现一条淡色提醒，点开能看到详情和处理建议。没有提醒，就说明一切正常。',
      },
      {
        kind: 'list',
        items: [
          '战力一致性：一章内升级太多、属性暴涨、超过成长上限、违背你写下的核心规则，都会被标出来。阈值在「规则 → 战力限制」里调整。',
          '配角回归：在「世界 → 队伍」里登记过的配角，超过一定章数（默认 30 章）没有出场，会提醒你「他好久没出场了」。',
          '怎么处理：修正记录、在剧情里补上理由，或者调整规则阈值。提醒只是提醒，不会阻止你写作。',
        ],
      },
      {
        kind: 'example',
        text: '第 18 章林舟一章连升 3 级，提醒「第 18 章连升 3 级（上限 2）」。把配角提醒阈值改成 15 章后，第 30 章会提醒「苏晴 已 15 章未出场」，你就记得安排她回归。',
      },
    ],
  },
  {
    id: 'simulate',
    title: 'AI 推演',
    blocks: [
      {
        kind: 'p',
        text: '把候选的抉择或一条核心规则放进去，让 AI 推演这个角色接下来若干章可能怎么成长，提前看到「走这条路会不会崩」。',
      },
      {
        kind: 'list',
        items: [
          '受控成长：严格按你的规则和核心规则推演，适合检验设定。',
          '自由成长：允许 AI 更大胆地发挥，适合找灵感。',
          '结果只是提案：各分支的等级、属性、技能变化并排展示，你确认「采用」之后才会写入成长卡。',
          '需要先在「设置 → AI」里开启并配置模型，否则会提示 AI 功能未启用。',
        ],
      },
      {
        kind: 'example',
        text: '第 10 章抉择之前，把「战士之道」和「法师之道」都放进推演，推演 10 章，对比两条路线下林舟到第 20 章的战力，再决定写哪一条。',
      },
    ],
  },
  {
    id: 'world',
    title: '队伍、地图与规则',
    blocks: [
      {
        kind: 'p',
        text: '这三项在成长卡顶部的「世界」里，所有角色共用。',
      },
      {
        kind: 'list',
        items: [
          '队伍：记录谁和谁在哪几章组过队，以及需要关注的配角。用来找回被遗忘的配角，也能看出队伍的变迁。',
          '地图：记录地点和角色到访的章节，适合多地图、长线旅程的故事。',
          '规则：属性、经验曲线、技能、抉择、核心规则、战力限制都在这里改。刚开始用 DND 模板即可，写顺了再调整。',
        ],
      },
      {
        kind: 'example',
        text: '第 5 章林舟和苏晴、老周组成「青石小队」，第 16 章小队解散——记在队伍里，之后苏晴久未出场就会被提醒。',
      },
    ],
  },
  {
    id: 'data',
    title: '数据存在哪里',
    blocks: [
      {
        kind: 'p',
        text: '所有数据都是项目里的普通文件，放在「资料/记忆/」下：',
      },
      {
        kind: 'list',
        items: [
          '规则.json、队伍.json、地图.json：规则与世界设定。',
          '角色/林舟.json：成长卡本体；角色/林舟.md 是自动生成的可读摘要。',
          '角色卡/、设定/：从人物库和设定同步过来的只读快照（「⋯ → 同步人物卡 / 设定到记忆文件夹」）。',
        ],
      },
      {
        kind: 'p',
        text: '这些文件可以用 Git 管理和备份，也和命令行 ne growth 共用：在终端里或让 AI agent 用 ne growth 记录，回到应用就能看到。',
      },
    ],
  },
  {
    id: 'workflow',
    title: '推荐用法',
    blocks: [
      {
        kind: 'steps',
        items: [
          '开书时：创建记忆库（DND 模板或空白规则），为主角和重要配角建成长卡，按需调整经验曲线。',
          '每写完一章：花 30 秒给本章出场、有变化的角色「记一笔」。',
          '每写 10 章：看一眼总览页的提醒圆点，处理被遗忘的配角。',
          '遇到大抉择前：用 AI 推演对比几条路线，再落笔。',
        ],
      },
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
            q: '怎么改升级所需的经验？',
            a: '「⋯ → 编辑规则」，在「经验曲线」里修改每一级需要的经验并保存。已有角色的等级不会被自动改动，如果和新曲线不一致，提醒里会出现「等级与累计经验不一致」，可以用「直接调整等级」修正。',
          },
          {
            q: '记错了一笔怎么办？',
            a: '再记一笔反向的数值抵消，例如「获得经验 -300」，时间线会保留两条，便于以后追溯。也可以直接编辑「资料/记忆/角色/角色名.json」。',
          },
          {
            q: '删错了成长卡怎么办？',
            a: '删除会直接移除「资料/记忆/角色/」下的文件，无法在应用内撤销。如果项目用 Git 管理，可以从 Git 恢复该文件；否则只能重新建卡。',
          },
          {
            q: '多本书怎么用？',
            a: '每个作品文件夹都有自己的「资料/记忆/」，互不影响。想沿用同一套规则，把 规则.json 复制到另一本书的「资料/记忆/」即可。',
          },
          {
            q: '不在人物库里的角色能建卡吗？',
            a: '可以。在总览页点「新建成长卡」输入名字即可；人物库中的角色会自动带上别名。',
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
    target: 'list',
    title: '每个角色一张成长卡',
    text: '左侧「成长档案」列出所有建了卡的角色，点名字切换；标题旁的「?」随时打开使用说明。',
  },
  {
    target: 'record',
    title: '写完一章，记一笔',
    text: '选「获得经验 / 属性变化 / 技能 / 记事」，填一个数值，按 Enter。章节会自动填好。',
  },
  {
    target: 'warnings',
    title: '有问题才会提醒',
    text: '战力涨得太快、违背规则，或配角很久没出场时，这里会出现一条淡色提醒，点开看处理建议。',
  },
  {
    target: 'more',
    title: '更多功能在「⋯」里',
    text: 'AI 推演、队伍、地图和规则在顶部的「推演 · 世界」；同步人物卡、编辑规则、删除成长卡在「⋯」菜单。',
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
  const sections = GROWTH_GUIDE_SECTIONS.map(
    (section) => `## ${section.title}\n\n${section.blocks.map(renderBlock).join('\n\n')}`
  );
  return `${[header, ...sections].join('\n\n')}\n`;
}
