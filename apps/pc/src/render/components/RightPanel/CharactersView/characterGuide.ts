/**
 * 角色使用说明：文件面板「角色」分区「?」打开的抽屉与 docs/character-guide.md 的唯一来源。
 * 覆盖人物详情的全部分页与正文里的人物卡片；
 * 成长档案只给一句话概览，完整说明见 growthGuide.ts（抽屉底部可以切换过去）。
 * 修改后用 renderCharacterGuideMarkdown() 重新生成 docs/character-guide.md（单测校验一致）。
 */
import { renderGuideMarkdown, type GuideContent } from '../../../utils/guideContent';

export type CharacterGuideSectionId =
  | 'design'
  | 'gallery'
  | 'growth'
  | 'environment'
  | 'social'
  | 'power'
  | 'plot'
  | 'settings'
  | 'editor'
  | 'faq';

export const CHARACTER_GUIDE: GuideContent<CharacterGuideSectionId> = {
  anchorPrefix: 'character-guide',
  title: '角色使用说明',
  summary:
    '每个人物一张卡：分别整理人物特质、背景、社会关系、能力资源、剧情发展、成长档案与图集，为 AI 续写、出图和场景视频提供资料。',
  quickStart: [
    '点「角色」右侧的 + 新建人物，单击人物打开详情。',
    '在「人物」写几句外貌、服装和性格，离开输入框即保存。',
    '在「人物图集」上传或生成形象图，悬停卡片里会显示头像。',
  ],
  sections: [
    {
      id: 'design',
      title: '人物与声音',
      blocks: [
        {
          kind: 'p',
          text: '外貌、服装、性格、说话方式，手动修改后离开输入框即保存；AI 生成的资料先作为草稿查看，再点击本页保存或取消。「声音」（性别、年龄、音色）用于场景视频配音。',
        },
        { kind: 'example', text: '林舟：十七岁，黑发束髻，左臂缠着绷带；话少，认准的事不回头。' },
      ],
    },
    {
      id: 'gallery',
      title: '人物图集与形象图',
      blocks: [
        {
          kind: 'p',
          text: '本地上传（可直接拖进来）或「AI 生成」，右键设为「主要形象图」或「三视图」。形象图会裁成小圆头像，出现在角色列表、悬停卡片和场景视频里；再次生成时自动带上已有形象图，保持同一张脸。',
        },
        { kind: 'example', text: '给林舟准备一张三视图，生成场景视频时人物不容易变样。' },
      ],
    },
    {
      id: 'growth',
      title: '成长档案',
      blocks: [
        {
          kind: 'p',
          text: '等级、经验、技能和二选一 / 三选一的抉择，写完一章「记一笔」，战力涨太快或配角太久没出场时会提醒。完整说明点下方「成长档案说明」。',
        },
        { kind: 'example', text: '林舟击败狼王，记「获得经验 300」，卡片立刻变成 Lv.2。' },
      ],
    },
    {
      id: 'plot',
      title: '剧情发展与经历',
      blocks: [
        {
          kind: 'p',
          text: '整理人物的目标、心理与剧情变化，按条目记录状态和关联章节；「当前状态」记修为、伤势等近况，悬停卡片显示最近两条；「经历」按章节记录改变人物的事件。',
        },
        { kind: 'example', text: '林舟 · 伤势：左臂旧伤未愈；第 3 章 · 离开小镇。' },
      ],
    },
    {
      id: 'social',
      title: '社会关系',
      blocks: [
        {
          kind: 'p',
          text: '图谱用圆头像展示人物，悬停突出相关连线，拖动调整位置，双击查看人物属性；右键选择「从此人物建立关系」再点另一人物，选择关系类型并填写说明；点击已有连线编辑，同一对人物共用一条关系。',
        },
        {
          kind: 'example',
          text: '林舟与苏晴：类型选「盟友」，说明写「一路同行」；林舟与秦伯：类型选「师承」。',
        },
      ],
    },
    {
      id: 'environment',
      title: '背景与身份',
      blocks: [
        {
          kind: 'p',
          text: '整理身世、生活环境和身份条目，记录身份在故事中的变化；背景文字手动修改后离开输入框即保存，AI 草稿需确认保存，让人物的行动有来处。',
        },
        { kind: 'example', text: '林舟出身青石镇，曾是药铺学徒，入门后成为青云门弟子。' },
      ],
    },
    {
      id: 'power',
      title: '能力与资源',
      blocks: [
        {
          kind: 'p',
          text: '把能力与资源分别建成条目，记录当前状态、变化历史和关联章节；需要等级、经验等数值时进入成长档案。',
        },
        {
          kind: 'example',
          text: '林舟第 3 章学会御风步，第 8 章丢失青纹剑，分别记在能力与资源条目里。',
        },
      ],
    },
    {
      id: 'settings',
      title: '设置与正文高亮',
      blocks: [
        {
          kind: 'p',
          text: '选择主要、次要角色或自定义分组，设置正文里人物名字的高亮颜色，也可以只在每章第一次出现时高亮。',
        },
        { kind: 'example', text: '林舟归入主要角色，名字用柔和绿色标记，每章只高亮第一次出场。' },
      ],
    },
    {
      id: 'editor',
      title: '正文里的人物',
      blocks: [
        {
          kind: 'p',
          text: '鼠标停在人物名或别名上会弹出人物卡片（等级、近况、上次出场），⌘K / Ctrl+K 打开光标处的人物；卡片上可以「记一笔」或「高亮全部」。',
        },
        { kind: 'example', text: '写到「阿舟」时悬停，就能看到林舟上次在第 2 章出场。' },
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
              q: '「只有成长档案」里是什么？',
              a: '建了成长卡、还没有人物卡的角色。新建同名（或别名相同）的人物后会自动合在一起。',
            },
            {
              q: '数据存在哪里？',
              a: '人物卡存在项目数据库，按作品区分；图片在「<作品>/资料/图集/人物/」，成长档案在「<作品>/资料/记忆/」，都可以用 Git 备份。',
            },
            {
              q: '人物太多怎么找？',
              a: '用文件面板顶部的搜索，或点「角色」右侧的人物总览，一屏看全部人物的形象、成长与关系。',
            },
          ],
        },
      ],
    },
  ],
};

/** 生成 docs/character-guide.md 的完整内容 */
export function renderCharacterGuideMarkdown(): string {
  return renderGuideMarkdown(
    CHARACTER_GUIDE,
    'apps/pc/src/render/components/RightPanel/CharactersView/characterGuide.ts'
  );
}
