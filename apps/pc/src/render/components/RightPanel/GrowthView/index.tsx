import React, { useEffect, useRef, useState } from 'react';
import { useOptionalToast } from '../../Toast';
import { GrowthCharacterPage } from './GrowthCharacterPage';
import { GrowthHelp } from './GrowthHelp';
import { GrowthOverview } from './GrowthOverview';
import { GrowthPanelSummary } from './GrowthPanelSummary';
import { GrowthSetup } from './GrowthSetup';
import { GrowthTour } from './GrowthTour';
import { useGrowthMemory } from './useGrowthMemory';
import { useGrowthTour } from './useGrowthTour';
import styles from './styles.module.scss';

export interface GrowthViewProps {
  folderPath: string | null;
  dbReady: boolean;
  /** 工作区标签中固定显示的角色；记忆库中还没有成长卡时自动创建 */
  initialCharacter?: string | null;
  /**
   * panel：右侧面板的只读摘要（本章出场角色 + 记一笔）；
   * workspace：工作区标签（指定角色时为成长卡，否则为总览）
   */
  layout?: 'panel' | 'workspace';
  /** 打开某个角色的成长卡标签（总览卡片、人物库建议） */
  onNavigateCharacter?: (name: string) => void;
  /** 新建成长卡（询问角色名后打开标签）；beforeOpen 在打开前执行，例如先创建记忆库 */
  onCreateSheet?: (options: { beforeOpen?: (name: string) => Promise<string | null> }) => void;
  /** 成长卡被删除后（关闭对应标签） */
  onSheetDeleted?: (name: string) => void;
  /** 当前打开的正文章节号：「记一笔」默认填入 */
  currentChapter?: number | null;
  /** 当前章节正文（右侧面板据此找出本章出场角色） */
  content?: string;
}

/**
 * 角色成长档案
 *
 * 数据保存在 `<项目>/资料/记忆/`，与 CLI `ne growth` 共用。界面按「渐进披露」组织：
 * 成长卡只放等级、经验、属性、技能、抉择与时间线，AI 推演与队伍 / 地图 / 规则收进次级导航，
 * 低频操作在「⋯」菜单；「?」与使用说明随处可达。
 */
export const GrowthView: React.FC<GrowthViewProps> = ({
  folderPath,
  dbReady,
  initialCharacter = null,
  layout = 'panel',
  onNavigateCharacter,
  onCreateSheet,
  onSheetDeleted,
  currentChapter = null,
  content = '',
}) => {
  const growth = useGrowthMemory({ folderPath, dbReady });
  const toast = useOptionalToast();
  const [helpOpen, setHelpOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { snapshot, notice, setNotice, selectCharacter } = growth;
  const isWorkspace = layout === 'workspace';
  const pinnedName = isWorkspace ? initialCharacter?.trim() || null : null;
  const appliedInitialRef = useRef<string | null>(null);
  const pinnedSheet = pinnedName
    ? (snapshot?.sheets.find((sheet) => sheet.name === pinnedName) ?? null)
    : null;
  const tour = useGrowthTour(Boolean(pinnedSheet));

  // 定位到指定角色：记忆库就绪后只执行一次（必要时建卡），失败时显示错误而不是反复重试
  useEffect(() => {
    if (!pinnedName || !snapshot?.initialized) return;
    if (appliedInitialRef.current === pinnedName) return;
    appliedInitialRef.current = pinnedName;
    void selectCharacter(pinnedName).then(setActionError);
  }, [pinnedName, selectCharacter, snapshot?.initialized]);

  // 操作结果优先交给全局 toast；没有 ToastProvider（独立窗口 / 测试）时在视图内显示 4 秒
  useEffect(() => {
    if (!notice) return;
    if (toast) {
      toast.success(notice);
      setNotice(null);
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice, toast]);

  const openHelp = () => setHelpOpen(true);
  const help = (
    <GrowthHelp
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
      onStartTour={pinnedSheet ? tour.start : undefined}
    />
  );
  const shellClass = isWorkspace ? styles.growthWorkspace : styles.growthPanel;

  if (!folderPath) {
    return <div className={styles.placeholder}>打开作品后即可记录角色成长。</div>;
  }
  if (growth.loading && !snapshot) {
    return <div className={styles.placeholder}>正在读取成长档案…</div>;
  }
  if (growth.error && !snapshot) {
    return (
      <div className={styles.placeholder}>
        <div className={styles.errorText}>成长档案读取失败：{growth.error}</div>
        <button type="button" className={styles.button} onClick={() => void growth.reload()}>
          重试
        </button>
      </div>
    );
  }
  if (!snapshot) return null;

  if (!snapshot.initialized) {
    return (
      <div className={shellClass}>
        <GrowthSetup
          busy={growth.busy}
          compact={!isWorkspace}
          pendingName={pinnedName}
          error={actionError}
          onCreate={(template) => void growth.initMemory(template).then(setActionError)}
          onOpenHelp={openHelp}
        />
        {help}
      </div>
    );
  }

  const messages =
    (notice && !toast) || actionError || snapshot.issues.length > 0 ? (
      <div className={styles.messages} role="status">
        {notice && !toast && <div className={styles.notice}>{notice}</div>}
        {actionError && <div className={styles.errorText}>{actionError}</div>}
        {snapshot.issues.map((issue) => (
          <div key={issue} className={styles.errorText}>
            已跳过损坏的角色卡：{issue}
          </div>
        ))}
      </div>
    ) : null;

  let body: React.ReactNode;
  if (!isWorkspace) {
    body = (
      <GrowthPanelSummary
        growth={growth}
        snapshot={snapshot}
        content={content}
        currentChapter={currentChapter}
        onOpenHelp={openHelp}
      />
    );
  } else if (!pinnedName) {
    body = (
      <GrowthOverview
        growth={growth}
        snapshot={snapshot}
        onOpenCharacter={(name) =>
          onNavigateCharacter ? onNavigateCharacter(name) : void selectCharacter(name)
        }
        onCreate={onCreateSheet ? () => onCreateSheet({}) : undefined}
        onOpenHelp={openHelp}
      />
    );
  } else if (!pinnedSheet) {
    body = <div className={styles.placeholder}>正在为「{pinnedName}」建立成长卡…</div>;
  } else {
    body = (
      <GrowthCharacterPage
        growth={growth}
        snapshot={snapshot}
        sheet={pinnedSheet}
        currentChapter={currentChapter}
        onOpenHelp={openHelp}
        onError={setActionError}
        onDeleted={(name) => onSheetDeleted?.(name)}
      />
    );
  }

  return (
    <div className={shellClass}>
      {messages}
      {body}
      {help}
      {pinnedSheet && (
        <GrowthTour step={tour.step} onNext={tour.next} onPrev={tour.prev} onClose={tour.close} />
      )}
    </div>
  );
};

export default GrowthView;
