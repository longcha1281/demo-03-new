// boss_rounds.test.mjs —— 第 2 轮词缀 + 第 3 轮专属终极自检
// 运行：node tests/boss_rounds.test.mjs
// 纯 Node 环境直接构造 G / Boss 调用逻辑函数，不依赖浏览器。
import assert from 'node:assert/strict';
import { BOSS, PLAYER } from '../src/config.js';
import { G } from '../src/core/state.js';
import {
  spawnBoss,
  bossFormIndex,
  updateBossSkills,
  updateBossHazards,
} from '../src/core/boss.js';
import { damageEnemy, updateHostile } from '../src/core/combat.js';

let pass = 0;
let fail = 0;

/** 每个用例都从干净场地开始。 */
function reset() {
  G.enemies.length = 0;
  G.hostile.length = 0;
  G.bossHazards.length = 0;
  G.bossGhosts.length = 0;
  G.shots.length = 0;
  G.combatTexts.length = 0;
  G.sparks.length = 0;
  G.pickups.length = 0;
  G.p.x = 480;
  G.p.y = 300;
  G.p.hp = G.p.max;
  G.p.inv = 0;
  G.p.hits = 0;
  G.p.frostSlowTime = 0;
  G.isSandbox = false;
  G.time = 0;
}

function check(name, fn) {
  try {
    reset();
    fn();
    pass++;
    console.log(`PASS ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL ${name}: ${err.message}`);
  }
}

/** 固定随机数，让 spawnBoss 的词缀抽取可预期。 */
function withRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

const AFFIX = BOSS.AFFIX;
const MUT = BOSS.MUTATION;

/* ======================= 词缀分配 ======================= */

check('第 5 只无词缀、无终极；第 1 轮不触发任何新机制', () => {
  const e = spawnBoss(5);
  assert.equal(e.affix, null);
  assert.equal(e.ultimate, null);
});

check('第 6–10 只各恰好 1 个词缀，且不启用终极', () => {
  for (let n = 6; n <= 10; n++) {
    const e = spawnBoss(n);
    assert.ok(e.affix, `第 ${n} 只应该有词缀`);
    assert.ok(BOSS.AFFIX_POOL.includes(e.affix), `第 ${n} 只词缀不合法: ${e.affix}`);
    assert.equal(e.ultimate, null, `第 ${n} 只不该启用终极`);
  }
});

check('第 11–15 只各启用对应形态终极，且不带词缀', () => {
  for (let n = 11; n <= 15; n++) {
    const e = spawnBoss(n);
    assert.equal(e.affix, null, `第 ${n} 只不该带词缀`);
    assert.equal(e.ultimate, bossFormIndex(n), `第 ${n} 只终极形态不符`);
  }
});

check('第 2 轮只从词缀池抽 1 个（3 个样本都命中池内）', () => {
  for (const v of [0, 0.5, 0.99]) {
    withRandom(v, () => {
      const e = spawnBoss(6);
      assert.ok(BOSS.AFFIX_POOL.includes(e.affix));
      assert.equal(typeof e.affix, 'string');
    });
  }
});

/* ======================= 词缀 · 护盾 ======================= */

check('词缀护盾：伤害先扣盾，破盾那一下不溢出到血条', () => {
  withRandom(0, () => spawnBoss(6)); // 固定抽到 shield
  const e = G.enemies[0];
  assert.equal(e.affix, 'shield');
  assert.ok(e.bossShield > 0);
  assert.equal(Math.round(e.bossShield), Math.round(e.max * AFFIX.SHIELD_RATIO));

  const shield = e.bossShield;
  damageEnemy(e, 10, '#fff');
  assert.equal(e.hp, e.max, '扣盾时不应掉血');
  assert.ok(e.bossShield < shield);

  damageEnemy(e, e.bossShield, '#fff');
  assert.equal(e.bossShield, 0, '这一下刚好破盾');
  assert.equal(e.hp, e.max, '破盾当次不溢出');

  damageEnemy(e, 7, '#fff');
  assert.equal(e.hp, e.max - 7, '破盾后伤害正常进血条');
});

