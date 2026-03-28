import React, { useMemo } from 'react';
import {
  AiOutlineBook,
  AiOutlineEdit,
  AiOutlineFolderOpen,
  AiOutlineImport,
  AiOutlineRocket,
} from 'react-icons/ai';
import styles from './styles.module.scss';

interface ProjectHomeProps {
  folderPath: string | null;
  hasFiles: boolean;
  onOpenFolder: () => void;
  onOpenSampleData: () => void;
  onCreateProject?: () => void;
  onCreateChapter?: () => void;
  onBatchCreateChapters?: () => void;
  onImportFile?: () => void;
  onCreateDraft?: () => void;
}

const ProjectHome: React.FC<ProjectHomeProps> = ({
  folderPath,
  hasFiles,
  onOpenFolder,
  onOpenSampleData,
  onCreateProject,
  onCreateChapter,
  onBatchCreateChapters,
  onImportFile,
  onCreateDraft,
}) => {
  const folderName = useMemo(() => {
    if (!folderPath) return null;
    return folderPath.split('/').pop() || folderPath.split('\\').pop() || folderPath;
  }, [folderPath]);

  const hasWorkspace = Boolean(folderPath);

  return (
    <div className={styles.projectHome}>
      <div className={styles.hero}>
        <div className={styles.heroBadge}>{hasWorkspace ? '开始今天的写作' : '写作从作品开始'}</div>
        <h1 className={styles.heroTitle}>
          {hasWorkspace
            ? hasFiles
              ? `继续完善《${folderName}》`
              : `先为《${folderName}》写下第一章`
            : '先打开一个作品目录，再开始写'}
        </h1>
        <p className={styles.heroDescription}>
          {hasWorkspace
            ? '先创建章节和正文，再逐步使用大纲、人物、设定和 AI。主路径应该足够直接。'
            : '这次不再默认把示例项目塞给你。先决定是打开已有作品、体验示例，还是先写一篇空白草稿。'}
        </p>

        <div className={styles.heroActions}>
          {hasWorkspace ? (
            <>
              <button className={styles.primaryButton} onClick={onCreateChapter}>
                <AiOutlineBook />
                <span>新建章节</span>
              </button>
              {onBatchCreateChapters && (
                <button className={styles.secondaryButton} onClick={onBatchCreateChapters}>
                  <AiOutlineRocket />
                  <span>批量章节</span>
                </button>
              )}
              {onImportFile && (
                <button className={styles.secondaryButton} onClick={onImportFile}>
                  <AiOutlineImport />
                  <span>导入文稿</span>
                </button>
              )}
              <button className={styles.secondaryButton} onClick={onOpenFolder}>
                <AiOutlineFolderOpen />
                <span>切换作品目录</span>
              </button>
            </>
          ) : (
            <>
              {onCreateProject && (
                <button className={styles.primaryButton} onClick={onCreateProject}>
                  <AiOutlineBook />
                  <span>新建作品</span>
                </button>
              )}
              <button className={styles.secondaryButton} onClick={onOpenFolder}>
                <AiOutlineFolderOpen />
                <span>打开作品目录</span>
              </button>
              <button className={styles.secondaryButton} onClick={onOpenSampleData}>
                <AiOutlineRocket />
                <span>查看示例项目</span>
              </button>
              {onCreateDraft && (
                <button className={styles.secondaryButton} onClick={onCreateDraft}>
                  <AiOutlineEdit />
                  <span>空白草稿</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className={styles.guides}>
        <div className={styles.guideCard}>
          <div className={styles.guideTitle}>推荐起步顺序</div>
          <ol className={styles.guideList}>
            <li>先打开或选择一个作品目录。</li>
            <li>优先创建章节，再开始正文输入。</li>
            <li>有了正文后，再使用大纲、人物、设定和 AI。</li>
          </ol>
        </div>
        <div className={styles.guideCard}>
          <div className={styles.guideTitle}>当前收敛后的主路径</div>
          <ol className={styles.guideList}>
            <li>新建作品</li>
            <li>进入章节目录</li>
            <li>新建章节</li>
            <li>开始写作，再补大纲和设定</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default ProjectHome;
