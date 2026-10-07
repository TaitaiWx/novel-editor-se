/* eslint-disable */
/**
 * 示例作品集的程序化插画（在 Electron 隐藏窗口里运行，见 ../generate-sample-media.mjs）：
 * - 人物：扁平插画风格的全身像，支持 正面 / 侧面 / 背面，用于「形象图」与「三视图」
 * - 设定：星辉灯塔、星港城概念图
 * - 视频：《离港》短片的逐帧绘制
 * 只依赖 Canvas 2D，结果完全确定（不使用随机数，伪随机由固定种子生成）。
 */
(function () {
  'use strict';

  // ─── 工具 ────────────────────────────────────────────────────────────────

  function hexToRgb(hex) {
    const value = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  }
  function rgbToHex(rgb) {
    return (
      '#' +
      rgb
        .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
        .join('')
    );
  }
  /** amount > 0 变亮，< 0 变暗 */
  function shade(hex, amount) {
    const rgb = hexToRgb(hex);
    return rgbToHex(rgb.map((v) => (amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  }
  function mix(a, b, t) {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
  }
  function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  /** 固定种子的伪随机 */
  function seeded(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function poly(ctx, points, fill, stroke, lineWidth) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  /** 平滑闭合曲线（经过各点的二次贝塞尔中点法） */
  function smooth(ctx, points, fill, stroke, lineWidth) {
    ctx.beginPath();
    const n = points.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(points[n - 1], points[0]);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i += 1) {
      const p = points[i];
      const m = mid(p, points[(i + 1) % n]);
      ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
    }
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  function ellipse(ctx, x, y, rx, ry, fill, stroke, lineWidth, rotation) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rotation || 0, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function line(ctx, points, stroke, lineWidth, cap) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = cap || 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  /** 两点之间的锥形肢体（起点宽 w1，终点宽 w2） */
  function limb(ctx, a, b, w1, w2, fill, stroke, lineWidth) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    smooth(
      ctx,
      [
        [a[0] + nx * w1, a[1] + ny * w1],
        [(a[0] + b[0]) / 2 + nx * (w1 + w2) * 0.52, (a[1] + b[1]) / 2 + ny * (w1 + w2) * 0.52],
        [b[0] + nx * w2, b[1] + ny * w2],
        [b[0] + dx / len * w2 * 0.6, b[1] + dy / len * w2 * 0.6],
        [b[0] - nx * w2, b[1] - ny * w2],
        [(a[0] + b[0]) / 2 - nx * (w1 + w2) * 0.52, (a[1] + b[1]) / 2 - ny * (w1 + w2) * 0.52],
        [a[0] - nx * w1, a[1] - ny * w1],
        [a[0] - dx / len * w1 * 0.5, a[1] - dy / len * w1 * 0.5],
      ],
      fill,
      stroke,
      lineWidth
    );
  }

  // ─── 人物 ────────────────────────────────────────────────────────────────

  /**
   * 计算人物骨架。H 为身高（像素），脚底在 footY。
   * u：头高；w：身体宽度单位（成人头高，儿童按身体比例缩小）
   */
  function skeleton(spec, cx, footY, H) {
    const heads = spec.heads || 6.6;
    const u = H / heads;
    const top = footY - H;
    const chin = top + u;
    const body = footY - chin;
    const w = (body / 5.6) * (spec.build || 1);
    const at = (fraction) => chin + body * fraction;
    return {
      cx,
      footY,
      H,
      u,
      w,
      top,
      headCY: top + u * 0.5,
      chin,
      shoulder: at(0.04),
      chest: at(0.16),
      waist: at(0.33),
      hip: at(0.41),
      crotch: at(0.455),
      knee: at(0.705),
      ankle: at(0.962),
    };
  }

  function outlineOf(color) {
    return shade(color, -0.45);
  }

  function hemFor(spec, s) {
    switch (spec.top.style) {
      case 'robe':
        return { y: s.knee + s.w * 0.55, half: s.w * 1.0 };
      case 'long-coat':
        return { y: s.ankle - s.w * 0.55, half: s.w * 0.98 };
      case 'tunic':
        return { y: s.hip + s.w * 0.22, half: s.w * 0.72 };
      case 'shirt':
        return { y: s.hip + s.w * 0.12, half: s.w * 0.7 };
      default:
        return { y: s.hip + s.w * 0.42, half: s.w * 0.8 };
    }
  }

  function drawLegsFront(ctx, spec, s, lw) {
    const pants = spec.pants;
    const o = outlineOf(pants);
    const shortLegs = spec.shorts;
    for (const side of [-1, 1]) {
      const hipX = s.cx + side * s.w * 0.36;
      const kneeX = s.cx + side * s.w * 0.33;
      const ankleX = s.cx + side * s.w * 0.3;
      if (shortLegs) {
        // 小腿露出皮肤
        limb(ctx, [kneeX, s.knee - s.w * 0.1], [ankleX, s.ankle], s.w * 0.13, s.w * 0.1, spec.skin, outlineOf(spec.skin), lw);
        limb(ctx, [hipX, s.hip], [kneeX, s.knee + s.w * 0.02], s.w * 0.27, s.w * 0.21, pants, o, lw);
      } else {
        limb(ctx, [kneeX, s.knee], [ankleX, s.ankle], s.w * 0.17, s.w * 0.13, pants, o, lw);
        limb(ctx, [hipX, s.hip], [kneeX, s.knee], s.w * 0.27, s.w * 0.18, pants, o, lw);
      }
      drawFootFront(ctx, spec, s, ankleX, side, lw);
    }
  }

  function drawFootFront(ctx, spec, s, x, side, lw) {
    if (spec.barefoot) {
      ellipse(ctx, x + side * s.w * 0.02, s.footY - s.w * 0.06, s.w * 0.12, s.w * 0.07, spec.skin, outlineOf(spec.skin), lw);
      return;
    }
    const boot = spec.boots;
    smooth(
      ctx,
      [
        [x - s.w * 0.15, s.ankle - s.w * 0.18],
        [x + s.w * 0.15, s.ankle - s.w * 0.18],
        [x + s.w * 0.17 + side * s.w * 0.03, s.footY - s.w * 0.04],
        [x + side * s.w * 0.04, s.footY + s.w * 0.01],
        [x - s.w * 0.17 + side * s.w * 0.03, s.footY - s.w * 0.04],
      ],
      boot,
      outlineOf(boot),
      lw
    );
  }

  /** 正 / 背面上衣轮廓 */
  function torsoPoints(spec, s, hem, back) {
    const sw = s.w * 0.92;
    const ww = s.w * 0.6;
    const neck = s.w * 0.17;
    const flare = spec.top.style === 'robe' || spec.top.style === 'long-coat';
    return [
      [s.cx - neck, s.shoulder - s.w * 0.04],
      [s.cx - sw * 0.7, s.shoulder + s.w * 0.02],
      [s.cx - sw, s.shoulder + s.w * 0.18],
      [s.cx - sw * 0.9, s.chest + s.w * 0.15],
      [s.cx - ww, s.waist],
      [s.cx - (flare ? hem.half * 0.8 : hem.half), (s.waist + hem.y) / 2],
      [s.cx - hem.half, hem.y],
      [s.cx, hem.y + s.w * (flare ? 0.04 : 0.02)],
      [s.cx + hem.half, hem.y],
      [s.cx + (flare ? hem.half * 0.8 : hem.half), (s.waist + hem.y) / 2],
      [s.cx + ww, s.waist],
      [s.cx + sw * 0.9, s.chest + s.w * 0.15],
      [s.cx + sw, s.shoulder + s.w * 0.18],
      [s.cx + sw * 0.7, s.shoulder + s.w * 0.02],
      [s.cx + neck, s.shoulder - s.w * 0.04],
      [s.cx, s.shoulder + (back ? -s.w * 0.02 : s.w * 0.12)],
    ];
  }

  function drawTorsoFront(ctx, spec, s, lw, back) {
    const hem = hemFor(spec, s);
    const top = spec.top;
    const pts = torsoPoints(spec, s, hem, back);
    poly(ctx, pts, top.color, outlineOf(top.color), lw);
    // 明暗：左半边略暗
    ctx.save();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = rgba('#000000', 0.12);
    ctx.fillRect(s.cx - s.w * 1.5, s.top, s.w * (back ? 1.5 : 0.55), s.H);
    ctx.restore();

    if (!back) {
      if (top.style === 'long-coat') {
        // 敞开的长外套：内衬 + 两条翻领
        poly(
          ctx,
          [
            [s.cx - s.w * 0.17, s.shoulder],
            [s.cx + s.w * 0.17, s.shoulder],
            [s.cx + s.w * 0.14, hem.y - s.w * 0.02],
            [s.cx - s.w * 0.14, hem.y - s.w * 0.02],
          ],
          top.inner,
          outlineOf(top.inner),
          lw
        );
        line(ctx, [[s.cx - s.w * 0.17, s.shoulder], [s.cx - s.w * 0.32, s.chest + s.w * 0.1], [s.cx - s.w * 0.16, hem.y]], top.trim, s.w * 0.08);
        line(ctx, [[s.cx + s.w * 0.17, s.shoulder], [s.cx + s.w * 0.32, s.chest + s.w * 0.1], [s.cx + s.w * 0.16, hem.y]], top.trim, s.w * 0.08);
        for (let i = 0; i < 3; i += 1) {
          ellipse(ctx, s.cx - s.w * 0.3, s.chest + s.w * (0.45 + i * 0.32), s.w * 0.035, s.w * 0.035, top.trim);
        }
      } else if (top.style === 'shirt') {
        line(ctx, [[s.cx - s.w * 0.16, s.shoulder], [s.cx, s.chest - s.w * 0.05], [s.cx + s.w * 0.16, s.shoulder]], shade(top.color, -0.3), lw);
      } else {
        // 交领右衽：左襟压右襟
        line(ctx, [[s.cx - s.w * 0.17, s.shoulder - s.w * 0.02], [s.cx + s.w * 0.28, s.waist - s.w * 0.05]], top.trim, s.w * 0.09);
        line(ctx, [[s.cx + s.w * 0.17, s.shoulder - s.w * 0.02], [s.cx + s.w * 0.02, s.chest - s.w * 0.08]], top.trim, s.w * 0.09);
        if (top.style === 'robe') {
          line(ctx, [[s.cx + s.w * 0.28, s.waist], [s.cx + s.w * 0.4, hem.y - s.w * 0.02]], shade(top.color, -0.22), lw);
        }
      }
      if (spec.patch) {
        poly(
          ctx,
          [
            [s.cx + s.w * 0.12, s.chest + s.w * 0.3],
            [s.cx + s.w * 0.38, s.chest + s.w * 0.27],
            [s.cx + s.w * 0.4, s.chest + s.w * 0.52],
            [s.cx + s.w * 0.14, s.chest + s.w * 0.55],
          ],
          spec.patch,
          outlineOf(spec.patch),
          lw * 0.8
        );
      }
    } else {
      line(ctx, [[s.cx, s.shoulder + s.w * 0.05], [s.cx, hem.y - s.w * 0.05]], shade(top.color, -0.18), lw * 0.8);
    }
    if (spec.apron && !back) {
      poly(
        ctx,
        [
          [s.cx - s.w * 0.36, s.chest - s.w * 0.05],
          [s.cx + s.w * 0.36, s.chest - s.w * 0.05],
          [s.cx + s.w * 0.62, s.knee + s.w * 0.1],
          [s.cx - s.w * 0.62, s.knee + s.w * 0.1],
        ],
        spec.apron,
        outlineOf(spec.apron),
        lw
      );
      line(ctx, [[s.cx - s.w * 0.34, s.chest - s.w * 0.05], [s.cx - s.w * 0.2, s.shoulder]], shade(spec.apron, -0.2), s.w * 0.06);
      line(ctx, [[s.cx + s.w * 0.34, s.chest - s.w * 0.05], [s.cx + s.w * 0.2, s.shoulder]], shade(spec.apron, -0.2), s.w * 0.06);
      ellipse(ctx, s.cx, s.waist + s.w * 0.55, s.w * 0.2, s.w * 0.12, shade(spec.apron, -0.12));
    }
    // 腰带 / 腰封
    if (spec.belt) {
      const bw = s.w * 0.62;
      poly(
        ctx,
        [
          [s.cx - bw, s.waist - s.w * 0.09],
          [s.cx + bw, s.waist - s.w * 0.09],
          [s.cx + bw * 1.02, s.waist + s.w * 0.09],
          [s.cx - bw * 1.02, s.waist + s.w * 0.09],
        ],
        spec.belt,
        outlineOf(spec.belt),
        lw
      );
      if (spec.top.style === 'robe' && !back) {
        line(ctx, [[s.cx + s.w * 0.3, s.waist + s.w * 0.05], [s.cx + s.w * 0.36, s.waist + s.w * 0.7]], spec.belt, s.w * 0.1);
        line(ctx, [[s.cx + s.w * 0.36, s.waist + s.w * 0.05], [s.cx + s.w * 0.5, s.waist + s.w * 0.6]], spec.belt, s.w * 0.09);
      }
    }
  }

  function drawArmsFront(ctx, spec, s, lw) {
    const sleeve = spec.top.color;
    for (const side of [-1, 1]) {
      const shoulder = [s.cx + side * s.w * 0.86, s.shoulder + s.w * 0.24];
      const elbow = [s.cx + side * s.w * 1.0, s.waist - s.w * 0.08];
      const wrist = [s.cx + side * s.w * 1.06, s.crotch - s.w * 0.08];
      if (spec.rolledSleeves) {
        limb(ctx, elbow, wrist, s.w * 0.15, s.w * 0.11, spec.skin, outlineOf(spec.skin), lw);
        limb(ctx, shoulder, [elbow[0], elbow[1] + s.w * 0.08], s.w * 0.22, s.w * 0.19, sleeve, outlineOf(sleeve), lw);
      } else {
        limb(ctx, shoulder, elbow, s.w * 0.21, s.w * 0.17, sleeve, outlineOf(sleeve), lw);
        limb(ctx, elbow, wrist, s.w * 0.17, s.w * 0.15, sleeve, outlineOf(sleeve), lw);
        line(ctx, [[wrist[0] - s.w * 0.14, wrist[1] - s.w * 0.02], [wrist[0] + s.w * 0.14, wrist[1] - s.w * 0.02]], spec.top.trim || shade(sleeve, -0.25), s.w * 0.06);
      }
      ellipse(ctx, wrist[0], wrist[1] + s.w * 0.12, s.w * 0.11, s.w * 0.13, spec.skin, outlineOf(spec.skin), lw);
      // 绷带缠在人物左臂（正面视图的画面右侧）
      if (spec.bandage && side === 1) {
        for (let i = 0; i < 3; i += 1) {
          const t = 0.25 + i * 0.22;
          const x = elbow[0] + (wrist[0] - elbow[0]) * t;
          const y = elbow[1] + (wrist[1] - elbow[1]) * t;
          line(ctx, [[x - s.w * 0.17, y - s.w * 0.03], [x + s.w * 0.17, y + s.w * 0.04]], '#efe9dc', s.w * 0.06);
        }
      }
    }
  }

  function drawHammer(ctx, s, x, y, lw, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    line(ctx, [[0, -s.w * 0.1], [0, s.w * 0.95]], '#7a5a3a', s.w * 0.08);
    poly(
      ctx,
      [
        [-s.w * 0.24, s.w * 0.82],
        [s.w * 0.24, s.w * 0.82],
        [s.w * 0.24, s.w * 1.08],
        [-s.w * 0.24, s.w * 1.08],
      ],
      '#5d636c',
      '#2c3036',
      lw
    );
    ctx.restore();
  }

  /** 正 / 背面的后发（长发 / 披肩）：正面时画在身体后面 */
  function drawBackHair(ctx, spec, s, lw) {
    const u = s.u;
    const hx = s.cx;
    const hy = s.headCY;
    const hair = spec.hair.color;
    const ho = outlineOf(hair);
    const style = spec.hair.style;
    // 后发（长发 / 披肩）
    if (style === 'long-braid' || style === 'shoulder') {
      const length = style === 'long-braid' ? s.shoulder + s.w * 0.4 : s.shoulder + s.w * 0.1;
      smooth(
        ctx,
        [
          [hx - u * 0.48, hy - u * 0.1],
          [hx - u * 0.5, length],
          [hx, length + u * 0.06],
          [hx + u * 0.5, length],
          [hx + u * 0.48, hy - u * 0.1],
          [hx, hy - u * 0.62],
        ],
        shade(hair, -0.12),
        ho,
        lw
      );
    }
  }

  function drawHeadFront(ctx, spec, s, lw, back) {
    const u = s.u;
    const hx = s.cx;
    const hy = s.headCY;
    const hair = spec.hair.color;
    const ho = outlineOf(hair);
    const style = spec.hair.style;
    if (back) drawBackHair(ctx, spec, s, lw);
    // 脖子
    poly(
      ctx,
      [
        [hx - s.w * 0.11, s.chin - u * 0.12],
        [hx + s.w * 0.11, s.chin - u * 0.12],
        [hx + s.w * 0.13, s.shoulder + s.w * 0.04],
        [hx - s.w * 0.13, s.shoulder + s.w * 0.04],
      ],
      shade(spec.skin, -0.08),
      outlineOf(spec.skin),
      lw
    );
    // 耳朵
    for (const side of [-1, 1]) {
      ellipse(ctx, hx + side * u * 0.385, hy + u * 0.06, u * 0.07, u * 0.1, spec.skin, outlineOf(spec.skin), lw);
    }
    if (spec.earring) {
      // 人物左耳（正面视图的画面右侧，背面视图的画面左侧）
      const side = back ? -1 : 1;
      line(ctx, [[hx + side * u * 0.39, hy + u * 0.15], [hx + side * u * 0.39, hy + u * 0.24]], '#cfd6de', lw);
      ellipse(ctx, hx + side * u * 0.39, hy + u * 0.29, u * 0.055, u * 0.055, '#e8ecf0', '#8a939e', lw);
      line(ctx, [[hx + side * u * 0.39, hy + u * 0.25], [hx + side * u * 0.39, hy + u * 0.33]], '#6d7884', lw * 0.6);
    }
    // 脸
    ellipse(ctx, hx, hy + u * 0.02, u * 0.39, u * 0.49, back ? shade(spec.skin, -0.06) : spec.skin, outlineOf(spec.skin), lw);
    if (!back) {
      // 五官
      const eyeY = hy + u * 0.1;
      for (const side of [-1, 1]) {
        ellipse(ctx, hx + side * u * 0.155, eyeY, u * 0.045, u * 0.06, '#2a2420');
        ellipse(ctx, hx + side * u * 0.155 + u * 0.015, eyeY - u * 0.02, u * 0.014, u * 0.016, '#ffffff');
        line(
          ctx,
          [
            [hx + side * u * 0.08, eyeY - u * (spec.stern ? 0.1 : 0.13)],
            [hx + side * u * 0.23, eyeY - u * (spec.stern ? 0.14 : 0.11)],
          ],
          shade(hair, -0.2),
          u * 0.03
        );
        if (spec.blush) ellipse(ctx, hx + side * u * 0.21, hy + u * 0.25, u * 0.07, u * 0.035, rgba('#e8877a', 0.35));
      }
      line(ctx, [[hx + u * 0.01, hy + u * 0.17], [hx - u * 0.015, hy + u * 0.25], [hx + u * 0.02, hy + u * 0.26]], shade(spec.skin, -0.3), u * 0.018);
      ctx.beginPath();
      ctx.arc(hx, hy + u * 0.28, u * 0.075, Math.PI * 0.2, Math.PI * 0.8);
      ctx.strokeStyle = shade(spec.skin, -0.45);
      ctx.lineWidth = u * 0.025;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    if (spec.beard) {
      smooth(
        ctx,
        [
          [hx - u * 0.33, hy + u * 0.15],
          [hx - u * 0.2, hy + u * 0.5],
          [hx, hy + u * 0.62],
          [hx + u * 0.2, hy + u * 0.5],
          [hx + u * 0.33, hy + u * 0.15],
          [hx + u * 0.12, hy + u * 0.36],
          [hx - u * 0.12, hy + u * 0.36],
        ],
        back ? null : spec.beard,
        back ? null : outlineOf(spec.beard),
        lw
      );
    }
    // 头发
    if (back) {
      smooth(
        ctx,
        [
          [hx - u * 0.42, hy + u * 0.25],
          [hx - u * 0.44, hy - u * 0.25],
          [hx, hy - u * 0.56],
          [hx + u * 0.44, hy - u * 0.25],
          [hx + u * 0.42, hy + u * 0.25],
          [hx, hy + u * (style === 'gray-short' ? 0.3 : 0.4)],
        ],
        hair,
        ho,
        lw
      );
    } else {
      const fringe = style === 'gray-short' ? -0.2 : -0.1;
      const points = [
        [hx - u * 0.42, hy + u * 0.1],
        [hx - u * 0.45, hy - u * 0.25],
        [hx - u * 0.2, hy - u * 0.56],
        [hx + u * 0.2, hy - u * 0.56],
        [hx + u * 0.45, hy - u * 0.25],
        [hx + u * 0.42, hy + u * 0.1],
        [hx + u * 0.32, hy + u * fringe],
        [hx + u * 0.14, hy + u * (fringe - 0.06)],
        [hx, hy + u * (fringe + 0.02)],
        [hx - u * 0.16, hy + u * (fringe - 0.07)],
        [hx - u * 0.32, hy + u * fringe],
      ];
      smooth(ctx, points, hair, ho, lw);
      if (style === 'shoulder') {
        for (const side of [-1, 1]) {
          smooth(
            ctx,
            [
              [hx + side * u * 0.3, hy - u * 0.25],
              [hx + side * u * 0.47, hy - u * 0.1],
              [hx + side * u * 0.47, hy + u * 0.55],
              [hx + side * u * 0.36, hy + u * 0.45],
              [hx + side * u * 0.34, hy],
            ],
            hair,
            ho,
            lw
          );
        }
      }
    }
    // 高光
    ellipse(ctx, hx - u * 0.15, hy - u * 0.38, u * 0.14, u * 0.04, rgba('#ffffff', 0.18), null, 0, -0.3);
    if (style === 'topknot') {
      ellipse(ctx, hx, s.top - u * 0.02, u * 0.17, u * 0.14, hair, ho, lw);
      line(ctx, [[hx - u * 0.15, s.top + u * 0.08], [hx + u * 0.15, s.top + u * 0.08]], spec.hair.band || '#8a5a3a', u * 0.05);
    }
    if (style === 'spiky') {
      const spikes = [-0.4, -0.22, -0.05, 0.12, 0.3];
      spikes.forEach((x, i) =>
        poly(
          ctx,
          [
            [hx + u * x, hy - u * 0.4],
            [hx + u * (x + 0.09), hy - u * (0.7 + (i % 2) * 0.06)],
            [hx + u * (x + 0.18), hy - u * 0.42],
          ],
          hair,
          ho,
          lw
        )
      );
    }
    if (style === 'long-braid') {
      // 发辫：正面搭在画面左侧肩前，背面垂在背后正中
      const bx = back ? hx : hx - u * 0.38;
      const by = back ? hy + u * 0.4 : hy + u * 0.35;
      for (let i = 0; i < 6; i += 1) {
        ellipse(ctx, bx + (back ? 0 : -u * 0.02 * i), by + i * u * 0.2, u * 0.11, u * 0.13, i % 2 ? hair : shade(hair, 0.08), ho, lw);
      }
      ellipse(ctx, bx + (back ? 0 : -u * 0.12), by + 6 * u * 0.2, u * 0.06, u * 0.06, spec.hair.band || '#c98f5a');
    }
  }

  function drawSwordBack(ctx, spec, s, lw, view) {
    const sheath = spec.sword.sheath;
    const hilt = spec.sword.hilt;
    if (view === 'front') {
      // 正面：剑柄从画面左肩后露出，斜挎的背带
      line(ctx, [[s.cx - s.w * 0.62, s.shoulder - s.w * 0.6], [s.cx - s.w * 0.45, s.shoulder + s.w * 0.1]], hilt, s.w * 0.1);
      line(ctx, [[s.cx - s.w * 0.75, s.shoulder - s.w * 0.42], [s.cx - s.w * 0.4, s.shoulder - s.w * 0.25]], shade(hilt, -0.2), s.w * 0.06);
      return;
    }
    const from = view === 'back' ? [s.cx - s.w * 0.62, s.shoulder - s.w * 0.55] : [s.cx - s.w * 0.25, s.shoulder - s.w * 0.6];
    const to = view === 'back' ? [s.cx + s.w * 0.55, s.hip + s.w * 0.25] : [s.cx - s.w * 0.55, s.hip + s.w * 0.2];
    limb(ctx, [from[0] + (to[0] - from[0]) * 0.18, from[1] + (to[1] - from[1]) * 0.18], to, s.w * 0.09, s.w * 0.08, sheath, outlineOf(sheath), lw);
    line(ctx, [from, [from[0] + (to[0] - from[0]) * 0.18, from[1] + (to[1] - from[1]) * 0.18]], hilt, s.w * 0.08);
    const gx = from[0] + (to[0] - from[0]) * 0.18;
    const gy = from[1] + (to[1] - from[1]) * 0.18;
    line(ctx, [[gx - s.w * 0.14, gy + s.w * 0.06], [gx + s.w * 0.14, gy - s.w * 0.06]], shade(hilt, -0.2), s.w * 0.06);
  }

  function drawBasket(ctx, s, lw, x, y, width, height) {
    const wicker = '#b38a52';
    poly(
      ctx,
      [
        [x - width / 2, y],
        [x + width / 2, y],
        [x + width * 0.42, y + height],
        [x - width * 0.42, y + height],
      ],
      wicker,
      outlineOf(wicker),
      lw
    );
    for (let i = 1; i < 4; i += 1) {
      line(ctx, [[x - width * 0.48, y + (height * i) / 4], [x + width * 0.48, y + (height * i) / 4]], shade(wicker, -0.25), lw * 0.7);
    }
    // 露出的草药
    const leaves = ['#6f9a5a', '#88b06c', '#5d8a4c'];
    for (let i = 0; i < 5; i += 1) {
      ellipse(ctx, x - width * 0.35 + i * width * 0.17, y - s.w * 0.08, s.w * 0.09, s.w * 0.18, leaves[i % 3], shade(leaves[i % 3], -0.35), lw * 0.7, (i - 2) * 0.35);
    }
  }

  /** 侧面（面向画面右侧） */
  function drawSide(ctx, spec, s, lw) {
    const hem = hemFor(spec, s);
    const top = spec.top;
    const u = s.u;
    // 背后的道具
    if (spec.basket) drawBasket(ctx, s, lw, s.cx - s.w * 0.55, s.shoulder - s.w * 0.15, s.w * 0.5, s.w * 1.1);
    if (spec.sword) drawSwordBack(ctx, spec, s, lw, 'side');
    // 后腿 / 前腿
    for (const [offset, darken] of [
      [-0.07, -0.12],
      [0.07, 0],
    ]) {
      const color = shade(spec.pants, darken);
      const x = s.cx + s.w * offset;
      if (spec.shorts) {
        limb(ctx, [x, s.knee], [x, s.ankle], s.w * 0.12, s.w * 0.1, shade(spec.skin, darken), outlineOf(spec.skin), lw);
        limb(ctx, [x, s.hip], [x, s.knee + s.w * 0.02], s.w * 0.24, s.w * 0.2, color, outlineOf(color), lw);
      } else {
        limb(ctx, [x, s.knee], [x + s.w * 0.02, s.ankle], s.w * 0.16, s.w * 0.12, color, outlineOf(color), lw);
        limb(ctx, [x, s.hip], [x, s.knee], s.w * 0.25, s.w * 0.17, color, outlineOf(color), lw);
      }
      if (spec.barefoot) {
        ellipse(ctx, x + s.w * 0.1, s.footY - s.w * 0.06, s.w * 0.17, s.w * 0.07, shade(spec.skin, darken), outlineOf(spec.skin), lw);
      } else {
        const boot = shade(spec.boots, darken);
        smooth(
          ctx,
          [
            [x - s.w * 0.14, s.ankle - s.w * 0.2],
            [x + s.w * 0.12, s.ankle - s.w * 0.2],
            [x + s.w * 0.36, s.footY - s.w * 0.06],
            [x + s.w * 0.32, s.footY + s.w * 0.01],
            [x - s.w * 0.15, s.footY + s.w * 0.01],
          ],
          boot,
          outlineOf(boot),
          lw
        );
      }
    }
    // 上衣
    const flare = top.style === 'robe' || top.style === 'long-coat';
    const back = s.cx - s.w * 0.34;
    const front = s.cx + s.w * 0.34;
    const pts = [
      [s.cx - s.w * 0.08, s.shoulder - s.w * 0.06],
      [back, s.shoulder + s.w * 0.12],
      [back - s.w * 0.03, s.chest + s.w * 0.2],
      [s.cx - s.w * 0.28, s.waist],
      [s.cx - (flare ? s.w * 0.62 : s.w * 0.36), hem.y],
      [s.cx + (flare ? s.w * 0.6 : s.w * 0.36), hem.y],
      [s.cx + s.w * 0.3, s.waist],
      [front + s.w * 0.04, s.chest + s.w * 0.1],
      [front - s.w * 0.04, s.shoulder + s.w * 0.08],
      [s.cx + s.w * 0.1, s.shoulder - s.w * 0.06],
    ];
    poly(ctx, pts, top.color, outlineOf(top.color), lw);
    if (top.style !== 'shirt' && top.style !== 'tunic') {
      line(ctx, [[s.cx + s.w * 0.1, s.shoulder - s.w * 0.04], [s.cx + s.w * 0.3, s.chest + s.w * 0.3]], top.trim, s.w * 0.08);
    }
    if (spec.apron) {
      poly(
        ctx,
        [
          [front - s.w * 0.04, s.chest - s.w * 0.05],
          [front + s.w * 0.05, s.chest - s.w * 0.05],
          [front + s.w * 0.1, s.knee + s.w * 0.1],
          [front - s.w * 0.02, s.knee + s.w * 0.1],
        ],
        spec.apron,
        outlineOf(spec.apron),
        lw
      );
    }
    if (spec.belt) {
      poly(
        ctx,
        [
          [s.cx - s.w * 0.3, s.waist - s.w * 0.09],
          [s.cx + s.w * 0.32, s.waist - s.w * 0.09],
          [s.cx + s.w * 0.33, s.waist + s.w * 0.09],
          [s.cx - s.w * 0.31, s.waist + s.w * 0.09],
        ],
        spec.belt,
        outlineOf(spec.belt),
        lw
      );
    }
    // 手臂（近侧）
    const shoulder = [s.cx, s.shoulder + s.w * 0.2];
    const elbow = [s.cx + s.w * 0.06, s.waist - s.w * 0.05];
    const wrist = [s.cx + s.w * 0.16, s.crotch - s.w * 0.08];
    if (spec.rolledSleeves) {
      limb(ctx, elbow, wrist, s.w * 0.14, s.w * 0.11, spec.skin, outlineOf(spec.skin), lw);
      limb(ctx, shoulder, [elbow[0], elbow[1] + s.w * 0.08], s.w * 0.21, s.w * 0.18, top.color, outlineOf(top.color), lw);
    } else {
      limb(ctx, shoulder, elbow, s.w * 0.2, s.w * 0.16, top.color, outlineOf(top.color), lw);
      limb(ctx, elbow, wrist, s.w * 0.16, s.w * 0.14, top.color, outlineOf(top.color), lw);
    }
    if (spec.bandage) {
      for (let i = 0; i < 3; i += 1) {
        const t = 0.25 + i * 0.22;
        const x = elbow[0] + (wrist[0] - elbow[0]) * t;
        const y = elbow[1] + (wrist[1] - elbow[1]) * t;
        line(ctx, [[x - s.w * 0.15, y - s.w * 0.03], [x + s.w * 0.15, y + s.w * 0.04]], '#efe9dc', s.w * 0.05);
      }
    }
    ellipse(ctx, wrist[0] + s.w * 0.02, wrist[1] + s.w * 0.12, s.w * 0.1, s.w * 0.13, spec.skin, outlineOf(spec.skin), lw);
    if (spec.hammer) drawHammer(ctx, s, wrist[0] + s.w * 0.04, wrist[1] + s.w * 0.12, lw, -0.15);

    // 头部（侧面）
    const hx = s.cx + u * 0.04;
    const hy = s.headCY;
    const hair = spec.hair.color;
    const ho = outlineOf(hair);
    if (spec.hair.style === 'long-braid' || spec.hair.style === 'shoulder') {
      const length = spec.hair.style === 'long-braid' ? s.chest + s.w * 0.3 : s.shoulder + s.w * 0.15;
      smooth(
        ctx,
        [
          [hx - u * 0.1, hy - u * 0.5],
          [hx - u * 0.48, hy - u * 0.1],
          [hx - u * 0.42, length],
          [hx - u * 0.18, length - u * 0.05],
          [hx - u * 0.05, hy + u * 0.2],
        ],
        shade(hair, -0.12),
        ho,
        lw
      );
    }
    poly(
      ctx,
      [
        [hx - s.w * 0.12, s.chin - u * 0.15],
        [hx + s.w * 0.08, s.chin - u * 0.15],
        [hx + s.w * 0.1, s.shoulder + s.w * 0.02],
        [hx - s.w * 0.14, s.shoulder + s.w * 0.02],
      ],
      shade(spec.skin, -0.08),
      outlineOf(spec.skin),
      lw
    );
    smooth(
      ctx,
      [
        [hx - u * 0.36, hy - u * 0.1],
        [hx - u * 0.2, hy - u * 0.5],
        [hx + u * 0.25, hy - u * 0.45],
        [hx + u * 0.38, hy - u * 0.05],
        [hx + u * 0.44, hy + u * 0.12],
        [hx + u * 0.36, hy + u * 0.2],
        [hx + u * 0.3, hy + u * 0.42],
        [hx + u * 0.05, hy + u * 0.52],
        [hx - u * 0.25, hy + u * 0.35],
      ],
      spec.skin,
      outlineOf(spec.skin),
      lw
    );
    ellipse(ctx, hx - u * 0.04, hy + u * 0.06, u * 0.07, u * 0.1, spec.skin, outlineOf(spec.skin), lw);
    ellipse(ctx, hx + u * 0.24, hy + u * 0.08, u * 0.035, u * 0.055, '#2a2420');
    line(ctx, [[hx + u * 0.16, hy - u * 0.04], [hx + u * 0.3, hy - u * 0.05]], shade(hair, -0.2), u * 0.03);
    line(ctx, [[hx + u * 0.3, hy + u * 0.3], [hx + u * 0.37, hy + u * 0.31]], shade(spec.skin, -0.45), u * 0.022);
    if (spec.blush) ellipse(ctx, hx + u * 0.22, hy + u * 0.24, u * 0.06, u * 0.03, rgba('#e8877a', 0.35));
    if (spec.beard) {
      smooth(
        ctx,
        [
          [hx + u * 0.05, hy + u * 0.2],
          [hx + u * 0.36, hy + u * 0.36],
          [hx + u * 0.22, hy + u * 0.62],
          [hx - u * 0.05, hy + u * 0.5],
        ],
        spec.beard,
        outlineOf(spec.beard),
        lw
      );
    }
    if (spec.earring) {
      line(ctx, [[hx - u * 0.04, hy + u * 0.15], [hx - u * 0.04, hy + u * 0.24]], '#cfd6de', lw);
      ellipse(ctx, hx - u * 0.04, hy + u * 0.29, u * 0.055, u * 0.055, '#e8ecf0', '#8a939e', lw);
    }
    const hairPts = [
      [hx - u * 0.42, hy + u * (spec.hair.style === 'gray-short' ? 0.15 : 0.3)],
      [hx - u * 0.46, hy - u * 0.2],
      [hx - u * 0.15, hy - u * 0.58],
      [hx + u * 0.28, hy - u * 0.5],
      [hx + u * 0.42, hy - u * 0.2],
      [hx + u * 0.3, hy - u * 0.12],
      [hx + u * 0.12, hy - u * 0.2],
      [hx - u * 0.02, hy - u * 0.05],
      [hx - u * 0.18, hy + u * 0.12],
    ];
    smooth(ctx, hairPts, hair, ho, lw);
    if (spec.hair.style === 'topknot') {
      ellipse(ctx, hx - u * 0.06, s.top - u * 0.02, u * 0.16, u * 0.14, hair, ho, lw);
      line(ctx, [[hx - u * 0.2, s.top + u * 0.08], [hx + u * 0.08, s.top + u * 0.08]], spec.hair.band || '#8a5a3a', u * 0.05);
    }
    if (spec.hair.style === 'spiky') {
      [-0.38, -0.2, -0.02, 0.16].forEach((x, i) =>
        poly(
          ctx,
          [
            [hx + u * x, hy - u * 0.42],
            [hx + u * (x - 0.05), hy - u * (0.72 + (i % 2) * 0.05)],
            [hx + u * (x + 0.16), hy - u * 0.45],
          ],
          hair,
          ho,
          lw
        )
      );
    }
    if (spec.hair.style === 'long-braid') {
      for (let i = 0; i < 6; i += 1) {
        ellipse(ctx, hx - u * 0.42 - i * u * 0.01, hy + u * 0.3 + i * u * 0.2, u * 0.1, u * 0.12, i % 2 ? hair : shade(hair, 0.08), ho, lw);
      }
    }
  }

  /** 正面 / 背面 */
  function drawFrontOrBack(ctx, spec, s, lw, back) {
    if (!back) {
      if (spec.basket) {
        // 背篓：从肩后露出边缘，背带过肩
        drawBasket(ctx, s, lw, s.cx + s.w * 0.65, s.shoulder - s.w * 0.25, s.w * 0.55, s.w * 0.5);
      }
      if (spec.sword) drawSwordBack(ctx, spec, s, lw, 'front');
    }
    if (!back) drawBackHair(ctx, spec, s, lw);
    drawLegsFront(ctx, spec, s, lw);
    if (back) {
      drawArmsFront(ctx, spec, s, lw);
      drawTorsoFront(ctx, spec, s, lw, true);
    } else {
      drawTorsoFront(ctx, spec, s, lw, false);
      drawArmsFront(ctx, spec, s, lw);
    }
    if (spec.basket && !back) {
      line(ctx, [[s.cx - s.w * 0.45, s.shoulder + s.w * 0.05], [s.cx - s.w * 0.55, s.chest + s.w * 0.5]], '#7a5a3a', s.w * 0.07);
      line(ctx, [[s.cx + s.w * 0.45, s.shoulder + s.w * 0.05], [s.cx + s.w * 0.55, s.chest + s.w * 0.5]], '#7a5a3a', s.w * 0.07);
    }
    if (spec.sword && !back) {
      line(ctx, [[s.cx - s.w * 0.5, s.shoulder + s.w * 0.05], [s.cx + s.w * 0.55, s.waist - s.w * 0.1]], '#5a4632', s.w * 0.07);
    }
    if (spec.hammer) {
      const side = back ? 1 : -1;
      drawHammer(ctx, s, s.cx + side * s.w * 1.06, s.crotch + s.w * 0.04, lw, 0);
    }
    drawHeadFront(ctx, spec, s, lw, back);
    if (back) {
      if (spec.sword) drawSwordBack(ctx, spec, s, lw, 'back');
      if (spec.basket) drawBasket(ctx, s, lw, s.cx, s.shoulder + s.w * 0.05, s.w * 0.9, s.w * 1.2);
    }
  }

  function drawCharacter(ctx, spec, view, cx, footY, H) {
    const s = skeleton(spec, cx, footY, H);
    const lw = Math.max(1, H / 260);
    if (view === 'side') drawSide(ctx, spec, s, lw);
    else drawFrontOrBack(ctx, spec, s, lw, view === 'back');
    return s;
  }

  function groundShadow(ctx, cx, y, width) {
    const gradient = ctx.createRadialGradient(cx, y, 0, cx, y, width);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.save();
    ctx.scale(1, 0.18);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, y / 0.18, width, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─── 背景 ────────────────────────────────────────────────────────────────

  function drawStars(ctx, width, height, count, seed, maxY, twinkle) {
    const random = seeded(seed);
    for (let i = 0; i < count; i += 1) {
      const x = random() * width;
      const y = random() * maxY;
      const r = 0.6 + random() * 1.4;
      const phase = random() * Math.PI * 2;
      const alpha = 0.35 + 0.55 * (twinkle === undefined ? random() : 0.5 + 0.5 * Math.sin(twinkle * 3 + phase));
      ellipse(ctx, x, y, r, r, `rgba(255, 248, 230, ${alpha.toFixed(3)})`);
    }
  }

  function drawMountains(ctx, width, baseY, color, seed, amplitude) {
    const random = seeded(seed);
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    let x = 0;
    while (x <= width + 60) {
      ctx.lineTo(x, baseY - amplitude * (0.35 + random() * 0.65));
      x += 60 + random() * 90;
    }
    ctx.lineTo(width, baseY + 400);
    ctx.lineTo(0, baseY + 400);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function portraitBackground(ctx, width, height, theme) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, theme.top);
    sky.addColorStop(1, theme.bottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    if (theme.stars) drawStars(ctx, width, height, 70, theme.seed, height * 0.55);
    if (theme.mountains) {
      drawMountains(ctx, width, height * 0.62, rgba(theme.mountains, 0.55), theme.seed, 140);
      drawMountains(ctx, width, height * 0.72, rgba(theme.mountains, 0.8), theme.seed + 7, 90);
    }
    if (theme.sparks) {
      const random = seeded(theme.seed);
      for (let i = 0; i < 40; i += 1) {
        const r = 1 + random() * 3;
        ellipse(ctx, random() * width, height * (0.3 + random() * 0.7), r, r, `rgba(255, ${170 + Math.round(random() * 60)}, 90, ${(0.25 + random() * 0.5).toFixed(2)})`);
      }
    }
    // 光晕与暗角
    const glow = ctx.createRadialGradient(width * 0.5, height * 0.35, 10, width * 0.5, height * 0.4, width * 0.8);
    glow.addColorStop(0, rgba(theme.glow, 0.35));
    glow.addColorStop(1, rgba(theme.glow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  function vignette(ctx, width, height, strength) {
    const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.35, width / 2, height / 2, Math.max(width, height) * 0.75);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, `rgba(0, 0, 0, ${strength})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // ─── 对外：形象图 / 三视图 ────────────────────────────────────────────────

  function renderPortrait(canvas, spec) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    portraitBackground(ctx, width, height, spec.theme);
    const H = height * (spec.heads && spec.heads < 5.5 ? 1.25 : 1.62);
    const top = height * 0.1;
    drawCharacter(ctx, spec, 'front', width / 2, top + H, H);
    vignette(ctx, width, height, 0.45);
  }

  function renderTurnaround(canvas, spec) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.fillStyle = '#efe9dd';
    ctx.fillRect(0, 0, width, height);
    // 方格纸
    ctx.strokeStyle = 'rgba(120, 100, 70, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    const footY = height - 92;
    const H = spec.heads && spec.heads < 5.5 ? 380 : 500;
    // 头身比参考线
    const heads = spec.heads || 6.6;
    ctx.strokeStyle = 'rgba(150, 110, 70, 0.25)';
    ctx.setLineDash([6, 6]);
    for (let i = 0; i <= Math.ceil(heads); i += 1) {
      const y = footY - (H / heads) * i;
      ctx.beginPath();
      ctx.moveTo(96, y);
      ctx.lineTo(width - 40, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#3a3128';
    ctx.font = '600 26px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`${spec.name} · 三视图`, 40, 52);
    ctx.font = '15px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#7a6a58';
    ctx.fillText(spec.note || '', 40, 80);
    const columns = [
      ['front', '正面', width * 0.24],
      ['side', '侧面', width * 0.52],
      ['back', '背面', width * 0.8],
    ];
    for (const [view, label, cx] of columns) {
      groundShadow(ctx, cx, footY, 90);
      drawCharacter(ctx, spec, view, cx, footY, H);
      ctx.fillStyle = '#5a4a3a';
      ctx.font = '500 18px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, cx, height - 40);
      ctx.textAlign = 'left';
    }
  }

  // ─── 对外：设定图 ────────────────────────────────────────────────────────

  function drawSea(ctx, width, horizon, height, top, bottom, t) {
    const sea = ctx.createLinearGradient(0, horizon, 0, height);
    sea.addColorStop(0, top);
    sea.addColorStop(1, bottom);
    ctx.fillStyle = sea;
    ctx.fillRect(0, horizon, width, height - horizon);
    const random = seeded(31);
    for (let i = 0; i < 70; i += 1) {
      const y = horizon + 6 + Math.pow(random(), 1.6) * (height - horizon);
      const x = ((random() * width + (t || 0) * (20 + (y - horizon) * 0.2)) % (width + 80)) - 40;
      const len = 10 + (y - horizon) * 0.12;
      line(ctx, [[x, y], [x + len, y]], 'rgba(255, 255, 255, 0.10)', 1.2);
    }
  }

  function drawLighthouse(ctx, x, baseY, scale, beamAngle, glowAlpha) {
    // 礁石
    smooth(
      ctx,
      [
        [x - 120 * scale, baseY + 18 * scale],
        [x - 70 * scale, baseY - 18 * scale],
        [x - 10 * scale, baseY - 26 * scale],
        [x + 60 * scale, baseY - 12 * scale],
        [x + 130 * scale, baseY + 18 * scale],
      ],
      '#1c2230',
      '#11151e',
      2 * scale
    );
    // 塔身
    poly(
      ctx,
      [
        [x - 22 * scale, baseY - 20 * scale],
        [x + 22 * scale, baseY - 20 * scale],
        [x + 14 * scale, baseY - 190 * scale],
        [x - 14 * scale, baseY - 190 * scale],
      ],
      '#d9d4c7',
      '#5d5a55',
      2 * scale
    );
    for (const y of [-70, -130]) {
      poly(
        ctx,
        [
          [x - 20 * scale + (-y / 190) * 7 * scale, baseY + (y - 12) * scale],
          [x + 20 * scale - (-y / 190) * 7 * scale, baseY + (y - 12) * scale],
          [x + 19 * scale - (-y / 190) * 7 * scale, baseY + (y + 12) * scale],
          [x - 19 * scale + (-y / 190) * 7 * scale, baseY + (y + 12) * scale],
        ],
        '#5b6f8a'
      );
    }
    // 灯室
    ctx.fillStyle = '#2b3240';
    ctx.fillRect(x - 20 * scale, baseY - 198 * scale, 40 * scale, 8 * scale);
    const lampY = baseY - 214 * scale;
    ellipse(ctx, x, lampY, 13 * scale, 14 * scale, '#fff4c8');
    poly(
      ctx,
      [
        [x - 16 * scale, baseY - 228 * scale],
        [x + 16 * scale, baseY - 228 * scale],
        [x, baseY - 248 * scale],
      ],
      '#2b3240'
    );
    const glow = ctx.createRadialGradient(x, lampY, 0, x, lampY, 130 * scale);
    glow.addColorStop(0, `rgba(255, 238, 180, ${0.75 * glowAlpha})`);
    glow.addColorStop(1, 'rgba(255, 238, 180, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, lampY, 130 * scale, 0, Math.PI * 2);
    ctx.fill();
    // 光柱
    if (beamAngle !== null) {
      ctx.save();
      ctx.translate(x, lampY);
      ctx.rotate(beamAngle);
      const beam = ctx.createLinearGradient(0, 0, 900 * scale, 0);
      beam.addColorStop(0, `rgba(255, 240, 190, ${0.45 * glowAlpha})`);
      beam.addColorStop(1, 'rgba(255, 240, 190, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(0, -4 * scale);
      ctx.lineTo(900 * scale, -70 * scale);
      ctx.lineTo(900 * scale, 70 * scale);
      ctx.lineTo(0, 4 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function renderLighthouse(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const horizon = height * 0.66;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#0d1428');
    sky.addColorStop(0.6, '#26305a');
    sky.addColorStop(1, '#5a4f7a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);
    drawStars(ctx, width, height, 220, 11, horizon * 0.95);
    // 星河：一条斜向的淡光带
    ctx.save();
    ctx.translate(width * 0.5, horizon * 0.4);
    ctx.rotate(-0.35);
    const band = ctx.createLinearGradient(0, -90, 0, 90);
    band.addColorStop(0, 'rgba(180, 190, 255, 0)');
    band.addColorStop(0.5, 'rgba(200, 205, 255, 0.16)');
    band.addColorStop(1, 'rgba(180, 190, 255, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(-width, -90, width * 2, 180);
    ctx.restore();
    drawStars(ctx, width, height, 120, 12, horizon * 0.7);
    drawSea(ctx, width, horizon, height, '#1f2747', '#080c18', 0);
    drawLighthouse(ctx, width * 0.68, horizon + 40, 1.25, -2.75, 1);
    // 倒影
    const reflection = ctx.createLinearGradient(0, horizon, 0, height);
    reflection.addColorStop(0, 'rgba(255, 238, 180, 0.22)');
    reflection.addColorStop(1, 'rgba(255, 238, 180, 0)');
    ctx.fillStyle = reflection;
    ctx.fillRect(width * 0.68 - 10, horizon + 40, 20, height - horizon);
    vignette(ctx, width, height, 0.5);
  }

  function drawShip(ctx, x, waterY, scale, sail, hullColor) {
    // 船体
    smooth(
      ctx,
      [
        [x - 70 * scale, waterY - 16 * scale],
        [x + 80 * scale, waterY - 18 * scale],
        [x + 58 * scale, waterY + 6 * scale],
        [x - 54 * scale, waterY + 6 * scale],
      ],
      hullColor,
      shade(hullColor, -0.5),
      1.5 * scale
    );
    line(ctx, [[x - 4 * scale, waterY - 16 * scale], [x - 4 * scale, waterY - 120 * scale]], '#3a2e24', 3 * scale);
    line(ctx, [[x + 40 * scale, waterY - 16 * scale], [x + 40 * scale, waterY - 86 * scale]], '#3a2e24', 2.5 * scale);
    smooth(
      ctx,
      [
        [x - 2 * scale, waterY - 114 * scale],
        [x + 34 * scale, waterY - 70 * scale],
        [x - 2 * scale, waterY - 26 * scale],
        [x - 50 * scale, waterY - 30 * scale],
        [x - 46 * scale, waterY - 100 * scale],
      ],
      sail,
      shade(sail, -0.4),
      1.2 * scale
    );
    poly(
      ctx,
      [
        [x + 42 * scale, waterY - 82 * scale],
        [x + 72 * scale, waterY - 30 * scale],
        [x + 42 * scale, waterY - 26 * scale],
      ],
      sail,
      shade(sail, -0.4),
      1.2 * scale
    );
  }

  function drawCity(ctx, width, baseY, dusk) {
    const random = seeded(77);
    // 远山与城墙
    drawMountains(ctx, width, baseY - 40, dusk ? '#4a3b55' : '#3b4a5f', 5, 120);
    let x = -10;
    while (x < width) {
      const w = 34 + random() * 48;
      const h = 40 + random() * 110;
      const roof = random() > 0.55;
      const color = mix('#2a2433', '#43384a', random());
      ctx.fillStyle = color;
      ctx.fillRect(x, baseY - h, w, h);
      if (roof) {
        poly(
          ctx,
          [
            [x - 6, baseY - h],
            [x + w / 2, baseY - h - 22 - random() * 14],
            [x + w + 6, baseY - h],
          ],
          shade(color, -0.25)
        );
      }
      for (let wy = baseY - h + 12; wy < baseY - 10; wy += 18) {
        for (let wx = x + 6; wx < x + w - 8; wx += 14) {
          if (random() > 0.55) {
            ctx.fillStyle = `rgba(255, ${190 + Math.round(random() * 40)}, 120, ${(0.55 + random() * 0.4).toFixed(2)})`;
            ctx.fillRect(wx, wy, 5, 7);
          }
        }
      }
      x += w + 2;
    }
  }

  function renderHarbor(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const horizon = height * 0.64;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#2b2a4a');
    sky.addColorStop(0.55, '#a5607a');
    sky.addColorStop(1, '#f2a66a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);
    ellipse(ctx, width * 0.22, horizon - 30, 46, 46, 'rgba(255, 214, 150, 0.9)');
    drawStars(ctx, width, height, 40, 21, horizon * 0.35);
    drawCity(ctx, width, horizon, true);
    drawSea(ctx, width, horizon, height, '#6b4a62', '#1d1a2c', 0);
    // 码头与桅杆林
    ctx.fillStyle = '#2a1f1c';
    ctx.fillRect(0, horizon + 50, width * 0.62, 16);
    for (let i = 0; i < 9; i += 1) ctx.fillRect(20 + i * 86, horizon + 50, 8, 60);
    const ships = [
      [140, horizon + 70, 0.9, '#e9dcc0'],
      [330, horizon + 82, 1.05, '#d8c7a6'],
      [560, horizon + 74, 0.85, '#efe3c8'],
      [860, horizon + 96, 1.35, '#1b1d24'],
    ];
    for (const [x, y, scale, sail] of ships) drawShip(ctx, x, y, scale, sail, sail === '#1b1d24' ? '#20222a' : '#5a4232');
    drawLighthouse(ctx, width * 0.9, horizon + 4, 0.45, null, 0.7);
    vignette(ctx, width, height, 0.4);
  }

  // ─── 对外：《离港》短片的一帧 ────────────────────────────────────────────

  /** t：0 → 1 */
  function drawDepartureFrame(canvas, t, hero) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const ease = (v) => v * v * (3 - 2 * v);
    const horizon = height * 0.62;
    const pan = -ease(t) * width * 0.08;
    // 天色由黄昏转入夜
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, mix('#3a3460', '#141a33', t));
    sky.addColorStop(0.6, mix('#b9687a', '#3b3560', t));
    sky.addColorStop(1, mix('#f4ac6e', '#7a5a78', t));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.2 + t * 1.2);
    drawStars(ctx, width, height, 90, 41, horizon * 0.8, t * 6);
    ctx.restore();
    ctx.save();
    ctx.translate(pan, 0);
    drawCity(ctx, width * 1.2, horizon, true);
    ctx.restore();
    drawSea(ctx, width, horizon, height, mix('#6b4a62', '#2a2a48', t), '#120f1e', t * 4);
    // 远处灯塔，光柱缓慢扫过
    drawLighthouse(ctx, width * 0.86 + pan * 0.4, horizon + 2, 0.32, -2.6 + Math.sin(t * Math.PI * 1.5) * 0.5, 0.6 + t * 0.4);
    // 码头（随镜头后移）
    ctx.fillStyle = '#231a18';
    ctx.fillRect(pan * 1.6 - 20, horizon + 46, width * 0.42, 12);
    for (let i = 0; i < 5; i += 1) ctx.fillRect(pan * 1.6 + 10 + i * 60, horizon + 46, 6, 50);
    // 黑帆船驶离：从码头旁向右驶出
    const shipX = width * 0.32 + ease(t) * width * 0.42;
    const bob = Math.sin(t * Math.PI * 6) * 2;
    const scale = 0.62 - t * 0.12;
    drawShip(ctx, shipX, horizon + 70 + bob - t * 18, scale, '#1b1d24', '#2a2c34');
    // 船尾的林舟（小剪影）
    if (hero) {
      const figure = { ...hero, theme: undefined };
      drawCharacter(ctx, figure, 'back', shipX - 34 * scale, horizon + 70 + bob - t * 18 - 16 * scale, 54 * scale);
    }
    // 航迹
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(shipX - 60 * scale, horizon + 76 + bob - t * 18);
    ctx.quadraticCurveTo(shipX - 160 * scale, horizon + 86, width * 0.3, horizon + 92);
    ctx.stroke();
    vignette(ctx, width, height, 0.45);
    // 字幕
    const alpha = t < 0.15 ? t / 0.15 : t > 0.8 ? Math.max(0, (1 - t) / 0.2) : 1;
    ctx.fillStyle = `rgba(245, 235, 215, ${(alpha * 0.92).toFixed(3)})`;
    ctx.font = `500 ${Math.round(height * 0.05)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('第一章 离港', width / 2, height * 0.16);
    ctx.font = `${Math.round(height * 0.035)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = `rgba(230, 220, 200, ${(alpha * 0.75).toFixed(3)})`;
    ctx.fillText('星港城 · 黄昏', width / 2, height * 0.9);
    ctx.textAlign = 'left';
  }

  window.SampleArt = {
    renderPortrait,
    renderTurnaround,
    renderLighthouse,
    renderHarbor,
    drawDepartureFrame,
    drawCharacter,
    // 场景视频示例（scene-art.js）复用的绘制工具
    drawMountains,
    groundShadow,
    vignette,
    ellipse,
    seeded,
    mix,
    rgba,
  };
})();
