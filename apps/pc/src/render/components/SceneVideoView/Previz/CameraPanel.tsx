/**
 * 预演侧栏「镜头」：景别（分段按钮）、角度、焦距、机位方向与升降。
 */
import React from 'react';
import { Choice, Slider } from './controls';
import { CAMERA_ANGLES, LENSES, SHOT_SIZES, type PrevizCameraView } from './presets';
import type { PrevizScene } from './usePrevizScene';
import styles from './styles.module.scss';

const SHOT_OPTIONS = SHOT_SIZES.map((size) => ({ id: size, label: size }));
const LENS_OPTIONS = LENSES.map((lens) => ({
  id: lens,
  label: `${lens}mm`,
  hint: lens <= 24 ? '广角：空间感强' : lens >= 85 ? '长焦：背景压缩、人物突出' : '标准',
}));

interface CameraPanelProps {
  view: PrevizCameraView;
  camera: PrevizScene['camera'];
}

const CameraPanel: React.FC<CameraPanelProps> = ({ view, camera }) => (
  <section className={styles.group} aria-label="镜头">
    <h3>镜头</h3>
    <Choice
      label="景别"
      variant="chips"
      options={SHOT_OPTIONS}
      value={view.shotSize}
      onChange={camera.setShotSize}
    />
    <Choice
      label="镜头角度"
      options={CAMERA_ANGLES}
      value={view.angle}
      onChange={camera.setAngle}
    />
    <Choice label="焦距" options={LENS_OPTIONS} value={view.lens} onChange={camera.setLens} />
    <Slider
      label="机位方向"
      min={-180}
      max={180}
      step={5}
      unit="°"
      value={Math.round(view.yaw)}
      onChange={camera.setYaw}
    />
    <Slider
      label="机位升降"
      min={-2}
      max={2}
      step={0.05}
      unit="m"
      value={view.pedestal}
      onChange={camera.setPedestal}
    />
  </section>
);

export default CameraPanel;
