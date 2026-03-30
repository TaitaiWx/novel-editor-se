import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
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

const root = ReactDOM.createRoot(rootElement);

// 检测独立窗口模式
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');

const resolveApp = () => {
  if (mode === 'ai-assistant') return <AIStandaloneApp />;
  if (mode === 'right-panel') return <RightPanelStandaloneApp />;
  return <App />;
};

root.render(
  <React.StrictMode>
    <ToastProvider>
      <DialogProvider>
        <Suspense
          fallback={<div style={{ padding: 24, color: 'rgba(255,255,255,0.62)' }}>正在加载...</div>}
        >
          {resolveApp()}
        </Suspense>
      </DialogProvider>
    </ToastProvider>
  </React.StrictMode>
);
