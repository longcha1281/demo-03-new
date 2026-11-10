// ============================================================
// canvas.js —— 画布初始化 + 每帧绘制调度
// 具体绘制已拆到 bg / entity / boss_fx / fx / hud。
// 逻辑坐标 960×540，开头统一放大 CANVAS.SCALE 倍。
// ============================================================

import { CANVAS, COLORS } from '../config.js';
import { G } from '../core/state.js';
import { setContext } from './context.js';
import { drawBackground } from './bg.js';
import {
  drawPickups,
  drawSparks,
  drawShots,
  drawHostile,
  drawEnemies,
  drawLockOn,
  drawPlayer,
} from './entity.js';
import { drawBossHazards, drawBossGhosts } from './boss_fx.js';
import { drawBursts, drawZones, drawLightningArcs, drawCombatTexts } from './fx.js';
import { drawHud, drawBossBar, drawNotice, drawDeadOverlay, HUD_BUTTONS } from './hud.js';

export { HUD_BUTTONS };

// 画布和 2D 上下文。initCanvas() 时赋上，之后每帧绘制都用它。
let canvas = null;
let ctx = null;

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
  setContext(ctx);
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
  drawBursts();
  drawZones();
  drawBossHazards();
  drawPickups();
  drawSparks();
  drawShots();
  drawHostile();
  drawEnemies();
  drawBossGhosts();
  drawLightningArcs();
  drawLockOn();
  drawPlayer();
  drawCombatTexts();

  ctx.restore();

  drawHud();
  drawBossBar();
  drawNotice();

  if (G.state === 'dead') {
    drawDeadOverlay();
  }
}