check('词缀护盾：破盾 4 秒后重新获得，且不可叠加', () => {
  withRandom(0, () => spawnBoss(6));
  const e = G.enemies[0];
  damageEnemy(e, e.bossShield, '#fff');
  assert.equal(e.bossShield, 0);

  updateBossSkills(e, 1.0);
  assert.equal(e.bossShield, 0, '冷却未到不重生');

  updateBossSkills(e, AFFIX.SHIELD_CD);
  assert.ok(e.bossShield > 0, '冷却到点重生');
  assert.ok(e.bossShield <= e.max * AFFIX.SHIELD_RATIO + 1e-9, '护盾不会叠加');

  const full = e.bossShield;
  updateBossSkills(e, AFFIX.SHIELD_CD);
  assert.equal(e.bossShield, full, '满盾时不会继续叠加');
});

/* ======================= 词缀 · 瞬移 ======================= */

check('词缀瞬移：先 0.3 秒预警，再落到距玩家约 150px 的场内位置', () => {
  const e = spawnBoss(7);
  e.affix = 'teleport';
  e.teleportCd = 0;
  e.teleportWarn = 0;
  e.x = 100;
  e.y = 100;
  G.p.x = 480;
  G.p.y = 300;

  updateBossSkills(e, 0.01);
  assert.ok(e.teleportWarn > 0, '先进入预警');
  assert.equal(e.x, 100, '预警阶段还没换位');

  withRandom(0.25, () => updateBossSkills(e, AFFIX.TELEPORT_WARN + 0.01));
  const dist = Math.hypot(e.x - G.p.x, e.y - G.p.y);
  assert.ok(Math.abs(dist - AFFIX.TELEPORT_DIST) < 1, `距离应约为 150，实际 ${dist}`);
  assert.ok(e.x > 0 && e.x < 960 && e.y > 0 && e.y < 600, '落点必须在场内');
  assert.equal(e.teleportCd, AFFIX.TELEPORT_CD, '落地后重新计时');
  assert.equal(G.bossGhosts.length, 1, '原地留一个残影');
  assert.equal(G.bossGhosts[0].maxLife, AFFIX.GHOST_LIFE);
});

check('词缀瞬移：突刺期间不瞬移，避免打断前摇', () => {
  const e = spawnBoss(6); // 裂隙刺客
  e.affix = 'teleport';
  e.teleportCd = 0;
  e.dashState = 'windup';
  e.dashTimer = 0;
  updateBossSkills(e, 0.01);
  assert.equal(e.teleportWarn, 0, '突刺中不应进入瞬移预警');
});

/* ======================= 终极触发 ======================= */

check('第 1/2 轮不触发第 3 轮终极机制', () => {
  const e = spawnBoss(10); // 终焉，且 ultimate=null
  assert.equal(e.ultimate, null);

  for (let i = 0; i < 20; i++) updateBossSkills(e, 0.5);

  const hasUltimateHazard = G.bossHazards.some(h =>
    h.kind === 'thunder' || h.kind === 'iceRing' || h.kind === 'laser');
  assert.equal(hasUltimateHazard, false, '第 2 轮不该出现第 3 轮危险区');
  assert.equal(G.hostile.some(h => h.voidSplit), false, '第 2 轮不该有分裂虚空球');
});

check('终极 0 裂隙：突刺留火焰节点；每 3 秒玩家脚下落雷（预警 0.8 秒）', () => {
  const e = spawnBoss(11);
  assert.equal(e.ultimate, 0);

  // 直接推进到落雷：3 秒冷却
  updateBossSkills(e, MUT.RIFT_THUNDER_CD + 0.01);
  const thunder = G.bossHazards.find(h => h.kind === 'thunder');
  assert.ok(thunder, '应生成落雷');
  assert.equal(thunder.x, G.p.x);
  assert.equal(thunder.y, G.p.y);
  assert.ok(thunder.warn >= 0.8);
  assert.equal(thunder.r, MUT.RIFT_THUNDER_RADIUS);

  // 突刺进入 dash 后按间隔铺火焰节点
  reset();
  const e2 = spawnBoss(11);
  e2.dashState = 'dash';
  e2.dashTimer = 0;
  e2.dashDirX = 1;
  e2.dashDirY = 0;
  e2.x = 200;
  e2.y = 300;
  updateBossSkills(e2, 0.07);
  assert.ok(G.bossHazards.some(h => h.kind === 'flame'), '突刺路径应留下火焰节点');
});

