import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { isImeComposing } from '../../utils/ime';
import styles from './styles.module.scss';

type DialogMode = 'confirm' | 'prompt';

interface DialogState {
  mode: DialogMode;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  resolve: (value: boolean | string | null) => void;
}

interface DialogContextValue {
  confirm: (title: string, message?: string) => Promise<boolean>;
  prompt: (title: string, placeholder?: string, defaultValue?: string) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

interface DialogProviderProps {
  children: React.ReactNode;
}

// Focus trap helper: get all focusable elements inside a container
const getFocusableElements = (container: HTMLElement): HTMLElement[] => {
  const elements = container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  return Array.from(elements);
};

interface DialogContentProps {
  dialog: DialogState;
  onClose: () => void;
}

const DialogContent: React.FC<DialogContentProps> = ({ dialog, onClose }) => {
  const [inputValue, setInputValue] = useState(dialog.defaultValue ?? '');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus management
  useEffect(() => {
    if (dialog.mode === 'prompt' && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else if (dialogRef.current) {
      // Focus the dialog so keyboard events work
      const confirmBtn = dialogRef.current.querySelector<HTMLElement>(`.${styles.confirmBtn}`);
      confirmBtn?.focus();
    }
  }, [dialog.mode]);

  // Focus trap
  useEffect(() => {
    const container = dialogRef.current;
    if (!container) return;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, []);

  const handleConfirm = useCallback(() => {
    if (dialog.mode === 'confirm') {
      dialog.resolve(true);
    } else {
      dialog.resolve(inputValue);
    }
    onClose();
  }, [dialog, inputValue, onClose]);

  const handleCancel = useCallback(() => {
    if (dialog.mode === 'confirm') {
      dialog.resolve(false);
    } else {
      dialog.resolve(null);
    }
    onClose();
  }, [dialog, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleConfirm, handleCancel]
  );

  // Prevent clicks on overlay from propagating, close dialog on overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleCancel();
      }
    },
    [handleCancel]
  );

  return (
    <div className={styles.overlay} onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className={styles.dialog} ref={dialogRef} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <h3 className={styles.title}>{dialog.title}</h3>
        </div>

        <div className={styles.body}>
          {dialog.message && <p className={styles.message}>{dialog.message}</p>}

          {dialog.mode === 'prompt' && (
            <input
              ref={inputRef}
              className={styles.input}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={dialog.placeholder ?? ''}
              spellCheck={false}
            />
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={handleCancel}>
            {dialog.cancelText ?? '取消'}
          </button>
          <button className={styles.confirmBtn} onClick={handleConfirm}>
            {dialog.confirmText ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const DialogProvider: React.FC<DialogProviderProps> = ({ children }) => {
  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  const confirm = useCallback((title: string, message?: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setDialogState({
        mode: 'confirm',
        title,
        message,
        resolve: resolve as (value: boolean | string | null) => void,
      });
    });
  }, []);

  const prompt = useCallback(
    (title: string, placeholder?: string, defaultValue?: string): Promise<string | null> => {
      return new Promise<string | null>((resolve) => {
        setDialogState({
          mode: 'prompt',
          title,
          placeholder,
          defaultValue,
          resolve: resolve as (value: boolean | string | null) => void,
        });
      });
    },
    []
  );

  const handleClose = useCallback(() => {
    setDialogState(null);
  }, []);

  const contextValue: DialogContextValue = { confirm, prompt };

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
      {dialogState && <DialogContent dialog={dialogState} onClose={handleClose} />}
    </DialogContext.Provider>
  );
};

export const useDialog = (): DialogContextValue => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
};

export default DialogProvider;
