/**
 * 3D 预演舞台（three.js）：地面网格 + 程序生成的木偶小人（不需要外部模型文件，无授权问题）+ 按景别摆放的相机。
 * 只在预演弹窗里按需加载（动态 import），截图后作为生成首帧图的构图参考。
 */
import * as THREE from 'three';
import {
  cameraPlacement,
  poseById,
  type CameraAngle,
  type JointName,
  type PrevizFigure,
} from './presets';

interface Mannequin {
  root: THREE.Group;
  body: THREE.Group;
  joints: Record<JointName, THREE.Group>;
  label: THREE.Sprite;
}

function limb(
  material: THREE.Material,
  length: number,
  radius: number
): { joint: THREE.Group; end: THREE.Group } {
  const joint = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 10),
    material
  );
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  joint.add(mesh);
  const end = new THREE.Group();
  end.position.y = -length;
  joint.add(end);
  return { joint, end };
}

function textSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(20,20,20,0.75)';
    context.fillRect(0, 0, 256, 64);
    context.fillStyle = color;
    context.font = '32px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text.slice(0, 6), 128, 34);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
  );
  sprite.scale.set(0.6, 0.15, 1);
  sprite.position.y = 2.05;
  return sprite;
}

/** 程序生成的木偶小人（身高约 1.75 米，关节可按姿势旋转） */
function buildMannequin(color: string, name: string): Mannequin {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const pelvis = new THREE.Group();
  pelvis.position.y = 0.95;
  body.add(pelvis);

  const spine = new THREE.Group();
  pelvis.add(spine);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.38, 4, 12), material);
  torso.position.y = 0.3;
  torso.castShadow = true;
  spine.add(torso);

  const head = new THREE.Group();
  head.position.y = 0.62;
  spine.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), material);
  skull.position.y = 0.12;
  skull.castShadow = true;
  head.add(skull);
  // 鼻尖：看得出人物朝向
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 8), material);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.12, 0.13);
  head.add(nose);

  const arm = (side: 1 | -1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.22 * side, 0.52, 0);
    spine.add(shoulder);
    const upper = limb(material, 0.3, 0.05);
    shoulder.add(upper.joint);
    const fore = limb(material, 0.28, 0.045);
    upper.end.add(fore.joint);
    return { upper: upper.joint, fore: fore.joint };
  };
  const leg = (side: 1 | -1) => {
    const hip = new THREE.Group();
    hip.position.set(0.1 * side, 0, 0);
    pelvis.add(hip);
    const thigh = limb(material, 0.46, 0.07);
    hip.add(thigh.joint);
    const shin = limb(material, 0.46, 0.06);
    thigh.end.add(shin.joint);
    return { thigh: thigh.joint, shin: shin.joint };
  };
  const leftArm = arm(1);
  const rightArm = arm(-1);
  const leftLeg = leg(1);
  const rightLeg = leg(-1);
  const label = textSprite(name, color);
  root.add(label);

  return {
    root,
    body,
    label,
    joints: {
      spine,
      head,
      leftUpperArm: leftArm.upper,
      leftForearm: leftArm.fore,
      rightUpperArm: rightArm.upper,
      rightForearm: rightArm.fore,
      leftThigh: leftLeg.thigh,
      leftShin: leftLeg.shin,
      rightThigh: rightLeg.thigh,
      rightShin: rightLeg.shin,
    },
  };
}

function applyPose(mannequin: Mannequin, poseId: string): void {
  const pose = poseById(poseId);
  for (const joint of Object.values(mannequin.joints)) joint.rotation.set(0, 0, 0);
  for (const [name, rotation] of Object.entries(pose.joints)) {
    const joint = mannequin.joints[name as JointName];
    if (joint && rotation) joint.rotation.set(rotation[0], rotation[1], rotation[2]);
  }
  mannequin.body.position.y = -(pose.drop ?? 0);
  mannequin.body.rotation.x = pose.tilt ?? 0;
}

export class PrevizStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 200);
  private readonly figures = new Map<string, Mannequin>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground: THREE.Mesh;
  private selection: THREE.Mesh | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new THREE.Color('#2a2c30');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#3a3a3a', 1.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(4, 8, 6);
    sun.castShadow = true;
    this.scene.add(sun);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: '#3b3e44', roughness: 1 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    const grid = new THREE.GridHelper(40, 40, '#555a62', '#45484f');
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(grid);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  setCamera(shotSize: string, angle: CameraAngle): void {
    const placement = cameraPlacement(shotSize, angle);
    this.camera.fov = placement.fov;
    this.camera.position.set(...placement.position);
    this.camera.lookAt(new THREE.Vector3(...placement.target));
    this.camera.updateProjectionMatrix();
    this.render();
  }

  setFigures(figures: readonly PrevizFigure[], selectedId: string | null): void {
    const ids = new Set(figures.map((figure) => figure.id));
    for (const [id, mannequin] of this.figures) {
      if (!ids.has(id)) {
        this.scene.remove(mannequin.root);
        this.figures.delete(id);
      }
    }
    for (const figure of figures) {
      let mannequin = this.figures.get(figure.id);
      if (!mannequin) {
        mannequin = buildMannequin(figure.color, figure.name);
        this.figures.set(figure.id, mannequin);
        this.scene.add(mannequin.root);
      }
      mannequin.root.position.set(figure.x, 0, figure.z);
      mannequin.root.rotation.y = figure.rotation;
      applyPose(mannequin, figure.pose);
    }
    if (this.selection) {
      this.scene.remove(this.selection);
      this.selection = null;
    }
    const selected = figures.find((figure) => figure.id === selectedId);
    if (selected) {
      this.selection = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.38, 32),
        new THREE.MeshBasicMaterial({ color: '#569cd6', side: THREE.DoubleSide })
      );
      this.selection.rotation.x = -Math.PI / 2;
      this.selection.position.set(selected.x, 0.01, selected.z);
      this.scene.add(this.selection);
    }
    this.render();
  }

  private pointer(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  /** 屏幕坐标 → 地面坐标（拖动人物用） */
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(this.pointer(clientX, clientY), this.camera);
    const hit = this.raycaster.intersectObject(this.ground)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  /** 点中的人物 id */
  pickFigure(clientX: number, clientY: number): string | null {
    this.raycaster.setFromCamera(this.pointer(clientX, clientY), this.camera);
    for (const [id, mannequin] of this.figures) {
      if (this.raycaster.intersectObject(mannequin.body, true).length > 0) return id;
    }
    return null;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** 截图（不含选中圈与名字标签） */
  async capture(): Promise<Uint8Array> {
    const hidden: THREE.Object3D[] = [];
    if (this.selection) hidden.push(this.selection);
    for (const mannequin of this.figures.values()) hidden.push(mannequin.label);
    hidden.forEach((object) => (object.visible = false));
    this.render();
    const blob = await new Promise<Blob | null>((resolve) =>
      this.canvas.toBlob(resolve, 'image/png')
    );
    hidden.forEach((object) => (object.visible = true));
    this.render();
    if (!blob) throw new Error('截图失败');
    return new Uint8Array(await blob.arrayBuffer());
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