check('终极 1 极寒：每 7 秒生成带缺口的收缩冰环', () => {
  const e = spawnBoss(12);
  assert.equal(e.ultimate, 1);

  updateBossSkills(e, MUT.FROST_RING_CD + 0.01);
  const ring = G.bossHazards.find(h => h.kind === 'iceRing');
  assert.ok(ring, '应生成冰环');
  assert.equal(ring.startR, MUT.FROST_RING_START_RADIUS);
  assert.equal(ring.width, MUT.FROST_RING_WIDTH);
  assert.equal(ring.gapSize, MUT.FROST_RING_GAP);
  assert.ok(ring.warn >= 0.8, '冰环预警至少 0.8 秒');
});

check('终极 2 熔核：开场 20% 护盾；破盾瞬间放出 20 发环形弹', () => {
  const e = spawnBoss(13);
  assert.equal(e.ultimate, 2);
  assert.ok(e.bossShield > 0);
  assert.equal(Math.round(e.bossShield), Math.round(e.max * MUT.SIEGE_SHIELD_RATIO));

  damageEnemy(e, e.bossShield, '#fff');
  assert.equal(e.bossShield, 0);
  assert.equal(e.hp, e.max, '破盾不溢血');
  assert.equal(G.hostile.length, MUT.SIEGE_BREAK_COUNT, '破盾环形弹数量');
  assert.equal(G.hostile[0].life, MUT.SIEGE_BREAK_LIFE);
  assert.ok(Math.abs(Math.hypot(G.hostile[0].vx, G.hostile[0].vy)
    - MUT.SIEGE_BREAK_SPEED) < 1e-9);
});

check('终极 3 虚空：每 4 秒 10 发追踪球，命中玩家分裂 2 个小球', () => {
  const e = spawnBoss(14);
  assert.equal(e.ultimate, 3);

  updateBossSkills(e, MUT.VOID_ORB_CD + 0.01);
  const orbs = G.hostile.filter(h => h.voidSplit);
  assert.equal(orbs.length, MUT.VOID_ORB_COUNT, '大球数量');
  assert.equal(orbs[0].life, MUT.VOID_ORB_LIFE);

  // 让一颗大球贴脸命中，验证分裂与固定 20 伤害
  reset();
  G.p.inv = 0;
  G.hostile.push({
    x: G.p.x, y: G.p.y, vx: 0, vy: 0,
    speed: MUT.VOID_ORB_SPEED, life: 1, r: MUT.VOID_ORB_RADIUS,
    voidOrb: true, voidSplit: true,
  });
  updateHostile(0.01);
  assert.equal(G.p.max - G.p.hp, PLAYER.hurtDamage, '单次命中固定 20');
  assert.equal(G.hostile.length, MUT.VOID_SPLIT_COUNT, '命中后分裂小球');
  for (const child of G.hostile) {
    assert.ok(child.life <= MUT.VOID_CHILD_LIFE);
    assert.equal(child.r, MUT.VOID_CHILD_RADIUS);
  }
});

check('终极 4 终焉：每 4 秒 8 道米字激光，预警 1 秒、激活 0.35 秒', () => {
  const e = spawnBoss(15);
  assert.equal(e.ultimate, 4);

  updateBossSkills(e, MUT.FINAL_LASER_CD + 0.01);
  const lasers = G.bossHazards.filter(h => h.kind === 'laser');
  assert.equal(lasers.length, MUT.FINAL_LASER_COUNT, '激光数量');
  assert.ok(lasers[0].warn >= 0.8, '激光预警至少 0.8 秒');
  assert.equal(lasers[0].active, MUT.FINAL_LASER_ACTIVE);
  assert.equal(lasers[0].length, MUT.FINAL_LASER_LENGTH);

  // 半血狂暴：冷却间隔减半
  e.hp = e.max * MUT.FINAL_ENRAGE_HP;
  e.ultLaserCd = 0;
  G.bossHazards.length = 0;
  updateBossSkills(e, 0.01);
  assert.ok(Math.abs(e.ultLaserCd - MUT.FINAL_LASER_CD * MUT.FINAL_ENRAGE_CD_MUL) < 1e-9);
});

