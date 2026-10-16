// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CharacterProfileAssistant, {
  type CharacterProfileAssistantHandle,
  type EnrichmentProgress,
} from '@/render/components/CharacterProfileAssistant';
import type { EnrichmentValues } from '@novel-editor/core/character-enrichment';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';

const person = {
  id: 1,
  name: '林舟',
  design: { appearance: '黑发', outfit: '', personality: '', speech: '', background: '' },
};
const response = (design = {}, entries: unknown[] = []) => ({
  ok: true,
  data: { text: JSON.stringify({ design, voice: {}, entries }), finishReason: 'stop' },
});
function setup() {
  const ref = React.createRef<CharacterProfileAssistantHandle>();
  const drafts: EnrichmentValues[] = [];
  const progress: (EnrichmentProgress | null)[] = [];
  const rendered = render(
    <CharacterProfileAssistant
      ref={ref}
      character={person}
      workPath="/work"
      onFill={(values) => {
        drafts.push(values);
        return Object.keys(values.design).length > 0 || Object.keys(values.development).length > 0;
      }}
      onProgress={(value) => progress.push(value)}
    />
  );
  return { ...rendered, ref, drafts, progress };
}
afterEach(() => {
  cleanup();
  uninstallElectronMock();
  localStorage.clear();
  vi.restoreAllMocks();
});

it('disables duplicate generation, batches the requested page and fills each result before proceeding', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const ipc = installElectronMock((channel) =>
    channel === 'ai-complete'
      ? new Promise<ReturnType<typeof response>>((resolve) => {
          finish = resolve;
        })
      : undefined
  );
  const state = setup();
  act(() => state.ref.current!.retry('power'));
  expect(screen.getByRole('button', { busy: true }).getAttribute('aria-busy')).toBe('true');
  expect((screen.getByRole('button', { busy: true }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '取消生成' }) as HTMLButtonElement).disabled).toBe(
    false
  );
  act(() => state.ref.current!.retry('power'));
  expect(ipc.invoke).toHaveBeenCalledTimes(1);
  const firstRequest = ipc.invoke.mock.calls[0]![1] as { prompt: string; timeoutMs: number };
  expect(firstRequest.prompt).toContain('"key":"strength"');
  expect(firstRequest.prompt).not.toContain('"key":"equipment"');
  expect(firstRequest.timeoutMs).toBeGreaterThan(119_000);
  await act(async () => {
    finish(
      response({}, [
        { kind: 'strength', name: '耐力', description: '能长途跋涉', status: 'planned' },
      ])
    );
  });
  expect(state.drafts).toHaveLength(1);
  expect(Object.values(state.drafts[0]!.development)[0]).toContain('能长途跋涉');
  expect(ipc.invoke).toHaveBeenCalledTimes(2);
  const secondPrompt = (ipc.invoke.mock.calls[1]![1] as { prompt: string }).prompt;
  expect(secondPrompt).toContain('"key":"equipment"');
  expect(secondPrompt).toContain('能长途跋涉');
  await act(async () => {
    finish(response());
  });
  expect(state.progress.at(-1)).toMatchObject({
    running: false,
    completed: 1,
    total: 1,
    failed: [],
    states: { power: { phase: 'done' } },
  });
  expect(screen.getByRole('button', { name: 'AI 丰富人物' }).getAttribute('aria-busy')).toBe(
    'false'
  );
});

it('splits truncated batches into compact retries and preserves already-filled batches', async () => {
  let requests = 0;
  const ipc = installElectronMock(() => {
    requests++;
    if (requests === 1) return { ok: true, data: { text: '{"design":', finishReason: 'length' } };
    return response(
      requests === 2 ? { appearance: '银发' } : requests === 3 ? { personality: '谨慎' } : {}
    );
  });
  const state = setup();
  act(() => state.ref.current!.retry('design'));
  await waitFor(() => expect(state.progress.at(-1)?.running).toBe(false));
  const prompts = ipc.invoke.mock.calls.map((call) => (call[1] as { prompt: string }).prompt);
  expect(prompts[1]).toContain('"key":"appearance"');
  expect(prompts[1]).not.toContain('"key":"personality"');
  expect(prompts[2]).toContain('"key":"personality"');
  expect(prompts[2]).not.toContain('"key":"appearance"');
  expect(prompts[1]).toContain('每个值不超过60字');
  expect(state.drafts[0]?.design).toEqual({ appearance: '银发' });
  expect(state.drafts[1]?.design).toEqual({ personality: '谨慎' });
  expect(state.progress.at(-1)?.states.design?.phase).toBe('done');
});

