// player.js —— 玩家输入、移动、受伤、拾取、生命汲取
// 从 systems.js 原样搬出，只改导出方式。
import {
  PLAYER,
  CANVAS,
  ARENA,
  LIMITS,
  ENEMY,
  SPAWN,
  SHOT,
  ROOM,
  BOSS,
  UPGRADE,
  WEAPON,
  HOSTILE,
  REWARD,
  RELIC_DEFS,
  RELIC_MAX,
  COLORS,
  ENCHANT,
  TEXT,
  SHAKE,
  LIGHTNING_FX,
  FISSION_FX,
  PICKUP,
} from '../config.js';
import { G } from './state.js';
import { sfxHurt } from './audio.js';
import { bossArchetypeIndex } from './boss.js';
import { spawnCombatText } from './combat.js';

/* ---------------- 输入状态 ---------------- */

// 当前按着哪些键。true = 按着，false = 松开。
// render 和 main 只读它，修改只走 setKey / clearInput。
export const input = {
  up: false,
  down: false,
  left: false,
  right: false,
  dash: false,
};

/** 按 id 找遗物定义；找不到返回 null。 */
export function relicDef(id) {
  return RELIC_DEFS.find((def) => def.id === id) || null;
}

/**
 * 当前"已装备"的遗物等级：槽位里没有这个 id 就返回 0（不生效）。
 * 等级只从 p.relicLevels 读，槽位只决定"装没装"。
 */
export function relicLevel(id) {
  const p = G.p;
  if (!p.relicSlots.includes(id)) return 0;
  return p.relicLevels[id] || 1;
}

/**
 * 玩家受伤的唯一新入口：无敌帧内直接忽略，否则固定扣 20。
 * 自爆蛛、精英自爆等新机制都走这里，避免各写一份漏掉计数。
 * @returns {boolean} 是否真的扣血
 */
export function hurtPlayer() {
  const p = G.p;

  // 沙盒模式：伤害判定照常发生（子弹会消失、自爆会触发），但血量永远不掉
  if (G.isSandbox) return false;

  if (p.inv > 0) return false;

  p.hp -= PLAYER.hurtDamage;
  p.hits++;
  p.inv = PLAYER.hurtInv;
  p.hurtFlash = PLAYER.hurtInv;
  G.roomHurt = true;
  sfxHurt();
  return true;
}

/**
 * 在地上放一个血包。只有生命汲取 Lv3 击杀会调用。
 * 超过同屏上限就删最旧的那个，避免无界增长。
 */
export function spawnPickup(x, y) {
  G.pickups.push({
    x,
    y,
    life: PICKUP.LIFE,
    age: 0,
  });
  while (G.pickups.length > PICKUP.MAX) {
    G.pickups.shift();
  }
}

/**
 * b. 玩家：冷却倒计时、读方向、冲刺、移动、夹在场地边界内。
 * @param {number} dt 秒
 */
export function updatePlayer(dt) {
  const p = G.p;

  // 各种计时器只会往 0 掉，不会变成负数
  p.cool = Math.max(0, p.cool - dt);
  p.inv = Math.max(0, p.inv - dt);
  p.hurtFlash = Math.max(0, (p.hurtFlash || 0) - dt);
  p.dashCD = Math.max(0, p.dashCD - dt);
  p.dash = Math.max(0, p.dash - dt);

  // 方向：右减左 = 水平方向，下减上 = 垂直方向
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(dx, dy);

  // 斜着走时，把方向长度归一化，否则斜向速度会是直线的 1.41 倍
  if (len !== 0) {
    dx /= len;
    dy /= len;
  }

  // 冲刺：冷却好了 + 正按着空格 + 有移动方向，才触发
  if (input.dash && p.dashCD <= 0 && len !== 0) {
    p.dash = PLAYER.dashTime;
    p.dashCD = p.dashRate;
    p.inv = Math.max(p.inv, PLAYER.dashInv); // 冲刺期间带无敌
  }

  // 冲刺中速度乘倍率，平时就是基础速度
  let speed = p.speed * (p.dash > 0 ? PLAYER.dashMul : 1);

  // 霜环裁决者的减速领域：站在冰蓝圈里移速减半
  const frostBoss = G.enemies.find((e) => e.type === 'boss' && bossArchetypeIndex(e) === 1);
  if (
    frostBoss &&
    Math.hypot(p.x - frostBoss.x, p.y - frostBoss.y) < BOSS.MUTATION.FROST_FIELD_RADIUS
  ) {
    speed *= 1 - BOSS.MUTATION.FROST_FIELD_SLOW;
  }

  p.x += dx * speed * dt;
  p.y += dy * speed * dt;

  // 夹在屏幕边界内：左右留 MARGIN_X，上方给 HUD 让位
  p.x = Math.max(ARENA.MARGIN_X, Math.min(CANVAS.WIDTH - ARENA.MARGIN_X, p.x));
  p.y = Math.max(ARENA.MARGIN_TOP, Math.min(CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM, p.y));
}

/** 每帧推进血包：走近自动拾取、回血并飘绿字；超时消失。 */
export function updatePickups(dt) {
  const p = G.p;
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const q = G.pickups[i];
    q.life -= dt;
    q.age += dt;

    const dx = q.x - p.x;
    const dy = q.y - p.y;
    if (dx * dx + dy * dy <= PICKUP.PICK_RADIUS * PICKUP.PICK_RADIUS) {
      const healed = Math.min(PICKUP.HEAL, p.max - p.hp);
      if (healed > 0) {
        p.hp += healed;
        spawnCombatText(p.x, p.y - 24, healed, '#5ef2a0', true);
      }
      G.pickups.splice(i, 1);
      continue;
    }

    if (q.life <= 0) G.pickups.splice(i, 1);
  }
}

/**
 * 生命汲取：有效命中后按装备等级回血，1 秒窗口内最多回 12 点。
 * 窗口按"第一次命中"开始计时，过期后重新开窗；满血不存。
 */
export function applyLifesteal() {
  const p = G.p;
  const level = relicLevel('lifesteal');
  if (!level) return;

  // 窗口过期：重开一个 1 秒窗口，已回血量清零
  if (G.time - p.lifestealWindowStart > WEAPON.LIFESTEAL_WINDOW) {
    p.lifestealWindowStart = G.time;
    p.lifestealWindowHealed = 0;
  }

  // 每次命中按等级回 0.5 / 0.75 血，但窗口内总量封顶
  const actual = Math.min(
    WEAPON.LIFESTEAL[level - 1].perHit,
    WEAPON.LIFESTEAL_CAP - p.lifestealWindowHealed
  );
  if (actual <= 0) return;

  // 满血不存：只把实际缺的那部分补上，避免溢出
  const healed = Math.min(actual, p.max - p.hp);
  if (healed <= 0) return;

  p.lifestealWindowHealed += healed;
  p.hp = Math.min(p.max, p.hp + healed);
}
