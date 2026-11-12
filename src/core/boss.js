// boss.js —— 五种首领基础雏形：生成、移动/技能、危险区、受伤判定
// 按 (bossNumber - 1) % 5 轮换：1 裂隙、2 极寒、3 熔核、4 虚空、5 终焉。
// 本轮只做基础形态，不实现第二轮词缀和第三轮质变。
import { CANVAS, ARENA, LIMITS, ENEMY, ROOM, BOSS, CAMPAIGN, ADVANCED } from '../config.js';
import { G } from './state.js';
import { takeEnemyId, spawnEnemy } from './enemy.js';
import { hurtPlayer } from './player.js';

/** 五套基础配置按顺序排好，下标 0..4 正好对应第 1..5 只。 */
const FORMS = () => [BOSS.RIFT, BOSS.FROST, BOSS.MOLTEN, BOSS.VOID, BOSS.FINAL];

/**
 * 把任意首领序号折算成 0..4 的形态下标。
 * 第 1 只=0 裂隙，第 6 只又回到 0，符合“每 5 只一轮”的基础循环。
 * @param {number} bossNumber 第几只首领（从 1 开始）
 * @returns {number} 0..4
 */
export function bossFormIndex(bossNumber) {
  const n = Math.max(1, Math.floor(bossNumber || 1));
  return (n - 1) % 5;
}

/**
 * 取某一只首领的配置。
 * @param {number} bossNumber 第几只首领
 * @returns {object} 对应形态配置
 */
export function bossFormConfig(bossNumber) {
  return FORMS()[bossFormIndex(bossNumber)];
}

/**
 * 战役轮次：每 15 房（5 只首领）算一轮，只在正式战役里用。
 * @param {number} wave 第几房
 * @returns {number} 1..3（无尽模式会继续往上数）
 */
export function campaignRound(wave) {
  const roomsPerRound = ROOM.PER_ROUND * BOSS.BOSSES_PER_ROUND;
  return Math.ceil(Math.max(1, Math.floor(wave || 1)) / roomsPerRound);
}

/**
 * 房号换算成首领序号：每 3 房一只，floor((wave + 2) / 3)。
 * @param {number} wave 第几房
 * @returns {number} 第几只首领（从 1 开始）
 */
export function bossNumberForWave(wave) {
  return Math.max(1, Math.floor((Math.max(1, Math.floor(wave || 1)) + 2) / ROOM.PER_ROUND));
}

/**
 * 首领血量倍率：第 1 轮 ×1，第 2 轮 ×1.4，第 3 轮 ×1.85。
 * 无尽模式的第 16 只起在 1.85 倍上按序号缓慢增长，避免血量永远停滞。
 * @param {number} bossNumber 第几只首领
 * @returns {number} 血量倍率
 */
export function bossHpMultiplier(bossNumber) {
  const n = Math.max(1, Math.floor(bossNumber || 1));
  const round = Math.ceil(n / BOSS.BOSSES_PER_ROUND);
  if (round <= 1) return 1;
  if (round === 2) return BOSS.ROUND2_HP_MUL;

  const campaignBosses = CAMPAIGN.TOTAL_ROOMS / ROOM.PER_ROUND;
  const extra = Math.min(
    CAMPAIGN.ENDLESS_HP_CAP,
    Math.max(0, n - campaignBosses) * CAMPAIGN.ENDLESS_HP_GROWTH
  );
  return BOSS.ROUND3_HP_MUL * (1 + extra);
}

/**
 * 首领血量。不传参数时按裂隙刺客算，兼容旧测试/旧调用。
 * @param {number} bossNumber 第几只首领
 * @returns {number} 血量
 */
export function bossHp(bossNumber = 1) {
  const base = bossFormConfig(bossNumber).hp;
  return Math.round(base * bossHpMultiplier(bossNumber));
}

/**
 * 进阶轮次：每 5 场一组。15 场=第 3 轮，16 场起进入 R4，31 场起 R7。
 * @param {number} bossNumber 第几场 Boss
 * @returns {number} 3..7
 */
export function tierForBoss(bossNumber) {
  const n = Math.max(1, Math.floor(bossNumber || 1));
  return Math.min(7, Math.ceil(n / BOSS.BOSSES_PER_ROUND));
}

/**
 * 当前房 HUD 应显示的进阶轮次。
 * 普通房还没进下一场，按“下一场”预览；Boss 房进入时 bossEncounter 已经 +1，
 * 直接用它，不能再 +1，否则最后一场会提前跳到下一轮。
 * @param {number} wave 第几房
 * @param {number} bossEncounter 已进入的第几场 Boss
 * @returns {number} 3..7
 */
export function tierForRoom(wave, bossEncounter) {
  const n = Math.max(1, Math.floor(bossEncounter || 1));
  return tierForBoss(isBossRoomWave(wave) ? n : n + 1);
}

/**
 * 是不是 Boss 房。正式战役仍每 3 房一只；无尽 46–75 奇数房；
 * 第 76 房起全部是 Boss 房。
 * @param {number} wave 第几房
 * @returns {boolean}
 */
export function isBossRoomWave(wave) {
  const w = Math.max(1, Math.floor(wave || 1));
  if (w >= ADVANCED.R7_START_WAVE) return true;
  if (w > CAMPAIGN.TOTAL_ROOMS) return w % 2 === 1;
  return w % ROOM.PER_ROUND === 0;
}

/**
 * 是否处于 R7 绝对死亡。
 * @param {number} wave 第几房
 * @returns {boolean}
 */
export function isR7Wave(wave) {
  return Math.max(1, Math.floor(wave || 1)) >= ADVANCED.R7_START_WAVE;
}

/**
 * 在场地内随机取一个安全坐标，用于极寒霜卫的冰霜圈。
 * @returns {{x:number,y:number}} 坐标
 */
function randomArenaPoint() {
  return {
    x: ARENA.MARGIN_X + Math.random() * (CANVAS.WIDTH - ARENA.MARGIN_X * 2),
    y: ARENA.MARGIN_TOP + Math.random() * (CANVAS.HEIGHT - ARENA.MARGIN_TOP - ARENA.MARGIN_BOTTOM),
  };
}

