/**
 * 角色卡、设定与资料卡的 Markdown 导出
 */
import { settingsOps } from '@novel-editor/store';
import { isPathInWorkspace } from './workspace-path';

export type KnowledgeTextExportOptions = {
  includeCharacters?: boolean;
  includeLore?: boolean;
  includeMaterials?: boolean;
};

type AssistantScopedMaterialExport = {
  title?: string;
  summary?: string;
  kind?: string;
  relatedChapter?: string;
};

type CharacterAttributesPayload = {
  aliases?: string[];
  category?: 'major' | 'secondary';
};

function parseCharacterAliases(attributesRaw?: string): string[] {
  if (!attributesRaw) return [];
  try {
    const parsed = JSON.parse(attributesRaw) as CharacterAttributesPayload;
    if (!Array.isArray(parsed.aliases)) return [];
    return parsed.aliases
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseCharacterCategory(attributesRaw?: string, role = ''): 'major' | 'secondary' {
  const fallback = /主角|主人公|男主|女主|核心|主线/.test(role.trim()) ? 'major' : 'secondary';
  if (!attributesRaw) return fallback;
  try {
    const parsed = JSON.parse(attributesRaw) as CharacterAttributesPayload;
    return parsed.category === 'major' || parsed.category === 'secondary'
      ? parsed.category
      : fallback;
  } catch {
    return fallback;
  }
}
export function formatKnowledgeExportMarkdown(payload: {
  projectName: string;
  folderPath: string;
  characters: Array<{
    name: string;
    role: string;
    description: string;
    attributes?: string;
  }>;
  loreEntries: Array<{
    category: string;
    title: string;
    content: string;
    tags: string;
  }>;
  materials: Array<{
    scopeKind: 'project' | 'volume' | 'chapter';
    scopePath: string;
    title: string;
    summary: string;
    kind: string;
    relatedChapter: string;
  }>;
  options: Required<KnowledgeTextExportOptions>;
}): string {
  const lines: string[] = [];
  lines.push(`# ${payload.projectName} - 创作资料导出`);
  lines.push('');
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`项目目录：${payload.folderPath}`);
  lines.push('');
  const selectedSections: string[] = [];
  if (payload.options.includeCharacters) selectedSections.push('角色卡');
  if (payload.options.includeLore) selectedSections.push('设定资料');
  if (payload.options.includeMaterials) selectedSections.push('资料卡');
  lines.push(`导出范围：${selectedSections.join(' / ')}`);
  lines.push('');

  if (payload.options.includeCharacters) {
    lines.push('## 角色卡');
    lines.push('');

    if (payload.characters.length === 0) {
      lines.push('（暂无角色）');
    } else {
      const orderedCharacters = [...payload.characters].sort((left, right) => {
        const leftCategory = parseCharacterCategory(left.attributes, left.role);
        const rightCategory = parseCharacterCategory(right.attributes, right.role);
        if (leftCategory !== rightCategory) {
          return leftCategory === 'major' ? -1 : 1;
        }
        return left.name.localeCompare(right.name, 'zh-CN');
      });
      orderedCharacters.forEach((character, index) => {
        const aliases = parseCharacterAliases(character.attributes);
        const categoryLabel =
          parseCharacterCategory(character.attributes, character.role) === 'major'
            ? '主要角色'
            : '次要角色';
        lines.push(`### ${index + 1}. ${character.name || '未命名角色'}`);
        lines.push(`- 分类：${categoryLabel}`);
        lines.push(`- 定位：${character.role || '未填写'}`);
        lines.push(`- 描述：${character.description || '未填写'}`);
        lines.push(`- 别名：${aliases.length > 0 ? aliases.join('、') : '无'}`);
        lines.push('');
      });
    }
  }

  if (payload.options.includeLore) {
    lines.push('## 设定资料');
    lines.push('');

    if (payload.loreEntries.length === 0) {
      lines.push('（暂无设定）');
    } else {
      payload.loreEntries.forEach((entry, index) => {
        const parsedTags = (() => {
          try {
            const tags = JSON.parse(entry.tags || '[]') as unknown;
            if (!Array.isArray(tags)) return [];
            return tags
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter(Boolean);
          } catch {
            return [];
          }
        })();

        lines.push(`### ${index + 1}. ${entry.title || '未命名设定'}`);
        lines.push(`- 分类：${entry.category || 'world'}`);
        lines.push(`- 标签：${parsedTags.length > 0 ? parsedTags.join('、') : '无'}`);
        lines.push(`- 内容：${entry.content || '未填写'}`);
        lines.push('');
      });
    }
  }

  if (payload.options.includeMaterials) {
    lines.push('## 资料卡');
    lines.push('');

    if (payload.materials.length === 0) {
      lines.push('（暂无资料）');
    } else {
      payload.materials.forEach((item, index) => {
        const scopeText =
          item.scopeKind === 'chapter' ? '章节' : item.scopeKind === 'volume' ? '卷' : '项目';
        lines.push(`### ${index + 1}. ${item.title || '未命名资料'}`);
        lines.push(`- 类型：${item.kind || 'reference'}`);
        lines.push(`- 作用域：${scopeText}`);
        lines.push(`- 来源路径：${item.scopePath || '未知'}`);
        lines.push(`- 关联章节：${item.relatedChapter || '未填写'}`);
        lines.push(`- 内容：${item.summary || '未填写'}`);
        lines.push('');
      });
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

export function normalizeKnowledgeExportOptions(
  options?: KnowledgeTextExportOptions
): Required<KnowledgeTextExportOptions> {
  const normalized = {
    includeCharacters: options?.includeCharacters !== false,
    includeLore: options?.includeLore !== false,
    includeMaterials: options?.includeMaterials !== false,
  };

  if (!normalized.includeCharacters && !normalized.includeLore && !normalized.includeMaterials) {
    throw new Error('请至少选择一种导出内容（角色/设定/资料）');
  }

  return normalized;
}

export function collectScopedMaterialsByFolder(folderPath: string) {
  const MATERIAL_ARTIFACT_PREFIX = 'novel-editor:assistant-artifact:materials:';
  const allSettings = settingsOps.getAll() as Array<{ key: string; value: string }>;
  const materials: Array<{
    scopeKind: 'project' | 'volume' | 'chapter';
    scopePath: string;
    title: string;
    summary: string;
    kind: string;
    relatedChapter: string;
  }> = [];

  for (const row of allSettings) {
    if (!row?.key?.startsWith(MATERIAL_ARTIFACT_PREFIX)) continue;
    const rest = row.key.slice(MATERIAL_ARTIFACT_PREFIX.length);
    const firstColonIndex = rest.indexOf(':');
    if (firstColonIndex <= 0) continue;
    const scopeKind = rest.slice(0, firstColonIndex) as 'project' | 'volume' | 'chapter';
    if (scopeKind !== 'project' && scopeKind !== 'volume' && scopeKind !== 'chapter') continue;
    const scopePath = rest.slice(firstColonIndex + 1);
    if (!scopePath || !isPathInWorkspace(scopePath, folderPath)) continue;

    let parsed: AssistantScopedMaterialExport[] = [];
    try {
      const candidate = JSON.parse(row.value) as unknown;
      parsed = Array.isArray(candidate) ? (candidate as AssistantScopedMaterialExport[]) : [];
    } catch {
      parsed = [];
    }

    parsed.forEach((item) => {
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      if (!title) return;
      materials.push({
        scopeKind,
        scopePath,
        title,
        summary: typeof item?.summary === 'string' ? item.summary.trim() : '',
        kind: typeof item?.kind === 'string' ? item.kind.trim() || 'reference' : 'reference',
        relatedChapter: typeof item?.relatedChapter === 'string' ? item.relatedChapter.trim() : '',
      });
    });
  }

  return materials;
}
