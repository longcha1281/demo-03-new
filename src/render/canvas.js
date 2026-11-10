// ============================================================
// canvas.js —— 全部画面绘制（只读 G，绝不修改任何游戏数据）
// 屏幕逻辑坐标 960×540，开头统一放大 CANVAS.SCALE 倍。
// 屏幕就是战场：所有东西直接按屏幕坐标画，没有相机滚动。
// 绘制顺序 = 谁盖在谁上面：背景 → 子弹 → 敌人 → 玩家 → HUD → 提示 → 死亡遮罩
// ============================================================

import {
  CANVAS,
  COLORS,
  BOSS,
  ENEMY,
  TEXT,
  ENCHANT,
  RELIC_DEFS,
  STARFIELD,
  WEAPON,
  LIGHTNING_FX,
  PICKUP,
} from '../config.js';
import { G } from '../core/state.js';

// 画布和 2D 上下文。initCanvas() 时赋上，之后所有绘制都用它。
let canvas = null;
let ctx = null;

// 遗物 HUD 的短名：4 个槽位里的遗物用汉字标出来
const RELIC_SHORT = {
  tripleShot: '散',
  lightningLink: '链',
  hitFission: '裂',
  homing: '追',
  piercing: '穿',
  boomerangCore: '旋',
  elementMix: '混',
  bloodthirst: '嗜',
  lifesteal: '汲',
};

// HUD 统一视觉常量：颜色、间距、边框缺口都由这里控制
const HUD_STYLE = {
  background: 'rgba(5,12,20,0.38)',
  border: '#345362',
  primary: '#D5E1E8',
  secondary: '#728897',
  accent: '#54D7E8',
  boss: '#9876B4',
  gap: 8,
  cut: 8,
  lineWidth: 1,
};

// 右上角两个 Canvas 按钮的点击范围（逻辑坐标）。
// main.js 用同一份数据做命中判定，避免画的位置和点的位置对不上。
export const HUD_BUTTONS = {
  auto: { x: 740, y: 25, w: 150, h: 20 },
  fullscreen: { x: 896, y: 25, w: 54, h: 20 },
};

// 星空：模块加载时随机撒一次，之后每帧只按时间算纵向位置（不修改 G）
const STARS = [];
for (const layer of STARFIELD.LAYERS) {
  for (let i = 0; i < layer.count; i++) {
    STARS.push({
      x: Math.random() * CANVAS.WIDTH,
      y: Math.random() * CANVAS.HEIGHT,
      speed: layer.speed,
      size: layer.size,
      alpha: layer.alpha,
      phase: Math.random() * Math.PI * 2,
      twinkle: Math.random() < 0.4, // 只有一部分星星会闪
    });
  }
}

/**
 * 初始化画布：拿到 <canvas id="game"> 和 2D 上下文。
 * 关掉图像平滑，让放大后的像素保持锐利（像素风）。
 * 同时把画布的物理像素尺寸设成 逻辑尺寸 × SCALE（和 index.html 双保险）。
 */
export function initCanvas() {
  canvas = document.getElementById('game');
  canvas.width = CANVAS.WIDTH * CANVAS.SCALE;
  canvas.height = CANVAS.HEIGHT * CANVAS.SCALE;
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
}

/** 每帧画一帧画面。只读 G，不改任何游戏数据。 */
export function draw() {
  // 每帧重置坐标变换：代码里写 960×540，屏幕上自动放大 1.5 倍
  ctx.setTransform(CANVAS.SCALE, 0, 0, CANVAS.SCALE, 0, 0);

  // 每帧开头显式设好文字对齐，避免上一帧的设置残留到这一帧
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // 先整屏铺一次底色：震屏时世界层会平移，这一步避免边缘露出上一帧的残影
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT);

  // 震屏：只偏移"世界层"，HUD / 提示 / 死亡遮罩永远稳定。
  // 半径是 ±shake×0.5，爆发瞬间抖一下，随后由 systems 衰减到 0。
  const shakeX = G.shake > 0 ? (Math.random() * 2 - 1) * G.shake * 0.5 : 0;
  const shakeY = G.shake > 0 ? (Math.random() * 2 - 1) * G.shake * 0.5 : 0;

  ctx.save();
  ctx.translate(shakeX, shakeY);

  drawBackground();
  drawBursts();    // 地面：爆发扩散环
  drawZones();     // 地面：黑洞
  drawBossHazards(); // 地面：首领火焰节点 / 冰环 / 激光
  drawPickups();   // 地面：血包（在敌人和子弹下面）
  drawSparks();    // 子弹拖尾在子弹下面，先画粒子再画子弹
  drawShots();
  drawHostile();   // 敌方子弹夹在玩家子弹和敌人之间，不会盖住敌人
  drawEnemies();
  drawBossGhosts(); // 首领瞬移残影，盖在实body上但很快淡出
  drawLightningArcs(); // 闪电链在敌人之上、锁定框之下
  drawLockOn();    // 锁定框画在敌人之后、玩家之前，不挡玩家本体
  drawPlayer();
  drawCombatTexts(); // 跳字在玩家之后、HUD 之前

  ctx.restore();

  drawHud();
  drawBossBar();   // 首领血条放 HUD 之后，保证文字在最上层
  drawNotice();

  // 死亡时最后盖上遮罩，保证它在所有东西上面
  if (G.state === 'dead') {
    drawDeadOverlay();
  }
}

/** 背景：纯黑底 + 三层视差星空 + 24px 整屏网格 + 屏幕边框。 */
function drawBackground() {
  // 底色铺满整个逻辑画布
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT);

  // 星空画在网格之前，网格线条仍能压在星星上面
  drawStars();

  // 网格线。坐标 +0.5 是为了让 1px 的线压在像素中心，不会发虚
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0.5; x < CANVAS.WIDTH; x += CANVAS.GRID) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS.HEIGHT);
  }
  for (let y = 0.5; y < CANVAS.HEIGHT; y += CANVAS.GRID) {
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS.WIDTH, y);
  }
  ctx.stroke();

  // 屏幕边框
  ctx.strokeStyle = COLORS.border;
  ctx.strokeRect(0.5, 0.5, CANVAS.WIDTH - 1, CANVAS.HEIGHT - 1);
}

/**
 * 三层视差星空：不同层速度不同，越快的层越亮越大。
 * 位置由 G.time 直接算出来（不往 G 里存星星），出界后从另一侧回绕。
 */
