/**
 * 全局类型声明
 */

import type { ElectronAPI } from './electron-api';

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

declare module '*.svg' {
  const src: string;
  export default src;
}

export {};
