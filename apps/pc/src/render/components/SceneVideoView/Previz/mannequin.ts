/**
 * 程序生成的木偶小人（美术人偶风格：椭球体肢段 + 球形关节 + 带鼻尖 / 下巴 / 耳朵的头部，看得出朝向）。
 * 不需要外部模型文件，无授权问题；身高约 1.77 米，关节可按 poses.ts 的姿势旋转。
 */
import * as THREE from 'three';
import { HIP_HEIGHT, poseById, type JointName, type PrevizFigure } from './presets';

/** 木头本色：人物标识色只混入一点，保持整体统一 */
const WOOD = new THREE.Color('#d9bc94');
const TINT_AMOUNT = 0.32;
const SELECTED_EMISSIVE = new THREE.Color('#2b5a86');

/** 所有椭球共用一个单位球几何体，按缩放成形 */
let unitSphere: THREE.SphereGeometry | null = null;
const sphere = () => (unitSphere ??= new THREE.SphereGeometry(1, 32, 24));

let blobTexture: THREE.CanvasTexture | null = null;
/** 接触阴影贴图（径向渐变），让人物「站」在地面上 */
function contactShadowTexture(): THREE.CanvasTexture | null {
  if (blobTexture) return blobTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.28)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  blobTexture = new THREE.CanvasTexture(canvas);
  return blobTexture;
}

export interface Mannequin {
  root: THREE.Group;
  /** 髋部：整体下移 / 前倾的轴心 */
  hips: THREE.Group;
  joints: Record<JointName, THREE.Group>;
  /** 名字标签的锚点（头顶上方） */
  labelAnchor: THREE.Object3D;
  /** 可点选的网格 */
  meshes: THREE.Mesh[];
  /** 接触阴影（随姿势拉长） */
  contact: THREE.Mesh | null;
  materials: { wood: THREE.MeshStandardMaterial; joint: THREE.MeshStandardMaterial };
  color: string;
}

export function buildMannequin(color: string): Mannequin {
  const tint = WOOD.clone().lerp(new THREE.Color(color), TINT_AMOUNT);
  const wood = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.52, metalness: 0 });
  const joint = new THREE.MeshStandardMaterial({
    color: tint.clone().multiplyScalar(0.78),
    roughness: 0.42,
    metalness: 0,
  });
  const meshes: THREE.Mesh[] = [];

  const ellipsoid = (
    parent: THREE.Object3D,
    radii: [number, number, number],
    position: [number, number, number],
    material: THREE.Material = wood
  ) => {
    const mesh = new THREE.Mesh(sphere(), material);
    mesh.scale.set(...radii);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const ball = (parent: THREE.Object3D, radius: number, y = 0) =>
    ellipsoid(parent, [radius, radius, radius], [0, y, 0], joint);
  const group = (parent: THREE.Object3D, position: [number, number, number]) => {
    const node = new THREE.Group();
    node.position.set(...position);
    parent.add(node);
    return node;
  };

  const root = new THREE.Group();
  const hips = group(root, [0, HIP_HEIGHT, 0]);
  ellipsoid(hips, [0.155, 0.11, 0.11], [0, 0.03, 0]);

  // 躯干：腰 → 胸 → 颈 → 头
  const spine = group(hips, [0, 0.1, 0]);
  ellipsoid(spine, [0.12, 0.1, 0.095], [0, 0.07, 0]);
  const chest = group(spine, [0, 0.16, 0]);
  ellipsoid(chest, [0.175, 0.17, 0.115], [0, 0.12, 0]);
  const neck = group(chest, [0, 0.28, 0]);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.1, 16), joint);
  neckMesh.position.y = 0.03;
  neckMesh.castShadow = true;
  neck.add(neckMesh);
  meshes.push(neckMesh);
  const head = group(neck, [0, 0.07, 0]);
  ellipsoid(head, [0.088, 0.115, 0.1], [0, 0.1, 0]);
  // 脸的朝向：鼻尖、下巴、两侧耳朵
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.045, 12), wood);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.1, 0.105);
  nose.castShadow = true;
  head.add(nose);
  meshes.push(nose);
  ellipsoid(head, [0.058, 0.042, 0.06], [0, 0.035, 0.035]);
  ellipsoid(head, [0.014, 0.03, 0.022], [0.087, 0.1, -0.005], joint);
  ellipsoid(head, [0.014, 0.03, 0.022], [-0.087, 0.1, -0.005], joint);
  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.y = 0.34;
  head.add(labelAnchor);

  const arm = (side: 1 | -1) => {
    const shoulder = group(chest, [0.2 * side, 0.22, 0]);
    ball(shoulder, 0.055);
    const upper = group(shoulder, [0, 0, 0]);
    ellipsoid(upper, [0.048, 0.145, 0.048], [0, -0.145, 0]);
    const fore = group(upper, [0, -0.29, 0]);
    ball(fore, 0.038);
    ellipsoid(fore, [0.04, 0.13, 0.04], [0, -0.13, 0]);
    const hand = group(fore, [0, -0.26, 0]);
    ball(hand, 0.028);
    ellipsoid(hand, [0.022, 0.075, 0.045], [0, -0.08, 0.005]);
    // 拇指在手掌前侧，看得出手心朝向
    const thumb = ellipsoid(hand, [0.013, 0.035, 0.013], [-0.012 * side, -0.05, 0.045]);
    thumb.rotation.x = -0.4;
    return { upper, fore, hand };
  };
  const leg = (side: 1 | -1) => {
    const hip = group(hips, [0.09 * side, -0.02, 0]);
    ball(hip, 0.07);
    const thigh = group(hip, [0, 0, 0]);
    ellipsoid(thigh, [0.075, 0.22, 0.075], [0, -0.22, 0]);
    const shin = group(thigh, [0, -0.44, 0]);
    ball(shin, 0.05);
    ellipsoid(shin, [0.055, 0.215, 0.055], [0, -0.215, 0]);
    const foot = group(shin, [0, -0.43, 0]);
    ball(foot, 0.035);
    ellipsoid(foot, [0.045, 0.032, 0.115], [0, -0.03, 0.05]);
    return { thigh, shin, foot };
  };
  const leftArm = arm(1);
  const rightArm = arm(-1);
  const leftLeg = leg(1);
  const rightLeg = leg(-1);

  let contact: THREE.Mesh | null = null;
  const texture = contactShadowTexture();
  if (texture) {
    contact = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.95),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.004;
    contact.renderOrder = 1;
    root.add(contact);
  }

  return {
    root,
    hips,
    labelAnchor,
    meshes,
    contact,
    color,
    materials: { wood, joint },
    joints: {
      spine,
      chest,
      neck,
      head,
      leftUpperArm: leftArm.upper,
      leftForearm: leftArm.fore,
      leftHand: leftArm.hand,
      rightUpperArm: rightArm.upper,
      rightForearm: rightArm.fore,
      rightHand: rightArm.hand,
      leftThigh: leftLeg.thigh,
      leftShin: leftLeg.shin,
      leftFoot: leftLeg.foot,
      rightThigh: rightLeg.thigh,
      rightShin: rightLeg.shin,
      rightFoot: rightLeg.foot,
    },
  };
}