/* ======================= 新伤害路径固定 20 ======================= */

check('新危险区伤害：落雷/冰环/激光/火焰单次都只扣 20', () => {
  const hp0 = G.p.max;

  // 火焰节点
  G.bossHazards.push({ kind: 'flame', x: G.p.x, y: G.p.y, r: MUT.RIFT_FLAME_RADIUS, age: 0, life: MUT.RIFT_FLAME_LIFE });
  updateBossHazards(0);
  assert.equal(hp0 - G.p.hp, PLAYER.hurtDamage);
  assert.equal(PLAYER.hurtDamage, 20);

  // 落雷：预警期内不伤人
  reset();
  G.bossHazards.push({ kind: 'thunder', x: G.p.x, y: G.p.y, r: MUT.RIFT_THUNDER_RADIUS, warn: 0.8, active: 0.18, age: 0.5, life: 0.98 });
  updateBossHazards(0);
  assert.equal(G.p.hp, G.p.max, '预警阶段不伤人');

  // 落雷：激活期命中一次
  G.bossHazards[0].age = 0.81;
  updateBossHazards(0);
  assert.equal(G.p.max - G.p.hp, 20);

  // 冰环：满环体命中
  reset();
  const ring = {
    kind: 'iceRing', x: 480, y: 300, radius: 600, startR: 600,
    width: MUT.FROST_RING_WIDTH, gapStart: Math.PI, gapSize: MUT.FROST_RING_GAP,
    warn: 0.8, active: 4.2, age: 0.8 + (5 - 0.8) * 0.5, life: 5,
  };
  G.bossHazards.push(ring);
  G.p.x = 480 + 300;
  G.p.y = 300;
  updateBossHazards(0);
  assert.equal(G.p.max - G.p.hp, 20);
  assert.ok(Math.abs(ring.radius - 300) < 1e-9);

  // 冰环：站在缺口里安全
  G.p.inv = 0;
  G.p.hp = G.p.max;
  ring.gapStart = 0;
  updateBossHazards(0);
  assert.equal(G.p.hp, G.p.max, '缺口内不受伤');

  // 激光：预警不伤人、激活命中
  reset();
  G.bossHazards.push({ kind: 'laser', x: 380, y: 300, angle: 0, length: 1200, width: MUT.FINAL_LASER_WIDTH, warn: 1, active: 0.35, age: 0.5, life: 1.35 });
  updateBossHazards(0);
  assert.equal(G.p.hp, G.p.max, '激光预警不伤人');
  G.bossHazards[0].age = 1.01;
  updateBossHazards(0);
  assert.equal(G.p.max - G.p.hp, 20);
});

/* ======================= 配置自检 ======================= */

check('配置：预警时长与词缀/终极字段齐全', () => {
  assert.ok(AFFIX.TELEPORT_WARN >= 0.3);
  assert.ok(MUT.RIFT_THUNDER_WARN >= 0.8);
  assert.ok(MUT.FROST_RING_WARN >= 0.8);
  assert.ok(MUT.FINAL_LASER_WARN >= 0.8);
  assert.equal(AFFIX.RAGE_RATE_MUL, 1.3);
  assert.equal(MUT.RIFT_THUNDER_CD, 3);
  assert.equal(MUT.FROST_RING_CD, 7);
  assert.equal(MUT.VOID_ORB_CD, 4);
  assert.equal(MUT.FINAL_LASER_CD, 4);
  assert.equal(MUT.FINAL_LASER_COUNT, 8);
  assert.equal(MUT.SIEGE_BREAK_COUNT, 20);
  assert.equal(MUT.VOID_SPLIT_COUNT, 2);
});

console.log('');
console.log(`${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
