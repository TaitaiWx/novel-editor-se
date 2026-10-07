/**
 * 动作库用的最小四元数 / 向量工具（纯函数，[x, y, z, w]，右手坐标系，Y 向上）。
 * 只覆盖 BVH 解析、重定向与采样需要的运算，避免把 three.js 引入纯逻辑包。
 */

export type Quat = readonly [number, number, number, number];
export type Vec3 = readonly [number, number, number];

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

/** 单位四元数的逆（共轭） */
export function quatInvert(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
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

/**
 * 按给定轴顺序组合欧拉角（度）：order = 'zxy' 表示 R = Rz · Rx · Ry（BVH 通道顺序的含义）。
 */
export function quatFromEulerOrder(
  order: string,
  degrees: { x: number; y: number; z: number }
): Quat {
  let result: Quat = QUAT_IDENTITY;
  for (const axis of order) {
    if (axis !== 'x' && axis !== 'y' && axis !== 'z') continue;
    result = quatMultiply(result, quatFromAxisAngle(axis, (degrees[axis] * Math.PI) / 180));
  }
  return result;
}

/** three.js 默认的 'XYZ' 欧拉（弧度）→ 四元数：R = Rx · Ry · Rz */
export function quatFromEulerXYZ(x: number, y: number, z: number): Quat {
  return quatMultiply(
    quatMultiply(quatFromAxisAngle('x', x), quatFromAxisAngle('y', y)),
    quatFromAxisAngle('z', z)
  );
}

/** 四元数 → three.js 'XYZ' 欧拉（弧度） */
export function quatToEulerXYZ(q: Quat): [number, number, number] {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) {
    return [Math.atan2(-m23, m33), ry, Math.atan2(-m12, m11)];
  }
  return [Math.atan2(m32, m22), ry, 0];
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

export function vecRotate(q: Quat, v: Vec3): Vec3 {
  const p: Quat = [v[0], v[1], v[2], 0];
  const r = quatMultiply(quatMultiply(q, p), quatInvert(q));
  return [r[0], r[1], r[2]];
}

export const vecAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vecSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vecScale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const vecDot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vecLength = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const vecCross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function vecNormalize(a: Vec3): Vec3 | null {
  const length = vecLength(a);
  return length > 1e-9 ? vecScale(a, 1 / length) : null;
}

/** 把单位向量 from 转到单位向量 to 的最小旋转 */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const dot = vecDot(from, to);
  if (dot < -0.999999) {
    // 反向：绕任一垂直轴转 180 度
    let axis = vecCross([1, 0, 0], from);
    if (vecLength(axis) < 1e-6) axis = vecCross([0, 1, 0], from);
    const n = vecNormalize(axis) ?? [0, 0, 1];
    return [n[0], n[1], n[2], 0];
  }
  const c = vecCross(from, to);
  return quatNormalize([c[0], c[1], c[2], 1 + dot]);
}

/** 由正交基（三列：新 X / Y / Z 轴在旧坐标中的方向）构造旋转 */
export function quatFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat {
  const [m11, m21, m31] = xAxis;
  const [m12, m22, m32] = yAxis;
  const [m13, m23, m33] = zAxis;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return quatNormalize([(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]);
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return quatNormalize([0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]);
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return quatNormalize([(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]);
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return quatNormalize([(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s]);
}
