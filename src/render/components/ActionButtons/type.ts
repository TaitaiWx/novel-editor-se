export interface ActionButtonsProps {
  onCreateFile?: () => void;
  onCreateDirectory?: () => void;
  onRefresh?: () => void;
  onOpenFolder?: () => void;
  isLoading?: boolean;
  hasFolder?: boolean;
  folderButtonTitle?: string;
}
