import {
  ipcMain,
  dialog,
  BrowserWindow,
  app,
  clipboard as electronClipboard,
  shell,
} from 'electron';
import { watch, type FSWatcher } from 'fs';
import dirTree from 'directory-tree';
import { readFile, writeFile, mkdir, access, cp } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  addRecentFolder,
  clearRecentFolders,
  getLastFolder,
  getRecentFolders,
} from './recent-folders';

// ========== better-sqlite3 原生模块路径解析 ==========
// 打包后的 Electron 应用无法通过 bindings 模块自动定位 .node 文件，
// 通过显式指定 nativeBinding 路径绕过 bindings 解析。
let _nativeBinding: string | undefined;
let _nativeBindingResolved = false;

function getNativeBinding(): string | undefined {
  if (_nativeBindingResolved) return _nativeBinding;
  _nativeBindingResolved = true;

  if (!app.isPackaged) return undefined;

  // asarUnpack 会将 better-sqlite3 解压到 app.asar.unpacked 目录
  const unpackedPath = app.getAppPath() + '.unpacked';
  const bindingPath = path.join(
    unpackedPath,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );

  if (existsSync(bindingPath)) {
    _nativeBinding = bindingPath;
  } else {
    console.warn('better-sqlite3 native binding not found at:', bindingPath);
  }

  return _nativeBinding;
}
import { getAllShortcuts } from './shortcuts/getAllShortcuts';
import { importFile, SUPPORTED_IMPORT_EXTENSIONS } from './file-importer';
import { exportToWord, exportProjectToWord, exportToPptx, beautifyPptx } from './document-exporter';
import { getDeviceId } from './device-id';
import {
  checkForUpdatesManually,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  rollbackToPreviousVersion,
  setUpdateChannel,
} from './auto-updater';
import type { UpdateChannel } from './auto-updater';
import {
  initDatabase,
  isDatabaseReady,
  closeDatabase,
  novelOps,
  characterOps,
  statsOps,
  settingsOps,
  aiCacheOps,
  exportAllData,
  importData,
  versionOps,
  type ExportData,
} from '@novel-editor/store';

interface SnapshotJobState {
  id: string;
  status: 'running' | 'completed' | 'failed';
  stage: 'scanning' | 'persisting' | 'completed' | 'failed';
  discoveredFiles: number;
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  snapshotId: number | null;
  error: string | null;
}

interface AIRequestPayload {
  prompt: string;
  systemPrompt?: string;
  context?: string;
  maxTokens?: number;
  temperature?: number;
}

const DOCUMENT_CACHE_PREFIXES = [
  'novel-editor:lore:',
  'novel-editor:character-relations:',
  'novel-editor:plot-board:',
  'novel-editor:graph-layout:',
];

