// ============================================================
// systems.js —— 全部游戏逻辑（纯逻辑，不碰 DOM / canvas）
// 职责：读键盘状态 → 每帧推进玩家、刷怪、敌人、子弹、清房、死亡判定。
// 这里的数值全部来自 config.js，不写魔数。
// ============================================================

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
import { G, createPlayer } from './state.js';
import { sfxShoot, sfxHit, sfxKill, sfxHurt } from './audio.js';
import {
  setEnchantHooks,
  resetEnchant,
  applyBulletEnchant,
  updateEnchant,
} from './enchant.js';

// enchant.js 是纯逻辑，不能直接记分 / 生成飘字 / 震屏；
// 把本文件的统一入口注进去：子弹、灼烧、侵蚀、爆发、黑洞全走 damageEnemy。
setEnchantHooks({
  damage: damageEnemy,
  text: spawnCombatText,
  shake: addShake,
});

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

// 敌人 id 自增器：每生成一只就 +1，方便以后做"同一目标只算一次"之类的去重
let nextEnemyId = 1;

// 奖励面板回调。systems 是纯逻辑，不能碰 DOM；
// main.js 启动时通过 setRewardHook(showReward) 把 UI 函数注进来。
let rewardHook = null;

/** 注册奖励面板回调（main.js 传入 screens.showReward）。 */
export function setRewardHook(fn) {
  rewardHook = fn;
}

// 遗物装配室回调：选完卡进入 route 状态时，由 UI 弹出拖拽装配面板。
let routeHook = null;

/** 注册遗物装配室回调（main.js 传入 screens.showRoute）。 */
export function setRouteHook(fn) {
  routeHook = fn;
}

// 副元素选择面板回调：第一次拿到「元素混合」时暂停游戏，让玩家选副附魔。
let secondaryHook = null;

/** 注册副元素面板回调（main.js 传入 screens.showSecondarySelect）。 */
export function setSecondaryHook(fn) {
  secondaryHook = fn;
}

/* ---------------- 遗物：槽位 / 等级 / 获得 ---------------- */

/** 按 id 找遗物定义；找不到返回 null。 */
function relicDef(id) {
  return RELIC_DEFS.find((def) => def.id === id) || null;
}

/**
 * 当前"已装备"的遗物等级：槽位里没有这个 id 就返回 0（不生效）。
 * 等级只从 p.relicLevels 读，槽位只决定"装没装"。
 */
function relicLevel(id) {
  const p = G.p;
  if (!p.relicSlots.includes(id)) return 0;
  return p.relicLevels[id] || 1;
}

/** 找该类遗物的第一个空槽：普通 0–2，特殊只有 3。没有空槽返回 -1。 */
function freeSlotFor(kind) {
  const p = G.p;
  const start = kind === 'special' ? 3 : 0;
  const end = kind === 'special' ? 3 : 2;
  for (let i = start; i <= end; i++) {
    if (!p.relicSlots[i]) return i;
  }
  return -1;
}

/**
 * 获得一件遗物：第一次拿到时记收藏、升到 1 级、有同类空槽就装备；
 * 已经拥有则等级 +1（不超过该类别上限），不会重复占槽。
 */
function acquireRelic(id) {
  const p = G.p;
  const def = relicDef(id);
  if (!def) return;

  // 已有同 id：只升级，不重复进收藏 / 不重复装备
  if (p.relicLevels[id]) {
    const max = RELIC_MAX[def.kind];
    p.relicLevels[id] = Math.min(max, p.relicLevels[id] + 1);
    return;
  }

  p.relicCollection.push(id);
  p.relicLevels[id] = 1;

  // 嗜血：第一次拿到时从 0 层开始，避免继承旧击杀直接满层
  if (id === 'bloodthirst') {
    p.bloodthirstKills = 0;
  }

  const slot = freeSlotFor(def.kind);
  if (slot >= 0) p.relicSlots[slot] = id;

  // 元素混合：第一次拿到时先挂起，等玩家从另外两个元素里亲手选一个副附魔。
  // 真正写入 secondaryId 在 selectSecondary()；这里只打标记，避免自动随机。
  if (id === 'elementMix' && !p.enchantState.secondaryId) {
    p.enchantState.secondaryUnlocked = false;
    p.enchantState.secondaryUnlockSource = 'elementMix';
    G.pendingSecondarySelection = true;
  }
}

/**
 * 玩家在「选择副元素」面板里点了一个元素。
 * 只接受与主附魔不同的元素；写入成功后解除挂起，继续走原来的奖励流程（进装配室）。
 * @param {'fire'|'ice'|'dark'} id
 */
export function selectSecondary(id) {
  const p = G.p;
  if (!G.pendingSecondarySelection) return false;
  if (!p.core || id === p.core) return false;

  const core = ENCHANT.CORES.find((item) => item.id === id);
  if (!core) return false;

  p.enchantState.secondaryId = id;
  p.enchantState.secondaryUnlocked = true;
  p.enchantState.secondaryUnlockSource = 'elementMix';
  G.pendingSecondarySelection = false;

  // 副元素选完，奖励流程继续：进入装配室，等玩家点「继续深入」
  G.state = 'route';
  if (routeHook) routeHook();
  return true;
}

/**
 * 移动 / 卸下一件遗物（装配室拖拽用）。
 * slotIndex = null 表示卸回备选；槽位类型必须匹配，不匹配返回 false。
 * 替换时旧遗物自动回到备选（它仍留在 relicCollection 里）。
 */
export function moveRelic(id, slotIndex) {
  const p = G.p;
  const def = relicDef(id);
  if (!def || !p.relicLevels[id]) return false;

  // 先校验目标槽，类型不匹配要在"拿走旧装备"之前拒绝，保持原状
  if (slotIndex !== null) {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 3) {
      return false;
    }

    // 类型校验：普通只能进 0/1/2，特殊只能进 3
    const ordinarySlot = slotIndex < 3;
    if ((def.kind === 'ordinary') !== ordinarySlot) return false;
  }

  // 校验通过后，再把这个 id 从原来的槽位拿掉
  for (let i = 0; i < p.relicSlots.length; i++) {
    if (p.relicSlots[i] === id) p.relicSlots[i] = null;
  }

  if (slotIndex === null) {
    // 卸下时如果槽位里已经没有嗜血，层数立刻清零
    if (!p.relicSlots.includes('bloodthirst')) {
      p.bloodthirstKills = 0;
    }
    return true;
  }

  p.relicSlots[slotIndex] = id; // 原来的旧遗物已经被"挤回"备选

  // 如果槽位里已经没有了嗜血，清零层数
  if (!p.relicSlots.includes('bloodthirst')) {
    p.bloodthirstKills = 0;
  }

  return true;
}

/**
 * 装配室点「继续深入」：房号 +1、开始下一房、回到战斗。
 */
export function confirmRoute() {
  // 只有停在装配室时才推进；重复点按钮 / 误调用不会多加房
  if (G.state !== 'route') return;
  G.wave++;
  beginRoom(G.wave);
  G.state = 'play';
}

/* ---------------- 新怪物的受伤 / 爆炸结算 ---------------- */

/**
 * 玩家受伤的唯一新入口：无敌帧内直接忽略，否则固定扣 20。
 * 自爆蛛、精英自爆等新机制都走这里，避免各写一份漏掉计数。
 * @returns {boolean} 是否真的扣血
 */
