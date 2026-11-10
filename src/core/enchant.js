// ============================================================
// enchant.js —— 元素附魔逻辑（火 / 冰 / 暗）
// 纯逻辑：不碰 DOM / canvas，伤害与飘字通过 hooks 回调交给 systems.js。
// 流程：子弹命中 → applyBulletEnchant 加状态、攒阈值 → 满 10 触发元素爆发；
//       每帧 updateEnchant 推进灼烧/侵蚀跳伤、冰缓冻结、黑洞吸附与伤害。
// ============================================================

import { G } from './state.js';
import {
  ENCHANT,
  COLORS,
  LIMITS,
  SHAKE,
  WEAPON,
} from '../config.js';

// systems.js 在模块顶层注入的三个回调：
// damage(e, amount, color) 统一扣血；text(...) 生成飘字；shake(px) 震屏。
// 默认给空函数，保证单独导入本模块时也不会报错。
let hooks = {
  damage() {},
  text() {},
  shake() {},
};

/**
 * 注册外部回调（systems.js 调用一次）。
 * 用合并而不是整体替换，方便以后只补其中一两个。
 * @param {{damage?:Function, text?:Function, shake?:Function}} fn
 */
export function setEnchantHooks(fn) {
  hooks = { ...hooks, ...fn };
}

/**
 * 清空附魔相关的运行时状态：主/副计数、爆发环、黑洞、震屏。
 * 重开一局、或刚选完星核时调用；不清 p.core（重开要保留玩家选过的核心）。
 */
export function resetEnchant() {
  const p = G.p;

  p.enchantCounters.primary.value = 0;
  p.enchantCounters.primary.triggers = 0;
  p.enchantCounters.secondary.value = 0;
  p.enchantCounters.secondary.triggers = 0;
  p.enchantCounters.recentEnergy = 0;

  G.bursts.length = 0;
  G.zones.length = 0;
  G.shake = 0;
  G.mixThirdReady = 0;
}

/**
 * 往 G.bursts 里放一个纯视觉的爆发环。
 * @param {number} x 中心 x
 * @param {number} y 中心 y
 * @param {number} radius 最大扩散半径
 * @param {string} color 主色
 * @param {'fire'|'ice'|'dark'} kind 爆发类型，决定碎片的画法
 */
function addBurst(x, y, radius, color, kind = 'fire') {
  G.bursts.push({
    x,
    y,
    maxR: radius,
    life: 0.35,      // 扩散环只活 0.35 秒
    maxLife: 0.35,
    color,
    kind,
  });
}

/** 对以 (x, y) 为圆心、radius 为半径内的所有活敌人造成一次伤害。 */
function damageInRadius(x, y, radius, amount, color) {
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    if (Math.hypot(e.x - x, e.y - y) <= radius) {
      hooks.damage(e, amount, color);
    }
  }
}

/**
 * 给一只敌人挂上某个元素的状态。
 * damageMul 只影响这个元素的 DOT 跳伤；durationMul 影响状态 / 黑洞时长。
 * 主附魔传 1/1，元素混合的副元素按等级传缩放值。
 */
function applyStatus(core, e, damageMul = 1, durationMul = 1) {
  if (!e || e.hp <= 0) return;

  if (core === 'fire') {
    const first = e.fireStacks <= 0;
    e.fireStacks = Math.min(ENCHANT.FIRE.MAX_STACKS, e.fireStacks + 1);
    e.fireTimer = ENCHANT.FIRE.DURATION * durationMul;
    e.fireDotMul = damageMul;
    // 第一次挂上灼烧时，下一跳从 0.45 秒后开始
    if (first) e.fireTickCD = ENCHANT.FIRE.TICK;
  } else if (core === 'ice') {
    // 冰缓：速度 ×0.74，持续时间按等级缩放
    e.chillTimer = ENCHANT.ICE.DURATION * durationMul;
    e.chillMul = ENCHANT.ICE.SLOW_MUL;
  } else if (core === 'dark') {
    const first = e.darkStacks <= 0;
    e.darkStacks = Math.min(ENCHANT.DARK.MAX_STACKS, e.darkStacks + 1);
    e.darkTimer = ENCHANT.DARK.DURATION * durationMul;
    e.darkDotMul = damageMul;
    if (first) e.darkTickCD = ENCHANT.DARK.TICK;
  }
}

/* ---------------- 元素混合：副元素 ---------------- */

/** 当前装备的元素混合等级；没装备返回 0。 */
function elementMixLevel() {
  const p = G.p;
  if (!p.relicSlots.includes('elementMix')) return 0;
  return p.relicLevels.elementMix || 1;
}

/** 按等级取元素混合的三项缩放：伤害 / 半径 / 时长。 */
function mixScale(level) {
  const cfg = WEAPON.ELEMENT_MIX;
  return {
    damageMul: cfg.DAMAGE_MUL[level - 1],
    radiusMul: cfg.RADIUS_MUL[level - 1],
    durationMul: cfg.DURATION_MUL[level - 1],
  };
}