interface PersistedAISettings {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

async function invokeConfiguredAI(payload: AIRequestPayload) {
  const rawSettings = settingsOps.get('novel-editor:settings-center');
  const parsed = rawSettings ? (JSON.parse(rawSettings) as { ai?: PersistedAISettings }) : {};
  const ai = parsed.ai || {};

  if (!ai.enabled) {
    return { ok: false, error: 'AI 功能未启用，请先在设置中心开启' };
  }
  if (!ai.apiKey?.trim()) {
    return { ok: false, error: '未配置 AI Key，请先在设置中心填写 API Key' };
  }
  if (!ai.baseUrl?.trim() || !ai.model?.trim()) {
    return { ok: false, error: 'AI Base URL 或模型未配置完整' };
  }

  const endpoint = `${ai.baseUrl.replace(/\/$/, '')}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: ai.model.trim(),
        temperature:
          typeof payload.temperature === 'number'
            ? payload.temperature
            : typeof ai.temperature === 'number'
              ? ai.temperature
              : 1.3,
        max_tokens:
          typeof payload.maxTokens === 'number'
            ? payload.maxTokens
            : typeof ai.maxTokens === 'number'
              ? ai.maxTokens
              : 8192,
        messages: [
          ...(payload.systemPrompt ? [{ role: 'system', content: payload.systemPrompt }] : []),
          {
            role: 'user',
            content: payload.context
              ? `项目上下文:\n${payload.context}\n\n用户请求:\n${payload.prompt}`
              : payload.prompt,
          },
        ],
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `无法连接 AI 服务 (${endpoint}): ${msg}` };
  }

  let json: {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    return { ok: false, error: `AI 服务返回了无效的响应 (HTTP ${response.status})` };
  }

  if (!response.ok) {
    return { ok: false, error: json.error?.message || `AI 请求失败 (HTTP ${response.status})` };
  }

  const content = json.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((item) => item.text || '').join('')
    : content || '';

  return { ok: true, text };
}

const snapshotJobs = new Map<string, SnapshotJobState>();
let snapshotJobCounter = 0;

function createSnapshotJob(folderPath: string, message?: string): string {
  const id = `snapshot-job-${Date.now()}-${++snapshotJobCounter}`;
  snapshotJobs.set(id, {
    id,
    status: 'running',
    stage: 'scanning',
    discoveredFiles: 0,
    processedFiles: 0,
    totalFiles: 0,
    processedBytes: 0,
    totalBytes: 0,
    snapshotId: null,
    error: null,
  });

  void versionOps
    .createSnapshot(folderPath, message, (progress) => {
      const current = snapshotJobs.get(id);
      if (!current) return;
      snapshotJobs.set(id, {
        ...current,
        stage: progress.stage,
        discoveredFiles: progress.discoveredFiles,
        processedFiles: progress.processedFiles,
        totalFiles: progress.totalFiles,
        processedBytes: progress.processedBytes,
        totalBytes: progress.totalBytes,
      });
    })
    .then((snapshotId) => {
      const current = snapshotJobs.get(id);
      if (!current) return;
      snapshotJobs.set(id, {
        ...current,
        status: 'completed',
        stage: 'completed',
        snapshotId,
      });
      setTimeout(() => snapshotJobs.delete(id), 60_000);
    })
    .catch((error) => {
      const current = snapshotJobs.get(id);
      if (!current) return;
      snapshotJobs.set(id, {
        ...current,
        status: 'failed',
        stage: 'failed',
        error: error instanceof Error ? error.message : '未知错误',
      });
      setTimeout(() => snapshotJobs.delete(id), 60_000);
    });

  return id;
}

// 类型定义
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// 转换目录树结构
function convertTreeFormat(node: dirTree.DirectoryTree): FileNode {
  return {
    name: node.name,
    path: node.path,
    type: node.type === 'directory' ? 'directory' : 'file',
    ...(node?.children && { children: node?.children?.map(convertTreeFormat) }),
  };
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
  };

  return mimeByExt[ext] || 'application/octet-stream';
}

// ========== 文件监视器管理 ==========
const fileWatchers = new Map<string, FSWatcher>();

/**
 * 降级 docx 解析：从 word/document.xml 提取段落文本转为基本 HTML。
 * 在 mammoth + JSZip 解析失败时作为后备方案。
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function docxXmlToHtml(xml: string): string {
  const paragraphs: string[] = [];
  // 匹配每个 <w:p> 段落
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pContent = pMatch[1];
    const texts: string[] = [];
    // 提取段落内所有 <w:t> 文本节点
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      texts.push(escapeHtml(tMatch[1]));
    }
    if (texts.length > 0) {
      // 检测是否为标题样式（w:pStyle val="Heading..."）
      const styleMatch = pContent.match(/<w:pStyle\s+w:val="Heading(\d)"/i);
      if (styleMatch) {
        const level = Math.min(Number(styleMatch[1]), 6);
        paragraphs.push(`<h${level}>${texts.join('')}</h${level}>`);
      } else {
        paragraphs.push(`<p>${texts.join('')}</p>`);
      }
    }
  }
  return paragraphs.join('\n');
}

// 设置IPC通信处理程序
export function setupIPC() {
  // 打开本地文件夹
  ipcMain.handle('open-local-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择要打开的文件夹',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      addRecentFolder(folderPath);
      const tree = dirTree(folderPath, {
        exclude: /node_modules|\.git|\.novel-editor|\.vscode|\.DS_Store|dist|build|out/,
        attributes: ['type'],
      });

      return {
        path: folderPath,
        files: tree?.children ? tree?.children?.map(convertTreeFormat) : [],
      };
    }
    return null;
  });

  // 读取文件内容（支持指定编码）
  ipcMain.handle('read-file', async (event, filePath: string, encoding?: string) => {
    try {
      if (encoding && encoding.toUpperCase() !== 'UTF-8') {
        const buffer = await readFile(filePath);
        const decoder = new TextDecoder(encoding.toLowerCase());
        return decoder.decode(buffer);
      }
      return await readFile(filePath, 'utf-8');
    } catch (_error) {
      throw new Error(`Failed to read file: ${filePath}`);
    }
  });

  ipcMain.handle('read-file-binary', async (_event, filePath: string) => {
    try {
      const buffer = await readFile(filePath);
      return {
        base64Content: buffer.toString('base64'),
        byteSize: buffer.byteLength,
        mimeType: guessMimeType(filePath),
      };
    } catch (_error) {
      throw new Error(`Failed to read binary file: ${filePath}`);
    }
  });

  // 读取 Excel 文件并返回结构化数据（用于 SpreadsheetViewer）
  ipcMain.handle('read-xlsx-data', async (_event, filePath: string) => {
    try {
      const ExcelJS = await import('exceljs');
      const ExcelMod = ExcelJS.default ?? ExcelJS;
      const workbook = new ExcelMod.Workbook();
      await workbook.xlsx.readFile(filePath);

      const sheets: {
        name: string;
        rows: {
          value: string;
          style?: Record<string, unknown>;
          colSpan?: number;
          rowSpan?: number;
        }[][];
        colWidths: number[];
      }[] = [];

      workbook.eachSheet((worksheet) => {
        const rows: { value: string; style?: Record<string, unknown> }[][] = [];
        let maxCols = 0;

        // 收集列宽
        const colWidths: number[] = [];
        for (let c = 1; c <= (worksheet.columnCount || 0); c++) {
          const col = worksheet.getColumn(c);
          // ExcelJS column width 单位约 7px
          colWidths.push(col.width ? Math.round(col.width * 7) : 80);
        }

        worksheet.eachRow((row) => {
          const cells: { value: string; style?: Record<string, unknown> }[] = [];

          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            // 补空位对齐列号
            while (cells.length < colNumber - 1) {
              cells.push({ value: '' });
            }

            // 提取文本值
            let text = '';
            if (cell.value === null || cell.value === undefined) {
              text = '';
            } else if (typeof cell.value === 'object' && 'richText' in cell.value) {
              text = (cell.value.richText as { text: string }[]).map((rt) => rt.text).join('');
            } else if (typeof cell.value === 'object' && 'result' in cell.value) {
              text = String((cell.value as { result: unknown }).result ?? '');
            } else if (cell.value instanceof Date) {
              text = cell.value.toLocaleDateString();
            } else {
              text = String(cell.value);
            }

            // 提取样式
            const style: Record<string, unknown> = {};
            if (cell.font?.bold) style.bold = true;
            if (cell.font?.italic) style.italic = true;
            if (cell.font?.color?.argb) {
              const argb = cell.font.color.argb;
              style.fontColor = `#${typeof argb === 'string' ? argb.slice(-6) : ''}`;
            }
            if (cell.fill && 'fgColor' in cell.fill && cell.fill.fgColor?.argb) {
              const argb = cell.fill.fgColor.argb;
              const hex = typeof argb === 'string' ? argb.slice(-6) : '';
              if (hex && hex !== '000000') style.bgColor = `#${hex}`;
            }
            if (cell.alignment?.horizontal) {
              style.alignment = cell.alignment.horizontal;
            }