function hurtPlayer() {
  const p = G.p;
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
 * 在指定位置画一个爆炸扩散环（纯视觉，不参与伤害）。
 * @param {number} x 中心 x
 * @param {number} y 中心 y
 * @param {number} radius 半径
 * @param {string} color 颜色
 */
function addExplosionVisual(x, y, radius, color) {
  // 自爆蛛可能在同一帧成片死亡；冲击波只保留最近的 64 个，防止无界增长
  if (G.bursts.length >= LIMITS.bursts) G.bursts.shift();
  G.bursts.push({
    x,
    y,
    maxR: radius,
    life: 0.35,
    maxLife: 0.35,
    color,
    kind: 'fire',
  });
}

/**
 * 范围爆炸：先画冲击波，再判断玩家是否在圈内，扣固定 20。
 * @param {number} x 中心 x
 * @param {number} y 中心 y
 * @param {number} radius 半径
 * @param {number} damage 伤害（当前规则下仍固定为 20）
 * @param {string} color 视觉颜色
 */
function explodeAt(x, y, radius, damage, color) {
  addExplosionVisual(x, y, radius, color);
  addShake(4);

  const p = G.p;
  const dist = Math.hypot(p.x - x, p.y - y);
  if (dist <= radius + p.r) hurtPlayer();

  // 自爆冲击波只会引爆范围内的其他自爆蛛（不伤害普通怪）。
  // damageEnemy 里的 e.dead 锁保证每只蛛最多结算一次死亡，所以连锁一定会在有限只数内停下。
  const bombers = G.enemies.slice();
  for (const other of bombers) {
    if (other.type !== 'bomber' || other.dead || other.exploded) continue;
    if (Math.hypot(other.x - x, other.y - y) <= radius + other.r) {
      // 被连锁炸死的蛛不会进入引信，而是在 onEnemyDeath 里立刻爆炸
      damageEnemy(other, other.hp, COLORS.enemy);
    }
  }
}

/**
 * 敌人死亡后的专属结算：自爆蛛爆炸、分裂体裂开、精英词缀生效。
 * 必须在加分/击杀数之后调用，避免分裂出来的小怪被算成本房计划。
 * @param {object} e 刚死亡的敌人
 */
function onEnemyDeath(e) {
  // 同一只怪只结算一次死亡效果，防止死亡分裂/爆炸被重复触发
  if (!e || e.deathHandled) return;
  e.deathHandled = true;

  if (e.type === 'bomber' && !e.exploded) {
    e.exploded = true;
    explodeAt(e.x, e.y, ENEMY.BOMBER.EXPLODE_RADIUS, ENEMY.BOMBER.DAMAGE, COLORS.enemy);
  }

  if (e.type === 'splitter') {
    const cfg = ENEMY.SPLITTER;
    for (let i = 0; i < cfg.CHILD_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / cfg.CHILD_COUNT + Math.random() * 0.5;
      spawnChaserChild(
        e.x + Math.cos(angle) * 10,
        e.y + Math.sin(angle) * 10,
        cfg.CHILD_HP_MUL,
        cfg.CHILD_SPEED_MUL,
        cfg.CHILD_RADIUS_MUL
      );
    }
  }

  if (e.type === 'elite') {
    // 精英必掉一个 20 血包（不管有没有生命汲取）
    spawnPickup(e.x, e.y);

    const affixes = e.eliteAffixes || [];
    if (affixes.includes('explode') && !e.exploded) {
      e.exploded = true;
      explodeAt(e.x, e.y, ENEMY.ELITE.EXPLODE_RADIUS, PLAYER.hurtDamage, COLORS.elite);
    }

    if (affixes.includes('split')) {
      for (let i = 0; i < ENEMY.ELITE.SPLIT_COUNT; i++) {
        const angle = (Math.PI * 2 * i) / ENEMY.ELITE.SPLIT_COUNT;
        spawnChaserChild(e.x + Math.cos(angle) * 12, e.y + Math.sin(angle) * 12, 1, 1, 1);
      }
    }
  }
}

/* ---------------- 统一伤害入口 / 反馈 ---------------- */

/**
 * 所有伤害都从这里进：子弹直伤、灼烧、侵蚀、元素爆发、黑洞。
 * 负责扣血、生成飘字，并在"这一下把敌人打死"时结算击杀 / 得分 / 音效 / 首领标记。
 * 已经是尸体的敌人直接忽略，天然防止同一帧重复记分。
 * @param {object} e 敌人
 * @param {number} amount 伤害
 * @param {string} color 飘字颜色
 */
function damageEnemy(e, amount, color) {
  // e.dead 是“死亡效果已经结算过”的锁；hp<=0 的尸体也不再吃任何伤害
  if (!e || e.hp <= 0 || e.dead) return;

  // 攻城兽的力场护盾：只要还有盾，本体一点血都不掉。
  // 伤害先扣盾，盾破的那一下开始计时 4 秒，之后才能重新套盾。
  if (e.type === 'boss' && e.shield > 0) {
    const absorbed = Math.min(e.shield, amount);
    e.shield -= absorbed;
    spawnCombatText(e.x, e.y - e.r - 12, absorbed, COLORS.boss);
    if (e.shield <= 0) {
      e.shield = 0;
      e.shieldCd = BOSS.SKILL.SHIELD_CD;

      // 第 3 轮攻城兽质变：破盾瞬间向四周打 20 发环形弹
      if (e.bossRound >= 3 && bossArchetypeIndex(e) === 2) {
        spawnSiegeBreakVolley(e);
      }

      addShake(4);
    }
    return;
  }

  // 精英的词缀护盾：和 Boss 一样先扣盾，盾破那一下开始 4 秒冷却
  if (e.type === 'elite' && e.eliteShield > 0) {
    const absorbed = Math.min(e.eliteShield, amount);
    e.eliteShield -= absorbed;
    spawnCombatText(e.x, e.y - e.r - 12, absorbed, COLORS.elite);
    if (e.eliteShield <= 0) {
      e.eliteShield = 0;
      e.eliteShieldCd = ENEMY.ELITE.SHIELD_CD;
      addShake(3);
    }
    return;
  }

  e.hp -= amount;
  spawnCombatText(e.x, e.y - e.r - 4, amount, color);

  if (e.hp > 0) return;

  // 先上死亡锁，再结算击杀与死亡效果；即使死亡效果里又碰到这只怪也不会重复
  e.dead = true;

  // 击杀结算：击杀数 / 得分 / 爆炸音效
  G.kills++;
  G.p.bloodthirstKills++; // 嗜血按击杀数提高攻速
  const typeCfg = ENEMY.TYPES[e.type];
  G.score += typeCfg ? typeCfg.score : 0;
  sfxKill();

  // 生命汲取 Lv3：击杀有 15% 概率掉一个血包
  if (relicLevel('lifesteal') >= 3 && Math.random() < PICKUP.DROP_CHANCE) {
    spawnPickup(e.x, e.y);
  }

  // 首领死亡：标记本房已击败，update 里会立刻打开遗物面板
  if (e.type === 'boss') {
    G.bossDefeatedThisRoom = true;
    G.bossesCleared++;

    // 主人死了，召唤物一起退场（下一帧 updateEnemies 会把它们标成 0 血）
    for (const m of G.enemies) {
      if (m.isBossMinion && m.bossOwnerId === e.id) m.minionLife = 0;
    }
  }

  // 自爆蛛 / 分裂体 / 精英词缀的死亡效果
  onEnemyDeath(e);
}

/**
 * 生成一条伤害飘字；超过硬上限就删最旧的一条。
 * @param {number} x 起点 x
 * @param {number} y 起点 y
 * @param {number} amount 伤害值（画的时候再取整 / 保留一位小数）
 * @param {string} color 颜色
 */
function spawnCombatText(x, y, amount, color, heal = false) {
  if (amount <= 0) return;

  G.combatTexts.push({
    x,
    y,
    amount,
    color,
    heal, // 治疗数字画成 +N，和伤害区分开
    life: TEXT.TTL,
  });

  while (G.combatTexts.length > LIMITS.combatTexts) {
    G.combatTexts.shift();
  }
}

/**
 * 在地上放一个血包。只有生命汲取 Lv3 击杀会调用。
 * 超过同屏上限就删最旧的那个，避免无界增长。
 */
function spawnPickup(x, y) {
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

/** 每帧推进血包：走近自动拾取、回血并飘绿字；超时消失。 */
function updatePickups(dt) {
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

/** 叠加震屏：取更大的那个，不会越叠越猛。 */
function addShake(px) {
  G.shake = Math.max(G.shake, px);
}

/** 每帧推进飘字：往上飘、寿命递减，到点删除（绘制只读数据）。 */
function updateCombatTexts(dt) {
  for (let i = G.combatTexts.length - 1; i >= 0; i--) {
    const t = G.combatTexts[i];
    t.life -= dt;
    t.y -= TEXT.RISE * dt;
    if (t.life <= 0) G.combatTexts.splice(i, 1);
  }
}

/**
 * 开局选完星核：写入主附魔，清空附魔计数 / 地面效果，
 * 然后弹出「初始遗物三选一」；选完才真正进入第 1 房。
 * 由 main.js 通过 setCoreHook 注入的界面回调调用。
 * @param {'fire'|'ice'|'dark'} id
 */
export function selectCore(id) {
  const core = ENCHANT.CORES.find((c) => c.id === id);
  if (!core) return;

  const p = G.p;
  p.core = id;
  p.enchantState.primaryId = id;
  p.enchantState.runtimeCoreId = id;

  resetEnchant(); // 计数、爆发环、黑洞、震屏全部归零

  // 开局不直接开打：先让玩家从 3 件未拥有的普通遗物里选 1 件
  openReward('starter');
}

/* ---------------- 输入 ---------------- */

/**
 * 把浏览器键盘事件翻译成游戏输入。
 * @param {string} code KeyboardEvent.code，例如 'KeyW' / 'Space'
 * @param {boolean} down true = 按下，false = 松开
 */
export function setKey(code, down) {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      input.up = down;
      break;
    case 'KeyS':
    case 'ArrowDown':
      input.down = down;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      input.left = down;
      break;
    case 'KeyD':
    case 'ArrowRight':
      input.right = down;
      break;
    case 'Space':
      input.dash = down;
      break;
  }

  // R 键只在死亡界面有效：按下瞬间重开一局
  if (code === 'KeyR' && down && G.state === 'dead') {
    restartRun();
  }
}

/** 松开所有键。切窗口（blur）时调用，防止"回来还在往一个方向走"。 */
export function clearInput() {
  input.up = false;
  input.down = false;
  input.left = false;
  input.right = false;
  input.dash = false;
}

/**
 * 暂停 / 继续。只在 play ↔ paused 之间切换，别的状态（死亡等）返回 null 且不改。
 * 这里只管游戏状态；屏幕上的暂停遮罩由 main.js 的 syncPauseUI() 同步显示。
 * @returns {'paused'|'play'|null} 切换后的状态；null = 本次没有切换
 */
export function togglePause() {
  if (G.state === 'play') {
    G.state = 'paused';
    return 'paused';
  }
  if (G.state === 'paused') {
    G.state = 'play';
    return 'play';
  }
  return null;
}

/* ---------------- 房间数值计算 ---------------- */

/**
 * 本房的"成长档位"：第 1 房是 0，之后每房 +1，封顶 HP_GROWTH_CAP_WAVE。
 * 血量、速度的成长都按它算，保证第 25 房之后数值不再膨胀。
 * @param {number} wave 第几房
 */
function growth(wave) {
  return Math.min(ENEMY.HP_GROWTH_CAP_WAVE, wave - 1);
}

/**
 * 本房要生成多少只普通怪。
 * 第 1、2 房是固定数，之后按 9 + 1.6×wave 增长，封顶 COUNT_CAP。
 * @param {number} wave 第几房
 */
function roomEnemyCount(wave) {
  if (wave === 1) return SPAWN.ROOM1_COUNT;
  if (wave === 2) return SPAWN.ROOM2_COUNT;
  return Math.round(
    Math.min(SPAWN.COUNT_CAP, SPAWN.COUNT_BASE + SPAWN.COUNT_PER_WAVE * wave)
  );
}

/**
 * 本房的刷怪间隔（秒）。第 1、2 房固定，之后越来越快，最快 INTERVAL_MIN。
 * @param {number} wave 第几房
 */
function roomSpawnInterval(wave) {
  if (wave === 1) return SPAWN.ROOM1_INTERVAL;
  if (wave === 2) return SPAWN.ROOM2_INTERVAL;
  return Math.max(
    SPAWN.INTERVAL_MIN,
    SPAWN.INTERVAL_BASE - SPAWN.INTERVAL_PER_WAVE * wave
  );
}

/**
 * 生成本房怪物的类型序列（每个位置一只）。
 * 用一次 0–1 的随机数落在哪个区间来决定类型；
 * 射手只有第 SHOOTER_FROM_WAVE 房起才会出现。
 * @param {number} wave 第几房
 * @returns {string[]} 类型数组，例如 ['chaser', 'tank', 'runner']
 */
function buildRoomPlan(wave) {
  const count = roomEnemyCount(wave);
  const plan = [];

  for (let i = 0; i < count; i++) {
    const roll = Math.random();

    // 1–5 房：只有追猎者，先让玩家熟悉走位和自动射击
    if (wave <= SPAWN.CHASER_UNTIL_WAVE) {
      plan.push('chaser');
    } else if (wave <= 9) {
      // 6–9 房：加入射手和分裂体
      if (roll < SPAWN.MID_ROLL_SHOOTER) plan.push('chaser');
      else if (roll < SPAWN.MID_ROLL_SPLITTER) plan.push('shooter');
      else plan.push('splitter');
    } else {
      // 10 房起：自爆蛛加入，占比明显变大
      if (roll < SPAWN.LATE_ROLL_CHASER) plan.push('chaser');
      else if (roll < SPAWN.LATE_ROLL_SHOOTER) plan.push('shooter');
      else if (roll < SPAWN.LATE_ROLL_SPLITTER) plan.push('splitter');
      else plan.push('bomber');
    }
  }

  return plan;
}

/**
 * 按类型和房间数算出这只怪的实际数值。
 * 普通四类：血量按房成长、速度按房成长但有上限、半径用普通体型；
 * 精英：血量用精英专属公式（封顶），体型更大。
 * @param {string} type 敌人类型
 * @param {number} wave 第几房
 */
function enemyStats(type, wave) {
  const base = ENEMY.TYPES[type];
  const g = growth(wave);

  // 移速：基础值 + 每房成长，封顶 SPEED_CAP
  const speed = Math.min(
    ENEMY.SPEED_CAP,
    base.speed + ENEMY.SPEED_GROWTH_PER_WAVE * g
  );

  if (type === 'elite') {
    return {
      hp: Math.min(
        ENEMY.ELITE_HP_CAP,
        ENEMY.ELITE_HP_BASE + ENEMY.ELITE_HP_PER_GROWTH * g
      ),
      speed,
      r: ENEMY.RADIUS.elite,
    };
  }

  return {
    hp: base.hp + ENEMY.HP_GROWTH_PER_WAVE * g,
    speed,
    r: ENEMY.RADIUS.normal,
  };
}

/* ---------------- 房间开始 / 结束 ---------------- */

/**
 * 开始一房：清场、生成本房刷怪计划、重置首领状态与入场倒计时。
 * 首领房（wave % 3 === 0）开局有 3 秒倒计时，倒计时期间普通怪照常刷。
 * @param {number} wave 要开始的房号
 */
function beginRoom(wave) {
  G.wave = wave;

  // 新房从头开始：上一房留下的敌人、玩家子弹、敌弹全部清掉
  G.enemies.length = 0;
  G.shots.length = 0;
  G.hostile.length = 0;

  // 元素特效同样不能跨房：上一房的黑洞、爆发环、伤害跳字、震屏全部归零
  G.zones.length = 0;
  G.bursts.length = 0;
  G.lightningArcs.length = 0;
  G.bossHazards.length = 0;
  G.bossGhosts.length = 0;
  G.pickups.length = 0;
  G.combatTexts.length = 0;
  G.shake = 0;

  // 附魔阈值是「本房内」的进度：换房后主、副计数都从 0 重新攒，
  // 否则上一房攒到 9 点，进新房第一枪就白送一次爆发。
  const counters = G.p.enchantCounters;
  counters.primary.value = 0;
  counters.primary.triggers = 0;
  counters.secondary.value = 0;
  counters.secondary.triggers = 0;
  counters.recentEnergy = 0;

  // 旧房间的锁定目标已经不在场上了，进新房一律清掉
  G.p.attackTarget = null;
  G.lightningCD = 0; // 闪电链接的冷却跨房清零，避免开局第一发打不出链

  const plan = buildRoomPlan(wave);
  G.roomSpawnPlan = plan;
  G.roomSpawnIndex = 0;
  G.left = plan.length;
  G.spawn = roomSpawnInterval(wave);

  // 新房重新开始算"无伤"
  G.roomHurt = false;

  // 首领房：重置三个"本房首领"标记并设倒计时；普通房倒计时就是 0
  const isBossRoom = wave % ROOM.PER_ROUND === 0;
  G.bossSpawnedThisRoom = false;
  G.bossDefeatedThisRoom = false;
  G.bossRewardClaimed = false;
  G.bossCountdownRemaining = isBossRoom ? ROOM.BOSS_COUNTDOWN : 0;

  // 精英随房数增加总数：10–19 房 1 只，20 房起 2 只，9 房以前不刷。
  let eliteCount = 0;
  if (wave >= ENEMY.ELITE_TWO_FROM_WAVE) eliteCount = 2;
  else if (wave >= ENEMY.ELITE_FROM_WAVE) eliteCount = 1;
  for (let i = 0; i < eliteCount; i++) {
    spawnEnemy('elite');
  }

  // 进房提示：普通房报本房怪数，首领房报入场倒计时
  if (isBossRoom) {
    G.notice.text = '第 ' + wave + ' 房 · 首领房';
    G.notice.sub = '首领 ' + ROOM.BOSS_COUNTDOWN + ' 秒后入场';
  } else {
    G.notice.text = '第 ' + wave + ' 房';
    G.notice.sub = '本房 ' + plan.length + ' 只敌人';
  }
  G.notice.timer = ROOM.NOTICE_TIME;
}

/**
 * 本房结算：回血、得分（含无伤奖励）、清房提示，然后打开奖励面板。
 * 这里不再 wave++：等玩家选完卡，由 pickReward 推进到下一房。
 * @param {'stat'|'relic'} kind 普通房三选一 / 首领房四选一
 */
function finishRoom(kind) {
  const p = G.p;

  // 回血受生命上限限制，不能超过最大值
  const healed = Math.min(ROOM.HEAL, p.max - p.hp);
  p.hp += healed;

  // 得分 = 基础分 + 每房分；本房没被打中再加无伤奖励
  const noHurt = !G.roomHurt;
  G.score +=
    ROOM.SCORE_BASE +
    ROOM.SCORE_PER_WAVE * G.wave +
    (noHurt ? ROOM.NO_HIT_BONUS : 0);

  G.normalRoomsCleared++;

  // 屏幕中央的清房提示（canvas.js 的 drawNotice 负责画）
  G.notice.text = '第 ' + G.wave + ' 房 清理完毕';
  G.notice.sub =
    '回复 ' + healed + ' 血' +
    (noHurt ? ' · 无伤奖励 +' + ROOM.NO_HIT_BONUS : '');
  G.notice.timer = ROOM.NOTICE_TIME;

  // 打开奖励：普通房属性三选一，首领房遗物四选一
  openReward(kind);
}

/**
 * 把一件遗物定义变成一张奖励卡。
 * 新获得时 nextLevel=1；升级时 nextLevel=当前等级+1，描述取对应等级。
 */
function buildRelicCard(def, nextLevel) {
  const maxLevel = RELIC_MAX[def.kind];
  return {
    id: def.id,
    name: def.name,
    color: def.color,
    kind: def.kind,
    desc: def.levels[nextLevel - 1],
    level: nextLevel,
    maxLevel,
    isUpgrade: nextLevel > 1,
  };
}

/**
 * 抽一张遗物卡：指定类别内先按 50/50 决定"新遗物 / 升级已有"，
 * 所选池空就自动换到另一边；整类都空再换另一类。返回 null 表示两类都没货。
 */
function pickRelicCandidate(kind, used) {
  const p = G.p;

  const build = (wantedKind) => {
    const defs = RELIC_DEFS.filter(
      (def) => def.kind === wantedKind && !used.has(def.id)
    );
    const fresh = defs.filter((def) => !p.relicLevels[def.id]);
    const upgradeable = defs.filter(
      (def) => p.relicLevels[def.id] && p.relicLevels[def.id] < RELIC_MAX[def.kind]
    );

    // 每张卡独立 50/50：想给新的就给新的，没货再给升级；反之亦然
    const preferNew = Math.random() < 0.5;
    let pool = preferNew
      ? (fresh.length ? fresh : upgradeable)
      : (upgradeable.length ? upgradeable : fresh);
    if (!pool.length) return null;

    const def = pool[Math.floor(Math.random() * pool.length)];
    const nextLevel = (p.relicLevels[def.id] || 0) + 1;
    return buildRelicCard(def, nextLevel);
  };

  // 只从指定类别抽卡；本类彻底没候选时返回 null，由 openReward 用应急修复补齐。
  // 不跨类回退，否则「3 普通 + 1 特殊」的构成会被打乱。
  return build(kind);
}

/**
 * 打开奖励面板：按房型挑卡，候选不足就用「应急修复」补齐，再交给 UI 显示。
 * starter = 开局三件未拥有的普通遗物；stat = 普通房三选一；relic = 首领四选一。
 * 此时 state='upgrade'，主循环只跑 play/salvage，逻辑天然冻结。
 * @param {'starter'|'stat'|'relic'} kind
 */
function openReward(kind) {
  const p = G.p;
  G.state = 'upgrade';
  G.rewardKind = kind;

  let cards = [];
  const used = new Set();

  if (kind === 'starter') {
    // 开局：从"尚未拥有的普通遗物"里随机 3 张，每张都是 Lv1
    const fresh = RELIC_DEFS.filter(
      (def) => def.kind === 'ordinary' && !p.relicLevels[def.id]
    );
    // 洗牌后取前 3 张，避免每次开局顺序都一样
    for (let i = fresh.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
    }
    cards = fresh.slice(0, ROOM.REWARD_CHOICES).map((def) => buildRelicCard(def, 1));
    // 已没有未拥有的普通遗物时，用应急修复补齐，保证面板永远能点
    while (cards.length < ROOM.REWARD_CHOICES) {
      cards.push(REWARD.HEAL_CARD);
    }
  } else if (kind === 'relic') {
    // 首领：固定 3 张普通 + 1 张特殊；每张独立 50/50 新 / 升级
    for (let i = 0; i < 3; i++) {
      const card = pickRelicCandidate('ordinary', used);
      if (card) {
        cards.push(card);
        used.add(card.id);
      }
    }
    const specialCard = pickRelicCandidate('special', used);
    if (specialCard) {
      cards.push(specialCard);
      used.add(specialCard.id);
    }
    // 候选耗尽：用应急修复把空位补齐
    while (cards.length < ROOM.BOSS_REWARD_CHOICES) {
      cards.push(REWARD.HEAL_CARD);
    }
  } else {
    // 普通房：属性卡按 maxLevel 过滤，满级的不再出现；
    // 元素专属卡还要求 core 与本局主元素一致。
    const pool = REWARD.STAT_CARDS.filter(
      (card) =>
        (!card.core || card.core === p.core) &&
        (p.items[card.id] || 0) < UPGRADE[card.id].maxLevel
    );
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    cards = pool.slice(0, ROOM.REWARD_CHOICES);

    if (pool.length === 0) {
      // 属性卡全满级：满血时刷治疗卡纯属污染面板，直接跳过奖励进装配室；
      // 残血才用 3 张应急修复兜底。
      if (p.hp < p.max) {
        cards = new Array(ROOM.REWARD_CHOICES).fill(REWARD.HEAL_CARD);
      } else {
        G.rewardCards = [];
        G.state = 'route';
        if (routeHook) routeHook();
        return;
      }
    } else {
      // 不足 3 张时从同一个未满级池里重复抽，避免去重后只剩 1 张可选。
      // 重复比塞治疗卡更有用，因此有属性卡时不再补治疗。
      while (cards.length < ROOM.REWARD_CHOICES) {
        cards.push(pool[Math.floor(Math.random() * pool.length)]);
      }
    }
  }

  G.rewardCards = cards;
  if (rewardHook) rewardHook(cards, kind);
}

/**
 * 把一张卡的效果应用到玩家身上。
 * 属性卡把等级记进 p.items；遗物卡走 acquireRelic（首装 / 升级）。
 * @param {{id:string}} card
 */
function applyReward(card) {
  const p = G.p;

  // 遗物卡：id 能在 RELIC_DEFS 里找到，就按"获得 / 升级"处理
  if (relicDef(card.id)) {
    acquireRelic(card.id);
    return;
  }

  // 所有登记在 UPGRADE 里的卡都累计等级（含 6 张元素专属卡）；
  // "应急修复"没有 UPGRADE 条目，不记等级。
  if (UPGRADE[card.id]) {
    p.items[card.id] = (p.items[card.id] || 0) + 1;
  }

  switch (card.id) {
    case 'power':
      p.damage += UPGRADE.power.damage;
      break;
    case 'vitality':
      p.max += UPGRADE.vitality.maxHp;
      p.hp = Math.min(p.max, p.hp + UPGRADE.vitality.heal);
      break;
    case 'agility':
      p.dashRate = Math.max(
        UPGRADE.agility.minDashRate,
        p.dashRate + UPGRADE.agility.dashRate
      );
      break;
    case 'engine':
      // 乘算叠乘：每级 ×1.10，5 级约 1.61 倍；不改 PLAYER.speed 常量
      p.speed *= 1 + UPGRADE.engine.speedMul;
      break;
    case 'heal':
      p.hp = Math.min(p.max, p.hp + ROOM.HEAL);
      break;
  }
}

/**
 * 玩家点了第 index 张奖励卡：
 * - starter：拿到第一件遗物，直接开第 1 房；
 * - 普通房 / 首领房：应用奖励，切到 route 状态弹出装配室；
 *   等玩家点「继续深入」再由 confirmRoute 推进到下一房。
 * @param {number} index
 */
export function pickReward(index) {
  const card = G.rewardCards[index];
  if (!card) return;

  // 开局三选一：选完立刻进第 1 房，不经过装配室
  if (G.rewardKind === 'starter') {
    acquireRelic(card.id);
    G.rewardCards = [];
    beginRoom(1);
    G.state = 'play';
    return;
  }

  applyReward(card);
  G.rewardCards = [];

  // 第一次拿到「元素混合」：先暂停战斗弹副元素面板，
  // 玩家选完（selectSecondary）才继续进装配室。
  if (G.pendingSecondarySelection) {
    G.state = 'secondary-select';
    if (secondaryHook) secondaryHook(G.p.core);
    return;
  }

  // 普通房和首领房统一先进装配室；wave++ / beginRoom 交给 confirmRoute
  G.state = 'route';
  if (routeHook) routeHook();
}

/* ---------------- 开局 / 重开 ---------------- */

/** 完整重开一局：把整局状态清干净，玩家满血回到屏幕正中央，并开始第 1 房。 */
export function restartRun() {
  // 重开保留玩家已经选过的星核（死亡按 R 不再弹选择面板）
  const prevCore = G.p ? G.p.core : null;

  G.state = 'play';
  G.wave = 1;
  G.kills = 0;
  G.score = 0;
  G.time = 0;
  G.roomHurt = false;
  G.spawn = 0;
  G.left = 0;
  G.roomSpawnPlan = [];
  G.roomSpawnIndex = 0;
  G.normalRoomsCleared = 0;
  G.bossesCleared = 0;
  G.rerolls = ROOM.REROLLS;
  G.rewardLeft = 1;
  G.pendingSecondarySelection = false;
  G.bossDefeatedThisRoom = false;
  G.bossRewardClaimed = false;
  G.bossSpawnedThisRoom = false;
  G.bossCountdownRemaining = 0;
  G.rewardKind = 'stat';
  G.rewardCards = [];
  G.notice.timer = 0;
  G.route = 'normal';

  // 攻击模式回到默认：自动攻击开、鼠标没按着、闪电链冷却清零
  G.autoAttack = true;
  G.mouseDown = false;
  G.lightningCD = 0;

  // 清空所有实体数组（保留数组本身，后面的逻辑一直引用它）
  G.enemies.length = 0;
  G.shots.length = 0;
  G.hostile.length = 0;
  G.sparks.length = 0;
  G.pickups.length = 0;
  G.combatTexts.length = 0;
  G.zones.length = 0;
  G.bursts.length = 0;
  G.lightningArcs.length = 0;
  G.bossHazards.length = 0;
  G.bossGhosts.length = 0;
  G.pickups.length = 0;
  G.shake = 0;

  // 重建玩家，并摆到屏幕正中央
  G.p = createPlayer();
  G.p.x = CANVAS.WIDTH / 2;
  G.p.y = CANVAS.HEIGHT / 2;

  // 把上一局选的星核写回新玩家；没选过就是 null（开局由 main.js 弹选择面板）
  if (prevCore) {
    G.p.core = prevCore;
    G.p.enchantState.primaryId = prevCore;
    G.p.enchantState.runtimeCoreId = prevCore;
  }

  // 附魔计数、黑洞、爆发环、震屏全部归零
  resetEnchant();

  // 重开时所有键视为松开，避免上一局按着的键带进来
  clearInput();

  // 开始第 1 房（beginRoom 会顺便设置进房提示）
  beginRoom(1);
}

/* ---------------- 每帧更新 ---------------- */

/**
 * 推进一帧游戏逻辑。顺序很重要：
 * 提示 → 时间 → 玩家 → 首领倒计时 → 刷怪 → 敌人 → 自动攻击 → 子弹 →
 * 敌弹 → 清尸体 → 死亡判定 → 房间判定
 * @param {number} dt 距上一帧过了多少秒
 */
export function update(dt) {
  // 房间提示的倒计时（到 0 自动不画）
  G.notice.timer = Math.max(0, G.notice.timer - dt);

  // 震屏强度每帧衰减，归零后画面恢复稳定
  G.shake = Math.max(0, G.shake - SHAKE.DECAY * dt);

  G.time += dt;            // a. 本局计时
  updatePlayer(dt);        // b. 玩家移动 / 冲刺 / 冷却
  updateBossCountdown(dt); // c. 首领房入场倒计时（到点刷 Boss）
  updateSpawn(dt);         // d. 按本房计划刷怪
  updateEnemies(dt);       // e. 敌人追玩家 + 接触伤害 + Boss 出招
  updateAttack(dt);        // f. 自动攻击：朝最近的敌人开火
  updateShots(dt);         // g. 玩家子弹：飞行 / 命中 / 击杀记分
  updateSparks(dt);        // g2. 子弹拖尾粒子：减速、淡出、过期删除
  updateHostile(dt);       // h. 敌方子弹：飞行 / 打中玩家
  updateBossHazards(dt);   // h2. 首领火焰节点 / 冰环 / 激光
  updateBossGhosts(dt);    // h3. 首领瞬移残影淡出（纯视觉）
  updateEnchant(dt);       // i. 附魔：灼烧 / 侵蚀跳伤、冰缓冻结、黑洞
  updateLightningArcs(dt); // i2. 闪电折线：0.1 秒淡出
  updatePickups(dt);       // i3. 血包：走近自动捡、回血、超时删除
  updateCombatTexts(dt);   // j. 伤害飘字：上飘、淡出、过期删除

  // k. 把血量归零的敌人从数组里剔除
  G.enemies = G.enemies.filter((e) => e.hp > 0);

  // l. 玩家死亡：血量夹到 0，切到死亡状态，本帧不再做房间判定
  if (G.p.hp <= 0 && G.state === 'play') {
    G.p.hp = 0;
    G.state = 'dead';
    return;
  }

  if (G.state !== 'play') return;

  // m. 首领房：Boss 一死立刻开四选一遗物面板，不等小怪清完
  if (G.wave % ROOM.PER_ROUND === 0) {
    if (G.bossDefeatedThisRoom && !G.bossRewardClaimed) {
      G.bossRewardClaimed = true;
      finishRoom('relic');
    }
    return;
  }

  // n. 普通房：计划刷完 + 场上清空 → 打开三选一属性面板
  if (
    G.roomSpawnIndex >= G.roomSpawnPlan.length &&
    G.enemies.length === 0
  ) {
    finishRoom('stat');
  }
}

/**
 * 首领房入场倒计时：到 0 刷 1 只 Boss 并给提示。
 * 倒计时期间普通怪照常刷（updateSpawn 不关心 Boss）。
 * @param {number} dt 秒
 */
function updateBossCountdown(dt) {
  if (G.wave % ROOM.PER_ROUND !== 0 || G.bossSpawnedThisRoom) return;

  G.bossCountdownRemaining -= dt;
  if (G.bossCountdownRemaining > 0) return;

  G.bossCountdownRemaining = 0;
  G.bossSpawnedThisRoom = true;

  const boss = spawnBoss();
  G.notice.text = '首领降临';
  G.notice.sub = boss.archetype;
  G.notice.timer = ROOM.NOTICE_TIME;
}

/**
 * 第 n 只首领的血量：config.BOSS.HP 里的公式，最后乘倍率并封顶。
 * n = 本房序号 / 3（第 3 房 → 1，第 6 房 → 2）。
 * @param {number} n 第几只首领
 * @returns {number} 血量
 */
function bossHp(n) {
  const H = BOSS.HP;
  const raw =
    H.BASE +
    H.FLAT +
    Math.min(n - 1, H.STEP_A_CAP) * H.STEP_A +
    Math.min(Math.max(0, n - 4), H.STEP_B_CAP) * H.STEP_B +
    Math.max(0, n - 9) * H.STEP_C;

  return Math.round(Math.min(H.MAX, raw * H.MULTIPLIER));
}

/**
 * 生成本房 Boss：出生在屏幕顶部中间，原型按首领序号轮换。
 * @returns {object} 生成的 Boss 对象（已进 G.enemies）
 */
function spawnBoss() {
  const n = Math.floor(G.wave / ROOM.PER_ROUND);
  const bossRound = Math.floor((n - 1) / BOSS.BOSSES_PER_ROUND) + 1;
  const bossIndex = (n - 1) % BOSS.ARCHETYPES.length;
  const archetype = BOSS.ARCHETYPES[bossIndex];

  // 血量：先算基础公式，再按当前轮数乘倍率（第 3 轮起固定 ×2）
  const baseHp = bossHp(n);
  const hpMul =
    bossRound >= 3
      ? BOSS.ROUND3_HP_MUL
      : bossRound === 2
        ? BOSS.ROUND2_HP_MUL
        : 1;
  const hp = Math.round(baseHp * hpMul);

  // 伤害倍率只记录/展示；玩家实际受击仍统一扣 PLAYER.hurtDamage（20）
  const damageMul =
    bossRound >= 3
      ? BOSS.ROUND3_DAMAGE_MUL
      : bossRound === 2
        ? BOSS.ROUND2_DAMAGE_MUL
        : 1;

  // 第 2 轮随机抽 1 个词缀；第 1 轮没有，第 3 轮起改用质变
  const affix =
    bossRound === 2
      ? BOSS.AFFIX_POOL[Math.floor(Math.random() * BOSS.AFFIX_POOL.length)]
      : null;

  const boss = {
    id: nextEnemyId++,
    type: 'boss',
    x: CANVAS.WIDTH / 2,
    y: ARENA.MARGIN_TOP + BOSS.SPAWN_OFFSET_Y,
    r: ENEMY.RADIUS.boss,
    hp,
    max: hp,
    speed: archetype.speed,
    cd: BOSS.INITIAL_CD,          // 入场后第一次环形弹前的冷却
    bossNumber: n,                // 第几只首领（1 起）
    bossRound,                    // 第几轮大循环（每 5 只一轮）
    bossIndex,                    // 本轮里的第几个原型（0–4）
    damageMul,                    // 本轮伤害倍率（仅展示）
    affix,                        // 第 2 轮词缀：shield / rage / teleport
    archetype: archetype.name,    // 原型名，HUD 血条上显示

    /* --- 模块二：五种原型的专属招式计时器 --- */
    chargeCd: 2.5,                // 下一次冲锋还要等多久
    chargeWarn: 0,                // >0 = 正在红色预警
    chargeTime: 0,                // >0 = 正在冲锋
    chargeDX: 0,                  // 预警时锁定的冲锋方向
    chargeDY: 0,
    summonCd: 2.5,                // 下一次召唤还要等多久
    spiralCd: 2.0,                // 下一轮螺旋还要等多久
    spiralTime: 0,                // >0 = 螺旋正在喷
    spiralTick: 0,                // 下一颗螺旋弹的间隔
    spiralAngle: 0,               // 当前螺旋角度
    orbCd: 2.2,                   // 下一组追踪球还要等多久

    /* --- 攻城兽（原型 3）的力场护盾 --- */
    shield: 0,                    // 当前护盾血量；0 = 没盾
    shieldMax: 0,                 // 本次护盾的满值（画六边形用）
    shieldCd: BOSS.SKILL.SHIELD_CD, // 首盾/破盾后都要等 4 秒才能重新套盾

    /* --- 大任务20：词缀与质变计时器 --- */
    affixShieldCd: BOSS.AFFIX.SHIELD_CD, // 词缀护盾的重新套盾倒计时
    teleportCd: BOSS.AFFIX.TELEPORT_CD,  // 词缀瞬移倒计时
    flameTick: 0,                 // 裂隙冲锋时下一次留下火焰节点的间隔
    thunderCd: 1.5,               // 裂隙第一次落雷的等待时间
    iceRingCd: BOSS.MUTATION.FROST_RING_CD, // 霜环下一次收缩冰环
    voidOrbCd: BOSS.MUTATION.VOID_ORB_CD,   // 虚空下一组追踪紫球
    finalLaserCd: BOSS.MUTATION.FINAL_LASER_CD, // 终焉第 3 轮八向激光
    crossCd: BOSS.MUTATION.FINAL_CROSS_CD,      // 终焉第 1/2 轮十字激光

    /* --- 第八阶段：元素状态（首领不冻结，其余和普通怪一致） --- */
    fireStacks: 0,
    fireTimer: 0,
    fireTickCD: 0,
    darkStacks: 0,
    darkTimer: 0,
    darkTickCD: 0,
    chillTimer: 0,
    chillMul: 1,
    freezeTimer: 0,
  };

  G.enemies.push(boss);
  return boss;
}

/**
 * Boss 当前阶段：血量比例 >65% 是 1 阶段，>30% 是 2 阶段，否则 3 阶段。
 * @param {object} e Boss
 * @returns {1|2|3}
 */
function bossPhase(e) {
  const ratio = e.hp / e.max;
  if (ratio > BOSS.PHASE_2) return 1;
  if (ratio > BOSS.PHASE_3) return 2;
  return 3;
}

/**
 * 首领原型下标：每 5 只一轮，下标 0–4 对应五个固定原型。
 * @param {object} e Boss
 * @returns {0|1|2|3|4}
 */
function bossArchetypeIndex(e) {
  // 生成时已经存了 bossIndex；兼容旧存档/测试对象时再按序号算一次
  if (typeof e.bossIndex === 'number') return e.bossIndex;
  return (e.bossNumber - 1) % BOSS.ARCHETYPES.length;
}

/**
 * 往敌弹数组里塞一颗子弹；到硬上限就直接放弃。
 * extra 用来给追踪球附加 homing / turnRate 等字段。
 */
function spawnHostileShot(x, y, vx, vy, life, color, r, extra) {
  if (G.hostile.length >= LIMITS.hostileShots) return;

  const shot = {
    x,
    y,
    vx,
    vy,
    life,
    color,                 // 每颗子弹自己的颜色
    r: r || HOSTILE.RADIUS,
  };
  if (extra) Object.assign(shot, extra);
  G.hostile.push(shot);
}

/**
 * 射手：距离近就后退、居中停步、远了靠近；每 2 秒朝玩家打一发。
 * 只负责"这一帧要不要开火"，移动由 updateEnemies 统一处理。
 * @param {object} e 射手
 * @param {number} dist 与玩家的距离
 * @param {number} dt 秒
 */
function updateShooterAttack(e, dist, dt) {
  const cfg = ENEMY.SHOOTER;
  e.fireCd = Math.max(0, e.fireCd - dt);

  if (e.fireCd > 0 || e.freezeTimer > 0 || dist > cfg.FIRE_DIST) return;

  const angle = Math.atan2(G.p.y - e.y, G.p.x - e.x);
  spawnHostileShot(
    e.x, e.y,
    Math.cos(angle) * cfg.BULLET_SPEED,
    Math.sin(angle) * cfg.BULLET_SPEED,
    cfg.BULLET_LIFE,
    COLORS.hostile,
    3
  );
  e.fireCd = cfg.FIRE_CD;
}

/**
 * 精英：玩家进入 300px 后停下，朝玩家打 3 发扇形弹（相邻 15°）。
 * @param {object} e 精英
 * @param {number} dist 与玩家的距离
 * @param {number} dt 秒
 */
function updateEliteAttack(e, dist, dt) {
  const cfg = ENEMY.ELITE;
  // 辅助型精英不攻击，只负责光环；直接跳过开火计时
  if (e.eliteModel === 'support') return;
  e.fireCd = Math.max(0, e.fireCd - dt);
  e.attackHold = Math.max(0, (e.attackHold || 0) - dt);

  if (e.fireCd > 0 || e.freezeTimer > 0 || dist > cfg.FIRE_RANGE) return;

  e.fireCd = cfg.FIRE_CD;
  e.attackHold = cfg.HOLD_TIME;   // 开火时原地停一小会儿

  const base = Math.atan2(G.p.y - e.y, G.p.x - e.x);
  for (let i = 0; i < cfg.FAN_COUNT; i++) {
    const offset = (i - (cfg.FAN_COUNT - 1) / 2) * cfg.FAN_GAP;
    const angle = base + offset;
    spawnHostileShot(
      e.x, e.y,
      Math.cos(angle) * cfg.BULLET_SPEED,
      Math.sin(angle) * cfg.BULLET_SPEED,
      cfg.BULLET_LIFE,
      COLORS.elite,
      3
    );
  }
}

/**
 * 精英的词缀计时：护盾每 4 秒刷一次（破盾后重新计时），瞬移每 5 秒一次。
 * 自爆 / 分裂是死亡时结算，不在这里处理。
 * @param {object} e 精英
 * @param {number} dt 秒
 */
function updateEliteAffix(e, dt) {
  const cfg = ENEMY.ELITE;

  // 护盾：只有当前没盾时才走冷却，盾在身上的时候不重复刷新
  if (e.eliteAffixes.includes('shield') && e.eliteShield <= 0) {
    e.eliteShieldCd -= dt;
    if (e.eliteShieldCd <= 0) {
      e.eliteShieldMax = e.max * cfg.SHIELD_RATIO;
      e.eliteShield = e.eliteShieldMax;
      e.eliteShieldCd = cfg.SHIELD_CD;
    }
  }

  // 瞬移：原地留一个橙色残影，再跳到玩家周围 150px 的随机点
  if (e.eliteAffixes.includes('teleport')) {
    e.eliteTeleportCd -= dt;
    if (e.eliteTeleportCd <= 0) {
      // 残影是纯视觉，满了就不再追加，防止极端情况下数组无界增长
      if (G.bossGhosts.length < LIMITS.bossGhosts) {
        G.bossGhosts.push({
          x: e.x,
          y: e.y,
          r: e.r,
          life: BOSS.AFFIX.GHOST_LIFE,
          maxLife: BOSS.AFFIX.GHOST_LIFE,
          color: COLORS.elite,
        });
      }

      const angle = Math.random() * Math.PI * 2;
      e.x = G.p.x + Math.cos(angle) * cfg.TELEPORT_DIST;
      e.y = G.p.y + Math.sin(angle) * cfg.TELEPORT_DIST;
      e.x = Math.max(ARENA.MARGIN_X, Math.min(CANVAS.WIDTH - ARENA.MARGIN_X, e.x));
      e.y = Math.max(ARENA.MARGIN_TOP, Math.min(CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM, e.y));
      e.eliteTeleportCd = cfg.TELEPORT_CD;
    }
  }
}

/**
 * 首领召唤：在首领身边生成 2 只射手小怪，受单场/全场数量上限约束。
 * 召唤物有存活时间，时间到自动消失。
 * @param {object} boss 首领
 */
function spawnBossMinions(boss) {
  const cfg = BOSS.SKILL;
  const idx = bossArchetypeIndex(boss);
  const perBossCap = ENEMY.BOSS_MAX_MINIONS[idx] || 2;

  // 这只首领已经召出来的数量
  const mine = G.enemies.filter(
    (e) => e.isBossMinion && e.bossOwnerId === boss.id
  ).length;

  // 全场召唤物总数（LIMITS.bossMinions）也不能超
  const allMinions = G.enemies.filter((e) => e.isBossMinion).length;
  const room = Math.min(
    cfg.SUMMON_COUNT,
    perBossCap - mine,
    LIMITS.bossMinions - allMinions,
    LIMITS.enemies - G.enemies.length
  );

  for (let i = 0; i < room; i++) {
    const angle = (Math.PI * 2 * i) / cfg.SUMMON_COUNT + G.time;
    const stats = enemyStats('shooter', G.wave);

    G.enemies.push({
      id: nextEnemyId++,
      type: 'shooter',
      x: boss.x + Math.cos(angle) * (boss.r + 18),
      y: boss.y + Math.sin(angle) * (boss.r + 18),
      r: stats.r,
      hp: stats.hp * ENEMY.MINION_HP_MUL,
      max: stats.hp * ENEMY.MINION_HP_MUL,
      speed: stats.speed,
      fireCd: 0.8 + i * 0.35,

      // 召唤物标记：到时间消失；首领死后也一起清掉
      isBossMinion: true,
      bossOwnerId: boss.id,
      minionLife: ENEMY.BOSS_MINION_LIFE[idx],

      fireStacks: 0, fireTimer: 0, fireTickCD: 0,
      darkStacks: 0, darkTimer: 0, darkTickCD: 0,
      chillTimer: 0, chillMul: 1, freezeTimer: 0,
    });
  }
}

/**
 * 把一个首领危险区塞进 G.bossHazards；到上限就放弃新的。
 * 危险区包括：火焰节点、收缩冰环、激光。
 * @param {object} hazard 危险区对象
 */
function pushBossHazard(hazard) {
  if (G.bossHazards.length >= LIMITS.bossHazards) return;
  G.bossHazards.push(hazard);
}

/**
 * 裂隙质变：在 Boss 当前位置留一个火焰节点，存活 3 秒，玩家碰到扣 20。
 * @param {number} x 横坐标
 * @param {number} y 纵坐标
 */
function spawnFlameHazard(x, y) {
  const m = BOSS.MUTATION;
  pushBossHazard({
    kind: 'flame',
    x,
    y,
    r: m.RIFT_FLAME_RADIUS,
    age: 0,
    life: m.RIFT_FLAME_LIFE,
  });
}

/**
 * 霜环质变：以 Boss 为圆心生成一个从 600px 收缩到 0 的冰环。
 * 随机留一个 1.0 弧度的缺口，玩家可以从缺口穿过去。
 * @param {object} e Boss
 */
function spawnIceRing(e) {
  const m = BOSS.MUTATION;
  pushBossHazard({
    kind: 'iceRing',
    x: e.x,
    y: e.y,
    radius: m.FROST_RING_START_RADIUS,
    age: 0,
    life: m.FROST_RING_LIFE,
    width: m.FROST_RING_WIDTH,
    gapStart: Math.random() * Math.PI * 2,
    gapSize: m.FROST_RING_GAP,
  });
}

/**
 * 裂隙常规招式：在玩家脚下画红圈，0.8 秒后落雷；只有落下来的 0.18 秒内会伤人。
 * @param {number} x 落点 x
 * @param {number} y 落点 y
 */
function spawnThunderStrike(x, y) {
  const m = BOSS.MUTATION;
  pushBossHazard({
    kind: 'thunder',
    x,
    y,
    r: m.RIFT_THUNDER_RADIUS,
    warn: m.RIFT_THUNDER_WARN,
    active: m.RIFT_THUNDER_ACTIVE,
    age: 0,
    life: m.RIFT_THUNDER_WARN + m.RIFT_THUNDER_ACTIVE,
  });
}

/**
 * 终焉质变/常规：生成一道激光危险区。
 * 前 1 秒是虚线预警，后 0.35 秒是实线激活，只有激活时才会伤人。
 * @param {object} e Boss
 * @param {number} angle 激光方向（弧度）
 * @param {string} color 绘制颜色
 */
function spawnLaserHazard(e, angle, color) {
  const m = BOSS.MUTATION;
  pushBossHazard({
    kind: 'laser',
    x: e.x,
    y: e.y,
    angle,
    length: m.FINAL_LASER_LENGTH,
    width: m.FINAL_LASER_WIDTH,
    warn: m.FINAL_LASER_WARN,
    active: m.FINAL_LASER_ACTIVE,
    age: 0,
    tint: color,
  });
}

/**
 * 攻城兽质变：护盾被打破的瞬间，向四周均匀发射 20 发环形弹。
 * 仍然走 spawnHostileShot，所以自动受敌弹硬上限保护。
 * @param {object} e Boss
 */
function spawnSiegeBreakVolley(e) {
  const m = BOSS.MUTATION;
  for (let i = 0; i < m.SIEGE_BREAK_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / m.SIEGE_BREAK_COUNT;
    spawnHostileShot(
      e.x,
      e.y,
      Math.cos(angle) * m.SIEGE_BREAK_SPEED,
      Math.sin(angle) * m.SIEGE_BREAK_SPEED,
      m.SIEGE_BREAK_LIFE,
      COLORS.boss,
      4
    );
  }
}

/**
 * 虚空质变：每 4 秒向玩家方向扇形发射 10 发慢速强追踪紫球。
 * 每颗球都带 voidOrb 标记，命中玩家后由 updateHostile 负责分裂。
 * @param {object} e Boss
 */
function spawnVoidOrbs(e) {
  const m = BOSS.MUTATION;
  const p = G.p;
  const base = Math.atan2(p.y - e.y, p.x - e.x);

  for (let i = 0; i < m.VOID_ORB_COUNT; i++) {
    // 以玩家方向为中心，均匀铺开成一小片扇面
    const angle = base + (i - (m.VOID_ORB_COUNT - 1) / 2) * 0.12;
    spawnHostileShot(
      e.x,
      e.y,
      Math.cos(angle) * m.VOID_ORB_SPEED,
      Math.sin(angle) * m.VOID_ORB_SPEED,
      m.VOID_ORB_LIFE,
      COLORS.dark,
      m.VOID_ORB_RADIUS,
      {
        homing: true,
        turnRate: m.VOID_ORB_TURN,
        speed: m.VOID_ORB_SPEED,
        voidOrb: true,       // 标记：这是一颗会分裂的大球
      }
    );
  }
}

/**
 * 虚空大球打中玩家后分裂成 2 发小球。
 * 小球只带 voidChild 标记，不再带 voidOrb，所以不会继续分裂。
 * @param {object} h 刚命中玩家的大球
 */
function spawnVoidSplitChildren(h) {
  const m = BOSS.MUTATION;
  const base = Math.atan2(h.vy, h.vx);

  for (let i = 0; i < m.VOID_SPLIT_COUNT; i++) {
    // 以原飞行方向为轴，左右各偏 0.8 弧度
    const angle = base + (i === 0 ? 0.8 : -0.8);
    spawnHostileShot(
      h.x,
      h.y,
      Math.cos(angle) * m.VOID_CHILD_SPEED,
      Math.sin(angle) * m.VOID_CHILD_SPEED,
      m.VOID_CHILD_LIFE,
      COLORS.dark,
      m.VOID_CHILD_RADIUS,
      {
        homing: true,
        turnRate: m.VOID_CHILD_TURN,
        speed: m.VOID_CHILD_SPEED,
        voidChild: true,
      }
    );
  }
}

/**
 * 攻城兽的常规护盾循环：没盾时倒计时，到点按最大生命比例套盾。
 * @param {object} e Boss
 * @param {number} dt 秒
 * @param {number} ratio 护盾占最大生命的比例
 */
function updateSiegeShield(e, dt, ratio) {
  if (e.shield > 0) return;

  e.shieldCd -= dt;
  if (e.shieldCd <= 0) {
    e.shieldMax = e.max * ratio;
    e.shield = e.shieldMax;
  }
}

/**
 * 第 2 轮词缀：护盾 / 暴怒 / 瞬移。
 * 每只 Boss 只带一个词缀，所以这里按 affix 分支处理。
 * @param {object} e Boss
 * @param {number} dt 秒
 */
function updateBossAffix(e, dt) {
  if (e.bossRound !== 2 || !e.affix) return;

  // 词缀·护盾：没盾时每 4 秒重新获得 30% 最大生命的护盾
  if (e.affix === 'shield') {
    if (e.shield > 0) return;
    e.affixShieldCd -= dt;
    if (e.affixShieldCd <= 0) {
      e.shieldMax = e.max * BOSS.AFFIX.SHIELD_RATIO;
      e.shield = e.shieldMax;
      e.affixShieldCd = BOSS.AFFIX.SHIELD_CD; // 套上盾后重新计时，盾破不会立刻再刷
    }
    return;
  }

  // 词缀·瞬移：每 5 秒跑到离玩家 150px 的随机点，原地留 0.4 秒残影
  if (e.affix === 'teleport') {
    e.teleportCd -= dt;
    if (e.teleportCd > 0) return;

    e.teleportCd = BOSS.AFFIX.TELEPORT_CD;

    // 残影先记录瞬移前的位置，再移动本体
    if (G.bossGhosts.length >= LIMITS.bossGhosts) G.bossGhosts.shift();
    G.bossGhosts.push({
      x: e.x,
      y: e.y,
      r: e.r,
      life: BOSS.AFFIX.GHOST_LIFE,
      maxLife: BOSS.AFFIX.GHOST_LIFE,
    });

    const p = G.p;
    const angle = Math.random() * Math.PI * 2;
    const nx = p.x + Math.cos(angle) * BOSS.AFFIX.TELEPORT_DIST;
    const ny = p.y + Math.sin(angle) * BOSS.AFFIX.TELEPORT_DIST;

    // 瞬移点也必须留在场地内，不能跑到墙外
    e.x = Math.max(ARENA.MARGIN_X, Math.min(CANVAS.WIDTH - ARENA.MARGIN_X, nx));
    e.y = Math.max(ARENA.MARGIN_TOP, Math.min(CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM, ny));
  }
}

/**
 * 首领专属招式：只推进计时器并生成弹幕，不移动首领。
 * 第 3 轮起不再跑普通招式，只跑各自的质变。
 * 冲锋的移动在 updateEnemies 里做，预警线由 canvas 画。
 * @param {object} e Boss
 * @param {number} dt 秒
 */
function updateBossSkills(e, dt) {
  const cfg = BOSS.SKILL;
  const m = BOSS.MUTATION;
  const idx = bossArchetypeIndex(e);
  const p = G.p;

  // 第 2 轮词缀先推进；第 1/3 轮这里什么都不做
  updateBossAffix(e, dt);

  // 原型 0：预警 0.5s → 锁定方向冲 0.35s（第 3 轮保留冲锋，另留火焰节点）
  if (idx === 0) {
    if (e.chargeWarn > 0) {
      e.chargeWarn = Math.max(0, e.chargeWarn - dt);
      if (e.chargeWarn === 0) {
        e.chargeTime = cfg.CHARGE_TIME;
        e.flameTick = 0; // 每次冲锋都从 0 开始铺火焰，避免第一帧连爆一串节点
      }
    } else if (e.chargeTime > 0) {
      e.chargeTime = Math.max(0, e.chargeTime - dt);
    } else {
      e.chargeCd -= dt;
      if (e.chargeCd <= 0) {
        e.chargeCd = cfg.CHARGE_CD;
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          e.chargeDX = dx / len;
          e.chargeDY = dy / len;
          e.chargeWarn = cfg.CHARGE_WARN;
        }
      }
    }

    // 落雷：每 3 秒在玩家当前坐标放一个红圈，0.8 秒后劈下来
    e.thunderCd -= dt;
    if (e.thunderCd <= 0) {
      e.thunderCd = m.RIFT_THUNDER_CD;
      spawnThunderStrike(p.x, p.y);
    }
    return;
  }

  // 第 3 轮及以上：每个原型只跑自己的质变
  if (e.bossRound >= 3) {
    // 霜环：每 7 秒一个收缩冰环
    if (idx === 1) {
      e.iceRingCd -= dt;
      if (e.iceRingCd <= 0) {
        e.iceRingCd = m.FROST_RING_CD;
        spawnIceRing(e);
      }
      return;
    }

    // 攻城：只保留 20% 护盾循环；破盾弹幕在 damageEnemy 里触发
    if (idx === 2) {
      updateSiegeShield(e, dt, m.SIEGE_SHIELD_RATIO);
      return;
    }

    // 虚空：每 4 秒 10 发慢速强追踪紫球
    if (idx === 3) {
      e.voidOrbCd -= dt;
      if (e.voidOrbCd <= 0) {
        e.voidOrbCd = m.VOID_ORB_CD;
        spawnVoidOrbs(e);
      }
      return;
    }

    // 终焉：每 4 秒米字八向激光
    if (idx === 4) {
      e.finalLaserCd -= dt;
      if (e.finalLaserCd <= 0) {
        // 终焉半血狂暴：激光间隔减半，发射频率翻倍
        const enraged = e.hp / e.max < m.FINAL_ENRAGE_HP;
        e.finalLaserCd = m.FINAL_LASER_CD * (enraged ? m.FINAL_ENRAGE_CD_MUL : 1);
        for (let i = 0; i < m.FINAL_LASER_COUNT; i++) {
          spawnLaserHazard(e, (Math.PI * 2 * i) / m.FINAL_LASER_COUNT, COLORS.boss);
        }
      }
    }
    return;
  }

  // 原型 1（霜环，第 1/2 轮）：减速领域是被动效果，由玩家移动和渲染读取；
  // 常规招式仍然是召唤射手，和旧版原型定位保持一致。
  if (idx === 1) {
    e.summonCd -= dt;
    if (e.summonCd <= 0) {
      e.summonCd = cfg.SUMMON_CD;
      spawnBossMinions(e);
    }
    return;
  }

  // 原型 2（第 1/2 轮）：旋转螺旋 + 力场护盾
  if (idx === 2) {
    if (e.affix !== 'shield') {
      updateSiegeShield(e, dt, cfg.SHIELD_RATIO);
    }

    if (e.spiralTime > 0) {
      e.spiralTime -= dt;
      e.spiralTick -= dt;

      // 一帧最多补 4 颗，避免配置异常时在这一帧里无限生成
      const spiralGap = Math.max(0.016, cfg.SPIRAL_GAP);
      for (let n = 0; n < 4 && e.spiralTick <= 0 && e.spiralTime > 0; n++) {
        spawnHostileShot(
          e.x, e.y,
          Math.cos(e.spiralAngle) * cfg.SPIRAL_SPEED,
          Math.sin(e.spiralAngle) * cfg.SPIRAL_SPEED,
          cfg.SPIRAL_LIFE,
          COLORS.boss,
          3
        );
        e.spiralAngle += cfg.SPIRAL_STEP;
        e.spiralTick += spiralGap;
      }
    } else {
      e.spiralCd -= dt;
      if (e.spiralCd <= 0) {
        e.spiralCd = cfg.SPIRAL_CD;
        e.spiralTime = cfg.SPIRAL_TIME;
        e.spiralTick = 0;
        e.spiralAngle = Math.atan2(p.y - e.y, p.x - e.x);
      }
    }
    return;
  }

  // 原型 3（第 1/2 轮）：一次 5 颗慢速追踪球，扇形散开
  if (idx === 3) {
    e.orbCd -= dt;
    if (e.orbCd > 0) return;

    e.orbCd = cfg.ORB_CD;
    const base = Math.atan2(p.y - e.y, p.x - e.x);
    for (let i = 0; i < cfg.ORB_COUNT; i++) {
      const angle = base + (i - (cfg.ORB_COUNT - 1) / 2) * 0.32;
      spawnHostileShot(
        e.x, e.y,
        Math.cos(angle) * cfg.ORB_SPEED,
        Math.sin(angle) * cfg.ORB_SPEED,
        cfg.ORB_LIFE,
        COLORS.dark,
        cfg.ORB_RADIUS,
        { homing: true, turnRate: cfg.ORB_TURN, speed: cfg.ORB_SPEED }
      );
    }
  }

  // 原型 4（第 1/2 轮）没有额外专属招式：十字激光在 updateBossAttack 里放
}

/**
 * Boss 环形弹：cd 到 0 时放一圈（8 + 阶段×2 发，360° 均分），
 * 然后按阶段重置出招间隔（越高阶段越快）。
 * 专属招式在 updateBossSkills 里另外跑。
 * @param {object} e Boss
 * @param {number} dt 秒
 */
function updateBossAttack(e, dt) {
  // 第 3 轮起禁用普通环形弹：每只 Boss 只跑自己的质变
  if (e.bossRound >= 3) return;

  // 终焉之瞳的第 1/2 轮：用十字四向激光代替环形弹
  if (bossArchetypeIndex(e) === 4) {
    e.crossCd -= dt;
    if (e.crossCd > 0) return;

    const m = BOSS.MUTATION;
    const enraged = e.hp / e.max < m.FINAL_ENRAGE_HP;
    e.crossCd = m.FINAL_CROSS_CD * (enraged ? m.FINAL_ENRAGE_CD_MUL : 1);
    for (let i = 0; i < BOSS.MUTATION.FINAL_CROSS_COUNT; i++) {
      spawnLaserHazard(
        e,
        (Math.PI * 2 * i) / BOSS.MUTATION.FINAL_CROSS_COUNT,
        COLORS.boss
      );
    }
    return;
  }

  e.cd -= dt;
  if (e.cd > 0) return;

  const phase = bossPhase(e);
  const count = Math.min(
    BOSS.MAX_VOLLEY,
    BOSS.RING_BASE + BOSS.RING_PER_PHASE * phase
  );

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    spawnHostileShot(
      e.x, e.y,
      Math.cos(angle) * BOSS.RING_SPEED,
      Math.sin(angle) * BOSS.RING_SPEED,
      HOSTILE.LIFE,
      COLORS.boss,
      4
    );
  }

  e.cd = Math.max(
    BOSS.RING_CD_MIN,
    BOSS.RING_CD_BASE - (phase - 1) * BOSS.RING_CD_STEP
  );
}