/**
 * 生成本房首领。
 * 正常流程按“第几房 → 第几只首领”自动选形态；
 * F2 调试时可以直接传 1..5，强制刷出指定形态。
 * @param {number} [forcedNumber] 可选，强制首领序号
 * @param {object} [opts] 进阶覆盖：affix / ultimate / hpMul
 * @returns {object} 生成的 Boss 对象（已进 G.enemies）
 */
export function spawnBoss(forcedNumber, opts = {}) {
  const naturalNumber = bossNumberForWave(G.wave);
  const bossNumber = Math.max(1, Math.floor(forcedNumber || naturalNumber));
  const index = bossFormIndex(bossNumber);
  const cfg = FORMS()[index];
  const hp = opts.hpMul !== undefined
    ? Math.round(cfg.hp * opts.hpMul)
    : bossHp(bossNumber);

  /* 第 2 轮 6–10 只各抽 1 个词缀；第 3 轮 11–15 只启用对应形态的专属终极。
     进阶场次由调用方显式传入，避免和正式战役的抽法互相干扰。 */
  const round = Math.ceil(bossNumber / BOSS.BOSSES_PER_ROUND);
  const affix = opts.affix !== undefined
    ? opts.affix
    : (round === 2
      ? BOSS.AFFIX_POOL[Math.floor(Math.random() * BOSS.AFFIX_POOL.length)]
      : null);
  const ultimate = opts.ultimate !== undefined
    ? opts.ultimate
    : (round >= 3 ? index : null);

  const boss = {
    id: takeEnemyId(),
    type: 'boss',
    x: CANVAS.WIDTH / 2,
    y: ARENA.MARGIN_TOP + BOSS.SPAWN_OFFSET_Y,
    r: ENEMY.RADIUS.boss,
    hp,
    max: hp,
    speed: cfg.speed,
    archetype: cfg.name,       // HUD 血条上显示的名字
    bossIndex: index,          // 0 裂隙 / 1 极寒 / 2 熔核 / 3 虚空 / 4 终焉
    bossNumber,
    segments: cfg.segments || 12, // HUD 血条分几段

    /* --- 第 2 轮词缀 / 第 3 轮终极 --- */
    affix,                     // 'shield' | 'rage' | 'teleport' | null
    ultimate,                  // 0..4 = 形态终极；null = 第 1/2 轮不启用
    bossShield: 0,             // 词缀护盾 / 熔核装甲盾共用
    bossShieldMax: 0,
    bossShieldCd: 0,
    teleportCd: BOSS.AFFIX.TELEPORT_CD,
    teleportWarn: 0,
    ultThunderCd: BOSS.MUTATION.RIFT_THUNDER_CD,
    ultRingCd: BOSS.MUTATION.FROST_RING_CD,
    ultOrbCd: BOSS.MUTATION.VOID_ORB_CD,
    ultLaserCd: BOSS.MUTATION.FINAL_LASER_CD,
    riftFlameTimer: 0,

    /* --- 裂隙刺客 --- */
    slashCd: BOSS.RIFT.skillCd,
    trail: [],

    /* --- 裂隙刺客的短距突刺 --- */
    dashCd: BOSS.RIFT.dashCd,
    dashState: 'idle',
    dashTimer: 0,
    dashDirX: 0,
    dashDirY: 1,
    dashHit: false,

    /* --- 霜环裁决者 --- */
    zoneCd: BOSS.FROST.zoneCd,
    iceShotCd: BOSS.FROST.iceShotCd,
    iceWind: 0,                // 冰弹定格瞄准剩余时间
    iceAim: 0,                 // 定格时锁定的扇射方向
    frostRingCd: BOSS.FROST.ringCd,
    frostRingPause: 0,         // 断环裁决期间本体悬停、冰弹停火

    /* --- 熔核巨像 --- */
    magmaCd: BOSS.MOLTEN.magmaCd,
    armorExposed: 0,

    /* --- 虚空母巢 --- */
    voidSpawnCd: BOSS.VOID.spawnCd,
    wanderAngle: Math.random() * Math.PI * 2,
    voidAction: 'idle',
    voidActionTime: 0,
    voidOrbCd: BOSS.VOID.orbCd,
    voidAim: 0,
    voidStrafeDir: 1,
    voidRelease: 0,

    /* --- 终焉审判 --- */
    finalRingCd: BOSS.FINAL.ringCd,
    finalWarnCd: 0,

    /* --- 元素状态（首领不冻结，其余和普通怪一致） --- */
    fireStacks: 0,
    fireTimer: 0,
    fireTickCd: 0,
    darkStacks: 0,
    darkTimer: 0,
    darkTickCd: 0,
    chillTimer: 0,
    chillMul: 1,
    freezeTimer: 0,
  };

  // 护盾开局直接获得：词缀护盾 30%，熔核终极装甲盾 20%。
  if (affix === 'shield') {
    boss.bossShieldMax = hp * BOSS.AFFIX.SHIELD_RATIO;
    boss.bossShield = boss.bossShieldMax;
  } else if (ultimate === 2) {
    boss.bossShieldMax = hp * BOSS.MUTATION.SIEGE_SHIELD_RATIO;
    boss.bossShield = boss.bossShieldMax;
  }

  G.enemies.push(boss);

  return boss;
}

/**
 * 按进阶场次生成一桌 Boss：R4 单 Boss，R5–R7 双 Boss。
 * 双 Boss 第一只立即入场，第二只 3–5 秒后入场；同屏最多 2 只。
 * @param {number} encounter 第几场（G.bossEncounter）
 * @returns {object[]} 本帧已入场的 Boss
 */