/** 摆姿势：先清零，再套用预设与微调（头部转向、抬右手） */
export function applyPose(mannequin: Mannequin, figure: PrevizFigure): void {
  const pose = poseById(figure.pose);
  for (const node of Object.values(mannequin.joints)) node.rotation.set(0, 0, 0);
  for (const [name, rotation] of Object.entries(pose.joints)) {
    const node = mannequin.joints[name as JointName];
    if (node && rotation) node.rotation.set(rotation[0], rotation[1], rotation[2]);
  }
  const headTurn = ((figure.headTurn ?? 0) * Math.PI) / 180;
  mannequin.joints.head.rotation.y += headTurn;
  const raise = ((figure.armRaise ?? 0) * Math.PI) / 180;
  mannequin.joints.rightUpperArm.rotation.x -= raise;
  mannequin.hips.position.y = HIP_HEIGHT - (pose.drop ?? 0);
  mannequin.hips.rotation.x = pose.tilt ?? 0;
  if (mannequin.contact) {
    // 躺倒时身体沿前后方向铺开，接触阴影跟着拉长
    const lying = Math.abs(pose.tilt ?? 0) > Math.PI / 4;
    mannequin.contact.scale.set(lying ? 1.1 : 1, lying ? 2.1 : 1, 1);
  }
}

export function setMannequinSelected(mannequin: Mannequin, selected: boolean): void {
  const emissive = selected ? SELECTED_EMISSIVE : new THREE.Color(0x000000);
  mannequin.materials.wood.emissive.copy(emissive);
  mannequin.materials.joint.emissive.copy(emissive);
}

export function disposeMannequin(mannequin: Mannequin): void {
  mannequin.materials.wood.dispose();
  mannequin.materials.joint.dispose();
  for (const mesh of mannequin.meshes) {
    if (mesh.geometry !== unitSphere) mesh.geometry.dispose();
  }
  if (mannequin.contact) {
    mannequin.contact.geometry.dispose();
    (mannequin.contact.material as THREE.Material).dispose();
  }
}
