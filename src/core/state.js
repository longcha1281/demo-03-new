// ============================================================
// state.js —— 全局运行时状态（"会变"的数据）
// 静态数值都在 config.js；这里只放每局、每帧会被改写的东西。
// G    = 整局游戏的状态（房间、分数、实体数组……）
// G.p  = 唯一的玩家对象
// ============================================================

import { PLAYER, ROOM } from '../config.js';

// 创建一个全新的玩家。开局 / 重开都调用它。
// 字段含义见《规范》1.1 玩家字段表。
export function createPlayer() {
  return {
    /* --- 位置与体型 --- */
    x: PLAYER.x,                       // 横坐标（逻辑像素）
    y: PLAYER.y,                       // 纵坐标
    r: PLAYER.radius,                  // 碰撞半径（渲染和碰撞都用它）

    /* --- 生命与受击 --- */
    hp: PLAYER.hp,                     // 当前生命
    max: PLAYER.maxHp,                 // 生命上限
    hits: 0,                           // 本局被打中的次数（结算用）

    /* --- 移动与攻击 --- */
    speed: PLAYER.speed,               // 移动速度
    damage: PLAYER.damage,             // 单发主弹伤害
    rate: PLAYER.rate,                 // 攻击间隔（秒）
    cool: 0,                           // 攻击冷却，≤0 才能开火

    /* --- 冲刺 --- */
    dash: 0,                           // 冲刺剩余时间
    dashCD: 0,                         // 冲刺冷却剩余
    dashRate: PLAYER.dashRate,         // 冲刺冷却上限

    /* --- 无敌时间 --- */
    frostSlowTime: 0,                  // 冰弹命中后的短时减速
    inv: 0,                            // 受击/冲刺后的无敌剩余秒数
    hurtFlash: 0,                      // 受击红晕剩余时间（只受击，不跟冲刺共用）

    /* --- 治疗 --- */
    roomHealRemaining: PLAYER.roomHeal, // 本房剩余"限额治疗"额度

    /* --- 主附魔（开局三选一，本局不可更换） --- */
    core: null,                        // 运行时核心 id：fire / ice / dark
    enchantState: {
      primaryId: null,                 // 主附魔 id
      secondaryId: null,               // 副附魔 id（通常 null）
      secondaryUnlocked: false,        // 是否已解锁副附魔
      secondaryUnlockSource: null,     // 由什么解锁的（通常是元素混合遗物）
      runtimeCoreId: null,             // 运行时实际使用的核心
    },

    /* --- 阈值计数：主、副两条独立计数，满 10 触发一次元素爆发 --- */
    enchantCounters: {
      primary:   { value: 0, triggers: 0 },
      secondary: { value: 0, triggers: 0 },
      recentEnergy: 0,                 // 最近一次获得阈值能量的动画值
    },

    /* --- 属性升级等级表：{ power: 2, vitality: 1, ... } --- */
    items: {},

    /* --- 遗物：槽位 + 等级（第十一阶段） --- */
    relicSlots: [null, null, null, null], // 0/1/2 普通槽，3 特殊槽；只存遗物 id
    relicCollection: [],                  // 本局收藏过的遗物 id（含未上场）
    relicLevels: {},                      // 遗物 id → 等级（唯一真源）

    /* --- 瞄准与锁定 --- */
    attackTarget: null,                // 中键锁定的目标（可空）
    aimX: PLAYER.aimX,                 // 最近瞄准点 x
    aimY: PLAYER.aimY,                 // 最近瞄准点 y

    /* --- 自增 id：阈值计数去重用（同一弹丸同一目标只算一次） --- */
    nextAttackId: 0,
    nextProjectileId: 0,

    /* --- 特殊机制计数 --- */
    bloodthirstKills: 0,               // 嗜血：累计击杀
    boomerangShotsFired: 0,            // 回旋：累计发射数

    /* --- 生命汲取：1 秒窗口内最多回 12 血 --- */
    lifestealWindowStart: 0,           // 窗口起点（秒）
    lifestealWindowHealed: 0,          // 窗口内已回血量

    /* --- 受治疗的视觉反馈 --- */
    healFlashes: [],
    healAbsorb: 0,
  };
}

