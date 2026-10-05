import { describe, expect, it } from 'vitest';
import {
  createAssistantGenerationStatusStorageKey,
  formatAssistantGenerationMetrics,
  formatAssistantGenerationProgress,
  parseAssistantArtifactGenerationStatus,
} from '@/render/utils/assistantGeneration';

const base = {
  artifact: 'lore',
  state: 'success',
  scopeKind: 'volume',
  scopePath: '  /n/第一卷  ',
};

describe('assistant generation 边界', () => {
  it('虚拟路径与空路径不生成键', () => {
    expect(createAssistantGenerationStatusStorageKey('lore', 'project', null)).toBeNull();
    expect(
      createAssistantGenerationStatusStorageKey('lore', 'project', '__untitled__:1')
    ).toBeNull();
  });

  it('空输入、非法 JSON、非法枚举返回 null', () => {
    expect(parseAssistantArtifactGenerationStatus(null)).toBeNull();
    expect(parseAssistantArtifactGenerationStatus(undefined)).toBeNull();
    expect(parseAssistantArtifactGenerationStatus('{')).toBeNull();
    expect(parseAssistantArtifactGenerationStatus('null')).toBeNull();
    expect(
      parseAssistantArtifactGenerationStatus(JSON.stringify({ ...base, artifact: 'x' }))
    ).toBeNull();
    expect(
      parseAssistantArtifactGenerationStatus(JSON.stringify({ ...base, scopeKind: 'x' }))
    ).toBeNull();
    expect(
      parseAssistantArtifactGenerationStatus(JSON.stringify({ ...base, scopePath: '  ' }))
    ).toBeNull();
    expect(
      parseAssistantArtifactGenerationStatus(JSON.stringify({ ...base, scopePath: 3 }))
    ).toBeNull();
  });

  it('非法数字归零、非字符串字段使用默认值，完成步数不超过总步数', () => {
    const parsed = parseAssistantArtifactGenerationStatus(
      JSON.stringify({
        ...base,
        scopeLabel: 1,
        message: null,
        totalSteps: 3.9,
        completedSteps: 10,
        resultCount: -2,
        libraryCount: 'abc',
        startedAt: 1,
        finishedAt: '2026-04-04T00:00:00.000Z',
      })
    );
    expect(parsed).toMatchObject({
      scopePath: '/n/第一卷',
      scopeLabel: '',
      message: '',
      totalSteps: 3,
      completedSteps: 3,
      resultCount: 0,
      libraryCount: 0,
      startedAt: '',
      finishedAt: '2026-04-04T00:00:00.000Z',
    });
  });

  it('非 running 或无步数时不显示进度', () => {
    const metrics = {
      state: 'success' as const,
      totalSteps: 5,
      completedSteps: 5,
      resultCount: 0,
      libraryCount: 0,
      createdCount: 0,
      updatedCount: 0,
    };
    expect(formatAssistantGenerationProgress(null)).toBe('');
    expect(formatAssistantGenerationProgress(metrics)).toBe('');
    expect(formatAssistantGenerationProgress({ ...metrics, state: 'running', totalSteps: 0 })).toBe(
      ''
    );
    expect(formatAssistantGenerationMetrics(null)).toBe('');
    expect(formatAssistantGenerationMetrics(metrics)).toBe('角色库 0 人');
    expect(formatAssistantGenerationMetrics({ ...metrics, state: 'error' })).toBe('');
  });
});