export function spawnEncounterBosses(encounter) {
  const n = Math.max(1, Math.floor(encounter || 1));
  const tier = tierForBoss(n);
  G.bossPairSize = tier >= 5 ? 2 : 1;
  G.bossSpawnCountThisRoom = 0;
  G.bossDefeatedThisRoom = false;
  G.bossRewardClaimed = false;

  // R5 无词缀；R4 单词缀；R6/R7 只抽一次，两只共享。
  const affix = tier >= 6 || tier === 4
    ? BOSS.AFFIX_POOL[Math.floor(Math.random() * BOSS.AFFIX_POOL.length)]
    : null;

  if (tier < 5) {
    const boss = spawnBoss(n, { affix, ultimate: bossFormIndex(n) });
    G.bossSpawnCountThisRoom = 1;
    return [boss];
  }

  const hpMul = bossHpMultiplier(n) * ADVANCED.DUAL_HP_MUL;
  const first = spawnBoss(n, {
    affix,
    ultimate: bossFormIndex(n),
    hpMul,
  });
  G.bossSpawnCountThisRoom = 1;

  const secondNumber = n + 1;
  G.pendingBossSpawn = {
    number: secondNumber,
    delay:
      ADVANCED.SECOND_BOSS_DELAY_MIN +
      Math.random() * (ADVANCED.SECOND_BOSS_DELAY_MAX - ADVANCED.SECOND_BOSS_DELAY_MIN),
    affix,
    ultimate: bossFormIndex(secondNumber),
    hpMul,
  };

  return [first];
}

/**
 * 推进双 Boss 第二只的延迟入场。同屏已有 2 只时继续等，不生成第三只。
 * @param {number} dt 秒
 * @returns {object|null} 本帧新入场的 Boss
 */
export function updateBossSpawnQueue(dt) {
  const pending = G.pendingBossSpawn;
  if (!pending) return null;

  pending.delay -= dt;
  if (pending.delay > 0) return null;

  const alive = G.enemies.filter(
    (e) => e.type === 'boss' && e.hp > 0 && !e.dead
  ).length;
  if (alive >= 2) return null;

  G.pendingBossSpawn = null;
  const boss = spawnBoss(pending.number, {
    affix: pending.affix,
    ultimate: pending.ultimate,
    hpMul: pending.hpMul,
  });
  G.bossSpawnCountThisRoom++;
  return boss;
}

/**
 * 兼容旧接口：返回当前首领的形态下标。没有首领时返回 0。
 * @returns {number} 0..4
 */
export function bossArchetypeIndex(e) {
  return e && typeof e.bossIndex === 'number' ? e.bossIndex : 0;
}

/**
 * 首领房入场倒计时：到 0 刷 1 只 Boss 并给提示。
 * 倒计时期间普通怪照常刷（updateSpawn 不关心 Boss）。
 * @param {number} dt 秒
 */
export function updateBossCountdown(dt) {
  // 双 Boss 的第二只可能比第一只晚 3–5 秒，每帧都要推进。
  updateBossSpawnQueue(dt);

  // R7 绝对死亡：一对死完 3 秒补下一对，不推进房号。
  if (isR7Wave(G.wave)) {
    if (G.r7State === 'fighting' && G.bossDefeatedThisRoom) {
      G.r7State = 'respawning';
      G.r7RespawnTimer = ADVANCED.R7_RESPAWN_DELAY;
    }
    if (G.r7State === 'respawning') {
      G.r7RespawnTimer -= dt;
      if (G.r7RespawnTimer <= 0) {
        G.bossEncounter++;
        G.r7State = 'fighting';
        G.bossSpawnedThisRoom = true;
        spawnEncounterBosses(G.bossEncounter);
      }
      return;
    }
  }

  if (!isBossRoomWave(G.wave) || G.bossSpawnedThisRoom) return;

  G.bossCountdownRemaining -= dt;
  if (G.bossCountdownRemaining > 0) return;

  G.bossCountdownRemaining = 0;
  G.bossSpawnedThisRoom = true;

  let boss;
  if (G.endless) {
    boss = spawnEncounterBosses(G.bossEncounter)[0];
    if (isR7Wave(G.wave)) G.r7State = 'fighting';
  } else {
    boss = spawnBoss();
  }
  G.notice.text = '首领降临';
  G.notice.sub = boss.archetype;
  G.notice.timer = ROOM.NOTICE_TIME;
}

/**
 * 把一条危险区塞进 G.bossHazards；超过上限先删最旧的一条。
 * @param {object} hazard 危险区对象
 */
export function pushBossHazard(hazard) {
  if (G.bossHazards.length >= LIMITS.bossHazards) G.bossHazards.shift();
  G.bossHazards.push(hazard);
}

/**
 * 按形态推进首领技能。
 * 每只 Boss 自己管自己的计时器，彼此不会把状态搅在一起。
 * @param {object} e Boss
 * @param {number} dt 秒
 */
export function updateBossSkills(e, dt) {
  updateBossAffix(e, dt);

  if (e.bossIndex === 0) {
    updateRiftSkills(e, dt);
  } else if (e.bossIndex === 1) {
    updateFrostSkills(e, dt);
  } else if (e.bossIndex === 2) {
    updateMoltenSkills(e, dt);
  } else if (e.bossIndex === 3) {
    updateVoidSkills(e, dt);
  } else {
    updateFinalSkills(e, dt);
  }

  updateBossUltimate(e, dt);
}

/**
 * 词缀只影响冷却推进速度（暴怒），不直接乘在动作时长上，
 * 这样前摇/预警长度保持不变，玩家的躲避窗口不被压缩。
 */
function cooldownDt(e, dt) {
  return e.affix === 'rage' ? dt * BOSS.AFFIX.RAGE_RATE_MUL : dt;
}

/** 第 2 轮词缀：护盾到点重生；瞬移走“预警 → 落点 → 残影”状态机。 */
function updateBossAffix(e, dt) {
  if (e.affix === 'shield' && e.bossShield <= 0) {
    e.bossShieldCd = Math.max(0, (e.bossShieldCd || 0) - dt);
    if (e.bossShieldCd <= 0) {
      e.bossShieldMax = e.max * BOSS.AFFIX.SHIELD_RATIO;
      e.bossShield = e.bossShieldMax;
    }
  }

  if (e.affix !== 'teleport') return;

  // 预警 0.3 秒：残影闪烁，给玩家反应时间；到点才真正换位。
  if (e.teleportWarn > 0) {
    e.teleportWarn = Math.max(0, e.teleportWarn - dt);
    if (e.teleportWarn === 0) {
      // 预警期间若进入冲刺/终极前摇，放弃这次瞬移，等下一轮冷却。
      if (canBossTeleport(e)) teleportBoss(e);
      e.teleportCd = BOSS.AFFIX.TELEPORT_CD;
    }
    return;
  }

  e.teleportCd -= dt;
  if (e.teleportCd > 0 || !canBossTeleport(e)) return;
  e.teleportWarn = BOSS.AFFIX.TELEPORT_WARN;
}