/**
 * b. 玩家：冷却倒计时、读方向、冲刺、移动、夹在场地边界内。
 * @param {number} dt 秒
 */
function updatePlayer(dt) {
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

/**
 * c. 按本房计划刷怪：每次到点从 roomSpawnPlan 里取一只。
 * 计划取完就把 left 归 0，不再刷。场上满员时等一小会儿再重试。
 * @param {number} dt 秒
 */
function updateSpawn(dt) {
  // 计划已经刷完：本房不再生成
  if (G.roomSpawnIndex >= G.roomSpawnPlan.length) {
    G.left = 0;
    return;
  }

  G.spawn -= dt;
  if (G.spawn > 0) return;

  // 场上敌人到了硬上限：0.2 秒后再试，避免瞬间塞满导致卡顿
  if (G.enemies.length >= LIMITS.enemies) {
    G.spawn = 0.2;
    return;
  }

  // 从计划里取下一只
  spawnEnemy(G.roomSpawnPlan[G.roomSpawnIndex]);
  G.roomSpawnIndex++;
  G.left = G.roomSpawnPlan.length - G.roomSpawnIndex;
  G.spawn = roomSpawnInterval(G.wave);
}

/**
 * c. 在屏幕四条边随机一个出生点，生成 1 只指定类型的敌人。
 * 出生点贴着屏幕边缘；如果落点离玩家太近（贴脸），就换到对角位置。
 * @param {string} type 敌人类型（chaser / runner / tank / shooter / elite）
 */
function spawnEnemy(type) {
  const stats = enemyStats(type, G.wave);

  // 0=上边 1=右边 2=下边 3=左边，等概率挑一条边
  const edge = Math.floor(Math.random() * 4);
  let x;
  let y;
  if (edge === 0) {
    // 上边：y 固定，x 随机
    x = Math.random() * CANVAS.WIDTH;
    y = SPAWN.EDGE;
  } else if (edge === 1) {
    // 右边：x 固定，y 随机
    x = CANVAS.WIDTH - SPAWN.EDGE;
    y = Math.random() * CANVAS.HEIGHT;
  } else if (edge === 2) {
    // 下边
    x = Math.random() * CANVAS.WIDTH;
    y = CANVAS.HEIGHT - SPAWN.EDGE;
  } else {
    // 左边
    x = SPAWN.EDGE;
    y = Math.random() * CANVAS.HEIGHT;
  }

  // 出生点离玩家太近就换到对角，避免刚出生就贴脸伤人
  const dx = x - G.p.x;
  const dy = y - G.p.y;
  if (Math.hypot(dx, dy) < SPAWN.MIN_DIST_TO_PLAYER) {
    x = CANVAS.WIDTH - x;
    y = CANVAS.HEIGHT - y;
  }

  // 场上已经到硬上限就不再生成，避免后期敌人越堆越多
  if (G.enemies.length >= LIMITS.enemies) return null;

  // 精英生成时决定：攻击型还是辅助型，再随机抽 1–2 个不重复词缀
  let eliteModel = null;
  let eliteAffixes = [];
  if (type === 'elite') {
    eliteModel = Math.random() < ENEMY.ELITE.SUPPORT_CHANCE ? 'support' : 'attack';

    const pool = ENEMY.ELITE.AFFIX_POOL.slice();
    const count =
      ENEMY.ELITE.AFFIX_MIN +
      Math.floor(Math.random() * (ENEMY.ELITE.AFFIX_MAX - ENEMY.ELITE.AFFIX_MIN + 1));
    for (let i = 0; i < count && pool.length > 0; i++) {
      const pick = Math.floor(Math.random() * pool.length);
      eliteAffixes.push(pool.splice(pick, 1)[0]);
    }
  }

  // 敌人字段：id / 类型 / 坐标 / 半径 / 当前血 / 最大血 / 移速
  const enemy = {
    id: nextEnemyId++,
    type,
    x,
    y,
    r: stats.r,
    hp: stats.hp,
    max: stats.hp,
    speed: stats.speed,

    /* --- 模块二：射手/精英的开火计时 --- */
    fireCd: 0.8 + Math.random() * 0.6,  // 出场后稍等再开第一枪
    attackHold: 0,                      // 精英开火时原地停住的剩余时间
    isBossMinion: false,
    bossOwnerId: 0,
    minionLife: 0,

    /* --- 自爆蛛 / 分裂体 --- */
    exploded: false,          // 自爆蛛或自爆词缀只炸一次
    fuseTimer: 0,             // >0 = 引信已点燃，倒计时结束才爆炸；期间停止移动
    mini: false,              // 分裂出来的微型追猎（不计入刷怪计划）

    /* --- 精英：模型与词缀 --- */
    eliteModel,               // 'attack' 扇形弹 / 'support' 光环
    eliteAffixes,             // 例如 ['shield', 'split']
    eliteShield: 0,           // 精英护盾当前值
    eliteShieldMax: 0,
    eliteShieldCd: ENEMY.ELITE.SHIELD_CD,
    eliteTeleportCd: ENEMY.ELITE.TELEPORT_CD,

    /* --- 第八阶段：元素状态（0 = 没挂） --- */
    fireStacks: 0,      // 灼烧层数
    fireTimer: 0,       // 灼烧剩余时间
    fireTickCD: 0,      // 下一次灼烧跳伤倒计时
    darkStacks: 0,      // 侵蚀层数
    darkTimer: 0,       // 侵蚀剩余时间
    darkTickCD: 0,      // 下一次侵蚀跳伤倒计时
    chillTimer: 0,      // 冰缓剩余时间
    chillMul: 1,        // 冰缓速度倍率（1 = 不减速）
    freezeTimer: 0,     // 冻结剩余时间（冻结期间不移动）
  };

  G.enemies.push(enemy);
  return enemy;
}

/**
 * 从指定位置生成一只分裂出来的小追猎。
 * 分裂体和精英的“分裂”词缀都用它，只是体型/血量倍率不同。
 * @param {number} x 出生点 x
 * @param {number} y 出生点 y
 * @param {number} hpMul 血量倍率
 * @param {number} speedMul 移速倍率
 * @param {number} rMul 体型倍率
 */
function spawnChaserChild(x, y, hpMul, speedMul, rMul) {
  if (G.enemies.length >= LIMITS.enemies) return null;

  const child = spawnEnemy('chaser');
  if (!child) return null;

  child.x = x;
  child.y = y;
  child.r = Math.max(3, child.r * rMul);
  child.hp *= hpMul;
  child.max *= hpMul;
  child.speed *= speedMul;
  child.mini = true;

  // 分裂出来的子怪永远是最普通的追猎者：不继承精英模型/词缀，也不会再分裂
  child.eliteModel = null;
  child.eliteAffixes = [];
  child.eliteShield = 0;
  child.isBossMinion = false;
  child.exploded = false;
  return child;
}

/**
 * d. 敌人：射手会走位、精英会停步开火、首领走专属招式；
 * 其余小怪朝玩家直线移动；贴到玩家身上且玩家不无敌就造成伤害。
 * 首领召唤的小怪有存活时间，时间到或主人死了就消失。
 * @param {number} dt 秒
 */
function updateEnemies(dt) {
  const p = G.p;

  // 本帧场上的首领（没有就是 null）；小怪光环加速要用它的位置
  const boss = G.enemies.find((e) => e.type === 'boss') || null;

  // 用本帧开始时的快照遍历：分裂/召唤即使往 G.enemies 里加了新怪，
  // 也不会改变这一圈的遍历长度，更不会出现“边遍历边生成”的失控
  const snapshot = G.enemies.slice();
  for (const e of snapshot) {
    if (e.dead || e.hp <= 0) continue;

    // 召唤物：先看主人还在不在，再扣存活时间
    if (e.isBossMinion) {
      const owner = G.enemies.find((o) => o.id === e.bossOwnerId);
      if (!owner || owner.hp <= 0) {
        e.hp = 0;
        continue;
      }
      e.minionLife -= dt;
      if (e.minionLife <= 0) {
        e.hp = 0;   // 直接消失，不算击杀、不给分
        continue;
      }
    }

    // 指向玩家的单位方向
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const len = Math.hypot(dx, dy);

    // 自爆蛛：进入 90px 不再立刻炸，而是点燃 0.65 秒引信。
    // 引信期间原地不动；倒计时结束才真正爆炸。
    let fuseStopped = false;
    if (e.type === 'bomber' && !e.exploded) {
      if (e.fuseTimer > 0) {
        e.fuseTimer -= dt;
        fuseStopped = true;

        if (e.fuseTimer <= 0) {
          e.fuseTimer = 0;
          damageEnemy(e, e.hp, COLORS.enemy);
          continue;
        }
      } else if (len < ENEMY.BOMBER.TRIGGER_DIST) {
        // 刚进入触发距离：只点火，本帧不扣血、不移动
        e.fuseTimer = ENEMY.BOMBER.FUSE;
        fuseStopped = true;
      }
    }

    // 辅助型精英的光环：附近小怪移速/攻速 +30%
    const support = G.enemies.find(
      (o) =>
        o !== e &&
        o.type === 'elite' &&
        o.eliteModel === 'support' &&
        Math.hypot(o.x - e.x, o.y - e.y) < ENEMY.ELITE.AURA_RADIUS
    );
    const auraRate = support ? ENEMY.ELITE.AURA_RATE_MUL : 1;

    // 精英词缀：护盾刷新 / 定时瞬移
    if (e.type === 'elite') updateEliteAffix(e, dt);

    // 先处理"开火"：射手/精英各自有冷却；首领按词缀·暴怒加速冷却推进
    const bossTick =
      e.type === 'boss' && e.affix === 'rage'
        ? dt * BOSS.AFFIX.RAGE_RATE_MUL
        : dt;

    if (e.type === 'shooter') {
      updateShooterAttack(e, len, dt * auraRate);
    } else if (e.type === 'elite') {
      updateEliteAttack(e, len, dt * auraRate);
    } else if (e.type === 'boss') {
      updateBossSkills(e, bossTick);
    }

    // 基础速度；小怪在首领光环范围内要加速
    let speed = e.speed;
    if (support) speed *= ENEMY.ELITE.AURA_SPEED_MUL;
    if (
      boss &&
      e !== boss &&
      Math.hypot(e.x - boss.x, e.y - boss.y) < BOSS.AURA.RADIUS
    ) {
      speed *= BOSS.AURA.SPEED_MUL;
    }

    // 冰缓：速度再乘 0.74；冻结：这一帧完全不移动
    if (e.chillTimer > 0) {
      speed *= e.chillMul;
    }
    if (e.freezeTimer > 0) {
      speed = 0;
    }

    // 射手走位：太近就后退（速度取负），中间停步，远了才靠近
    if (e.type === 'shooter' && speed > 0) {
      const cfg = ENEMY.SHOOTER;
      if (len < cfg.RETREAT_DIST) speed = -speed;
      else if (len <= cfg.STOP_DIST) speed = 0;
    }

    // 精英开火时原地停一小会儿
    if (e.type === 'elite' && e.attackHold > 0) {
      speed = 0;
    }

    // 自爆蛛的引信一旦点燃，就钉在原地等爆炸，不再追玩家
    if (fuseStopped) speed = 0;

    let charged = false;

    // 首领冲锋：预警结束后的 0.35s 沿锁定方向直线冲
    if (e.type === 'boss' && e.chargeTime > 0) {
      e.x += e.chargeDX * BOSS.SKILL.CHARGE_SPEED * dt;
      e.y += e.chargeDY * BOSS.SKILL.CHARGE_SPEED * dt;
      charged = true;

      // 第 3 轮的裂隙质变：冲锋路径每 0.06s 留下一个火焰节点
      if (e.bossRound >= 3 && bossArchetypeIndex(e) === 0) {
        e.flameTick -= dt;
        // 最多补 4 个节点，且间隔至少 0.016 秒；即使配置被改成 0 也不会卡死
        const flameGap = Math.max(0.016, BOSS.MUTATION.RIFT_FLAME_INTERVAL);
        for (let n = 0; n < 4 && e.flameTick <= 0; n++) {
          spawnFlameHazard(e.x, e.y);
          e.flameTick += flameGap;
        }
      }
    }

    // 预警期间站住不动，给玩家看红线
    if (e.type === 'boss' && e.chargeWarn > 0) {
      speed = 0;
    }

    // 普通移动（冲锋已经单独位移过，就不再叠加）
    if (!charged && len !== 0 && speed !== 0) {
      e.x += (dx / len) * speed * dt;
      e.y += (dy / len) * speed * dt;
    }

    // 敌人也夹在屏幕边界内，不会跑出墙外
    e.x = Math.max(ARENA.MARGIN_X, Math.min(CANVAS.WIDTH - ARENA.MARGIN_X, e.x));
    e.y = Math.max(ARENA.MARGIN_TOP, Math.min(CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM, e.y));

    // 首领每帧检查普通出招冷却（第 3 轮由质变接管）
    if (e.type === 'boss') {
      updateBossAttack(e, bossTick);
    }

    // 用移动后的位置算接触：两圆半径相加以内就算贴上
    const hitDx = p.x - e.x;
    const hitDy = p.y - e.y;
    if (Math.hypot(hitDx, hitDy) < e.r + PLAYER.radius && p.inv <= 0) {
      p.hp -= PLAYER.hurtDamage;         // 受击统一扣固定伤害
      p.hits++;                          // 记一次被打中
      p.inv = PLAYER.hurtInv;            // 给一段无敌，避免一帧被多只怪连续扣血
      p.hurtFlash = PLAYER.hurtInv;      // 只有真受伤才闪红晕，冲刺无敌不闪
      sfxHurt();                         // 受伤音效（低频"嗡"）
      G.roomHurt = true;                 // 本房被击中，无伤奖励没了
    }
  }
}

/**
 * 首领危险区：火焰节点 / 收缩冰环 / 激光。
 * 每帧推进寿命、收缩半径，并检测玩家是否碰到；碰到统一扣 20。
 * 危险区不会因为命中一次就消失，玩家靠受击后的无敌帧躲开连续判定。
 * @param {number} dt 秒
 */
function updateBossHazards(dt) {
  const p = G.p;
  const m = BOSS.MUTATION;

  for (let i = G.bossHazards.length - 1; i >= 0; i--) {
    const h = G.bossHazards[i];
    h.age += dt;

    // 冰环从 600 线性收缩到 0；缩到 0 就删除
    if (h.kind === 'iceRing') {
      h.radius -= (m.FROST_RING_START_RADIUS / m.FROST_RING_LIFE) * dt;
    }

    // 寿命到 / 冰环缩完 → 删除
    const dead =
      h.kind === 'iceRing'
        ? h.radius <= 0 || h.age >= h.life
        : h.kind === 'laser'
          ? h.age >= h.warn + h.active
          : h.age >= h.life;

    if (dead) {
      G.bossHazards.splice(i, 1);
      continue;
    }

    // 无敌帧内不做任何危险区判定
    if (p.inv > 0) continue;

    const dx = p.x - h.x;
    const dy = p.y - h.y;
    const dist = Math.hypot(dx, dy);
    let hit = false;

    if (h.kind === 'flame') {
      hit = dist < h.r + p.r;
    } else if (h.kind === 'iceRing') {
      // 环带内才算；如果玩家处在缺口角度里，就能安全穿过去
      let rel = Math.atan2(dy, dx) - h.gapStart;
      rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const inGap = rel < h.gapSize;
      hit = !inGap && Math.abs(dist - h.radius) <= h.width / 2 + p.r;
    } else if (h.kind === 'thunder') {
      // 红圈预警期间不伤人，只有真正劈下来的 0.18 秒内才算命中
      const active = h.age >= h.warn && h.age < h.warn + h.active;
      if (active) hit = dist < h.r + p.r;
    } else if (h.kind === 'laser') {
      // 只有预警结束后的 0.35 秒才会伤人
      const active = h.age >= h.warn && h.age < h.warn + h.active;
      if (active) {
        const cos = Math.cos(h.angle);
        const sin = Math.sin(h.angle);
        const along = dx * cos + dy * sin;       // 沿激光方向的距离
        const perp = Math.abs(-dx * sin + dy * cos); // 到激光中线的垂直距离
        hit =
          along >= 0 &&
          along <= h.length &&
          perp <= h.width / 2 + p.r;
      }
    }

    if (hit) {
      p.hp -= PLAYER.hurtDamage;
      p.hits++;
      p.inv = PLAYER.hurtInv;
      p.hurtFlash = PLAYER.hurtInv;
      sfxHurt();
      G.roomHurt = true;
    }
  }
}

/**
 * 首领瞬移残影：只负责寿命倒数，没有碰撞，纯视觉。
 * @param {number} dt 秒
 */
function updateBossGhosts(dt) {
  for (let i = G.bossGhosts.length - 1; i >= 0; i--) {
    G.bossGhosts[i].life -= dt;
    if (G.bossGhosts[i].life <= 0) G.bossGhosts.splice(i, 1);
  }
}

/**
 * h. 敌方子弹：往前飞、寿命递减、出屏删除；打中不无敌的玩家就扣血。
 * 数量超过硬上限时，先丢掉最旧的几发（防止 Boss 刷屏把数组撑爆）。
 * @param {number} dt 秒
 */
function updateHostile(dt) {
  const p = G.p;

  // 数组超过硬上限：从最旧（下标 0）开始删
  while (G.hostile.length > LIMITS.hostileShots) {
    G.hostile.shift();
  }

  // 倒序遍历：删除元素时不会打乱还没处理的索引
  for (let i = G.hostile.length - 1; i >= 0; i--) {
    const h = G.hostile[i];

    // 追踪球：每帧最多转 turnRate 弧度，慢慢拐向玩家
    if (h.homing) {
      const want = Math.atan2(p.y - h.y, p.x - h.x);
      const now = Math.atan2(h.vy, h.vx);
      let diff = want - now;

      // 把角度差夹到 -π..π，避免从 179° 转 358° 这种绕远路
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      const maxTurn = (h.turnRate || 0) * dt;
      if (diff > maxTurn) diff = maxTurn;
      else if (diff < -maxTurn) diff = -maxTurn;

      const angle = now + diff;
      h.vx = Math.cos(angle) * (h.speed || 0);
      h.vy = Math.sin(angle) * (h.speed || 0);
    }

    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.life -= dt;

    // 寿命到 / 飞出屏幕 → 删除
    if (
      h.life <= 0 ||
      h.x < 0 ||
      h.x > CANVAS.WIDTH ||
      h.y < 0 ||
      h.y > CANVAS.HEIGHT
    ) {
      G.hostile.splice(i, 1);
      continue;
    }

    // 打中玩家：玩家半径 + 敌弹半径以内，且玩家不在无敌帧
    if (
      p.inv <= 0 &&
      Math.hypot(p.x - h.x, p.y - h.y) < p.r + (h.r || HOSTILE.RADIUS)
    ) {
      // 只有虚空大球会分裂；小球只带 voidChild，不会继续分裂
      const splitsIntoChildren = h.voidOrb && !h.voidChild;

      p.hp -= PLAYER.hurtDamage;
      p.hits++;
      p.inv = PLAYER.hurtInv;
      p.hurtFlash = PLAYER.hurtInv;
      sfxHurt();
      G.roomHurt = true;
      G.hostile.splice(i, 1);

      // 在命中点分裂成 2 发小球
      if (splitsIntoChildren) spawnVoidSplitChildren(h);
    }
  }
}

/**
 * 嗜血：攻速倍率 = 基础 + 击杀数 × 每杀加成，封顶。
 * 没有装备时返回 1（冷却不缩放）。
 */
function bloodthirstRateMul() {
  const level = relicLevel('bloodthirst');
  if (!level) return 1;

  const cfg = WEAPON.BLOODTHIRST;
  const base = cfg.RATE_BASE[level - 1];
  const perKill = cfg.RATE_PER_KILL[level - 1];
  const cap = cfg.RATE_CAP[level - 1];
  const kills = Math.min(G.p.bloodthirstKills, cfg.KILL_CAP[level - 1]);
  return Math.min(cap, base + kills * perKill);
}

/**
 * 闪电链接：一次有效命中后，从命中点向范围内最近的若干敌人链伤害。
 * 有公共冷却 G.lightningCD，避免同一帧每颗子弹都触发。
 * 同时把「命中点 → 链目标 1 → 链目标 2…」的折线记进 G.lightningArcs，
 * 由 canvas 画出来（纯视觉，不参与结算）。
 */
function triggerLightning(hitEnemy, baseDamage) {
  const level = relicLevel('lightningLink');
  if (!level || G.lightningCD > 0) return;

  const cfg = WEAPON.LIGHTNING[level - 1];

  // 候选：还活着的其它敌人，按离命中点的距离从近到远
  const candidates = G.enemies
    .filter(
      (e) =>
        e.hp > 0 &&
        e.id !== hitEnemy.id &&
        Math.hypot(e.x - hitEnemy.x, e.y - hitEnemy.y) <= cfg.range
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - hitEnemy.x, a.y - hitEnemy.y) -
        Math.hypot(b.x - hitEnemy.x, b.y - hitEnemy.y)
    );

  // 折线从命中敌人出发，每链中一只就接到它的位置
  const points = [{ x: hitEnemy.x, y: hitEnemy.y }];
  let fromX = hitEnemy.x;
  let fromY = hitEnemy.y;

  let chained = 0;
  for (const e of candidates) {
    if (chained >= cfg.targets) break;
    damageEnemy(e, baseDamage * cfg.damageMul, COLORS.ice);
    points.push(...jaggedLightningPoints(fromX, fromY, e.x, e.y));
    fromX = e.x;
    fromY = e.y;
    chained++;
  }

  // 至少链到 1 个才进冷却；一个都没有就留给下一次命中
  if (chained > 0) {
    G.lightningCD = cfg.cd;

    // 超过同屏上限就丢掉最旧的一条
    G.lightningArcs.push({
      points,
      life: LIGHTNING_FX.LIFE,
      maxLife: LIGHTNING_FX.LIFE,
    });
    while (G.lightningArcs.length > LIGHTNING_FX.MAX_ARCS) {
      G.lightningArcs.shift();
    }
  }
}

