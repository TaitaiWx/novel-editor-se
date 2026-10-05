import { useRef, useState } from 'react';
import type { ContextMenuState, CreatingType, KnowledgeExportOptions } from '@/render/app/types';
import type { SettingsTab } from '@/render/components/AppSettingsCenter';
import { useDialog } from '@/render/components/Dialog';
import { useToast } from '@/render/components/Toast';

// 显式命名上下文类型，便于声明文件输出（原始接口未导出）
type RawToastApi = ReturnType<typeof useToast>;
type RawDialogApi = ReturnType<typeof useDialog>;
export type ToastApi = Pick<RawToastApi, keyof RawToastApi>;
export type DialogApi = Pick<RawDialogApi, keyof RawDialogApi>;

/**
 * 界面交互领域状态：提示/对话框 API、右键菜单、内联新建、文件剪贴板、文件树定位请求，
 * 以及各弹窗（快捷键、设置中心、AI 助手、版本历史、知识导出）的显隐（只声明，不含副作用）
 */
export function useUiState() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [creatingType, setCreatingType] = useState<CreatingType>(null);
  const [clipboard, setClipboard] = useState<string[]>([]);
  const [filePanelRevealRequest, setFilePanelRevealRequest] = useState<{
    path: string;
    id: string;
  } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettingsCenter, setShowSettingsCenter] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [settingsCenterTab, setSettingsCenterTab] = useState<SettingsTab>('general');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showKnowledgeExportDialog, setShowKnowledgeExportDialog] = useState(false);
  const [knowledgeExportOptions, setKnowledgeExportOptions] = useState<KnowledgeExportOptions>({
    includeCharacters: true,
    includeLore: true,
    includeMaterials: true,
  });

  const toast: ToastApi = useToast();
  const dialog: DialogApi = useDialog();
  const filePanelRevealCounterRef = useRef(0);

  return {
    toast,
    dialog,
    contextMenu,
    setContextMenu,
    creatingType,
    setCreatingType,
    clipboard,
    setClipboard,
    filePanelRevealRequest,
    setFilePanelRevealRequest,
    filePanelRevealCounterRef,
    showShortcuts,
    setShowShortcuts,
    showSettingsCenter,
    setShowSettingsCenter,
    showAIAssistant,
    setShowAIAssistant,
    settingsCenterTab,
    setSettingsCenterTab,
    showVersionHistory,
    setShowVersionHistory,
    showKnowledgeExportDialog,
    setShowKnowledgeExportDialog,
    knowledgeExportOptions,
    setKnowledgeExportOptions,
  };
}

export type UiState = ReturnType<typeof useUiState>;
