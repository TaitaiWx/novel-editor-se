// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PrevizDialog, {
  type CreatePrevizStage,
  type PrevizLabel,
  type PrevizStageApi,
} from '@/render/components/SceneVideoView/Previz';

const PNG = new Uint8Array([137, 80, 78, 71]);

function fakeStage(
  picks: {
    item?: string | null;
    ground?: { x: number; z: number } | null;
  } = {}
) {
  let labelListener: ((labels: PrevizLabel[]) => void) | null = null;
  const stage = {
    resize: vi.fn<PrevizStageApi['resize']>(),
    setFrame: vi.fn<PrevizStageApi['setFrame']>(),
    setCamera: vi.fn<PrevizStageApi['setCamera']>(),
    setFigures: vi.fn<PrevizStageApi['setFigures']>(),
    setProps: vi.fn<PrevizStageApi['setProps']>(),
    setMood: vi.fn<PrevizStageApi['setMood']>(),
    onLabels: vi.fn<PrevizStageApi['onLabels']>((listener) => {
      labelListener = listener;
    }),
    pickGround: vi.fn<PrevizStageApi['pickGround']>(() =>
      picks.ground === undefined ? { x: 20, z: -1.234 } : picks.ground
    ),
    pick: vi.fn<PrevizStageApi['pick']>(() => (picks.item === undefined ? 'f2' : picks.item)),
    capture: vi.fn<PrevizStageApi['capture']>(async () => PNG),
    dispose: vi.fn<() => void>(),
  } satisfies PrevizStageApi;
  const createStage = vi.fn<CreatePrevizStage>(async () => stage);
  const emitLabels = (labels: PrevizLabel[]) => act(() => labelListener?.(labels));
  return { stage, createStage, emitLabels };
}

type Stage = ReturnType<typeof fakeStage>['stage'];

function renderDialog(
  createStage: CreatePrevizStage,
  extra: { shotSize?: string; aspectRatio?: string; available?: string[] } = {}
) {
  const onSave = vi.fn(async (_png: Uint8Array) => undefined);
  const onClose = vi.fn();
  const utils = render(
    <PrevizDialog
      shotLabel="镜头2"
      shotSize={extra.shotSize ?? '近景'}
      characters={['林舟', '苏晴']}
      availableCharacters={extra.available}
      aspectRatio={extra.aspectRatio ?? '16:9'}
      onSave={onSave}
      onClose={onClose}
      createStage={createStage}
    />
  );
  return { ...utils, onSave, onClose };
}

const last = <T extends unknown[]>(mock: { mock: { calls: T[] } }): T => {
  const calls = mock.mock.calls;
  return calls[calls.length - 1];
};
const lastFigures = (stage: Stage) => last(stage.setFigures);
const lastView = (stage: Stage) => last(stage.setCamera)[0];
const figureById = (stage: Stage, id: string) => lastFigures(stage)[0].find((f) => f.id === id);
const frameOf = () => screen.getByTestId('previz-canvas').parentElement as HTMLElement;

async function ready(stage: Stage) {
  await waitFor(() => expect(stage.setFigures).toHaveBeenCalled());
}

