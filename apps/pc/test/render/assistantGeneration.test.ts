import { describe, expect, it } from 'vitest';
import {
  createAssistantGenerationStatusStorageKey,
  formatAssistantGenerationMetrics,
  formatAssistantGenerationProgress,
  parseAssistantArtifactGenerationStatus,
} from '../../src/render/utils/assistantGeneration';

describe('assistant generation status helpers', () => {
  it('会为当前作用域生成稳定的 SQLite 状态键', () => {
    expect(
      createAssistantGenerationStatusStorageKey('characters', 'chapter', '/tmp/chapter-1.md')
    ).toBe('novel-editor:assistant-generation:characters:chapter:/tmp/chapter-1.md');
  });

  it('会清洗并解析合法的生成人物状态', () => {
    const parsed = parseAssistantArtifactGenerationStatus(
      JSON.stringify({
        artifact: 'characters',
        state: 'running',
        scopeKind: 'chapter',
        scopePath: '/tmp/chapter-1.md',
        scopeLabel: '第一章',
        message: '正在分析第一章',
        totalSteps: 8,
        completedSteps: 3,
        resultCount: 2,
        libraryCount: 5,
        createdCount: 1,
        updatedCount: 1,
        startedAt: '2026-04-04T00:00:00.000Z',
        finishedAt: null,
      })
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.completedSteps).toBe(3);
    expect(parsed?.scopeLabel).toBe('第一章');
    expect(formatAssistantGenerationProgress(parsed)).toBe('3/8');
    expect(formatAssistantGenerationMetrics(parsed)).toBe('识别 2 项 · 角色库 5 人 · 新增 1 · 更新 1');
  });

  it('会拒绝缺少关键字段的无效状态', () => {
    expect(parseAssistantArtifactGenerationStatus(JSON.stringify({ state: 'running' }))).toBeNull();
  });
});