            const hasStyle = Object.keys(style).length > 0;
            cells.push({ value: text, ...(hasStyle ? { style } : {}) });
          });

          if (cells.length > maxCols) maxCols = cells.length;
          rows.push(cells);
        });

        // 补齐每行到相同列数
        for (const row of rows) {
          while (row.length < maxCols) row.push({ value: '' });
        }

        // 确保 colWidths 与 maxCols 一致
        while (colWidths.length < maxCols) colWidths.push(80);

        if (rows.length > 0) {
          sheets.push({ name: worksheet.name, rows, colWidths });
        }
      });

      return {
        sheets,
        fileName: path.basename(filePath),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Corrupted zip') || msg.includes('End of data')) {
        throw new Error('文件已损坏或不是有效的 Excel (.xlsx) 格式');
      }
      throw new Error(`读取 Excel 文件失败: ${msg}`);
    }
  });

  // 用系统默认应用打开文件（VS Code / Typora 业界标准模式）
  ipcMain.handle('open-in-system-app', async (_event, filePath: string) => {
    try {
      const errorMessage = await shell.openPath(filePath);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
      return { success: true };
    } catch (error) {
      throw new Error(`无法打开文件: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // 监视文件变化（用于外部编辑后自动同步）
  ipcMain.handle('watch-file', (_event, filePath: string) => {
    // 避免重复监视
    if (fileWatchers.has(filePath)) return;

    try {
      // 使用防抖：外部编辑器保存时可能触发多次事件
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const watcher = watch(filePath, (eventType) => {
        if (eventType !== 'change') return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const win = BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            win.webContents.send('file-changed', filePath);
          }
        }, 500);
      });

      watcher.on('error', () => {
        fileWatchers.delete(filePath);
      });

      fileWatchers.set(filePath, watcher);
    } catch {
      // 静默失败：监视不是核心功能
    }
  });

  // 停止监视文件
  ipcMain.handle('unwatch-file', (_event, filePath: string) => {
    const watcher = fileWatchers.get(filePath);
    if (watcher) {
      watcher.close();
      fileWatchers.delete(filePath);
    }
  });

  // 读取 PPTX 幻灯片数据
  ipcMain.handle('read-pptx-data', async (_event, filePath: string) => {
    try {
      const buffer = await readFile(filePath);
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );

      // pptxgenjs 已依赖 jszip，复用同一版本避免冲突
      const jszip = await import('jszip');
      // Vite 打包后 default export 可能被包裹一层
      const JSZipCtor: any =
        typeof jszip === 'function'
          ? jszip
          : (jszip as Record<string, unknown>).default
            ? (jszip as Record<string, unknown>).default
            : jszip;

      if (typeof JSZipCtor.loadAsync !== 'function') {
        throw new Error('JSZip 模块加载异常，loadAsync 不可用');
      }

      const zip = await JSZipCtor.loadAsync(new Uint8Array(arrayBuffer));

      // 获取所有幻灯片 XML 文件并排序
      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
          const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
          return numA - numB;
        });

      const slides: { index: number; title: string; texts: string[]; noteText: string }[] = [];

      for (let i = 0; i < slideFiles.length; i++) {
        const xml = await zip.files[slideFiles[i]].async('text');

        // 提取所有文本内容
        const texts: string[] = [];
        let title = '';

        // 匹配 <a:t>...</a:t> 文本节点
        const textMatches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
        for (const m of textMatches) {
          const text = m[1].trim();
          if (text) texts.push(text);
        }

        // 第一个非空文本作为标题
        title = texts[0] || `幻灯片 ${i + 1}`;

        // 尝试读取备注
        let noteText = '';
        const noteFile = `ppt/notesSlides/notesSlide${i + 1}.xml`;
        if (zip.files[noteFile]) {
          const noteXml = await zip.files[noteFile].async('text');
          const noteMatches = noteXml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
          const noteTexts: string[] = [];
          for (const m of noteMatches) {
            const t = m[1].trim();
            // 跳过幻灯片编号占位符
            if (t && !/^\d+$/.test(t)) noteTexts.push(t);
          }
          noteText = noteTexts.join(' ');
        }

        slides.push({ index: i + 1, title, texts: texts.slice(1), noteText });
      }

      return {
        fileName: path.basename(filePath),
        slideCount: slides.length,
        slides,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes('Corrupted zip') ||
        msg.includes('End of data') ||
        msg.includes('not a valid zip')
      ) {
        throw new Error('文件已损坏或不是有效的 PowerPoint (.pptx) 格式');
      }
      throw new Error(`读取 PPT 文件失败: ${msg}`);
    }
  });

  // 读取 Word (.docx) 文件并转为 HTML
  ipcMain.handle('read-docx-data', async (_event, filePath: string) => {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // .doc 是旧二进制格式（非 ZIP），mammoth/JSZip 无法处理，直接走外部打开
    if (ext === '.doc') {
      return { fileName, html: '', useExternal: true };
    }

    const buffer = await readFile(filePath);

    // 1) 优先使用 mammoth（接受 Node.js Buffer）
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.convertToHtml({ buffer });
      return { fileName, html: result.value };
    } catch {
      // mammoth 不支持该文件，静默降级
    }

    // 2) 降级方案：独立 JSZip 解压 word/document.xml
    try {
      const arrayBuffer = new ArrayBuffer(buffer.length);
      new Uint8Array(arrayBuffer).set(buffer);
      const JSZipMod = await import('jszip');
      const JSZip = JSZipMod.default ?? JSZipMod;
      const zip = await JSZip.loadAsync(arrayBuffer);
      const docXml = await zip.file('word/document.xml')?.async('string');
      if (docXml) {
        const html = docxXmlToHtml(docXml);
        return { fileName, html };
      }
    } catch {
      // JSZip 也无法解析，静默降级
    }

    // 两种方式都失败 → 返回 useExternal 标记，前端显示"用默认应用打开"按钮
    return { fileName, html: '', useExternal: true };
  });

  // 写入文件内容
  ipcMain.handle('write-file', async (event, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (_error) {
      throw new Error(`Failed to write file: ${filePath}`);
    }
  });

  // 获取文件信息
  ipcMain.handle('get-file-info', async (event, filePath: string) => {
    try {
      const { stat } = await import('fs/promises');
      const stats = await stat(filePath);

      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      };
    } catch (_error) {
      throw new Error(`Failed to get file info: ${filePath}`);
    }
  });

  // 获取默认示例数据目录（首次启动时复制到用户文档目录，确保可写）
  ipcMain.handle('get-default-data-path', async () => {
    try {
      const userDataDir = path.join(app.getPath('documents'), 'Novel Editor');
      const userSamplePath = path.join(userDataDir, 'sample-data');

      // 已复制到用户目录，直接返回
      try {
        await access(userSamplePath);
        return userSamplePath;
      } catch {
        // 尚未复制，继续
      }

      // 定位源 sample-data 目录
      let sourcePath: string;
      if (app.isPackaged) {
        sourcePath = path.join(process.resourcesPath, 'sample-data');
      } else {
        const appRoot = path.resolve(app.getAppPath(), '..');
        sourcePath = path.join(appRoot, 'sample-data');
      }

      // 复制 sample-data 到用户目录
      try {
        await access(sourcePath);
        await mkdir(userDataDir, { recursive: true });
        await cp(sourcePath, userSamplePath, { recursive: true });
      } catch {
        // 源目录不存在时创建空目录
        await mkdir(userSamplePath, { recursive: true });
      }

      return userSamplePath;
    } catch (_error) {
      throw new Error('Failed to get default data path');
    }
  });

  // 更新日志（只返回当前版本的段落）
  ipcMain.handle('get-changelog', async () => {
    let changelogPath: string;
    if (app.isPackaged) {
      changelogPath = path.join(process.resourcesPath, 'CHANGELOG.md');
    } else {
      changelogPath = path.join(app.getAppPath(), '..', 'CHANGELOG.md');
    }
    try {
      const full = await readFile(changelogPath, 'utf-8');
      // 提取第一个 ## 版本段落（到下一个 ## 或文件末尾）
      const versionMatch = full.match(/(## v[\s\S]*?)(?=\n## v|$)/);
      return versionMatch ? versionMatch[1].trim() : full;
    } catch {
      return '# 更新日志\n\n暂无更新记录。';
    }
  });

  // 检测是否刚完成更新（对比 lastSeenVersion 与当前版本）
  ipcMain.handle('check-just-updated', async () => {
    const versionFilePath = path.join(app.getPath('userData'), 'changelog-last-seen-version');
    const currentVersion = app.getVersion();
    let previousVersion: string | null = null;
    try {
      previousVersion = (await readFile(versionFilePath, 'utf-8')).trim();
    } catch {
      // 首次启动，无记录
    }
    // 原子写入当前版本
    await writeFile(versionFilePath, currentVersion, 'utf-8');
    // 首次安装（无记录）或版本升级后，均展示更新日志
    if (!previousVersion || previousVersion !== currentVersion) {
      return { updated: true, fromVersion: previousVersion, toVersion: currentVersion };
    }
    return { updated: false, fromVersion: null, toVersion: currentVersion };
  });

  // 最近打开的文件夹
  ipcMain.handle('get-recent-folders', () => getRecentFolders());
  ipcMain.handle('get-last-folder', () => getLastFolder());
  ipcMain.handle('add-recent-folder', (_event, folderPath: string) => {
    addRecentFolder(folderPath);
  });
  ipcMain.handle('app-cache-clear', (_event, scope: 'document-data') => {
    if (scope !== 'document-data') {
      throw new Error(`Unsupported cache clear scope: ${scope}`);
    }
    const removedSettingRows = settingsOps.deleteByPrefixes(DOCUMENT_CACHE_PREFIXES);
    const recentFolderCount = getRecentFolders().length;
    clearRecentFolders();
    return {
      scope,
      removedSettingRows,
      clearedRecentFolders: recentFolderCount,
    };
  });

  // 读取系统剪贴板中的文件路径（支持从 Finder/Explorer 复制的文件）
  ipcMain.handle('read-clipboard-file-paths', (): string[] => {
    try {
      if (process.platform === 'darwin') {
        // macOS: Finder 复制多文件时使用 NSFilenamesPboardType（XML plist）
        const plistStr = electronClipboard.read('NSFilenamesPboardType');
        if (plistStr) {
          const paths: string[] = [];
          const regex = /<string>([^<]+)<\/string>/g;
          let match;
          while ((match = regex.exec(plistStr)) !== null) {
            if (match[1] && match[1].startsWith('/')) paths.push(match[1]);
          }
          if (paths.length > 0) return paths;
        }
        // 单文件回退：public.file-url
        const formats = electronClipboard.availableFormats();
        if (formats.some((f) => f.includes('file-url'))) {
          const fileUrl = electronClipboard.read('public.file-url');
          if (fileUrl?.startsWith('file://')) {
            const filePath = decodeURIComponent(new URL(fileUrl).pathname);
            return [filePath];
          }
        }
      }
      if (process.platform === 'win32') {
        const text = electronClipboard.readText();
        if (text) {
          const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && (l.startsWith('/') || /^[A-Za-z]:\\/.test(l)));
          if (lines.length > 0) return lines;
        }
      }
    } catch {
      // 读取剪贴板失败时静默降级
    }
    return [];
  });

  // 打开示例项目（返回 sample-data 路径）
  ipcMain.handle('open-sample-data', async () => {
    const userDataDir = path.join(app.getPath('documents'), 'Novel Editor');
    const userSamplePath = path.join(userDataDir, 'sample-data');

    // 确保 sample-data 已复制到用户目录
    try {
      await access(userSamplePath);
    } catch {
      let sourcePath: string;
      if (app.isPackaged) {
        sourcePath = path.join(process.resourcesPath, 'sample-data');
      } else {
        const appRoot = path.resolve(app.getAppPath(), '..');
        sourcePath = path.join(appRoot, 'sample-data');
      }
      try {
        await access(sourcePath);
        await mkdir(userDataDir, { recursive: true });
        await cp(sourcePath, userSamplePath, { recursive: true });
      } catch {
        await mkdir(userSamplePath, { recursive: true });
      }
    }

    return userSamplePath;
  });

  // 创建新文件
  ipcMain.handle('create-file', async (event, folderPath: string, fileName: string) => {
    try {
      const filePath = path.join(folderPath, fileName);

      // 检查文件是否已存在
      try {
        await access(filePath);
        throw new Error('文件已存在');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // 创建空文件
      await writeFile(filePath, '', 'utf-8');

      return { success: true, filePath };
    } catch (error) {
      throw new Error(
        `Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  // 创建新目录
  ipcMain.handle('create-directory', async (event, folderPath: string, dirName: string) => {
    try {
      const dirPath = path.join(folderPath, dirName);

      // 检查目录是否已存在
      try {
        await access(dirPath);
        throw new Error('目录已存在');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // 创建目录
      await mkdir(dirPath, { recursive: true });

      return { success: true, dirPath };
    } catch (error) {
      throw new Error(
        `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  // 刷新文件夹内容
  ipcMain.handle('refresh-folder', async (event, folderPath: string) => {
    try {
      const tree = dirTree(folderPath, {
        exclude: /node_modules|\.git|\.novel-editor|\.vscode|\.DS_Store|dist|build|out/,
        attributes: ['type'],
      });

      return {
        path: folderPath,
        files: tree?.children ? tree?.children?.map(convertTreeFormat) : [],
      };
    } catch (_error) {
      throw new Error(`Failed to refresh folder: ${folderPath}`);
    }
  });

  // 窗口控制方法
  ipcMain.handle('window-minimize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.minimize();
    }
  });

  ipcMain.handle('window-maximize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.handle('window-close', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.close();
    }
  });

  ipcMain.handle('window-is-maximized', () => {
    const window = BrowserWindow.getFocusedWindow();
    return window ? window.isMaximized() : false;
  });

  // 键盘快捷键相关的IPC处理
  ipcMain.handle('app-quit', () => {
    app.quit();
  });

  ipcMain.handle('dev-tools-toggle', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      } else {
        window.webContents.openDevTools();
      }
    }
  });

  ipcMain.handle('window-toggle-fullscreen', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.setFullScreen(!window.isFullScreen());
    }
  });

  // 获取所有快捷键列表
  ipcMain.handle('get-shortcuts', () => {
    return getAllShortcuts();
  });

  // 获取应用版本号
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // 获取设备唯一标识
  ipcMain.handle('get-device-id', () => {
    return getDeviceId();
  });

  // 自动更新相关
  ipcMain.handle('update-download', () => downloadUpdate());

  ipcMain.handle('update-install', () => installUpdate());

  ipcMain.handle('update-check', () => checkForUpdatesManually());

  ipcMain.handle('update-status', () => getUpdateStatus());

  ipcMain.handle('update-set-channel', (_event, channel: UpdateChannel) =>
    setUpdateChannel(channel)
  );

  ipcMain.handle('update-rollback', () => rollbackToPreviousVersion());

  // 删除文件
  ipcMain.handle('delete-file', async (event, filePath: string) => {
    try {
      const { unlink } = await import('fs/promises');
      await unlink(filePath);
      return { success: true };
    } catch (_error) {
      throw new Error(`Failed to delete file: ${filePath}`);
    }
  });

  // 删除目录
  ipcMain.handle('delete-directory', async (event, dirPath: string) => {
    try {
      const { rm } = await import('fs/promises');
      await rm(dirPath, { recursive: true });
      return { success: true };
    } catch (_error) {
      throw new Error(`Failed to delete directory: ${dirPath}`);
    }
  });

  // 重命名文件或目录
  ipcMain.handle('rename-file', async (event, oldPath: string, newPath: string) => {
    try {
      const { rename } = await import('fs/promises');
      await rename(oldPath, newPath);
      return { success: true, newPath };
    } catch (_error) {
      throw new Error(`Failed to rename: ${oldPath}`);
    }
  });

  // 粘贴文件/目录（VS Code 风格名称冲突解决）
  ipcMain.handle('paste-files', async (_event, sourcePaths: string[], targetDir: string) => {
    const { stat, copyFile, realpath } = await import('fs/promises');
    const results: { source: string; dest: string }[] = [];

    // 确保目标目录存在
    if (!existsSync(targetDir)) {
      throw new Error(`目标目录不存在: ${path.basename(targetDir)}`);
    }

    for (const sourcePath of sourcePaths) {
      // 校验源文件存在
      if (!existsSync(sourcePath)) {
        throw new Error(`源文件不存在: ${path.basename(sourcePath)}`);
      }

      const baseName = path.basename(sourcePath);
      const srcStat = await stat(sourcePath);
      const isDir = srcStat.isDirectory();

      let destPath = path.join(targetDir, baseName);

      // 源和目标是同一个文件，或名称冲突 → 自动重命名
      let needsRename = false;
      if (existsSync(destPath)) {
        needsRename = true;
      } else {
        // 检查是否粘贴到自身位置
        const srcReal = await realpath(sourcePath);
        const parentReal = await realpath(targetDir);
        if (path.dirname(srcReal) === parentReal && path.basename(srcReal) === baseName) {
          needsRename = true;
        }
      }

      if (needsRename) {
        const ext = path.extname(baseName);
        const nameWithoutExt = ext ? baseName.slice(0, -ext.length) : baseName;

        destPath = path.join(
          targetDir,
          isDir ? `${baseName} copy` : `${nameWithoutExt} copy${ext}`
        );
        let counter = 2;
        while (existsSync(destPath)) {
          destPath = path.join(
            targetDir,
            isDir ? `${baseName} copy ${counter}` : `${nameWithoutExt} copy ${counter}${ext}`
          );
          counter++;
        }
      }

      try {
        if (isDir) {
          await cp(sourcePath, destPath, { recursive: true });
        } else {
          // 普通文件使用 copyFile，比 cp 更稳定
          await copyFile(sourcePath, destPath);
        }
        results.push({ source: sourcePath, dest: destPath });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`粘贴失败 (${baseName}): ${msg}`);
      }
    }

    return { success: true, results };
  });

  // ========== SQLite 数据库 IPC ==========

  // 初始化数据库
  ipcMain.handle('db-init', (_event, dbDir: string) => {
    initDatabase(dbDir, 'novel-editor.db', getNativeBinding());
    return { success: true };
  });

  // 初始化默认数据库（开箱即用模式，无需打开目录）
  ipcMain.handle('db-init-default', () => {
    const defaultDbDir = path.join(app.getPath('userData'), '.novel-editor');
    initDatabase(defaultDbDir, 'novel-editor.db', getNativeBinding());
    return { success: true, dbDir: defaultDbDir };
  });

  // 关闭数据库
  ipcMain.handle('db-close', () => {
    closeDatabase();
    return { success: true };
  });

  // 小说 CRUD
  ipcMain.handle(
    'db-novel-create',
    (_event, name: string, folderPath: string, description?: string) => {
      return novelOps.create(name, folderPath, description);
    }
  );
  ipcMain.handle('db-novel-list', () => novelOps.getAll());
  ipcMain.handle('db-novel-get', (_event, id: number) => novelOps.getById(id));
  ipcMain.handle('db-novel-get-by-folder', (_event, folderPath: string) =>
    novelOps.getByFolder(folderPath)
  );
  ipcMain.handle(
    'db-novel-update',
    (_event, id: number, fields: { name?: string; description?: string }) =>
      novelOps.update(id, fields)
  );
  ipcMain.handle('db-novel-delete', (_event, id: number) => novelOps.delete(id));

  // 角色 CRUD
  ipcMain.handle(
    'db-character-create',
    (
      _event,
      novelId: number,
      name: string,
      role?: string,
      description?: string,
      attributes?: string
    ) => characterOps.create(novelId, name, role, description, attributes)
  );
  ipcMain.handle('db-character-list', (_event, novelId: number) =>
    characterOps.getByNovel(novelId)
  );
  ipcMain.handle(
    'db-character-update',
    (
      _event,
      id: number,
      fields: { name?: string; role?: string; description?: string; attributes?: string }
    ) => characterOps.update(id, fields)
  );
  ipcMain.handle('db-character-reorder', (_event, ids: number[]) => characterOps.reorder(ids));
  ipcMain.handle('db-character-delete', (_event, id: number) => characterOps.delete(id));

  // 写作统计
  ipcMain.handle(
    'db-stats-record',
    (_event, novelId: number, date: string, wordCount: number, durationSeconds: number) =>
      statsOps.record(novelId, date, wordCount, durationSeconds)
  );
  ipcMain.handle('db-stats-range', (_event, novelId: number, startDate: string, endDate: string) =>
    statsOps.getByNovelAndRange(novelId, startDate, endDate)
  );
  ipcMain.handle('db-stats-today', (_event, novelId: number) => statsOps.getToday(novelId));

  // 设置
  ipcMain.handle('db-settings-get', (_event, key: string) => {
    if (!isDatabaseReady()) return undefined;
    return settingsOps.get(key);
  });
  ipcMain.handle('db-settings-set', (_event, key: string, value: string) =>
    settingsOps.set(key, value)
  );
  ipcMain.handle('db-settings-all', () => settingsOps.getAll());

  // AI 缓存
  ipcMain.handle('ai-cache-get', (_event, cacheKey: string, type: string) =>
    aiCacheOps.get(cacheKey, type)
  );
  ipcMain.handle('ai-cache-set', (_event, cacheKey: string, type: string, value: string) =>
    aiCacheOps.set(cacheKey, type, value)
  );
  ipcMain.handle('ai-cache-delete', (_event, cacheKey: string, type: string) =>
    aiCacheOps.delete(cacheKey, type)
  );
  ipcMain.handle('ai-cache-get-by-type', (_event, type: string) => aiCacheOps.getByType(type));
  ipcMain.handle('ai-cache-clear-by-type', (_event, type: string) => aiCacheOps.clearByType(type));
  ipcMain.handle('ai-cache-cleanup', (_event, maxAgeDays: number) =>
    aiCacheOps.cleanup(maxAgeDays)
  );
  ipcMain.handle('ai-cache-touch-keys', (_event, keys: Array<{ cacheKey: string; type: string }>) =>
    aiCacheOps.touchKeys(keys)
  );

  ipcMain.handle('ai-request', async (_event, payload: AIRequestPayload) =>
    invokeConfiguredAI(payload)
  );

  // 数据导出/导入
  ipcMain.handle('db-export', () => exportAllData());
  ipcMain.handle('db-import', (_event, data: ExportData) => {
    importData(data);
    return { success: true };
  });

  // 导出到文件
  ipcMain.handle('db-export-to-file', async () => {
    const result = await dialog.showSaveDialog({
      title: '导出数据',
      defaultPath: `novel-editor-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const data = exportAllData();
    await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return result.filePath;
  });

  // 从文件导入
  ipcMain.handle('db-import-from-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入数据',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const content = await readFile(result.filePaths[0], 'utf-8');
    const data = JSON.parse(content) as ExportData;
    importData(data);
    return { success: true, filePath: result.filePaths[0] };
  });

  // ========== SQLite 版本快照 IPC ==========

  ipcMain.handle('db-version-create', async (_event, folderPath: string, message?: string) => {
    return versionOps.createSnapshot(folderPath, message);
  });

  ipcMain.handle('db-version-start-create', (_event, folderPath: string, message?: string) => {
    return createSnapshotJob(folderPath, message);
  });

  ipcMain.handle('db-version-job-status', (_event, jobId: string) => {
    return snapshotJobs.get(jobId) || null;
  });

  ipcMain.handle(
    'db-version-list',
    (_event, folderPath: string, filePath?: string, limit?: number) =>
      versionOps.listSnapshots(folderPath, filePath, limit)
  );

  ipcMain.handle('db-version-delete', async (_event, snapshotId: number) => {
    versionOps.deleteSnapshot(snapshotId);
    return { success: true };
  });

  ipcMain.handle('db-version-rename', async (_event, snapshotId: number, message: string) => {
    versionOps.renameSnapshot(snapshotId, message);
    return { success: true };
  });

  ipcMain.handle(
    'db-version-get-file-content',
    (_event, folderPath: string, snapshotId: number, filePath: string) =>
      versionOps.getSnapshotFileContent(folderPath, snapshotId, filePath)
  );

  ipcMain.handle(
    'db-version-restore-file',
    async (_event, folderPath: string, snapshotId: number, filePath: string) => {
      await versionOps.restoreFileFromSnapshot(folderPath, snapshotId, filePath);
      return { success: true };
    }
  );

  // ========== 文件导入（Word / Excel → Markdown） ==========

  ipcMain.handle('import-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入文件',
      filters: [
        { name: 'Word / Excel', extensions: SUPPORTED_IMPORT_EXTENSIONS.map((e) => e.slice(1)) },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const previews: { fileName: string; content: string; sourcePath: string }[] = [];
    const errors: { filePath: string; error: string }[] = [];

    for (const srcPath of result.filePaths) {
      try {
        const { fileName, content } = await importFile(srcPath);
        previews.push({ fileName, content, sourcePath: srcPath });
      } catch (error) {
        errors.push({
          filePath: srcPath,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    }

    return { previews, errors };
  });

  // ─── 导出项目目录 ─────────────────────────────────────────────────────
  ipcMain.handle('export-project', async (_event, folderPath: string) => {
    // 校验源目录存在
    if (!existsSync(folderPath)) {
      return { success: false, error: '项目目录不存在' };
    }

    const projectName = path.basename(folderPath);
    const result = await dialog.showOpenDialog({
      title: '选择导出位置',
      buttonLabel: '导出到此处',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const destDir = path.join(result.filePaths[0], projectName);

    // 如果目标已存在同名目录，自动重命名
    let finalDest = destDir;
    if (existsSync(finalDest)) {
      let counter = 2;
      while (existsSync(`${destDir} (${counter})`)) {
        counter++;
      }
      finalDest = `${destDir} (${counter})`;
    }

    try {
      await cp(folderPath, finalDest, { recursive: true });
      return { success: true, destPath: finalDest };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // ─── 文档导出 ─────────────────────────────────────────────────────────
  ipcMain.handle(
    'export-to-word',
    async (_event, content: string, options?: { title?: string; author?: string }) => {
      try {
        const filePath = await exportToWord(content, options);
        return { success: !!filePath, filePath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );

  ipcMain.handle(
    'export-project-to-word',
    async (_event, folderPath: string, options?: { title?: string; author?: string }) => {
      try {
        const filePath = await exportProjectToWord(folderPath, options);
        return { success: !!filePath, filePath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );

  ipcMain.handle(
    'export-to-pptx',
    async (_event, content: string, options?: { title?: string; author?: string }) => {
      try {
        const filePath = await exportToPptx(content, options);
        return { success: !!filePath, filePath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );

  // 美化现有 PPT：提取文本内容后使用统一主题重新导出
  ipcMain.handle(
    'beautify-pptx',
    async (_event, sourcePath: string, options?: { title?: string; author?: string }) => {
      try {
        const filePath = await beautifyPptx(sourcePath, options);
        return { success: !!filePath, filePath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );
}
