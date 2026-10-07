// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PrevizDialog, {
  type CreatePrevizStage,
  type PrevizStageApi,
} from '@/render/components/SceneVideoView/Previz';

const PNG = new Uint8Array([137, 80, 78, 71]);

function fakeStage(
  picks: {
    figure?: string | null;
    ground?: { x: number; z: number } | null;
  } = {}
) {
  const stage = {
    resize: vi.fn<(width: number, height: number) => void>(),
    setCamera: vi.fn<PrevizStageApi['setCamera']>(),
    setFigures: vi.fn<PrevizStageApi['setFigures']>(),
    pickGround: vi.fn<PrevizStageApi['pickGround']>(() =>
      picks.ground === undefined ? { x: 20, z: -1.234 } : picks.ground
    ),
    pickFigure: vi.fn<PrevizStageApi['pickFigure']>(() =>
      picks.figure === undefined ? 'f2' : picks.figure
    ),
    capture: vi.fn<PrevizStageApi['capture']>(async () => PNG),
    dispose: vi.fn<() => void>(),
  } satisfies PrevizStageApi;
  const createStage = vi.fn<CreatePrevizStage>(async () => stage);
  return { stage, createStage };
}

function renderDialog(createStage: CreatePrevizStage, extra: { shotSize?: string } = {}) {
  const onSave = vi.fn(async (_png: Uint8Array) => undefined);
  const onClose = vi.fn();
  const utils = render(
    <PrevizDialog
      shotLabel="镜头2"
      shotSize={extra.shotSize ?? '近景'}
      characters={['林舟', '苏晴']}
      aspectRatio="16:9"
      onSave={onSave}
      onClose={onClose}
      createStage={createStage}
    />
  );
  return { ...utils, onSave, onClose };
}

const lastFigures = (stage: ReturnType<typeof fakeStage>['stage']) => {
  const calls = stage.setFigures.mock.calls;
  return calls[calls.length - 1];
};