/**
 * 把一段直线切成若干小段，并在垂直方向随机抖动，生成"闪电"折线。
 * 返回的数组不含起点，包含终点，方便直接接到已有折线后面。
 */
function jaggedLightningPoints(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  // 垂直于这段线的单位向量，抖动就加在它上面，线才不会整体跑偏
  const nx = -dy / len;
  const ny = dx / len;

  const out = [];
  for (let k = 1; k < LIGHTNING_FX.SEGMENTS; k++) {
    const t = k / LIGHTNING_FX.SEGMENTS;
    const jitter = (Math.random() * 2 - 1) * LIGHTNING_FX.JITTER;
    out.push({
      x: fromX + dx * t + nx * jitter,
      y: fromY + dy * t + ny * jitter,
    });
  }
  out.push({ x: toX, y: toY });
  return out;
}

/** 闪电折线寿命递减，到 0 删除。 */
function updateLightningArcs(dt) {
  for (let i = G.lightningArcs.length - 1; i >= 0; i--) {
    const arc = G.lightningArcs[i];
    arc.life -= dt;
    if (arc.life <= 0) G.lightningArcs.splice(i, 1);
  }
}

/**
 * 命中裂变：命中瞬间先把子子弹要用的数据算好（坐标 = 受击点附近随机错开，
 * 方向以父弹速度为基准 ±spread 均分），等父弹处理完再同一帧 push 进 G.shots。
 * 子弹带 child=true，之后不再触发任何遗物 / 附魔 / 阈值。
 */
