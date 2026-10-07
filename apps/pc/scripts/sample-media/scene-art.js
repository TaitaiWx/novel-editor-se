/* eslint-disable */
/**
 * 示例场景视频「第一场 清晨的青石镇」的画面（在 Electron 隐藏窗口里运行，依赖 art.js 的 window.SampleArt）：
 * - drawShotFrame：每个镜头的画面（首帧图用 t = 0；成片逐帧绘制 t ∈ [0, 1]）
 * - drawPrevizFrame：3D 预演的「灰模」画面（地面网格 + 灰色人偶），镜头 1 用
 * 只依赖 Canvas 2D，没有随机数（伪随机由固定种子生成），结果确定。
 */
(function () {
  'use strict';
  const A = window.SampleArt;
  const ease = (v) => v * v * (3 - 2 * v);

  /** 雨后清晨的天空与远山、晨雾 */
  function morningSky(ctx, width, height, horizon, t) {
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#9fb4c4');
    sky.addColorStop(0.7, '#d9dfd8');
    sky.addColorStop(1, '#efe6d2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon + 2);
    A.drawMountains(ctx, width, horizon - height * 0.06, A.rgba('#6f8494', 0.55), 31, height * 0.2);
    A.drawMountains(ctx, width, horizon, A.rgba('#4f6474', 0.75), 37, height * 0.12);
    // 晨雾：几条缓慢漂移的雾带
    for (let i = 0; i < 3; i += 1) {
      const y = horizon - height * (0.02 + i * 0.05);
      const fog = ctx.createLinearGradient(0, y - 18, 0, y + 18);
      fog.addColorStop(0, 'rgba(240, 240, 235, 0)');
      fog.addColorStop(0.5, `rgba(240, 240, 235, ${0.42 - i * 0.1})`);
      fog.addColorStop(1, 'rgba(240, 240, 235, 0)');
      ctx.fillStyle = fog;
      ctx.fillRect(-40 + Math.sin(t * 2 + i) * 20, y - 18, width + 80, 36);
    }
  }

  /** 湿润的石板路（透视），带反光 */
  function stoneRoad(ctx, width, height, horizon) {
    ctx.fillStyle = '#6f6a60';
    ctx.fillRect(0, horizon, width, height - horizon);
    ctx.beginPath();
    ctx.moveTo(width * 0.44, horizon);
    ctx.lineTo(width * 0.56, horizon);
    ctx.lineTo(width * 0.95, height);
    ctx.lineTo(width * 0.05, height);
    ctx.closePath();
    ctx.fillStyle = '#8a8478';
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 36, 30, 0.35)';
    ctx.lineWidth = 1;
    for (let row = 1; row < 9; row += 1) {
      const s = row / 9;
      const y = horizon + (height - horizon) * s * s;
      const half = width * (0.06 + 0.39 * s * s);
      ctx.beginPath();
      ctx.moveTo(width / 2 - half, y);
      ctx.lineTo(width / 2 + half, y);
      ctx.stroke();
    }
    const shine = ctx.createLinearGradient(0, horizon, 0, height);
    shine.addColorStop(0, 'rgba(255, 250, 235, 0.25)');
    shine.addColorStop(1, 'rgba(255, 250, 235, 0)');
    ctx.fillStyle = shine;
    ctx.fillRect(width * 0.3, horizon, width * 0.4, height - horizon);
  }

  /** 老槐树（湿漉漉地发亮） */
  function oldTree(ctx, x, baseY, scale) {
    ctx.fillStyle = '#4a3a2c';
    ctx.beginPath();
    ctx.moveTo(x - 10 * scale, baseY);
    ctx.lineTo(x - 5 * scale, baseY - 90 * scale);
    ctx.lineTo(x + 5 * scale, baseY - 90 * scale);
    ctx.lineTo(x + 12 * scale, baseY);
    ctx.fill();
    const random = A.seeded(7);
    for (let i = 0; i < 14; i += 1) {
      const dx = (random() - 0.5) * 120 * scale;
      const dy = -90 * scale - random() * 70 * scale;
      const r = (24 + random() * 22) * scale;
      A.ellipse(ctx, x + dx, baseY + dy, r, r * 0.8, i % 3 === 0 ? '#5f7d4e' : '#4d6a40');
    }
    A.ellipse(ctx, x - 20 * scale, baseY - 150 * scale, 26 * scale, 14 * scale, 'rgba(230, 240, 210, 0.25)');
  }

  /** 青石镇的屋檐与铁匠铺烟囱 */
  function townHouses(ctx, width, baseY, scale) {
    const houses = [
      [0.04, 120, 70],
      [0.2, 100, 60],
      [0.7, 130, 74],
      [0.86, 110, 64],
    ];
    for (const [fx, w, h] of houses) {
      const x = width * fx;
      ctx.fillStyle = '#b9ab95';
      ctx.fillRect(x, baseY - h * scale, w * scale, h * scale);
      ctx.fillStyle = '#3d4450';
      ctx.beginPath();
      ctx.moveTo(x - 10 * scale, baseY - h * scale);
      ctx.lineTo(x + (w * scale) / 2, baseY - (h + 34) * scale);
      ctx.lineTo(x + w * scale + 10 * scale, baseY - h * scale);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#5b4a3a';
      ctx.fillRect(x + w * scale * 0.4, baseY - h * 0.55 * scale, w * scale * 0.2, h * 0.55 * scale);
    }
    // 铁匠铺的烟囱（还没冒烟）
    ctx.fillStyle = '#5a524a';
    ctx.fillRect(width * 0.75, baseY - 128 * scale, 14 * scale, 30 * scale);
  }

  function hero(specs, name) {
    return specs.find((item) => item.name === name);
  }

  /** 镜头画面：n = 镜头号，t ∈ [0, 1] */
  function drawShotFrame(canvas, n, t, specs) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const linzhou = hero(specs, '林舟');
    const stone = hero(specs, '小石头');
    ctx.save();
    if (n === 1) {
      // 远景：镇口，林舟从镇里走出来；镜头缓慢推近
      const zoom = 1 + ease(t) * 0.08;
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-width / 2, -height / 2);
      const horizon = height * 0.5;
      morningSky(ctx, width, height, horizon, t);
      townHouses(ctx, width, horizon + 8, 0.9);
      stoneRoad(ctx, width, height, horizon + 8);
      oldTree(ctx, width * 0.22, height * 0.82, 1.2);
      const footY = height * (0.7 + 0.12 * ease(t));
      const H = height * (0.3 + 0.08 * ease(t));
      A.groundShadow(ctx, width * 0.55, footY, H * 0.25);
      A.drawCharacter(ctx, linzhou, 'front', width * 0.55, footY, H);
    } else if (n === 2) {
      // 中景：小石头从巷子里跑出来（跟拍）
      const horizon = height * 0.45;
      morningSky(ctx, width, height, horizon, t);
      ctx.fillStyle = '#a99c86';
      ctx.fillRect(0, height * 0.12, width * 0.28, horizon);
      ctx.fillRect(width * 0.72, height * 0.1, width * 0.28, horizon);
      stoneRoad(ctx, width, height, horizon);
      const run = ease(t);
      const H = height * 0.62;
      const x = width * (0.28 + run * 0.2);
      const bob = Math.abs(Math.sin(t * Math.PI * 6)) * height * 0.015;
      A.groundShadow(ctx, x, height * 0.95, H * 0.22);
      A.drawCharacter(ctx, stone, 'side', x, height * 0.95 - bob, H);
      A.drawCharacter(ctx, linzhou, 'front', width * 0.82, height * 1.18, height * 1.05);
    } else if (n === 3) {
      // 近景：林舟接过饼，揉小石头的头发
      const horizon = height * 0.4;
      morningSky(ctx, width, height, horizon, t);
      ctx.fillStyle = '#9a8d78';
      ctx.fillRect(0, horizon, width, height - horizon);
      A.drawCharacter(ctx, linzhou, 'front', width * 0.6, height * 2.05, height * 2.1);
      A.drawCharacter(ctx, stone, 'front', width * 0.3, height * 1.55, height * 1.25);
    } else if (n === 4) {
      // 特写：小石头仰着头
      const glow = ctx.createLinearGradient(0, 0, 0, height);
      glow.addColorStop(0, '#e9dcc0');
      glow.addColorStop(1, '#b8a888');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      const zoom = 1 + ease(t) * 0.06;
      ctx.translate(width / 2, height * 0.4);
      ctx.scale(zoom, zoom);
      ctx.translate(-width / 2, -height * 0.4);
      A.drawCharacter(ctx, stone, 'front', width / 2, height * 4.1, height * 4.4);
    } else {
      // 大远景：出镇的山路，林舟回头望着晨雾里的小镇
      const horizon = height * 0.56;
      morningSky(ctx, width, height, horizon, t);
      A.drawMountains(ctx, width, height * 0.7, A.rgba('#5d7062', 0.9), 43, height * 0.12);
      ctx.fillStyle = '#6d7d62';
      ctx.fillRect(0, height * 0.7, width, height * 0.3);
      ctx.strokeStyle = '#b8ae96';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(width * 0.1, height);
      ctx.quadraticCurveTo(width * 0.5, height * 0.78, width * 0.62, height * 0.7);
      ctx.stroke();
      townHouses(ctx, width, height * 0.66, 0.32);
      A.drawCharacter(ctx, linzhou, 'back', width * 0.5, height * 0.84, height * 0.14);
    }
    ctx.restore();
    A.vignette(ctx, width, height, 0.35);
  }

  /** 3D 预演的灰模画面：地面网格 + 灰色人偶（走向镜头，到中段回头看） */
  function drawPrevizFrame(canvas, t) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const horizon = height * 0.42;
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(0, 0, width, horizon);
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(0, horizon, width, height - horizon);
    ctx.strokeStyle = 'rgba(200, 210, 220, 0.18)';
    ctx.lineWidth = 1;
    for (let i = -10; i <= 10; i += 1) {
      ctx.beginPath();
      ctx.moveTo(width / 2 + i * 12, horizon);
      ctx.lineTo(width / 2 + i * 90, height);
      ctx.stroke();
    }
    for (let row = 1; row < 10; row += 1) {
      const s = row / 10;
      const y = horizon + (height - horizon) * s * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    // 人偶：胶囊形的身体与四肢，颜色同预演人物色
    const walk = ease(Math.min(1, t * 1.2));
    const footY = height * (0.66 + 0.18 * walk);
    const H = height * (0.32 + 0.12 * walk);
    const x = width * 0.5;
    const swing = Math.sin(t * Math.PI * 6) * 0.25;
    const look = t > 0.4 && t < 0.8 ? Math.sin(((t - 0.4) / 0.4) * Math.PI) : 0;
    const limb = (x1, y1, x2, y2, w) => {
      ctx.lineCap = 'round';
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    ctx.strokeStyle = '#c9a27a';
    const hip = footY - H * 0.48;
    const shoulder = footY - H * 0.8;
    limb(x - H * 0.05, hip, x - H * 0.05 + swing * H * 0.25, footY, H * 0.09);
    limb(x + H * 0.05, hip, x + H * 0.05 - swing * H * 0.25, footY, H * 0.09);
    limb(x, hip, x, shoulder, H * 0.2);
    limb(x - H * 0.12, shoulder, x - H * 0.14 - swing * H * 0.2, hip + H * 0.05, H * 0.07);
    limb(x + H * 0.12, shoulder, x + H * 0.14 + swing * H * 0.2, hip + H * 0.05, H * 0.07);
    A.ellipse(ctx, x + look * H * 0.04, shoulder - H * 0.11, H * 0.075, H * 0.09, '#d8b892');
    // 视线方向的小三角（回头看时转向左侧）
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.moveTo(x + look * H * 0.12, shoulder - H * 0.11);
    ctx.lineTo(x + look * H * 0.04 - H * 0.02, shoulder - H * 0.13);
    ctx.lineTo(x + look * H * 0.04 - H * 0.02, shoulder - H * 0.09);
    ctx.fill();
    // 取景框与说明
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.strokeRect(width * 0.06, height * 0.08, width * 0.88, height * 0.84);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = `${Math.round(height * 0.04)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText('预演 · 镜头 1 · 远景 · 24mm', width * 0.08, height * 0.14);
  }

  window.SampleScene = { drawShotFrame, drawPrevizFrame };
})();
