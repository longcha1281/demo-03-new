// ============================================================
// boss_fx.js —— 画面绘制的「boss_fx」部分
// 从 canvas.js 原样拆出；只读 G，不改任何游戏数据。
// ============================================================

import { COLORS, BOSS, CANVAS, ARENA } from '../config.js';
import { G } from '../core/state.js';
import { getCtx } from './context.js';



/**
 * 首领危险区：裂隙切割线（以及旧版保留的火焰/冰环/落雷/激光分支）。
 * 切割线预警阶段画极细红线闪烁，爆发阶段画粗紫红激光，一眼分清"该躲"和"正在伤人"。
 */
export function drawBossHazards() {
  const ctx = getCtx();
  if (G.bossHazards.length === 0) return;

  for (const h of G.bossHazards) {
    ctx.save();

    if (h.kind === 'frostRing') {
      const warning = h.age < h.warn;
      const from = h.gapStart + h.gapSize;
      const to = h.gapStart + Math.PI * 2;
      // 半径由 boss.js 逐帧推进，这里只按状态换线宽/亮度。
      if (warning) {
        // 预警：一圈细虚线带着缺口缓慢呼吸，扩到最大才开始伤人。
        // 缺口两侧各画一条短线，明确"这两个方向之间是安全区"。
        const breath = 0.5 + 0.5 * Math.sin(G.time * 8);
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = '#b8f3ff';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = BOSS.FROST.color;
        ctx.shadowColor = BOSS.FROST.color;
        ctx.shadowBlur = 6;
        ctx.globalAlpha = 0.35 + 0.25 * breath;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, from, to);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (const edge of [from, to]) {
          ctx.moveTo(h.x + Math.cos(edge) * (h.r - 14), h.y + Math.sin(edge) * (h.r - 14));
          ctx.lineTo(h.x + Math.cos(edge) * (h.r + 14), h.y + Math.sin(edge) * (h.r + 14));
        }
        ctx.stroke();
      } else {
        // 落地：粗亮环带 + 白芯，缺口处断开；最后 0.12 秒快速淡出。
        const fade = Math.min(1, Math.max(0, (h.life - h.age) / 0.12));
        ctx.globalAlpha = 0.32 * fade;
        ctx.strokeStyle = BOSS.FROST.color;
        ctx.shadowColor = BOSS.FROST.color;
        ctx.shadowBlur = 24;
        ctx.lineWidth = h.width + 10;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, from, to);
        ctx.stroke();

        ctx.globalAlpha = 0.95 * fade;
        ctx.lineWidth = h.width;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, from, to);
        ctx.stroke();

        ctx.strokeStyle = '#eafdff';
        ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.85 * fade;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, from, to);
        ctx.stroke();
      }
    } else if (h.kind === 'frostZone') {
      if (h.age < (h.warn || 0)) {
        // 预警：细虚线与冰晶十字，比生效圈更淡，不产生减速。
        const progress = h.age / h.warn;
        const breath = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
        ctx.fillStyle = '#b8f3ff';
        ctx.globalAlpha = 0.025 + 0.015 * breath;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#a5edff';
        ctx.shadowColor = '#a5edff';
        ctx.shadowBlur = 4;
        ctx.globalAlpha = 0.35 + 0.15 * breath;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 7]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const angle = Math.PI * i / 3;
          const dx = Math.cos(angle) * 5;
          const dy = Math.sin(angle) * 5;
          ctx.moveTo(h.x - dx, h.y - dy);
          ctx.lineTo(h.x + dx, h.y + dy);
        }
        ctx.stroke();
      } else {
        // 极寒冰圈：淡青填充 + 双层描边，边界清楚但不挡视野
        const fade = Math.min(1, Math.max(0, (h.life - h.age) / 0.5));
        ctx.globalAlpha = 0.10 * fade;
        ctx.fillStyle = BOSS.FROST.color;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.75 * fade;
        ctx.strokeStyle = BOSS.FROST.color;
        ctx.shadowColor = BOSS.FROST.color;
        ctx.shadowBlur = 12;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 0.35 * fade;
        ctx.setLineDash([6, 7]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * 0.72, G.time * 0.6, G.time * 0.6 + Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (h.kind === 'magma') {
      const warning = h.age < h.warn;
      const fade = warning ? 1 : Math.min(1, Math.max(0, (h.life - h.age) / 0.4));
      const pulse = 0.5 + 0.5 * Math.sin(h.age * 4);
      ctx.translate(h.x, h.y);
      // 圆形边界与碰撞范围一致；内部裂流始终收在危险边界内。
      ctx.globalAlpha = (warning ? 0.08 : 0.82) * fade;
      ctx.fillStyle = warning ? '#8a2818' : '#47100e';
      ctx.beginPath();
      ctx.arc(0, 0, h.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = warning ? '#ff8b38' : '#ff9c35';
      ctx.shadowColor = '#fa501f';
      ctx.shadowBlur = warning ? 5 : 12;
      ctx.lineWidth = warning ? 1.7 : 2;
      ctx.globalAlpha = (warning ? 0.45 + pulse * 0.2 : 0.9) * fade;
      ctx.setLineDash(warning ? [7, 6] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (warning) {
        // 蓄热裂缝逐渐亮起，不把未生效的区域画成满池亮色。
        ctx.globalAlpha = 0.2 + 0.3 * h.age / h.warn;
        ctx.beginPath();
        ctx.moveTo(-9, -3); ctx.lineTo(-2, 2); ctx.lineTo(2, -4); ctx.lineTo(10, 3);
        ctx.stroke();
      } else if (h.age < h.warn + h.active) {
        // 六股分叉熔流：固定形状缓慢呼吸，不逐帧随机闪烁。
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3 + 0.15;
          const bend = 0.16 * Math.sin(h.age * 0.8 + i * 1.7);
          const x = Math.cos(angle + bend), y = Math.sin(angle + bend);
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * h.r * 0.1, Math.sin(angle) * h.r * 0.1);
          ctx.lineTo(x * h.r * 0.4 - y * 6, y * h.r * 0.4 + x * 6);
          ctx.lineTo(x * h.r * 0.72, y * h.r * 0.72);
          ctx.strokeStyle = '#dc3b13'; ctx.lineWidth = 7;
          ctx.globalAlpha = 0.45 * fade; ctx.stroke();
          ctx.strokeStyle = '#ff9e35'; ctx.lineWidth = 1.7;
          ctx.globalAlpha = (0.5 + 0.15 * Math.sin(G.time * 2 + i)) * fade; ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x * h.r * 0.42, y * h.r * 0.42);
          ctx.lineTo(Math.cos(angle + 0.5) * h.r * 0.65, Math.sin(angle + 0.5) * h.r * 0.65);
          ctx.lineWidth = 1; ctx.stroke();
        }
        // 翻涌热斑沿池内缓慢流动，白热点只占很小面积。
        for (let i = 0; i < 4; i++) {
          const angle = i * 2.4 + h.age * 0.25;
          const radius = h.r * (0.24 + (i % 2) * 0.3);
          const size = 4 + 1.5 * Math.sin(h.age * 2 + i);
          ctx.globalAlpha = 0.5 * fade; ctx.fillStyle = '#f96922';
          ctx.beginPath();ctx.ellipse(Math.cos(angle) * radius, Math.sin(angle) * radius, size * 1.8, size, angle, 0, Math.PI * 2);ctx.fill();
          ctx.globalAlpha = 0.7 * fade;ctx.fillStyle = '#fff1c9';
          ctx.beginPath();ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, size * 0.3, 0, Math.PI * 2);ctx.fill();
        }
      }
    } else if (h.kind === 'finalWarn') {
      const warning = h.age < h.warn;
      const radius = warning ? h.startR : h.r;
      const arenaWidth = CANVAS.WIDTH - ARENA.MARGIN_X * 2;
      const arenaHeight = CANVAS.HEIGHT - ARENA.MARGIN_TOP - ARENA.MARGIN_BOTTOM;
      // 圈外低透明危险色只覆盖场地，HUD 和安全圈内部保持清晰。
      ctx.beginPath();
      ctx.rect(ARENA.MARGIN_X, ARENA.MARGIN_TOP, arenaWidth, arenaHeight);
      ctx.clip();
      ctx.globalAlpha = warning ? 0.025 : 0.085;
      ctx.fillStyle = BOSS.FINAL.edgeColor;
      ctx.beginPath();
      ctx.rect(ARENA.MARGIN_X, ARENA.MARGIN_TOP, arenaWidth, arenaHeight);
      ctx.moveTo(h.x + radius, h.y);
      ctx.arc(h.x, h.y, radius, 0, Math.PI * 2);
      ctx.fill('evenodd');

      ctx.globalAlpha = warning ? 0.4 + 0.15 * Math.sin(G.time * 3) : 0.8;
      ctx.strokeStyle = BOSS.FINAL.edgeColor;
      ctx.shadowColor = BOSS.FINAL.edgeColor;
      ctx.shadowBlur = warning ? 8 : 16;
      ctx.lineWidth = warning ? 2.5 : 3.5;
      ctx.setLineDash(warning ? [10, 12] : []);
      ctx.beginPath();
      ctx.arc(h.x, h.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (h.kind === 'flame') {
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
    } else if (h.kind === 'riftSlash') {
      const cos = Math.cos(h.angle);
      const sin = Math.sin(h.angle);
      const half = h.length / 2;
      const x1 = h.x - cos * half;
      const y1 = h.y - sin * half;
      const x2 = h.x + cos * half;
      const y2 = h.y + sin * half;
      const active = h.age >= h.warn;

      if (!active) {
        // 预警：极细红线柔和呼吸，只是提示，不伤人
        ctx.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(G.time * 6));
        ctx.strokeStyle = '#ff3355';
        ctx.shadowColor = '#ff3355';
        ctx.shadowBlur = 6;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else {
        // 爆发：外发光 + 紫红主线 + 白芯，三层叠出"粗大激光"
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = 'rgba(217, 70, 239, 0.45)';
        ctx.shadowColor = BOSS.RIFT.color;
        ctx.shadowBlur = 26;
        ctx.lineWidth = 30;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = BOSS.RIFT.color;
        ctx.shadowBlur = 18;
        ctx.lineWidth = h.width;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // 两条线共用中心，叠出很淡的紫色交点光斑。
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = BOSS.RIFT.color;
        ctx.shadowColor = BOSS.RIFT.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.width * 0.85, 0, Math.PI * 2);
        ctx.fill();
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
 * 画一个四芒星十字飞镖：8 个顶点交替使用外半径 / 内半径。
 * @param {CanvasRenderingContext2D} ctx 画布
 * @param {number} r 外半径
 * @param {number} rotation 旋转角
 */
function riftStarPath(ctx, r, rotation) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = rotation + (Math.PI / 4) * i;
    const radius = i % 2 === 0 ? r * 1.15 : r * 0.12;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * 首领附加视觉：暴怒红光、护盾环、瞬移预警。
 * 先画光环再画本体，护盾/预警叠在最上层，保证和碰撞判定看到的一致。
 * @param {object} e 首领对象
 */
export function drawBoss(e) {
  if (e.affix === 'rage') drawRageAura(e);
  drawBossBody(e);
  if (e.bossShield > 0) drawBossShield(e);
  if (e.teleportWarn > 0) drawTeleportWarn(e);
}

/** 词缀·暴怒：红色脉动外环。 */
function drawRageAura(e) {
  const ctx = getCtx();
  const pulse = 0.35 + 0.2 * Math.sin(G.time * 8);
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = '#ff4d4d';
  ctx.shadowColor = '#ff2d2d';
  ctx.shadowBlur = 18;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * 1.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 护盾环：冰蓝=词缀护盾，橙色=熔核终极装甲盾；透明度随剩余量变化。 */
function drawBossShield(e) {
  const ctx = getCtx();
  const ratio = Math.max(0, Math.min(1, e.bossShield / Math.max(1, e.bossShieldMax)));
  const color = e.ultimate === 2 ? '#ffb066' : COLORS.ice;
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.45 * ratio;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * 1.65 + Math.sin(G.time * 5) * 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.10 + 0.12 * ratio;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** 词缀·瞬移：0.3 秒闪烁预警圈，提示马上换位。 */
function drawTeleportWarn(e) {
  const ctx = getCtx();
  const blink = 0.4 + 0.6 * Math.abs(Math.sin(G.time * 30));
  ctx.save();
  ctx.globalAlpha = blink;
  ctx.strokeStyle = '#d6b3ff';
  ctx.shadowColor = '#b96bff';
  ctx.shadowBlur = 20;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * 2.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 裂隙刺客：极细四芒星 + 移动残影 + 简单光晕。
 * 不再画六边形、护盾、轮次/词缀文字。
 * @param {object} e 首领对象
 */
function drawBossBody(e) {
  // 按编号分派外形：0 裂隙 / 1 极寒 / 2 熔核 / 3 虚空 / 4 终焉
  if (e.bossIndex === 1) return drawFrostBoss(e);
  if (e.bossIndex === 2) return drawMoltenBoss(e);
  if (e.bossIndex === 3) return drawVoidBoss(e);
  if (e.bossIndex === 4) return drawFinalBoss(e);

  const ctx = getCtx();
  const cfg = BOSS.RIFT;
  const color = cfg.color;
  const rotation = G.time * 1.6;
  const trail = e.trail || [];

  ctx.save();

  // 0) 锁定方向的细双轨走廊，长度随实际突刺配置变化。
  if (e.dashState === 'windup') {
    const len = cfg.dashSpeed * cfg.dashTime + e.r * 2;
    const progress = Math.min(1, e.dashTimer / cfg.dashWarn);
    const breath = 0.55 + 0.2 * Math.sin(progress * Math.PI * 2);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.atan2(e.dashDirY, e.dashDirX));
    const gradient = ctx.createLinearGradient(0, 0, len, 0);
    gradient.addColorStop(0, '#ff3355');
    gradient.addColorStop(1, '#ff5c8a');
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.06 * breath;
    ctx.fillRect(0, -8, len, 16);
    ctx.strokeStyle = gradient;
    ctx.shadowColor = '#ff5c8a';
    ctx.shadowBlur = 5;
    ctx.globalAlpha = breath;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(len, -8);
    ctx.moveTo(0, 8);
    ctx.lineTo(len, 8);
    ctx.stroke();

    // 四个沿走廊前移的箭头，终点使用菱形十字准星。
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const x = ((i + progress * 2) % 4) / 4 * (len - 16) + 8;
      ctx.moveTo(x - 5, -4);
      ctx.lineTo(x, 0);
      ctx.lineTo(x - 5, 4);
    }
    ctx.moveTo(len - 7, 0);
    ctx.lineTo(len, -7);
    ctx.lineTo(len + 7, 0);
    ctx.lineTo(len, 7);
    ctx.closePath();
    ctx.moveTo(len - 11, 0);
    ctx.lineTo(len + 11, 0);
    ctx.moveTo(len, -11);
    ctx.lineTo(len, 11);
    ctx.stroke();
    ctx.globalAlpha = 0.1 + progress * 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, e.r * (1.7 - 0.5 * progress), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 冲刺路径带：从本体向最近历史点收窄，硬直开始后快速淡出。
  const dashFade = e.dashState === 'dash' ? 1
    : e.dashState === 'recover' ? Math.max(0, 1 - e.dashTimer / 0.18) : 0;
  if (dashFade > 0 && trail.length > 0) {
    const points = [{ x: e.x, y: e.y }, ...trail];
    const nx = -e.dashDirY;
    const ny = e.dashDirX;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const front = 1 - i / (points.length - 1);
      const back = 1 - (i + 1) / (points.length - 1);
      const width = e.r * 0.45;
      ctx.globalAlpha = dashFade * front * 0.35;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x + nx * width * front, a.y + ny * width * front);
      ctx.lineTo(b.x + nx * width * back, b.y + ny * width * back);
      ctx.lineTo(b.x - nx * width * back, b.y - ny * width * back);
      ctx.lineTo(a.x - nx * width * front, a.y - ny * width * front);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = dashFade * front * 0.7;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.3 * front;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // 以首领 id 为种子，速度线长短有变化但逐帧稳定；不越过本次路径。
    const last = points[points.length - 1];
    const pathLength = Math.hypot(e.x - last.x, e.y - last.y);
    ctx.strokeStyle = '#ff5c8a';
    ctx.lineWidth = 1;
    ctx.globalAlpha = dashFade * 0.4;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const offset = (i - 1) * 7;
      const head = Math.min(pathLength, 4 + i * 8);
      const length = Math.min(Math.max(0, pathLength - head), 12 + ((e.id * 17 + i * 13) % 19));
      const x = e.x - e.dashDirX * head + nx * offset;
      const y = e.y - e.dashDirY * head + ny * offset;
      ctx.moveTo(x, y);
      ctx.lineTo(x - e.dashDirX * length, y - e.dashDirY * length);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 1) 简单光晕：低透明圆 + 模糊，压在星体后面（别太亮，否则像一团球）
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 2) 残影：e.trail 里是移动前的位置，越早越淡
  for (let i = trail.length - 1; i >= 0; i--) {
    const t = trail[i];
    ctx.save();
    ctx.translate(t.x, t.y);
    riftStarPath(ctx, e.r, rotation - i * 0.12);
    ctx.globalAlpha = cfg.trailAlpha * (1 - i / trail.length)
      * (e.dashState === 'dash' ? 0.18 : e.dashState === 'recover' ? dashFade * 0.18 : 1);
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  // 3) 本体：极细十字飞镖，前摇时跟随蓄力进度柔和呼吸
  const flash = e.dashState === 'windup'
    ? 0.65 + 0.2 * Math.sin(e.dashTimer / cfg.dashWarn * Math.PI * 2)
    : 1;

  ctx.translate(e.x, e.y);
  riftStarPath(ctx, e.r, rotation);
  ctx.globalAlpha = 0.25 * flash;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = flash;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

/** 画一个正多边形路径（以当前原点为中心）。 */
function polygonPath(ctx, r, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (Math.PI * 2 / sides) * i;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 画一个上下尖、左右窄的菱形路径（冰碑本体用）。 */
function diamondPath(ctx, halfW, halfH) {
  ctx.beginPath();
  ctx.moveTo(0, -halfH);
  ctx.lineTo(halfW, 0);
  ctx.lineTo(0, halfH);
  ctx.lineTo(-halfW, 0);
  ctx.closePath();
}

/**
 * 霜环裁决者：竖向菱形冰碑 + 断开的霜环。
 * 与四芒星 / 六边形熔炉 / 椭圆虚空 / 八边形终焉区分：
 * 本体是"碑"，外圈是带断口的环，冰弹瞄准线从碑尖伸出。
 */
function drawFrostBoss(e) {
  const ctx = getCtx();
  const cfg = BOSS.FROST;
  const color = cfg.color;
  const r = e.r;
  const verdict = (e.frostRingPause || 0) > 0; // 断环裁决动作中
  const charging = (e.iceWind || 0) > 0;       // 冰弹定格瞄准中
  const progress = charging ? 1 - e.iceWind / cfg.iceShotWarn : 0;
  const pulse = 0.5 + 0.5 * Math.sin(G.time * (verdict ? 9 : 3));

  ctx.save();
  ctx.translate(e.x, e.y);

  // 本体减速边界：淡冰蓝填充与细线，实际半径与判定一致。
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, cfg.playerAura, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 冰弹瞄准：只留枪口短光，18→26px 随蓄力拉长，不做长引导线。
  if (charging) {
    const count = e.hp / e.max < 0.6 ? cfg.iceShotPhase2Count : cfg.iceShotCount;
    const len = 18 + progress * 8;
    ctx.save();
    ctx.rotate(e.iceAim);
    ctx.strokeStyle = '#c9f4ff';
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.10 + progress * 0.18;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * cfg.iceShotSpread;
      const x0 = r * 1.2;
      const y0 = (i - (count - 1) / 2) * 4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + len, y0 + Math.tan(offset) * len);
      ctx.stroke();
    }
    // 碑尖聚起的冷光点
    ctx.globalAlpha = 0.35 + progress * 0.55;
    ctx.fillStyle = '#eafdff';
    ctx.beginPath();
    ctx.arc(r * 1.15, 0, 1.5 + progress * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 断开的霜环：两段弧 + 四枚冰晶钉，平时慢转，裁决时转快。
  const spin = G.time * (verdict ? 0.9 : 0.22);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.45 + 0.25 * pulse;
  for (let i = 0; i < 2; i++) {
    const start = spin + i * Math.PI + 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.62, start, start + Math.PI - 0.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = -spin * 1.3 + i * Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5);
    ctx.lineTo(Math.cos(a) * r * 1.8, Math.sin(a) * r * 1.8);
    ctx.stroke();
  }

  // 冰碑本体：竖向拉长的菱形，上下尖端让轮廓一眼区别于其他 Boss。
  const bob = Math.sin(G.time * 1.6) * 1.6;
  ctx.translate(0, bob);
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#0b2233';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  diamondPath(ctx, r * 0.62, r * 1.45);
  ctx.fill();
  ctx.stroke();

  // 内芯：裁决蓄力时更亮，直接当"要出大招了"的体表信号。
  ctx.globalAlpha = 0.3 + 0.3 * pulse + (verdict ? 0.25 : 0);
  ctx.fillStyle = color;
  diamondPath(ctx, r * 0.34, r * 0.92);
  ctx.fill();

  // 碑面中缝与中心冰核
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#eafdff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.45);
  ctx.lineTo(0, r * 1.45);
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#eafdff';
  ctx.beginPath();
  ctx.arc(0, 0, r * (verdict ? 0.2 : 0.14) + pulse * 1.2, 0, Math.PI * 2);
  ctx.fill();

  // 左右浮冰翼：斜向下的两片薄冰，给"碑"一点横向体积。
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#123b52';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.5, -r * 0.35);
    ctx.lineTo(side * r * 1.05, r * 0.15);
    ctx.lineTo(side * r * 0.55, r * 0.85);
    ctx.lineTo(side * r * 0.38, r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

/** 熔核巨像：分离装甲围绕悬浮熔炉，喷发暴露时肩甲张开。 */
function drawMoltenBoss(e) {
  const ctx = getCtx();
  const exposed = e.armorExposed > 0;
  const r = e.r;
  const open = exposed ? 5 : 0;
  const breath = 0.5 + 0.5 * Math.sin(G.time * 3.5);
  ctx.save();
  ctx.translate(e.x, e.y);
  // 悬浮阴影与低亮炉膛：视觉重心留给中间熔核。
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#020308';
  ctx.beginPath();ctx.ellipse(0, r * 1.8, r * 1.5, r * 0.35, 0, 0, Math.PI * 2);ctx.fill();
  ctx.translate(0, Math.sin(G.time * 1.8) * 1.5);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#26161a';ctx.strokeStyle = '#a74a2b';ctx.lineWidth = 1.5;
  polygonPath(ctx, r * 1.22, 6, Math.PI / 6);ctx.fill();ctx.stroke();
  // 左右厚重肩甲有折面和偏转，轮廓不再是呆板的整块正方形。
  for (const side of [-1, 1]) {
    ctx.save();ctx.scale(side, 1);ctx.translate(open, -open * 0.25);
    ctx.rotate(-0.08 - open * 0.015);
    ctx.beginPath();
    ctx.moveTo(r * 0.58, -r * 1.05);ctx.lineTo(r * 1.15, -r * 1.6);
    ctx.lineTo(r * 1.8, -r * 0.9);ctx.lineTo(r * 1.6, r * 0.45);
    ctx.lineTo(r * 1.05, r * 0.95);ctx.lineTo(r * 0.7, r * 0.25);ctx.closePath();
    ctx.fillStyle = '#372023';ctx.strokeStyle = exposed ? '#ffb35b' : '#c45b30';
    ctx.shadowColor = '#f97424';ctx.shadowBlur = exposed ? 10 : 3;
    ctx.globalAlpha = 0.95;ctx.lineWidth = 1.8;ctx.fill();ctx.stroke();
    ctx.shadowBlur = 0;ctx.fillStyle = '#663021';ctx.globalAlpha = 0.7;
    ctx.beginPath();ctx.moveTo(r * 1.15, -r * 1.6);ctx.lineTo(r * 1.8, -r * 0.9);
    ctx.lineTo(r * 1.38, -r * 0.65);ctx.lineTo(r * 0.58, -r * 1.05);ctx.closePath();ctx.fill();
    ctx.strokeStyle = exposed ? '#fff1c9' : '#f47732';ctx.lineWidth = exposed ? 2 : 1;
    ctx.beginPath();ctx.moveTo(r * 1.35, -r * 0.4);ctx.lineTo(r * 1.1, -r * 0.1);
    ctx.lineTo(r * 1.35, r * 0.3);ctx.stroke();ctx.restore();
  }
  // 上下悬浮护片，暴露时留出更宽的炉口。
  ctx.globalAlpha = 0.9;ctx.fillStyle = '#432026';ctx.strokeStyle = '#db682e';ctx.lineWidth = 1.5;
  for (const side of [-1, 1]) {
    ctx.beginPath();ctx.moveTo(-r * 0.65, side * (r * 0.95 + open));
    ctx.lineTo(0, side * (r * 1.5 + open));ctx.lineTo(r * 0.65, side * (r * 0.95 + open));
    ctx.lineTo(0, side * (r * 0.75 + open));ctx.closePath();ctx.fill();ctx.stroke();
  }
  // 熔核跳动与白热裂纹直接表达两秒的脆弱窗口。
  ctx.globalAlpha = exposed ? 0.95 : 0.7;
  ctx.fillStyle = exposed ? '#ffae41' : '#eb5e20';
  ctx.shadowColor = '#ff7228';ctx.shadowBlur = exposed ? 18 : 8;
  polygonPath(ctx, r * (exposed ? 0.78 : 0.61) + breath, 6, G.time * 0.18);ctx.fill();
  ctx.strokeStyle = exposed ? '#fff1c9' : '#ffa63f';ctx.lineWidth = exposed ? 2 : 1.2;
  ctx.beginPath();ctx.moveTo(-r * 0.42, -r * 0.25);ctx.lineTo(-r * 0.1, 0);
  ctx.lineTo(r * 0.1, -r * 0.35);ctx.moveTo(-r * 0.1, 0);ctx.lineTo(r * 0.32, r * 0.34);ctx.stroke();
  ctx.fillStyle = '#fff1c9';ctx.globalAlpha = exposed ? 0.95 : 0.55;
  ctx.beginPath();ctx.arc(0, 0, r * (exposed ? 0.18 : 0.1), 0, Math.PI * 2);ctx.fill();
  ctx.restore();
}

/** 虚空巢后：裂壳、孵化囊与短触须，动作直接表达孵化/虚空弹蓄力。 */
function drawVoidBoss(e) {
  const ctx = getCtx();
  const cfg = BOSS.VOID;
  const r = e.r;
  const summoning = e.voidAction === 'summon';
  const charging = e.voidAction === 'orb';
  const progress = summoning ? Math.min(1, e.voidActionTime / cfg.spawnWarn)
    : charging ? Math.min(1, e.voidActionTime / cfg.orbWarn) : 0;
  const opening = (e.voidRelease || 0) / 0.35;
  const pulse = 0.5 + 0.5 * Math.sin(G.time * 3);
  ctx.save();
  ctx.translate(e.x, e.y);
  // 引力弧线只在边缘淡淡显现，不遮挡穿行子弹。
  ctx.globalAlpha = 0.09;
  ctx.strokeStyle = cfg.color; ctx.lineWidth = 1;
  for (let i = 0; i < 2; i++) {
    const angle = G.time * 0.25 + i * Math.PI;
    ctx.beginPath();ctx.arc(0, 0, cfg.attractRadius, angle, angle + 0.55);ctx.stroke();
  }
  // 三根短触须向后摆动，和甲壳分层，形成生物轮廓。
  ctx.globalAlpha = 0.7;ctx.strokeStyle = '#743eac';ctx.lineWidth = 2;
  for (let i = -1; i <= 1; i++) {
    const sway = Math.sin(G.time * 2.4 + i) * 4;
    ctx.beginPath();ctx.moveTo(i * r * 0.55, r * 0.6);
    ctx.bezierCurveTo(i * r * 0.8, r * 1.4, i * r * 0.6 + sway, r * 1.7,
      i * r * 0.95 + sway, r * 2.05);ctx.stroke();
  }
  // 深紫核心：孵化时鼓动，释放时白紫内核短暂明亮。
  ctx.globalAlpha = 0.95;ctx.fillStyle = '#170c2a';ctx.strokeStyle = '#bd79ff';
  ctx.shadowColor = cfg.color;ctx.shadowBlur = 10;ctx.lineWidth = 1.5;
  ctx.beginPath();ctx.ellipse(0, 0, r * 0.95, r * 1.15, 0, 0, Math.PI * 2);ctx.fill();ctx.stroke();
  ctx.fillStyle = opening > 0 ? '#e9caff' : '#8743c6';
  ctx.globalAlpha = 0.6 + pulse * 0.15;
  ctx.beginPath();ctx.ellipse(0, -r * 0.1, r * (0.3 + opening * 0.12),
    r * (0.6 + pulse * 0.08), 0, 0, Math.PI * 2);ctx.fill();
  // 两片弧形裂壳，孵化囊挂在壳外；释放时向两侧打开。
  for (const side of [-1, 1]) {
    ctx.save();ctx.scale(side, 1);ctx.translate(opening * 5, -opening * 2);
    ctx.globalAlpha = 0.95;ctx.fillStyle = '#271638';ctx.strokeStyle = '#9955d3';
    ctx.lineWidth = 1.8;ctx.shadowBlur = 4;
    ctx.beginPath();ctx.moveTo(r * 0.2, -r * 1.35);
    ctx.bezierCurveTo(r * 1.2, -r * 1.8, r * 1.85, -r * 0.7, r * 1.4, r * 0.75);
    ctx.lineTo(r * 0.78, r * 1.15);
    ctx.bezierCurveTo(r * 1.12, r * 0.1, r * 0.95, -r * 0.8, r * 0.2, -r * 1.35);
    ctx.closePath();ctx.fill();ctx.stroke();
    const sac = 1 + (summoning ? progress * 0.35 : pulse * 0.035);
    ctx.fillStyle = summoning ? '#68318d' : '#311640';
    ctx.strokeStyle = summoning ? '#e0a0ff' : '#aa62cf';ctx.lineWidth = 1.3;
    ctx.beginPath();ctx.ellipse(r * 1.45, r * 0.2, r * 0.45 * sac,
      r * 0.62 * sac, -0.25, 0, Math.PI * 2);ctx.fill();ctx.stroke();
    ctx.strokeStyle = '#cc85f0';ctx.globalAlpha = summoning ? 0.9 : 0.4;
    ctx.beginPath();ctx.moveTo(r * 1.3, -r * 0.03);ctx.lineTo(r * 1.6, r * 0.4);ctx.stroke();
    if (summoning) {
      ctx.globalAlpha = 0.25 + progress * 0.35;ctx.setLineDash([3, 4]);
      ctx.beginPath();ctx.arc(34, 8, 12 + progress * 3, 0, Math.PI * 2);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.restore();
  }
  if (charging) {
    // 两颗能量点与短方向轨迹：预告弹丸起手朝向，保持低亮度。
    ctx.save();ctx.rotate(e.voidAim);
    ctx.globalAlpha = 0.25 + progress * 0.35;ctx.strokeStyle = '#d48aff';ctx.lineWidth = 1.2;
    for (const offset of [-0.18, 0.18]) {
      ctx.save();ctx.rotate(offset);ctx.beginPath();ctx.moveTo(r * 1.5, 0);ctx.lineTo(r * 4, 0);ctx.stroke();
      ctx.fillStyle = '#e9caff';ctx.beginPath();ctx.arc(r * 1.5, 0, 2 + progress * 2, 0, Math.PI * 2);ctx.fill();ctx.restore();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** 终焉审判：白色正八边形，边缘红线高频闪烁。 */
function drawFinalBoss(e) {
  const ctx = getCtx();
  const cfg = BOSS.FINAL;
  const white = cfg.color;
  const red = cfg.edgeColor;
  const rotation = G.time * 0.12;

  ctx.save();
  ctx.translate(e.x, e.y);

  // 白色冷光
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = white;
  ctx.shadowColor = white;
  ctx.shadowBlur = 26;
  ctx.beginPath();
  ctx.arc(0, 0, e.r * 2, 0, Math.PI * 2);
  ctx.fill();

  // 八边形主体
  polygonPath(ctx, e.r * 1.35, 8, rotation);
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = white;
  ctx.fill();

  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = white;
  ctx.shadowColor = white;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // 外面再套一圈红色警示边，闪烁代表“审判倒计时”
  const blink = 0.35 + 0.55 * Math.abs(Math.sin(G.time * 9));
  ctx.globalAlpha = blink;
  ctx.strokeStyle = red;
  ctx.shadowColor = red;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 1.8;
  polygonPath(ctx, e.r * 1.58, 8, -rotation * 0.7);
  ctx.stroke();

  // 内层白线：让八边形不是一块平涂
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = white;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 1;
  polygonPath(ctx, e.r * 0.95, 8, rotation);
  ctx.stroke();

  ctx.restore();
}