function buildFissionBullets(shot, hitEnemy) {
  const level = relicLevel('hitFission');
  if (!level) return null;

  const cfg = WEAPON.FISSION[level - 1];

  // 父弹速度方向；极端情况下速度为 0，就退回"从父弹指向受击点"
  const speed = Math.hypot(shot.vx, shot.vy);
  const baseAngle =
    speed > 0
      ? Math.atan2(shot.vy, shot.vx)
      : Math.atan2(hitEnemy.y - shot.y, hitEnemy.x - shot.x);

  const step = cfg.count > 1 ? (cfg.spread * 2) / (cfg.count - 1) : 0;
  const out = [];

  for (let i = 0; i < cfg.count; i++) {
    const angle = baseAngle - cfg.spread + step * i;
    const damage = shot.baseDamage * cfg.damageMul;

    out.push({
      // 每轴随机错开 ±SPAWN_OFFSET：不要和刚打中的敌人重叠，否则下一帧立刻又判中它
      x:
        hitEnemy.x +
        (Math.random() * 2 - 1) * FISSION_FX.SPAWN_OFFSET,
      y:
        hitEnemy.y +
        (Math.random() * 2 - 1) * FISSION_FX.SPAWN_OFFSET,
      vx: Math.cos(angle) * SHOT.SPEED,
      vy: Math.sin(angle) * SHOT.SPEED,
      life: cfg.life,
      damage,
      baseDamage: damage,
      hitsLeft: 1,
      hitCount: 0,
      hitIds: new Set(),
      // 出生保护：刚生成时忽略刚打中的敌人，并短暂不参与任何碰撞
      ignoreEnemyId: hitEnemy.id,
      spawnInvulnerability: FISSION_FX.SPAWN_INVULN,
      color: shot.color,
      child: true, // 子子弹：不再触发遗物 / 附魔 / 计数
    });
  }

  return out;
}

