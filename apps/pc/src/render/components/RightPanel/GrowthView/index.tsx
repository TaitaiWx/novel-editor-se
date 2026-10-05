import React, { useEffect, useMemo, useRef, useState } from 'react';
import { latestChapterOfSheet, type GrowthTemplate } from '@novel-editor/core/growth';
import { GrowthEventForm } from './GrowthEventForm';
import { GrowthMapPanel } from './GrowthMapPanel';
import { GrowthPartyPanel } from './GrowthPartyPanel';
import { GrowthRulesPanel } from './GrowthRulesPanel';
import { GrowthSheetCard } from './GrowthSheetCard';
import { GrowthSimulationPanel } from './GrowthSimulationPanel';
import { GrowthTimeline } from './GrowthTimeline';
import { GrowthWarningList } from './GrowthWarningList';
import { GrowthWorkspaceHero } from './GrowthWorkspaceHero';
import { useGrowthMemory } from './useGrowthMemory';
import styles from './styles.module.scss';

type GrowthTab = 'sheet' | 'simulate' | 'party' | 'map' | 'rules';

const TAB_LABELS: Record<GrowthTab, string> = {
  sheet: '角色卡',
  simulate: 'AI 推演',
  party: '队伍',
  map: '地图',
  rules: '规则',
};

const TEMPLATE_LABELS: Record<GrowthTemplate, string> = {
  dnd: 'DND 风格（六维属性 + 经验表 + 示例技能与三选一）',
  blank: '空白规则（自行定义属性与技能）',
};

export interface GrowthViewProps {
  folderPath: string | null;
  dbReady: boolean;
  /** 打开时定位到该角色；记忆库中还没有成长卡时自动创建（记忆库未创建时，创建后再建卡） */
  initialCharacter?: string | null;
  /** panel：右侧面板窄布局；workspace：工作区标签宽布局（标题区 + 双栏角色卡） */
  layout?: 'panel' | 'workspace';
  /**
   * 切换到其他角色时的导航回调（工作区标签中由外部打开对应角色的标签）。
   * 仅在指定了 initialCharacter 时生效；未提供时在当前视图内切换
   */
  onNavigateCharacter?: (name: string) => void;
}

/**
 * 角色成长记录器 / 设定记忆库
 *
 * 数据保存在 `<项目>/资料/记忆/`，与 CLI `ne growth` 共用；让几百章后的技能、
 * 抉择、队友与足迹一目了然，并用一致性检查与 AI 推演防止战力崩溃。
 */
