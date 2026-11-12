// spell.js —— 法术编译器
// 把玩家 3 个普通遗物槽按 0 → 1 → 2 的顺序翻译成一份"施法数据包"。
// 关键规则：数据包只记录顺序编译后的结果；裂变会额外拍一张"快照"，
// 记录它出现那一刻的子弹数和张角，后面的散射只作用于裂变出来的子代。
import { SPELL, WEAPON } from '../config.js';
import { relicLevel } from './player.js';

/**
 * 生成一次施法的初始数据包。
 * 这些字段是法术系统的唯一真源，开火逻辑只读它，不再逐个判断遗物。
 * @param {object} player 玩家对象，至少要有 damage 字段
 * @returns {object} 初始施法数据
 */
export function createBaseCastData(player) {
  return {
    count: 1,             // 最终子弹数（如果后面遇到裂变，母弹数会被快照定格）
    spread: 0,            // 扇形张角（弧度）
    form: 'default',      // 母弹形态：default / lightning
    childLightning: false, // 闪电排在裂变之后时，只让子代变闪电，母弹保持普通
    tags: [],             // 命中效果标签：pierce / homing / fission
    fissionCount: 0,      // 遇到裂变那一刻的子弹数快照
    fissionSpread: 0,     // 遇到裂变那一刻的张角快照

    // 下面两个是内部数据，不参与"顺序"判断：
    damage: player.damage, // 每颗母弹的基础伤害
    levels: {},            // 各遗物等级，开火时读追踪 / 回旋 / 穿透参数
  };
}

/**
 * 散射：按真实遗物等级取发数（Lv1=2、Lv2=3、Lv3=5），
 * 张角固定 0.17 弧度。不能写死 +2，否则 Lv1 会错误地打出 3 发，
 * 裂变乘法读到的等级就和实际弹数脱节了。
 */
export function applyTripleShot(castData) {
  const level = castData.levels.tripleShot || 1;
  const cfg = WEAPON.TRIPLE_SHOT[level - 1];
  castData.count = cfg.count;
  castData.spread = SPELL.TRIPLE_SPREAD;
  return castData;
}

/** 穿透：只挂标签；具体能穿几次由 SPELL.PIERCE_BONUS 决定。 */
export function applyPiercing(castData) {
  castData.tags.push('pierce');
  return castData;
}

/**
 * 裂变：记录"此刻"的子弹数和张角，再挂标签。
 * 这个快照决定母弹到底发几发：裂变后面的散射不会再补发母弹。
 */
export function applyFission(castData) {
  castData.fissionCount = castData.count;
  castData.fissionSpread = castData.spread;
  castData.tags.push('fission');
  return castData;
}

/** 追踪：挂标签，开火时按遗物等级读取转向半径和转速。 */
export function applyHoming(castData) {
  castData.tags.push('homing');
  return castData;
}

/** 回旋：挂标签，开火时初始化出程 / 返程 / 缓冲 / 游离状态机。 */
export function applyBoomerang(castData) {
  castData.tags.push('boomerang');
  return castData;
}

/**
 * 闪电：严格按槽位顺序决定形态。
 * 闪电在裂变之前 —— 母弹就是闪电；
 * 闪电在裂变之后 —— 母弹保持普通物理弹，只把子代标记成闪电。
 */
export function applyLightning(castData) {
  if (castData.tags.includes('fission')) {
    castData.childLightning = true;
    return castData;
  }
  castData.form = 'lightning';
  return castData;
}

// 遗物 id → 修改器。只有这 6 件普通遗物会进入法术编译器。
const SLOT_MODIFIERS = {
  tripleShot: applyTripleShot,
  piercing: applyPiercing,
  hitFission: applyFission,
  homing: applyHoming,
  boomerangCore: applyBoomerang,
  lightningLink: applyLightning,
};

/**
 * 按 0 → 1 → 2 号槽位顺序编译。
 * 例：先散射后裂变 → count 3、fissionCount 3，母弹 3 发；
 *     先裂变后散射 → count 3、fissionCount 1，母弹 1 发，命中后子代吃散射。
 * @param {object} player 玩家对象
 * @returns {object} 编译后的施法数据
 */
export function compileCastData(player) {
  const castData = createBaseCastData(player);

  for (let slot = 0; slot < 3; slot++) {
    const id = player.relicSlots[slot];
    if (!id) continue;

    const modifier = SLOT_MODIFIERS[id];
    if (!modifier) continue;

    castData.levels[id] = relicLevel(id);
    modifier(castData);
  }

  // 最后一道安全护栏：三个槽全叠散射也只有 7 发，这里防止旧存档 / 手写数据越界。
  if (castData.count > SPELL.CAST_MAX_COUNT) {
    castData.count = SPELL.CAST_MAX_COUNT;
  }

  return castData;
}
