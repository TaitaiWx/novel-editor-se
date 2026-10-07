/**
 * 3D 预演的简单道具（白模风格，只表达体积与位置）：墙、门、桌子、椅子、柱子、树、箱子，
 * 以及通用几何体（方块 / 圆柱 / 球，按预演脚本的 size 缩放成任意物体）。color 给出时所有部件用这个颜色。
 */
import * as THREE from 'three';
import type { PropKind } from './presets';

export interface PropObject {
  root: THREE.Group;
  meshes: THREE.Mesh[];
  materials: THREE.MeshStandardMaterial[];
  geometries: THREE.BufferGeometry[];
  kind: PropKind;
}

const SELECTED_EMISSIVE = new THREE.Color('#2b5a86');

export function buildProp(kind: PropKind, color?: string): PropObject {
  const root = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const material = (base: string, roughness = 0.85) => {
    const item = new THREE.MeshStandardMaterial({ color: color ?? base, roughness, metalness: 0 });
    materials.push(item);
    return item;
  };
  const add = (
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    position: [number, number, number],
    rotation: [number, number, number] = [0, 0, 0]
  ) => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const box = (
    size: [number, number, number],
    mat: THREE.Material,
    position: [number, number, number]
  ) => add(new THREE.BoxGeometry(...size), mat, position);

  switch (kind) {
    case 'wall': {
      const plaster = material('#c9c3b8', 0.95);
      box([3.2, 2.7, 0.2], plaster, [0, 1.35, 0]);
      box([3.24, 0.12, 0.24], material('#a9a296'), [0, 0.06, 0]);
      break;
    }
    case 'door': {
      const frame = material('#9c8f7e');
      box([0.1, 2.2, 0.16], frame, [-0.55, 1.1, 0]);
      box([0.1, 2.2, 0.16], frame, [0.55, 1.1, 0]);
      box([1.2, 0.12, 0.16], frame, [0, 2.26, 0]);
      // 门扇半开，看得出是门
      const leaf = new THREE.Group();
      leaf.position.set(-0.5, 0, 0);
      leaf.rotation.y = -0.6;
      root.add(leaf);
      const panelGeometry = new THREE.BoxGeometry(0.98, 2.12, 0.05);
      geometries.push(panelGeometry);
      const panel = new THREE.Mesh(panelGeometry, material('#b9a68c', 0.75));
      panel.position.set(0.49, 1.07, 0);
      panel.castShadow = true;
      panel.receiveShadow = true;
      leaf.add(panel);
      meshes.push(panel);
      break;
    }
    case 'table': {
      const wood = material('#a88f72', 0.7);
      box([1.4, 0.05, 0.8], wood, [0, 0.74, 0]);
      for (const x of [-0.62, 0.62]) {
        for (const z of [-0.32, 0.32]) box([0.06, 0.72, 0.06], wood, [x, 0.36, z]);
      }
      break;
    }
    case 'chair': {
      const wood = material('#a88f72', 0.7);
      box([0.46, 0.05, 0.44], wood, [0, 0.42, 0]);
      for (const x of [-0.2, 0.2]) {
        for (const z of [-0.19, 0.19]) box([0.04, 0.42, 0.04], wood, [x, 0.21, z]);
        box([0.04, 0.5, 0.04], wood, [x, 0.69, -0.19]);
      }
      box([0.44, 0.18, 0.03], wood, [0, 0.86, -0.19]);
      break;
    }
    case 'pillar': {
      const stone = material('#c4bdb1', 0.9);
      add(new THREE.CylinderGeometry(0.22, 0.25, 3, 24), stone, [0, 1.5, 0]);
      box([0.62, 0.14, 0.62], stone, [0, 0.07, 0]);
      box([0.6, 0.12, 0.6], stone, [0, 3.04, 0]);
      break;
    }
    case 'tree': {
      add(new THREE.CylinderGeometry(0.1, 0.16, 2.2, 12), material('#7d6a55', 0.95), [0, 1.1, 0]);
      const leaves = material('#7f9a72', 0.9);
      add(new THREE.IcosahedronGeometry(0.95, 1), leaves, [0, 2.6, 0]);
      add(new THREE.IcosahedronGeometry(0.7, 1), leaves, [0.45, 2.25, 0.2]);
      add(new THREE.IcosahedronGeometry(0.6, 1), leaves, [-0.4, 2.3, -0.25]);
      break;
    }
    case 'box': {
      box([1, 1, 1], material('#b8b2a6'), [0, 0.5, 0]);
      break;
    }
    case 'cylinder': {
      add(new THREE.CylinderGeometry(0.25, 0.25, 1, 24), material('#b8b2a6'), [0, 0.5, 0]);
      break;
    }
    case 'sphere': {
      add(new THREE.SphereGeometry(0.25, 24, 16), material('#b8b2a6'), [0, 0.25, 0]);
      break;
    }
    case 'crate':
    default: {
      box([0.6, 0.6, 0.6], material('#b39b7c', 0.8), [0, 0.3, 0]);
      break;
    }
  }
  return { root, meshes, materials, geometries, kind };
}

export function setPropSelected(prop: PropObject, selected: boolean): void {
  for (const item of prop.materials) {
    item.emissive.copy(selected ? SELECTED_EMISSIVE : new THREE.Color(0x000000));
  }
}

export function disposeProp(prop: PropObject): void {
  prop.materials.forEach((item) => item.dispose());
  prop.geometries.forEach((item) => item.dispose());
}
