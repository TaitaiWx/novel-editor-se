/**
 * 3D 预演舞台（three.js）：渐变天空 + 带雾的地平线、半球光 + 主光（柔和阴影）+ 补光、程序生成的木偶小人与白模道具。
 * 只在预演弹窗里按需加载（动态 import）。
 *
 * 舞台本身没有动画状态：每次 setSample 显示预演脚本在某一时刻的采样（站位、朝向、姿势混合、步态、机位）。
 * 视口里画面比画幅大一圈（框外有遮罩，见 FrameOverlay），截图 / 导出视频用 setViewOffset 只渲染取景框内的部分。
 */
import * as THREE from 'three';
import type { PrevizFigureSample, PrevizPropItem, PrevizSample } from '@novel-editor/video';
import {
  frameRect,
  lightDirection,
  moodById,
  placementFromSample,
  type FrameRect,
  type MoodId,
} from './presets';
import {
  applyPoseSample,
  buildMannequin,
  disposeMannequin,
  setMannequinSelected,
  type Mannequin,
} from './mannequin';
import { buildProp, disposeProp, type PropObject } from './propMeshes';
import type { PrevizLabel, PrevizStageApi } from './types';

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldPosition;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
varying vec3 vWorldPosition;
void main() {
  float h = normalize(vWorldPosition).y;
  vec3 color = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DEG = Math.PI / 180;

export class PrevizStage implements PrevizStageApi {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 900);
  private readonly raycaster = new THREE.Raycaster();
  private readonly figures = new Map<string, { mannequin: Mannequin; color: string }>();
  private readonly props = new Map<string, PropObject>();
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly grid: THREE.GridHelper;
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  private readonly key = new THREE.DirectionalLight('#ffffff', 2);
  private readonly fill = new THREE.DirectionalLight('#ffffff', 0.3);
  private readonly fog = new THREE.Fog('#d9e2ea', 45, 320);
  private sample: PrevizSample | null = null;
  private mood: MoodId | null = null;
  private aspect = 16 / 9;
  private width = 0;
  private height = 0;
  private highlight: string | null = null;
  private exportSize: { width: number; height: number } | null = null;
  private savedPixelRatio = 1;
  private labelListener: ((labels: PrevizLabel[]) => void) | null = null;
  private lightDir: [number, number, number] = [0.5, 0.8, 0.5];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.fog = this.fog;

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: {
          topColor: { value: new THREE.Color() },
          horizonColor: { value: new THREE.Color() },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    this.scene.add(this.sky);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshStandardMaterial({ color: '#8a8f86', roughness: 1, metalness: 0 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // 网格只是走位辅助，截图 / 导出时隐藏
    this.grid = new THREE.GridHelper(16, 16, '#ffffff', '#ffffff');
    const gridMaterial = this.grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.12;
    gridMaterial.depthWrite = false;
    this.grid.position.y = 0.002;
    this.scene.add(this.grid);

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const shadowCamera = this.key.shadow.camera;
    shadowCamera.left = -10;
    shadowCamera.right = 10;
    shadowCamera.top = 10;
    shadowCamera.bottom = -10;
    shadowCamera.near = 1;
    shadowCamera.far = 80;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 3;
    this.scene.add(this.hemi, this.key, this.key.target, this.fill, this.fill.target);
    this.applyMood('day');
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    if (!this.exportSize) this.renderer.setSize(width, height, false);
    this.applyCamera();
    this.render();
  }

  setFrame(aspect: number): void {
    if (!(aspect > 0)) return;
    this.aspect = aspect;
    this.applyCamera();
    this.render();
  }

  setSample(sample: PrevizSample): void {
    this.applySample(sample);
    this.render();
  }

  setHighlight(id: string | null): void {
    this.highlight = id;
    for (const [figureId, entry] of this.figures) {
      setMannequinSelected(entry.mannequin, figureId === id);
    }
    this.render();
  }

  private applySample(sample: PrevizSample): void {
    this.sample = sample;
    if (sample.mood !== this.mood) this.applyMood(sample.mood);
    this.syncFigures(sample.figures);
    this.syncProps(sample.props);
    this.applyCamera();
  }

  private frame(): FrameRect {
    if (this.width <= 0 || this.height <= 0) return { x: 0, y: 0, width: 1, height: 1 };
    return frameRect(this.width, this.height, this.aspect);
  }

  /** 让取景框内的视角等于焦距对应的视角：整个视口的视角按比例放大 */
  private applyCamera(): void {
    if (!this.sample) return;
    const placement = placementFromSample(this.sample.camera, this.aspect);
    const rect = this.frame();
    const viewHeight = this.height > 0 ? this.height : rect.height;
    const half = Math.tan((placement.fov * Math.PI) / 360) * (viewHeight / rect.height);
    this.camera.fov = (Math.atan(half) * 360) / Math.PI;
    this.camera.aspect = this.width > 0 && this.height > 0 ? this.width / this.height : this.aspect;
    this.camera.position.set(...placement.position);
    this.camera.lookAt(new THREE.Vector3(...placement.target));
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.placeLights(placement.target[0], placement.target[2]);
  }

  /** 主光 / 补光跟着注视点走，阴影范围始终覆盖人物 */
  private placeLights(focusX: number, focusZ: number): void {
    const focus = new THREE.Vector3(focusX, 0, focusZ);
    const [dx, dy, dz] = this.lightDir;
    this.key.target.position.copy(focus);
    this.key.position.set(focus.x + dx * 30, dy * 30, focus.z + dz * 30);
    this.fill.target.position.copy(focus);
    this.fill.position.set(focus.x - dx * 20, 12, focus.z - dz * 20 + 10);
    this.key.target.updateMatrixWorld();
    this.fill.target.updateMatrixWorld();
  }

  private applyMood(id: MoodId): void {
    this.mood = id;
    const mood = moodById(id);
    this.sky.material.uniforms.topColor.value.set(mood.skyTop);
    this.sky.material.uniforms.horizonColor.value.set(mood.skyHorizon);
    this.fog.color.set(mood.skyHorizon);
    this.ground.material.color.set(mood.ground);
    this.hemi.color.set(mood.hemiSky);
    this.hemi.groundColor.set(mood.hemiGround);
    this.hemi.intensity = mood.hemiIntensity;
    this.key.color.set(mood.keyColor);
    this.key.intensity = mood.keyIntensity;
    this.fill.color.set(mood.hemiSky);
    this.fill.intensity = mood.fillIntensity;
    this.renderer.toneMappingExposure = mood.exposure;
    this.lightDir = lightDirection(mood);
  }

  private syncFigures(figures: readonly PrevizFigureSample[]): void {
    const byId = new Map(figures.map((figure) => [figure.id, figure]));
    for (const [id, entry] of this.figures) {
      if (byId.get(id)?.color === entry.color) continue;
      this.scene.remove(entry.mannequin.root);
      disposeMannequin(entry.mannequin);
      this.figures.delete(id);
    }
    for (const figure of figures) {
      let entry = this.figures.get(figure.id);
      if (!entry) {
        const mannequin = buildMannequin(figure.color);
        mannequin.meshes.forEach((mesh) => (mesh.userData.previzId = figure.id));
        entry = { mannequin, color: figure.color };
        this.figures.set(figure.id, entry);
        this.scene.add(mannequin.root);
        setMannequinSelected(mannequin, figure.id === this.highlight);
      }
      entry.mannequin.root.position.set(figure.x, 0, figure.z);
      entry.mannequin.root.rotation.y = figure.facing * DEG;
      applyPoseSample(entry.mannequin, figure);
    }
  }

  private syncProps(props: readonly PrevizPropItem[]): void {
    const byId = new Map(props.map((prop) => [prop.id, prop]));
    for (const [id, object] of this.props) {
      if (byId.get(id)?.kind === object.kind) continue;
      this.scene.remove(object.root);
      disposeProp(object);
      this.props.delete(id);
    }
    for (const prop of props) {
      let object = this.props.get(prop.id);
      if (!object) {
        object = buildProp(prop.kind);
        this.props.set(prop.id, object);
        this.scene.add(object.root);
      }
      object.root.position.set(prop.x, 0, prop.z);
      object.root.rotation.y = prop.facing * DEG;
    }
  }

  onLabels(listener: (labels: PrevizLabel[]) => void): void {
    this.labelListener = listener;
    this.emitLabels();
  }

  private emitLabels(): void {
    if (!this.labelListener || this.width <= 0 || this.height <= 0) return;
    const point = new THREE.Vector3();
    const labels: PrevizLabel[] = [];
    for (const [id, entry] of this.figures) {
      entry.mannequin.labelAnchor.getWorldPosition(point);
      point.project(this.camera);
      const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1.05;
      labels.push({
        id,
        x: Math.round(((point.x + 1) / 2) * this.width),
        y: Math.round(((1 - point.y) / 2) * this.height),
        visible: visible && point.y <= 1.2 && point.y >= -1,
      });
    }
    this.labelListener(labels);
  }

  pick(clientX: number, clientY: number): string | null {
    // 拾取前确保矩阵是最新的（拖动中可能还没重绘）
    this.scene.updateMatrixWorld();
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const entry of this.figures.values()) meshes.push(...entry.mannequin.meshes);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const id: unknown = hit?.object.userData.previzId;
    return typeof id === 'string' ? id : null;
  }

  render(): void {
    if (this.exportSize) return;
    this.renderer.render(this.scene, this.camera);
    this.emitLabels();
  }

  beginExport(size: { width: number; height: number }): void {
    if (this.exportSize) this.endExport();
    this.exportSize = size;
    this.grid.visible = false;
    for (const entry of this.figures.values()) setMannequinSelected(entry.mannequin, false);
    this.savedPixelRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size.width, size.height, false);
  }

  /** 导出尺寸下渲染取景框内的画面 */
  private renderFrameOnly(): void {
    const size = this.exportSize;
    if (!size) return;
    const rect = this.frame();
    const scale = size.width / rect.width;
    const fullWidth = (this.width > 0 ? this.width : rect.width) * scale;
    const fullHeight = (this.height > 0 ? this.height : rect.height) * scale;
    this.applyCamera();
    this.camera.aspect = fullWidth / fullHeight;
    this.camera.setViewOffset(
      fullWidth,
      fullHeight,
      rect.x * scale,
      rect.y * scale,
      size.width,
      size.height
    );
    this.renderer.render(this.scene, this.camera);
    this.camera.clearViewOffset();
  }

  renderExportFrame(sample: PrevizSample): CanvasImageSource {
    this.applySample(sample);
    this.renderFrameOnly();
    return this.canvas;
  }

  endExport(): void {
    if (!this.exportSize) return;
    this.exportSize = null;
    this.grid.visible = true;
    for (const [id, entry] of this.figures) {
      setMannequinSelected(entry.mannequin, id === this.highlight);
    }
    this.renderer.setPixelRatio(this.savedPixelRatio);
    if (this.width > 0 && this.height > 0) this.renderer.setSize(this.width, this.height, false);
    this.applyCamera();
    this.render();
  }

  async capture(size: { width: number; height: number }): Promise<Uint8Array> {
    this.beginExport(size);
    try {
      this.renderFrameOnly();
      const blob = await new Promise<Blob | null>((resolve) =>
        this.canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) throw new Error('截图失败');
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      this.endExport();
    }
  }

  dispose(): void {
    this.labelListener = null;
    for (const entry of this.figures.values()) disposeMannequin(entry.mannequin);
    for (const object of this.props.values()) disposeProp(object);
    this.figures.clear();
    this.props.clear();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.grid.dispose();
    // 不调用 forceContextLoss：React StrictMode（开发模式）会卸载后立即重建舞台，
    // 强制丢失后新的渲染器可能拿到已丢失的上下文（three 读取着色器精度为 null）。
    // canvas 随弹窗移出 DOM 后上下文由浏览器回收
    this.renderer.dispose();
  }
}
