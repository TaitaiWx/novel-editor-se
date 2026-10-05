import React from 'react';
import styles from '../../styles.module.scss';
import type {
  Character,
  CharacterCamp,
  CharacterCategory,
  CharacterCurrentStateItem,
  CharacterRelation,
  CharacterTimelineItem,
} from '../../types';
import { CHARACTER_CATEGORY_LABELS, DEFAULT_CHARACTER_HIGHLIGHT_COLOR } from '../../utils';
import { CharacterCurrentStateSection } from '../CharacterCurrentStateSection';
import { CharacterTimelineSection } from '../CharacterTimelineSection';
import type { CharacterCurrentStateController } from '../useCharacterCurrentState';
import type { CharacterTimelineController } from '../useCharacterTimeline';

interface CharacterDetailWorkspaceProps {
  focusedCharacter: Character | null;
  focusedCamp: CharacterCamp | null;
  focusedHeat: number;
  focusedTimeline: CharacterTimelineItem[];
  focusedTimelineEditedCount: number;
  selectedRelations: CharacterRelation[];
  characters: Character[];
  novelCorpusFileCount: number;
  novelCorpusLoading: boolean;
  novelCorpusError: string;
  timeline: CharacterTimelineController;
  currentState: CharacterCurrentStateController;
  handleUpdateCharacterAttributes: (
    characterId: number,
    patch: {
      category?: CharacterCategory;
      highlightColor?: string;
      highlightFirstMentionOnly?: boolean;
      currentState?: CharacterCurrentStateItem[];
    }
  ) => Promise<void>;
  graphView: React.ReactNode;
}

/**
 * 人物详情模式：单个人物的资料、当前状态、经历时间线、高亮配置与关系网络。
 */
