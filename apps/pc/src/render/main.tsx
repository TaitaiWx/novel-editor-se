import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AIStandaloneApp } from './AIStandaloneApp';
import { ToastProvider } from './components/Toast';
import { DialogProvider } from './components/Dialog';

import './styles/global.scss';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = ReactDOM.createRoot(rootElement);

// 检测是否为 AI 助手独立窗口模式
const params = new URLSearchParams(window.location.search);
const isAIMode = params.get('mode') === 'ai-assistant';

root.render(
  <React.StrictMode>
    <ToastProvider>
      <DialogProvider>{isAIMode ? <AIStandaloneApp /> : <App />}</DialogProvider>
    </ToastProvider>
  </React.StrictMode>
);