it('stops a page at its deadline while retaining partial results and allows retrying that page', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  let requests = 0;
  const ipc = installElectronMock(() => {
    requests++;
    if (requests === 1) {
      // 人物页扩展为四批，整页预算为 4 × 45 秒。
      now += 180_000;
      return response({ appearance: '银发' });
    }
    return response();
  });
  const state = setup();
  act(() => state.ref.current!.retry('design'));
  await waitFor(() => expect(state.progress.at(-1)?.running).toBe(false));
  expect(ipc.invoke).toHaveBeenCalledTimes(1);
  expect(state.drafts[0]?.design).toEqual({ appearance: '银发' });
  expect(state.progress.at(-1)).toMatchObject({
    failed: ['design'],
    states: { design: { phase: 'failed', reason: expect.stringContaining('超时') } },
  });
  act(() => state.ref.current!.retry('design'));
  await waitFor(() => expect(state.progress.at(-1)?.states.design?.phase).toBe('done'));
  expect(state.progress.at(-1)?.failed).toEqual([]);
});

it('unmount clears progress and ignores pending results without starting later batches', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const ipc = installElectronMock((channel) =>
    channel === 'ai-complete'
      ? new Promise<ReturnType<typeof response>>((resolve) => {
          finish = resolve;
        })
      : undefined
  );
  const state = setup();
  fireEvent.click(screen.getByRole('button', { name: 'AI 丰富人物' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '保持现实题材' } });
  fireEvent.click(screen.getByRole('button', { name: '生成并填入' }));
  expect((ipc.invoke.mock.calls[0]![1] as { prompt: string }).prompt).toContain('保持现实题材');
  state.unmount();
  expect(state.progress.at(-1)).toBeNull();
  const reports = state.progress.length;
  await act(async () => {
    finish(response({ appearance: '银发' }));
  });
  expect(state.drafts).toEqual([]);
  expect(state.progress).toHaveLength(reports);
  expect(ipc.invoke.mock.calls.filter(([channel]) => channel === 'ai-complete')).toHaveLength(1);
  expect(ipc.invoke).toHaveBeenCalledWith('ai-complete-cancel', expect.any(String));
});

it('bounds malformed-response retries and continues later pages after a failure', async () => {
  const ipc = installElectronMock((_channel, request) => {
    const prompt = (request as { prompt: string }).prompt;
    if (prompt.startsWith('为小说作者补全人物资料，当前部分：人物与选填细节'))
      return { ok: true, data: { text: '{broken', finishReason: 'stop' } };
    return response(prompt.includes('"key":"background"') ? { background: '来自海港' } : {});
  });
  const state = setup();
  fireEvent.click(screen.getByRole('button', { name: 'AI 丰富人物' }));
  fireEvent.click(screen.getByRole('button', { name: '生成并填入' }));
  await waitFor(() => expect(state.progress.at(-1)?.running).toBe(false));
  const designRequests = ipc.invoke.mock.calls.filter((call) =>
    (call[1] as { prompt: string }).prompt.startsWith(
      '为小说作者补全人物资料，当前部分：人物与选填细节'
    )
  );
  expect(designRequests).toHaveLength(3);
  expect(state.progress.at(-1)).toMatchObject({
    completed: 5,
    total: 5,
    failed: ['design'],
    states: {
      design: { phase: 'failed' },
      environment: { phase: 'done' },
      social: { phase: 'done' },
      power: { phase: 'done' },
      plot: { phase: 'done' },
    },
  });
  expect(state.drafts.some((value) => value.design.background === '来自海港')).toBe(true);
});
