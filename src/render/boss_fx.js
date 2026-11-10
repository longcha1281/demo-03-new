// ============================================================
// boss_fx.js —— 画面绘制的「boss_fx」部分
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



/**
 * 敌方子弹：统一亮红色发光小圆；追踪球更大，并且额外套一层淡环。
 * 不再按子弹自带颜色区分，避免boss紫色弹和暗蚀弹混在一起。
 */
/**
 * 首领危险区：火焰节点、收缩冰环、激光。
 * 激光在预警阶段画虚线，激活阶段画粗实线，一眼能分清"该躲"和"正在伤人"。
 */
export function drawBossHazards() {
  const ctx = getCtx();
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
export function drawBossGhosts() {
  const ctx = getCtx();
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
 * 首领：紫色六边形外壳 + 反向旋转的内芯 + 一圈虚线光环。
 * 光环半径就是 BOSS.AURA.RADIUS（小怪在这个范围内会被加速）。
 * @param {object} e 首领对象
 */
export function drawBoss(e) {
  const ctx = getCtx();
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
