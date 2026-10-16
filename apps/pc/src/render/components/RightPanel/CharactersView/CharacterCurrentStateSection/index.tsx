import UiButton from '@novel-editor/ui/Button';
import UiInput from '@novel-editor/ui/Input';
import UiTextArea from '@novel-editor/ui/TextArea';
import React from 'react';
import sharedStyles from '../../styles.module.scss';
import styles from './styles.module.scss';
import type { Character } from '../../types';
import type { CharacterCurrentStateController } from '../useCharacterCurrentState';

/**
 * 人物当前状态卡片：展示 / 编辑人物当前已确认状态。
 */
export const CharacterCurrentStateSection: React.FC<{
  focusedCharacter: Character;
  controller: CharacterCurrentStateController;
}> = ({ focusedCharacter, controller }) => {
  const {
    currentStateEditing,
    currentStateDraftItems,
    currentStateSaving,
    displayCurrentStateItems,
    handleStartEditCurrentState,
    handleCancelEditCurrentState,
    handleCurrentStateDraftChange,
    handleAddCurrentStateItem,
    handleRemoveCurrentStateItem,
    handleSaveCurrentState,
  } = controller;

  return (
    <section className={sharedStyles.workspaceCardShell}>
      <div className={sharedStyles.workspaceCardHeader}>
        <span className={sharedStyles.workspaceSectionTitle}>当前状态</span>
        <div className={sharedStyles.characterTimelineHeaderActions}>
          <span className={sharedStyles.workspaceListHint}>
            {focusedCharacter.currentState.length > 0
              ? '这里保存的是人物当前已确认状态，直接来自角色根数据。'
              : '当前根据最近章节自动汇总，确认后可保存为人物当前状态。'}
          </span>
          {currentStateEditing ? (
            <>
              <UiButton
                unstyled
                type="button"
                className={sharedStyles.submitButton}
                disabled={currentStateSaving}
                onClick={() => void handleSaveCurrentState()}
              >
                {currentStateSaving ? '保存中...' : '保存当前状态'}
              </UiButton>
              <UiButton
                unstyled
                type="button"
                className={sharedStyles.secondaryButton}
                onClick={handleCancelEditCurrentState}
              >
                取消
              </UiButton>
            </>
          ) : (
            <UiButton
              unstyled
              type="button"
              className={sharedStyles.secondaryButton}
              onClick={handleStartEditCurrentState}
            >
              编辑当前状态
            </UiButton>
          )}
        </div>
      </div>
      {currentStateEditing ? (
        <div className={styles.characterCurrentStateEditor}>
          {currentStateDraftItems.map((item) => (
            <div key={item.id} className={styles.characterCurrentStateEditorRow}>
              <UiInput
                unstyled
                value={item.label}
                onChange={(event) =>
                  handleCurrentStateDraftChange(item.id, 'label', event.target.value)
                }
                placeholder="状态标签，例如：修为 / 当前危机"
                className={sharedStyles.formInput}
              />
              <UiTextArea
                unstyled
                value={item.value}
                onChange={(event) =>
                  handleCurrentStateDraftChange(item.id, 'value', event.target.value)
                }
                placeholder="状态内容，例如：练气后期 / 黄家逼迫"
                className={sharedStyles.formTextarea}
                rows={2}
              />
              <UiButton
                unstyled
                type="button"
                className={sharedStyles.secondaryButton}
                onClick={() => handleRemoveCurrentStateItem(item.id)}
              >
                删除
              </UiButton>
            </div>
          ))}
          <UiButton
            unstyled
            type="button"
            className={sharedStyles.secondaryButton}
            onClick={handleAddCurrentStateItem}
          >
            新增状态项
          </UiButton>
        </div>
      ) : displayCurrentStateItems.length > 0 ? (
        <div className={styles.characterCurrentStateList}>
          {displayCurrentStateItems.map((item) => (
            <div key={item.id} className={styles.characterCurrentStateItem}>
              <div className={styles.characterCurrentStateLabel}>{item.label}</div>
              <div className={styles.characterCurrentStateValue}>{item.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={sharedStyles.emptyHint}>还没有为这个人物整理当前状态。</div>
      )}
    </section>
  );
};
