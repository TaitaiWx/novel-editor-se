import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { ToastProvider } from './components/Toast';
import { DialogProvider } from './components/Dialog';

// MessagePort 全局监听器：必须在 React 渲染前注册，确保端口到达时不会丢失
import './utils/messagePortChannel';

import './styles/global.scss';

const App = lazy(() => import('./App'));
const AIStandaloneApp = lazy(async () => ({
  default: (await import('./AIStandaloneApp')).AIStandaloneApp,
}));
const RightPanelStandaloneApp = lazy(async () => ({
  default: (await import('./RightPanelStandaloneApp')).RightPanelStandaloneApp,
}));

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

type RootWindow = Window & {
  __NOVEL_EDITOR_REACT_ROOT__?: Root;
  __NOVEL_EDITOR_REACT_ROOT_ELEMENT__?: HTMLElement | null;
};

type RootElement = HTMLElement & {
  __NOVEL_EDITOR_REACT_ROOT__?: Root;
};

const rootWindow = window as RootWindow;
const rootHost = rootElement as RootElement;
const root =
  rootHost.__NOVEL_EDITOR_REACT_ROOT__ ??
  (rootWindow.__NOVEL_EDITOR_REACT_ROOT__ &&
  rootWindow.__NOVEL_EDITOR_REACT_ROOT_ELEMENT__ === rootElement
    ? rootWindow.__NOVEL_EDITOR_REACT_ROOT__
    : ReactDOM.createRoot(rootElement));

rootHost.__NOVEL_EDITOR_REACT_ROOT__ = root;
rootWindow.__NOVEL_EDITOR_REACT_ROOT__ = root;
rootWindow.__NOVEL_EDITOR_REACT_ROOT_ELEMENT__ = rootElement;

// 检测独立窗口模式
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');

const resolveApp = () => {
  if (mode === 'ai-assistant') return <AIStandaloneApp />;
  if (mode === 'right-panel') return <RightPanelStandaloneApp />;
  return <App />;
};

const bootFallback = (
  <div
    style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      background: '#1e1e1e',
      color: 'rgba(255,255,255,0.64)',
    }}
  >
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: '3px solid rgba(255,255,255,0.12)',
        borderTopColor: '#569cd6',
        animation: 'spin 1s linear infinite',
      }}
    />
    <div style={{ fontSize: 13, letterSpacing: 0.4 }}>正在启动...</div>
  </div>
);

root.render(
  <React.StrictMode>
    <ToastProvider>
      <DialogProvider>
        <Suspense fallback={bootFallback}>{resolveApp()}</Suspense>
      </DialogProvider>
    </ToastProvider>
  </React.StrictMode>
);
