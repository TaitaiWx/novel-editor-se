import { contextBridge, ipcRenderer, webUtils } from 'electron';

type IpcListener = Parameters<typeof ipcRenderer.on>[1];

// ── MessagePort 转发 ────────────────────────────────────────
// 将 main process 通过 webContents.postMessage 发来的 MessagePort
// 从隔离的 preload 世界转发到渲染进程的 main world。
// 这是 Electron contextIsolation 下传递 MessagePort 的官方模式。
ipcRenderer.on('port-transfer', (event, channelName: string) => {
  window.postMessage(
    { type: 'port-transfer', channelName },
    '*',
    event.ports as unknown as MessagePort[]
  );
});

// Electron 32+ 已移除 File.path，需在 preload 中通过 webUtils.getPathForFile 获取。
// 在 capture 阶段拦截 drop 事件提取路径，供隔离的渲染进程读取。
let lastDroppedPaths: string[] = [];
document.addEventListener(
  'drop',
  (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      lastDroppedPaths = Array.from(files)
        .map((f) => webUtils.getPathForFile(f))
        .filter(Boolean);
    }
  },
  { capture: true }
);

contextBridge.exposeInMainWorld('electron', {
  // 开发者调试模式：只有 NOVEL_EDITOR_DEBUG=1 时界面才显示原始提示词 / JSON
  debug: process.env.NOVEL_EDITOR_DEBUG === '1',
  getLastDroppedPaths: (): string[] => {
    const paths = lastDroppedPaths;
    lastDroppedPaths = [];
    return paths;
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      const validChannels = [
        'open-local-folder',
        'read-file',
        'read-file-binary',
        'read-xlsx-data',
        'write-file',
        // GUI 会话文件（供 CLI ne status 读取打开的文件与未保存变更）
        'gui-session-publish',
        'get-file-info',
        'get-file-info-batch',
        'get-files-exist',
        'get-default-data-path',
        'get-recent-folders',
        'get-last-folder',
        'sample-data-take-upgrade-notice',
        'add-recent-folder',
        'app-cache-clear',
        'open-sample-data',
        'get-changelog',
        'check-just-updated',
        'create-file',
        'create-directory',
        'refresh-folder',
        'cleanup-empty-generated-material-directories',
        'window-minimize',
        'window-maximize',
        'window-close',
        'window-is-maximized',
        'app-renderer-ready',
        'app-renderer-health-ready',
        'app-quit',
        'dev-tools-toggle',
        'window-toggle-fullscreen',
        'get-shortcuts',
        // 设置中心自定义快捷键同步到应用菜单
        'menu-sync-shortcuts',
        'get-app-version',
        'get-device-id',
        // 关于小说编辑器
        'get-about-info',
        'about-copy-text',
        // 日志上传
        'log-upload-run',
        'get-system-profile',
        'get-webauthn-support',
        'update-check',
        'update-status',
        'update-download',
        'update-install',
        'update-rollback',
        'delete-file',
        'delete-directory',
        'rename-file',
        'paste-files',
        'read-clipboard-file-paths',
        // SQLite 数据库
        'db-init',
        'db-init-default',
        'db-close',
        'db-novel-create',
        'db-novel-list',
        'db-novel-get',
        'db-novel-get-by-folder',
        'db-novel-update',
        'db-novel-delete',
        'db-character-create',
        'db-character-list',
        'db-character-update',
        'db-character-reorder',
        'db-character-delete',
        'db-character-clear-by-novel',
        'db-outline-list-by-folder',
        'db-outline-replace-by-folder',
        'db-outline-clear-by-folder',
        'db-outline-reorder-by-folder',
        'db-outline-version-list-by-folder',
        'db-outline-version-create-by-folder',
        'db-outline-version-apply-by-folder',
        'db-outline-version-update',
        'db-outline-version-delete',
        'db-story-idea-card-list-by-folder',
        'db-story-idea-card-create-by-folder',
        'db-story-idea-card-update',
        'db-story-idea-card-delete',
        'db-story-idea-output-list',
        'db-story-idea-output-replace-by-folder',
        'db-story-idea-output-update',
        'db-story-idea-output-select',
        'db-story-idea-output-delete',
        'db-world-setting-list-by-folder',
        'db-world-setting-create-by-folder',
        'db-world-setting-bulk-create-by-folder',
        'db-world-setting-update',
        'db-world-setting-delete',
        'db-world-setting-clear-by-folder',
        'db-stats-record',
        'db-stats-range',
        'db-stats-today',
        'db-settings-get',
        'db-settings-set',
        'db-settings-delete-prefixes',
        'db-settings-all',
        // AI 缓存
        'ai-cache-get',
        'ai-cache-set',
        'ai-cache-delete',
        'ai-cache-get-by-type',
        'ai-cache-clear-by-type',
        'ai-cache-cleanup',
        'ai-cache-touch-keys',
        'ai-request',
        'db-export',
        'db-import',
        'db-export-to-file',
        'db-export-knowledge-text',
        'db-import-from-file',
        // SQLite 版本快照
        'db-version-create',
        'db-version-start-create',
        'db-version-job-status',
        'db-version-list',
        'db-version-delete',
        'db-version-rename',
        'db-version-get-file-content',
        'db-version-restore-file',
        // 文件导入
        'import-file',
        'import-structured-file',
        // 文档导出
        'export-to-word',
        'export-project-to-word',
        'export-to-pptx',
        // 项目导出
        'export-project',
        // 外部编辑 & 文件监视
        'open-in-system-app',
        // 项目菜单「在访达 / 资源管理器中显示」（主进程只接受已存在的绝对路径）
        'show-item-in-folder',
        // Markdown 实时预览中 ⌘/Ctrl + 点击链接（主进程只放行 http(s) / mailto）
        'open-external-url',
        'watch-file',
        'unwatch-file',
        // PPT 预览
        'read-pptx-data',
        // Word 预览
        'read-docx-data',
        // PPT 美化
        'beautify-pptx',
        // AI 助手
        'save-analysis-file',
        'open-ai-assistant-window',
        'open-right-panel-window',
        'ai-window-request-open-file',
        'ai-window-request-open-settings',
        'ai-window-apply-fix',
        'ai-save-session-state',
        // 成长记录器 / 记忆库
        'growth-load',
        'growth-init',
        'growth-ensure-sheet',
        'growth-apply-event',
        'growth-update-notes',
        'growth-save-ruleset',
        'growth-save-party',
        'growth-save-atlas',
        'growth-simulate',
        'growth-apply-branch',
        'memory-sync-snapshots',
        // AI 服务（Key 只写不读）、一次性 / 流式补全
        'ai-providers-list',
        'ai-providers-get',
        'ai-providers-set',
        'ai-providers-test',
        'ai-providers-add-custom',
        'ai-providers-remove-custom',
        'ai-providers-set-default',
        'ai-complete',
        'ai-stream-start',
        'ai-stream-cancel',
        // 文件面板全文搜索（main/handlers/workspace-search.ts）
        'workspace-search-content',
        // 人物头像（保存到 <作品>/资料/人物头像/）
        'character-avatar-save',
        // 单个图片 / 视频导出（另存为，main/handlers/media-export.ts）
        'media-export',
        // 播放器截图 / 录制结果另存为（main/handlers/media-save.ts）
        'media-save-generated',
        // 人物 / 设定图集（资料/图集/）与 AI 出图（main/handlers/entity-media.ts）
        'entity-image-save',
        'entity-image-delete',
        'ai-image-generate',
        // 场景视频任务
        'video-task-submit',
        'video-task-list',
        'video-task-cancel',
        'video-task-retry',
        'video-settings-get',
        'video-settings-set',
        // 场景视频工作区（分镜.json / 分镜.md、成片预览、拼接样片；main/handlers/video-scene.ts）
        'video-scene-load',
        'video-scene-save',
        'video-scene-read-file',
        'video-scene-write-animatic',
        'video-scene-write-image',
        // 预演视频（镜头N-预演.mp4，3D 预演逐帧导出）
        'video-scene-write-media',
        // 场景声音：对白配音（写入场景目录）、导入本地配乐 / 音效（main/handlers/scene-audio.ts）
        'ai-speech-synthesize',
        'scene-audio-import',
        'scene-audio-read',
        // 正文结构规则（设置 → 正文结构，main/handlers/project-structure.ts）
        'project-structure-get',
        'project-structure-set',
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      throw new Error(`Unauthorized IPC channel: ${channel}`);
    },
    on: (channel: string, listener: IpcListener) => {
      const validChannels = [
        'shortcut-new-file',
        'shortcut-open-folder',
        'shortcut-save-file',
        'shortcut-save-as-file',
        'menu-export-project',
        'menu-open-about',
        // 应用菜单事件（通道定义见 src/shared/app-menu.ts）
        'menu-open-settings',
        'menu-check-updates',
        'menu-toggle-sidebar',
        'menu-toggle-right-panel',
        'menu-toggle-focus-mode',
        'menu-find',
        'menu-open-inspiration',
        'menu-open-scene-video',
        'menu-show-shortcuts',
        'menu-open-changelog',
        'menu-upload-logs',
        'settings-updated',
        'update-available',
        'update-not-available',
        'update-download-progress',
        'update-downloaded',
        'update-state-changed',
        'update-rollback-available',
        'file-changed',
        // AI 流式输出片段、视频任务状态变化（main/handlers/ai-providers.ts、video.ts）
        'ai-stream-event',
        'video-task-updated',
        // 正文结构规则保存后广播
        'project-structure-changed',
        'open-file-from-ai',
        'open-settings-from-ai',
        'ai-apply-fix-request',
        'right-panel-window-closed',
        'open-folder-request',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, listener);
        // 返回 disposer，避免 contextBridge 代理导致 removeListener 无法匹配引用
        return () => {
          ipcRenderer.removeListener(channel, listener);
        };
      } else {
        throw new Error(`Unauthorized IPC channel: ${channel}`);
      }
    },
    removeListener: (channel: string, listener: IpcListener) => {
      const validChannels = [
        'shortcut-new-file',
        'shortcut-open-folder',
        'shortcut-save-file',
        'shortcut-save-as-file',
        'menu-export-project',
        'menu-open-about',
        // 应用菜单事件（通道定义见 src/shared/app-menu.ts）
        'menu-open-settings',
        'menu-check-updates',
        'menu-toggle-sidebar',
        'menu-toggle-right-panel',
        'menu-toggle-focus-mode',
        'menu-find',
        'menu-open-inspiration',
        'menu-open-scene-video',
        'menu-show-shortcuts',
        'menu-open-changelog',
        'menu-upload-logs',
        'settings-updated',
        'update-available',
        'update-not-available',
        'update-download-progress',
        'update-downloaded',
        'update-state-changed',
        'update-rollback-available',
        'file-changed',
        // AI 流式输出片段、视频任务状态变化（main/handlers/ai-providers.ts、video.ts）
        'ai-stream-event',
        'video-task-updated',
        // 正文结构规则保存后广播
        'project-structure-changed',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, listener);
      } else {
        throw new Error(`Unauthorized IPC channel: ${channel}`);
      }
    },
    removeAllListeners: (channel: string) => {
      const validChannels = [
        'shortcut-new-file',
        'shortcut-open-folder',
        'shortcut-save-file',
        'shortcut-save-as-file',
        'menu-export-project',
        'menu-open-about',
        'settings-updated',
        'update-available',
        'update-not-available',
        'update-download-progress',
        'update-downloaded',
        'update-state-changed',
        'update-rollback-available',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      } else {
        throw new Error(`Unauthorized IPC channel: ${channel}`);
      }
    },
  },
});