/** 读取元素专属卡的等级；没拿过就是 0。 */
function itemLevel(id) {
  return G.p.items[id] || 0;
}

/** 专属卡每一级让半径 +15%，用乘算叠乘。 */
function itemRadiusMul(id) {
  return Math.pow(1.15, itemLevel(id));
}

/**
 * 触发一次元素爆发（主 / 副 / 第三元素共用）。
 * 缩放值让副元素的爆发更小更弱；元素专属卡在这里做加算 / 乘算。
 */
function triggerBurst(core, x, y, damageMul = 1, radiusMul = 1, durationMul = 1) {
  if (core === 'fire') {
    const radius = ENCHANT.FIRE.BURST_RADIUS * radiusMul * itemRadiusMul('fireRadius');
    const damage =
      (ENCHANT.FIRE.BURST_DAMAGE + 10 * itemLevel('firePower')) * damageMul;
    damageInRadius(x, y, radius, damage, COLORS.fire);
    addBurst(x, y, radius, COLORS.fire, 'fire');
  } else if (core === 'ice') {
    // 冰爆发：非首领冻结，首领不冻结、改吃碎冰伤害
    const radius = ENCHANT.ICE.BURST_RADIUS * radiusMul * itemRadiusMul('iceRadius');
    const freeze = (ENCHANT.ICE.FREEZE + 0.2 * itemLevel('iceFreeze')) * durationMul;
    for (const e of G.enemies) {
      if (e.hp <= 0) continue;
      if (Math.hypot(e.x - x, e.y - y) > radius) continue;
      if (e.type === 'boss') {
        hooks.damage(
          e,
          ENCHANT.ICE.BOSS_BREAK_DAMAGE * damageMul,
          COLORS.ice
        );
      } else {
        e.freezeTimer = freeze;
        e.chillTimer = ENCHANT.ICE.DURATION * durationMul;
        e.chillMul = ENCHANT.ICE.SLOW_MUL;
      }
    }
    addBurst(x, y, radius, COLORS.ice, 'ice');
  } else if (core === 'dark') {
    // 暗爆发：地面留一个黑洞，超过硬上限就删最旧的
    const radius = ENCHANT.DARK.ZONE_RADIUS * radiusMul * itemRadiusMul('darkRadius');
    const life = (ENCHANT.DARK.ZONE_LIFE + 0.2 * itemLevel('darkPower')) * durationMul;
    G.zones.push({
      x,
      y,
      r: radius,
      life,
      tick: ENCHANT.DARK.ZONE_TICK,
      damage: (ENCHANT.DARK.ZONE_DAMAGE + 2 * itemLevel('darkPower')) * damageMul,
    });
    while (G.zones.length > LIMITS.enchantZones) {
      G.zones.shift();
    }
    // 暗爆发也补一个扩散环，半径和黑洞一样，方便看清生成瞬间
    addBurst(x, y, radius, COLORS.dark, 'dark');
  }

  hooks.shake(SHAKE.BURST);
}

/**
 * 子弹命中后的附魔结算（只由子弹直接伤害调用，DOT / 爆发不再计数）。
 * 主附魔每命中 +1 计数，满 10 触发；装备元素混合时，再额外挂副元素，
 * 并按元素混合等级 16 / 12 / 8 累加副计数。
 * @param {object} enemy 被击中的敌人（可能已被这一发打死）
 * @param {number} x 命中点 x（爆发以这里为中心）
 * @param {number} y 命中点 y
 */
export function applyBulletEnchant(enemy, x, y) {
  const p = G.p;
  const core = p.core;
  if (!core) return; // 还没选核心：不计数也不触发

  // 先给活着的敌人挂上主元素状态，再算阈值
  applyStatus(core, enemy, 1, 1);

  const counter = p.enchantCounters.primary;
  counter.value++;
  if (counter.value >= ENCHANT.THRESHOLD) {
    // 满阈值立刻爆发：不管溢出多少都只触发一次，然后清零重新充能
    counter.value = 0;
    counter.triggers++;
    p.enchantCounters.recentEnergy = 1;
    triggerBurst(core, x, y, 1, 1, 1);
  }

  // 元素混合：每次主弹命中额外施加副元素，并独立累加副计数
  const mixLevel = elementMixLevel();
  const secondaryId = p.enchantState.secondaryId;
  if (mixLevel > 0 && secondaryId && secondaryId !== core) {
    const scale = mixScale(mixLevel);
    applyStatus(secondaryId, enemy, scale.damageMul, scale.durationMul);

    // 副元素触发线按元素混合等级走：16 / 12 / 8 次命中
    const mixThreshold = WEAPON.ELEMENT_MIX.THRESHOLD[mixLevel - 1];
    const secondary = p.enchantCounters.secondary;
    secondary.value++;
    if (secondary.value >= mixThreshold) {
      secondary.value = 0; // 同样的“满即爆、爆完清零”规则，避免过阈值多爆
      secondary.triggers++;
      p.enchantCounters.recentEnergy = 1;
      triggerBurst(
        secondaryId,
        x,
        y,
        scale.damageMul,
        scale.radiusMul,
        scale.durationMul
      );

      // Lv3：触发副元素时，30% 概率再引爆“第三种未装备元素”，0.5s 内部 CD
      if (mixLevel >= 3 && G.time >= (G.mixThirdReady || 0)) {
        if (Math.random() < WEAPON.ELEMENT_MIX.THIRD_CHANCE) {
          const third = ENCHANT.CORES.find(
            (c) => c.id !== core && c.id !== secondaryId
          );
          if (third) {
            G.mixThirdReady = G.time + WEAPON.ELEMENT_MIX.THIRD_CD;
            triggerBurst(third.id, x, y, 1, 1, 1);
          }
        }
      }
    }
  }
}

