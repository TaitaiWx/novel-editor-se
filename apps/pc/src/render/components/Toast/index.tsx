import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import styles from './styles.module.scss';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
  dismissing: boolean;
}

interface ToastOptions {
  type?: ToastType;
  duration?: number;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const DISMISS_ANIMATION_MS = 300;
const MAX_TOASTS = 5;

interface ToastItemComponentProps {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}

const ToastItemComponent: React.FC<ToastItemComponentProps> = ({ toast, onDismiss }) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toast.duration > 0) {
      timerRef.current = setTimeout(() => {
        onDismiss(toast.id);
      }, toast.duration);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [toast.id, toast.duration, onDismiss]);

  const typeClass = styles[toast.type] || '';
  const dismissClass = toast.dismissing ? styles.dismissing : '';

  return (
    <div className={`${styles.toast} ${typeClass} ${dismissClass}`}>
      <span className={styles.icon}>{ICONS[toast.type]}</span>
      <span className={styles.message}>{toast.message}</span>
      <button className={styles.closeBtn} onClick={() => onDismiss(toast.id)} aria-label="关闭通知">
        ✕
      </button>
      {toast.duration > 0 && (
        <div className={styles.progressBar} style={{ animationDuration: `${toast.duration}ms` }} />
      )}
    </div>
  );
};

interface ToastProviderProps {
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idCounter = useRef(0);

  const dismiss = useCallback((id: number) => {
    // Start dismiss animation
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)));
    // Remove after animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DISMISS_ANIMATION_MS);
  }, []);

  const show = useCallback((message: string, options?: ToastOptions) => {
    const id = ++idCounter.current;
    const type = options?.type ?? 'info';
    const duration = options?.duration ?? 3000;

    setToasts((prev) => {
      const next = [...prev, { id, type, message, duration, dismissing: false }];
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
    });
  }, []);

  const success = useCallback(
    (message: string, duration?: number) => show(message, { type: 'success', duration }),
    [show]
  );
  const error = useCallback(
    (message: string, duration?: number) => show(message, { type: 'error', duration }),
    [show]
  );
  const warning = useCallback(
    (message: string, duration?: number) => show(message, { type: 'warning', duration }),
    [show]
  );
  const info = useCallback(
    (message: string, duration?: number) => show(message, { type: 'info', duration }),
    [show]
  );

  const contextValue: ToastContextValue = { show, success, error, warning, info };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className={styles.container}>
        {toasts.map((toast) => (
          <ToastItemComponent key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export default ToastProvider;
