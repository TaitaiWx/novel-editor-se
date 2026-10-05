// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyState from '@/render/components/EmptyState';

describe('EmptyState', () => {
  it('渲染传入的标题文案', () => {
    render(<EmptyState title="还没有章节" />);
    expect(screen.getByText('还没有章节')).toBeTruthy();
  });
});
