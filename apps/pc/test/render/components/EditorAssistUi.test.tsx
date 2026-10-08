// @vitest-environment happy-dom
import React from 'react';
import { modelInfo } from '../helpers/aiModel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CharacterHoverCard from '@/render/components/CharacterHoverCard';
import { mountCharacterHoverCard } from '@/render/components/CharacterHoverCard/mount';
import type { CharacterCardModel } from '@/render/components/CharacterHoverCard/model';
import type { Character } from '@/render/components/RightPanel/types';
import { ContinuationPanel } from '@/render/components/ContinuationButton/ContinuationPanel';
import { toContinuationOptions } from '@/render/components/ContinuationButton/useContinuationPanel';
import {
  IDLE_CONTINUATION,
  type ContinuationState,
} from '@/render/components/TextEditor/assist/continuation-state';
import type { AIProviderInfo } from '@/shared/ai';
import { chooseOption } from '../helpers/select';

afterEach(() => cleanup());

const MODEL: CharacterCardModel = {
  id: 1,
  name: '林舟',
  initial: '林',
  color: '#9cdcfe',
  aliases: ['阿舟'],
  tags: ['主要角色', '主角团'],
  role: '主角 · 旅人',
  summary: '青石镇长大的少年。',
  states: [{ label: '伤势', value: '左臂旧伤未愈' }],
  growth: { level: 4, ratio: 0.5, expText: '经验 2750 / 3000' },
};

describe('CharacterHoverCard', () => {
  it('显示首字圆标、别名、分类阵营、简介、状态、等级与经验条；操作不抢焦点', () => {
    const onOpen = vi.fn();
    const onRecord = vi.fn();
    const onHighlightAll = vi.fn();
    render(
      <CharacterHoverCard
        model={MODEL}
        lastAppearance={{ path: '/a', label: '第一卷 · 002', chaptersAgo: 1 }}
        canRecord
        onOpen={onOpen}
        onRecord={onRecord}
        onHighlightAll={onHighlightAll}
      />
    );
    const card = screen.getByTestId('character-hover-card');
    expect(card.getAttribute('aria-label')).toBe('人物卡片：林舟');
    expect(card.textContent).toContain('又名 阿舟');
    expect(card.textContent).toContain('主角团');
    expect(card.textContent).toContain('左臂旧伤未愈');
    expect(screen.getByTestId('character-card-level').textContent).toBe('Lv.4');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(card.textContent).toContain('第一卷 · 002（上一章）');
    expect(card.querySelector('img')).toBeNull();
    expect(card.textContent).toContain('林');

    const open = screen.getByRole('button', { name: '打开人物' });
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    open.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: '记一笔' }));
    fireEvent.click(screen.getByRole('button', { name: '高亮全部' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onRecord).toHaveBeenCalledWith(expect.any(Object));
    expect(onHighlightAll).toHaveBeenCalledOnce();
  });

  it('信息少时收缩；没有记忆库时不显示「记一笔」；读取中显示占位', () => {
    render(
      <CharacterHoverCard
        model={{ ...MODEL, aliases: [], summary: '', states: [], growth: null }}
        avatarSrc="data:image/png;base64,AAAA"
        onRecord={vi.fn()}
      />
    );
    const card = screen.getByTestId('character-hover-card');
    expect(card.textContent).not.toContain('又名');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByTestId('character-card-level')).toBeNull();
    expect(screen.queryByRole('button', { name: '记一笔' })).toBeNull();
    expect(card.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(card.textContent).toContain('查找中…');
  });

  it('mountCharacterHoverCard：同步渲染首帧，异步补上头像与上次出场，清理时卸载', async () => {
    const character: Character = {
      id: 1,
      name: '林舟',
      role: '主角',
      category: 'major',
      description: '',
      currentState: [],
      aliases: [],
    };
    const dom = document.createElement('div');
    document.body.appendChild(dom);
    let cleanupCard: () => void = () => undefined;
    act(() => {
      cleanupCard = mountCharacterHoverCard(dom, {
        character,
        growth: null,
        canRecord: false,
        loadAvatar: async () => null,
        loadLastAppearance: async () => ({ path: '/x', label: '序章', chaptersAgo: null }),
        onOpen: vi.fn(),
        onRecord: vi.fn(),
        onHighlightAll: vi.fn(),
      });
    });
    expect(dom.textContent).toContain('林舟');
    await waitFor(() => expect(dom.textContent).toContain('序章'));
    cleanupCard();
    await waitFor(() => expect(dom.textContent).toBe(''));
  });
});

