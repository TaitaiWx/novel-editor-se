import React, { useEffect, useState } from 'react';
import { marked } from 'marked';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import styles from './styles.module.scss';

const ChangelogViewer: React.FC = () => {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const md = await window.electron.ipcRenderer.invoke('get-changelog');
        const rendered = await marked.parse(md, { async: true, gfm: true, breaks: false });
        setHtml(rendered);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载更新日志失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return (
      <div className={styles.changelogViewer}>
        <LoadingSpinner message="正在加载更新日志..." size="medium" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.changelogViewer}>
        <ErrorState title="加载失败" message={error} size="medium" />
      </div>
    );
  }

  return (
    <div className={styles.changelogViewer}>
      <div className={styles.header}>
        <span className={styles.title}>更新日志</span>
        <span className={styles.badge}>Markdown</span>
      </div>
      <div className={styles.content} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};

export default ChangelogViewer;
