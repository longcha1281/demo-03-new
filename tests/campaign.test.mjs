// campaign.test.mjs —— 45 房战役骨架回归测试
// 覆盖轮次、Boss 血量倍率、第 45 房拦截、最高分读写、死亡/胜利更新、无尽入口。
import assert from 'node:assert/strict';
import { BOSS, ROOM, CAMPAIGN } from '../src/config.js';
import { G } from '../src/core/state.js';
import {
  campaignRound,
  bossNumberForWave,
  bossHpMultiplier,
  bossHp,
  bossFormConfig,
  spawnBoss,
} from '../src/core/boss.js';
import {
  confirmRoute,
  enterVictory,
  enterEndless,
  readCampaignBest,
  updateCampaignBest,
  update,
} from '../src/core/systems.js';

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('PASS ' + name);
  } catch (err) {
    fail++;
    console.log('FAIL ' + name);
    console.log('     ' + err.message);
  }
}

// 测试用 localStorage：内存实现，不碰真实浏览器存储
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

function resetG() {
  G.state = 'play';
  G.wave = 1;
  G.kills = 0;
  G.score = 0;
  G.time = 0;
  G.bossesCleared = 0;
  G.bestScore = 0;
  G.endless = false;
  G.cleared = false;
  G.bossDefeatedThisRoom = false;
  G.bossRewardClaimed = false;
  G.bossSpawnedThisRoom = false;
  G.roomSpawnPlan = [];
  G.roomSpawnIndex = 0;
  G.enemies.length = 0;
  G.shots.length = 0;
  G.hostile.length = 0;
  G.bossHazards.length = 0;
  G.bossGhosts.length = 0;
  G.zones.length = 0;
  G.bursts.length = 0;
  G.lightningArcs.length = 0;
  G.pickups.length = 0;
  G.combatTexts.length = 0;
  G.p.hp = G.p.max;
}

check('轮次：第 1/15/30/45 房 = 1/1/2/3 轮', () => {
  assert.equal(campaignRound(1), 1);
  assert.equal(campaignRound(15), 1);
  assert.equal(campaignRound(30), 2);
  assert.equal(campaignRound(45), 3);
});

check('Boss 序号：每 3 房一只，第 45 房是第 15 只', () => {
  assert.equal(bossNumberForWave(3), 1);
  assert.equal(bossNumberForWave(15), 5);
  assert.equal(bossNumberForWave(45), 15);
  assert.equal(bossNumberForWave(48), 16);
});

check('Boss 血量倍率：第 1/6/11/15 只 = 1 / 1.4 / 1.85 / 1.85', () => {
  const cases = [
    [1, 1],
    [6, BOSS.ROUND2_HP_MUL],
    [11, BOSS.ROUND3_HP_MUL],
    [15, BOSS.ROUND3_HP_MUL],
  ];
  assert.equal(BOSS.ROUND2_HP_MUL, 1.4);
  assert.equal(BOSS.ROUND3_HP_MUL, 1.85);

  for (const [number, mul] of cases) {
    assert.equal(bossHpMultiplier(number), mul);
    const base = bossFormConfig(number).hp;
    assert.equal(bossHp(number), Math.round(base * mul));
  }
});

check('生成 Boss 时真正套用轮次血量倍率', () => {
  resetG();
  spawnBoss(6);
  const boss6 = G.enemies[0];
  assert.equal(boss6.bossNumber, 6);
  assert.equal(boss6.hp, Math.round(bossFormConfig(6).hp * 1.4));
  assert.equal(boss6.max, boss6.hp);

  resetG();
  spawnBoss(15);
  const boss15 = G.enemies[0];
  assert.equal(boss15.bossNumber, 15);
  assert.equal(boss15.hp, Math.round(bossFormConfig(15).hp * 1.85));
  assert.equal(boss15.max, boss15.hp);
});