function drawStars() {
  for (const star of STARS) {
    let y = (star.y - G.time * star.speed) % CANVAS.HEIGHT;
    if (y < 0) y += CANVAS.HEIGHT;

    // 闪烁：正弦在 0.55~1 之间摆动，只有 twinkle 为真的星星参与
    let alpha = star.alpha;
    if (star.twinkle) {
      alpha *= 0.78 + 0.22 * Math.sin(G.time * STARFIELD.TWINKLE_RATE + star.phase);
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#cfe8ff';
    ctx.fillRect(star.x, y, star.size, star.size);
  }
  ctx.globalAlpha = 1;
}

/**
 * 元素爆发：三层叠加 —— 中心白光 → 扩散粗环 → 8 个几何碎片。
 * 碎片形状按爆发类型区分：火=光点、冰=射线、暗=旋转方块。
 */
function drawBursts() {
  for (const b of G.bursts) {
    const progress = Math.max(0, Math.min(1, 1 - b.life / b.maxLife)); // 0 → 1
    const fade = Math.max(0, b.life / b.maxLife); // 整体余量 1 → 0

    // 暗属性：单独走向内坍缩动画，火/冰继续用原来的扩散样式
    if (b.kind === 'dark') {
      drawDarkBurst(b, progress, fade);
      continue;
    }

    ctx.save();

    // a) 前 35%：中心一圈实心白光，迅速收缩淡出
    if (progress <= 0.35) {
      ctx.globalAlpha = 0.9 * (1 - progress / 0.35);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(
        b.x,
        b.y,
        b.maxR * 0.25 * (0.6 + 0.4 * progress),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // b) 扩散粗圆环：线宽 5 → 1，整体渐隐
    ctx.globalAlpha = fade;
    ctx.strokeStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 5 - 4 * progress;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.maxR * (0.15 + 0.85 * progress), 0, Math.PI * 2);
    ctx.stroke();

    // b2) 边缘再叠 3 圈更细的高亮描边：让爆发边界一眼看清
    for (let ring = 1; ring <= 3; ring++) {
      ctx.globalAlpha = fade * (0.5 - ring * 0.11);
      ctx.lineWidth = 3 - ring * 0.6;
      ctx.beginPath();
      ctx.arc(
        b.x,
        b.y,
        b.maxR * (0.15 + 0.85 * progress) - ring * 2,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    // c) 8 个碎片：角度均匀、再逐个错开一点，避免看起来像死板的钟表
    ctx.shadowBlur = 8;
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + i * 0.7;
      const dist = b.maxR * progress;
      const x = b.x + Math.cos(angle) * dist;
      const y = b.y + Math.sin(angle) * dist;

      ctx.globalAlpha = fade;
      ctx.fillStyle = b.color;
      ctx.strokeStyle = b.color;

      if (b.kind === 'ice') {
        // 冰：沿飞散方向画一段短线，像冰棱
        const len = 6 * (1 - progress) + 2;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(angle) * len * 0.5, y - Math.sin(angle) * len * 0.5);
        ctx.lineTo(x + Math.cos(angle) * len * 0.5, y + Math.sin(angle) * len * 0.5);
        ctx.stroke();
      } else if (b.kind === 'dark') {
        // 暗：小方块，随进度旋转、缩小
        const size = 4 * (1 - progress) + 1.5;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(progress * Math.PI * 2 + angle);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        // 火：发光小圆点
        ctx.beginPath();
        ctx.arc(x, y, 2 * (1 - progress) + 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 👇 插入四芒星爆发核心 👇
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // 滤色模式，让光更亮
    if (progress <= 0.6) {
      const starProgress = progress / 0.6;
      const rayLength = b.maxR * 1.5 * Math.sin(starProgress * Math.PI);
      const coreSize = b.maxR * 0.2 * (1 - starProgress);

      // 中心白核
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - coreSize);
      ctx.lineTo(b.x + coreSize, b.y);
      ctx.lineTo(b.x, b.y + coreSize);
      ctx.lineTo(b.x - coreSize, b.y);
      ctx.closePath();
      ctx.fill();

      // 十字长光芒
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2 * (1 - starProgress);
      ctx.shadowBlur = 15;
      if (rayLength > 0) {
        ctx.beginPath();
        ctx.moveTo(b.x - rayLength, b.y); ctx.lineTo(b.x + rayLength, b.y);
        ctx.moveTo(b.x, b.y - rayLength); ctx.lineTo(b.x, b.y + rayLength);
        ctx.stroke();

        // 对角副光芒
        const diagLength = rayLength * 0.4;
        ctx.lineWidth = 1 * (1 - starProgress);
        ctx.beginPath();
        ctx.moveTo(b.x - diagLength, b.y - diagLength); ctx.lineTo(b.x + diagLength, b.y + diagLength);
        ctx.moveTo(b.x - diagLength, b.y + diagLength); ctx.lineTo(b.x + diagLength, b.y - diagLength);
        ctx.stroke();
      }
    }
    ctx.restore();
    // 👆 插入结束 👆

    ctx.restore();
  }
}

/**
 * 暗属性爆发：紫白闪核 + 双层向内收缩圆环 + 8 个旋转吸入的菱形碎片。
 * 和火/冰的“向外扩散”刻意相反，表现黑洞坍缩。
 * @param {object} b 爆发对象
 * @param {number} progress 0 → 1
 * @param {number} fade 剩余寿命 1 → 0
 */
function drawDarkBurst(b, progress, fade) {
  const r = b.maxR;

  ctx.save();
  ctx.translate(b.x, b.y);

  // 短暂紫白闪核
  if (progress < 0.25) {
    const k = 1 - progress / 0.25;

    ctx.globalAlpha = fade * k;
    ctx.fillStyle = '#C5B4E0';
    ctx.shadowColor = '#705B96';
    ctx.shadowBlur = 12;

    const s = r * 0.18 * k;

    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.45, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s * 0.45, 0);
    ctx.closePath();
    ctx.fill();
  }

  ctx.shadowBlur = 0;

  // 双层向内收缩的能量环
  for (let i = 0; i < 2; i++) {
    ctx.globalAlpha = fade * (i === 0 ? 0.85 : 0.3);
    ctx.strokeStyle = '#806AA6';
    ctx.lineWidth = i === 0 ? 1 + 2 * (1 - progress) : 1;

    ctx.beginPath();
    ctx.arc(
      0, 0,
      Math.max(0, r * (
        i === 0
          ? 0.95 - progress * 0.65
          : 1.1 - progress * 0.75
      )),
      0, Math.PI * 2
    );
    ctx.stroke();
  }

  // 八个向中心旋转吸入的菱形碎片
  ctx.fillStyle = '#9280B8';
  ctx.globalAlpha = fade;

  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4 + progress * 1.5;
    const dist = r * (0.9 - progress * 0.75);
    const size = 1 + 3 * (1 - progress);

    ctx.save();
    ctx.translate(
      Math.cos(angle) * dist,
      Math.sin(angle) * dist
    );
    ctx.rotate(angle + Math.PI / 4);
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }

  ctx.restore();
}

// ==========================================
// V9.1 黑洞：七层流动能量环
// ==========================================

// 七层能量环配置
const DARK_RINGS = [
  { r: 46, start: -2.4, span: 4.7, rot: 0.18, speed: 0.16, phase: 0.15, main: false },
  { r: 58, start: 0.8, span: 3.8, rot: -0.12, speed: 0.13, phase: 0.50, main: false },
  { r: 72, start: -1.6, span: 5.0, rot: 0.14, speed: 0.12, phase: 0.75, main: true },
  { r: 86, start: 2.1, span: 4.3, rot: -0.09, speed: 0.10, phase: 0.30, main: false },
  { r: 100, start: -0.9, span: 4.8, rot: 0.10, speed: 0.11, phase: 0.65, main: true },
  { r: 114, start: 1.5, span: 3.6, rot: -0.07, speed: 0.09, phase: 0.20, main: false },
  { r: 128, start: -2.0, span: 4.5, rot: 0.06, speed: 0.08, phase: 0.85, main: true }
];

// 绘制具有动态粗细与亮度变化的能量弧线
function drawEnergyArc(ring, time, alpha) {
  const steps = 140;

  // 三层主环更粗、更亮，四层辅助环保持纤细
  const isMain = ring.main;

  const phase = (time * ring.speed + ring.phase) % 1;

  ctx.lineCap = 'round';

  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const t = (t0 + t1) * 0.5;

    // 弧线两端渐细
    const taper = Math.pow(
      Math.sin(Math.PI * t),
      0.85
    );

    // 移动的能量高光
    const distance = Math.abs(t - phase);

    // 主环高光更宽，形成月牙状能量带
    const energy = Math.exp(
      -Math.pow(distance / (isMain ? 0.17 : 0.10), 2)
    );

    // 主环更粗，高光峰值更高
    const baseWidth = isMain ? 1.4 : 0.65;
    const peakWidth = isMain ? 5.8 : 1.5;

    const width = Math.max(
      0.05,
      taper * (
        baseWidth +
        energy * (peakWidth - baseWidth)
      )
    );

    // 暗紫到灰紫的颜色过渡
    const brightness = isMain
      ? 0.32 + energy * 0.68
      : 0.22 + energy * 0.45;

    const red = Math.round(48 + 128 * brightness);
    const green = Math.round(38 + 117 * brightness);
    const blue = Math.round(61 + 130 * brightness);

    ctx.strokeStyle =
      `rgb(${red},${green},${blue})`;

    ctx.globalAlpha = alpha * taper * (
      isMain
        ? 0.60 + energy * 0.35
        : 0.35 + energy * 0.30
    );

    ctx.lineWidth = width;

    // 每层弧线独立旋转
    const rotation = time * ring.rot;

    const a0 = ring.start + ring.span * t0 + rotation;
    const a1 = ring.start + ring.span * t1 + rotation;

    ctx.beginPath();

    ctx.moveTo(
      Math.cos(a0) * ring.r,
      Math.sin(a0) * ring.r
    );

    ctx.lineTo(
      Math.cos(a1) * ring.r,
      Math.sin(a1) * ring.r
    );

    ctx.stroke();
  }
}

// =====================================
// 绘制黑洞
// =====================================

function drawZones() {
  for (const z of G.zones) {
    const alpha = Math.max(
      0,
      Math.min(1, z.life / 0.5)
    );

    if (alpha <= 0) continue;

    ctx.save();

    ctx.translate(z.x, z.y);

    // 视觉尺寸
    const SIZE = 0.55;

    const scale =
      (z.r / 100) * SIZE;

    ctx.scale(scale, scale);

    // =================================
    // 中心黑洞
    // =================================

    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#05040A';

    ctx.beginPath();

    ctx.arc(
      0,
      0,
      28,
      0,
      Math.PI * 2
    );

    ctx.fill();

    // =================================
    // 七层流动能量环
    // =================================

    for (const ring of DARK_RINGS) {
      drawEnergyArc(ring, G.time, alpha);
    }

    ctx.restore();
  }
}

/**
 * 血包：绿色菱形外框 + 十字，随时间轻微呼吸；快消失时整体变淡。
 * 真正的回血在 systems.js 的 updatePickups 里。
 */
function drawPickups() {
  const color = '#5ef2a0';
  for (const q of G.pickups) {
    const pulse = 0.9 + 0.1 * Math.sin(G.time * 6 + q.x);
    const fade = Math.min(1, q.life / 1.2);
    const r = 7 * pulse;
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.globalAlpha = fade;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(-1, -r * 0.55, 2, r * 1.1);
    ctx.fillRect(-r * 0.55, -1, r * 1.1, 2);
    ctx.restore();
  }
}

/**
 * 子弹拖尾粒子：两层小圆模拟发光（不用 shadowBlur，320 个粒子也不卡）。
 * 外圈淡、内圈实，半径随剩余寿命缩小。
 */
function drawSparks() {
  for (const sp of G.sparks) {
    const t = Math.max(0, Math.min(1, sp.life / sp.maxLife));
    const radius = sp.size * (0.4 + 0.6 * t);
    const color = sp.color || COLORS.shot;

    ctx.globalAlpha = t * 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, radius * 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = t;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** 子弹：发光小方块，6×6 居中；颜色跟着当前星核走。 */
function drawShots() {
  ctx.save();
  ctx.shadowBlur = 10; // 发光的关键：模糊半径
  for (const s of G.shots) {
    const color = s.color || COLORS.shot;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    // 以 (s.x, s.y) 为中心画 6×6 方块
    ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
  }
  ctx.restore();
}

/**
 * 敌方子弹：统一亮红色发光小圆；追踪球更大，并且额外套一层淡环。
 * 不再按子弹自带颜色区分，避免boss紫色弹和暗蚀弹混在一起。
 */
/**
 * 首领危险区：火焰节点、收缩冰环、激光。
 * 激光在预警阶段画虚线，激活阶段画粗实线，一眼能分清"该躲"和"正在伤人"。
 */
function drawBossHazards() {
  if (G.bossHazards.length === 0) return;

  for (const h of G.bossHazards) {
    ctx.save();

    if (h.kind === 'flame') {
      // 火焰节点：橙红脉动圆，寿命越短越暗
      const alpha = Math.max(0, h.age < h.life ? 1 - h.age / h.life : 0);
      const pulse = 1 + Math.sin(G.time * 18) * 0.12;

      ctx.globalAlpha = 0.25 + alpha * 0.6;
      ctx.shadowColor = COLORS.fire;
      ctx.shadowBlur = 14;
      ctx.fillStyle = COLORS.fire;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ffe0a8';
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else if (h.kind === 'iceRing') {
      // 冰环：从 600 收缩到 0，留一个明显缺口
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = COLORS.ice;
      ctx.shadowColor = COLORS.ice;
      ctx.shadowBlur = 16;
      ctx.lineWidth = h.width;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(
        h.x,
        h.y,
        h.radius,
        h.gapStart + h.gapSize,
        h.gapStart + Math.PI * 2
      );
      ctx.stroke();

      // 环内侧再描一条细白线，缺口边缘更清楚
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#eafdff';
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        h.x,
        h.y,
        Math.max(0, h.radius - h.width / 2),
        h.gapStart + h.gapSize,
        h.gapStart + Math.PI * 2
      );
      ctx.stroke();
    } else if (h.kind === 'thunder') {
      const warning = h.age < h.warn;

      if (warning) {
        // 预警：玩家脚下的红圈，越接近落雷闪得越快
        ctx.globalAlpha = 0.45 + Math.sin(G.time * 30) * 0.25;
        ctx.strokeStyle = COLORS.hostile;
        ctx.shadowColor = COLORS.hostile;
        ctx.shadowBlur = 12;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // 落雷：红白闪光圆 + 中心十字，表示这一瞬间会伤人
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(255, 51, 51, 0.35)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fff1f1';
        ctx.shadowColor = COLORS.hostile;
        ctx.shadowBlur = 22;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.moveTo(h.x - h.r * 0.6, h.y);
        ctx.lineTo(h.x + h.r * 0.6, h.y);
        ctx.moveTo(h.x, h.y - h.r * 0.6);
        ctx.lineTo(h.x, h.y + h.r * 0.6);
        ctx.stroke();
      }
    } else if (h.kind === 'laser') {
      const warning = h.age < h.warn;
      const cos = Math.cos(h.angle);
      const sin = Math.sin(h.angle);
      const ex = h.x + cos * h.length;
      const ey = h.y + sin * h.length;

      if (warning) {
        // 预警：细虚线 + 呼吸闪烁，给玩家 1 秒反应时间
        ctx.globalAlpha = 0.3 + Math.sin(G.time * 22) * 0.15;
        ctx.strokeStyle = h.tint;
        ctx.shadowColor = h.tint;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2;
        ctx.setLineDash([12, 8]);
      } else {
        // 激活：粗实线，碰到就扣 20
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = h.tint;
        ctx.shadowColor = h.tint;
        ctx.shadowBlur = 18;
        ctx.lineWidth = h.width;
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // 激活时中心再压一条白芯，视觉上更"烫"
      if (!warning) {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

/** 首领瞬移残影：半透明紫色六边形，0.4 秒内淡出。 */
function drawBossGhosts() {
  if (G.bossGhosts.length === 0) return;

  for (const g of G.bossGhosts) {
    const alpha = Math.max(0, g.life / g.maxLife) * 0.4;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = g.color || COLORS.boss;
    ctx.shadowColor = g.color || COLORS.boss;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const x = g.x + Math.cos(angle) * g.r;
      const y = g.y + Math.sin(angle) * g.r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * 敌方子弹：红点 + 发光；追踪弹外面再加一圈淡环。
 */
function drawHostile() {
  ctx.save();
  ctx.shadowBlur = 10;

  for (const h of G.hostile) {
    // 所有敌弹统一用亮红，Boss 和暗蚀弹幕不再互相混淆
    const color = COLORS.hostile;
    const radius = h.r || 3;

    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(h.x, h.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 追踪球：外面再画一圈淡环，和普通敌弹区分
    if (h.homing) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(h.x, h.y, radius + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}

/** 敌人：按类型分开画 —— 普通/精英是三角，首领是六边形 + 光环；再叠元素状态圈。 */
function drawEnemies() {
  const p = G.p;

  for (const e of G.enemies) {
    if (e.type === 'boss') {
      drawBoss(e);
    } else if (e.type === 'bomber') {
      drawBomber(e);
    } else if (e.type === 'splitter') {
      drawSplitter(e);
    } else {
      drawEnemyTriangle(e, p);
    }

    // 精英光环 / 护盾在身体下面先铺一层
    if (e.type === 'elite') drawEliteMarks(e);

    // 元素状态外圈：冻结 > 灼烧 > 冰缓 > 侵蚀
    drawEnemyStatus(e);
  }
}

/**
 * 闪电链：只画 systems.triggerLightning 记下的折线。
 * 青白色、短促淡出；数组为空时什么都不做。
 */
function drawLightningArcs() {
  if (G.lightningArcs.length === 0) return;

  // 闪电颜色跟着当前星核走；没选核心时用默认青白
  const core = G.p.core;
  const color = LIGHTNING_FX.COLORS[core] || LIGHTNING_FX.COLORS.default;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;

  for (const arc of G.lightningArcs) {
    if (arc.points.length < 2) continue;

    // alpha 跟着剩余寿命一起淡出
    ctx.globalAlpha = Math.max(0, arc.life / arc.maxLife);

    ctx.beginPath();
    ctx.moveTo(arc.points[0].x, arc.points[0].y);
    for (let i = 1; i < arc.points.length; i++) {
      ctx.lineTo(arc.points[i].x, arc.points[i].y);
    }
    ctx.stroke();

    // 折线两端的小圆点，让"链到谁"更清楚
    for (const pt of [arc.points[0], arc.points[arc.points.length - 1]]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * 中键锁定框：青色全息雷达框，只画给"锁定且还活着"的那只敌人。
 * 纯装饰，不影响碰撞或伤害判定。
 */
function drawLockOn() {
  const p = G.p;
  if (p.attackTarget == null) return;

  const target = G.enemies.find((e) => e.id === p.attackTarget && e.hp > 0);
  if (!target) return;

  const R = target.r + 16;
  const color = '#39f6ff';

  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  // 四角 L 形括号：沿对角线找角点，再各伸出 8px 的横/竖臂
  const arm = 8;
  const diag = R * 0.70710678;
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  ctx.lineWidth = 1.6;
  for (const [sx, sy] of corners) {
    const cx = target.x + sx * diag;
    const cy = target.y + sy * diag;
    ctx.beginPath();
    // 括号开口朝里：竖臂朝中心方向，横臂也朝中心方向
    ctx.moveTo(cx, cy - sy * arm);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - sx * arm, cy);
    ctx.stroke();
  }

  // 外圈旋转虚线圆
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 7]);
  ctx.lineDashOffset = -G.time * 30;
  ctx.beginPath();
  ctx.arc(target.x, target.y, R + 5, 0, Math.PI * 2);
  ctx.stroke();

  // 中心十字准星：横竖各两段，中间留 2px 空隙
  ctx.setLineDash([]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(target.x - R * 0.5, target.y);
  ctx.lineTo(target.x - 2, target.y);
  ctx.moveTo(target.x + 2, target.y);
  ctx.lineTo(target.x + R * 0.5, target.y);
  ctx.moveTo(target.x, target.y - R * 0.5);
  ctx.lineTo(target.x, target.y - 2);
  ctx.moveTo(target.x, target.y + 2);
  ctx.lineTo(target.x, target.y + R * 0.5);
  ctx.stroke();

  // 4 个 45° 小刻度
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    const r1 = R * 0.78;
    const r2 = R * 0.88;
    ctx.moveTo(
      target.x + Math.cos(angle) * r1,
      target.y + Math.sin(angle) * r1
    );
    ctx.lineTo(
      target.x + Math.cos(angle) * r2,
      target.y + Math.sin(angle) * r2
    );
  }
  ctx.stroke();

  // 右上角 "LOCK"：透明度做正弦脉动
  ctx.globalAlpha = 0.7 + Math.sin(G.time * 6) * 0.2;
  ctx.fillStyle = color;
  ctx.font = '7px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('LOCK', target.x + diag + 8, target.y - diag - 8);

  ctx.setLineDash([]);
  ctx.restore();
}

/** 普通 / 精英敌人：三角，尖端指向玩家。 */
function drawEnemyTriangle(e, p) {
  // 精英橙色、射手黄色、普通怪红色：一眼分清谁会后撤、谁会远程
  const color =
    e.type === 'elite'
      ? COLORS.elite
      : e.type === 'shooter'
        ? COLORS.hostile
        : COLORS.enemy;

  // 每只敌人单独 save：translate/rotate 只影响这一只
  ctx.save();
  ctx.translate(e.x, e.y);
  // 让三角的 +x 方向对准玩家
  ctx.rotate(Math.atan2(p.y - e.y, p.x - e.x));

  // 三角形轮廓：尖端往前，底部往后张开
  ctx.beginPath();
  ctx.moveTo(e.r, 0);                  // 尖端
  ctx.lineTo(-e.r * 0.8, e.r * 0.75);  // 左下
  ctx.lineTo(-e.r * 0.8, -e.r * 0.75); // 右上
  ctx.closePath();

  // 半透明填充：只铺一层淡淡的颜色，别盖住网格
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;

  // 亮边描线 + 发光
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 射手：三角形正中心点一颗实心黄点，和其他红三角区分开
  if (e.type === 'shooter') {
    ctx.fillStyle = '#ffe66b';
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** 自爆蛛：红色脉动刺球，越接近爆炸闪得越快。 */
function drawBomber(e) {
  const fusing = e.fuseTimer > 0;                                  // 引信是否已点燃
  const progress = fusing ? 1 - e.fuseTimer / ENEMY.BOMBER.FUSE : 0; // 0 → 1，越接近 1 越危险
  const flash = fusing && Math.floor(e.fuseTimer * 30) % 2 === 0;   // 约 15 次/秒红白交替
  const pulse = 0.75 + Math.sin(G.time * 14 + e.id) * 0.25;
  const bodyR = e.r * (1 + progress * 0.55);                        // 引信期间身体膨胀
  const bodyColor = flash ? '#ffffff' : COLORS.hostile;
  const spikes = 10;

  ctx.save();
  ctx.strokeStyle = bodyColor;
  ctx.shadowColor = bodyColor;
  ctx.shadowBlur = fusing ? 18 : 12;
  ctx.lineWidth = fusing ? 2 : 1.5;

  // 外圈尖刺：每个尖刺长 e.r×0.5，靠脉动缩放
  ctx.beginPath();
  for (let i = 0; i < spikes; i++) {
    const angle = (Math.PI * 2 * i) / spikes;
    const inner = bodyR * 0.75;
    const outer = bodyR * (1.05 + pulse * 0.35);
    ctx.moveTo(e.x + Math.cos(angle) * inner, e.y + Math.sin(angle) * inner);
    ctx.lineTo(e.x + Math.cos(angle) * outer, e.y + Math.sin(angle) * outer);
  }
  ctx.stroke();

  // 身体：半透明红球 + 中心亮核；引信期间整体变白闪烁
  ctx.globalAlpha = fusing ? 0.55 + pulse * 0.35 : 0.3 + pulse * 0.25;
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.arc(e.x, e.y, bodyR, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.9;
  ctx.fillStyle = flash ? '#ff4d4d' : '#ffe1e1';
  ctx.beginPath();
  ctx.arc(e.x, e.y, bodyR * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 分裂体：两个绿色圆交叠，死亡后裂成两只小追猎。 */
function drawSplitter(e) {
  ctx.save();
  ctx.strokeStyle = '#5ef2a0';
  ctx.fillStyle = 'rgba(94, 242, 160, 0.18)';
  ctx.shadowColor = '#5ef2a0';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 1.5;

  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(e.x + sx * e.r * 0.42, e.y, e.r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** 精英附加视觉：辅助型光圈、护盾紫圈。 */
function drawEliteMarks(e) {
  ctx.save();

  // 辅助型：200px 虚线光环，说明这里面的小怪更快
  if (e.eliteModel === 'support') {
    ctx.globalAlpha = 0.25 + Math.sin(G.time * 3) * 0.08;
    ctx.strokeStyle = COLORS.elite;
    ctx.shadowColor = COLORS.elite;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, ENEMY.ELITE.AURA_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 词缀护盾：紫色实线圆，盾越薄越淡
  if (e.eliteShield > 0) {
    const ratio = e.eliteShield / (e.eliteShieldMax || 1);
    ctx.globalAlpha = 0.55 + ratio * 0.4;
    ctx.strokeStyle = COLORS.boss;
    ctx.shadowColor = COLORS.boss;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/** 按优先级取敌人当前元素状态的颜色：冻结→冰蓝、灼烧→橙、冰缓→蓝、侵蚀→紫。 */
function enemyStatusColor(e) {
  if (e.freezeTimer > 0) return COLORS.ice;
  if (e.fireStacks > 0 && e.fireTimer > 0) return COLORS.fire;
  if (e.chillTimer > 0) return COLORS.ice;
  if (e.darkStacks > 0 && e.darkTimer > 0) return COLORS.dark;
  return null;
}

/** 敌人身上是否带着某个元素的 Debuff。 */
function enemyHasElement(e, id) {
  if (id === 'fire') return e.fireStacks > 0 && e.fireTimer > 0;
  if (id === 'ice') return e.freezeTimer > 0 || e.chillTimer > 0;
  if (id === 'dark') return e.darkStacks > 0 && e.darkTimer > 0;
  return false;
}

/** 按元素 id 取颜色；找不到就退回默认白色。 */
function elementColor(id) {
  const core = ENCHANT.CORES.find((item) => item.id === id);
  return core ? core.color : '#ffffff';
}

/** 画一圈元素状态光晕。 */
function drawStatusRing(e, color, radius, width, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 画半圈元素状态光晕（左右各半，拼成双色环）。 */
function drawStatusHalf(e, color, radius, width, alpha, start, end) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(e.x, e.y, radius, start, end);
  ctx.stroke();
  ctx.restore();
}

/**
 * 元素状态外圈：单元素时画一圈；主、副两种 Debuff 同时存在时画左右双色半环
 * （左主右副），让玩家一眼看出两种状态都在生效。
 */
function drawEnemyStatus(e) {
  const p = G.p;
  const primaryId = p.enchantState.primaryId || p.core;
  const secondaryId = p.enchantState.secondaryUnlocked
    ? p.enchantState.secondaryId
    : null;

  const hasPrimary = primaryId ? enemyHasElement(e, primaryId) : false;
  const hasSecondary =
    secondaryId && secondaryId !== primaryId
      ? enemyHasElement(e, secondaryId)
      : false;

  if (hasPrimary && hasSecondary) {
    // 左半圈主元素、右半圈副元素：一眼看出两种 Debuff 同时挂着
    drawStatusHalf(e, elementColor(primaryId), e.r + 4, 2, 0.85,
      Math.PI / 2, Math.PI * 1.5);
    drawStatusHalf(e, elementColor(secondaryId), e.r + 4, 2, 0.85,
      -Math.PI / 2, Math.PI / 2);
    return;
  }

  // 只有一种状态：沿用原来的优先级着色（冻结优先等）
  const color = enemyStatusColor(e);
  if (!color) return;
  drawStatusRing(e, color, e.r + 4, 2, 0.8);
}

/**
 * 首领：紫色六边形外壳 + 反向旋转的内芯 + 一圈虚线光环。
 * 光环半径就是 BOSS.AURA.RADIUS（小怪在这个范围内会被加速）。
 * @param {object} e 首领对象
 */
function drawBoss(e) {
  ctx.save();

  // 0) 冲锋预警：0.5 秒红色虚线，方向就是接下来冲锋的方向
  if (e.chargeWarn > 0) {
    const line = BOSS.SKILL.CHARGE_LINE;
    const ex = e.x + e.chargeDX * line;
    const ey = e.y + e.chargeDY * line;

    // 越接近冲锋越亮
    const ratio = 1 - e.chargeWarn / BOSS.SKILL.CHARGE_WARN;
    ctx.globalAlpha = 0.35 + ratio * 0.55;
    ctx.strokeStyle = '#ff3b5c';
    ctx.shadowColor = '#ff3b5c';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    // 线头一个实心小三角，指出冲锋方向
    const angle = Math.atan2(e.chargeDY, e.chargeDX);
    ctx.fillStyle = '#ff3b5c';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(
      ex - Math.cos(angle - 0.4) * 10,
      ey - Math.sin(angle - 0.4) * 10
    );
    ctx.lineTo(
      ex - Math.cos(angle + 0.4) * 10,
      ey - Math.sin(angle + 0.4) * 10
    );
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 霜环裁决者：冰蓝减速领域，玩家站进去移速减半
  if (e.bossIndex === 1) {
    ctx.globalAlpha = 0.1 + Math.sin(G.time * 2) * 0.03;
    ctx.fillStyle = COLORS.ice;
    ctx.beginPath();
    ctx.arc(e.x, e.y, BOSS.MUTATION.FROST_FIELD_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = COLORS.ice;
    ctx.shadowColor = COLORS.ice;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, BOSS.MUTATION.FROST_FIELD_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  ctx.shadowColor = COLORS.boss;
  ctx.shadowBlur = 16;

  // 1) 外圈虚线光环：让玩家一眼看出"这个范围里的怪更快"
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = 'rgba(192, 107, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(e.x, e.y, BOSS.AURA.RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]); // 画完立刻恢复，别影响后面的线

  // 2) 六边形外壳：慢慢顺时针转
  ctx.translate(e.x, e.y);
  ctx.rotate(G.time * 0.6);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6;
    const x = Math.cos(angle) * e.r;
    const y = Math.sin(angle) * e.r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = COLORS.boss;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COLORS.boss;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 3) 内芯：小一号的六边形，往反方向转，看起来像在充能
  ctx.rotate(-G.time * 1.1);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6;
    const x = Math.cos(angle) * e.r * 0.5;
    const y = Math.sin(angle) * e.r * 0.5;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = COLORS.boss;
  ctx.globalAlpha = 0.55;
  ctx.fill();

  // 4) 力场护盾：盾在时套一圈更大的紫色六边形，线宽随剩余盾量变细
  if (e.shield > 0) {
    const ratio = e.shieldMax > 0 ? e.shield / e.shieldMax : 0;
    const R = e.r * 1.45;

    ctx.globalAlpha = 0.16 + ratio * 0.14;
    ctx.fillStyle = '#a86bff';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const x = Math.cos(angle) * R;
      const y = Math.sin(angle) * R;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#c08bff';
    ctx.shadowColor = '#b46bff';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2 + ratio * 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6 + G.time * 0.35;
      const x = Math.cos(angle) * R;
      const y = Math.sin(angle) * R;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // 5) 轮数 / 词缀 / 质变提示：写在 Boss 头顶，玩家不用看 HUD 也知道现在是什么规则
  const affixNames = { shield: '护盾', rage: '暴怒', teleport: '瞬移' };
  const mutationNames = [
    '火焰路径',
    '收缩冰环',
    '破盾弹幕',
    '追踪紫球',
    '八向激光',
  ];
  const idx =
    typeof e.bossIndex === 'number'
      ? e.bossIndex
      : (e.bossNumber - 1) % BOSS.ARCHETYPES.length;
  const tag =
    e.bossRound >= 3
      ? '质变·' + mutationNames[idx]
      : e.affix
        ? '词缀·' + affixNames[e.affix]
        : '';

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = '10px "Consolas", "Courier New", monospace';
  ctx.fillStyle = e.bossRound >= 3 ? '#ff9a5c' : '#d8b4ff';
  ctx.shadowColor = e.bossRound >= 3 ? '#ff5a3c' : COLORS.boss;
  ctx.shadowBlur = 8;
  const roundLabel = '第 ' + e.bossRound + ' 轮' + (tag ? ' · ' + tag : '');
  ctx.fillText(roundLabel, e.x, e.y - e.r - 22);

  // 暴怒词缀：红色脉动光环，和普通紫色光环区分
  if (e.affix === 'rage') {
    ctx.globalAlpha = 0.25 + Math.sin(G.time * 8) * 0.12;
    ctx.strokeStyle = '#ff3b5c';
    ctx.shadowColor = '#ff3b5c';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 10 + Math.sin(G.time * 8) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 玩家：会呼吸、会转动的霓虹圆。所有尺寸都跟着 p.r 缩放。 */
function drawPlayer() {
  const p = G.p;
  const t = G.time;

  // 各层半径由碰撞半径 p.r 推导，调小玩家时整组一起变
  const ringR = p.r * 1.8;   // 外圈 / 亮弧
  const haloR = p.r * 2.6;   // 最外层淡光环

  ctx.save();
  ctx.shadowColor = COLORS.playerGlow;
  ctx.shadowBlur = 16; // 霓虹感的关键：模糊半径越大，光晕越大

  // 1) 外圈环
  ctx.strokeStyle = COLORS.player;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
  ctx.stroke();

  // 2) 一段跟着时间旋转的亮弧（看起来像能量在环里流动）
  ctx.strokeStyle = COLORS.playerCore;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, ringR, t * 2.2, t * 2.2 + Math.PI * 0.6);
  ctx.stroke();

  // 3) 内核：半径随正弦波"呼吸"（sin 在 -1..1 之间摆动）
  const pulse = p.r * 0.7 + Math.sin(t * 4) * 0.8;
  ctx.fillStyle = COLORS.playerCore;
  ctx.beginPath();
  ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // 4) 最外层一圈很淡的光环（放在 restore 之后，不参与 shadowBlur，省性能）
  ctx.strokeStyle = 'rgba(57, 246, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, haloR + Math.sin(t * 2) * 2, 0, Math.PI * 2);
  ctx.stroke();

  // 5) 阈值圆环：环形刻度做底，虚线弧表示当前主附魔计数
  const thresholdR = haloR ;
  const counter = p.enchantCounters.primary.value;
  const core = ENCHANT.CORES.find((c) => c.id === p.core);
  const arcColor = core ? core.color : COLORS.player;

  // 底环 1：40 个径向小刻度，每 4 个里有一个长刻度
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 40; i++) {
    const angle = -Math.PI / 2 + (i / 40) * Math.PI * 2;
    const longTick = i % 4 === 0;
    const inner = thresholdR + 1;
    const outer = thresholdR + (longTick ? 5 : 3);
    ctx.moveTo(
      p.x + Math.cos(angle) * inner,
      p.y + Math.sin(angle) * inner
    );
    ctx.lineTo(
      p.x + Math.cos(angle) * outer,
      p.y + Math.sin(angle) * outer
    );
  }
  ctx.stroke();

  // 底环 2：一圈很淡的虚线，让刻度之间也有"仪器"的感觉
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 5]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, thresholdR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 进度弧：从正上方开始顺时针；满 10 时 enchant.js 已把计数减 10，弧自然重来
  if (counter > 0) {
    const ratio = Math.min(1, counter / ENCHANT.THRESHOLD);
    ctx.save();
    ctx.strokeStyle = arcColor;
    ctx.shadowColor = arcColor;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2;
    ctx.setLineDash([8,2]);
    ctx.lineDashOffset = -G.time * 20; // 虚线缓慢流动，像扫描线
    ctx.beginPath();
    ctx.arc(
      p.x,
      p.y,
      thresholdR,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * ratio
    );
    ctx.stroke();
    ctx.restore();
  }

  // 5.5 副元素环：解锁副附魔后，在主环外侧再画一圈细弧。
  // 主、副各读自己的计数，互不干扰；中心点共用玩家的位置。
  if (p.enchantState.secondaryUnlocked && p.enchantState.secondaryId) {
    const secondaryId = p.enchantState.secondaryId;
    if (secondaryId !== p.core) {
      const secondaryCore = ENCHANT.CORES.find((c) => c.id === secondaryId);
      const secondaryColor = secondaryCore ? secondaryCore.color : COLORS.player;
      const secondaryR = thresholdR + 6;
      const secondaryValue = p.enchantCounters.secondary.value;

      ctx.save();
      // 底环：很淡的一整圈，表示"副环已解锁"
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = secondaryColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, secondaryR, 0, Math.PI * 2);
      ctx.stroke();

      // 进度弧：满 10 后 enchant.js 会把计数减 10，弧自然从头开始
      if (secondaryValue > 0) {
        const secondaryRatio = Math.min(1, secondaryValue / ENCHANT.THRESHOLD);
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = secondaryColor;
        ctx.shadowColor = secondaryColor;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.lineDashOffset = G.time * 16;
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y,
          secondaryR,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * secondaryRatio
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 5.8 受击反馈：真受伤后的无敌帧内高频闪红晕（冲刺无敌不闪）
  if (p.hurtFlash > 0) {
    const flicker = 0.5 + 0.5 * Math.sin(G.time * 30);
    ctx.save();
    ctx.globalAlpha = 0.35 + flicker * 0.4;
    ctx.strokeStyle = '#ff3b3b';
    ctx.shadowColor = '#ff3b3b';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, haloR + 4 + flicker * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 6) 冲刺冷却条：24×4 的硬核仪表条，冷却中才出现
  if (p.dashCD > 0) {
    const ready = Math.max(0, Math.min(1, 1 - p.dashCD / p.dashRate));
    const w = 24;
    const h = 4;
    const x = p.x - w / 2;
    const y = p.y + haloR + 9;

    // 只在条区内部画，斑马纹不会溢出到圆环上
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // 底：近黑，标出整条轨道
    ctx.fillStyle = 'rgba(8, 12, 18, 0.9)';
    ctx.fillRect(x, y, w, h);

    // 45° 斑马纹：未充能段露出来，充能段会盖住它
    ctx.strokeStyle = 'rgba(200, 220, 240, 0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = -h; sx < w + h; sx += 6) {
      ctx.moveTo(x + sx, y + h);
      ctx.lineTo(x + sx + h, y);
    }
    ctx.stroke();

    // 充能段：青 → 白的线性渐变 + 青色光晕
    if (ready > 0) {
      const grad = ctx.createLinearGradient(x, y, x + w, y);
      grad.addColorStop(0, '#0affff');
      grad.addColorStop(1, '#eafdff');
      ctx.fillStyle = grad;
      ctx.shadowColor = COLORS.player;
      ctx.shadowBlur = 8;
      ctx.fillRect(x, y, w * ready, h);

      // 充能前沿一根 1px 亮白竖线
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#eafdff';
      ctx.fillRect(x + w * ready - 1, y, 1, h);
    }
    ctx.restore();

    // 外框 + 左右各 2px 端帽
    ctx.strokeStyle = 'rgba(57, 246, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(57, 246, 255, 0.75)';
    ctx.fillRect(x - 2, y, 2, h);
    ctx.fillRect(x + w, y, 2, h);
  }
}

/** 伤害跳字：在玩家之后、HUD 之前，向上飘并淡出。 */
function drawCombatTexts() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const t of G.combatTexts) {
    // 整数伤害直接显示，小数（DOT / 黑洞）保留一位
    const value =
      (t.heal ? '+' : '') +
      (Number.isInteger(t.amount) ? String(t.amount) : t.amount.toFixed(1));

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, t.life / TEXT.TTL));
    ctx.fillStyle = t.color;
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 8;
    ctx.font = `bold ${TEXT.SIZE}px "Courier New", monospace`;
    ctx.fillText(value, t.x, t.y);
    ctx.restore();
  }
}

/**
 * 沿"左上 / 右下斜切"的矩形描一条闭合路径。
 * 修改为卡牌切角，修复了右上角的断线缺口。
 */
function traceCardRect(x, y, w, h, cut) {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);         // 左上切角起点
  ctx.lineTo(x + w, y);           // 右上直角
  ctx.lineTo(x + w, y + h - cut); // 右下切角起点
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x, y + h);           // 左下直角
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

// ==========================================
// HUD V4｜极简硬朗版
// ==========================================

function drawHud() {
  const p = G.p;
  const font = '"Consolas", "Courier New", monospace';

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowBlur = 0;

  // ======================================
  // 1. 左上：一行 HP 文字 + 贴边细血条
  // ======================================

  const hpX = 10;
  const hpY = 15;
  const hpW = 126;
  const hpH = 4;
  const hpSegments = 16;
  const hpSegmentW = 6;
  const hpSegmentGap = 2;
  const hpBarX = 48;

  const hpRatio = Math.max(
    0,
    Math.min(1, p.hp / Math.max(1, p.max))
  );

  // HP 文字放在血条左侧，和分段条同一水平线
  ctx.font = `10px ${font}`;
  ctx.fillStyle = HUD_STYLE.primary;
  ctx.fillText(
    `HP ${Math.ceil(p.hp)}`,
    hpX,
    hpY
  );

  // 16 个斜切小段：满血亮青发光，掉血只留暗青
  const filledSegments = hpRatio * hpSegments;

  for (let i = 0; i < hpSegments; i++) {
    const sx = hpBarX + i * (hpSegmentW + hpSegmentGap);

    ctx.beginPath();
    ctx.moveTo(sx + 2, hpY - hpH / 2);
    ctx.lineTo(sx + hpSegmentW, hpY - hpH / 2);
    ctx.lineTo(sx + hpSegmentW - 2, hpY + hpH / 2);
    ctx.lineTo(sx, hpY + hpH / 2);
    ctx.closePath();

    if (i < filledSegments) {
      ctx.save();
      ctx.shadowColor = '#39f6ff';
      ctx.shadowBlur = 5;
      ctx.fillStyle = '#39f6ff';
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(57,246,255,0.16)';
      ctx.fill();
    }
  }

  // 嗜血层数：只在装备时出现，写在分段血条右侧
  if (p.relicSlots.includes('bloodthirst')) {
    const level = p.relicLevels.bloodthirst || 1;
    const cfg = WEAPON.BLOODTHIRST;

    // 层数上限直接读 KILL_CAP，别用“倍率差 ÷ 每杀”反算，避免浮点显示 199/499
    const cap = cfg.KILL_CAP[level - 1];

    const stacks = Math.min(
      p.bloodthirstKills,
      cap
    );

    ctx.font = `8px ${font}`;
    ctx.fillStyle = '#A9764E';
    ctx.fillText(
      `嗜血×${stacks}`,
      hpBarX + hpW + 6,
      hpY + 2
    );
  }

  // ======================================
  // 2. 右上：单行纯文字数据，不要面板
  // ======================================

  const stats = [
    { text: '房 ', color: HUD_STYLE.secondary },
    {
      text: String(G.wave).padStart(2, '0'),
      color: '#8ff8ff'
    },
    {
      text: ' | ',
      color: 'rgba(111,135,148,0.55)'
    },
    { text: '击杀 ', color: HUD_STYLE.secondary },
    {
      text: String(G.kills),
      color: '#8ff8ff'
    },
    {
      text: ' | ',
      color: 'rgba(111,135,148,0.55)'
    },
    { text: '分数 ', color: HUD_STYLE.secondary },
    {
      text: String(G.score),
      color: '#8ff8ff'
    }
  ];

  ctx.font = `11px ${font}`;
  ctx.textAlign = 'left';

  let statsWidth = 0;

  for (let i = 0; i < stats.length; i++) {
    statsWidth += hudTextWidth(stats[i].text);
  }

  let statsX = 950 - statsWidth;

  for (let i = 0; i < stats.length; i++) {
    ctx.fillStyle = stats[i].color;
    ctx.fillText(stats[i].text, statsX, 15);
    statsX += hudTextWidth(stats[i].text);
  }

  // ======================================
  // 3. 右上：纯文字按钮，没有矩形框
  // ======================================

  drawHudTextButton(
    HUD_BUTTONS.auto,
    `[ 自动攻击：${G.autoAttack ? '开' : '关'} ]`,
    G.autoAttack
  );

  drawHudTextButton(
    HUD_BUTTONS.fullscreen,
    '[ 全屏 ]',
    true
  );

  // ======================================
  // 4. 左下：四个极简遗物槽 + 图标
  // ======================================

  const slotSize = 14;
  const slotGap = 6;
  const slotY = CANVAS.HEIGHT - 35;
  let hoveredRelic = null;

  for (let slot = 0; slot < 4; slot++) {
    const sx = 10 + slot * (slotSize + slotGap);
    const id = p.relicSlots[slot];

    const def = id
      ? RELIC_DEFS.find(item => item.id === id)
      : null;

    // 空槽只留一条极暗的边，不画底色
    ctx.strokeStyle = def
      ? def.color
      : 'rgba(66,97,107,0.30)';

    ctx.lineWidth = 1;

    ctx.strokeRect(
      sx + 0.5,
      slotY + 0.5,
      slotSize - 1,
      slotSize - 1
    );

    if (def) {
      drawRelicIcon(
        ctx,
        id,
        sx + slotSize / 2,
        slotY + slotSize / 2,
        def.color
      );

      // 等级用槽下 1px 小点表示，不占图标空间
      const level = Math.max(
        1,
        Math.min(3, p.relicLevels[id] || 1)
      );

      ctx.fillStyle = def.color;

      for (let dot = 0; dot < level; dot++) {
        ctx.fillRect(
          sx + 2 + dot * 3,
          slotY + slotSize + 2,
          2,
          1
        );
      }

      // 鼠标落在槽位的 14×14 矩形里，就记下来，循环结束后画提示框
      if (
        G.state === 'play' &&
        p.aimX >= sx &&
        p.aimX <= sx + slotSize &&
        p.aimY >= slotY &&
        p.aimY <= slotY + slotSize
      ) {
        hoveredRelic = { def, level, sx };
      }
    }
  }

  // 悬停提示：画在遗物槽上方，靠近边缘时自动夹回屏幕内
  if (hoveredRelic) {
    drawRelicTooltip(
      hoveredRelic.sx,
      slotY - 56,
      hoveredRelic.def,
      hoveredRelic.level
    );
  }

  // ======================================
  // 5. 左下：一行操作提示，贴屏幕边缘
  // ======================================

  ctx.font = `9px ${font}`;
  ctx.fillStyle = HUD_STYLE.secondary;
  ctx.textAlign = 'left';

  ctx.fillText(
    'WASD 移动 | SPACE 冲刺',
    10,
    CANVAS.HEIGHT - 10
  );

  ctx.restore();
}

/**
 * 遗物悬停提示框：160×48，半透明黑底 + 遗物色细边。
 * 名称/等级一行，效果说明最多两行；整框会被夹在屏幕内。
 */
function drawRelicTooltip(x, y, def, level) {
  const w = 160;
  const h = 48;
  const font = '"Consolas", "Courier New", monospace';

  // 先夹住左上角，保证提示框不越出 960×540 的逻辑屏幕
  const tx = Math.max(8, Math.min(CANVAS.WIDTH - w - 8, x));
  const ty = Math.max(8, Math.min(CANVAS.HEIGHT - h - 8, y));

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowBlur = 0;

  // 半透明黑底 + 1px 遗物色边框
  ctx.fillStyle = 'rgba(3,8,14,0.94)';
  ctx.fillRect(tx, ty, w, h);

  ctx.strokeStyle = def.color;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1;
  ctx.strokeRect(tx + 0.5, ty + 0.5, w - 1, h - 1);
  ctx.globalAlpha = 1;

  // 第一行：名称 + 等级
  ctx.font = `11px ${font}`;
  ctx.fillStyle = def.color;
  ctx.fillText(
    `${def.name} Lv.${level}`,
    tx + 8,
    ty + 7,
    w - 16
  );

  // 第二、三行：当前等级的效果说明，按宽度自动折行
  ctx.font = `9px ${font}`;
  ctx.fillStyle = '#b8c8d4';

  const description =
    (def.levels && def.levels[level - 1]) || '';

  const lines = wrapTooltipText(
    description,
    w - 16,
    2
  );

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(
      lines[i],
      tx + 8,
      ty + 23 + i * 11,
      w - 16
    );
  }

  ctx.restore();
}

/**
 * 把说明文字按像素宽度折成最多 maxLines 行；放不下时最后一行加省略号。
 */
function wrapTooltipText(text, maxWidth, maxLines) {
  const lines = [];
  let current = '';

  for (const ch of text) {
    const next = current + ch;

    if (hudTextWidth(next) > maxWidth && current) {
      lines.push(current);
      current = ch;

      if (lines.length === maxLines) {
        lines[maxLines - 1] += '…';
        return lines;
      }
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

/**
 * 量一段 HUD 文字大概有多宽。
 * 浏览器里用 measureText；测试桩没有这个方法时按字符估算。
 */
function hudTextWidth(text) {
  if (typeof ctx.measureText === 'function') {
    try {
      const metrics = ctx.measureText(text);

      if (
        metrics &&
        typeof metrics.width === 'number' &&
        isFinite(metrics.width)
      ) {
        return metrics.width;
      }
    } catch (error) {
      // 测试桩可能没有实现 measureText，忽略并走估算
    }
  }

  let width = 0;

  for (const ch of text) {
    // 中文按 11px 估算，英文/数字按 6.6px 估算
    width += ch.charCodeAt(0) > 255 ? 11 : 6.6;
  }

  return width;
}

/**
 * 画一个纯文字按钮：没有框，只有文字本身和颜色状态。
 */
function drawHudTextButton(rect, label, active) {
  ctx.save();
  ctx.font =
    '10px "Consolas", "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = active
    ? '#8ff8ff'
    : '#6f8794';

  ctx.fillText(
    label,
    rect.x + rect.w,
    rect.y + rect.h / 2
  );

  ctx.restore();
}

/**
 * 用 1px 几何线画遗物图标。
 * 坐标以格子中心为原点，整体控制在 10×10 内。
 */
function drawRelicIcon(ctx, id, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 3;

  ctx.beginPath();

  if (id === 'tripleShot') {
    // 三向散射：三条向外发散的线
    ctx.moveTo(-2, 4);
    ctx.lineTo(-4, -4);
    ctx.moveTo(0, 4);
    ctx.lineTo(0, -5);
    ctx.moveTo(2, 4);
    ctx.lineTo(4, -4);
  } else if (id === 'lightningLink') {
    // 闪电：一个 Z 字
    ctx.moveTo(-4, -4);
    ctx.lineTo(2, -4);
    ctx.lineTo(-2, 0);
    ctx.lineTo(4, 0);
  } else if (id === 'hitFission') {
    // 命中裂变：中心点 + 四条斜向碎片
    ctx.arc(0, 0, 1.2, 0, Math.PI * 2);
    ctx.moveTo(2, 2);
    ctx.lineTo(4, 4);
    ctx.moveTo(-2, 2);
    ctx.lineTo(-4, 4);
    ctx.moveTo(2, -2);
    ctx.lineTo(4, -4);
    ctx.moveTo(-2, -2);
    ctx.lineTo(-4, -4);
  } else if (id === 'homing') {
    // 追踪：一条弯钩 + 箭头
    ctx.moveTo(-4, 4);
    ctx.quadraticCurveTo(1, -7, 4, -1);
    ctx.moveTo(4, -1);
    ctx.lineTo(1, -2);
    ctx.moveTo(4, -1);
    ctx.lineTo(3, 1.6);
  } else if (id === 'piercing') {
    // 穿透：一支贯穿的箭
    ctx.moveTo(-4, 4);
    ctx.lineTo(4, -4);
    ctx.moveTo(4, -4);
    ctx.lineTo(1, -4);
    ctx.moveTo(4, -4);
    ctx.lineTo(4, -1);
  } else if (id === 'boomerangCore') {
    // 回旋：一个 U 形轨迹 + 箭头
    ctx.moveTo(-4, -4);
    ctx.bezierCurveTo(-7, 3, -2, 6, 0, 6);
    ctx.bezierCurveTo(2, 6, 7, 3, 4, -4);
    ctx.moveTo(4, -4);
    ctx.lineTo(1, -3);
    ctx.moveTo(4, -4);
    ctx.lineTo(3, -1);
  } else if (id === 'elementMix') {
    // 元素混合：两个相交的小圆
    ctx.arc(-1.8, 0, 3, 0, Math.PI * 2);
    ctx.moveTo(4.8, 0);
    ctx.arc(1.8, 0, 3, 0, Math.PI * 2);
  } else if (id === 'bloodthirst') {
    // 嗜血：一滴水
    ctx.moveTo(0, -5);
    ctx.bezierCurveTo(4, -1, 4, 3, 0, 5);
    ctx.bezierCurveTo(-4, 3, -4, -1, 0, -5);
  } else if (id === 'lifesteal') {
    // 汲取：一个十字
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.moveTo(-4, 0);
    ctx.lineTo(4, 0);
  } else {
    // 未知遗物：小菱形兜底
    ctx.moveTo(0, -4);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 4);
    ctx.lineTo(-4, 0);
    ctx.closePath();
  }

  ctx.stroke();
  ctx.restore();
}


// ==========================================
// 8. 极简面板绘制
// 标准直角，只在右下角留 8px 缺口
// ==========================================

function drawHudPanel(x, y, w, h, isBoss = false) {
  ctx.save();
  ctx.shadowBlur = 0;

  // 面板底色：完整矩形，保证内容区不透明
  ctx.fillStyle = HUD_STYLE.background;
  ctx.fillRect(x, y, w, h);

  // 边框：标准直角；只在右下角留 8px 缺口
  ctx.strokeStyle = isBoss
    ? HUD_STYLE.boss
    : HUD_STYLE.border;

  ctx.lineWidth = HUD_STYLE.lineWidth;

  ctx.beginPath();

  // 顶边
  ctx.moveTo(x + 0.5, y + 0.5);
  ctx.lineTo(x + w - 0.5, y + 0.5);

  // 右边，到缺口上沿停住
  ctx.lineTo(
    x + w - 0.5,
    y + h - HUD_STYLE.cut + 0.5
  );

  // 缺口下沿开始画底边
  ctx.moveTo(
    x + w - HUD_STYLE.cut + 0.5,
    y + h - 0.5
  );

  // 底边
  ctx.lineTo(x + 0.5, y + h - 0.5);

  // 左边
  ctx.lineTo(x + 0.5, y + 0.5);

  ctx.stroke();
  ctx.restore();
}



// ==========================================
// 10. BOSS 信息与血条
// ==========================================

function drawBossBar() {
  const boss = G.enemies.find(
    e => e.type === 'boss'
  );

  if (!boss) return;

  const x = 340;
  const y = 8;
  const w = 280;
  const h = 40;

  drawHudPanel(x, y, w, h, true);

  ctx.save();
  ctx.shadowBlur = 0;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // BOSS 名称
  ctx.font =
    '12px "Consolas", "Courier New", monospace';

  ctx.fillStyle = HUD_STYLE.primary;

  ctx.fillText(
    String(boss.archetype || ''),
    x + 10,
    y + 15,
    w - 20
  );

  // 12 格紫灰色分段血条
  const barX = x + 10;
  const barY = y + 26;
  const barW = w - 20;
  const barH = 6;

  const ratio = Math.max(
    0,
    Math.min(
      1,
      boss.hp / Math.max(1, boss.max)
    )
  );

  const count = 12;
  const gap = 1.5;

  const segW =
    (barW - gap * (count - 1)) / count;

  for (let i = 0; i < count; i++) {
    const sx = barX + i * (segW + gap);

    const fill = Math.max(
      0,
      Math.min(1, ratio * count - i)
    );

    // 空血槽
    ctx.fillStyle = '#241A31';
    ctx.fillRect(sx, barY, segW, barH);

    // 当前血量
    if (fill > 0) {
      ctx.fillStyle = HUD_STYLE.boss;
      ctx.fillRect(sx, barY, segW * fill, barH);
    }
  }

  ctx.restore();
}

/** 房间提示：进房 / 清房时在屏幕中央短暂显示的文字（只读 G.notice）。 */
function drawNotice() {
  const notice = G.notice;

  // timer 归零就不画
  if (notice.timer <= 0) return;

  // 最后 0.5 秒淡出，不要"啪"地消失
  const alpha = Math.min(1, notice.timer / 0.5);

  ctx.save();
  ctx.globalAlpha = alpha;

  // 主文字：居中、加粗，放在屏幕上方 30% 的位置
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillText(notice.text, CANVAS.WIDTH / 2, CANVAS.HEIGHT * 0.3);

  // 副文字：主文字下面 22px，小一号、暗一点
  ctx.fillStyle = COLORS.textDim;
  ctx.font = '11px "Courier New", monospace';
  ctx.fillText(notice.sub, CANVAS.WIDTH / 2, CANVAS.HEIGHT * 0.3 + 22);

  ctx.restore();
}

/** 死亡遮罩：半透明黑幕 + 标题 + 重开提示 + 本局分数。 */
function drawDeadOverlay() {
  // 黑幕：盖住游戏画面，但还能隐约看到战场
  ctx.fillStyle = 'rgba(4, 6, 11, 0.72)';
  ctx.fillRect(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT);

  // 所有文字居中
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 主标题
  ctx.fillStyle = COLORS.hp;
  ctx.font = 'bold 28px "Courier New", monospace';
  ctx.fillText('你被打倒了', CANVAS.WIDTH / 2, CANVAS.HEIGHT / 2 - 22);

  // 重开提示
  ctx.fillStyle = COLORS.text;
  ctx.font = '12px "Courier New", monospace';
  ctx.fillText('按 R 重开', CANVAS.WIDTH / 2, CANVAS.HEIGHT / 2 + 14);

  // 本局分数
  ctx.fillStyle = COLORS.textDim;
  ctx.font = '11px "Courier New", monospace';
  ctx.fillText(`本局分数 ${G.score}`, CANVAS.WIDTH / 2, CANVAS.HEIGHT / 2 + 36);
}