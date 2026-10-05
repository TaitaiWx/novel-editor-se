import React from 'react';
import styles from '../../styles.module.scss';
import type { Character, CharacterCategory } from '../../types';
import { CHARACTER_CATEGORY_LABELS, inferCharacterCategoryFromRole } from '../../utils';
import { CharacterCard } from '../../CharacterCard';
import type { CharacterCategoryFilter } from '../helpers';
import type { CharacterListEditor } from '../useCharacterListEditor';

interface CharacterListPanelProps {
  characters: Character[];
  linksCount: number;
  aiGenerating: boolean;
  aiStatus: string;
  onGenerateCharacterGraph: () => void;
  onDelete: (index: number) => void;
  editor: CharacterListEditor;
}

/**
 * 人物列表面板：总览、筛选、批量分类、新增表单与按分类分组的人物卡片。
 */
export const CharacterListPanel: React.FC<CharacterListPanelProps> = ({
  characters,
  linksCount,
  aiGenerating,
  aiStatus,
  onGenerateCharacterGraph,
  onDelete,
  editor,
}) => {
  const {
    adding,
    toggleAdding,
    newName,
    setNewName,
    newRole,
    setNewRole,
    newCategory,
    setNewCategory,
    newDesc,
    setNewDesc,
    newAvatar,
    newHighlightColor,
    setNewHighlightColor,
    newHighlightFirstMentionOnly,
    setNewHighlightFirstMentionOnly,
    avatarInputRef,
    handleAvatarSelect,
    handleAdd,
    handleKeyDown,
    dragIndex,
    dropIndex,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    categoryFilter,
    setCategoryFilter,
    characterSearch,
    setCharacterSearch,
    bulkUpdatingCategory,
    filteredCharacters,
    categorizedCharacterEntries,
    handleBulkApplyCategory,
  } = editor;

  return (
    <div className={styles.charactersList}>
      <div className={styles.sectionHeader}>
        <span>角色列表</span>
        <div className={styles.actionGroup}>
          <button
            className={styles.addButton}
            onClick={onGenerateCharacterGraph}
            disabled={aiGenerating}
          >
            {aiGenerating ? 'AI 生成中...' : 'AI 生成人物图'}
          </button>
          <button className={styles.addButton} onClick={toggleAdding}>
            {adding ? '取消' : '+ 添加'}
          </button>
        </div>
      </div>
      <div className={styles.characterHeroCard}>
        <div className={styles.characterHeroTitle}>人物总览</div>
        <div className={styles.characterHeroDesc}>
          人物会自动按阵营与出场热度分组，关系变化也会形成阶段对照。
        </div>
        <div className={styles.metricRow}>
          <span className={styles.metricChip}>人物 {characters.length}</span>
          <span className={styles.metricChip}>筛选结果 {filteredCharacters.length}</span>
          <span className={styles.metricChip}>关系 {linksCount}</span>
        </div>
        <div className={styles.characterHeroStatus}>
          {aiStatus || '可以从正文直接抽取角色与关系'}
        </div>
      </div>
      <div className={styles.characterToolbar}>
        <input
          value={characterSearch}
          onChange={(event) => setCharacterSearch(event.target.value)}
          placeholder="快速筛选人物、定位、描述或别名"
          className={styles.formInput}
        />
        <div className={styles.filterChipRow}>
          {(
            [
              ['all', '全部'],
              ['major', '主要角色'],
              ['secondary', '次要角色'],
            ] as Array<[CharacterCategoryFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`${styles.filterChip} ${categoryFilter === value ? styles.filterChipActive : ''}`}
              onClick={() => setCategoryFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.bulkActionRow}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={filteredCharacters.length === 0 || bulkUpdatingCategory !== null}
            onClick={() => void handleBulkApplyCategory('major')}
          >
            {bulkUpdatingCategory === 'major' ? '批量处理中...' : '批量设为主要角色'}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={filteredCharacters.length === 0 || bulkUpdatingCategory !== null}
            onClick={() => void handleBulkApplyCategory('secondary')}
          >
            {bulkUpdatingCategory === 'secondary' ? '批量处理中...' : '批量设为次要角色'}
          </button>
        </div>
      </div>
      {adding && (
        <div className={styles.addForm}>
          <div className={styles.avatarPickerRow}>
            <div
              className={styles.avatarPicker}
              onClick={() => avatarInputRef.current?.click()}
              title="点击选择角色图片"
            >
              {newAvatar ? (
                <img src={newAvatar} alt="avatar" className={styles.avatarPreview} />
              ) : (
                <span className={styles.avatarPlaceholder}>+</span>
              )}
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarSelect}
              style={{ display: 'none' }}
            />
            <span className={styles.avatarHint}>角色头像</span>
          </div>
          <input
            placeholder="角色名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            className={styles.formInput}
            autoFocus
          />
          <input
            placeholder="角色定位 (主角/配角/反派...)"
            value={newRole}
            onChange={(e) => {
              const nextRole = e.target.value;
              setNewRole(nextRole);
              setNewCategory(inferCharacterCategoryFromRole(nextRole));
            }}
            onKeyDown={handleKeyDown}
            className={styles.formInput}
          />
          <label className={styles.categoryField}>
            <span className={styles.highlightFieldLabel}>人物分类</span>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as CharacterCategory)}
              className={styles.formInput}
            >
              <option value="major">主要角色</option>
              <option value="secondary">次要角色</option>
            </select>
          </label>
          <textarea
            placeholder="角色描述、设定..."
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className={styles.formTextarea}
            rows={3}
          />
          <div className={styles.highlightConfigRow}>
            <label className={styles.highlightColorField}>
              <span className={styles.highlightFieldLabel}>正文高亮颜色</span>
              <input
                type="color"
                value={newHighlightColor}
                onChange={(e) => setNewHighlightColor(e.target.value)}
                className={styles.colorInput}
              />
            </label>
            <label className={styles.highlightToggle}>
              <input
                type="checkbox"
                checked={newHighlightFirstMentionOnly}
                onChange={(e) => setNewHighlightFirstMentionOnly(e.target.checked)}
              />
              <span>仅在每章第一次出现时高亮</span>
            </label>
          </div>
          <button className={styles.submitButton} onClick={handleAdd}>
            确认添加
          </button>
        </div>
      )}
      {characters.length === 0 && !adding && (
        <div className={styles.emptyHint}>
          暂无角色
          <br />
          <span className={styles.hintSub}>可以手动创建，也可以直接让 AI 从正文生成图谱</span>
        </div>
      )}
      {characters.length > 0 && filteredCharacters.length === 0 && !adding && (
        <div className={styles.emptyHint}>
          当前筛选条件下没有角色
          <br />
          <span className={styles.hintSub}>可以切换分类筛选，或清空搜索关键词</span>
        </div>
      )}
      <div className={styles.cardsContainer}>
        {(Object.keys(categorizedCharacterEntries) as CharacterCategory[]).map((category) => {
          const entries = categorizedCharacterEntries[category];
          if (entries.length === 0) return null;
          return (
            <div key={category} className={styles.characterCategoryGroup}>
              <div className={styles.characterCategoryHeader}>
                <span>{CHARACTER_CATEGORY_LABELS[category]}</span>
                <span className={styles.metricChip}>{entries.length}</span>
              </div>
              {entries.map(({ character, index }) => (
                <CharacterCard
                  key={character.id}
                  character={character}
                  index={index}
                  dragIndex={dragIndex}
                  dropIndex={dropIndex}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDelete={onDelete}
                />
              ))}
            </div>
          );
        })}
        {dropIndex !== null && dragIndex !== null && dropIndex >= characters.length && (
          <div className={styles.dropIndicator} />
        )}
      </div>
    </div>
  );
};
