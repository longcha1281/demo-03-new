// advanced.test.mjs —— 通关后 R4–R7 与双 Boss 自检
// 运行：node tests/advanced.test.mjs
// 用纯 Node 构造 G / Boss，不依赖浏览器。
import assert from 'node:assert/strict';
import { ADVANCED, BOSS, PLAYER } from '../src/config.js';
import { G } from '../src/core/state.js';
import {
  spawnEncounterBosses,
  updateBossSpawnQueue,
  updateBossCountdown,
  tierForBoss,
  tierForRoom,
  isBossRoomWave,
  isR7Wave,
  bossHpMultiplier,
  bossFormConfig,
} from '../src/core/boss.js';
import { damageEnemy } from '../src/core/combat.js';
import { hurtPlayer } from '../src/core/player.js';
import {
  beginRoom,
  update,
  readCampaignBest,
} from '../src/core/systems.js';

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    reset();
    fn();
    pass++;
    console.log('PASS ' + name);
  } catch (err) {
    fail++;
    console.log('FAIL ' + name);
    console.log('     ' + err.message);
  }
}

// 测试用 localStorage：内存实现，不碰真实浏览器存储。
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  },
});

/** 每个用例从干净的场地开始。 */
function reset(extra = {}) {
  G.state = 'play';
  G.wave = 47;
  G.endless = true;
  G.bossEncounter = 15;
  G.kills = 0;
  G.score = 0;
  G.time = 0;
  G.bossesCleared = 0;
  G.normalRoomsCleared = 0;
  G.bestScore = 0;
  G.cleared = false;
  G.bossDefeatedThisRoom = false;
  G.bossRewardClaimed = false;
  G.bossSpawnedThisRoom = false;
  G.bossPairSize = 1;
  G.bossSpawnCountThisRoom = 0;
  G.pendingBossSpawn = null;
  G.bossCountdownRemaining = 0;
  G.r7State = 'idle';
  G.r7RespawnTimer = 0;
  G.r7Time = 0;
  G.roomSpawnPlan = [];
  G.roomSpawnIndex = 0;
  G.left = 0;
  G.spawn = 0;
  G.isSandbox = false;
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
  G.p.hp = G.p.max;
  G.p.inv = 0;
  G.p.x = 480;
  G.p.y = 300;
  G.p.attackTarget = null;
  Object.assign(G, extra);
}

