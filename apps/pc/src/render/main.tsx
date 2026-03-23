import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AIStandaloneApp } from './AIStandaloneApp';
import { RightPanelStandaloneApp } from './RightPanelStandaloneApp';
import { ToastProvider } from './components/Toast';
import { DialogProvider } from './components/Dialog';

// MessagePort 全局监听器：必须在 React 渲染前注册，确保端口到达时不会丢失
import './utils/messagePortChannel';

import './styles/global.scss';

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
      <DialogProvider>{resolveApp()}</DialogProvider>
    </ToastProvider>
  </React.StrictMode>
);
