// 霜环裁决者（C2）自检：数值、预警、断环缺口的命中/安全、固定 20 伤害。
// 运行：node tests/frost_boss.test.mjs
import assert from 'node:assert/strict';
import { BOSS, PLAYER } from '../src/config.js';
import { G } from '../src/core/state.js';
import {
  spawnBoss,
  updateBossSkills,
  updateBossHazards,
  pushBossHazard,
} from '../src/core/boss.js';

let pass = 0;
let fail = 0;

/** 每个用例都从干净的场地开始，避免上一个用例的实体干扰。 */
function reset() {
  G.bossHazards.length = 0;
  G.hostile.length = 0;
  G.enemies.length = 0;
  G.sparks.length = 0;
  G.p.x = 480;
  G.p.y = 300;
  G.p.inv = 0;
  G.p.hp = G.p.max;
  G.p.hits = 0;
  G.isSandbox = false;
  G.time = 0;
}

/** 断言并计数；单条失败不打断后面的用例。 */
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

/** 造一条已经落地的断环，方便精确摆玩家位置。 */
function ringHazard(age = BOSS.FROST.ringWarn, gapStart = 0) {
  const cfg = BOSS.FROST;
  const h = {
    kind: 'frostRing',
    x: 480,
    y: 300,
    r: cfg.ringStartR,
    startR: cfg.ringStartR,
    endR: cfg.ringEndR,
    width: cfg.ringWidth,
    gapStart,
    gapSize: cfg.ringGap,
    age,
    warn: cfg.ringWarn,
    active: cfg.ringActive,
    life: cfg.ringWarn + cfg.ringActive,
  };
  G.bossHazards.push(h);
  return h;
}

/** 把玩家放到环带上的某个角度；返回该危险区。 */
function putPlayerOnBand(h, angle) {
  G.p.x = h.x + Math.cos(angle) * h.endR;
  G.p.y = h.y + Math.sin(angle) * h.endR;
}

check('配置：断环参数齐全且合法', () => {
  const c = BOSS.FROST;
  assert.equal(typeof c.name, 'string');
  assert.ok(c.hp >= 1000, '血量不应低于旧版');
  assert.ok(c.ringEndR > c.ringStartR);
  assert.ok(c.ringWarn >= 0.8, '预警至少 0.8 秒');
  assert.ok(c.ringActive >= 0.2);
  assert.ok(c.ringWidth < c.ringEndR / 4, '环要薄，不能糊住半个场地');
  const gapDeg = c.ringGap * 180 / Math.PI;
  assert.ok(gapDeg >= 60 && gapDeg <= 150, `缺口 ${gapDeg.toFixed(0)}° 应在合理范围`);
  assert.equal(PLAYER.hurtDamage, 20, '玩家受击固定 20');
});

check('断环裁决：起手生成带缺口的冰环，本体悬停且冰弹停火', () => {
  const e = spawnBoss(2);
  G.p.x = e.x + 200;
  G.p.y = e.y;
  e.frostRingCd = 0.001;
  e.iceShotCd = 0.001;
  updateBossSkills(e, 0.02);

  const ring = G.bossHazards.find(h => h.kind === 'frostRing');
  assert.ok(ring, '应生成 frostRing 危险区');
  assert.ok(ring.gapSize > Math.PI / 3 && ring.gapSize < Math.PI, '缺口约 100°');
  assert.equal(e.speed, 0, '起手同帧停下');
  assert.equal(G.hostile.length, 0, '裁决期间不应同时出冰弹');
});

check('断环裁决：预警 1.1 秒内一圈冰弹都不发', () => {
  const e = spawnBoss(2);
  G.p.x = e.x;
  G.p.y = e.y + 180;
  e.frostRingCd = 0.001;
  e.iceShotCd = 0.001;
  // 逐帧推进到落地结束之前
  for (let i = 0; i < 70; i++) updateBossSkills(e, 0.02);
  assert.equal(G.hostile.length, 0, `1.4 秒内不应出弹，实际 ${G.hostile.length} 发`);
});

