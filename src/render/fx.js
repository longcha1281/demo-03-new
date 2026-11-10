// ============================================================
// fx.js —— 画面绘制的「fx」部分
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

/**
 * 元素爆发：三层叠加 —— 中心白光 → 扩散粗环 → 8 个几何碎片。
 * 碎片形状按爆发类型区分：火=光点、冰=射线、暗=旋转方块。
 */
export function drawBursts() {
  const ctx = getCtx();
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
export function drawDarkBurst(b, progress, fade) {
  const ctx = getCtx();
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

// 绘制具有动态粗细与亮度变化的能量弧线
export function drawEnergyArc(ring, time, alpha) {
  const ctx = getCtx();
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

export function drawZones() {
  const ctx = getCtx();
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
 * 闪电链：只画 systems.triggerLightning 记下的折线。
 * 青白色、短促淡出；数组为空时什么都不做。
 */
export function drawLightningArcs() {
  const ctx = getCtx();
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

/** 伤害跳字：在玩家之后、HUD 之前，向上飘并淡出。 */
export function drawCombatTexts() {
  const ctx = getCtx();
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