/** 冲刺 / 缩圈 / 虚空出招期间不瞬移，避免打断已有前摇。 */
function canBossTeleport(e) {
  if (e.dashState && e.dashState !== 'idle') return false;
  if ((e.frostRingPause || 0) > 0) return false;
  if (e.voidAction && e.voidAction !== 'idle') return false;
  if (G.bossHazards.some(h => h.kind === 'finalWarn')) return false;
  return true;
}

/** 随机挑一个距玩家约 150px 且在场内的落点；挑不到就夹回场内。 */
function teleportBoss(e) {
  if (G.bossGhosts.length >= LIMITS.bossGhosts) G.bossGhosts.shift();
  G.bossGhosts.push({
    x: e.x,
    y: e.y,
    r: e.r,
    life: BOSS.AFFIX.GHOST_LIFE,
    maxLife: BOSS.AFFIX.GHOST_LIFE,
    color: FORMS()[e.bossIndex].color,
  });

  const minX = ARENA.MARGIN_X + e.r;
  const maxX = CANVAS.WIDTH - ARENA.MARGIN_X - e.r;
  const minY = ARENA.MARGIN_TOP + e.r;
  const maxY = CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM - e.r;
  let tx = e.x;
  let ty = e.y;
  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2;
    tx = G.p.x + Math.cos(angle) * BOSS.AFFIX.TELEPORT_DIST;
    ty = G.p.y + Math.sin(angle) * BOSS.AFFIX.TELEPORT_DIST;
    if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) break;
  }
  e.x = Math.max(minX, Math.min(maxX, tx));
  e.y = Math.max(minY, Math.min(maxY, ty));
}

/** 第 3 轮专属终极：每只首领只有对应形态的一种。 */
function updateBossUltimate(e, dt) {
  if (e.ultimate === null) return;
  if (e.ultimate === 0) updateRiftUltimate(e, dt);
  else if (e.ultimate === 1) updateFrostUltimate(e, dt);
  else if (e.ultimate === 3) updateVoidUltimate(e, dt);
  else if (e.ultimate === 4) updateFinalUltimate(e, dt);
  // 熔核（2）的护盾在 spawnBoss / combat 破盾里处理，没有周期技。
}

/** 裂隙：每 3 秒在玩家脚下落雷，0.8 秒红圈预警后才判定。 */
function updateRiftUltimate(e, dt) {
  e.ultThunderCd = Math.max(0, e.ultThunderCd - dt);
  if (e.ultThunderCd > 0) return;
  const m = BOSS.MUTATION;
  e.ultThunderCd = m.RIFT_THUNDER_CD;
  pushBossHazard({
    kind: 'thunder',
    x: G.p.x,
    y: G.p.y,
    r: m.RIFT_THUNDER_RADIUS,
    warn: m.RIFT_THUNDER_WARN,
    active: m.RIFT_THUNDER_ACTIVE,
    age: 0,
    life: m.RIFT_THUNDER_WARN + m.RIFT_THUNDER_ACTIVE,
  });
}

/** 极寒：每 7 秒一圈从 600 收缩到 0 的冰环，留 1 弧度缺口。 */
function updateFrostUltimate(e, dt) {
  e.ultRingCd = Math.max(0, e.ultRingCd - dt);
  if (e.ultRingCd > 0) return;
  const m = BOSS.MUTATION;
  e.ultRingCd = m.FROST_RING_CD;
  pushBossHazard({
    kind: 'iceRing',
    x: e.x,
    y: e.y,
    radius: m.FROST_RING_START_RADIUS,
    startR: m.FROST_RING_START_RADIUS,
    width: m.FROST_RING_WIDTH,
    gapStart: Math.random() * Math.PI * 2,
    gapSize: m.FROST_RING_GAP,
    warn: m.FROST_RING_WARN,
    active: m.FROST_RING_LIFE - m.FROST_RING_WARN,
    age: 0,
    life: m.FROST_RING_LIFE,
  });
}

/** 虚空：每 4 秒从本体放 10 发慢速追踪球，命中玩家再分裂。 */
function updateVoidUltimate(e, dt) {
  e.ultOrbCd = Math.max(0, e.ultOrbCd - dt);
  if (e.ultOrbCd > 0) return;
  const m = BOSS.MUTATION;
  e.ultOrbCd = m.VOID_ORB_CD;
  for (let i = 0; i < m.VOID_ORB_COUNT; i++) {
    if (G.hostile.length >= LIMITS.hostileShots) break;
    const angle = (Math.PI * 2 * i) / m.VOID_ORB_COUNT;
    G.hostile.push({
      x: e.x,
      y: e.y,
      vx: Math.cos(angle) * m.VOID_ORB_SPEED,
      vy: Math.sin(angle) * m.VOID_ORB_SPEED,
      speed: m.VOID_ORB_SPEED,
      life: m.VOID_ORB_LIFE,
      r: m.VOID_ORB_RADIUS,
      color: FORMS()[e.bossIndex].color,
      element: 'void',
      voidOrb: true,
      voidSplit: true,
      homing: true,
      homingTime: m.VOID_ORB_LIFE,
      turnRate: m.VOID_ORB_TURN,
    });
  }
}

/** 终焉：每 4 秒 8 道米字激光，1 秒预警；半血后冷却减半。 */
function updateFinalUltimate(e, dt) {
  const m = BOSS.MUTATION;
  e.ultLaserCd = Math.max(0, e.ultLaserCd - dt);
  if (e.ultLaserCd > 0) return;
  const enraged = e.hp / e.max <= m.FINAL_ENRAGE_HP;
  e.ultLaserCd = m.FINAL_LASER_CD * (enraged ? m.FINAL_ENRAGE_CD_MUL : 1);
  for (let i = 0; i < m.FINAL_LASER_COUNT; i++) {
    pushBossHazard({
      kind: 'laser',
      x: e.x,
      y: e.y,
      angle: (Math.PI * 2 * i) / m.FINAL_LASER_COUNT,
      length: m.FINAL_LASER_LENGTH,
      width: m.FINAL_LASER_WIDTH,
      warn: m.FINAL_LASER_WARN,
      active: m.FINAL_LASER_ACTIVE,
      age: 0,
      life: m.FINAL_LASER_WARN + m.FINAL_LASER_ACTIVE,
      tint: BOSS.FINAL.edgeColor,
    });
  }
}

