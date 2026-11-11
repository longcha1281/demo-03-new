// ============================================================
// systems.js —— 主循环调度 + 房间/奖励/遗物库
// 逻辑层已拆成 player / enemy / boss / combat；这里只保留
// 输入、钩子、房间节奏、奖励、重开，以及每帧调用顺序。
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
import {
  setEnchantHooks,
  resetEnchant,
  updateEnchant,
} from './enchant.js';
import {
  input,
  updatePlayer,
  updatePickups,
  relicDef,
  relicLevel,
} from './player.js';
import { spawnEnemy, updateEnemies } from './enemy.js';
import {
  updateBossCountdown,
  updateBossHazards,
  updateBossGhosts,
} from './boss.js';
import {
  updateAttack,
  updateShots,
  updateSparks,
  updateHostile,
  updateLightningArcs,
  updateCombatTexts,
  damageEnemy,
  spawnCombatText,
  addShake,
} from './combat.js';

// enchant.js 是纯逻辑，不能直接记分 / 生成飘字 / 震屏；
// 把统一入口注进去：子弹、灼烧、侵蚀、爆发、黑洞全走 damageEnemy。
setEnchantHooks({
  damage: damageEnemy,
  text: spawnCombatText,
  shake: addShake,
});

/* ---------------- 输入状态 ---------------- */

export { input };

// 奖励面板回调。systems 是纯逻辑，不能碰 DOM；
// main.js 启动时通过 setRewardHook(showReward) 把 UI 函数注进来。
let rewardHook = null;

// 遗物装配室回调：选完卡进入 route 状态时，由 UI 弹出拖拽装配面板。
let routeHook = null;

// 副元素选择面板回调：第一次拿到「元素混合」时暂停游戏，让玩家选副附魔。
let secondaryHook = null;

/** 注册奖励面板回调（main.js 传入 screens.showReward）。 */
export function setRewardHook(fn) {
  rewardHook = fn;
}

/** 注册遗物装配室回调（main.js 传入 screens.showRoute）。 */
export function setRouteHook(fn) {
  routeHook = fn;
}

/** 注册副元素面板回调（main.js 传入 screens.showSecondarySelect）。 */
export function setSecondaryHook(fn) {
  secondaryHook = fn;
}

/** 找该类遗物的第一个空槽：普通 0–2，特殊只有 3。没有空槽返回 -1。 */
export function freeSlotFor(kind) {
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
export function acquireRelic(id) {
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

/**
 * 本房要生成多少只普通怪。
 * 第 1、2 房是固定数，之后按 9 + 1.6×wave 增长，封顶 COUNT_CAP。
 * @param {number} wave 第几房
 */
export function roomEnemyCount(wave) {
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
export function roomSpawnInterval(wave) {
  if (wave === 1) return SPAWN.ROOM1_INTERVAL;
  if (wave === 2) return SPAWN.ROOM2_INTERVAL;
  return Math.max(
    SPAWN.INTERVAL_MIN,
    SPAWN.INTERVAL_BASE - SPAWN.INTERVAL_PER_WAVE * wave
  );
}

/**
 * 生成本房怪物的类型序列（每个位置一只）。
 * 1–2 房用固定教学阵容，3 房起才进入随机概率池：
 * 3–4 房 20% 射手/分裂体 → 5–9 房 10% 自爆蛛 → 10 房起高比例。
 * @param {number} wave 第几房
 * @returns {string[]} 类型数组，例如 ['chaser', 'shooter', 'bomber']
 */
export function buildRoomPlan(wave) {
  // 第 1 房：10 追猎 + 1 射手 + 1 分裂体。
  // 把两只要教学的怪放在前几只，玩家很快就见到，而不是等到最后。
  if (wave === 1) {
    return [
      'chaser', 'chaser', 'chaser', 'shooter', 'chaser',
      'chaser', 'chaser', 'splitter', 'chaser', 'chaser',
      'chaser', 'chaser',
    ];
  }

  // 第 2 房：13 追猎 + 1 自爆蛛 + 1 射手，同样让新怪早一点出现。
  if (wave === 2) {
    return [
      'chaser', 'chaser', 'chaser', 'chaser', 'bomber',
      'chaser', 'chaser', 'chaser', 'chaser', 'chaser',
      'shooter', 'chaser', 'chaser', 'chaser', 'chaser',
    ];
  }

  // 3 房及以后：保持随机概率池
  const count = roomEnemyCount(wave);
  const plan = [];

  for (let i = 0; i < count; i++) {
    const roll = Math.random();

    if (wave <= 4) {
      // 3–4 房：约 20% 出射手/分裂体，80% 仍是追猎
      if (roll < SPAWN.EARLY_ROLL_SHOOTER) plan.push('chaser');
      else if (roll < SPAWN.EARLY_ROLL_SPLITTER) plan.push('shooter');
      else plan.push('splitter');
    } else if (wave <= 9) {
      // 5–9 房：自爆蛛约 10%，射手/分裂体逐步增多
      if (roll < SPAWN.MID_ROLL_CHASER) plan.push('chaser');
      else if (roll < SPAWN.MID_ROLL_SHOOTER) plan.push('shooter');
      else if (roll < SPAWN.MID_ROLL_SPLITTER) plan.push('splitter');
      else plan.push('bomber');
    } else {
      // 10 房起：恢复高比例机制怪
      if (roll < SPAWN.LATE_ROLL_CHASER) plan.push('chaser');
      else if (roll < SPAWN.LATE_ROLL_SHOOTER) plan.push('shooter');
      else if (roll < SPAWN.LATE_ROLL_SPLITTER) plan.push('splitter');
      else plan.push('bomber');
    }
  }

  return plan;
}

/**
 * 开始一房：清场、生成本房刷怪计划、重置首领状态与入场倒计时。
 * 首领房（wave % 3 === 0）开局有 3 秒倒计时，倒计时期间普通怪照常刷。
 * @param {number} wave 要开始的房号
 */
export function beginRoom(wave) {
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
export function finishRoom(kind) {
  const p = G.p;

  // 沙盒模式：清光怪也不回血、不加分、不弹选卡 / 装配室，方便反复刷怪测试
  if (G.isSandbox) return;

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
export function buildRelicCard(def, nextLevel) {
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
export function pickRelicCandidate(kind, used) {
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
export function openReward(kind) {
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
export function applyReward(card) {
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
 * c. 按本房计划刷怪：每次到点从 roomSpawnPlan 里取一只。
 * 计划取完就把 left 归 0，不再刷。场上满员时等一小会儿再重试。
 * @param {number} dt 秒
 */
export function updateSpawn(dt) {
  // 沙盒模式由 F2 面板手动刷怪，暂停本房自动刷怪，避免清完又自己冒出来
  if (G.isSandbox) return;

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