/** 固定 Math.random，保证词缀/延迟可预测。 */
function withRandom(value, fn) {
  const saved = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

/** 打死一只 Boss；护盾会先吃一发，所以循环几次。 */
function killBoss(boss) {
  for (let i = 0; i < 8 && !boss.dead; i++) {
    damageEnemy(boss, boss.max * 100);
  }
  assert.equal(boss.dead, true, 'Boss 应该被打死');
}

function aliveBosses() {
  return G.enemies.filter((e) => e.type === 'boss' && e.hp > 0 && !e.dead);
}

const dualHp = (number, encounter) =>
  Math.round(
    bossFormConfig(number).hp *
      bossHpMultiplier(encounter) *
      ADVANCED.DUAL_HP_MUL
  );

check('房号判定：R4–R6 普通/首领交替，R7 第 76 房起全是首领房', () => {
  assert.equal(isBossRoomWave(45), true, '战役第 45 房仍是首领房');
  assert.equal(isBossRoomWave(46), false);
  assert.equal(isBossRoomWave(47), true);
  assert.equal(isBossRoomWave(56), false);
  assert.equal(isBossRoomWave(57), true);
  assert.equal(isBossRoomWave(66), false);
  assert.equal(isBossRoomWave(67), true);
  assert.equal(isBossRoomWave(75), true);
  for (let w = 76; w <= 90; w++) {
    assert.equal(isBossRoomWave(w), true, `第 ${w} 房应是首领房`);
  }
  assert.equal(isR7Wave(75), false);
  assert.equal(isR7Wave(76), true);
});

check('轮次映射：15=3、16/20=4、21/25=5、26/30=6、31=7', () => {
  assert.equal(tierForBoss(15), 3);
  assert.equal(tierForBoss(16), 4);
  assert.equal(tierForBoss(20), 4);
  assert.equal(tierForBoss(21), 5);
  assert.equal(tierForBoss(25), 5);
  assert.equal(tierForBoss(26), 6);
  assert.equal(tierForBoss(30), 6);
  assert.equal(tierForBoss(31), 7);
});

check('HUD 轮次边界：普通房预览下一场，Boss 房用本场、不提前跳轮', () => {
  // 普通房：bossEncounter 是上一场，显示下一场。
  assert.equal(tierForRoom(46, 15), 4);
  assert.equal(tierForRoom(56, 20), 5);
  assert.equal(tierForRoom(66, 25), 6);

  // Boss 房：进场时 bossEncounter 已经 +1，必须显示本场。
  assert.equal(isBossRoomWave(55), true);
  assert.equal(tierForRoom(55, 20), 4, '最后一场 R4 不能显示成 R5');
  assert.equal(isBossRoomWave(65), true);
  assert.equal(tierForRoom(65, 25), 5, '最后一场 R5 不能显示成 R6');
  assert.equal(isBossRoomWave(75), true);
  assert.equal(tierForRoom(75, 30), 6, '最后一场 R6 不能显示成 R7');

  // 第 76 房走 R7 分支，不进 tierForRoom。
  assert.equal(isR7Wave(76), true);
  assert.equal(tierForRoom(76, 31), 7);
});

check('进 Boss 房时 bossEncounter +1，并按 3 秒倒计时开打', () => {
  G.endless = true;
  G.bossEncounter = 15;
  beginRoom(47);
  assert.equal(G.bossEncounter, 16, '进第 47 房应从 15 加到 16');
  assert.equal(G.bossCountdownRemaining, 3);
  updateBossCountdown(3.01);
  assert.equal(aliveBosses().length, 1, 'R4 是单 Boss');
  assert.equal(G.bossPairSize, 1);
});

check('双 Boss 生成：第一只立即入场，第二只 3–5 秒后入场', () => {
  withRandom(0, () => spawnEncounterBosses(21));
  assert.equal(aliveBosses().length, 1, '第一只立即入场');
  assert.ok(G.pendingBossSpawn, '第二只应进入延迟队列');
  assert.ok(G.pendingBossSpawn.delay >= 3);
  assert.ok(G.pendingBossSpawn.delay <= 5);
  assert.equal(G.bossPairSize, 2);

  updateBossSpawnQueue(2.9);
  assert.equal(aliveBosses().length, 1, '3 秒前第二只不能出现');
  updateBossSpawnQueue(0.2);
  assert.equal(aliveBosses().length, 2, '到点后第二只入场');
  assert.equal(G.bossSpawnCountThisRoom, 2);
});

check('双 Boss 每只 65% 血，同屏最多 2 只', () => {
  withRandom(0.5, () => spawnEncounterBosses(21));
  const first = aliveBosses()[0];
  assert.equal(first.hp, dualHp(21, 21), '第一只按 65% 血');

  updateBossSpawnQueue(5);
  const two = aliveBosses();
  assert.equal(two.length, 2);
  assert.equal(two[1].hp, dualHp(22, 21), '第二只按 65% 血');

  // 场上已有 2 只时，再挂一个延迟请求也不能生成第三只。
  G.pendingBossSpawn = {
    number: 23,
    delay: -1,
    affix: null,
    ultimate: 2,
    hpMul: 1,
  };
  updateBossSpawnQueue(0.01);
  assert.equal(aliveBosses().length, 2, '同屏不能超过 2 只');
  assert.ok(G.pendingBossSpawn, '超限时请求保留，等空位再补');
});

check('R4 单 Boss：带词缀 + 形态终极，血量不打 65% 折扣', () => {
  withRandom(0.5, () => spawnEncounterBosses(16));
  const boss = aliveBosses()[0];
  assert.equal(boss.affix, 'rage');
  assert.equal(boss.ultimate, 0);
  assert.equal(boss.hp, Math.round(bossFormConfig(16).hp * bossHpMultiplier(16)));
  assert.equal(G.pendingBossSpawn, null);
});

check('R5 双 Boss：两只各带终极且都没有词缀', () => {
  withRandom(0.5, () => spawnEncounterBosses(21));
  assert.equal(aliveBosses()[0].affix, null);
  assert.equal(aliveBosses()[0].ultimate, 0);
  updateBossSpawnQueue(5);
  const two = aliveBosses();
  assert.equal(two[1].affix, null);
  assert.equal(two[1].ultimate, 1);
});

check('R6 双 Boss：共享同一个词缀，各自带终极', () => {
  withRandom(0.5, () => spawnEncounterBosses(26));
  const first = aliveBosses()[0];
  assert.equal(first.affix, 'rage');
  assert.equal(first.ultimate, 0);
  updateBossSpawnQueue(5);
  const two = aliveBosses();
  assert.equal(two[1].affix, first.affix, '两只必须共享同一个词缀');
  assert.equal(two[1].ultimate, 1);
});

check('双 Boss 死亡：一只死不开结算，两只都死才置清房标记', () => {
  withRandom(0.5, () => spawnEncounterBosses(26));
  updateBossSpawnQueue(5);
  const [first, second] = aliveBosses();

  killBoss(first);
  assert.equal(G.bossDefeatedThisRoom, false, '只死一只不能结算');
  assert.equal(G.bossesCleared, 1);

  killBoss(second);
  assert.equal(G.bossDefeatedThisRoom, true, '两只都死才结算');
  assert.equal(G.bossesCleared, 2, 'bossesCleared 仍按每只 +1');
});

check('第一只在第二只入场前死亡：不能提前判定清房', () => {
  withRandom(0.5, () => spawnEncounterBosses(21));
  killBoss(aliveBosses()[0]);
  assert.equal(aliveBosses().length, 0);
  assert.equal(G.bossDefeatedThisRoom, false, '第二只还没入场，不能结算');

  updateBossSpawnQueue(5);
  assert.equal(aliveBosses().length, 1);
  killBoss(aliveBosses()[0]);
  assert.equal(G.bossDefeatedThisRoom, true);
});

check('R7：一只死亡不结算，两只死完 3 秒补下一对', () => {
  G.wave = 76;
  G.bossEncounter = 31;
  G.bossSpawnedThisRoom = true;
  G.r7State = 'fighting';
  withRandom(0.5, () => spawnEncounterBosses(31));
  updateBossSpawnQueue(5);

  const [first, second] = aliveBosses();
  killBoss(first);
  assert.equal(G.bossDefeatedThisRoom, false);
  assert.equal(G.state, 'play', 'R7 一只死亡不结算清房');

  killBoss(second);
  assert.equal(G.bossDefeatedThisRoom, true);

  updateBossCountdown(0.01);
  assert.equal(G.r7State, 'respawning');
  assert.ok(G.r7RespawnTimer > 2.9);

  updateBossCountdown(3.0);
  assert.equal(G.r7State, 'fighting');
  assert.equal(G.bossEncounter, 32, '补位时场次递增');
  assert.equal(G.bossDefeatedThisRoom, false);
  assert.equal(aliveBosses().length, 1, '新一对第一只已入场');
  assert.ok(G.state === 'play', '全程不推进房号、不进结算');
});

check('R7 第 76 房不生成普通怪、不刷精英', () => {
  G.endless = true;
  G.bossEncounter = 30;
  beginRoom(76);
  assert.equal(G.wave, 76);
  assert.equal(G.bossEncounter, 31);
  assert.equal(G.roomSpawnPlan.length, 0);
  assert.equal(G.enemies.length, 0, 'R7 开局场上没有普通怪/精英');
  assert.equal(G.bossCountdownRemaining, 3);
});

check('R7 存活分：每帧按 20 分/秒增加', () => {
  G.wave = 76;
  G.bossEncounter = 31;
  G.bossSpawnedThisRoom = true;
  G.r7State = 'fighting';
  G.score = 100;
  G.roomSpawnPlan = [];
  G.p.hp = G.p.max;

  update(1.0);
  assert.equal(G.r7Time, 1);
  assert.equal(G.score, 120, '1 秒应加 20 分');
  assert.equal(G.state, 'play', 'R7 不应结算');

  update(0.5);
  assert.equal(G.score, 130, '0.5 秒应加 10 分');
});

check('R7 死亡仍按现有流程写最高分', () => {
  store.clear();
  G.wave = 76;
  G.bossEncounter = 31;
  G.bossSpawnedThisRoom = true;
  G.r7State = 'fighting';
  G.score = 500;
  G.p.hp = 0;

  update(0);

  assert.equal(G.state, 'dead');
  assert.equal(readCampaignBest().score, 500);
});

check('所有新伤害路径单次最多扣 20，预警仍满足 0.8 秒底线', () => {
  assert.equal(PLAYER.hurtDamage, 20);
  hurtPlayer();
  assert.equal(G.p.hp, G.p.max - 20, '一次受击固定 20');
  assert.ok(BOSS.MUTATION.RIFT_THUNDER_WARN >= 0.8);
  assert.ok(BOSS.MUTATION.FROST_RING_WARN >= 0.8);
  assert.ok(BOSS.MUTATION.FINAL_LASER_WARN >= 0.8);
  assert.equal(BOSS.AFFIX.TELEPORT_WARN, 0.3, '瞬移保留 0.3 秒既定例外');
});

console.log('');
console.log(`${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