/* ======================= 1. 裂隙刺客 ======================= */

/**
 * 裂隙刺客：高速追击 + 前摇突刺 + 独立的全屏切割线。
 * @param {object} e Boss
 * @param {number} dt 秒
 */
function updateRiftSkills(e, dt) {
  const phase2 = e.hp / e.max < 0.6;
  const cfg = BOSS.RIFT;
  const cdMul = phase2 ? cfg.phase2CdMul : 1;
  const cdt = cooldownDt(e, dt);
  const p = G.p;

  // 硬直时保留本次冲刺路径，让拖尾按时间淡出。
  if (e.dashState !== 'recover') {
    e.trail.unshift({ x: e.x, y: e.y });
    if (e.trail.length > cfg.trailMax) e.trail.pop();
  }

  /* ---------------- 突刺状态机 ---------------- */
  if (e.dashState === 'idle') {
    e.speed = cfg.speed;
    e.dashCd -= cdt;

    if (e.dashCd <= 0) {
      e.dashState = 'windup';
      e.dashTimer = 0;
      e.dashHit = false;
      e.dashCd = cfg.dashCd * cdMul;
      e.speed = 0; // 进入前摇的同一帧就停下，避免多滑一步

      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        e.dashDirX = dx / len;
        e.dashDirY = dy / len;
      } else {
        e.dashDirX = 0;
        e.dashDirY = 1;
      }
    }
  } else {
    // 前摇、突刺、硬直期间都停止普通追击；突刺由下面直接位移
    e.speed = 0;
    e.dashTimer += dt;

    if (e.dashState === 'windup' && e.dashTimer >= cfg.dashWarn) {
      e.dashState = 'dash';
      e.dashTimer = 0;
      e.riftFlameTimer = 0; // 终极：突刺第一步就留下第一个火焰节点
      e.trail.length = 0; // 拖尾只包含本次实际冲刺路径
    } else if (e.dashState === 'dash') {
      // 末帧只走剩余时间，避免 40ms 等帧长把实际距离拉长。
      const moveDt = Math.min(dt, Math.max(0, cfg.dashTime - (e.dashTimer - dt)));
      const fromX = e.x;
      const fromY = e.y;
      const nextX = Math.max(ARENA.MARGIN_X, Math.min(CANVAS.WIDTH - ARENA.MARGIN_X,
        fromX + e.dashDirX * cfg.dashSpeed * moveDt));
      const nextY = Math.max(ARENA.MARGIN_TOP, Math.min(CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM,
        fromY + e.dashDirY * cfg.dashSpeed * moveDt));
      e.x = nextX;
      e.y = nextY;

      // 终极 0：突刺路径按固定间隔留下火焰节点，落地后继续烧 3 秒。
      if (e.ultimate === 0) {
        e.riftFlameTimer = Math.max(0, e.riftFlameTimer - dt);
        if (e.riftFlameTimer <= 0) {
          e.riftFlameTimer = BOSS.MUTATION.RIFT_FLAME_INTERVAL;
          pushBossHazard({
            kind: 'flame',
            x: nextX,
            y: nextY,
            r: BOSS.MUTATION.RIFT_FLAME_RADIUS,
            age: 0,
            life: BOSS.MUTATION.RIFT_FLAME_LIFE,
          });
        }
      }

      // 点到本帧移动线段的距离，包含起终点及边界夹取，防止高速穿过玩家。
      if (!e.dashHit && p.inv <= 0) {
        const dx = nextX - fromX;
        const dy = nextY - fromY;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq > 0
          ? Math.max(0, Math.min(1, ((p.x - fromX) * dx + (p.y - fromY) * dy) / lengthSq))
          : 0;
        const dist = Math.hypot(p.x - (fromX + t * dx), p.y - (fromY + t * dy));
        if (dist <= e.r + p.r + 2) {
          if (hurtPlayer()) {
            e.dashHit = true;
            p.x += e.dashDirX * cfg.dashKnockback;
            p.y += e.dashDirY * cfg.dashKnockback;
            p.x = Math.max(ARENA.MARGIN_X, Math.min(CANVAS.WIDTH - ARENA.MARGIN_X, p.x));
            p.y = Math.max(ARENA.MARGIN_TOP, Math.min(CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM, p.y));
          }
        }
      }

      if (e.dashTimer >= cfg.dashTime) {
        e.dashState = 'recover';
        e.dashTimer = 0;
      }
    } else if (e.dashState === 'recover' && e.dashTimer >= cfg.dashRecover) {
      e.dashState = 'idle';
      e.dashTimer = 0;
      e.dashCd = cfg.dashCd * cdMul;
      e.trail.length = 0; // 淡出结束后清空，避免恢复追击时旧残影重新出现
      e.speed = cfg.speed;
    }
  }

  /* ---------------- 全屏切割：和突刺完全独立 ---------------- */
  e.slashCd -= cdt;
  if (e.slashCd > 0) return;
  e.slashCd = cfg.skillCd * cdMul;

  const angles = cfg.anglePairs[Math.floor(Math.random() * cfg.anglePairs.length)];
  // 同帧、同中心生成两条垂直线，共用完整的预警和激活时长。
  for (const angle of angles) {
    pushBossHazard({
      kind: 'riftSlash',
      x: e.x,
      y: e.y,
      angle,
      length: cfg.lineLength,
      width: cfg.lineWidth,
      warn: cfg.warn,
      active: cfg.active,
      age: 0,
      life: cfg.warn + cfg.active,
    });
  }
}

/* ======================= 2. 霜环裁决者 ======================= */

/**
 * 霜环裁决者：中速追击，三个动作各管各的计时器。
 * - 冰圈：随机落点，先预警再减速，不伤人；
 * - 冰弹扇射：先定格瞄准 0.55 秒，再沿锁定方向出 3/5 发；
 * - 断环裁决（新）：本体悬停，一圈带 100° 缺口的环从半径 60 扩到 250，
 *   1.1 秒预警后环带落地 0.35 秒，命中照常走 hurtPlayer 固定 20。
 *   裁决全程冰弹停火，避免"缺口 + 弹幕 + 减速"叠成走不掉的组合。
 * @param {object} e Boss
 * @param {number} dt 秒
 */
