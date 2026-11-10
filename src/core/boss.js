// boss.js —— 首领生成、技能、危险区、瞬移残影
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
import { spawnEnemy, enemyStats, takeEnemyId } from './enemy.js';
import { spawnHostileShot } from './combat.js';

/**
 * 第 n 只首领的血量：config.BOSS.HP 里的公式，最后乘倍率并封顶。
 * n = 本房序号 / 3（第 3 房 → 1，第 6 房 → 2）。
 * @param {number} n 第几只首领
 * @returns {number} 血量
 */
export function bossHp(n) {
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
export function spawnBoss() {
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
    id: takeEnemyId(),
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
export function bossPhase(e) {
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
export function bossArchetypeIndex(e) {
  // 生成时已经存了 bossIndex；兼容旧存档/测试对象时再按序号算一次
  if (typeof e.bossIndex === 'number') return e.bossIndex;
  return (e.bossNumber - 1) % BOSS.ARCHETYPES.length;
}

/**
 * 首领房入场倒计时：到 0 刷 1 只 Boss 并给提示。
 * 倒计时期间普通怪照常刷（updateSpawn 不关心 Boss）。
 * @param {number} dt 秒
 */
export function updateBossCountdown(dt) {
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
 * 首领召唤：在首领身边生成 2 只射手小怪，受单场/全场数量上限约束。
 * 召唤物有存活时间，时间到自动消失。
 * @param {object} boss 首领
 */
export function spawnBossMinions(boss) {
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
      id: takeEnemyId(),
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
export function pushBossHazard(hazard) {
  if (G.bossHazards.length >= LIMITS.bossHazards) return;
  G.bossHazards.push(hazard);
}

/**
 * 裂隙质变：在 Boss 当前位置留一个火焰节点，存活 3 秒，玩家碰到扣 20。
 * @param {number} x 横坐标
 * @param {number} y 纵坐标
 */
export function spawnFlameHazard(x, y) {
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
export function spawnIceRing(e) {
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
export function spawnThunderStrike(x, y) {
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
export function spawnLaserHazard(e, angle, color) {
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
export function spawnSiegeBreakVolley(e) {
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
export function spawnVoidOrbs(e) {
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
export function spawnVoidSplitChildren(h) {
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
export function updateSiegeShield(e, dt, ratio) {
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
export function updateBossAffix(e, dt) {
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
export function updateBossSkills(e, dt) {
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
export function updateBossAttack(e, dt) {
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
 * 首领危险区：火焰节点 / 收缩冰环 / 激光。
 * 每帧推进寿命、收缩半径，并检测玩家是否碰到；碰到统一扣 20。
 * 危险区不会因为命中一次就消失，玩家靠受击后的无敌帧躲开连续判定。
 * @param {number} dt 秒
 */
export function updateBossHazards(dt) {
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
export function updateBossGhosts(dt) {
  for (let i = G.bossGhosts.length - 1; i >= 0; i--) {
    G.bossGhosts[i].life -= dt;
    if (G.bossGhosts[i].life <= 0) G.bossGhosts.splice(i, 1);
  }
}
