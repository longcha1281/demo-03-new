// combat.js —— 自动攻击、子弹、命中结算、闪电、裂变、敌弹
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
  SPELL,
} from '../config.js';
import { G } from './state.js';
import { sfxShoot, sfxHit, sfxKill } from './audio.js';
import { applyBulletEnchant } from './enchant.js';
import { relicLevel, spawnPickup, applyLifesteal, hurtPlayer } from './player.js';
import { compileCastData } from './spell.js';
import { onEnemyDeath } from './enemy.js';
import {
  spawnSiegeBreakVolley,
  bossArchetypeIndex,
  spawnVoidSplitChildren,
} from './boss.js';

/**
 * 生成一条伤害飘字；超过硬上限就删最旧的一条。
 * @param {number} x 起点 x
 * @param {number} y 起点 y
 * @param {number} amount 伤害值（画的时候再取整 / 保留一位小数）
 * @param {string} color 颜色
 */
export function spawnCombatText(x, y, amount, color, heal = false) {
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

/** 每帧推进飘字：往上飘、寿命递减，到点删除（绘制只读数据）。 */
export function updateCombatTexts(dt) {
  for (let i = G.combatTexts.length - 1; i >= 0; i--) {
    const t = G.combatTexts[i];
    t.life -= dt;
    t.y -= TEXT.RISE * dt;
    if (t.life <= 0) G.combatTexts.splice(i, 1);
  }
}

/** 叠加震屏：取更大的那个，不会越叠越猛。 */
export function addShake(px) {
  G.shake = Math.max(G.shake, px);
}

/**
 * 子弹拖尾粒子：寿命递减、按速度漂移，寿命到就删除。
 * 粒子只用于视觉，不参与碰撞。
 * @param {number} dt 秒
 */
export function updateSparks(dt) {
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
 * 往敌弹数组里塞一颗子弹；到硬上限就直接放弃。
 * extra 用来给追踪球附加 homing / turnRate 等字段。
 */
export function spawnHostileShot(x, y, vx, vy, life, color, r, extra) {
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
 * h. 敌方子弹：往前飞、寿命递减、出屏删除；打中不无敌的玩家就扣血。
 * 数量超过硬上限时，先丢掉最旧的几发（防止 Boss 刷屏把数组撑爆）。
 * @param {number} dt 秒
 */
export function updateHostile(dt) {
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

      // 统一受伤入口：沙盒模式在这里被拦截，子弹仍然正常消失
      hurtPlayer();
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
export function bloodthirstRateMul() {
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
export function triggerLightning(hitEnemy, baseDamage) {
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
export function jaggedLightningPoints(fromX, fromY, toX, toY) {
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
export function updateLightningArcs(dt) {
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
export function buildFissionBullets(shot, hitEnemy) {
  // 裂变代数到 2（母弹 0 → 子 1 → 孙 2）就彻底停手，避免几何级数套娃
  if ((shot.depth || 0) >= SPELL.MAX_FISSION_DEPTH) return null;

  // 优先用开火时记下的等级；手动构造的旧子弹再回退到当前遗物等级
  const level = shot.fissionLevel || relicLevel('hitFission');
  if (!level) return null;

  const cfg = WEAPON.FISSION[level - 1];

  // 父弹速度方向；极端情况下速度为 0，就退回"从父弹指向受击点"。
  // 子代沿用父弹的速度大小，这样回旋/追踪改造过的弹道不会被重置成基础速度。
  const parentSpeed = Math.hypot(shot.vx, shot.vy);
  const baseAngle =
    parentSpeed > 0
      ? Math.atan2(shot.vy, shot.vx)
      : Math.atan2(hitEnemy.y - shot.y, hitEnemy.x - shot.x);
  const childSpeed = parentSpeed > 0 ? parentSpeed : SHOT.SPEED;

  // 裂变基础发数：由裂变遗物等级决定（Lv1=2、Lv2=3、Lv3=4）
  const fissionBaseCount = cfg.count;

  // 散射等级决定“裂变之后还要再乘几发”（Lv1=2、Lv2=3、Lv3=5；没装则按 1 发）
  const scatterLv = relicLevel('tripleShot') || 0;
  const scatterCount = scatterLv > 0
    ? WEAPON.TRIPLE_SHOT[scatterLv - 1].count
    : 1;

  // 裂变快照 + 最终数量：这两个数一比较，就知道散射排在裂变前还是后。
  const snapshotCount = shot.fissionCount || 0;
  const finalCount = shot.castCount || shot.count || 0;
  const scatterAfterFission = finalCount > snapshotCount;

  // 真正的乘法：散射排在裂变后面时，裂变发数 × 散射发数
  let childCount = fissionBaseCount;
  if (scatterAfterFission) {
    childCount = fissionBaseCount * scatterCount;
  }

  // 防卡死护栏 1：单次裂变最高只爆 8 发，绝不允许几何级数继续放大
  childCount = Math.min(SPELL.FISSION_MAX_COUNT, Math.max(1, childCount));

  // 子代张角优先用裂变那一刻的快照；没有快照时退回等级配置。
  const childSpread =
    shot.fissionSpread > 0 ? shot.fissionSpread : cfg.spread;
  // 防卡死护栏 2：子代绝对不继承 fission 标签，彻底掐断无限套娃
  const inheritedTags = (shot.tags || []).filter((t) => t !== 'fission');
  const childHitsLeft = inheritedTags.includes('pierce')
    ? 1 + SPELL.PIERCE_BONUS
    : 1;
  const childLife = shot.isLightning
    ? SHOT.LIFE * SPELL.LIGHTNING_LIFE_MUL
    : cfg.life;

  const step = childCount > 1 ? (childSpread * 2) / (childCount - 1) : 0;
  const out = [];

  for (let i = 0; i < childCount; i++) {
    const angle = baseAngle - childSpread + step * i;
    const damage = shot.baseDamage * cfg.damageMul;

    out.push({
      // 每轴随机错开 ±SPAWN_OFFSET：不要和刚打中的敌人重叠，否则下一帧立刻又判中它
      x:
        hitEnemy.x +
        (Math.random() * 2 - 1) * FISSION_FX.SPAWN_OFFSET,
      y:
        hitEnemy.y +
        (Math.random() * 2 - 1) * FISSION_FX.SPAWN_OFFSET,
      vx: Math.cos(angle) * childSpeed,
      vy: Math.sin(angle) * childSpeed,
      life: childLife,
      damage,
      baseDamage: damage,
      // 带穿透标签的子代重新获得完整穿透次数，可以一路命中、一路裂变
      hitsLeft: childHitsLeft,
      pierceDamageMul: shot.pierceDamageMul || 1,
      hasPierce: inheritedTags.includes('pierce'),
      hitCount: 0,
      hitIds: new Set(),
      // 出生保护：刚生成时忽略刚打中的敌人，并短暂不参与任何碰撞
      ignoreEnemyId: hitEnemy.id,
      spawnInvulnerability: FISSION_FX.SPAWN_INVULN,
      color: shot.color,
      tags: inheritedTags, // 子代继承追踪 / 穿透 / 裂变标签
      depth: (shot.depth || 0) + 1,    // 裂变代数 +1
      fissionLevel: level,              // 子代沿用同一裂变等级
      // 快照和最终数量也一起继承，孙代才能继续按同样顺序做乘法
      fissionCount: snapshotCount,
      fissionSpread: shot.fissionSpread || 0,
      castCount: finalCount,
      castSpread: shot.castSpread || 0,
      // 母弹的闪电形态必须传给子代，子代才是"雷电追踪弹"
      isLightning: !!shot.isLightning,
      // 追踪参数继承；回旋的整套状态机不继承，子代只保留飞行弹道
      homingRange: shot.homingRange,
      homingTurn: shot.homingTurn,
      child: true, // 子子弹：不再触发附魔 / 汲取 / 闪电，只保留裂变链
    });
  }

  return out;
}

/** 把算好的裂变子弹立刻放进场上（同一帧可见），并受硬上限裁剪。 */
export function pushFissionBullets(bullets) {
  if (!bullets || bullets.length === 0) return;

  // 防卡死护栏 3：场上子弹已经超过 150 发时，拒绝再加入新的子代
  if (G.shots.length > 150) return;

  for (const b of bullets) G.shots.push(b);

  // 子子弹同样受玩家子弹硬上限约束
  while (G.shots.length > LIMITS.playerShots) {
    G.shots.shift();
  }
}

/**
 * f. 自动 / 手动攻击：冷却好了就开火。
 * 自动：锁定(存活) > 首领 > 最近；手动：锁定(存活) > 鼠标瞄准点。
 * 开火完全由 compileCastData 的数据包决定：母弹数看裂变快照，闪电换高速短命弹，
 * 穿透/追踪/回旋只挂标签，具体参数按遗物等级读取。
 * @param {number} dt 秒（签名统一，暂未用到）
 */
export function updateAttack(dt) {
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

  // 法术编译器：遍历 0→1→2 号槽位，把遗物翻译成最终数据包。
  // 开火这里不再逐个判断"有没有三向散射/穿透/回旋"。
  const castData = compileCastData(p);
  const tags = castData.tags;

  // 标签决定"有没有这个效果"，等级决定"具体参数多强"
  const hasPierce = tags.includes('pierce');
  const hasBoomerang = tags.includes('boomerang');
  const hasHoming = tags.includes('homing');

  const pierceLevel = castData.levels.piercing || 0;
  const pierceCfg =
    hasPierce && pierceLevel ? WEAPON.PIERCE[pierceLevel - 1] : null;

  const boomerangLevel = castData.levels.boomerangCore || 0;
  const boomerangCfg =
    hasBoomerang && boomerangLevel ? WEAPON.BOOMERANG : null;

  const homingLevel = castData.levels.homing || 0;
  const homingCfg =
    hasHoming && homingLevel ? WEAPON.HOMING[homingLevel - 1] : null;

  // 母弹只发裂变快照里的数量：
  // 先裂变后散射 → 快照 1，只发 1 发母弹，散射留给命中后的子代；
  // 先散射后裂变 → 快照 3，先发 3 发母弹，每颗各自裂变。
  const spawnCount =
    castData.fissionCount > 0 ? castData.fissionCount : castData.count;
  const count = Math.min(SPELL.CAST_MAX_COUNT, spawnCount);
  const step = count > 1 ? castData.spread : 0;

  // 闪电形态：高速、短寿命；子代会继承这个形态。
  const isLightning = castData.form === 'lightning';
  const baseSpeed = isLightning
    ? SHOT.SPEED * SPELL.LIGHTNING_SPEED_MUL
    : (castData.speed ?? SHOT.SPEED);
  const baseLife = isLightning
    ? SHOT.LIFE * SPELL.LIGHTNING_LIFE_MUL
    : SHOT.LIFE;

  for (let k = 0; k < count; k++) {
    // 扇形以瞄准方向为中心左右均分；只有 1 发时不分叉
    const offset = count > 1 ? (k - (count - 1) / 2) * step : 0;
    const angle = baseAngle + offset;
    const damage = castData.damage ?? p.damage;

    const shot = {
      x: p.x,
      y: p.y,
      vx: Math.cos(angle) * baseSpeed,
      vy: Math.sin(angle) * baseSpeed,
      life: baseLife,
      damage,
      baseDamage: damage,
      // 穿透是标签效果：总命中数 = 1 + 固定额外次数
      hitsLeft: hasPierce ? 1 + SPELL.PIERCE_BONUS : 1,
      hitCount: 0,
      pierceDamageMul: pierceCfg ? pierceCfg.damageMul : 1,
      hasPierce,
      hitIds: new Set(), // 已经打过的敌人 id，防止穿透时重复结算
      color: shotColor,
      tags: castData.tags,       // 效果标签，命中结算按它判断
      depth: 0,                  // 裂变代数：母弹 0
      isLightning,               // 闪电形态，命中后传给子代
      fissionLevel: castData.levels.hitFission || 0,
      // 裂变快照 + 最终数量/张角：命中时用它们判断“散射到底在裂变前还是后”
      fissionCount: castData.fissionCount,
      fissionSpread: castData.fissionSpread,
      castCount: castData.count,
      castSpread: castData.spread,
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
        baseSpeed;
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
export function steerHomingShot(s, dt, exclude = null) {
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
export function beginBoomerangReturn(s) {
  s.phase = 'RETURNING';
  s.done = false;

  const p = G.p;
  const angle = Math.atan2(p.y - s.y, p.x - s.x);
  const speed = SHOT.SPEED * s.returnSpeedMul;
  s.vx = Math.cos(angle) * speed;
  s.vy = Math.sin(angle) * speed;
}

/** 朝指定点转向，最多转 maxTurn 弧度；速度大小保持不变。 */
export function turnVelocityToward(s, tx, ty, maxTurn) {
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
export function nearestUnhitEnemy(x, y, exclude, range) {
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

/** 返程到家：进入缓冲直飞；缓冲结束后有追踪才继续索敌，没有追踪就销毁。 */
export function finishBoomerangReturn(s) {
  s.phase = 'BUFFER';
  s.bufferTraveled = 0;
}

/** 缓冲飞满且带追踪：进入游离段，重新索敌。 */
export function enterHomingFree(s) {
  s.phase = 'HOMING_FREE';
  s.freeTraveled = 0;
  s.ricochetTimer = 0;
}

/** 回旋镖四阶段飞行：出程 / 返程 / 缓冲 / 追踪游离。 */
export function moveBoomerang(s, dt) {
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
      // 缓冲结束：带追踪才进入游离索敌；纯回旋直接销毁，不再直线乱飞
      if (s.hasHoming) {
        enterHomingFree(s);
      } else {
        s.done = true;
      }
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
export function updateShots(dt) {
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

        // 裂变参数先算好，父弹处理完再同一帧 push。
        // 子代只要还带 fission 标签且 depth < 2，就允许再裂一次。
        const canFission =
          s.tags &&
          s.tags.includes('fission') &&
          (s.depth || 0) < SPELL.MAX_FISSION_DEPTH;
        const fission = canFission ? buildFissionBullets(s, e) : null;

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
 * 所有伤害都从这里进：子弹直伤、灼烧、侵蚀、元素爆发、黑洞。
 * 负责扣血、生成飘字，并在"这一下把敌人打死"时结算击杀 / 得分 / 音效 / 首领标记。
 * 已经是尸体的敌人直接忽略，天然防止同一帧重复记分。
 * @param {object} e 敌人
 * @param {number} amount 伤害
 * @param {string} color 飘字颜色
 */
export function damageEnemy(e, amount, color) {
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
