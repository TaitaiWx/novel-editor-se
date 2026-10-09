/**
 * 基于 CDP 的页面操作封装：执行脚本、等待条件、真实鼠标/键盘输入、截图、收集控制台错误
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CdpClient, CdpParams } from './cdp';

/** 页面内可被 JSON 序列化的参数 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * 元素定位方式：
 * - 字符串：CSS 选择器
 * - { text }：按可见文本定位（优先完全匹配，其次包含匹配；取最内层可见元素）
 * - { text, within }：限定在某个 CSS 选择器范围内按文本定位
 */
export type Target = string | { text: string; within?: string; exact?: boolean };

export interface ConsoleIssue {
  kind: 'console' | 'exception' | 'log';
  text: string;
}

interface RemoteObject {
  type: string;
  value?: unknown;
  description?: string;
}

interface ExceptionDetails {
  text: string;
  exception?: RemoteObject;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type MouseButton = 'left' | 'right';

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;
export type Modifier = keyof typeof MODIFIER_BITS;

/** 平台上的「主修饰键」：macOS 为 Command，其它平台为 Ctrl */
export const PRIMARY_MODIFIER: Modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 特殊按键的 key / code / keyCode 映射 */
const SPECIAL_KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Tab: { code: 'Tab', keyCode: 9 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  F2: { code: 'F2', keyCode: 113 },
  // 标点键：code / keyCode 与真实键盘一致（'\\'.charCodeAt 是 92，真实 VK_OEM_5 是 220）
  '\\': { code: 'Backslash', keyCode: 220, text: '\\' },
  '[': { code: 'BracketLeft', keyCode: 219, text: '[' },
  ']': { code: 'BracketRight', keyCode: 221, text: ']' },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** NOVEL_EDITOR_E2E_TRACE=1 时输出每个等待步骤的耗时，便于定位慢步骤 / 偶发卡顿 */
const TRACE = process.env.NOVEL_EDITOR_E2E_TRACE === '1';
function trace(label: string, startedAt: number): void {
  if (TRACE) process.stderr.write(`[e2e] ${Date.now() - startedAt}ms ${label}\n`);
}

/**
 * 在页面内定位元素并返回中心点坐标。以字符串形式注入，避免依赖打包。
 * 返回 null 表示未找到可见元素。
 */
const LOCATE_SOURCE = `(target) => {
  const isVisible = (el) => {
    // 任何元素都按布局盒判断（KaTeX 输出的 <math> 是 MathMLElement，既不是 HTML 也不是 SVG）
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
  };
  const textOf = (el) => (el.innerText ?? el.textContent ?? '').replace(/\\s+/g, ' ').trim();
  let el = null;
  if (typeof target === 'string') {
    el = Array.from(document.querySelectorAll(target)).find(isVisible) ?? null;
  } else {
    const roots = target.within
      ? Array.from(document.querySelectorAll(target.within)).filter(isVisible)
      : [document.body];
    const wanted = target.text.replace(/\\s+/g, ' ').trim();
    const candidates = [];
    for (const root of roots) {
      for (const node of root.querySelectorAll('*')) {
        if (!isVisible(node)) continue;
        const text = textOf(node);
        const title = node.getAttribute('title') ?? node.getAttribute('aria-label') ?? '';
        if (text === wanted || title === wanted) candidates.push({ node, exact: true });
        else if (!target.exact && text.includes(wanted)) candidates.push({ node, exact: false });
      }
    }
    const pool = candidates.some((c) => c.exact) ? candidates.filter((c) => c.exact) : candidates;
    // 取最内层：不包含其它候选的那个节点
    const innermost = pool.filter(
      (c) => !pool.some((other) => other !== c && c.node.contains(other.node))
    );
    el = innermost[0]?.node ?? null;
    // 文本命中的可能是按钮内的 span，交给最近的可交互祖先接收点击
    const interactive = el?.closest?.('button, a, [role="button"], [role="tab"], [role="menuitem"], [role="treeitem"], label');
    if (interactive && isVisible(interactive)) el = interactive;
  }
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  // 记下定位到的元素，供点击前的遮挡检查使用
  window.__e2eLocated = el;
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}`;

/**
 * 点击前的定位：在 LOCATE_SOURCE 基础上等两帧确认位置稳定，并确认中心点落在元素自身上。
 * 异步数据刚到、列表重排时坐标会变，被浮层盖住时点不到；返回 null 让调用方下一轮重试。
 */
/** 等待位置稳定的最长时间，超过后按普通定位点击 */
const STABLE_LOCATE_MS = 1_500;

const STABLE_LOCATE_SOURCE = `async (target) => {
  const locate = ${LOCATE_SOURCE};
  const first = locate(target);
  if (!first) return null;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const rect = locate(target);
  if (!rect) return null;
  const moved = ['x', 'y', 'width', 'height'].some((key) => Math.abs(rect[key] - first[key]) > 1);
  if (moved) return null;
  const el = window.__e2eLocated;
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  // 中心点落在目标自身、它的子元素或承载它的容器上才算可点；被其他元素盖住时下一轮再试
  if (el && hit && hit !== el && !el.contains(hit) && !hit.contains(el)) return null;
  return rect;
}`;

function describeTarget(target: Target): string {
  return typeof target === 'string' ? target : `文本「${target.text}」`;
}

function describeRemote(object: RemoteObject | undefined): string {
  if (!object) return '';
  if (typeof object.value === 'string') return object.value;
  if (object.value !== undefined) return JSON.stringify(object.value);
  return object.description ?? object.type;
}

export class Page {
  private readonly issues: ConsoleIssue[] = [];

  constructor(
    readonly cdp: CdpClient,
    private readonly artifactsDir: string
  ) {
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error' && params.type !== 'assert') return;
      const args = (params.args as RemoteObject[] | undefined) ?? [];
      this.issues.push({ kind: 'console', text: args.map(describeRemote).join(' ') });
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails as ExceptionDetails | undefined;
      const text = details
        ? `${details.text} ${describeRemote(details.exception)}`.trim()
        : 'unknown exception';
      this.issues.push({ kind: 'exception', text });
    });
    cdp.on('Log.entryAdded', (params) => {
      const entry = params.entry as { level?: string; text?: string; source?: string } | undefined;
      if (entry?.level !== 'error') return;
      this.issues.push({ kind: 'log', text: `[${entry.source ?? 'log'}] ${entry.text ?? ''}` });
    });
  }

