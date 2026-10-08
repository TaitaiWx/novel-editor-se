/**
 * 角色使用说明：文件面板「角色」分区「?」打开的抽屉与 docs/character-guide.md 的唯一来源。
 * 覆盖人物详情的全部分页（人物设计 / 图集 / 成长档案 / 经历与状态 / 关系与高亮）与正文里的人物卡片；
 * 成长档案只给一句话概览，完整说明见 growthGuide.ts（抽屉底部可以切换过去）。
 * 修改后用 renderCharacterGuideMarkdown() 重新生成 docs/character-guide.md（单测校验一致）。
 */
import { renderGuideMarkdown, type GuideContent } from '../../../utils/guideContent';

export type CharacterGuideSectionId =
  | 'design'
  | 'gallery'
  | 'growth'
  | 'story'
  | 'relations'
  | 'editor'
  | 'faq';

export const CHARACTER_GUIDE: GuideContent<CharacterGuideSectionId> = {
  anchorPrefix: 'character-guide',
  title: '角色使用说明',
  summary:
    '每个人物一张卡：人物设计、图集、成长档案、经历与关系都在这里。AI 续写、出图和场景视频都会读取，几百章后人物也不会「崩」。',
  quickStart: [
    '点「角色」右侧的 + 新建人物，单击人物打开详情。',
    '在「人物设计」写几句外貌、服装和性格。',
    '在「图集」上传或生成形象图，悬停卡片里会显示头像。',
  ],
  sections: [
    {
      id: 'design',
      title: '人物设计与声音',
      blocks: [
        {
          kind: 'p',
          text: '外貌、服装、性格、背景、说话方式，写几句就够，离开输入框即保存。AI 出图只读外貌与服装，续写和场景视频读取全部；「声音」（性别、年龄、音色）用于场景视频配音。',
        },
        { kind: 'example', text: '林舟：十七岁，黑发束髻，左臂缠着绷带；话少，认准的事不回头。' },
      ],
    },
    {
      id: 'gallery',
      title: '图集与形象图',
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
      id: 'story',
      title: '经历与状态',
      blocks: [
        {
          kind: 'p',
          text: '「当前状态」记标签 + 内容（修为、伤势、当前危机），悬停卡片显示最近两条；「经历」按章节记下真正改变人物的事件。',
        },
        { kind: 'example', text: '林舟 · 伤势：左臂旧伤未愈；第 3 章 · 离开小镇。' },
      ],
    },
    {
      id: 'relations',
      title: '关系与高亮',
      blocks: [
        {
          kind: 'p',
          text: '设置人物分类（主要 / 次要角色）和正文里名字的高亮颜色，可只在每章第一次出现时高亮；下方整理人物之间的关系。',
        },
        { kind: 'example', text: '林舟与苏晴：同伴；林舟与秦伯：师徒。' },
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
