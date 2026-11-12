// combat_tweaks.test.mjs —— 第一批战斗调整自检
// 运行：node tests/combat_tweaks.test.mjs
// 覆盖：血包常驻、嗜血升级夹层、回旋射程、组合扇角、分裂体配色、
//       敌弹元素标记与取色、虚空球速、25 房后成长。
import assert from 'node:assert/strict';
import { BOSS, COLORS, ENEMY, PICKUP, WEAPON } from '../src/config.js';
import { G } from '../src/core/state.js';
import { updatePickups } from '../src/core/player.js';
import { acquireRelic } from '../src/core/systems.js';
import { enemyStats } from '../src/core/enemy.js';
import { spawnBoss, updateBossSkills } from '../src/core/boss.js';
import { updateAttack } from '../src/core/combat.js';
import { hostileShotColor } from '../src/render/entity.js';

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
  G.wave = 1;
  G.time = 0;
  G.score = 0;
  G.autoAttack = true;
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
  G.p.cool = 0;
  G.p.attackTarget = null;
  G.p.relicSlots = [null, null, null, null];
  G.p.relicLevels = {};
  G.p.relicCollection = [];
  G.p.bloodthirstKills = 0;
  Object.assign(G, extra);
}

/** 固定 Math.random，保证分裂/词缀可预测。 */
function withRandom(value, fn) {
  const saved = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

/** 场地里放一只不会动的靶子，供自动瞄准用。 */
function addDummy() {
  G.enemies.push({
    id: 9001,
    type: 'chaser',
    x: G.p.x + 120,
    y: G.p.y,
    r: 6,
    hp: 9999,
    max: 9999,
    dead: false,
  });
}

/** 一次齐射的扇角跨度（弧度）。 */
function shotSpan() {
  const angles = G.shots.map((s) => Math.atan2(s.vy, s.vx)).sort((a, b) => a - b);
  return angles[angles.length - 1] - angles[0];
}

check('血包不随时间消失：满血原地常驻，掉血后照常拾取', () => {
  G.pickups.push({ x: G.p.x, y: G.p.y, age: 0 });

  updatePickups(10);
  assert.equal(G.pickups.length, 1, '久置后血包必须仍然存在');
  assert.equal(G.pickups[0].age, 10, 'age 照常累加');

  G.p.hp = G.p.max - 20;
  updatePickups(0.016);
  assert.equal(G.pickups.length, 0, '掉血后走到血包上要拾取');
  assert.equal(G.p.hp, G.p.max, '拾取回满 20 点');
});

check('血包同屏上限仍是 8，由生成端控制', () => {
  assert.equal(PICKUP.MAX, 8);
});

check('嗜血升级：L2 的 900 击杀先夹到 500 再进 L3', () => {
  G.p.relicCollection.push('bloodthirst');
  G.p.relicLevels.bloodthirst = 2;
  G.p.bloodthirstKills = 900;

  acquireRelic('bloodthirst');

  assert.equal(G.p.relicLevels.bloodthirst, 3);
  assert.equal(G.p.bloodthirstKills, 500, '升级后层数应等于旧等级上限');
});

check('嗜血首次获得仍从 0 层开始', () => {
  G.p.bloodthirstKills = 300;
  acquireRelic('bloodthirst');
  assert.equal(G.p.bloodthirstKills, 0);
});

check('回旋射程基础值 195，文案与实际一致（195/254/312）', () => {
  assert.equal(WEAPON.BOOMERANG.MAX_DIST, 195);
  assert.deepEqual(WEAPON.BOOMERANG.RANGE_MUL, [1, 1.3, 1.6]);
  const text = WEAPON.BOOMERANG.MAX_DIST;
  assert.equal(Math.round(text * 1), 195);
  assert.equal(Math.round(text * 1.3), 254);
  assert.equal(Math.round(text * 1.6), 312);
});

check('散射 + 追踪：扇角大于纯散射', () => {
  G.p.relicSlots[0] = 'tripleShot';
  G.p.relicLevels.tripleShot = 2;
  addDummy();
  updateAttack(0);
  const pureSpan = shotSpan();
  assert.equal(G.shots.length, 3, 'L2 散射应为 3 发');

  G.shots.length = 0;
  G.p.cool = 0;
  G.p.relicSlots[1] = 'homing';
  G.p.relicLevels.homing = 1;
  updateAttack(0);
  const comboSpan = shotSpan();

  assert.ok(comboSpan > pureSpan + 0.05, `组合扇角 ${comboSpan} 应明显大于 ${pureSpan}`);
  assert.ok(comboSpan <= 0.30 * 2 + 1e-9, '单个标签放大后不超过 ±0.30 弧度');
});

check('单发不加扇角', () => {
  addDummy();
  updateAttack(0);
  assert.equal(G.shots.length, 1);
  assert.equal(shotSpan(), 0);
});

check('分裂体配置为红色系', () => {
  const color = ENEMY.TYPES.splitter.color;
  assert.match(color, /^#[0-9a-f]{6}$/i);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  assert.ok(r > g && r > b, `分裂体颜色 ${color} 应以红色为主`);
});

check('冰弹写入 frost 标记，虚空终极弹写入 void 标记', () => {
  // 极寒 Boss：直接把瞄准倒计时压到一帧后出弹。
  const frost = spawnBoss(2);
  frost.frostRingCd = 999;
  frost.iceWind = 0.005;
  updateBossSkills(frost, 0.01);
  assert.ok(
    G.hostile.some((h) => h.element === 'frost'),
    '极寒冰弹应带 frost 标记'
  );

  G.hostile.length = 0;
  G.enemies.length = 0;
  // 虚空 Boss：借用第 3 轮终极的 10 颗追踪球。
  const voidBoss = spawnBoss(4);
  voidBoss.ultimate = 3;
  voidBoss.ultOrbCd = 0;
  withRandom(0, () => updateBossSkills(voidBoss, 0.01));

  const orbs = G.hostile.filter((h) => h.element === 'void');
  assert.ok(orbs.length > 0, '虚空终极球应带 void 标记');
  assert.equal(BOSS.MUTATION.VOID_ORB_SPEED, 120);
  for (const orb of orbs) {
    assert.equal(orb.speed, 120, '虚空终极球速度应为 120');
    assert.equal(Math.round(Math.hypot(orb.vx, orb.vy)), 120);
  }
});

check('敌弹按元素取色：冰/虚空/终焉互不相同，未标记仍为亮红', () => {
  const frost = hostileShotColor({ element: 'frost' });
  const voidColor = hostileShotColor({ element: 'void' });
  const finalColor = hostileShotColor({ element: 'final' });
  const plain = hostileShotColor({});

  assert.equal(frost, '#69d7ff');
  assert.equal(voidColor, '#b06cff');
  assert.equal(plain, COLORS.hostile);
  assert.notEqual(frost, plain);
  assert.notEqual(voidColor, plain);
  assert.notEqual(finalColor, plain);
});

check('25 房后仍成长：第 45 房普通/重甲/精英血量高于第 25 房', () => {
  for (const type of ['chaser', 'tank']) {
    const at25 = enemyStats(type, 25);
    const at45 = enemyStats(type, 45);
    assert.ok(at45.hp > at25.hp, `${type} 第 45 房血量应高于第 25 房`);
    assert.ok(at45.speed > at25.speed, `${type} 第 45 房移速应高于第 25 房`);
  }
  const elite25 = enemyStats('elite', 25);
  const elite45 = enemyStats('elite', 45);
  assert.ok(elite45.hp > elite25.hp, '精英第 45 房血量应高于第 25 房');
  // 新上限按配置生效
  assert.ok(enemyStats('tank', 200).hp <= ENEMY.HP_LATE_CAP);
  assert.ok(enemyStats('elite', 200).hp <= ENEMY.ELITE_HP_LATE_CAP);
});

check('25 房前成长公式保持不变', () => {
  assert.equal(enemyStats('chaser', 1).hp, 30);
  assert.equal(enemyStats('chaser', 25).hp, 30 + 12 * 24);
  assert.equal(enemyStats('elite', 25).hp, 460);
});

console.log('');
console.log(`${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
