// @vitest-environment happy-dom
import React, { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import ContentPanel from '@/render/components/ContentPanel';

const editorLifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock('@/render/components/TextEditor', () => ({
  default: ({ filePath }: { filePath: string | null }) => {
    useEffect(() => {
      editorLifecycle.mount();
      return () => editorLifecycle.unmount();
    }, []);
    return <div data-testid="editor" data-file-path={filePath ?? ''} />;
  },
}));
vi.mock('@/render/components/ReferencePane', () => ({ default: () => null }));
vi.mock('@/render/components/TabBar', () => ({ default: () => null }));
vi.mock('@/render/components/SettingsButton', () => ({ default: () => null }));
vi.mock('@/render/components/LoadingSpinner', () => ({ default: () => null }));

describe('ContentPanel editor lifetime', () => {
  it('切到特殊面板时保留同一编辑器，以空目标走可阻止的保存流程', async () => {
    editorLifecycle.mount.mockClear();
    editorLifecycle.unmount.mockClear();
    const props = {
      openTabs: ['/a.md', '__settings__'],
      activeTab: '/a.md',
      encoding: 'UTF-8',
      onTabSelect: vi.fn(),
      onTabClose: vi.fn(),
      specialTabContent: { __settings__: <div>settings</div> },
    };
    const { getByTestId, rerender } = render(<ContentPanel {...props} />);
    await waitFor(() => expect(getByTestId('editor').getAttribute('data-file-path')).toBe('/a.md'));
    const editor = getByTestId('editor');
    rerender(<ContentPanel {...props} activeTab="__settings__" />);
    expect(getByTestId('editor')).toBe(editor);
    expect(editor.getAttribute('data-file-path')).toBe('');
    expect(editorLifecycle.unmount).not.toHaveBeenCalled();
    rerender(<ContentPanel {...props} />);
    expect(getByTestId('editor')).toBe(editor);
    expect(editorLifecycle.mount).toHaveBeenCalledTimes(1);
  });
});