/** 把算好的裂变子弹立刻放进场上（同一帧可见），并受硬上限裁剪。 */
function pushFissionBullets(bullets) {
  if (!bullets || bullets.length === 0) return;
  for (const b of bullets) G.shots.push(b);

  // 子子弹同样受玩家子弹硬上限约束
  while (G.shots.length > LIMITS.playerShots) {
    G.shots.shift();
  }
}

/**
 * f. 自动 / 手动攻击：冷却好了就开火。
 * 自动：锁定(存活) > 首领 > 最近；手动：锁定(存活) > 鼠标瞄准点。
 * 三向散射按等级决定发数与伤害；穿透按等级决定可命中数。
 * @param {number} dt 秒（签名统一，暂未用到）
 */
function updateAttack(dt) {
  const p = G.p;
  if (p.cool > 0) return; // 冷却中

  // 锁定目标死了就清掉，避免一直挂着一个打不到的目标
  if (
    p.attackTarget != null &&
    !G.enemies.some((e) => e.id === p.attackTarget && e.hp > 0)
  ) {
    p.attackTarget = null;
  }

  let target = null;
  let aimX = 0;
  let aimY = 0;

  if (G.autoAttack) {
    // 自动模式第一层：中键锁定的活目标
    if (p.attackTarget != null) {
      target = G.enemies.find((e) => e.id === p.attackTarget && e.hp > 0) || null;
    }
    if (target) {
      aimX = target.x;
      aimY = target.y;
    } else {
      // 自动模式：首领优先，否则最近
      let boss = null;
      for (const e of G.enemies) {
        if (e.hp > 0 && e.type === 'boss') {
          boss = e;
          break;
        }
      }

      if (boss) {
        target = boss;
        aimX = boss.x;
        aimY = boss.y;
      } else {
        let best = Infinity;
        for (const e of G.enemies) {
          if (e.hp <= 0) continue;
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < best) {
            best = d;
            target = e;
          }
        }
        if (!target) return; // 自动模式没敌人就不开火
        aimX = target.x;
        aimY = target.y;
      }
    }
  } else {
    // 手动模式：不看锁定，左键没按着就不射击；按着就朝鼠标瞄准点持续开火
    if (!G.mouseDown) return;
    aimX = p.aimX;
    aimY = p.aimY;
  }

  // 子弹基础方向 = 从玩家指向目标（或鼠标瞄准点）
  const dx = aimX - p.x;
  const dy = aimY - p.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return; // 完全重合，这一帧不开火

  const baseAngle = Math.atan2(dy, dx);

  // 子弹颜色跟当前星核走：没选核心时用默认黄色
  let shotColor = COLORS.shot;
  if (p.core === 'fire') shotColor = COLORS.fire;
  else if (p.core === 'ice') shotColor = COLORS.ice;
  else if (p.core === 'dark') shotColor = COLORS.dark;

  // 三向散射：等级决定发数 / 偏移 / 每发伤害倍率；没装备就是单发满伤
  const tripleLevel = relicLevel('tripleShot');
  const tripleCfg = tripleLevel ? WEAPON.TRIPLE_SHOT[tripleLevel - 1] : null;

  // 穿透：等级决定可命中数，以及第 2 次起的伤害倍率
  const pierceLevel = relicLevel('piercing');
  const pierceCfg = pierceLevel ? WEAPON.PIERCE[pierceLevel - 1] : null;

  // 回旋镖：所有主弹都变成回旋镖
  const boomerangLevel = relicLevel('boomerangCore');
  const boomerangCfg = boomerangLevel ? WEAPON.BOOMERANG : null;

  // 追踪：记录转向参数，updateShots 每帧调用
  const homingLevel = relicLevel('homing');
  const homingCfg = homingLevel ? WEAPON.HOMING[homingLevel - 1] : null;

  const count = tripleCfg ? tripleCfg.count : 1;

  for (let k = 0; k < count; k++) {
    const offset = tripleCfg ? tripleCfg.offsets[k] : 0;
    const mul = tripleCfg ? tripleCfg.muls[k] : 1;
    const angle = baseAngle + offset;
    const damage = p.damage * mul;

    const shot = {
      x: p.x,
      y: p.y,
      vx: Math.cos(angle) * SHOT.SPEED,
      vy: Math.sin(angle) * SHOT.SPEED,
      life: SHOT.LIFE,
      damage,
      baseDamage: damage,
      hitsLeft: pierceCfg ? pierceCfg.hits : 1,
      hitCount: 0,
      pierceDamageMul: pierceCfg ? pierceCfg.damageMul : 1,
      hitIds: new Set(), // 已经打过的敌人 id，防止穿透时重复结算
      color: shotColor,
      child: false,
    };

    // 回旋镖状态机：出程 → 返程 → 缓冲 → 追踪游离。
    // 独立 returnHitIds 让返程/缓冲能再打一次出程打过的敌人。
    if (boomerangCfg) {
      shot.phase = 'OUTGOING';
      shot.boomerangTime = 0;
      shot.spawnX = p.x;
      shot.spawnY = p.y;
      shot.rangeMul = boomerangCfg.RANGE_MUL[boomerangLevel - 1];
      shot.returnHitIds = new Set();
      shot.returnSpeedMul = boomerangCfg.SPEED_MUL[boomerangLevel - 1];
      shot.returnDamageMul = boomerangCfg.DAMAGE_MUL[boomerangLevel - 1];
      shot.bufferTraveled = 0;
      shot.freeTraveled = 0;
      shot.ricochetTimer = 0;
      shot.hasPierce = !!pierceCfg;
      // 有没有追踪只决定游离段能不能转向；纯回旋保持直线
      shot.hasHoming = !!homingCfg;
      if (homingCfg) {
        shot.homingRange = homingCfg.range;
        shot.homingTurn = homingCfg.turnRate;
      }
      // 一次完整回旋要走：出程 + 返程 + 180 缓冲 + 320×倍率游离，
      // 原来的 SHOT.LIFE 不够，按最远路径把寿命延长到至少够飞完
      const extraLife =
        (boomerangCfg.BUFFER_DIST +
          boomerangCfg.FREE_DIST * shot.rangeMul) /
        SHOT.SPEED;
      shot.life = Math.max(shot.life, SHOT.LIFE + extraLife);
    } else if (homingCfg) {
      // 普通追踪弹：只记追踪参数，updateShots 里每帧调用
      shot.homingRange = homingCfg.range;
      shot.homingTurn = homingCfg.turnRate;
    }

    G.shots.push(shot);
  }

  sfxShoot(); // 开火音效（短促高频"哔"，一次齐射只响一声）

  // 嗜血：冷却 = 基础间隔 / 攻速倍率（倍率越大越快）
  p.cool = p.rate / bloodthirstRateMul();

  // 子弹超过硬上限就丢掉最旧的
  while (G.shots.length > LIMITS.playerShots) {
    G.shots.shift();
  }
}