/** 灼烧：每 0.45 秒跳一次，层数越高越疼；状态到期层数清零。 */
function updateFire(e, dt) {
  if (e.fireTimer <= 0) return;

  e.fireTimer -= dt;
  if (e.fireTimer <= 0) {
    // 状态结束：层数和跳伤计时一起清零
    e.fireStacks = 0;
    e.fireTickCD = 0;
    return;
  }

  e.fireTickCD -= dt;
  if (e.fireTickCD <= 0) {
    e.fireTickCD += ENCHANT.FIRE.TICK;
    const amount =
      (ENCHANT.FIRE.DOT +
        (e.fireStacks - 1) * ENCHANT.FIRE.PER_STACK +
        itemLevel('firePower')) *
      (e.fireDotMul || 1);
    hooks.damage(e, amount, COLORS.fire);
  }
}

/** 侵蚀：和灼烧同构，间隔 0.65 秒，紫字。 */
function updateDark(e, dt) {
  if (e.darkTimer <= 0) return;

  e.darkTimer -= dt;
  if (e.darkTimer <= 0) {
    e.darkStacks = 0;
    e.darkTickCD = 0;
    return;
  }

  e.darkTickCD -= dt;
  if (e.darkTickCD <= 0) {
    e.darkTickCD += ENCHANT.DARK.TICK;
    const amount =
      (ENCHANT.DARK.DOT + (e.darkStacks - 1) * ENCHANT.DARK.PER_STACK) *
      (e.darkDotMul || 1);
    hooks.damage(e, amount, COLORS.dark);
  }
}

/** 冰缓 / 冻结的计时：冰缓结束恢复速度，冻结结束自然解冻。 */
function updateIce(e, dt) {
  if (e.chillTimer > 0) {
    e.chillTimer -= dt;
    if (e.chillTimer <= 0) e.chillMul = 1;
  }
  if (e.freezeTimer > 0) {
    e.freezeTimer = Math.max(0, e.freezeTimer - dt);
  }
}

/** 黑洞：吸怪 + 每 0.4 秒伤害一次，寿命到就删除。 */
function updateZones(dt) {
  for (let i = G.zones.length - 1; i >= 0; i--) {
    const z = G.zones[i];

    z.life -= dt;
    z.tick -= dt;

    // 吸：半径内的非首领敌人每秒朝中心靠 40px（不会越过中心）
    for (const e of G.enemies) {
      if (e.hp <= 0 || e.type === 'boss') continue;
      const dx = z.x - e.x;
      const dy = z.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0 || dist > z.r) continue;
      const step = Math.min(ENCHANT.DARK.PULL * dt, dist);
      e.x += (dx / dist) * step;
      e.y += (dy / dist) * step;
    }

    // 每 0.4 秒对半径内所有活敌人造成一次伤害
    if (z.tick <= 0) {
      z.tick += ENCHANT.DARK.ZONE_TICK;
      damageInRadius(
        z.x,
        z.y,
        z.r,
        z.damage ?? ENCHANT.DARK.ZONE_DAMAGE,
        COLORS.dark
      );
    }

    if (z.life <= 0) G.zones.splice(i, 1);
  }
}

/**
 * 每帧推进所有附魔效果（在子弹 / 敌弹之后、清尸体之前调用）。
 * @param {number} dt 秒
 */
export function updateEnchant(dt) {
  // 敌人身上的灼烧 / 侵蚀 / 冰缓 / 冻结
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    updateFire(e, dt);
    updateDark(e, dt);
    updateIce(e, dt);
  }

  updateZones(dt);

  // 爆发扩散环只是视觉：寿命递减，画的时候按进度算半径
  for (let i = G.bursts.length - 1; i >= 0; i--) {
    G.bursts[i].life -= dt;
    if (G.bursts[i].life <= 0) G.bursts.splice(i, 1);
  }
}
