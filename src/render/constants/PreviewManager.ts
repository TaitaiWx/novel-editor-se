import type { OutlineItem } from '../parsers/types';

// 预览窗动画状态
export enum PreviewAnimationState {
  HIDDEN = 'hidden',
  SHOWING = 'showing',
  VISIBLE = 'visible',
  HIDING = 'hiding',
  TRANSITIONING = 'transitioning', // 内容切换中
}

// 扩展预览数据，包含动画状态
export interface PreviewDataWithState {
  content: string;
  item: OutlineItem;
  filePath: string;
  position: { x: number; y: number };
  animationState: PreviewAnimationState;
}

// 全局预览窗管理器
export class PreviewManager {
  private static instance: PreviewManager;
  private currentPreview: PreviewDataWithState | null = null;
  private listeners: Set<(preview: PreviewDataWithState | null) => void> = new Set();
  private currentItemId: string | null = null;
  private animationTimeouts: Set<NodeJS.Timeout> = new Set(); // 管理所有动画定时器

  static getInstance(): PreviewManager {
    if (!PreviewManager.instance) {
      PreviewManager.instance = new PreviewManager();
    }
    return PreviewManager.instance;
  }

  showPreview(
    content: string,
    item: OutlineItem,
    filePath: string,
    position: { x: number; y: number }
  ) {
    // 清除所有动画定时器
    this.clearAllAnimationTimeouts();
    
    // 检查是否是同一个项目
    if (this.currentItemId === item.id && this.currentPreview) {
      // 同一项目，只更新位置，不改变动画状态
      this.updatePosition(position);
      return;
    }
    
    // 不同项目，需要处理切换
    if (
      this.currentPreview &&
      this.currentPreview.animationState === PreviewAnimationState.VISIBLE
    ) {
      // 当前有预览窗显示，执行过渡动画
      this.startTransition(content, item, filePath, position);
    } else {
      // 没有预览窗或正在隐藏，直接显示新预览
      this.showNewPreview(content, item, filePath, position);
    }
  }

  hidePreview() {
    if (
      !this.currentPreview ||
      this.currentPreview.animationState === PreviewAnimationState.HIDING
    ) {
      return;
    }
    
    // 清除所有动画定时器
    this.clearAllAnimationTimeouts();
    
    // 开始隐藏动画
    this.currentPreview.animationState = PreviewAnimationState.HIDING;
    this.notifyListeners();
    
    // 100ms 后完全隐藏
    const timeout = setTimeout(() => {
      this.currentPreview = null;
      this.currentItemId = null;
      this.notifyListeners();
    }, 100);
    
    this.animationTimeouts.add(timeout);
  }

  private showNewPreview(
    content: string,
    item: OutlineItem,
    filePath: string,
    position: { x: number; y: number }
  ) {
    this.currentItemId = item.id;
    this.currentPreview = {
      content,
      item,
      filePath,
      position,
      animationState: PreviewAnimationState.SHOWING,
    };
    this.notifyListeners();
    
    // 动画完成后设置为可见状态
    const timeout = setTimeout(() => {
      if (this.currentPreview) {
        this.currentPreview.animationState = PreviewAnimationState.VISIBLE;
        this.notifyListeners();
      }
    }, 100);
    
    this.animationTimeouts.add(timeout);
  }

  private startTransition(
    content: string,
    item: OutlineItem,
    filePath: string,
    position: { x: number; y: number }
  ) {
    if (!this.currentPreview) return;
    
    // 开始过渡动画
    this.currentPreview.animationState = PreviewAnimationState.TRANSITIONING;
    this.notifyListeners();
    
    // 100ms 后更新内容并完成过渡
    const timeout = setTimeout(() => {
      this.currentItemId = item.id;
      this.currentPreview = {
        content,
        item,
        filePath,
        position,
        animationState: PreviewAnimationState.VISIBLE,
      };
      this.notifyListeners();
    }, 100);
    
    this.animationTimeouts.add(timeout);
  }

  private clearAllAnimationTimeouts() {
    this.animationTimeouts.forEach((timeout) => {
      clearTimeout(timeout);
    });
    this.animationTimeouts.clear();
  }

  updatePosition(position: { x: number; y: number }) {
    if (this.currentPreview) {
      this.currentPreview.position = position;
      this.notifyListeners();
    }
  }

  getCurrentPreview() {
    return this.currentPreview;
  }

  getCurrentItemId() {
    return this.currentItemId;
  }

  subscribe(listener: (preview: PreviewDataWithState | null) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => listener(this.currentPreview));
  }

  // 清理所有资源
  destroy() {
    this.clearAllAnimationTimeouts();
    this.currentPreview = null;
    this.currentItemId = null;
    this.listeners.clear();
  }
}
