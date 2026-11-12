// enemy.js —— 刷怪、敌人 AI、自爆/分裂、精英词缀
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
import {
  damageEnemy,
  spawnHostileShot,
  addShake,
} from './combat.js';
import { updateBossSkills } from './boss.js';
import { spawnPickup, hurtPlayer } from './player.js';

// 敌人 id 自增器：每生成一只就 +1，方便以后做"同一目标只算一次"之类的去重
let nextEnemyId = 1;

/** 取下一个敌人 id，供 enemy / boss 共用。 */
export function takeEnemyId() {
  return nextEnemyId++;
}

/**
 * 本房的"成长档位"：第 1 房是 0，之后每房 +1，封顶 HP_GROWTH_CAP_WAVE。
 * 血量、速度的成长都按它算，保证第 25 房之后数值不再膨胀。
 * @param {number} wave 第几房
 */
export function growth(wave) {
  return Math.min(ENEMY.HP_GROWTH_CAP_WAVE, wave - 1);
}

/**
 * 按类型和房间数算出这只怪的实际数值。
 * 普通四类：血量按房成长、速度按房成长但有上限、半径用普通体型；
 * 精英：血量用精英专属公式（封顶），体型更大。
 * @param {string} type 敌人类型
 * @param {number} wave 第几房
 */
export function enemyStats(type, wave) {
  const base = ENEMY.TYPES[type];
  const g = growth(wave);
  // 第 25 房后仍缓慢成长：普通/重甲每房 +4 血 +0.4 速，精英每房 +8 血
  const late = Math.max(0, wave - ENEMY.HP_GROWTH_CAP_WAVE);

  // 移速：基础值 + 每房成长，普通/重甲第 25 房后再加后期成长，封顶 SPEED_CAP
  const speed = Math.min(
    ENEMY.SPEED_CAP,
    base.speed +
      ENEMY.SPEED_GROWTH_PER_WAVE * g +
      (type === 'elite' ? 0 : ENEMY.SPEED_GROWTH_LATE_PER_WAVE * late)
  );

  if (type === 'elite') {
    const eliteHp = Math.min(
      ENEMY.ELITE_HP_CAP,
      ENEMY.ELITE_HP_BASE + ENEMY.ELITE_HP_PER_GROWTH * g
    );
    return {
      hp: Math.min(ENEMY.ELITE_HP_LATE_CAP, eliteHp + ENEMY.ELITE_HP_GROWTH_LATE * late),
      speed,
      r: ENEMY.RADIUS.elite,
    };
  }

  return {
    hp: Math.min(
      ENEMY.HP_LATE_CAP,
      base.hp + ENEMY.HP_GROWTH_PER_WAVE * g + ENEMY.HP_GROWTH_LATE_PER_WAVE * late
    ),
    speed,
    r: ENEMY.RADIUS.normal,
  };
}

/**
 * c. 在屏幕四条边随机一个出生点，生成 1 只指定类型的敌人。
 * 出生点贴着屏幕边缘；如果落点离玩家太近（贴脸），就换到对角位置。
 * @param {string} type 敌人类型（chaser / runner / tank / shooter / elite）
 */
export function spawnEnemy(type) {
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
    id: takeEnemyId(),
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
export function spawnChaserChild(x, y, hpMul, speedMul, rMul) {
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
export function updateEnemies(dt) {
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

    // 先处理"开火"：射手/精英各自有冷却；首领推进裂隙切割冷却
    if (e.type === 'shooter') {
      updateShooterAttack(e, len, dt * auraRate);
    } else if (e.type === 'elite') {
      updateEliteAttack(e, len, dt * auraRate);
    } else if (e.type === 'boss') {
      updateBossSkills(e, dt);
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

    // 普通移动：所有敌人（包括裂隙刺客）都直接朝玩家追
    if (len !== 0 && speed !== 0) {
      e.x += (dx / len) * speed * dt;
      e.y += (dy / len) * speed * dt;
    }

    // 敌人也夹在屏幕边界内，不会跑出墙外
    e.x = Math.max(ARENA.MARGIN_X, Math.min(CANVAS.WIDTH - ARENA.MARGIN_X, e.x));
    e.y = Math.max(ARENA.MARGIN_TOP, Math.min(CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM, e.y));

    // 用移动后的位置算接触：两圆半径相加以内就算贴上
    const hitDx = p.x - e.x;
    const hitDy = p.y - e.y;
    if (Math.hypot(hitDx, hitDy) < e.r + PLAYER.radius && p.inv <= 0) {
      const damaged = hurtPlayer(); // 统一受伤入口：沙盒模式不掉血

      // 只有真的扣了血才弹开：沙盒/无敌帧里不会一直弹
      if (damaged && e.type === 'boss') {
        const away = Math.hypot(hitDx, hitDy);
        // 极端情况下两个圆心重合，方向会变成 0；默认往下弹，避免原地卡住
        const nx = away > 0.001 ? hitDx / away : 0;
        const ny = away > 0.001 ? hitDy / away : 1;
        e.x -= nx * BOSS.RIFT.contactRecoil;
        e.y -= ny * BOSS.RIFT.contactRecoil;
        e.x = Math.max(ARENA.MARGIN_X, Math.min(CANVAS.WIDTH - ARENA.MARGIN_X, e.x));
        e.y = Math.max(ARENA.MARGIN_TOP, Math.min(CANVAS.HEIGHT - ARENA.MARGIN_BOTTOM, e.y));
      }
    }
  }
}

/**
 * 在指定位置画一个爆炸扩散环（纯视觉，不参与伤害）。
 * @param {number} x 中心 x
 * @param {number} y 中心 y
 * @param {number} radius 半径
 * @param {string} color 颜色
 */
export function addExplosionVisual(x, y, radius, color) {
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
export function explodeAt(x, y, radius, damage, color) {
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
export function onEnemyDeath(e) {
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

/**
 * 射手：距离近就后退、居中停步、远了靠近；每 2 秒朝玩家打一发。
 * 只负责"这一帧要不要开火"，移动由 updateEnemies 统一处理。
 * @param {object} e 射手
 * @param {number} dist 与玩家的距离
 * @param {number} dt 秒
 */
export function updateShooterAttack(e, dist, dt) {
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
export function updateEliteAttack(e, dist, dt) {
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
export function updateEliteAffix(e, dt) {
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