function updateFrostSkills(e, dt) {
  const phase2 = e.hp / e.max < 0.6;
  const cfg = BOSS.FROST;
  const cdMul = phase2 ? cfg.phase2CdMul : 1;
  const cdt = cooldownDt(e, dt);
  e.speed = cfg.speed;

  /* ---------------- 断环裁决 ---------------- */
  e.frostRingPause = Math.max(0, (e.frostRingPause || 0) - dt);
  if (e.frostRingPause > 0) {
    // 蓄力 + 落地期间本体悬停：圆心钉在抬手位置，玩家能看懂从哪扩出来。
    e.speed = 0;
  } else {
    e.frostRingCd = (e.frostRingCd ?? cfg.ringCd) - cdt;
    if (e.frostRingCd <= 0) {
      e.frostRingCd = cfg.ringCd * cdMul;
      e.frostRingPause = cfg.ringWarn + cfg.ringActive + cfg.ringPauseAfter;
      e.speed = 0;           // 抬手同帧就停，避免圆心跟着追击漂移
      e.iceWind = 0;         // 丢掉上一轮没出手的旧瞄准
      pushBossHazard({
        kind: 'frostRing',
        x: e.x,
        y: e.y,
        r: cfg.ringStartR,
        startR: cfg.ringStartR,
        endR: cfg.ringEndR,
        width: cfg.ringWidth,
        gapStart: Math.random() * Math.PI * 2, // 缺口位置每次随机，不固定套路
        gapSize: cfg.ringGap,
        age: 0,
        warn: cfg.ringWarn,
        active: cfg.ringActive,
        life: cfg.ringWarn + cfg.ringActive,
      });
    }
  }

  /* ---------------- 冰弹扇射 ---------------- */
  if (e.frostRingPause <= 0) {
    if (e.iceWind > 0) {
      // 定格瞄准：时间到才真正出弹，方向用抬手瞬间锁定值，侧闪必然有效。
      e.iceWind -= dt;
      if (e.iceWind <= 0) {
        e.iceWind = 0;
        const count = phase2 ? cfg.iceShotPhase2Count : cfg.iceShotCount;
        for (let i = 0; i < count; i++) {
          if (G.hostile.length >= LIMITS.hostileShots) break;
          const angle = e.iceAim + (i - (count - 1) / 2) * cfg.iceShotSpread;
          G.hostile.push({
            x: e.x, y: e.y,
            vx: Math.cos(angle) * cfg.iceShotSpeed,
            vy: Math.sin(angle) * cfg.iceShotSpeed,
            life: cfg.iceShotLife,
            color: cfg.color,
            element: 'frost',
            r: 4,
            frostSlow: true,
          });
        }
      }
    } else {
      e.iceShotCd -= cdt;
      if (e.iceShotCd <= 0) {
        e.iceShotCd = cfg.iceShotCd;
        e.iceWind = cfg.iceShotWarn;
        e.iceAim = Math.atan2(G.p.y - e.y, G.p.x - e.x);
      }
    }
  }

  /* ---------------- 冰圈（只减速） ---------------- */
  e.zoneCd -= cdt;
  if (e.zoneCd > 0) return;
  e.zoneCd = cfg.zoneCd * cdMul;

  // 预警圈也计入上限；满额时照常重置冷却，避免每帧重试。
  const count = G.bossHazards.filter(h => h.kind === 'frostZone' && h.age < h.life).length;
  if (count >= cfg.zoneMax) return;

  const point = randomArenaPoint();
  pushBossHazard({
    kind: 'frostZone',
    x: point.x,
    y: point.y,
    r: cfg.zoneRadius,
    age: 0,
    warn: cfg.zoneWarn,
    active: cfg.zoneDuration,
    life: cfg.zoneWarn + cfg.zoneDuration,
  });
}

/* ======================= 3. 熔核巨像 ======================= */

/**
 * 熔核巨像：极慢移动，每 5 秒在玩家脚下埋一个岩浆圈。
 * 岩浆先预警 1 秒，再喷发 0.35 秒；喷发期间站在圈里扣 20。
 * @param {object} e Boss
 * @param {number} dt 秒
 */
function updateMoltenSkills(e, dt) {
  e.armorExposed = Math.max(0, (e.armorExposed || 0) - dt);
  const phase2 = e.hp / e.max < 0.6;
  const cfg = BOSS.MOLTEN;
  const cdt = cooldownDt(e, dt);
  e.speed = cfg.speed;

  e.magmaCd -= cdt;
  if (e.magmaCd > 0) return;
  e.magmaCd = cfg.magmaCd * (phase2 ? cfg.phase2CdMul : 1);

  // 预警岩浆也计入上限；满额仍重置冷却，不逐帧重试。
  const count = G.bossHazards.filter(h => h.kind === 'magma' && h.age < h.life).length;
  if (count >= cfg.magmaMax) return;

  pushBossHazard({
    kind: 'magma',
    ownerId: e.id,
    x: G.p.x,
    y: G.p.y,
    r: cfg.magmaRadius,
    age: 0,
    warn: cfg.magmaWarn,
    active: cfg.magmaDuration,
    life: cfg.magmaWarn + cfg.magmaDuration,
    tickCd: 0,
    erupted: false,
  });
}

/* ======================= 4. 虚空母巢 ======================= */