/** 让一颗追踪弹朝射程内最近的敌人转向；速度大小不变。
 *  exclude 里的敌人不会再被选为目标（游离阶段用来只追没打过的）。 */
function steerHomingShot(s, dt, exclude = null) {
  let nearest = null;
  let best = s.homingRange;

  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    if (exclude && exclude.has(e.id)) continue;
    const d = Math.hypot(e.x - s.x, e.y - s.y);
    if (d <= best) {
      best = d;
      nearest = e;
    }
  }
  if (!nearest) return;

  const targetAngle = Math.atan2(nearest.y - s.y, nearest.x - s.x);
  const currentAngle = Math.atan2(s.vy, s.vx);

  // 把角度差折到 [-π, π]，每帧最多转 homingTurn × dt 弧度
  let diff = targetAngle - currentAngle;
  diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

  const maxTurn = s.homingTurn * dt;
  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
  const angle = currentAngle + turn;
  const speed = Math.hypot(s.vx, s.vy);

  s.vx = Math.cos(angle) * speed;
  s.vy = Math.sin(angle) * speed;
}

/** 把回旋镖切到返程：速度改成返程倍率，并立刻朝玩家方向。 */
function beginBoomerangReturn(s) {
  s.phase = 'RETURNING';
  s.done = false;

  const p = G.p;
  const angle = Math.atan2(p.y - s.y, p.x - s.x);
  const speed = SHOT.SPEED * s.returnSpeedMul;
  s.vx = Math.cos(angle) * speed;
  s.vy = Math.sin(angle) * speed;
}