check('冰弹：先定格瞄准 0.55 秒，再出 3 发', () => {
  const e = spawnBoss(2);
  G.p.x = e.x + 100;
  G.p.y = e.y;
  e.frostRingCd = 99;
  e.iceShotCd = 0.001;
  updateBossSkills(e, 0.02);
  assert.ok(e.iceWind > 0, '应先进入瞄准');
  assert.equal(G.hostile.length, 0, '瞄准期间不能出弹');
  updateBossSkills(e, BOSS.FROST.iceShotWarn + 0.02);
  assert.equal(G.hostile.length, 3, '一阶段 3 发');
});

check('冰弹：二阶段扇射加强到 5 发', () => {
  const e = spawnBoss(2);
  e.hp = e.max * 0.5;
  G.p.x = e.x - 80;
  G.p.y = e.y;
  e.frostRingCd = 99;
  e.iceShotCd = 0.001;
  updateBossSkills(e, 0.02);
  updateBossSkills(e, BOSS.FROST.iceShotWarn + 0.02);
  assert.equal(G.hostile.length, 5, '二阶段 5 发');
});

check('断环：站在环带上且不在缺口 → 固定扣 20', () => {
  const h = ringHazard();
  putPlayerOnBand(h, h.gapStart + h.gapSize + 0.8);
  updateBossHazards(0.001);
  assert.equal(G.p.hp, G.p.max - 20);
});

check('断环：站在缺口里 → 不扣血', () => {
  const h = ringHazard();
  putPlayerOnBand(h, h.gapStart + h.gapSize / 2);
  updateBossHazards(0.001);
  assert.equal(G.p.hp, G.p.max);
});

check('断环：站在环内/环外 → 不扣血', () => {
  const h = ringHazard();
  const angle = h.gapStart + h.gapSize + 0.8;
  G.p.x = h.x + Math.cos(angle) * (h.endR - h.width - G.p.r - 2);
  G.p.y = h.y + Math.sin(angle) * (h.endR - h.width - G.p.r - 2);
  updateBossHazards(0.001);
  assert.equal(G.p.hp, G.p.max, '环内侧安全区');
  G.p.x = h.x + Math.cos(angle) * (h.endR + h.width + G.p.r + 2);
  G.p.y = h.y + Math.sin(angle) * (h.endR + h.width + G.p.r + 2);
  updateBossHazards(0.001);
  assert.equal(G.p.hp, G.p.max, '环外侧安全区');
});

check('断环：预警阶段不伤人，半径按时间向外扩', () => {
  const h = ringHazard(0);
  putPlayerOnBand(h, h.gapStart + h.gapSize + 0.8);
  updateBossHazards(BOSS.FROST.ringWarn * 0.5);
  assert.equal(G.p.hp, G.p.max, '预警阶段只画不伤');
  const expected = h.startR + (h.endR - h.startR) * 0.5;
  assert.ok(Math.abs(h.r - expected) < 1, `半径应扩到 ${expected.toFixed(0)}，实际 ${h.r.toFixed(0)}`);
});

check('断环：连续判定受无敌帧保护，一次只扣 20', () => {
  const h = ringHazard();
  putPlayerOnBand(h, h.gapStart + h.gapSize + 0.8);
  updateBossHazards(0.05);
  updateBossHazards(0.05);
  updateBossHazards(0.05);
  assert.equal(G.p.hp, G.p.max - 20);
});

check('断环落地后整体消失，不会留下永久危险区', () => {
  const h = ringHazard();
  updateBossHazards(BOSS.FROST.ringWarn + BOSS.FROST.ringActive + 0.01);
  assert.equal(G.bossHazards.filter(x => x.kind === 'frostRing').length, 0);
});

check('常规冰圈：生效时只减速、不扣血', () => {
  pushBossHazard({
    kind: 'frostZone',
    x: G.p.x,
    y: G.p.y,
    r: BOSS.FROST.zoneRadius,
    age: BOSS.FROST.zoneWarn + 0.1,
    warn: BOSS.FROST.zoneWarn,
    active: BOSS.FROST.zoneDuration,
    life: BOSS.FROST.zoneWarn + BOSS.FROST.zoneDuration,
  });
  updateBossHazards(0.01);
  assert.equal(G.p.hp, G.p.max);
});

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