  async init(): Promise<void> {
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Page.enable');
    await this.cdp.send('Log.enable');
    // 窗口在后台运行时没有系统焦点：模拟页面始终有焦点（document.hasFocus、:focus、focus 事件与前台一致）
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }

  /** 取出并清空目前收集到的控制台错误 / 未捕获异常 */
  takeIssues(): ConsoleIssue[] {
    return this.issues.splice(0, this.issues.length);
  }

  /**
   * 在页面中执行函数。函数会被 toString 后注入，因此不能引用外部闭包变量，
   * 需要的数据通过 args 传入（必须可 JSON 序列化）。
   */
  async evaluate<T>(
    fn: string | ((...args: never[]) => unknown),
    ...args: JsonValue[]
  ): Promise<T> {
    const source = typeof fn === 'string' ? fn : fn.toString();
    const expression = `(${source})(...${JSON.stringify(args)})`;
    const result = await this.cdp.send<{
      result: RemoteObject;
      exceptionDetails?: ExceptionDetails;
    }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `页面脚本执行失败: ${result.exceptionDetails.text} ${describeRemote(result.exceptionDetails.exception)}`
      );
    }
    return result.result.value as T;
  }

  /** 轮询直到页面函数返回真值，返回该值 */
  async waitFor<T>(
    fn: string | ((...args: never[]) => unknown),
    options: { timeout?: number; message?: string; args?: JsonValue[] } = {}
  ): Promise<T> {
    const { timeout = 10_000, message, args = [] } = options;
    const startedAt = Date.now();
    const deadline = startedAt + timeout;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        const value = await this.evaluate<T>(fn, ...args);
        if (value) {
          trace(message ?? 'waitFor', startedAt);
          return value;
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(100);
    }
    const reason = lastError instanceof Error ? `（最后一次错误: ${lastError.message}）` : '';
    throw new Error(`等待超时 ${timeout}ms: ${message ?? String(fn).slice(0, 120)}${reason}`);
  }

  /** 轮询 Node 侧条件（例如磁盘文件内容），返回第一个真值 */
  async waitUntil<T>(
    check: () => T | Promise<T>,
    options: { timeout?: number; message?: string } = {}
  ): Promise<NonNullable<T>> {
    const { timeout = 10_000, message = 'Node 侧条件' } = options;
    const startedAt = Date.now();
    const deadline = startedAt + timeout;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        const value = await check();
        if (value) {
          trace(message, startedAt);
          return value as NonNullable<T>;
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(100);
    }
    const reason = lastError instanceof Error ? `（最后一次错误: ${lastError.message}）` : '';
    throw new Error(`等待超时 ${timeout}ms: ${message}${reason}`);
  }

  async exists(target: Target): Promise<boolean> {
    const rect = await this.evaluate<Rect | null>(
      `(target) => { const r = (${LOCATE_SOURCE})(target); return r; }`,
      target
    );
    return rect !== null;
  }

  async waitForTarget(target: Target, timeout = 10_000): Promise<void> {
    await this.waitFor(`(target) => (${LOCATE_SOURCE})(target) !== null`, {
      timeout,
      args: [target],
      message: `元素出现: ${describeTarget(target)}`,
    });
  }

  async waitForGone(target: Target, timeout = 10_000): Promise<void> {
    await this.waitFor(`(target) => (${LOCATE_SOURCE})(target) === null`, {
      timeout,
      args: [target],
      message: `元素消失: ${describeTarget(target)}`,
    });
  }

  /** 定位元素中心点（会先滚动到可见区域），找不到时在超时内重试 */
  async locate(target: Target, timeout = 10_000): Promise<{ x: number; y: number }> {
    const message = `定位元素: ${describeTarget(target)}`;
    let rect: Rect;
    try {
      // 先等位置稳定、没有被遮住（最多 STABLE_LOCATE_MS）；一直在动的元素（滚动容器、动画）退回普通定位
      rect = await this.waitFor<Rect>(`(target) => (${STABLE_LOCATE_SOURCE})(target)`, {
        timeout: Math.min(timeout, STABLE_LOCATE_MS),
        args: [target],
        message,
      });
    } catch {
      rect = await this.waitFor<Rect>(`(target) => (${LOCATE_SOURCE})(target)`, {
        timeout,
        args: [target],
        message,
      });
    }
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  async mouseClick(
    x: number,
    y: number,
    options: { button?: MouseButton; clickCount?: number; modifiers?: Modifier[] } = {}
  ): Promise<void> {
    const { button = 'left', clickCount = 1, modifiers = [] } = options;
    const bits = modifiers.reduce((acc, key) => acc | MODIFIER_BITS[key], 0);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: bits });
    for (let count = 1; count <= clickCount; count += 1) {
      const base: CdpParams = { x, y, button, clickCount: count, modifiers: bits };
      await this.cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
      await this.cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
    }
  }

  /** 把鼠标移到元素中心（触发 :hover，例如悬停时才出现的行内按钮） */
  async hover(target: Target): Promise<void> {
    const point = await this.locate(target);
    await this.mouseMove(point.x, point.y);
  }

  /** 把鼠标移到指定坐标（不按键） */
  async mouseMove(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: 0 });
  }

  /** 以真实鼠标事件点击元素中心 */
  async click(target: Target, options: { button?: MouseButton; clickCount?: number } = {}) {
    const point = await this.locate(target);
    await this.mouseClick(point.x, point.y, options);
  }

  async rightClick(target: Target): Promise<void> {
    await this.click(target, { button: 'right' });
  }

  async doubleClick(target: Target): Promise<void> {
    await this.click(target, { clickCount: 2 });
  }

  /** 通过 IME 通道插入文本（与真实输入法提交一致，适合中文） */
  async type(text: string): Promise<void> {
    await this.cdp.send('Input.insertText', { text });
  }

  /** 按下单个按键，可带修饰键，例如 press('z', ['Meta']) */
  async press(key: string, modifiers: Modifier[] = []): Promise<void> {
    const bits = modifiers.reduce((acc, item) => acc | MODIFIER_BITS[item], 0);
    const special = SPECIAL_KEYS[key];
    const isChar = !special && key.length === 1;
    const upper = key.toUpperCase();
    // KeyboardEvent.key includes Shift; lowercase Ctrl+Shift+z is interpreted as
    // Ctrl+z by CodeMirror before its shifted fallback (undo instead of redo).
    const eventKey = isChar && modifiers.includes('Shift') ? upper : key;
    const code = special?.code ?? (isChar && /[a-z]/i.test(key) ? `Key${upper}` : key);
    const keyCode = special?.keyCode ?? (isChar ? upper.charCodeAt(0) : 0);
    // 带 Ctrl/Meta 的组合键不产生文本输入
    const producesText = modifiers.every((item) => item === 'Shift');
    const text = producesText ? (special?.text ?? (isChar ? eventKey : undefined)) : undefined;
    const common: CdpParams = {
      key: eventKey,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers: bits,
    };
    await this.cdp.send('Input.dispatchKeyEvent', {
      ...common,
      type: text ? 'keyDown' : 'rawKeyDown',
      ...(text ? { text, unmodifiedText: text } : {}),
    });
    await this.cdp.send('Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
  }

  async screenshot(name: string): Promise<string | null> {
    try {
      const { data } = await this.cdp.send<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'png' },
        10_000
      );
      await mkdir(this.artifactsDir, { recursive: true });
      const file = path.join(this.artifactsDir, `${name.replace(/[^\w一-龥-]+/g, '_')}.png`);
      await writeFile(file, Buffer.from(data, 'base64'));
      return file;
    } catch {
      return null;
    }
  }

  /** 页面可见文本（用于断言与调试） */
  async bodyText(): Promise<string> {
    return this.evaluate<string>(() => document.body.innerText);
  }
}

export { sleep };
