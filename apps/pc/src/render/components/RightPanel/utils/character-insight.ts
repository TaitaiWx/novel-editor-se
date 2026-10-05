import type { Character, CharacterCamp, CharacterLink, CharacterRelation } from '../types';
import { ROLE_COLORS } from '../constants';

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function estimateAppearanceHeat(content: string, name: string): number {
  if (!name.trim()) return 0;
  const reg = new RegExp(escapeRegex(name.trim()), 'g');
  const matches = content.match(reg);
  return matches ? matches.length : 0;
}

export function inferCharacterCamp(
  character: Character,
  relations: CharacterRelation[]
): CharacterCamp {
  const role = character.role.toLowerCase();
  if (/主角|主人公|男主|女主/.test(role)) return 'protagonist';
  if (/反派|对立|宿敌|敌/.test(role)) return 'antagonist';
  const hostile = relations.filter(
    (item) =>
      (item.sourceId === character.id || item.targetId === character.id) && item.tone === 'rival'
  ).length;
  const allied = relations.filter(
    (item) =>
      (item.sourceId === character.id || item.targetId === character.id) && item.tone !== 'rival'
  ).length;
  if (hostile > allied + 1) return 'antagonist';
  if (allied >= hostile) return 'protagonist';
  return 'support';
}

export function inferRelationStage(note: string): string {
  const text = note.trim();
  if (!text) return '未标注阶段';
  if (/(前期|初识|开端|早期)/.test(text)) return '前期';
  if (/(中期|升级|加深|矛盾)/.test(text)) return '中期';
  if (/(后期|决裂|和解|终局|结局)/.test(text)) return '后期';
  return '阶段未定义';
}

export function buildCharacterLinks(characters: Character[]): CharacterLink[] {
  if (characters.length < 2) return [];
  return characters.slice(0, Math.min(characters.length - 1, 5)).map((character, index) => ({
    sourceId: character.id,
    targetId: characters[index + 1].id,
    label: character.role && characters[index + 1].role ? '角色关联' : '待定义',
  }));
}

export function getRoleColor(role: string): string {
  if (ROLE_COLORS[role]) return ROLE_COLORS[role];
  for (const key of Object.keys(ROLE_COLORS)) {
    if (role.includes(key)) return ROLE_COLORS[key];
  }
  return '#b5cea8';
}
