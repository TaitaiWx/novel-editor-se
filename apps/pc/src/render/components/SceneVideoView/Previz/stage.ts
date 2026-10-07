/**
 * 3D 预演舞台（three.js）：渐变天空 + 带雾的地平线、半球光 + 主光（柔和阴影）+ 补光、程序生成的木偶小人与白模道具、
 * 按景别 / 焦距 / 环绕摆放的相机。只在预演弹窗里按需加载（动态 import），截图后作为生成首帧图的构图参考。
 *
 * 视口里画面比画幅大一圈（框外有遮罩，见 index.tsx），截图用 setViewOffset 只渲染取景框内的部分。
 */
import * as THREE from 'three';
import {
  cameraPlacement,
  defaultCameraView,
  frameRect,
  lightDirection,
  moodById,
  propPreset,
  type FrameRect,
  type MoodId,
  type PrevizCameraView,
  type PrevizFigure,
  type PrevizProp,
} from './presets';
import {
  applyPose,
  buildMannequin,
  disposeMannequin,
  setMannequinSelected,
  type Mannequin,
} from './mannequin';
import { buildProp, disposeProp, setPropSelected, type PropObject } from './propMeshes';
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

const ACCENT = '#6aa8e0';

/** 选中标记：地面上的圆环 + 指向正面的小三角（看得出朝向） */
function buildSelectionMarker(): THREE.Group {
  const marker = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: ACCENT,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.45, 64), material);
  ring.rotation.x = -Math.PI / 2;
  marker.add(ring);
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-0.07, 0);
  arrowShape.lineTo(0.07, 0);
  arrowShape.lineTo(0, 0.11);
  arrowShape.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), material);
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.z = 0.47;
  marker.add(arrow);
  marker.position.y = 0.006;
  marker.renderOrder = 2;
  return marker;
}

