// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TitleBar from '@/render/components/TitleBar';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';

describe('TitleBar', () => {
  beforeEach(() => {
    installElectronMock(() => false);
  });
  afterEach(() => {
    uninstallElectronMock();
  });

  it('默认显示窗口控制与用户头像缩写（最多两位大写）', () => {
    render(<TitleBar userInitials="abc" />);
    expect(screen.getByText('AB')).toBeTruthy();
    expect(screen.getByLabelText('关闭窗口')).toBeTruthy();
  });

  it('showControls=false 时隐藏窗口控制', () => {
    render(<TitleBar showControls={false} />);
    expect(screen.queryByLabelText('关闭窗口')).toBeNull();
    expect(screen.getByText('U')).toBeTruthy();
  });

  it('专注模式按钮根据状态切换文案并回调', () => {
    const onToggleFocusMode = vi.fn();
    const { rerender } = render(<TitleBar onToggleFocusMode={onToggleFocusMode} />);
    fireEvent.click(screen.getByText('专注写作'));
    expect(onToggleFocusMode).toHaveBeenCalled();
    rerender(<TitleBar onToggleFocusMode={onToggleFocusMode} focusMode />);
    expect(screen.getByText('退出专注')).toBeTruthy();
    expect(screen.getByTitle('退出专注模式 (F11)')).toBeTruthy();
  });

  it('未提供 onToggleFocusMode 时不显示专注按钮', () => {
    render(<TitleBar />);
    expect(screen.queryByText('专注写作')).toBeNull();
  });

  it('头像与 AI 助手按钮回调', () => {
    const onAvatarClick = vi.fn();
    const onOpenAIAssistant = vi.fn();
    render(<TitleBar onAvatarClick={onAvatarClick} onOpenAIAssistant={onOpenAIAssistant} />);
    fireEvent.click(screen.getByLabelText('打开设置中心'));
    fireEvent.click(screen.getByLabelText('打开 AI 助手'));
    expect(onAvatarClick).toHaveBeenCalled();
    expect(onOpenAIAssistant).toHaveBeenCalled();
  });

  it('设置菜单：打开、点击菜单项执行回调并关闭', () => {
    const fns = {
      onOpenSettings: vi.fn(),
      onShowShortcuts: vi.fn(),
      onOpenSampleData: vi.fn(),
      onExportProject: vi.fn(),
    };
    render(<TitleBar {...fns} />);
    const gear = screen.getByLabelText('打开设置');
    const cases: Array<[string, ReturnType<typeof vi.fn>]> = [
      ['设置中心', fns.onOpenSettings],
      ['键盘快捷键', fns.onShowShortcuts],
      ['打开示例项目', fns.onOpenSampleData],
      ['导出项目', fns.onExportProject],
    ];
    for (const [label, fn] of cases) {
      fireEvent.click(gear);
      fireEvent.click(screen.getByText(label));
      expect(fn).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('软件设置')).toBeNull();
    }
  });

  it('设置菜单只显示提供了回调的可选项', () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByLabelText('打开设置'));
    expect(screen.getByText('软件设置')).toBeTruthy();
    expect(screen.queryByText('设置中心')).toBeNull();
    expect(screen.queryByText('导出项目')).toBeNull();
    // 没有回调时点击快捷键项也不抛错
    expect(() => fireEvent.click(screen.getByText('键盘快捷键'))).not.toThrow();
  });

  it('外部点击关闭设置菜单，菜单内部点击不关闭；再次点击齿轮切换', () => {
    render(<TitleBar />);
    const gear = screen.getByLabelText('打开设置');
    fireEvent.click(gear);
    fireEvent.mouseDown(screen.getByText('软件设置'));
    expect(screen.getByText('软件设置')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('软件设置')).toBeNull();
    fireEvent.click(gear);
    fireEvent.click(gear);
    expect(screen.queryByText('软件设置')).toBeNull();
  });
});
