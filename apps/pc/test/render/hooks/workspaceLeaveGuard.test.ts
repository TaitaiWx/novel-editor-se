// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTabsState } from '@/render/hooks/state/useTabsState';
import { registerWorkspaceLeaveGuard } from '@/render/utils/workspaceLeaveGuard';

it('keeps active state and ref in place when navigation is rejected, then resumes after unregister', () => {
  const { result } = renderHook(useTabsState);
  act(() => result.current.setActiveTab('character:1'));
  const targets: (string | null)[] = [];
  const unregister = registerWorkspaceLeaveGuard((target) => {
    targets.push(target);
    return false;
  });
  try {
    act(() => result.current.setActiveTab('chapter.md'));
    expect(result.current.activeTab).toBe('character:1');
    expect(result.current.activeTabRef.current).toBe('character:1');
    act(() => result.current.setActiveTab((current) => current));
    expect(targets).toEqual(['chapter.md']);
    act(() => result.current.setActiveTab(null));
    expect(result.current.activeTab).toBe('character:1');
    expect(targets).toEqual(['chapter.md', null]);
  } finally {
    unregister();
  }
  act(() => result.current.setActiveTab('chapter.md'));
  expect(result.current.activeTab).toBe('chapter.md');
  expect(result.current.activeTabRef.current).toBe('chapter.md');
});
