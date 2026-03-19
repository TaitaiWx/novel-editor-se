import React, { useEffect, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import EmptyState from '../EmptyState';
import styles from './styles.module.scss';

interface CodeViewerProps {
  filePath: string | null;
  showGrid?: boolean;
  showRowLines?: boolean;
}

// 获取语言类型用于语法高亮类名
const getLanguageFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    go: 'go',
    rs: 'rust',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    dart: 'dart',
  };
  return languageMap[ext || ''] || 'text';
};

// 简单的代码高亮（基本关键字）
const highlightCode = (code: string, language: string): string => {
  if (language === 'javascript' || language === 'typescript') {
    return code
      .replace(
        /\b(const|let|var|function|class|import|export|from|default|if|else|for|while|return|try|catch|finally|async|await|true|false|null|undefined)\b/g,
        '<span class="keyword">$1</span>'
      )
      .replace(/'([^']*?)'/g, '<span class="string">\'$1\'</span>')
      .replace(/"([^"]*?)"/g, '<span class="string">"$1"</span>')
      .replace(/\/\/.*$/gm, '<span class="comment">$&</span>')
      .replace(/\/\*[\s\S]*?\*\//g, '<span class="comment">$&</span>');
  }

  if (language === 'json') {
    return code
      .replace(/"([^"]*?)":/g, '<span class="property">"$1"</span>:')
      .replace(/:\s*"([^"]*?)"/g, ': <span class="string">"$1"</span>')
      .replace(/:\s*(true|false|null)/g, ': <span class="keyword">$1</span>')
      .replace(/:\s*(\d+)/g, ': <span class="number">$1</span>');
  }

  return code;
};

const CodeViewer: React.FC<CodeViewerProps> = ({
  filePath,
  showGrid = false,
  showRowLines = false,
}) => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadContent = async () => {
      if (!filePath) {
        setContent('');
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const fileContent = await window.electron.ipcRenderer.invoke('read-file', filePath);
        setContent(fileContent);
      } catch (error) {
        console.error('Error reading file:', error);
        setError(`无法读取文件: ${filePath}`);
        setContent('');
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [filePath]);

  if (!filePath) {
    return (
      <div className={`${styles.codeViewer} ${styles.empty}`}>
        <EmptyState
          title="选择文件开始阅读"
          description="从左侧文件树中选择一个文件来查看其内容"
          variant="file"
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${styles.codeViewer} ${styles.loading}`}>
        <LoadingSpinner message="正在加载文件内容..." size="medium" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.codeViewer} ${styles.error}`}>
        <ErrorState
          title="文件加载失败"
          message={error}
          size="medium"
          onRetry={() => {
            setError(null);
            setLoading(false);
            // 触发重新加载
            if (filePath) {
              const loadContent = async () => {
                setLoading(true);
                try {
                  const fileContent = await window.electron.ipcRenderer.invoke(
                    'read-file',
                    filePath
                  );
                  setContent(fileContent);
                } catch (error) {
                  console.error('Error reading file:', error);
                  setError(`无法读取文件: ${filePath}`);
                  setContent('');
                } finally {
                  setLoading(false);
                }
              };
              loadContent();
            }
          }}
        />
      </div>
    );
  }

  const language = getLanguageFromPath(filePath);
  const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
  const lines = content.split('\n');

  return (
    <div
      className={`${styles.codeViewer} ${showGrid ? styles.withGrid : ''} ${showRowLines ? styles.withRowLines : ''}`}
    >
      <div className={styles.fileHeader}>
        <div className={styles.fileInfo}>
          <span className={styles.fileName}>{fileName}</span>
          <span className={styles.filePath}>{filePath}</span>
        </div>
        <div className={styles.fileStats}>
          <span className={styles.languageBadge}>{language}</span>
          <span className={styles.lineCount}>{content.split('\n').length} 行</span>
        </div>
      </div>
      <div className={styles.codeContainer}>
        <div className={styles.lineNumbers}>
          {lines.map((_, index) => (
            <div key={index + 1} className={styles.lineNumber}>
              {index + 1}
            </div>
          ))}
        </div>
        <div className={`${styles.codeContent} language-${language}`}>
          {lines.map((line, index) => (
            <div
              key={index}
              className={styles.codeLine}
              dangerouslySetInnerHTML={{ __html: highlightCode(line, language) || '&nbsp;' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default CodeViewer;
