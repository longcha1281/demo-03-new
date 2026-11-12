// ============================================================
// entity.js —— 画面绘制的「entity」部分
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

import { drawBoss } from './boss_fx.js';

/**
 * 血包：绿色菱形外框 + 十字，随时间轻微呼吸（常驻，不消失）。
 * 真正的回血在 systems.js 的 updatePickups 里。
 */
export function drawPickups() {
  const ctx = getCtx();
  const color = '#5ef2a0';
  for (const q of G.pickups) {
    const pulse = 0.9 + 0.1 * Math.sin(G.time * 6 + q.x);
    const r = 7 * pulse;
    ctx.save();
    ctx.translate(q.x, q.y);
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
export function drawSparks() {
  const ctx = getCtx();
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

/** 子弹：普通弹是发光小方块；闪电形态改画随速度方向抖动的电弧。 */
export function drawShots() {
  const ctx = getCtx();
  ctx.save();
  ctx.shadowBlur = 10; // 发光的关键：模糊半径
  for (const s of G.shots) {
    const color = s.color || COLORS.shot;
    const lightning =
      s.isLightning || (s.tags && s.tags.includes('lightning'));

    if (!lightning) {
      // 普通弹：以 (s.x, s.y) 为中心画 6×6 方块
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;
      ctx.fillStyle = color;
      ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
      continue;
    }

    // 闪电弹：沿飞行方向铺 4 段折线，每一帧随机抖动，看起来像持续放电
    const angle = Math.atan2(s.vy || 0, s.vx || 0);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const normalX = -dirY;
    const normalY = dirX;
    const length = 14;
    const segments = 4;

    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      // 从弹丸后方 7px 画到前方 7px
      const along = (i / segments - 0.5) * length;
      // 首尾点不抖，避免电弧离开弹丸中心；中间点左右抖 ±2.5px
      const jitter =
        i === 0 || i === segments ? 0 : (Math.random() * 2 - 1) * 2.5;
      const px = s.x + dirX * along + normalX * jitter;
      const py = s.y + dirY * along + normalY * jitter;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 15;

    // 先画一层青色宽光，再叠亮白细线，保证在深色背景上也够刺眼
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#eaffff';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 敌方子弹：红点 + 发光；追踪弹外面再加一圈淡环。
 */
/**
 * 敌方子弹按元素标记取色：冰蓝 / 虚空紫 / 终焉金，未标记的沿用统一亮红。
 * @param {object} h 敌弹
 * @returns {string} 绘制颜色
 */
export function hostileShotColor(h) {
  if (h.element === 'frost') return '#69d7ff';
  if (h.element === 'void') return '#b06cff';
  if (h.element === 'final') return '#ffd166';
  return COLORS.hostile;
}

export function drawHostile() {
  const ctx = getCtx();
  ctx.save();
  ctx.shadowBlur = 10;

  for (const h of G.hostile) {
    // 按元素标记分色；没标记的继续用统一亮红
    const color = hostileShotColor(h);
    const radius = h.r || 3;

    // 仅高速虚空弹绘制短拖尾；沿真实历史路径截到 26px，不伸向未经过的位置。
    if (h.voidOrb && h.trail) {
      ctx.save();
      let x = h.x, y = h.y, remaining = 26;
      for (const point of h.trail) {
        const length = Math.hypot(point.x - x, point.y - y);
        if (length === 0) continue;
        const drawn = Math.min(length, remaining);
        const nextX = x + (point.x - x) * drawn / length;
        const nextY = y + (point.y - y) * drawn / length;
        const fade = remaining / 26;
        ctx.globalAlpha = 0.4 * fade;
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.lineWidth = 3 * fade;
        ctx.beginPath();ctx.moveTo(x, y);ctx.lineTo(nextX, nextY);ctx.stroke();
        ctx.globalAlpha = 0.65 * fade;
        ctx.strokeStyle = '#ffd5dd';ctx.lineWidth = fade;
        ctx.stroke();
        remaining -= drawn;
        if (remaining <= 0) break;
        x = nextX; y = nextY;
      }
      ctx.restore();
    }

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
export function drawEnemies() {
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
 * 中键锁定框：青色全息雷达框，只画给"锁定且还活着"的那只敌人。
 * 纯装饰，不影响碰撞或伤害判定。
 */
export function drawLockOn() {
  const ctx = getCtx();
  const p = G.p;
  if (p.attackTarget == null) return;

  const target = G.enemies.find((e) => e.id === p.attackTarget && e.hp > 0);
  if (!target) return;

  const R = target.r + 6;
  const color = '#39f6ff';

  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  // 四角 L 形括号：沿对角线找角点，再各伸出 8px 的横/竖臂
  const arm = 3;
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
export function drawEnemyTriangle(e, p) {
  const ctx = getCtx();
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
export function drawBomber(e) {
  const ctx = getCtx();
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

/** 分裂体：两个红色圆交叠，死亡后裂成两只小追猎。 */
export function drawSplitter(e) {
  const ctx = getCtx();
  const color = ENEMY.TYPES.splitter.color || '#ff4d6d';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = 1.5;

  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(e.x + sx * e.r * 0.42, e.y, e.r * 0.72, 0, Math.PI * 2);
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** 精英附加视觉：辅助型光圈、护盾紫圈。 */
export function drawEliteMarks(e) {
  const ctx = getCtx();
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
export function enemyStatusColor(e) {
  if (e.freezeTimer > 0) return COLORS.ice;
  if (e.fireStacks > 0 && e.fireTimer > 0) return COLORS.fire;
  if (e.chillTimer > 0) return COLORS.ice;
  if (e.darkStacks > 0 && e.darkTimer > 0) return COLORS.dark;
  return null;
}

/** 敌人身上是否带着某个元素的 Debuff。 */
export function enemyHasElement(e, id) {
  if (id === 'fire') return e.fireStacks > 0 && e.fireTimer > 0;
  if (id === 'ice') return e.freezeTimer > 0 || e.chillTimer > 0;
  if (id === 'dark') return e.darkStacks > 0 && e.darkTimer > 0;
  return false;
}

/** 按元素 id 取颜色；找不到就退回默认白色。 */
export function elementColor(id) {
  const core = ENCHANT.CORES.find((item) => item.id === id);
  return core ? core.color : '#ffffff';
}

/** 画一圈元素状态光晕；dash 有值时画虚线圈（用于副元素外环）。 */
export function drawStatusRing(e, color, radius, width, alpha, dash) {
  const ctx = getCtx();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 元素状态外圈：单元素时画一圈实线；主、副两种 Debuff 同时存在时画同心双环
 * （内圈主元素实线，外圈副元素虚线），让玩家一眼看出两种状态都在生效。
 */
export function drawEnemyStatus(e) {
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
    // 内圈主元素：粗实线，贴近怪物；外圈副元素：细实线，稍微远一点
    drawStatusRing(e, elementColor(primaryId), e.r + 3, 2, 0.85);
    drawStatusRing(e, elementColor(secondaryId), e.r + 6, 1, 0.9);
    return;
  }

  // 只有一种附魔 Debuff：只画该元素的一圈实线
  if (hasPrimary) {
    drawStatusRing(e, elementColor(primaryId), e.r + 3, 2, 0.8);
    return;
  }
  if (hasSecondary) {
    drawStatusRing(e, elementColor(secondaryId), e.r + 3, 2, 0.8);
    return;
  }

  // 没有附魔但可能被冻结 / 感电：沿用原来的优先级着色
  const color = enemyStatusColor(e);
  if (!color) return;
  drawStatusRing(e, color, e.r + 3, 2, 0.8);
}

/** 玩家：会呼吸、会转动的霓虹圆。所有尺寸都跟着 p.r 缩放。 */
export function drawPlayer() {
  const ctx = getCtx();
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
