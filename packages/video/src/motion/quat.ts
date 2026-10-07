/**
 * 预演动作用的最小四元数 / 向量工具（纯函数，[x, y, z, w]，右手坐标系，Y 向上）。
 * 只覆盖关节轨迹采样需要的运算，避免把 three.js 引入纯逻辑包。
 */

export type Quat = readonly [number, number, number, number];

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatNormalize(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(length > 1e-12)) return QUAT_IDENTITY;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function quatFromAxisAngle(axis: 'x' | 'y' | 'z', radians: number): Quat {
  const half = radians / 2;
  const s = Math.sin(half);
  const c = Math.cos(half);
  if (axis === 'x') return [s, 0, 0, c];
  if (axis === 'y') return [0, s, 0, c];
  return [0, 0, s, c];
}

/** three.js 默认的 'XYZ' 欧拉（弧度）→ 四元数：R = Rx · Ry · Rz */
export function quatFromEulerXYZ(x: number, y: number, z: number): Quat {
  return quatMultiply(
    quatMultiply(quatFromAxisAngle('x', x), quatFromAxisAngle('y', y)),
    quatFromAxisAngle('z', z)
  );
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  if (t <= 0) return a;
  if (t >= 1) return b;
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  // 走最短弧
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cos > 0.9995) {
    return quatNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const theta = Math.acos(cos);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}