describe('PrevizDialog', () => {
  it('渲染对话框；舞台就绪后按景别 / 角度设置相机并放入默认人物', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    expect(screen.getByRole('dialog', { name: '3D 预演 · 镜头2' })).toBeTruthy();
    expect(screen.getByText('正在准备 3D 舞台…')).toBeTruthy();
    const capture = screen.getByRole('button', { name: '截图作为构图' }) as HTMLButtonElement;
    expect(capture.disabled).toBe(true);

    await waitFor(() => expect(stage.setCamera).toHaveBeenCalledWith('近景', 'eye'));
    expect(createStage).toHaveBeenCalledWith(screen.getByTestId('previz-canvas'));
    expect(stage.resize).toHaveBeenCalled();
    const [figures, selected] = lastFigures(stage);
    expect(figures.map((figure) => figure.name)).toEqual(['林舟', '苏晴']);
    expect(selected).toBe('f1');
    expect(screen.queryByText('正在准备 3D 舞台…')).toBeNull();
    expect(capture.disabled).toBe(false);
  });

  it('未知景别回退中景；改景别 / 角度会更新相机', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage, { shotSize: '怪景别' });
    await waitFor(() => expect(stage.setCamera).toHaveBeenCalledWith('中景', 'eye'));
    const select = screen.getByRole('combobox', { name: '预演景别' }) as HTMLSelectElement;
    expect(select.value).toBe('中景');
    fireEvent.change(select, { target: { value: '特写' } });
    expect(stage.setCamera).toHaveBeenLastCalledWith('特写', 'eye');
    const angles = within(screen.getByRole('radiogroup', { name: '镜头角度' }));
    fireEvent.click(angles.getByRole('radio', { name: '俯视' }));
    expect(stage.setCamera).toHaveBeenLastCalledWith('特写', 'high');
    expect(angles.getByRole('radio', { name: '俯视' }).getAttribute('aria-checked')).toBe('true');
  });

  it('选人物、换姿势、改朝向都会更新舞台上的人物', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await waitFor(() => expect(stage.setFigures).toHaveBeenCalled());
    const people = within(screen.getByRole('listbox', { name: '预演人物' }));
    fireEvent.click(people.getByRole('option', { name: '苏晴' }));
    expect(lastFigures(stage)[1]).toBe('f2');
    expect(people.getByRole('option', { name: '苏晴' }).getAttribute('aria-selected')).toBe('true');

    const poses = within(screen.getByRole('radiogroup', { name: '姿势' }));
    fireEvent.click(poses.getByRole('radio', { name: '拔剑' }));
    expect(lastFigures(stage)[0].find((figure) => figure.id === 'f2')?.pose).toBe('draw-sword');
    expect(lastFigures(stage)[0].find((figure) => figure.id === 'f1')?.pose).toBe('stand');

    fireEvent.change(screen.getByRole('slider', { name: '人物朝向' }), { target: { value: '90' } });
    expect(lastFigures(stage)[0].find((figure) => figure.id === 'f2')?.rotation).toBeCloseTo(
      Math.PI / 2
    );
  });

  it('在画面上按住人物拖动：选中并移动到地面点（限制在舞台范围内）', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await waitFor(() => expect(stage.setFigures).toHaveBeenCalled());
    const frame = screen.getByTestId('previz-canvas').parentElement as HTMLElement;
    fireEvent.pointerDown(frame, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(stage.pickFigure).toHaveBeenCalledWith(10, 10);
    fireEvent.pointerMove(frame, { clientX: 40, clientY: 30, pointerId: 1 });
    const moved = lastFigures(stage)[0].find((figure) => figure.id === 'f2');
    expect(moved).toMatchObject({ x: 8, z: -1.23 });
    expect(lastFigures(stage)[1]).toBe('f2');
    fireEvent.pointerUp(frame, { pointerId: 1 });
    stage.pickGround.mockClear();
    fireEvent.pointerMove(frame, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(stage.pickGround).not.toHaveBeenCalled();
  });

  it('点空白处不选中也不拖动；地面拾取失败时不移动', async () => {
    const { stage, createStage } = fakeStage({ figure: null, ground: null });
    renderDialog(createStage);
    await waitFor(() => expect(stage.setFigures).toHaveBeenCalled());
    const count = stage.setFigures.mock.calls.length;
    const frame = screen.getByTestId('previz-canvas').parentElement as HTMLElement;
    fireEvent.pointerDown(frame, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 5, clientY: 5, pointerId: 1 });
    expect(stage.setFigures.mock.calls.length).toBe(count);
  });

  it('「截图作为构图」：截图字节交给 onSave，然后关闭', async () => {
    const { stage, createStage } = fakeStage();
    const { onSave, onClose } = renderDialog(createStage);
    const button = screen.getByRole('button', { name: '截图作为构图' }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(stage.capture).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(PNG);
  });

  it('保存失败时显示错误、不关闭', async () => {
    const { stage, createStage } = fakeStage();
    const onSave = vi.fn(async () => {
      throw new Error('磁盘已满');
    });
    const onClose = vi.fn();
    render(
      <PrevizDialog
        shotLabel="镜头1"
        shotSize="中景"
        characters={[]}
        aspectRatio="9:16"
        onSave={onSave}
        onClose={onClose}
        createStage={createStage}
      />
    );
    await waitFor(() => expect(stage.setFigures).toHaveBeenCalled());
    // 没有人物时给一个占位小人
    expect(screen.getByRole('option', { name: '人物' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '截图作为构图' }));
    expect((await screen.findByRole('alert')).textContent).toBe('磁盘已满');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('关闭按钮调用 onClose；卸载时释放舞台', async () => {
    const { stage, createStage } = fakeStage();
    const { onClose, unmount } = renderDialog(createStage);
    await waitFor(() => expect(stage.setFigures).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '关闭预演' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(stage.dispose).toHaveBeenCalledTimes(1);
  });

  it('舞台创建失败（无 WebGL）时显示提示，截图按钮保持禁用', async () => {
    const createStage = vi.fn<CreatePrevizStage>(async () => {
      throw new Error('no webgl');
    });
    renderDialog(createStage);
    expect(await screen.findByText('当前环境不支持 3D 预演（需要 WebGL）')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '截图作为构图' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('舞台就绪前已卸载：创建好的舞台立即释放', async () => {
    const { stage } = fakeStage();
    let resolve: (value: PrevizStageApi) => void = () => undefined;
    const createStage = vi.fn<CreatePrevizStage>(
      () => new Promise<PrevizStageApi>((done) => (resolve = done))
    );
    const { unmount } = renderDialog(createStage);
    unmount();
    resolve(stage);
    await waitFor(() => expect(stage.dispose).toHaveBeenCalledTimes(1));
    expect(stage.setCamera).not.toHaveBeenCalled();
  });
});
