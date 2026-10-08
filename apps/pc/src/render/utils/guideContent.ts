/**
 * 应用内「使用说明」抽屉的内容结构（成长档案、角色共用），以及导出为 docs/*.md 的渲染。
 * 抽屉组件在 RightPanel/GrowthView/GrowthHelp；内容各自放在对应功能目录。
 */

export type GuideBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'example'; text: string }
  | { kind: 'faq'; items: Array<{ q: string; a: string }> };

export interface GuideSection<Id extends string = string> {
  id: Id;
  title: string;
  blocks: GuideBlock[];
}

export interface GuideContent<Id extends string = string> {
  /** 章节锚点前缀：`<anchorPrefix>-<章节 id>` */
  anchorPrefix: string;
  title: string;
  summary: string;
  /** 默认展开的「3 步上手」 */
  quickStart: string[];
  /** 进阶说明（默认折叠） */
  sections: GuideSection<Id>[];
}

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

/** 渲染为 Markdown；sourcePath 写进文件头注释，提示修改源文件后重新生成 */
export function renderGuideMarkdown(guide: GuideContent, sourcePath: string): string {
  const header = [
    `# ${guide.title}`,
    '',
    `<!-- 由 ${sourcePath} 生成，请修改源文件后同步 -->`,
    '',
    guide.summary,
  ].join('\n');
  const quickStart = `## 3 步上手\n\n${guide.quickStart
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n')}`;
  const sections = guide.sections.map(
    (section) => `## ${section.title}\n\n${section.blocks.map(renderBlock).join('\n\n')}`
  );
  return `${[header, quickStart, ...sections].join('\n\n')}\n`;
}