export const GrowthView: React.FC<GrowthViewProps> = ({
  folderPath,
  dbReady,
  initialCharacter = null,
  layout = 'panel',
  onNavigateCharacter,
}) => {
  const growth = useGrowthMemory({ folderPath, dbReady });
  const [tab, setTab] = useState<GrowthTab>('sheet');
  const [template, setTemplate] = useState<GrowthTemplate>('dnd');
  const [actionError, setActionError] = useState<string | null>(null);
  const { snapshot, selectedSheet, notice, setNotice, selectCharacter } = growth;
  const isWorkspace = layout === 'workspace';
  const pinnedName = initialCharacter?.trim() || null;
  const appliedInitialRef = useRef<string | null>(null);

  // 定位到指定角色：记忆库就绪后只执行一次（必要时建卡），失败时显示错误而不是反复重试
  useEffect(() => {
    if (!pinnedName || !snapshot?.initialized) return;
    if (appliedInitialRef.current === pinnedName) return;
    appliedInitialRef.current = pinnedName;
    void selectCharacter(pinnedName).then(setActionError);
  }, [pinnedName, selectCharacter, snapshot?.initialized]);

  /** 角色选择器 / 新建表单：固定角色的标签页中改为打开对应角色的标签 */
  const chooseCharacter = (name: string) => {
    if (pinnedName && onNavigateCharacter && name !== pinnedName) {
      onNavigateCharacter(name);
      return;
    }
    void selectCharacter(name).then(setActionError);
  };

  // 提示 4 秒后自动消失
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  const sheetWarnings = useMemo(
    () =>
      snapshot?.check.warnings.filter((warning) => warning.character === growth.selectedName) ?? [],
    [growth.selectedName, snapshot?.check.warnings]
  );
  const characterNames = useMemo(
    () => growth.characters.map((item) => item.name),
    [growth.characters]
  );

  if (!folderPath) {
    return <div className={styles.placeholder}>打开作品后即可记录角色成长。</div>;
  }
  if (growth.loading && !snapshot) {
    return <div className={styles.placeholder}>正在读取记忆库…</div>;
  }
  if (growth.error && !snapshot) {
    return (
      <div className={styles.placeholder}>
        <div className={styles.errorText}>记忆库读取失败：{growth.error}</div>
        <button type="button" className={styles.button} onClick={() => void growth.reload()}>
          重试
        </button>
      </div>
    );
  }
  if (!snapshot) return null;

  if (!snapshot.initialized) {
    return (
      <div className={`${styles.intro} ${isWorkspace ? styles.introWorkspace : ''}`}>
        <div className={styles.introTitle}>角色成长记录器</div>
        <p className={styles.introText}>
          把角色的等级、经验、属性、技能、二选一/三选一抉择、组过的队伍和去过的地方记在
          <code>资料/记忆/</code>
          里。几百章之后也能一眼看清「这个技能升级还要多少经验」「哪个配角好久没出场了」，并在战力暴涨时提醒你。
        </p>
        {pinnedName && (
          <p className={styles.introText}>创建记忆库后会自动为「{pinnedName}」建立成长卡。</p>
        )}
        <div className={styles.templates} role="radiogroup" aria-label="规则模板">
          {(Object.keys(TEMPLATE_LABELS) as GrowthTemplate[]).map((key) => (
            <label key={key} className={styles.template}>
              <input
                type="radio"
                name="growth-template"
                checked={template === key}
                onChange={() => setTemplate(key)}
              />
              {TEMPLATE_LABELS[key]}
            </label>
          ))}
        </div>
        <button
          type="button"
          className={styles.primary}
          disabled={growth.busy}
          onClick={() => void growth.initMemory(template).then(setActionError)}
        >
          创建记忆库
        </button>
        {actionError && <div className={styles.errorText}>{actionError}</div>}
      </div>
    );
  }

  const summary = snapshot.check.summary;
  const defaultChapter = selectedSheet
    ? latestChapterOfSheet(selectedSheet) || undefined
    : undefined;

  const sheetMain = selectedSheet && (
    <GrowthSheetCard
      ruleset={snapshot.ruleset}
      sheet={selectedSheet}
      busy={growth.busy}
      onChoose={(groupId, optionId) =>
        void growth
          .applyEvent({
            type: 'choice',
            target: groupId,
            value: optionId,
            chapter: defaultChapter,
          })
          .then(setActionError)
      }
    />
  );
  const sheetSide = selectedSheet && (
    <>
      <GrowthEventForm
        key={selectedSheet.name}
        ruleset={snapshot.ruleset}
        busy={growth.busy}
        defaultChapter={defaultChapter}
        onSubmit={growth.applyEvent}
      />
      <GrowthWarningList warnings={sheetWarnings} />
      <GrowthTimeline
        ruleset={snapshot.ruleset}
        sheet={selectedSheet}
        busy={growth.busy}
        onUpdateNotes={growth.updateNotes}
      />
    </>
  );

  return (
    <div className={`${styles.view} ${isWorkspace ? styles.viewWorkspace : ''}`}>
      {isWorkspace && (
        <GrowthWorkspaceHero
          sheet={selectedSheet}
          ruleset={snapshot.ruleset}
          sheetCount={snapshot.sheets.length}
          warningCount={sheetWarnings.length}
        />
      )}
      <div className={styles.toolbar}>
        <select
          className={styles.select}
          value={growth.selectedName ?? ''}
          aria-label="选择角色"
          onChange={(event) => {
            if (event.target.value) chooseCharacter(event.target.value);
          }}
        >
          <option value="">选择角色…</option>
          {growth.characters.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
              {item.hasSheet ? '' : '（新建成长卡）'}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.button}
          disabled={growth.busy}
          title="把编辑器中的人物卡与设定导出为 资料/记忆/角色卡、设定 下的只读 Markdown"
          onClick={() => void growth.syncSnapshots().then(setActionError)}
        >
          同步到记忆文件夹
        </button>
      </div>
      <form
        className={styles.newCharacter}
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem('growth-new-name');
          if (!(input instanceof HTMLInputElement) || !input.value.trim()) return;
          const name = input.value.trim();
          input.value = '';
          chooseCharacter(name);
        }}
      >
        <input
          name="growth-new-name"
          className={styles.input}
          placeholder="不在人物库中的角色？输入名字新建成长卡"
          aria-label="新角色名"
        />
        <button type="submit" className={styles.button} disabled={growth.busy}>
          新建
        </button>
      </form>

      <div
        className={`${styles.summary} ${summary.errors > 0 ? styles.summaryError : ''}`}
        title="基于 规则.json 的战力一致性检查"
      >
        <span>{snapshot.sheets.length} 名角色</span>
        <span>{summary.errors} 错误</span>
        <span>{summary.warnings} 警告</span>
        <span>{summary.forgotten} 位配角待回归</span>
      </div>

      {(notice || actionError || snapshot.issues.length > 0) && (
        <div className={styles.messages}>
          {notice && <div className={styles.notice}>{notice}</div>}
          {actionError && <div className={styles.errorText}>{actionError}</div>}
          {snapshot.issues.map((issue) => (
            <div key={issue} className={styles.errorText}>
              已跳过损坏的角色卡：{issue}
            </div>
          ))}
        </div>
      )}

      <div className={styles.tabs} role="tablist">
        {(Object.keys(TAB_LABELS) as GrowthTab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
            onClick={() => setTab(key)}
          >
            {TAB_LABELS[key]}
            {key === 'party' && summary.forgotten > 0 && (
              <span className={styles.badge}>{summary.forgotten}</span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {(tab === 'sheet' || tab === 'simulate') && !selectedSheet && (
          <div className={styles.placeholder}>选择或新建一个角色，开始记录成长。</div>
        )}
        {tab === 'sheet' &&
          selectedSheet &&
          (isWorkspace ? (
            <div className={styles.sheetGrid}>
              <div className={styles.sheetColumn}>{sheetMain}</div>
              <div className={styles.sheetColumn}>{sheetSide}</div>
            </div>
          ) : (
            <>
              {sheetMain}
              {sheetSide}
            </>
          ))}
        {tab === 'simulate' && selectedSheet && (
          <GrowthSimulationPanel
            key={selectedSheet.name}
            ruleset={snapshot.ruleset}
            sheet={selectedSheet}
            busy={growth.busy}
            onSimulate={growth.simulate}
            onApplyBranch={growth.applyBranch}
          />
        )}
        {tab === 'party' && (
          <>
            <GrowthPartyPanel
              party={snapshot.party}
              forgotten={snapshot.check.forgotten}
              currentChapter={snapshot.check.currentChapter}
              forgottenAfter={snapshot.ruleset.limits.forgottenAfterChapters}
              characterNames={characterNames}
              busy={growth.busy}
              onSave={growth.saveParty}
            />
            <GrowthWarningList
              title="全部角色的一致性检查"
              warnings={snapshot.check.warnings}
              showCharacter
            />
          </>
        )}
        {tab === 'map' && (
          <GrowthMapPanel
            atlas={snapshot.atlas}
            characterNames={characterNames}
            selectedCharacter={growth.selectedName}
            busy={growth.busy}
            onSave={growth.saveAtlas}
          />
        )}
        {tab === 'rules' && (
          <GrowthRulesPanel
            ruleset={snapshot.ruleset}
            busy={growth.busy}
            onSave={growth.saveRuleset}
          />
        )}
      </div>
    </div>
  );
};

export default GrowthView;