function provider(id: string, patch: Partial<AIProviderInfo> = {}): AIProviderInfo {
  return modelInfo({
    id,
    kind: 'text',
    label: id === 'grok' ? 'xAI Grok' : '默认 AI',
    description: '',
    defaultBaseUrl: '',
    defaultModel: '',
    models: [],
    configured: true,
    secureStorage: true,
    enabled: true,
    baseUrl: '',
    model: '',
    ...patch,
  });
}

function renderPanel(
  state: ContinuationState = IDLE_CONTINUATION,
  configured: boolean | null = true
) {
  const props = {
    providers: [provider('openai-compatible'), provider('grok')],
    resolvedProvider: { providerId: 'grok', label: 'xAI Grok' },
    configured,
    state,
    notice: null,
    onGenerate: vi.fn(),
    onAccept: vi.fn(),
    onDiscard: vi.fn(),
    onNext: vi.fn(),
    onRetry: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  render(<ContinuationPanel {...props} />);
  return props;
}

describe('ContinuationPanel', () => {
  it('选择长度 / 方向 / 章纲 / 模型后生成', () => {
    const props = renderPanel();
    expect(screen.getByRole('combobox', { name: 'AI 模型' }).textContent).toContain(
      '默认（xAI Grok）'
    );
    fireEvent.click(screen.getByRole('radio', { name: '约 500 字' }));
    fireEvent.click(screen.getByRole('radio', { name: '收束本章' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '遵循章纲' }));
    chooseOption('AI 模型', '默认 AI');
    fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
    const form = props.onGenerate.mock.calls[0][0];
    expect(toContinuationOptions(form)).toEqual({
      length: 'long',
      direction: 'wrap-up',
      followOutline: false,
      providerId: 'openai-compatible',
    });

    fireEvent.change(screen.getByRole('textbox', { name: '自定义续写方向' }), {
      target: { value: '让苏晴先发现异样' },
    });
    expect(screen.getByRole('radio', { name: '收束本章' }).getAttribute('aria-checked')).toBe(
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: '生成建议' }));
    expect(toContinuationOptions(props.onGenerate.mock.calls[1][0]).direction).toBe(
      '让苏晴先发现异样'
    );
  });

  it('AI 未配置：引导去设置中心', () => {
    const props = renderPanel(IDLE_CONTINUATION, false);
    expect(screen.queryByRole('button', { name: '生成建议' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '去设置 AI 服务' }));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it('建议就绪：采纳 / 放弃 / 换一个，可展开本次上下文', () => {
    const state: ContinuationState = {
      ...IDLE_CONTINUATION,
      phase: 'ready',
      mode: 'suggestion',
      variants: ['雾气翻涌。'],
      context: {
        budget: 6000,
        usedTokens: 120,
        providerLabel: 'xAI Grok',
        sections: [
          {
            key: 'rules',
            label: '核心规则',
            tokens: 10,
            truncated: false,
            omittedItems: 1,
            text: '- 等级上限 20',
          },
        ],
      },
    };
    const props = renderPanel(state);
    expect(screen.getByRole('status').textContent).toContain('5 字');
    fireEvent.click(screen.getByRole('button', { name: '采纳' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));
    fireEvent.click(screen.getByRole('button', { name: '换一个' }));
    expect(props.onAccept).toHaveBeenCalledOnce();
    expect(props.onDiscard).toHaveBeenCalledOnce();
    expect(props.onNext).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '查看本次上下文' }));
    expect(screen.getByText(/xAI Grok · 约 120 \/ 6000 tokens/)).toBeTruthy();
    expect(screen.getByText(/省略 1 条/)).toBeTruthy();
    expect(screen.getByText('- 等级上限 20')).toBeTruthy();
  });

  it('错误：按类型给出提示，可重试 / 去设置', () => {
    const props = renderPanel({
      ...IDLE_CONTINUATION,
      phase: 'error',
      mode: 'suggestion',
      variants: [''],
      error: { kind: 'auth', message: '401', retryable: false },
    });
    expect(screen.getByRole('alert').textContent).toContain('API Key 无效');
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '去设置' }));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
    cleanup();

    const again = renderPanel({
      ...IDLE_CONTINUATION,
      phase: 'error',
      mode: 'suggestion',
      variants: [''],
      error: { kind: 'content-safety', message: 'blocked', retryable: false },
    });
    expect(screen.getByRole('alert').textContent).toContain('内容被安全策略拦截');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(again.onRetry).toHaveBeenCalledOnce();
  });

  it('生成中禁用按钮并显示进度', () => {
    renderPanel({
      ...IDLE_CONTINUATION,
      phase: 'streaming',
      mode: 'suggestion',
      variants: ['一二三'],
    });
    expect((screen.getByRole('button', { name: '正在续写…' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByRole('status').textContent).toContain('3 字');
  });
});