describe('PrevizDialog', () => {
  it('渲染对话框；舞台就绪后设置画幅 / 相机 / 时段并放入默认人物', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    expect(screen.getByRole('dialog', { name: '3D 预演 · 镜头2' })).toBeTruthy();
    expect(screen.getByText('正在准备 3D 舞台…')).toBeTruthy();
    const capture = screen.getByRole('button', { name: '截图作为构图' }) as HTMLButtonElement;
    expect(capture.disabled).toBe(true);

    await ready(stage);
    expect(createStage).toHaveBeenCalledWith(screen.getByTestId('previz-canvas'));
    expect(stage.resize).toHaveBeenCalled();
    expect(stage.onLabels).toHaveBeenCalled();
    expect(stage.setFrame).toHaveBeenCalledWith(16 / 9);
    expect(stage.setMood).toHaveBeenCalledWith('day');
    expect(lastView(stage)).toMatchObject({ shotSize: '近景', angle: 'eye', lens: 50, yaw: 0 });
    const [figures, selected] = lastFigures(stage);
    expect(figures.map((figure) => figure.name)).toEqual(['林舟', '苏晴']);
    expect(selected).toBe('f1');
    expect(last(stage.setProps)).toEqual([[], 'f1']);
    expect(screen.queryByText('正在准备 3D 舞台…')).toBeNull();
    expect(capture.disabled).toBe(false);
    // 景别不再是原生下拉框
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('景别分段按钮：未知景别回退中景；换景别时焦距换成常用焦距；角度 / 焦距 / 机位滑块更新相机', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage, { shotSize: '怪景别' });
    await ready(stage);
    const sizes = within(screen.getByRole('radiogroup', { name: '景别' }));
    expect(sizes.getByRole('radio', { name: '中景' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sizes.getByRole('radio', { name: '特写' }));
    expect(lastView(stage)).toMatchObject({ shotSize: '特写', lens: 85 });

    const angles = within(screen.getByRole('radiogroup', { name: '镜头角度' }));
    fireEvent.click(angles.getByRole('radio', { name: '俯视' }));
    expect(lastView(stage)).toMatchObject({ shotSize: '特写', angle: 'high' });
    expect(angles.getByRole('radio', { name: '俯视' }).getAttribute('aria-checked')).toBe('true');

    const lenses = within(screen.getByRole('radiogroup', { name: '焦距' }));
    fireEvent.click(lenses.getByRole('radio', { name: '24mm' }));
    expect(lastView(stage).lens).toBe(24);

    fireEvent.change(screen.getByRole('slider', { name: '机位方向' }), {
      target: { value: '45' },
    });
    expect(lastView(stage).yaw).toBe(45);
    fireEvent.change(screen.getByRole('slider', { name: '机位升降' }), {
      target: { value: '0.5' },
    });
    expect(lastView(stage).pedestal).toBe(0.5);

    // 重置视角：回到正面，景别 / 焦距不变
    fireEvent.click(screen.getByRole('button', { name: '重置视角' }));
    expect(lastView(stage)).toMatchObject({ yaw: 0, pitch: 0, pedestal: 0, lens: 24 });
  });

  it('拖动空白处转动机位：左右改环绕角、上下改俯仰', async () => {
    const { stage, createStage } = fakeStage({ item: null });
    renderDialog(createStage);
    await ready(stage);
    const frame = frameOf();
    fireEvent.pointerDown(frame, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 0, clientY: 150, pointerId: 1 });
    expect(lastView(stage).yaw).toBe(30);
    expect(lastView(stage).pitch).toBe(10);
    fireEvent.pointerUp(frame, { pointerId: 1 });
    const count = stage.setCamera.mock.calls.length;
    fireEvent.pointerMove(frame, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(stage.setCamera.mock.calls.length).toBe(count);
  });

  it('选人物、换姿势、改朝向 / 头部转向 / 抬右手都会更新舞台上的人物', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await ready(stage);
    const people = within(screen.getByRole('listbox', { name: '预演人物' }));
    fireEvent.click(people.getByRole('option', { name: '苏晴' }));
    expect(lastFigures(stage)[1]).toBe('f2');
    expect(people.getByRole('option', { name: '苏晴' }).getAttribute('aria-selected')).toBe('true');

    const poses = within(screen.getByRole('radiogroup', { name: '姿势' }));
    expect(poses.getByRole('radio', { name: '坐' })).toBeTruthy();
    fireEvent.click(poses.getByRole('radio', { name: '指向' }));
    expect(figureById(stage, 'f2')?.pose).toBe('point');
    expect(figureById(stage, 'f1')?.pose).toBe('stand');

    fireEvent.change(screen.getByRole('slider', { name: '人物朝向' }), { target: { value: '90' } });
    expect(figureById(stage, 'f2')?.rotation).toBeCloseTo(Math.PI / 2);
    fireEvent.change(screen.getByRole('slider', { name: '头部转向' }), { target: { value: '30' } });
    expect(figureById(stage, 'f2')?.headTurn).toBe(30);
    fireEvent.change(screen.getByRole('slider', { name: '抬右手' }), { target: { value: '120' } });
    expect(figureById(stage, 'f2')?.armRaise).toBe(120);
  });

  it('按住人物拖动：选中并移动（保持按下时的相对位置，限制在舞台内）', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await ready(stage);
    // 按下时地面点与人物（0.45, 0）相差 (x: 0.45-20, z: 0+1.234)
    const frame = frameOf();
    fireEvent.pointerDown(frame, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(stage.pick).toHaveBeenCalledWith(10, 10);
    stage.pickGround.mockReturnValue({ x: 21, z: -2.234 });
    fireEvent.pointerMove(frame, { clientX: 40, clientY: 30, pointerId: 1 });
    expect(figureById(stage, 'f2')).toMatchObject({ x: 1.45, z: -1 });
    expect(lastFigures(stage)[1]).toBe('f2');
    stage.pickGround.mockReturnValue({ x: 100, z: 0 });
    fireEvent.pointerMove(frame, { clientX: 60, clientY: 30, pointerId: 1 });
    expect(figureById(stage, 'f2')?.x).toBe(8);
    fireEvent.pointerUp(frame, { pointerId: 1 });
    stage.pickGround.mockClear();
    fireEvent.pointerMove(frame, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(stage.pickGround).not.toHaveBeenCalled();

    // 一次拖动只记一步撤销
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(figureById(stage, 'f2')).toMatchObject({ x: 0.45, z: 0 });
  });

  it('Shift + 拖动人物：左右拖动旋转朝向', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await ready(stage);
    const frame = frameOf();
    fireEvent.pointerDown(frame, { clientX: 0, clientY: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerMove(frame, { clientX: 100, clientY: 0, pointerId: 1 });
    expect(figureById(stage, 'f2')?.rotation).toBeCloseTo((69 * Math.PI) / 180, 2);
    expect(figureById(stage, 'f2')?.x).toBe(0.45);
  });

  it('添加 / 移除人物：本场其他人物可一键加入，也可加通用木偶；Delete 移除选中', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage, { available: ['林舟', '苏晴', '秦伯'] });
    await ready(stage);
    expect(screen.queryByRole('button', { name: '添加人物：林舟' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加人物：秦伯' }));
    expect(lastFigures(stage)[0].map((figure) => figure.name)).toEqual(['林舟', '苏晴', '秦伯']);
    expect(lastFigures(stage)[1]).toBe('f3');
    expect(screen.queryByRole('button', { name: '添加人物：秦伯' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加人物' }));
    expect(figureById(stage, 'f4')?.name).toBe('人物4');

    fireEvent.click(screen.getByRole('button', { name: '移除人物：人物4' }));
    expect(figureById(stage, 'f4')).toBeUndefined();
    expect(lastFigures(stage)[1]).toBe('f1');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Delete' });
    expect(lastFigures(stage)[0].map((figure) => figure.name)).toEqual(['苏晴', '秦伯']);
    // ⌘/Ctrl + Z 撤销刚才的移除
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'z', metaKey: true });
    expect(lastFigures(stage)[0].map((figure) => figure.name)).toEqual(['林舟', '苏晴', '秦伯']);
  });

  it('道具：添加后选中，可旋转、键盘 Q / E 旋转、移除；时段切换', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await ready(stage);
    fireEvent.click(screen.getByRole('button', { name: '添加道具：桌子' }));
    expect(last(stage.setProps)[0]).toEqual([expect.objectContaining({ id: 'p1', kind: 'table' })]);
    expect(last(stage.setProps)[1]).toBe('p1');
    fireEvent.click(screen.getByRole('button', { name: '添加道具：墙' }));
    const items = within(screen.getByRole('listbox', { name: '预演道具' }));
    expect(items.getAllByRole('option').map((item) => item.textContent)).toEqual(['桌子', '墙']);
    fireEvent.click(items.getByRole('option', { name: '桌子' }));
    fireEvent.change(screen.getByRole('slider', { name: '道具朝向' }), { target: { value: '45' } });
    expect(last(stage.setProps)[0][0].rotation).toBeCloseTo(Math.PI / 4);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'q' });
    expect(last(stage.setProps)[0][0].rotation).toBeCloseTo(Math.PI / 4 + Math.PI / 12);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'e' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'e' });
    expect(last(stage.setProps)[0][0].rotation).toBeCloseTo(Math.PI / 4 - Math.PI / 12);
    fireEvent.click(screen.getByRole('button', { name: '移除道具：桌子' }));
    expect(last(stage.setProps)[0].map((prop) => prop.kind)).toEqual(['wall']);

    const moods = within(screen.getByRole('radiogroup', { name: '时段' }));
    fireEvent.click(moods.getByRole('radio', { name: '黄昏' }));
    expect(stage.setMood).toHaveBeenLastCalledWith('dusk');
    fireEvent.click(moods.getByRole('radio', { name: '夜晚' }));
    expect(stage.setMood).toHaveBeenLastCalledWith('night');
  });

  it('按住道具拖动会移动道具', async () => {
    const { stage, createStage } = fakeStage({ item: 'p1' });
    renderDialog(createStage);
    await ready(stage);
    fireEvent.click(screen.getByRole('button', { name: '添加道具：箱子' }));
    const frame = frameOf();
    stage.pickGround.mockReturnValue({ x: 0, z: -1.4 });
    fireEvent.pointerDown(frame, { clientX: 1, clientY: 1, pointerId: 1 });
    stage.pickGround.mockReturnValue({ x: 2, z: -3 });
    fireEvent.pointerMove(frame, { clientX: 5, clientY: 5, pointerId: 1 });
    expect(last(stage.setProps)[0][0]).toMatchObject({ x: 2, z: -3 });
  });

  it('叠加层：取景框按画幅、三分线 / 安全框可开关；名字标签来自舞台（都是 DOM，不进截图）', async () => {
    const { stage, createStage, emitLabels } = fakeStage();
    renderDialog(createStage, { aspectRatio: '9:16' });
    // happy-dom 没有布局：在舞台就绪（测量视口）之前给出视口尺寸
    const frame = frameOf();
    Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(frame, 'clientHeight', { configurable: true, value: 500 });
    await ready(stage);
    expect(stage.setFrame).toHaveBeenCalledWith(9 / 16);
    expect(stage.resize).toHaveBeenCalledWith(800, 500);
    const overlay = screen.getByTestId('previz-overlay');
    expect(overlay.textContent).toContain('9:16');
    // 9:16 取景框：高 460（上下各留 20）、宽 259，水平居中
    const mask = overlay.firstElementChild as HTMLElement;
    expect(mask.style.height).toBe('460px');
    expect(mask.style.width).toBe('259px');
    expect(mask.style.left).toBe(`${Math.round((800 - 258.75) / 2)}px`);

    expect(screen.getByTestId('previz-thirds')).toBeTruthy();
    expect(screen.queryByTestId('previz-safe')).toBeNull();
    const thirds = screen.getByRole('button', { name: '三分线' });
    const safe = screen.getByRole('button', { name: '安全框' });
    expect(thirds.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(thirds);
    fireEvent.click(safe);
    expect(thirds.getAttribute('aria-pressed')).toBe('false');
    expect(safe.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('previz-thirds')).toBeNull();
    expect(screen.getByTestId('previz-safe')).toBeTruthy();

    emitLabels([
      { id: 'f1', x: 100, y: 50, visible: true },
      { id: 'f2', x: 200, y: 50, visible: false },
    ]);
    const tags = within(overlay);
    const tag = tags.getByText('林舟');
    expect(tag.style.left).toBe('100px');
    expect(tags.queryByText('苏晴')).toBeNull();
    expect(stage.capture).not.toHaveBeenCalled();
  });

  it('「截图作为构图」：按画幅长边 1280 截图，字节交给 onSave，然后关闭', async () => {
    const { stage, createStage } = fakeStage();
    const { onSave, onClose } = renderDialog(createStage);
    const button = screen.getByRole('button', { name: '截图作为构图' }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(stage.capture).toHaveBeenCalledWith({ width: 1280, height: 720 });
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
    await ready(stage);
    // 没有人物时给一个占位小人
    expect(screen.getByRole('option', { name: '人物' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '截图作为构图' }));
    expect((await screen.findByRole('alert')).textContent).toBe('磁盘已满');
    expect(stage.capture).toHaveBeenCalledWith({ width: 720, height: 1280 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('关闭按钮 / Esc 调用 onClose；卸载时释放舞台', async () => {
    const { stage, createStage } = fakeStage();
    const { onClose, unmount } = renderDialog(createStage);
    await ready(stage);
    fireEvent.click(screen.getByRole('button', { name: '关闭预演' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
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