// 整局游戏状态。state 字段是状态机当前态（title / play / upgrade ...）。
export const G = {
  state: 'title',                      // 状态机当前态（第一阶段只用到 title/play）
  wave: 1,                             // 当前第几房（从 1 开始）
  kills: 0,                            // 本局击杀数

  left: 0,                             // 本房还没生成的普通怪数量
  spawn: 0,                            // 下一只怪生成倒计时

  time: 0,                             // 本局已进行的秒数

  rerolls: ROOM.REROLLS,               // 剩余刷新次数（整局，不按房）
  rewardLeft: 1,                       // 本次升级还能选几次
  score: 0,                            // 本局得分

  roomHurt: false,                     // 本房是否被击中（影响无伤奖励）
  bossDefeatedThisRoom: false,         // 本房首领是否已死
  bossRewardClaimed: false,            // 本房首领奖励是否已发
  bossSpawnedThisRoom: false,          // 本房首领是否已经刷出来

  /* --- 奖励面板：upgrade 状态下由 main.js 的 showReward 显示 --- */
  rewardKind: 'stat',                  // 本次奖励类型：stat 三选一 / relic 四选一
  rewardCards: [],                     // 本次可选的卡（对象数组，来自 config.REWARD）
  pendingSecondarySelection: false,    // 拿到元素混合后，是否正等玩家选副元素

  normalRoomsCleared: 0,               // 累计清掉的普通房
  bossesCleared: 0,                    // 累计击败的首领
  bossCountdownRemaining: 0,           // 首领入场倒计时（首领房开局设 3）
  bossEncounter: 0,                    // 第几场 Boss：进无尽设 15，每进 Boss 房 +1
  bossPairSize: 1,                     // 本场应生成几只 Boss（1 单 / 2 双）
  bossSpawnCountThisRoom: 0,           // 本场已生成几只 Boss
  pendingBossSpawn: null,              // 双 Boss 第二只的延迟入场信息
  r7State: 'idle',                     // R7 状态：idle / fighting / respawning
  r7RespawnTimer: 0,                   // R7 下一对入场倒计时
  r7Time: 0,                           // R7 已存活秒数（同时用于计分）

  mode: 'campaign',                    // 固定战役模式（"无尽"就是默认玩法）
  route: 'normal',                     // 当前房间路线 normal / boss
  endless: false,                      // 通关后进入无尽：从第 46 房继续现有循环
  cleared: false,                      // 本局是否已通关正式战役
  bestScore: 0,                        // 最高分（来自 localStorage 纪录）

  /* --- 攻击模式与连锁冷却（第十一阶段） --- */
  autoAttack: true,                    // 自动攻击开关（右上角按钮切换）
  mouseDown: false,                    // 手动模式下鼠标左键是否按着
  lightningCD: 0,                      // 闪电链接的公共冷却（秒）
  isSandbox: false,                    // F2 沙盒模式：不掉血、清房不结算

  roomSpawnPlan: [],                   // 本房怪物类型序列
  roomSpawnIndex: 0,                   // 已取到第几个

  /* --- 房间提示：屏幕中央短暂显示的文字（清房 / 进房） --- */
  notice: { text: '', sub: '', timer: 0 },  // timer > 0 时才画

  /* --- 实体表：全部是普通数组，每帧暴力遍历（按规范不用空间哈希） --- */
  enemies: [],        // 敌人
  shots: [],          // 玩家子弹
  hostile: [],        // 敌方子弹
  sparks: [],         // 粒子
  pickups: [],        // 血包等掉落
  combatTexts: [],    // 伤害/治疗飘字
  zones: [],          // 附魔地面区域（目前是暗元素黑洞）
  bursts: [],         // 元素爆发的扩散环（纯视觉，不参与结算）
  lightningArcs: [],  // 闪电链折线（纯视觉，0.1 秒淡出）
  bossHazards: [],    // 首领危险区（火焰节点 / 冰环 / 激光），参与碰撞
  bossGhosts: [],     // 首领瞬移残影（纯视觉，0.4 秒淡出）

  /* --- 震屏：元素爆发时设一个值，之后每帧衰减到 0 --- */
  shake: 0,

  // 元素混合 Lv3 的“第三元素爆发”内部冷却（G.time 时间戳）
  mixThirdReady: 0,

  p: createPlayer(),  // 玩家单例
};
