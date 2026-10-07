import { createVideoTask, type CreateVideoTaskInput, type VideoTask } from '../src';

export function makeTask(overrides: Partial<CreateVideoTaskInput> = {}, now = 1_000): VideoTask {
  return createVideoTask(
    {
      id: 't1',
      providerId: 'kling',
      workPath: '/works/星河旅人',
      chapter: '第一章',
      scene: '离港',
      shotIndex: 1,
      version: 1,
      prompt: '林舟站在舷窗前',
      ...overrides,
    },
    now
  );
}

export const retryable = { code: 'NETWORK', message: '网络错误', retryable: true };
export const fatal = { code: 'BAD_PROMPT', message: '提示词违规', retryable: false };