export const CharacterDetailWorkspace: React.FC<CharacterDetailWorkspaceProps> = ({
  focusedCharacter,
  focusedCamp,
  focusedHeat,
  focusedTimeline,
  focusedTimelineEditedCount,
  selectedRelations,
  characters,
  novelCorpusFileCount,
  novelCorpusLoading,
  novelCorpusError,
  timeline,
  currentState,
  handleUpdateCharacterAttributes,
  graphView,
}) => {
  return (
    <div className={styles.objectWorkspace}>
      {focusedCharacter ? (
        <>
          <section className={styles.workspaceHero}>
            <div className={styles.workspaceEyebrow}>人物资料</div>
            <h2 className={styles.workspaceTitle}>{focusedCharacter.name}</h2>
            <p className={styles.workspaceDesc}>
              {focusedTimeline.length > 0
                ? `已从整个作品目录中按章节整理出 ${focusedTimeline.length} 段关键经历，覆盖前期到后期的主要推进。`
                : focusedCharacter.description || '这个人物还没有补充详细描述。'}
            </p>
            <div className={styles.workspaceMetaRow}>
              <span className={styles.workspaceChip}>
                分类 {CHARACTER_CATEGORY_LABELS[focusedCharacter.category]}
              </span>
              <span className={styles.workspaceChip}>
                角色定位 {focusedCharacter.role || '未填写'}
              </span>
              <span className={styles.workspaceChip}>阵营 {focusedCamp || 'support'}</span>
              <span className={styles.workspaceChip}>正文热度 {focusedHeat}</span>
              <span className={styles.workspaceChip}>关系 {selectedRelations.length}</span>
              <span className={styles.workspaceChip}>经历节点 {focusedTimeline.length}</span>
              <span className={styles.workspaceChip}>手工修订 {focusedTimelineEditedCount}</span>
              <span className={styles.workspaceChip}>作品正文 {novelCorpusFileCount}</span>
            </div>
          </section>

          <CharacterCurrentStateSection
            focusedCharacter={focusedCharacter}
            controller={currentState}
          />

          <CharacterTimelineSection
            focusedTimeline={focusedTimeline}
            novelCorpusLoading={novelCorpusLoading}
            novelCorpusError={novelCorpusError}
            controller={timeline}
          />

          {focusedCharacter.description && (
            <section className={styles.workspaceCardShell}>
              <div className={styles.workspaceCardHeader}>
                <span className={styles.workspaceSectionTitle}>资料摘要</span>
                <span className={styles.workspaceListHint}>
                  保留资料库中的原始描述，便于后续手工修订
                </span>
              </div>
              <div className={styles.workspaceBodyCopy}>{focusedCharacter.description}</div>
            </section>
          )}

          <section className={styles.workspaceCardShell}>
            <div className={styles.workspaceCardHeader}>
              <span className={styles.workspaceSectionTitle}>正文高亮</span>
              <span className={styles.workspaceListHint}>控制角色名在正文中的强调方式</span>
            </div>
            <div className={styles.highlightConfigPanel}>
              <label className={styles.categoryField}>
                <span className={styles.highlightFieldLabel}>人物分类</span>
                <select
                  value={focusedCharacter.category}
                  onChange={(event) =>
                    void handleUpdateCharacterAttributes(focusedCharacter.id, {
                      category: event.target.value as CharacterCategory,
                    })
                  }
                  className={styles.formInput}
                >
                  <option value="major">主要角色</option>
                  <option value="secondary">次要角色</option>
                </select>
              </label>
              <label className={styles.highlightColorField}>
                <span className={styles.highlightFieldLabel}>高亮颜色</span>
                <div className={styles.highlightColorControl}>
                  <input
                    type="color"
                    value={focusedCharacter.highlightColor || DEFAULT_CHARACTER_HIGHLIGHT_COLOR}
                    onChange={(event) =>
                      void handleUpdateCharacterAttributes(focusedCharacter.id, {
                        highlightColor: event.target.value,
                      })
                    }
                    className={styles.colorInput}
                  />
                  <span className={styles.highlightColorValue}>
                    {(
                      focusedCharacter.highlightColor || DEFAULT_CHARACTER_HIGHLIGHT_COLOR
                    ).toUpperCase()}
                  </span>
                </div>
              </label>
              <label className={styles.highlightToggle}>
                <input
                  type="checkbox"
                  checked={focusedCharacter.highlightFirstMentionOnly !== false}
                  onChange={(event) =>
                    void handleUpdateCharacterAttributes(focusedCharacter.id, {
                      highlightFirstMentionOnly: event.target.checked,
                    })
                  }
                />
                <span>仅在每章第一次出现时高亮</span>
              </label>
            </div>
          </section>

          <section className={styles.workspaceCardShell}>
            <div className={styles.workspaceCardHeader}>
              <span className={styles.workspaceSectionTitle}>人物关系</span>
              <span className={styles.workspaceListHint}>围绕当前人物的出场关系</span>
            </div>
            {selectedRelations.length > 0 ? (
              <div className={styles.workspaceList}>
                {selectedRelations.map((relation) => {
                  const otherId =
                    relation.sourceId === focusedCharacter.id
                      ? relation.targetId
                      : relation.sourceId;
                  const otherCharacter = characters.find((item) => item.id === otherId);
                  return (
                    <div key={relation.id} className={styles.workspaceListItem}>
                      <div className={styles.workspaceListTitle}>
                        {otherCharacter?.name || '未匹配人物'}
                      </div>
                      <div className={styles.workspaceListDesc}>
                        {relation.label}
                        {relation.note ? ` · ${relation.note}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyHint}>这个人物还没有整理关系。</div>
            )}
          </section>

          <section className={styles.workspaceCardShell}>
            <div className={styles.workspaceCardHeader}>
              <span className={styles.workspaceSectionTitle}>人物网络</span>
              <span className={styles.workspaceListHint}>保留当前人物的关系编辑能力</span>
            </div>
            {graphView}
          </section>
        </>
      ) : (
        <div className={styles.emptyHint}>没有找到对应人物，可能已经被删除。</div>
      )}
    </div>
  );
};
