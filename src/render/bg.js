// ============================================================
// bg.js —— 画面绘制的「bg」部分
// 从 canvas.js 原样拆出；只读 G，不改任何游戏数据。
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
import { getCtx } from './context.js';



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

/** 背景：纯黑底 + 三层视差星空 + 24px 整屏网格 + 屏幕边框。 */
export function drawBackground() {
  const ctx = getCtx();
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
export function drawStars() {
  const ctx = getCtx();
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