check('无尽模式：第 16 只 Boss 在 1.85 倍上继续缓慢增长', () => {
  const expected = 1.85 * (1 + CAMPAIGN.ENDLESS_HP_GROWTH);
  assert.ok(Math.abs(bossHpMultiplier(16) - expected) < 1e-9);
  assert.ok(bossHpMultiplier(16) > 1.85);
  assert.ok(bossHpMultiplier(30) <= 1.85 * (1 + CAMPAIGN.ENDLESS_HP_CAP) + 1e-9);
});

check('第 45 房 confirmRoute 进入 victory，不进入第 46 房', () => {
  resetG();
  G.state = 'route';
  G.wave = 45;
  G.score = 4321;
  G.bossesCleared = 15;

  confirmRoute();

  assert.equal(G.wave, 45);
  assert.equal(G.state, 'victory');
  assert.equal(G.cleared, true);
  assert.equal(readCampaignBest().score, 4321);
  assert.equal(readCampaignBest().cleared, true);
});

check('胜利后再次 confirmRoute 不会推进房号', () => {
  resetG();
  G.state = 'victory';
  G.wave = 45;
  confirmRoute();
  assert.equal(G.wave, 45);
  assert.equal(G.state, 'victory');
});

check('最高分记录读写：写入后能按原字段读回', () => {
  store.clear();
  resetG();
  G.score = 1234;
  G.wave = 20;
  G.bossesCleared = 6;

  const record = updateCampaignBest(false);
  assert.deepEqual(record, {
    score: 1234,
    rooms: 20,
    bosses: 6,
    cleared: false,
  });
  assert.deepEqual(readCampaignBest(), record);
  assert.ok(store.has(CAMPAIGN.BEST_KEY));
});

check('死亡更新最高分：低分不会覆盖已存在的高分', () => {
  store.clear();
  resetG();
  G.score = 5000;
  G.wave = 45;
  G.bossesCleared = 15;
  updateCampaignBest(true);

  G.score = 100;
  G.wave = 10;
  G.bossesCleared = 3;
  updateCampaignBest(false);

  const best = readCampaignBest();
  assert.equal(best.score, 5000);
  assert.equal(best.rooms, 45);
  assert.equal(best.cleared, true);
});

check('胜利更新最高分：更高分覆盖并标记 cleared', () => {
  store.clear();
  resetG();
  G.score = 900;
  G.wave = 30;
  G.bossesCleared = 10;
  updateCampaignBest(false);

  G.score = 6000;
  G.wave = 45;
  G.bossesCleared = 15;
  enterVictory();

  assert.equal(G.bestScore, 6000);
  assert.deepEqual(readCampaignBest(), {
    score: 6000,
    rooms: 45,
    bosses: 15,
    cleared: true,
  });
});

check('真实死亡路径会写入最高分', () => {
  store.clear();
  resetG();
  G.state = 'play';
  G.wave = 7;
  G.score = 888;
  G.p.hp = 0;

  update(0);

  assert.equal(G.state, 'dead');
  assert.equal(readCampaignBest().score, 888);
  assert.equal(readCampaignBest().cleared, false);
});

check('读取损坏记录时按空记录处理，不抛错', () => {
  store.set(CAMPAIGN.BEST_KEY, '{broken json');
  assert.deepEqual(readCampaignBest(), {
    score: 0,
    rooms: 0,
    bosses: 0,
    cleared: false,
  });
});

check('胜利后按 E 进入无尽：从第 46 房继续', () => {
  store.clear();
  resetG();
  G.state = 'victory';
  G.wave = 45;
  G.score = 2000;
  G.bossesCleared = 15;

  enterEndless();

  assert.equal(G.endless, true);
  assert.equal(G.state, 'play');
  assert.equal(G.wave, CAMPAIGN.TOTAL_ROOMS + 1);
});

check('战役节奏常量：45 房 × 每 3 房 1 Boss = 15 场', () => {
  assert.equal(CAMPAIGN.TOTAL_ROOMS, 45);
  assert.equal(ROOM.PER_ROUND, 3);
  assert.equal(BOSS.BOSSES_PER_ROUND, 5);
  assert.equal(CAMPAIGN.TOTAL_ROOMS / ROOM.PER_ROUND, 15);
  assert.equal(campaignRound(45), 3);
});

console.log('');
console.log(`${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
