import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { VscLinkExternal } from 'react-icons/vsc';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import styles from './styles.module.scss';

/** 单元格样式 */
interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  fontColor?: string;
  bgColor?: string;
  alignment?: string;
}

/** 单元格数据 */
interface CellData {
  value: string;
  style?: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}

/** Sheet 数据 */
interface SheetData {
  name: string;
  rows: CellData[][];
  colWidths: number[];
  frozenRow?: number;
  frozenCol?: number;
}

/** IPC 返回的 Excel 数据 */
interface SpreadsheetData {
  sheets: SheetData[];
  fileName: string;
}

interface SpreadsheetViewerProps {
  filePath: string | null;
  settingsComponent?: React.ReactNode;
}

const MAX_PREVIEW_SIZE = 10 * 1024 * 1024; // 10MB

const SpreadsheetViewer: React.FC<SpreadsheetViewerProps> = ({ filePath, settingsComponent }) => {
  const [data, setData] = useState<SpreadsheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [tooLarge, setTooLarge] = useState(false);
  const [fileSize, setFileSize] = useState(0);

  const loadData = useCallback(async (fp: string) => {
    setLoading(true);
    setError(null);
    setActiveSheet(0);
    try {
      const result = await window.electron.ipcRenderer.invoke('read-xlsx-data', fp);
      setData(result as SpreadsheetData);
    } catch (err) {
      setError((err as Error).message || '读取 Excel 文件失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载数据
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setActiveSheet(0);
      setTooLarge(false);
      try {
        const info = await window.electron.ipcRenderer.invoke('get-file-info', filePath);
        if (cancelled) return;
        if (info.size > MAX_PREVIEW_SIZE) {
          setTooLarge(true);
          setFileSize(info.size);
          setLoading(false);
          return;
        }
        const result = await window.electron.ipcRenderer.invoke('read-xlsx-data', filePath);
        if (!cancelled) setData(result as SpreadsheetData);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || '读取 Excel 文件失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // 监视文件变化 → 外部编辑后自动刷新
  useEffect(() => {
    if (!filePath) return;

    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    ipc.invoke('watch-file', filePath);

    const handleFileChanged = (_event: unknown, changedPath: string) => {
      if (changedPath === filePath) {
        loadData(filePath);
      }
    };

    const dispose = ipc.on('file-changed', handleFileChanged);

    return () => {
      ipc.invoke('unwatch-file', filePath);
      dispose?.();
    };
  }, [filePath, loadData]);

  const handleOpenExternal = useCallback(async () => {
    if (!filePath) return;
    try {
      await window.electron.ipcRenderer.invoke('open-in-system-app', filePath);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [filePath]);

  const currentSheet = useMemo(() => {
    if (!data || data.sheets.length === 0) return null;
    return data.sheets[activeSheet] ?? data.sheets[0];
  }, [data, activeSheet]);

  const handleSheetClick = useCallback((index: number) => {
    setActiveSheet(index);
  }, []);

  if (loading) {
    return (
      <div className={styles.container}>
        <LoadingSpinner />
      </div>
    );
  }

  if (tooLarge) {
    const sizeMB = (fileSize / 1024 / 1024).toFixed(1);
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.fileName}>{filePath?.split('/').pop() ?? ''}</span>
            <span className={styles.badge}>XLSX</span>
          </div>
          <div className={styles.headerRight}>{settingsComponent}</div>
        </div>
        <div className={styles.tableArea}>
          <div className={styles.tooLargeHint}>
            <p>该文件较大（{sizeMB} MB），不支持内置预览</p>
            <button className={styles.openExternalBtn} onClick={handleOpenExternal}>
              <VscLinkExternal />
              用默认应用打开
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data || !currentSheet) {
    const fileName = filePath?.replace(/\\/g, '/').split('/').pop() ?? '';
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.fileName}>{fileName}</span>
            <span className={styles.badge}>XLSX</span>
          </div>
          <div className={styles.headerRight}>
            <button className={styles.openExternalBtn} onClick={handleOpenExternal}>
              <VscLinkExternal />
              用默认应用打开
            </button>
            {settingsComponent}
          </div>
        </div>
        <div className={styles.tableArea}>
          <ErrorState message={error || '无法读取文件数据'} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.fileName}>{data.fileName}</span>
          <span className={styles.badge}>XLSX</span>
          {currentSheet.rows.length > 0 && (
            <span className={styles.meta}>
              {currentSheet.rows.length} 行 × {currentSheet.colWidths.length} 列
            </span>
          )}
        </div>
        <div className={styles.headerRight}>
          <button className={styles.openExternalBtn} onClick={handleOpenExternal}>
            <VscLinkExternal />
            用默认应用打开编辑
          </button>
          {settingsComponent}
        </div>
      </div>

      {/* Sheet tabs */}
      {data.sheets.length > 1 && (
        <div className={styles.sheetTabs}>
          {data.sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              className={`${styles.sheetTab} ${index === activeSheet ? styles.sheetTabActive : ''}`}
              onClick={() => handleSheetClick(index)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className={styles.tableArea}>
        <table className={styles.table}>
          <colgroup>
            <col className={styles.rowNumberCol} />
            {currentSheet.colWidths.map((w, i) => (
              <col key={i} style={{ width: w ? `${w}px` : undefined }} />
            ))}
          </colgroup>
          {currentSheet.rows.length > 0 && (
            <>
              <thead>
                <tr>
                  <th className={styles.cornerCell} />
                  {currentSheet.colWidths.map((_, i) => (
                    <th key={i} className={styles.colHeader}>
                      {columnLabel(i)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentSheet.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className={rowIdx === 0 ? styles.firstDataRow : undefined}>
                    <td className={styles.rowNumber}>{rowIdx + 1}</td>
                    {row.map((cell, colIdx) => (
                      <td
                        key={colIdx}
                        className={styles.cell}
                        colSpan={cell.colSpan}
                        rowSpan={cell.rowSpan}
                        style={cellStyle(cell.style)}
                      >
                        {cell.value}
                      </td>
                    ))}
                    {/* 补齐空列 */}
                    {row.length < currentSheet.colWidths.length &&
                      Array.from({ length: currentSheet.colWidths.length - row.length }).map(
                        (_, i) => <td key={`empty-${i}`} className={styles.cell} />
                      )}
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>
    </div>
  );
};

/** A, B, C, ..., Z, AA, AB, ... */
function columnLabel(index: number): string {
  let label = '';
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/** 将 CellStyle 转换为 React CSSProperties */
function cellStyle(style?: CellStyle): React.CSSProperties | undefined {
  if (!style) return undefined;
  const css: React.CSSProperties = {};
  if (style.bold) css.fontWeight = 'bold';
  if (style.italic) css.fontStyle = 'italic';
  if (style.fontColor) css.color = style.fontColor;
  if (style.bgColor) css.backgroundColor = style.bgColor;
  if (style.alignment === 'center') css.textAlign = 'center';
  else if (style.alignment === 'right') css.textAlign = 'right';
  return css;
}

/** 判断路径是否为 Excel 文件 */
export function isSpreadsheetPath(filePath: string | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls');
}

export default SpreadsheetViewer;