/** 朝指定点转向，最多转 maxTurn 弧度；速度大小保持不变。 */
function turnVelocityToward(s, tx, ty, maxTurn) {
  const targetAngle = Math.atan2(ty - s.y, tx - s.x);
  const currentAngle = Math.atan2(s.vy, s.vx);

  let diff = targetAngle - currentAngle;
  diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
  const angle = currentAngle + turn;
  const speed = Math.hypot(s.vx, s.vy);

  s.vx = Math.cos(angle) * speed;
  s.vy = Math.sin(angle) * speed;
}

/** 找附近最近、还没被这颗子弹打过的活敌；没有就返回 null。 */
function nearestUnhitEnemy(x, y, exclude, range) {
  let nearest = null;
  let best = range;

  for (const e of G.enemies) {
    if (e.hp <= 0 || exclude.has(e.id)) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= best) {
      best = d;
      nearest = e;
    }
  }
  return nearest;
}

/** 返程到家：不再删除，一律进入缓冲直飞；之后由 enterHomingFree 决定索敌还是收尾。 */
function finishBoomerangReturn(s) {
  s.phase = 'BUFFER';
  s.bufferTraveled = 0;
}

/** 缓冲飞满：统一进入游离段，有没有目标交给后续飞行判断。 */
function enterHomingFree(s) {
  s.phase = 'HOMING_FREE';
  s.freeTraveled = 0;
  s.ricochetTimer = 0;
}

/** 回旋镖四阶段飞行：出程 / 返程 / 缓冲 / 追踪游离。 */
function moveBoomerang(s, dt) {
  const p = G.p;
  const cfg = WEAPON.BOOMERANG;

  if (s.phase === 'OUTGOING') {
    s.boomerangTime += dt;

    if (s.hasHoming) {
      // 出程也允许追踪（阶段 A 可追）；纯回旋出程仍直飞 + 微弧
      steerHomingShot(s, dt);
    } else if (s.boomerangTime > cfg.STRAIGHT_TIME) {
      // 直飞时间过后，速度方向每秒偏 0.06 弧度，形成很缓的弧线
      const angle = Math.atan2(s.vy, s.vx) + cfg.ARC_RATE * dt;
      const speed = Math.hypot(s.vx, s.vy);
      s.vx = Math.cos(angle) * speed;
      s.vy = Math.sin(angle) * speed;
    }

    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // 射程随等级增加：Lv1 150 / Lv2 195 / Lv3 240
    const maxDist = cfg.MAX_DIST * s.rangeMul;
    if (Math.hypot(s.x - s.spawnX, s.y - s.spawnY) >= maxDist) {
      beginBoomerangReturn(s);
    }
    return;
  }

  if (s.phase === 'RETURNING') {
    // 返程绝不追踪敌人，只朝玩家转
    turnVelocityToward(s, p.x, p.y, cfg.RETURN_TURN * dt);

    // 返程速度固定
    const returnSpeed = SHOT.SPEED * s.returnSpeedMul;
    const currentSpeed = Math.hypot(s.vx, s.vy) || 1;
    s.vx = (s.vx / currentSpeed) * returnSpeed;
    s.vy = (s.vy / currentSpeed) * returnSpeed;

    const before = Math.hypot(s.x - p.x, s.y - p.y);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const after = Math.hypot(s.x - p.x, s.y - p.y);

    // 到家：进入半径内，或者刚越过玩家、开始远离
    const movingAway = (s.x - p.x) * s.vx + (s.y - p.y) * s.vy > 0;
    if (after <= cfg.RETURN_DONE_RADIUS || (movingAway && after < before)) {
      finishBoomerangReturn(s);
    }
    return;
  }

  if (s.phase === 'BUFFER') {
    // 缓冲：保持当前方向直飞，不追踪
    const speed = Math.hypot(s.vx, s.vy);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.bufferTraveled += speed * dt;

    if (s.bufferTraveled >= cfg.BUFFER_DIST) {
      // 飞满缓冲一律进入游离段；纯回旋也进去，只是之后保持直线
      enterHomingFree(s);
    }
    return;
  }

  // HOMING_FREE：有追踪才转向；纯回旋保持直线飞行
  if (s.hasHoming) {
    if (s.ricochetTimer > 0) {
      s.ricochetTimer -= dt;
    } else {
      steerHomingShot(s, dt, s.hitIds);
    }
  }

  const freeSpeed = Math.hypot(s.vx, s.vy);
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.freeTraveled += freeSpeed * dt;

  // 游离射程同样乘等级倍率：耗尽直接销毁，不再飞回玩家
  if (s.freeTraveled >= cfg.FREE_DIST * s.rangeMul) {
    s.done = true;
  }
}

/**
 * g. 玩家子弹：飞行、追踪 / 回旋、命中结算、穿透 / 裂变 / 闪电 / 汲取。
 * 回旋镖按阶段决定去重集合与伤害；出屏立刻删除（含返程）。
 * 裂变子弹在命中这一帧就推进 G.shots，观感没有延迟。
 * @param {number} dt 秒
 */
function updateShots(dt) {
  // 闪电链公共冷却：每帧递减，到 0 才能再次触发
  G.lightningCD = Math.max(0, G.lightningCD - dt);

  // 倒序遍历：删除元素时不会打乱还没处理的索引
  for (let i = G.shots.length - 1; i >= 0; i--) {
    const s = G.shots[i];

    // 裂变子弹出生保护：先递减，再在碰撞前判断
    if (s.spawnInvulnerability > 0) {
      s.spawnInvulnerability = Math.max(0, s.spawnInvulnerability - dt);
    }
    const spawnSafe = s.spawnInvulnerability > 0;

    // 运动：回旋镖走四段状态机 / 追踪弹转向 / 普通直线弹
    if (s.phase) {
      moveBoomerang(s, dt);

      // 没有追踪的回旋镖到家后标记删除
      if (s.done) {
        G.shots.splice(i, 1);
        continue;
      }
    } else {
      if (s.homingRange) steerHomingShot(s, dt);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }

    s.life -= dt;

    // 寿命到 / 飞出屏幕 → 删除（回旋镖出屏也立刻回收）
    if (
      s.life <= 0 ||
      s.x < 0 ||
      s.x > CANVAS.WIDTH ||
      s.y < 0 ||
      s.y > CANVAS.HEIGHT
    ) {
      G.shots.splice(i, 1);
      continue;
    }

    // 子弹拖尾：每颗子弹每帧留 1 个粒子，最多到硬上限（不挤掉旧粒子）
    if (G.sparks.length < LIMITS.sparks) {
      G.sparks.push({
        x: s.x,
        y: s.y,
        vx: -s.vx * 0.06 + (Math.random() - 0.5) * 16,
        vy: -s.vy * 0.06 + (Math.random() - 0.5) * 16,
        life: 0.22,
        maxLife: 0.22,
        size: 1.6,
        color: s.color,
      });
    }

    // 出生保护期内只飞不判中，保证先离开受击点
    if (spawnSafe) continue;

    // 返程和缓冲共用 returnHitIds：出程打过的敌人，返程还能再打一次
    const isReturning = s.phase === 'RETURNING' || s.phase === 'BUFFER';
    const isHomingFree = s.phase === 'HOMING_FREE';

    // 和每只敌人做圆-圆碰撞：距离 < 敌人半径 + 子弹半径 就算命中
    for (let j = 0; j < G.enemies.length; j++) {
      const e = G.enemies[j];

      // 同帧前面的子弹已经把它打死了：尸体不再吃命中/计数/音效
      if (e.hp <= 0) continue;

      // 裂变子弹出生时忽略刚打中的敌人，避免同一只怪被"父弹 + 子弹出膛"连吃
      if (s.ignoreEnemyId === e.id) continue;

      // 去重：返程/缓冲用 returnHitIds，其余阶段用 hitIds
      if (isReturning) {
        if (s.returnHitIds.has(e.id)) continue;
      } else if (s.hitIds.has(e.id)) {
        continue;
      }

      if (Math.hypot(e.x - s.x, e.y - s.y) < e.r + SHOT.RADIUS) {
        // 伤害按阶段结算
        let amount = s.damage;
        if (s.phase === 'RETURNING') {
          amount = s.baseDamage * s.returnDamageMul;
        } else if (s.phase === 'BUFFER') {
          amount = s.baseDamage;
        } else if (isHomingFree) {
          // 游离阶段：有穿透且不是第一次命中，才吃递减倍率
          amount =
            s.hasPierce && s.hitCount > 0
              ? s.baseDamage * s.pierceDamageMul
              : s.baseDamage;
        } else if (s.hitCount > 0) {
          // 出程 / 普通穿透弹：第 2 次起按递减倍率
          amount = s.baseDamage * s.pierceDamageMul;
        }

        // 统一伤害入口：扣血 + 黄色直伤飘字 + 死亡结算
        damageEnemy(e, amount, COLORS.direct);

        // 记下命中：返程/缓冲记 returnHitIds，其余记 hitIds
        if (isReturning) {
          s.returnHitIds.add(e.id);
        } else {
          s.hitIds.add(e.id);
          s.hitCount++;
        }

        sfxHit(); // 命中音效（短促"扑"）

        // 裂变参数先算好，父弹处理完再同一帧 push
        const fission = s.child ? null : buildFissionBullets(s, e);

        // 子子弹只是伤害，不再触发遗物 / 附魔 / 阈值
        if (!s.child) {
          // 生命汲取：这次是有效命中，按遗物等级回血（有每秒上限）
          applyLifesteal();

          // 元素附魔：命中即计数；元素混合还会额外施加副元素
          applyBulletEnchant(e, s.x, s.y);

          // 闪电链接：从命中点向周围最近的敌人链伤害
          triggerLightning(e, s.baseDamage);
        }

        // 命中后的子弹去留
        if (s.phase === 'OUTGOING') {
          // 出程用完可命中次数就折返；回旋镖本身不删除
          s.hitsLeft--;
          if (s.hitsLeft <= 0) beginBoomerangReturn(s);
        } else if (isHomingFree) {
          // 游离阶段不消耗 hitsLeft
          if (s.hasHoming) {
            // 有追踪：无穿透就找下一个弹射，没有就返程
            if (!s.hasPierce) {
              const next = nearestUnhitEnemy(
                e.x,
                e.y,
                s.hitIds,
                s.homingRange
              );
              if (next) {
                // 0.12 秒短暂直飞过去，计时结束再恢复追踪
                const angle = Math.atan2(next.y - e.y, next.x - e.x);
                const speed = Math.hypot(s.vx, s.vy);
                s.vx = Math.cos(angle) * speed;
                s.vy = Math.sin(angle) * speed;
                s.ricochetTimer = 0.12;
              } else {
                s.done = true; // 没有目标了，直接销毁，不再回旋
              }
            }
          } else if (!s.hasPierce) {
            // 纯回旋无穿透：打中一次就回收，避免一颗弹无限串糖葫芦
            s.done = true;
          }
          // 纯回旋 + 穿透：不转向、不删除，继续直线飞，靠 hitIds 去重
        } else if (!s.phase) {
          // 普通 / 穿透子弹：命中次数递减，用完就删
          s.hitsLeft--;
          if (s.hitsLeft <= 0) G.shots.splice(i, 1);
        }

        // 裂变子弹同一帧入场
        pushFissionBullets(fission);

        // 一颗子弹一帧只结算一只敌人，配合去重集合保证不漏不重
        break;
      }
    }
  }
}

/**
 * 子弹拖尾粒子：寿命递减、按速度漂移，寿命到就删除。
 * 粒子只用于视觉，不参与碰撞。
 * @param {number} dt 秒
 */
function updateSparks(dt) {
  for (let i = G.sparks.length - 1; i >= 0; i--) {
    const sp = G.sparks[i];
    sp.life -= dt;
    if (sp.life <= 0) {
      G.sparks.splice(i, 1);
      continue;
    }
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
  }
}

/**
 * 生命汲取：有效命中后按装备等级回血，1 秒窗口内最多回 12 点。
 * 窗口按"第一次命中"开始计时，过期后重新开窗；满血不存。
 */
function applyLifesteal() {
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