/** 虚空巢后：接近、侧移与慢退；孵化和虚空弹共用出招窗口，避免同时释放。 */
function updateVoidSkills(e, dt) {
  const cfg = BOSS.VOID;
  const phase2 = e.hp / e.max < 0.6;
  const cdt = cooldownDt(e, dt);
  e.speed = 0; // 本分支直接移动，避免通用敌人移动重复位移。
  e.voidRelease = Math.max(0, e.voidRelease - dt);
  const dx = G.p.x - e.x;
  const dy = G.p.y - e.y;
  const dist = Math.hypot(dx, dy);
  const nx = dist > 0.001 ? dx / dist : 0;
  const ny = dist > 0.001 ? dy / dist : 1;
  let mx, my;
  if (dist > cfg.keepDistance + 25) {
    mx = nx; my = ny;
  } else if (dist < cfg.keepDistance - 25) {
    mx = -nx * 0.65; my = -ny * 0.65;
  } else {
    const radial = (dist - cfg.keepDistance) / 100;
    mx = -ny * e.voidStrafeDir * 0.75 + nx * radial;
    my = nx * e.voidStrafeDir * 0.75 + ny * radial;
  }
  const left = ARENA.MARGIN_X + e.r;
  const right = CANVAS.WIDTH - ARENA.MARGIN_X - e.r;
  const top = ARENA.MARGIN_TOP + e.r;
  const bottom = CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM - e.r;
  // 将撞墙的运动折向场内，并翻转侧移方向，避免夹取后持续顶墙。
  if ((e.x <= left + 24 && mx < 0) || (e.x >= right - 24 && mx > 0)) {
    mx = e.x < CANVAS.WIDTH / 2 ? 0.55 : -0.55;
    e.voidStrafeDir *= -1;
  }
  if ((e.y <= top + 24 && my < 0) || (e.y >= bottom - 24 && my > 0)) {
    my = e.y < CANVAS.HEIGHT / 2 ? 0.55 : -0.55;
    e.voidStrafeDir *= -1;
  }
  const moveLength = Math.max(1, Math.hypot(mx, my));
  e.x = Math.max(left, Math.min(right, e.x + mx / moveLength * cfg.speed * dt));
  e.y = Math.max(top, Math.min(bottom, e.y + my / moveLength * cfg.speed * dt));

  e.voidSpawnCd = Math.max(0, e.voidSpawnCd - cdt);
  e.voidOrbCd = Math.max(0, e.voidOrbCd - cdt);
  if (e.voidAction !== 'idle') {
    e.voidActionTime += dt;
    const summon = e.voidAction === 'summon';
    if (e.voidActionTime < (summon ? cfg.spawnWarn : cfg.orbWarn)) return;
    e.voidAction = 'idle';
    e.voidActionTime = 0;
    e.voidRelease = 0.35;
    if (summon) {
      let owned = G.enemies.filter(m => m.isBossMinion && m.bossOwnerId === e.id && m.hp > 0).length;
      const kinds = ['bomber', 'splitter'];
      for (let i = 0; i < cfg.spawnCount && owned < cfg.spawnMax; i++) {
        const minion = spawnEnemy(kinds[i % kinds.length]);
        if (!minion) break;
        minion.x = Math.max(left, Math.min(right, e.x + (i === 0 ? -34 : 34)));
        minion.y = Math.max(top, Math.min(bottom, e.y + 8));
        minion.isBossMinion = true;
        minion.bossOwnerId = e.id;
        minion.minionLife = cfg.minionLife;
        owned++;
      }
    } else {
      for (const offset of [-0.18, 0.18]) {
        if (G.hostile.length >= LIMITS.hostileShots) break;
        const angle = e.voidAim + offset;
        G.hostile.push({ x: e.x, y: e.y,
          vx: Math.cos(angle) * cfg.orbSpeed, vy: Math.sin(angle) * cfg.orbSpeed,
          speed: cfg.orbSpeed, life: cfg.orbLife, r: 4, color: cfg.color,
          element: 'void',
          voidOrb: true,
          homing: true, homingTime: cfg.orbHomingTime, turnRate: cfg.orbTurnRate });
      }
    }
    return; // 本帧只释放一种技能，下一招至少从下一帧开始预警。
  }
  if (e.voidSpawnCd <= 0) {
    e.voidSpawnCd = cfg.spawnCd * (phase2 ? cfg.phase2CdMul : 1);
    const owned = G.enemies.filter(m => m.isBossMinion && m.bossOwnerId === e.id && m.hp > 0).length;
    if (owned < cfg.spawnMax) {
      e.voidAction = 'summon'; e.voidActionTime = 0;
      return;
    }
  }
  if (e.voidOrbCd <= 0) {
    e.voidOrbCd = cfg.orbCd;
    e.voidAction = 'orb'; e.voidActionTime = 0;
    e.voidAim = Math.atan2(G.p.y - e.y, G.p.x - e.x);
  }
}

/* ======================= 5. 终焉审判 ======================= */

/**
 * 终焉审判：平时慢速追击，缩圈期间停下；每 3 秒一圈 16 发弹幕。
 * 环弹不追踪；缩圈中心在释放时锁定。
 * @param {object} e Boss
 * @param {number} dt 秒
 */
function updateFinalSkills(e, dt) {
  const phase2 = e.hp / e.max < 0.6;
  const cfg = BOSS.FINAL;
  const cdMul = phase2 ? cfg.phase2CdMul : 1;
  const cdt = cooldownDt(e, dt);
  e.speed = cfg.speed;

  // 预警与收缩期间都不发新环弹，也不提前消耗再次缩圈的冷却。
  if (G.bossHazards.some(h => h.kind === 'finalWarn')) {
    e.speed = 0;
    e.finalRingCd = Math.max(e.finalRingCd, 1.5);
    return;
  }

  e.finalWarnCd -= cdt;
  if (e.finalWarnCd <= 0) {
    e.speed = 0; // 触发同帧就停下，圈心不随之后的追击移动
    pushBossHazard({
      kind: 'finalWarn',
      x: e.x,
      y: e.y,
      r: cfg.warnRadius,
      startR: cfg.warnRadius,
      min: cfg.minSafeRadius,
      warn: cfg.warn,
      active: cfg.shrinkDuration,
      life: cfg.finalWarnLife,
      shrink: (cfg.warnRadius - cfg.minSafeRadius) / cfg.shrinkDuration,
      tickCd: 0,
      age: 0,
    });
    e.finalWarnCd = cfg.finalWarnRecast * cdMul;
    e.finalRingCd = Math.max(e.finalRingCd, 1.5);
    return;
  }

  e.finalRingCd -= cdt;
  if (e.finalRingCd > 0) return;
  e.finalRingCd = cfg.ringCd * cdMul;

  const count = cfg.ringCount;
  for (let i = 0; i < count; i++) {
    if (G.hostile.length >= LIMITS.hostileShots) break;

    const angle = (Math.PI * 2 * i) / count;
    G.hostile.push({
      x: e.x,
      y: e.y,
      vx: Math.cos(angle) * cfg.ringSpeed,
      vy: Math.sin(angle) * cfg.ringSpeed,
      life: cfg.ringLife,
      color: cfg.edgeColor,
      element: 'final',
      r: 4,
    });
  }
}

