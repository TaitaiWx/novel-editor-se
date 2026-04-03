import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from '../../types';
import { useDebounce } from '../RightPanel/useDebounce';
import TextEditor from '../TextEditor';
import {
  isDraftLikeStoryName,
  sortStoryNodesForDisplay,
  type StoryOrderMap,
} from '../../utils/workspace';
import styles from './styles.module.scss';

interface VolumeWorkspaceViewProps {
  volumePath: string;
  volumeName: string;
  volumeNode: FileNode;
  storyOrderMap?: StoryOrderMap;
  onOpenFile: (path: string) => void;
  onCreateChapter?: () => void;
  onCreateDraftFolder?: () => void;
  onCreateDraft?: () => void;
}

interface VolumeWorkspaceDraft {
  summary: string;
  plan: string;
}

const VOLUME_STORAGE_PREFIX = 'novel-editor:volume-workspace:';

function buildVolumeStorageKey(volumePath: string): string {
  return `${VOLUME_STORAGE_PREFIX}${volumePath}`;
}

function buildVolumeEditorPath(volumePath: string, section: 'summary' | 'plan'): string {
  return `__untitled__:volume-${section}-${encodeURIComponent(volumePath)}.md`;
}

function collectFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) =>
    node.type === 'file' ? [node] : collectFiles(node.children || [])
  );
}

const VolumeWorkspaceView: React.FC<VolumeWorkspaceViewProps> = React.memo(
  ({
    volumePath,
    volumeName,
    volumeNode,
    storyOrderMap = {},
    onOpenFile,
    onCreateChapter,
    onCreateDraftFolder,
    onCreateDraft,
  }) => {
    const [summary, setSummary] = useState('');
    const [plan, setPlan] = useState('');
    const [loaded, setLoaded] = useState(false);
    const lastSavedRef = useRef('');
    const debouncedSummary = useDebounce(summary, 250);
    const debouncedPlan = useDebounce(plan, 250);

    const orderedChildren = useMemo(
      () => sortStoryNodesForDisplay(volumeNode.children || [], volumePath, storyOrderMap),
      [storyOrderMap, volumeNode.children, volumePath]
    );
    const allFiles = useMemo(() => collectFiles(orderedChildren), [orderedChildren]);
    const chapterFiles = useMemo(
      () => allFiles.filter((file) => !isDraftLikeStoryName(file.name)),
      [allFiles]
    );
    const draftFiles = useMemo(
      () => allFiles.filter((file) => isDraftLikeStoryName(file.name)),
      [allFiles]
    );

    useEffect(() => {
      let cancelled = false;
      const ipc = window.electron?.ipcRenderer;
      const load = async () => {
        if (!ipc) {
          if (!cancelled) setLoaded(true);
          return;
        }
        try {
          const raw = (await ipc.invoke('db-settings-get', buildVolumeStorageKey(volumePath))) as
            | string
            | null
            | undefined;
          if (cancelled) return;
          const parsed = raw ? (JSON.parse(raw) as Partial<VolumeWorkspaceDraft>) : {};
          const nextSummary = typeof parsed.summary === 'string' ? parsed.summary : '';
          const nextPlan = typeof parsed.plan === 'string' ? parsed.plan : '';
          setSummary(nextSummary);
          setPlan(nextPlan);
          lastSavedRef.current = JSON.stringify({ summary: nextSummary, plan: nextPlan });
        } catch {
          if (!cancelled) {
            setSummary('');
            setPlan('');
            lastSavedRef.current = JSON.stringify({ summary: '', plan: '' });
          }
        } finally {
          if (!cancelled) setLoaded(true);
        }
      };
      void load();
      return () => {
        cancelled = true;
      };
    }, [volumePath]);

    useEffect(() => {
      if (!loaded) return;
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      const payload = JSON.stringify({ summary: debouncedSummary, plan: debouncedPlan });
      if (payload === lastSavedRef.current) return;
      lastSavedRef.current = payload;
      void ipc.invoke('db-settings-set', buildVolumeStorageKey(volumePath), payload);
    }, [debouncedPlan, debouncedSummary, loaded, volumePath]);

    return (
      <div className={styles.volumeWorkspace}>
        <div className={styles.hero}>
          <div>
            <div className={styles.eyebrow}>卷规划</div>
            <h2 className={styles.title}>{volumeName}</h2>
            <p className={styles.subtitle}>围绕这一卷安排主线推进、情绪节奏和章节落点。</p>
          </div>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>章节</span>
              <strong>{chapterFiles.length}</strong>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>样稿</span>
              <strong>{draftFiles.length}</strong>
            </div>
          </div>
        </div>

        <div className={styles.toolbar}>
          <button type="button" className={styles.actionButton} onClick={onCreateChapter}>
            新建章
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onCreateDraftFolder}>
            新建稿夹
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onCreateDraft}>
            新建稿
          </button>
        </div>

        <div className={styles.grid}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>卷总结</div>
              <span className={styles.cardHint}>支持 Markdown 速记</span>
            </div>
            <div className={styles.editorShell}>
              <TextEditor
                filePath={buildVolumeEditorPath(volumePath, 'summary')}
                hideHeader
                virtualContent={summary}
                wordWrap
                showLineNumbers={false}
                onContentChange={setSummary}
              />
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>卷规划</div>
              <span className={styles.cardHint}>记录节奏与待写点</span>
            </div>
            <div className={styles.editorShell}>
              <TextEditor
                filePath={buildVolumeEditorPath(volumePath, 'plan')}
                hideHeader
                virtualContent={plan}
                wordWrap
                showLineNumbers={false}
                onContentChange={setPlan}
              />
            </div>
          </section>
        </div>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>本卷正文</div>
            <span className={styles.cardHint}>点击即可打开对应正文</span>
          </div>
          {chapterFiles.length > 0 ? (
            <div className={styles.fileList}>
              {chapterFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={styles.fileRow}
                  onClick={() => onOpenFile(file.path)}
                >
                  <span className={styles.fileTag}>章</span>
                  <span className={styles.fileName}>{file.name.replace(/\.[^.]+$/, '')}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>这卷里还没有正式章节。</div>
          )}

          {draftFiles.length > 0 && (
            <>
              <div className={styles.subsectionTitle}>样稿 / 测试稿</div>
              <div className={styles.fileList}>
                {draftFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className={styles.fileRow}
                    onClick={() => onOpenFile(file.path)}
                  >
                    <span className={`${styles.fileTag} ${styles.fileTagMuted}`}>稿</span>
                    <span className={styles.fileName}>{file.name.replace(/\.[^.]+$/, '')}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    );
  }
);

export default VolumeWorkspaceView;
