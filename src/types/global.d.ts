/// <reference types="vite/client" />

import type { ElectronAPI } from './electron-api';

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};

declare module '*.scss' {
  const content: { readonly [className: string]: string };
  export default content;
}

declare module '*.sass' {
  const content: { readonly [className: string]: string };
  export default content;
}

declare module '*.css' {
  const content: { readonly [className: string]: string };
  export default content;
}

declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.sass' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