/**
 * 终焉审判没有普通环形弹；保留空函数只为兼容旧调用方。
 */
export function updateBossAttack() {}

/**
 * 首领危险区统一更新：
 * - riftSlash：预警后 0.3 秒激光判定；
 * - magma：1 秒预警后喷发，命中扣 20；
 * - frostZone：只存在，不伤害（玩家移动逻辑自己检查）；
 * - frostRing：先扩张预警，环带落地 0.35 秒，只有站在环带上且不在缺口才扣 20；
 * - finalWarn：只缩小，纯视觉，不伤人。
 * @param {number} dt 秒
 */
export function updateBossHazards(dt) {
  const p = G.p;

  for (let i = G.bossHazards.length - 1; i >= 0; i--) {
    const h = G.bossHazards[i];
    h.age += dt;

    // 缩圈先预警；收缩完删除，恢复完整场地。
    if (h.kind === 'finalWarn') {
      if (h.age >= h.warn) {
        const t = Math.min(1, (h.age - h.warn) / h.active);
        h.r = Math.max(h.min, h.startR - (h.startR - h.min) * t);
      }
      if (h.age >= h.life) {
        G.bossHazards.splice(i, 1);
        continue;
      }
      if (h.age < h.warn) continue;

      h.tickCd = (h.tickCd || 0) - dt;
      const dist = Math.hypot(p.x - h.x, p.y - h.y);
      if (dist > h.r + p.r && h.tickCd <= 0 && hurtPlayer()) {
        h.tickCd = BOSS.FINAL.finalWarnTick;
      }
      continue;
    }

    // 寿命到（预警 + 爆发结束）就删除
    if (h.age >= h.life) {
      G.bossHazards.splice(i, 1);
      continue;
    }

    if (h.kind === 'frostRing') {
      // 预警阶段：环半径从内向外扩，只画不伤人，让玩家看清落点。
      if (h.age < h.warn) {
        h.r = h.startR + (h.endR - h.startR) * (h.age / h.warn);
        continue;
      }
      h.r = h.endR;
      if (h.age >= h.warn + h.active) continue;

      // 判定：人和圆心的距离落在环带厚度内才算踩中；缺口角度内无敌。
      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dist - h.r) > h.width / 2 + p.r) continue;

      const rel = Math.atan2(dy, dx) - h.gapStart;
      const angle = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (angle < h.gapSize) continue; // 站在缺口里，安全穿过

      if (p.inv <= 0) hurtPlayer();
    } else if (h.kind === 'riftSlash') {      // 无敌帧内不做判定，避免同一条线在 0.3 秒里重复扣血
      if (p.inv > 0) continue;

      const active = h.age >= h.warn && h.age < h.warn + h.active;
      if (!active) continue;

      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const cos = Math.cos(h.angle);
      const sin = Math.sin(h.angle);
      const along = dx * cos + dy * sin;
      const perp = Math.abs(-dx * sin + dy * cos);

      if (Math.abs(along) <= h.length / 2 && perp <= h.width / 2 + p.r) {
        hurtPlayer();
      }
    } else if (h.kind === 'magma') {
      // 每片岩浆只在喷发瞬间暴露自己的主人，预警不伤人。
      if (h.age >= h.warn && !h.erupted) {
        h.erupted = true;
        const boss = G.enemies.find(e => e.id === h.ownerId);
        if (boss) boss.armorExposed = BOSS.MOLTEN.exposeTime;
      }
      if (h.age < h.warn || h.age >= h.warn + h.active) continue;

      h.tickCd = (h.tickCd || 0) - dt;
      const dist = Math.hypot(p.x - h.x, p.y - h.y);
      // 无敌时不刷新间隔，等无敌结束再结算固定 20 点伤害。
      if (h.tickCd <= 0 && dist <= h.r + p.r && hurtPlayer()) {
        h.tickCd = BOSS.MOLTEN.magmaTick;
      }
    } else if (h.kind === 'flame') {
      // 终极·裂隙：站在火焰节点上扣 20，玩家无敌帧挡住重复结算。
      if (p.inv <= 0 && Math.hypot(p.x - h.x, p.y - h.y) <= h.r + p.r) hurtPlayer();
    } else if (h.kind === 'thunder') {
      // 终极·裂隙落雷：0.8 秒预警结束后才判定，只结算一次。
      if (h.age < h.warn || h.age >= h.warn + h.active || p.inv > 0) continue;
      if (Math.hypot(p.x - h.x, p.y - h.y) <= h.r + p.r) hurtPlayer();
    } else if (h.kind === 'iceRing') {
      // 终极·极寒冰环：预警后半径从 START 线性收缩到 0，缺口内安全。
      if (h.age < h.warn) {
        h.radius = h.startR;
        continue;
      }
      const t = Math.min(1, (h.age - h.warn) / (h.life - h.warn));
      h.radius = Math.max(0, h.startR * (1 - t));

      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dist - h.radius) > h.width / 2 + p.r) continue;

      const rel = Math.atan2(dy, dx) - h.gapStart;
      const angle = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (angle < h.gapSize) continue;
      if (p.inv <= 0) hurtPlayer();
    } else if (h.kind === 'laser') {
      // 终极·终焉激光：预警 1 秒，激活 0.35 秒；点在射线段内且垂直距离命中。
      if (h.age < h.warn || h.age >= h.warn + h.active || p.inv > 0) continue;
      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const cos = Math.cos(h.angle);
      const sin = Math.sin(h.angle);
      const along = dx * cos + dy * sin;
      const perp = Math.abs(-dx * sin + dy * cos);
      if (along >= 0 && along <= h.length && perp <= h.width / 2 + p.r) hurtPlayer();
    }
  }
}

/**
 * 首领/精英瞬移残影：只负责寿命倒数，没有碰撞，纯视觉。
 * @param {number} dt 秒
 */
export function updateBossGhosts(dt) {
  for (let i = G.bossGhosts.length - 1; i >= 0; i--) {
    G.bossGhosts[i].life -= dt;
    if (G.bossGhosts[i].life <= 0) G.bossGhosts.splice(i, 1);
  }
}