export class PrevizStage implements PrevizStageApi {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 900);
  private readonly raycaster = new THREE.Raycaster();
  private readonly figures = new Map<string, { mannequin: Mannequin; figure: PrevizFigure }>();
  private readonly props = new Map<string, PropObject>();
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly grid: THREE.GridHelper;
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  private readonly key = new THREE.DirectionalLight('#ffffff', 2);
  private readonly fill = new THREE.DirectionalLight('#ffffff', 0.3);
  private readonly marker = buildSelectionMarker();
  private readonly fog = new THREE.Fog('#d9e2ea', 45, 320);
  private view: PrevizCameraView = defaultCameraView('中景');
  private aspect = 16 / 9;
  private width = 0;
  private height = 0;
  private figureSelection: string | null = null;
  private propSelection: string | null = null;
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

    // 网格只是摆位辅助，截图时隐藏
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

    this.marker.visible = false;
    this.scene.add(this.marker);
    this.setMood('day');
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.applyCamera();
  }

  setFrame(aspect: number): void {
    if (!(aspect > 0)) return;
    this.aspect = aspect;
    this.applyCamera();
  }

  setCamera(view: PrevizCameraView): void {
    this.view = view;
    this.applyCamera();
  }

  private frame(): FrameRect {
    if (this.width <= 0 || this.height <= 0) return { x: 0, y: 0, width: 1, height: 1 };
    return frameRect(this.width, this.height, this.aspect);
  }

  /** 让取景框内的视角等于焦距对应的视角：整个视口的视角按比例放大 */
  private applyCamera(): void {
    const placement = cameraPlacement(this.view, this.aspect);
    const rect = this.frame();
    const viewHeight = this.height > 0 ? this.height : rect.height;
    const half = Math.tan((placement.fov * Math.PI) / 360) * (viewHeight / rect.height);
    this.camera.fov = (Math.atan(half) * 360) / Math.PI;
    this.camera.aspect = this.width > 0 && this.height > 0 ? this.width / this.height : this.aspect;
    this.camera.position.set(...placement.position);
    this.camera.lookAt(new THREE.Vector3(...placement.target));
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.placeLights();
    this.render();
  }

  /** 主光 / 补光跟着注视点走，阴影范围始终覆盖人物 */
  private placeLights(): void {
    const focus = new THREE.Vector3(this.view.focusX, 0, this.view.focusZ);
    const [dx, dy, dz] = this.lightDir;
    this.key.target.position.copy(focus);
    this.key.position.set(focus.x + dx * 30, dy * 30, focus.z + dz * 30);
    this.fill.target.position.copy(focus);
    this.fill.position.set(focus.x - dx * 20, 12, focus.z - dz * 20 + 10);
    this.key.target.updateMatrixWorld();
    this.fill.target.updateMatrixWorld();
  }

  setMood(id: MoodId): void {
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
    this.placeLights();
    this.render();
  }

  setFigures(figures: readonly PrevizFigure[], selectedId: string | null): void {
    const ids = new Set(figures.map((figure) => figure.id));
    for (const [id, entry] of this.figures) {
      if (ids.has(id) && entry.figure.color === figures.find((f) => f.id === id)?.color) continue;
      this.scene.remove(entry.mannequin.root);
      disposeMannequin(entry.mannequin);
      this.figures.delete(id);
    }
    for (const figure of figures) {
      let entry = this.figures.get(figure.id);
      if (!entry) {
        const mannequin = buildMannequin(figure.color);
        mannequin.meshes.forEach((mesh) => (mesh.userData.previzId = figure.id));
        entry = { mannequin, figure };
        this.figures.set(figure.id, entry);
        this.scene.add(mannequin.root);
      }
      entry.figure = figure;
      entry.mannequin.root.position.set(figure.x, 0, figure.z);
      entry.mannequin.root.rotation.y = figure.rotation;
      applyPose(entry.mannequin, figure);
      setMannequinSelected(entry.mannequin, figure.id === selectedId);
    }
    this.figureSelection = selectedId && ids.has(selectedId) ? selectedId : null;
    this.updateMarker();
    this.render();
  }

  setProps(props: readonly PrevizProp[], selectedId: string | null): void {
    const ids = new Set(props.map((prop) => prop.id));
    for (const [id, object] of this.props) {
      const next = props.find((prop) => prop.id === id);
      if (next && next.kind === object.kind) continue;
      this.scene.remove(object.root);
      disposeProp(object);
      this.props.delete(id);
    }
    for (const prop of props) {
      let object = this.props.get(prop.id);
      if (!object) {
        object = buildProp(prop.kind);
        object.meshes.forEach((mesh) => (mesh.userData.previzId = prop.id));
        this.props.set(prop.id, object);
        this.scene.add(object.root);
      }
      object.root.position.set(prop.x, 0, prop.z);
      object.root.rotation.y = prop.rotation;
      setPropSelected(object, prop.id === selectedId);
    }
    this.propSelection = selectedId && ids.has(selectedId) ? selectedId : null;
    this.updateMarker();
    this.render();
  }

  private updateMarker(): void {
    const figure = this.figureSelection ? this.figures.get(this.figureSelection) : undefined;
    const prop = this.propSelection ? this.props.get(this.propSelection) : undefined;
    const target = figure?.mannequin.root ?? prop?.root;
    this.marker.visible = Boolean(target);
    if (!target) return;
    this.marker.position.set(target.position.x, 0.006, target.position.z);
    this.marker.rotation.y = target.rotation.y;
    const scale = prop ? Math.max(1, propPreset(prop.kind).radius / 0.42) : 1;
    this.marker.scale.setScalar(scale);
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

  private pointer(clientX: number, clientY: number): THREE.Vector2 {
    // 拾取前确保矩阵是最新的（拖动中可能还没重绘）
    this.scene.updateMatrixWorld();
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  pickGround(clientX: number, clientY: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(this.pointer(clientX, clientY), this.camera);
    const hit = this.raycaster.intersectObject(this.ground)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  pick(clientX: number, clientY: number): string | null {
    this.raycaster.setFromCamera(this.pointer(clientX, clientY), this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const entry of this.figures.values()) meshes.push(...entry.mannequin.meshes);
    for (const object of this.props.values()) meshes.push(...object.meshes);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const id: unknown = hit?.object.userData.previzId;
    return typeof id === 'string' ? id : null;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    this.emitLabels();
  }

  async capture(size: { width: number; height: number }): Promise<Uint8Array> {
    const rect = this.frame();
    const helpers: THREE.Object3D[] = [this.grid, this.marker];
    const visibility = helpers.map((object) => object.visible);
    helpers.forEach((object) => (object.visible = false));
    for (const entry of this.figures.values()) setMannequinSelected(entry.mannequin, false);
    for (const object of this.props.values()) setPropSelected(object, false);
    const pixelRatio = this.renderer.getPixelRatio();
    const scale = size.width / rect.width;
    const fullWidth = (this.width > 0 ? this.width : rect.width) * scale;
    const fullHeight = (this.height > 0 ? this.height : rect.height) * scale;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(size.width, size.height, false);
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
      const blob = await new Promise<Blob | null>((resolve) =>
        this.canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) throw new Error('截图失败');
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      this.camera.clearViewOffset();
      helpers.forEach((object, index) => (object.visible = visibility[index]));
      for (const [id, entry] of this.figures) {
        setMannequinSelected(entry.mannequin, id === this.figureSelection);
      }
      for (const [id, object] of this.props) setPropSelected(object, id === this.propSelection);
      this.renderer.setPixelRatio(pixelRatio);
      if (this.width > 0 && this.height > 0) this.renderer.setSize(this.width, this.height, false);
      this.applyCamera();
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
    // 不调用 forceContextLoss：React StrictMode（开发模式）会卸载后立即在同一个 canvas 上重建舞台，
    // 强制丢失后新的渲染器拿到的是已丢失的上下文（three 读取着色器精度为 null）。
    // canvas 随弹窗移出 DOM 后上下文由浏览器回收
    this.renderer.dispose();
  }
}
