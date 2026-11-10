// ============================================================
// config.js —— 全部静态数据（"不会变"的数值都放这里）
// 原则：游戏过程中会变的东西（血量、位置、计时）放 state.js；
//       这里只放"一局开始到结束都不会改"的数值，方便调平衡。
// 数值来源：《游戏逻辑与数据规范 · 星核觉醒》附录 A / 各小节。
// ============================================================

/* ---------------- 画布 ---------------- */
export const CANVAS = {
  WIDTH: 960,      // 逻辑宽度。游戏里所有坐标都按 960×540 算
  HEIGHT: 540,     // 逻辑高度
  SCALE: 1.5,      // 显示放大倍数：960×540 → 画布物理尺寸 1440×810
  GRID: 24,        // 背景网格线间距（px）
  STAR_COUNT: 50,  // 背景随机星星数量
};

/* ---------------- 调色板（极简几何 + 霓虹） ----------------
   黑底 + 高饱和色 + shadowBlur 发光，就是全部的"美术"。 */
export const COLORS = {
  bg: '#04060b',                              // 背景底色
  grid: 'rgba(90, 140, 255, 0.08)',           // 网格线（很淡）
  star: 'rgba(180, 220, 255, 0.55)',          // 背景星星
  border: 'rgba(90, 160, 255, 0.35)',         // 场地边框

  player: '#39f6ff',        // 玩家主色（青色霓虹）
  playerGlow: '#00d8ff',    // 玩家发光颜色
  playerCore: '#eafdff',    // 玩家内核高亮

  enemy: '#ff5a7a',         // 普通敌人
  elite: '#ffb84d',         // 精英
  boss: '#c06bff',          // 首领

  shot: '#ffe66b',          // 玩家子弹（黄色发光小方块）
  hostile: '#FF3333',      // 敌方子弹统一亮红：和玩家黄弹一眼分开

  hp: '#ff4d6d',            // 血条
  exp: '#5ef2a0',           // 经验条
  text: '#d8ecff',          // 主文字
  textDim: 'rgba(180, 210, 240, 0.55)', // 次要文字

  /* --- 第八阶段：元素附魔与伤害数字 --- */
  fire: '#ff7a5c',          // 火：灼烧 / 火焰爆发
  ice: '#7fd8ff',           // 冰：减速 / 冻结
  dark: '#c06bff',          // 暗：侵蚀 / 黑洞
  direct: '#ffe66b',        // 子弹直伤数字（黄色）
};

/* ---------------- 玩家基础数值 ----------------
   这些是"开局值"。运行中会被 state.js 里的玩家对象复制一份并改写。 */
export const PLAYER = {
  x: 480, y: 270,        // 开局位置=屏幕正中央（restartRun 也会设一次）
  hp: 120,               // 初始生命
  maxHp: 120,            // 生命上限（"生命修复"升级可加到 200）
  radius: 5,             // 玩家碰撞半径（敌人贴到 玩家半径+敌人半径 就算接触）
  speed: 120,            // 移动速度 px/s（本轮整体 +15%，让走位更跟手）

  damage: 14,            // 单发主弹伤害
  rate: 0.32,            // 基础攻击间隔（秒）

  dashTime: 0.16,        // 冲刺持续 0.16s
  dashInv: 0.22,         // 冲刺无敌 0.22s
  dashRate: 2.4,         // 冲刺冷却 2.4s
  dashMul: 3.3,          // 冲刺期间速度倍率 3.3×

  hurtInv: 0.65,         // 每次受击后的无敌时间
  hurtDamage: 20,        // 决议：受击一律固定扣 20 血
  roomHeal: 20,          // 清房回血 20

  aimX: 450, aimY: 180,  // 最近一次瞄准点（默认朝右）
};

/* ---------------- 同屏对象硬上限 ----------------
   超过就不再生成，防止后期卡成幻灯片。 */
export const LIMITS = {
  enemies: 48,        // 场上敌人最多 48 只
  bossMinions: 6,     // 首领召唤物最多 6 只
  hostileShots: 160,  // 敌方子弹最多 160 发
  playerShots: 120,   // 玩家子弹最多 120 发
  sparks: 320,        // 粒子最多 320 个
  enchantZones: 6,    // 附魔地面区域（火爆炸/黑洞）最多 6 个
  combatTexts: 24,    // 伤害飘字最多 24 条
  bursts: 64,         // 爆炸冲击波最多 64 个（自爆蛛同帧爆炸时防止无界增长）
  bossHazards: 24,    // 首领地面/激光危险区最多 24 个（火焰节点、冰环、激光）
  bossGhosts: 8,      // 首领瞬移残影最多 8 个（纯视觉）
};

/* ---------------- 敌人基础数值 ----------------
   体型：普通 6、精英 9（普通 1.5 倍）、首领 17（终局 23）。 */
export const ENEMY = {
  RADIUS: { normal: 6, elite: 9, boss: 17, finalBoss: 23 },

  // hp / speed 是"第 1 房、未成长"时的基础值；score 是击杀得分
  TYPES: {
    chaser:  { hp: 30,  speed: 39.6, score: 40 },   // 追猎：直线追（原 36，+10%）
    runner:  { hp: 30,  speed: 70.4, score: 40 },   // 疾行：更快（旧类型，仍保留兼容）
    tank:    { hp: 65,  speed: 24.2, score: 60 },   // 重甲：慢但厚（旧类型，仍保留兼容）
    shooter: { hp: 30,  speed: 39.6, score: 60 },   // 射手：会远程（原 36，+10%）
    bomber:  { hp: 12,  speed: 75,   score: 50 },   // 自爆蛛：低血、沉重，靠近后点燃引信
    splitter:{ hp: 40,  speed: 32,   score: 50 },   // 分裂体：绿色双圆，死亡裂成 2 只小追猎
    elite:   { hp: 150, speed: 39.6, score: 250 },  // 精英：三连扇形弹 / 辅助光环
    boss:    { hp: 548, speed: 34, score: 1500 }, // 首领：血量真实值由 BOSS.HP 公式算
  },

  HP_GROWTH_PER_WAVE: 12,   // 每房普通/重甲血量 +12
  HP_GROWTH_CAP_WAVE: 25,   // growth = min(24, wave-1)，第 25 房封顶
  SPEED_GROWTH_PER_WAVE: 2.0, // 每房移速 +2
  SPEED_CAP: 120,           // 移速上限
  ELITE_HP_BASE: 150,       // 精英血量 = min(460, 150 + 20×growth)
  ELITE_HP_PER_GROWTH: 20,
  ELITE_HP_CAP: 460,
  ELITE_FROM_WAVE: 10,      // 第 10 房起才出精英：10–19 房 1 只，20 房起 2 只
  ELITE_TWO_FROM_WAVE: 20,  // 从第 20 房起精英数量变成 2 只
  MINION_HP_MUL: 0.8,       // 首领召唤的小怪，血量 ×0.8
  BOSS_MINION_LIFE: [10, 12, 8, 9, 8],   // 五种首领召唤物存活秒数（终焉本体不召唤）
  BOSS_MAX_MINIONS: [3, 3, 2, 4, 2],     // 五种首领单场召唤上限（终焉本体不召唤）
  BOSS_MINION_TOTAL_CAP: 54,          // 召唤总数上限 min(54, 本房怪数+2)

  /* ---------------- 自爆蛛：靠近后点燃引信 / 死亡都会炸 ---------------- */
  BOMBER: {
    TRIGGER_DIST: 90,       // 进入这个距离就点燃引信，不再立刻爆炸
    EXPLODE_RADIUS: 80,    // 爆炸半径
    DAMAGE: 20,             // 爆炸对玩家固定 20（和普通受击一致）
    FUSE: 0.65,             // 引信时间：点燃后 0.65 秒才爆炸，给玩家逃跑窗口
  },

  /* ---------------- 分裂体：死亡裂成 2 只微型追猎 ---------------- */
  SPLITTER: {
    CHILD_COUNT: 2,         // 死亡生成几只
    CHILD_HP_MUL: 0.3,      // 血量 = 本体 30%
    CHILD_SPEED_MUL: 2,     // 移速 = 本体 2 倍
    CHILD_RADIUS_MUL: 0.6,  // 体型 = 本体 60%
  },

  /* ---------------- 射手：会后退 / 停步 / 开火 ---------------- */
  SHOOTER: {
    RETREAT_DIST: 100,       // 比这个距离还近 → 后退
    STOP_DIST: 140,          // 100–140 之间 → 停下不动（小于回旋镖基础射程 150，避免站桩打不到）
    FIRE_DIST: 250,          // 只有在这个距离内才开火
    FIRE_CD: 2,              // 两发之间隔 2 秒
    BULLET_SPEED: 150,       // 敌弹速度 px/s
    BULLET_LIFE: 5,          // 敌弹存活秒数
  },

  /* ---------------- 精英：攻击型扇形弹 / 辅助型光环 ---------------- */
  ELITE: {
    FIRE_CD: 2.5,            // 每 2.5 秒一次
    FIRE_RANGE: 300,         // 玩家在 300px 内才开火
    FAN_COUNT: 3,            // 一次几发
    FAN_GAP: Math.PI / 12,   // 相邻两发夹角 15°
    BULLET_SPEED: 170,       // 扇形弹速度
    BULLET_LIFE: 5,
    HOLD_TIME: 0.28,         // 开火时原地停多久

    SUPPORT_CHANCE: 0.35,    // 35% 概率是辅助型；其余是攻击型
    AURA_RADIUS: 200,        // 辅助光环半径
    AURA_SPEED_MUL: 1.3,     // 光环内小怪移速 +30%
    AURA_RATE_MUL: 1.3,      // 光环内小怪攻速 +30%（冷却推进 ×1.3）

    AFFIX_MIN: 1,            // 精英至少带 1 个词缀
    AFFIX_MAX: 2,            // 最多 2 个，不重复
    AFFIX_POOL: ['shield', 'teleport', 'explode', 'split'],
    SHIELD_RATIO: 0.30,      // 护盾 = 最大生命 30%
    SHIELD_CD: 4,            // 破盾后 4 秒重新套盾
    TELEPORT_CD: 5,          // 每 5 秒瞬移一次
    TELEPORT_DIST: 150,      // 瞬移到离玩家 150px 的位置
    EXPLODE_RADIUS: 100,     // 自爆词缀死亡爆炸半径
    SPLIT_COUNT: 2,          // 分裂词缀死亡生成 2 只普通追猎
  },
};

/* ---------------- 刷怪节奏 ---------------- */
export const SPAWN = {
  ROOM1_COUNT: 12,        // 第 1 房固定 10 追猎 + 1 射手 + 1 分裂体
  ROOM2_COUNT: 15,        // 第 2 房固定 13 追猎 + 1 自爆蛛 + 1 射手
  COUNT_BASE: 9,          // 之后每房 round(min(52, 9 + 1.6×wave))
  COUNT_PER_WAVE: 1.6,
  COUNT_CAP: 52,

  ROOM1_INTERVAL: 0.58,   // 第 1 房每 0.58s 生成一只
  ROOM2_INTERVAL: 0.52,
  INTERVAL_BASE: 0.62,    // 之后 max(0.34, 0.62 - 0.025×wave)
  INTERVAL_PER_WAVE: 0.025,
  INTERVAL_MIN: 0.34,

  MIN_DIST_TO_PLAYER: 90, // 出生点离玩家太近（<90px）就换到对角
  EDGE: 25,               // 出生点在屏幕四边，离边缘 25px

  /* 类型分布（roll 是 0–1 随机数）：
     1–2 房：固定教学阵容，由 buildRoomPlan 直接返回；
     3–4 房：约 20% 射手/分裂体，让新怪种轻量登场；
     5–9 房：自爆蛛占约 10%，射手/分裂体逐步增多；
     10 房起：恢复高比例机制怪。 */
  EARLY_ROLL_SHOOTER: 0.8, // 3–4 房：< 0.8 追猎，< 0.9 射手，其余分裂体
  EARLY_ROLL_SPLITTER: 0.9,
  MID_ROLL_CHASER: 0.55,   // 5–9 房：< 0.55 追猎
  MID_ROLL_SHOOTER: 0.8,   // < 0.8 射手
  MID_ROLL_SPLITTER: 0.9,  // < 0.9 分裂体，其余自爆蛛（约 10%）
  LATE_ROLL_CHASER: 0.3,   // 10 房起：< 0.3 追猎
  LATE_ROLL_SHOOTER: 0.5,  // < 0.5 射手
  LATE_ROLL_SPLITTER: 0.7, // < 0.7 分裂体，其余自爆蛛
};

/* ---------------- 首领 ----------------
   血量 = round(min(3000, (270 + 168 + min(n-1,3)×130
          + min(max(0,n-4),4)×84 + max(0,n-9)×56) × 1.25))
   n = 第几只首领（从 1 数）。 */
export const BOSS = {
  HP: {
    BASE: 270,
    FLAT: 168,          // 固定项 6×28
    STEP_A: 130,        // 第 1–4 只：每只 +130
    STEP_A_CAP: 3,      // 最多加 3 次
    STEP_B: 84,         // 第 5–8 只：每只 +84
    STEP_B_CAP: 4,      // 最多加 4 次
    STEP_C: 56,         // 第 10 只起：每只 +56
    MULTIPLIER: 1.25,   // 最后整体 ×1.25
    MAX: 3000,          // 血量硬上限
  },
  PHASE_2: 0.65,        // 血量比 >0.65 是 1 阶段，>0.30 是 2 阶段，否则 3 阶段
  PHASE_3: 0.30,
  ENRAGE_AT: 0.5,       // 血量 ≤50% 进入暴怒
  WARN_TIME: 0.65,      // 出招前预警 0.65s
  MAX_VOLLEY: 32,       // 单次齐射最多 32 发
  RADIAL_BASE: 6,       // 环射基础 6 发 + 阶段/暴怒加成
  AURA: { RADIUS: 120, SPEED_MUL: 1.2, RATE_MUL: 1.25 }, // 首领光环

  /* ---------------- 大任务20：首领「三轮大循环」 ----------------
     每 5 只首领算一轮：
     第 1 轮正常；第 2 轮血量/伤害 ×1.5 并随机 1 个词缀；
     第 3 轮起血量/伤害 ×2，并按原型强制质变（不再放普通环形弹）。 */
  BOSSES_PER_ROUND: 5,       // 每轮 5 只首领
  ROUND2_HP_MUL: 1.5,        // 第 2 轮血量倍率
  ROUND3_HP_MUL: 2.0,        // 第 3 轮及以后血量倍率
  ROUND2_DAMAGE_MUL: 1.5,    // 第 2 轮伤害倍率（只记录/展示，实际受击仍固定 20）
  ROUND3_DAMAGE_MUL: 2.0,    // 第 3 轮及以后伤害倍率（同上）

  // 第 2 轮随机词缀池（每只首领只抽 1 个）
  AFFIX_POOL: ['shield', 'rage', 'teleport'],
  AFFIX: {
    SHIELD_CD: 4,            // 词缀·护盾：破盾后每 4 秒重新获得
    SHIELD_RATIO: 0.30,      // 词缀·护盾：护盾量 = 最大生命 30%
    RAGE_RATE_MUL: 1.3,      // 词缀·暴怒：出招/攻击冷却推进速度 ×1.3
    TELEPORT_CD: 5,          // 词缀·瞬移：每 5 秒一次
    TELEPORT_DIST: 150,      // 瞬移到离玩家 150px 的位置
    GHOST_LIFE: 0.4,         // 瞬移后原地残影存活 0.4 秒
  },

  /* 第 3 轮起按原型强制质变；伤害仍然统一由 PLAYER.hurtDamage 固定 20 */
  MUTATION: {
    // 裂隙追猎者：冲锋路径每 0.06s 留下一个火焰节点
    RIFT_FLAME_INTERVAL: 0.06,
    RIFT_FLAME_LIFE: 3,      // 火焰节点存活 3 秒
    RIFT_FLAME_RADIUS: 8,    // 火焰节点碰撞/绘制半径
    RIFT_THUNDER_CD: 3,      // 每 3 秒在玩家脚下放一次落雷预警
    RIFT_THUNDER_WARN: 0.8,  // 红圈预警 0.8 秒后落雷
    RIFT_THUNDER_RADIUS: 46, // 落雷命中半径
    RIFT_THUNDER_ACTIVE: 0.18, // 落雷判定/闪光持续 0.18 秒

    // 霜环裁决者：常驻减速领域 + 每 7 秒生成一个从 600 收缩到 0 的冰环
    FROST_FIELD_RADIUS: 170, // 冰蓝减速领域半径
    FROST_FIELD_SLOW: 0.5,   // 玩家踩进去移速 ×0.5
    FROST_RING_CD: 7,
    FROST_RING_START_RADIUS: 600,
    FROST_RING_LIFE: 5,      // 收缩到 0 所需秒数
    FROST_RING_WIDTH: 16,    // 环带宽 16px
    FROST_RING_GAP: 1.0,     // 缺口弧度（约 57°）

    // 熔核攻城兽：护盾 20% + 破盾瞬间 20 发环形弹
    SIEGE_SHIELD_RATIO: 0.20,
    SIEGE_BREAK_COUNT: 20,
    SIEGE_BREAK_SPEED: 150,
    SIEGE_BREAK_LIFE: 5,

    // 虚空织巢者：每 4 秒 10 发慢速强追踪紫球，命中玩家后分裂 2 发小球
    VOID_ORB_CD: 4,
    VOID_ORB_COUNT: 10,
    VOID_ORB_SPEED: 55,
    VOID_ORB_TURN: 2.6,
    VOID_ORB_LIFE: 7,
    VOID_ORB_RADIUS: 6,
    VOID_SPLIT_COUNT: 2,
    VOID_CHILD_SPEED: 90,
    VOID_CHILD_TURN: 3.2,
    VOID_CHILD_LIFE: 3.5,
    VOID_CHILD_RADIUS: 4,

    // 终焉之瞳：第 1/2 轮十字四向激光；第 3 轮起米字八向激光
    FINAL_CROSS_CD: 3,       // 第 1/2 轮十字激光间隔
    FINAL_CROSS_COUNT: 4,    // 第 1/2 轮十字激光道数
    FINAL_LASER_CD: 4,       // 第 3 轮八向激光间隔
    FINAL_LASER_COUNT: 8,    // 第 3 轮米字激光道数
    FINAL_LASER_WARN: 1,     // 预警 1 秒（虚线）
    FINAL_LASER_ACTIVE: 0.35, // 激活 0.35 秒（实线，碰到扣 20）
    FINAL_LASER_LENGTH: 1200, // 激光长度
    FINAL_LASER_WIDTH: 10,   // 激光碰撞宽度
    FINAL_ENRAGE_HP: 0.5,    // 终焉血量低于 50% 进入狂暴
    FINAL_ENRAGE_CD_MUL: 0.5, // 狂暴后激光间隔 ×0.5（频率翻倍）
  },

  /* 第七阶段新增：入场位置、环形弹与出招节奏 */
  SPAWN_OFFSET_Y: 40,   // 出生点：屏幕顶边（ARENA.MARGIN_TOP）再往下 40px
  INITIAL_CD: 1.4,      // 入场后第一次出招的间隔（秒）
  RING_BASE: 8,         // 环形弹基础发数：8 + 阶段×2
  RING_PER_PHASE: 2,
  RING_SPEED: 130,      // 环形弹速度 px/s
  RING_CD_BASE: 1.5,    // 出招间隔 1.5 - (阶段-1)×0.2
  RING_CD_STEP: 0.2,
  RING_CD_MIN: 0.9,     // 出招间隔下限

  // 五个原型按 (首领序号-1) % 5 轮换；第 3 轮起各自质变
  ARCHETYPES: [
    { name: '裂隙追猎者', speed: 34, cadence: 0.88, summon: 'runner' },
    { name: '霜环裁决者', speed: 18, cadence: 0.95, summon: 'shooter' },
    { name: '熔核攻城兽', speed: 24, cadence: 0.82, summon: 'tank' },
    { name: '虚空织巢者', speed: 25, cadence: 0.90, summon: 'shooter' },
    { name: '终焉之瞳', speed: 20, cadence: 0.90, summon: 'shooter' },
  ],
  CADENCE_FLOOR: 0.28,  // 出招间隔下限
  CADENCE_STEP: 0.1,    // 每升一阶段，基础节奏 ×0.9（最低 ×0.62）
  ENRAGE_CADENCE_MUL: 0.8, // 暴怒时出招间隔 ×0.8

  /* ---------------- 模块二：五种首领的专属招式 ----------------
     五种原型按 (首领序号-1) % 5 轮换：
     1/6/11 冲锋、2/7 召唤、3/8 螺旋、4/9 追踪球、5/10 十字激光。
     环形弹仍然由 RING_* 控制，专属招式额外叠加（第 3 轮起改用质变）。 */
  SKILL: {
    // 原型 1：冲锋
    CHARGE_WARN: 0.5,        // 冲锋前红色预警线持续 0.5s
    CHARGE_SPEED: 230,       // 冲锋速度 px/s
    CHARGE_TIME: 0.35,       // 冲锋持续 0.35s
    CHARGE_CD: 4.5,          // 两次冲锋之间隔 4.5s
    CHARGE_LINE: 240,        // 预警线画多长（纯视觉）

    // 原型 2：召唤
    SUMMON_CD: 4.5,          // 每 4.5s 召唤一次
    SUMMON_COUNT: 2,         // 一次召 2 只射手

    // 原型 3：旋转螺旋
    SPIRAL_CD: 3.4,          // 每 3.4s 开始一轮螺旋
    SPIRAL_TIME: 1.6,        // 螺旋持续 1.6s
    SPIRAL_GAP: 0.11,        // 每 0.11s 发 1 颗
    SPIRAL_STEP: 0.38,       // 每颗角度旋转 0.38 弧度
    SPIRAL_SPEED: 120,       // 螺旋弹速度
    SPIRAL_LIFE: 5.5,

    // 原型 3 的防御技：力场护盾（替代旧的焦油领域）
    SHIELD_CD: 4,            // 破盾后每 4s 重新套盾
    SHIELD_RATIO: 0.2,       // 护盾血量 = 首领最大生命的 20%

    // 原型 4：慢速追踪球
    ORB_CD: 3.8,             // 每 3.8s 发一组
    ORB_COUNT: 5,            // 一次 5 颗
    ORB_SPEED: 70,           // 飞得很慢
    ORB_TURN: 1.6,           // 每秒最多转向 1.6 弧度
    ORB_LIFE: 6.5,           // 存活 6.5s
    ORB_RADIUS: 6,           // 碰撞/绘制半径
  },
};

/* ---------------- 房间与结算 ---------------- */
export const ROOM = {
  HEAL: 20,             // 清房回血
  BOSS_COUNTDOWN: 3,    // 首领房入场倒计时 3s
  REROLLS: 2,           // 整局刷新次数
  REWARD_CHOICES: 3,    // 普通房三选一
  BOSS_REWARD_CHOICES: 4, // 首领房四张卡
  SCORE_BASE: 200,      // 清房得分 200 + 25×wave
  SCORE_PER_WAVE: 25,
  NO_HIT_BONUS: 150,    // 本房没被打中，额外 +150
  PER_ROUND: 3,         // 每 3 房为一轮
  NORMAL_PER_ROUND: 2,  // 其中 2 普通 + 1 首领
  NOTICE_TIME: 1.6,     // 清房提示在屏幕中央停留的秒数
};

/* ---------------- 属性升级 ----------------
   普通房三选一里的"属性卡"，等级上限就是 maxLevel。 */
export const UPGRADE = {
  power:    { damage: 2,  maxLevel: 5 },  // 脉冲增压：打得更疼
  vitality: { maxHp: 20, heal: 20, maxLevel: 4 }, // 生命修复：上限+20并回20
  agility:  { dashRate: -0.18, minDashRate: 1.4, maxLevel: 5 }, // 相位步频：冲刺冷却更短
  engine:   { speedMul: 0.10, maxLevel: 5 }, // 超频引擎：每级移速 ×1.10，封顶 5 级

  /* 六个元素专属卡：只在本局主元素对应的卡池里出现，最高 5 级。
     这里不存效果数值——enchant.js 统一读 p.items[卡 id] 的等级计算。 */
  firePower:  { maxLevel: 5 }, // 熔核增压：火焰爆发 +10 伤害、灼烧 +1/跳
  fireRadius: { maxLevel: 5 }, // 冲击扩幅：火焰爆发半径每级 +15%
  iceFreeze:  { maxLevel: 5 }, // 绝对零度：冻结时间每级 +0.2s
  iceRadius:  { maxLevel: 5 }, // 霜环扩幅：冰爆半径每级 +15%
  darkPower:  { maxLevel: 5 }, // 衰变加剧：黑洞每跳 +2 伤害、持续 +0.2s
  darkRadius: { maxLevel: 5 }, // 事件视界：黑洞半径每级 +15%
};

/* ---------------- 屏幕边缘留白（玩家/敌人不能穿出屏幕） ---------------- */
export const ARENA = {
  MARGIN_X: 25,       // 屏幕左右各留 25px：x ∈ [25, W-25]
  MARGIN_TOP: 12,     // 从 29 改成 12，释放顶部空间
  MARGIN_BOTTOM: 25,  // 屏幕下边留 25px
};

/* ---------------- 玩家子弹 ---------------- */
export const SHOT = {
  SPEED: 270,   // 飞行速度 px/s
  LIFE: 2.2,    // 寿命（秒），到点自动消失
  RADIUS: 3,    // 碰撞半径（和敌人半径相加算命中距离）
};

/* ---------------- 武器：九件遗物的数值表（第十一阶段） ----------------
   所有遗物都有等级；数组按"等级 - 1"索引，Lv1 就是 [0]。
   槽位里的遗物等级只从 p.relicLevels 读取，没装备就不生效。 */
export const WEAPON = {
  LIFESTEAL_WINDOW: 1,      // 生命汲取的统计窗口（秒）
  LIFESTEAL_CAP: 12,        // 窗口内最多回 12 血

  /* 三向散射：Lv1 2 发 / Lv2 3 发 / Lv3 5 发 */
  TRIPLE_SHOT: [
    { count: 2, offsets: [-0.055, 0.055], muls: [0.85, 0.85] },
    { count: 3, offsets: [-0.17, 0, 0.17], muls: [0.73, 1, 0.73] },
    { count: 5, offsets: [-0.30, -0.15, 0, 0.15, 0.30], muls: [0.57, 0.57, 1, 0.57, 0.57] },
  ],

  /* 闪电链接：命中后向范围内最近的若干敌人链伤害 */
  LIGHTNING: [
    { range: 108, targets: 2, damageMul: 0.44, cd: 0.28 },
    { range: 122, targets: 3, damageMul: 0.54, cd: 0.24 },
    { range: 136, targets: 4, damageMul: 0.64, cd: 0.20 },
  ],

  /* 命中裂变：主弹命中后额外裂出小子弹，子弹出屏就消失 */
  FISSION: [
    { count: 2, spread: 0.55, damageMul: 0.34, life: 0.9 },
    { count: 3, spread: 0.55, damageMul: 0.42, life: 1.05 },
    { count: 4, spread: 0.55, damageMul: 0.50, life: 1.2 },
  ],

  /* 追踪弹：子弹每帧朝范围内最近敌人转向 */
  HOMING: [
    { range: 280, turnRate: 2.8 },
    { range: 320, turnRate: 3.4 },
    { range: 360, turnRate: 4.0 },
  ],

  /* 穿透弹芯：可命中 2/3/4 个敌人，第 2 次起伤害递减 */
  PIERCE: [
    { hits: 2, damageMul: 0.7 },
    { hits: 3, damageMul: 0.8 },
    { hits: 4, damageMul: 0.9 },
  ],

  /* 回旋镖：出程 → 返程 → 缓冲 → 追踪游离，四段状态机 */
  BOOMERANG: {
    STRAIGHT_TIME: 0.15,   // 出程直飞时间（秒）
    ARC_RATE: 0.06,        // 出程直飞后每秒弧线偏转（弧度）
    MAX_DIST: 150,         // 出程基础射程（px），实际再乘 RANGE_MUL
    RANGE_MUL: [1, 1.3, 1.6],      // Lv2 +30%、Lv3 +60%，出程和游离射程都乘它
    FREE_DIST: 320,        // 追踪游离阶段的总射程（px），同样乘 RANGE_MUL
    BUFFER_DIST: 120,      // 返程到玩家后继续直飞的缓冲距离（px）
    RETURN_DONE_RADIUS: 14,// 返程距玩家这么近就算"回到家"
    RETURN_TURN: 5,        // 返程每秒朝玩家转向（弧度）
    SPEED_MUL: [1.0, 1.15, 1.3],   // 返程速度倍率
    DAMAGE_MUL: [0.8, 1.0, 1.2],   // 返程伤害倍率
  },

  /* 元素混合：主弹额外施加副元素状态，数值按等级缩放 */
  ELEMENT_MIX: {
    DAMAGE_MUL: [0.5, 0.7, 1.0],    // L1 50%，L2 70%，L3 与主元素同伤害
    RADIUS_MUL: [0.5, 0.7, 1.0],    // L1 50%，L2 70%，L3 与主元素同半径
    DURATION_MUL: [0.5, 0.7, 1.0],  // 副状态 / 黑洞时长：L1 50%，L2 70%，L3 100%
    THRESHOLD: [16, 12, 8],          // 副附魔触发所需命中数（L1/L2/L3）
    THIRD_CHANCE: 0.3,               // L3 触发时，额外引爆第三种元素的概率
    THIRD_CD: 0.5,                   // 第三种元素爆发的内部冷却（秒）
  },

  /* 嗜血：攻速倍率随击杀数增长，冷却 = p.rate / 倍率 */
  BLOODTHIRST: {
    RATE_BASE: [1.0, 1.0, 1.0],
    RATE_PER_KILL: [0.001, 0.001, 0.001], // 每杀 +0.001 攻速（三级统一）
    RATE_CAP: [1.2, 1.5, 1.999],          // 对应 200 / 500 / 999 层
    KILL_CAP: [200, 500, 999],            // 层数上限：L3 近似无限
  },

  /* 生命汲取：每次有效命中回血量；L3 击杀另有 15% 掉血包 */
  LIFESTEAL: [
    { perHit: 0.2 },
    { perHit: 0.5 },
    { perHit: 0.5, dropChance: 0.15 },
  ],
};

/* ---------------- 血包 ----------------
   只有生命汲取 Lv3 击杀时才会掉落；走近自动拾取。 */
export const PICKUP = {
  RADIUS: 10,      // 视觉半径
  PICK_RADIUS: 19, // 拾取判定半径
  HEAL: 20,        // 回复血量
  LIFE: 15,        // 地上的存活时间（秒）
  MAX: 8,          // 同屏最多几个，防止刷爆
  DROP_CHANCE: 0.15, // 生命汲取 Lv3 击杀掉落概率
};

/* ---------------- 闪电视觉 ----------------
   闪电链只画不参与结算：折线点由 systems.triggerLightning 生成，
   canvas 每帧只管按 life 淡出。 */
export const LIGHTNING_FX = {
  LIFE: 0.1,       // 一条闪电视觉的存活秒数
  SEGMENTS: 7,     // 每段再切成几个小段（越大折线越碎）
  JITTER: 6,       // 中间点垂直方向随机抖动 ±px
  MAX_ARCS: 8,     // 同屏最多保留几条闪电
  // 闪电颜色跟着玩家当前星核走，避免三系都用同一种青色
  COLORS: {
    fire: '#ff7a5c',
    ice: '#7fd8ff',
    dark: '#c06bff',
    default: '#bff8ff',
  },
};

/* ---------------- 裂变子弹生成 ----------------
   子子弹从受击点向外错开一点出生，避免和刚打中的敌人完全重叠；
   再加一小段无敌时间，保证它先飞出去再参与碰撞。 */
export const FISSION_FX = {
  SPAWN_OFFSET: 10,   // 出生点每轴随机偏移 ±px
  SPAWN_INVULN: 0.05, // 出生后多少秒内不参与碰撞（秒）
};

/* ---------------- 敌方子弹 ---------------- */
export const HOSTILE = {
  RADIUS: 4,   // 碰撞半径（和玩家半径相加算命中）
  LIFE: 6,     // 存活秒数，到点自动消失
};

/* ---------------- 遗物定义（第十一阶段） ----------------
   普通遗物 3 级、特殊遗物 3 级；levels 数组的第 i 项就是第 i+1 级的描述。
   槽位只存 id，等级统一记在 p.relicLevels，避免两处真源。 */
export const RELIC_MAX = {
  ordinary: 3,   // 普通遗物最高 3 级
  special: 3,    // 特殊遗物最高 3 级（本轮扩展）
};

export const RELIC_DEFS = [
  {
    id: 'tripleShot', name: '三向散射', kind: 'ordinary', color: '#ffe66b',
    levels: [
      '一次发射 2 发，每发造成 85% 伤害',
      '一次发射 3 发，中间满伤、两侧 73%',
      '一次发射 5 发，中间满伤、其余 57%',
    ],
  },
  {
    id: 'lightningLink', name: '闪电链接', kind: 'ordinary', color: '#7fd8ff',
    levels: [
      '命中后向 108px 内 2 个敌人链 44% 伤害（冷却 0.28s）',
      '向 122px 内 3 个敌人链 54% 伤害（冷却 0.24s）',
      '向 136px 内 4 个敌人链 64% 伤害（冷却 0.20s）',
    ],
  },
  {
    id: 'hitFission', name: '命中裂变', kind: 'ordinary', color: '#ff9f5c',
    levels: [
      '命中后裂变出 2 枚子弹，各造成 34% 伤害',
      '裂变出 3 枚子弹，各造成 42% 伤害',
      '裂变出 4 枚子弹，各造成 50% 伤害',
    ],
  },
  {
    id: 'homing', name: '追踪弹', kind: 'ordinary', color: '#5ef2a0',
    levels: [
      '子弹自动转向 280px 内最近敌人（2.8 rad/s）',
      '转向范围 320px（3.4 rad/s）',
      '转向范围 360px（4.0 rad/s）',
    ],
  },
  {
    id: 'piercing', name: '穿透弹芯', kind: 'ordinary', color: '#c06bff',
    levels: [
      '子弹可命中 2 个敌人，后续伤害 70%',
      '子弹可命中 3 个敌人，后续伤害 80%',
      '子弹可命中 4 个敌人，后续伤害 90%',
    ],
  },
  {
    id: 'boomerangCore', name: '回旋镖', kind: 'ordinary', color: '#39f6ff',
    levels: [
      '出程 0.15s 后折返，返程伤害 80%、速度 100%',
      '返程伤害 100%、速度 115%',
      '返程伤害 120%、速度 130%',
    ],
  },
  {
    id: 'elementMix', name: '元素混合', kind: 'special', color: '#ff7ad9',
    levels: [
      '主弹额外施加副元素（50% 伤害、半径、时长），16 次命中触发',
      '副元素 70% 伤害、半径、时长，12 次命中触发',
      '副元素全数值与主元素相同（100%），8 次命中触发；30% 概率额外引爆第三种元素（0.5s CD）',
    ],
  },
  {
    id: 'bloodthirst', name: '嗜血', kind: 'special', color: '#ff5a7a',
    levels: [
      '攻速 1.0 + 击杀×0.001，最多 200 层（上限 1.2）',
      '攻速 1.0 + 击杀×0.001，最多 500 层（上限 1.5）',
      '攻速 1.0 + 击杀×0.001，最多 999 层（上限 1.999）',
    ],
  },
  {
    id: 'lifesteal', name: '生命汲取', kind: 'special', color: '#ffb84d',
    levels: [
      '每次命中回复 0.2 生命（每秒最多 12）',
      '每次命中回复 0.5 生命（每秒最多 12）',
      '每次命中回复 0.5 生命；击杀时 15% 概率掉落血包（+20 血）',
    ],
  },
];

/* ---------------- 奖励卡 ----------------
   普通房从 STAT_CARDS 三选一；首领房固定 3 普通遗物 + 1 特殊遗物；
   候选不足时用 HEAL_CARD 补齐。属性卡的等级记在 p.items 里。 */
export const REWARD = {
  STAT_CARDS: [
    { id: 'power',    name: '脉冲增压', desc: '主弹伤害 +2',              color: '#ff7a5c' },
    { id: 'vitality', name: '生命修复', desc: '生命上限 +20，并回复 20', color: '#5ef2a0' },
    { id: 'agility',  name: '相位步频', desc: '冲刺冷却 -0.18 秒',        color: '#39f6ff' },
    { id: 'engine',   name: '超频引擎', desc: '移动速度 +10%（乘算），最高 5 级', color: '#ffe66b' },
    // 元素专属卡：core 决定只在本局主元素卡池里出现
    { id: 'firePower',  core: 'fire', name: '熔核增压', desc: '火焰爆发伤害 +10，灼烧每跳 +1', color: '#ff7a5c' },
    { id: 'fireRadius', core: 'fire', name: '冲击扩幅', desc: '火焰爆发半径 +15%',              color: '#ff7a5c' },
    { id: 'iceFreeze',  core: 'ice',  name: '绝对零度', desc: '冻结持续时间 +0.2 秒',           color: '#7fd8ff' },
    { id: 'iceRadius',  core: 'ice',  name: '霜环扩幅', desc: '冰爆半径 +15%',                  color: '#7fd8ff' },
    { id: 'darkPower',  core: 'dark', name: '衰变加剧', desc: '黑洞每跳伤害 +2，持续 +0.2 秒',  color: '#c06bff' },
    { id: 'darkRadius', core: 'dark', name: '事件视界', desc: '黑洞半径 +15%',                  color: '#c06bff' },
  ],
  HEAL_CARD: { id: 'heal', name: '应急修复', desc: '回复 20 点生命', color: '#5ef2a0' },
};

/* ---------------- 元素附魔（第八阶段） ----------------
   开局三选一，本局不可更换；子弹命中积攒"阈值能量"，满 10 点触发一次元素爆发。
   火：灼烧掉血 + 火焰新星；冰：减速 + 冻结；暗：侵蚀掉血 + 黑洞。 */
export const ENCHANT = {
  CORES: [
    { id: 'fire', name: '火焰', color: '#ff7a5c', desc: '灼烧敌人，满 10 点能量引爆火焰新星' },
    { id: 'ice',  name: '冰霜', color: '#7fd8ff', desc: '减速敌人，满 10 点能量冻结周围敌人' },
    { id: 'dark', name: '暗蚀', color: '#c06bff', desc: '侵蚀敌人，满 10 点能量制造黑洞' },
  ],

  THRESHOLD: 10,            // 主附魔计数满 10 触发爆发

  FIRE: {
    DOT: 2.8,               // 每跳基础伤害
    PER_STACK: 0.7,         // 每多一层，每跳 +0.7
    TICK: 0.45,             // 每 0.45 秒跳一次
    DURATION: 3.2,          // 状态持续 3.2 秒（每次命中刷新）
    MAX_STACKS: 5,          // 最多 5 层
    BURST_RADIUS: 80,       // 火焰爆发半径
    BURST_DAMAGE: 24,       // 火焰爆发伤害
  },

  ICE: {
    SLOW: 0.26,             // 减速 26%（展示用）
    SLOW_MUL: 0.74,         // 实际速度倍率
    DURATION: 2.2,          // 冰缓持续 2.2 秒
    BURST_RADIUS: 100,      // 冰爆发半径
    FREEZE: 1.5,            // 冻结 1.5 秒
    BOSS_BREAK_DAMAGE: 12,  // 首领不冻结，改吃 12 点碎冰伤害
  },

  DARK: {
    DOT: 1.15,              // 侵蚀每跳基础伤害
    PER_STACK: 0.3,         // 每多一层，每跳 +0.3
    TICK: 0.65,             // 每 0.65 秒跳一次
    DURATION: 3.4,          // 状态持续 3.4 秒
    MAX_STACKS: 5,          // 最多 5 层
    ZONE_RADIUS: 70,        // 黑洞半径
    ZONE_LIFE: 2,           // 黑洞存活 2 秒
    ZONE_TICK: 0.4,         // 每 0.4 秒造成一次伤害
    ZONE_DAMAGE: 2.5,       // 黑洞每跳伤害
    PULL: 40,               // 每秒把敌人往中心吸 40px（首领免疫）
  },
};

/* ---------------- 伤害飘字 ---------------- */
export const TEXT = {
  TTL: 0.7,     // 存在 0.7 秒
  RISE: 30,     // 每秒向上飘 30px
  SIZE: 10,     // 字号
  MAX: 24,      // 同屏最多 24 条（超出删最旧）
};

/* ---------------- 震屏 ---------------- */
export const SHAKE = {
  BURST: 4,     // 元素爆发瞬间的震屏强度（px）
  DECAY: 18,    // 每秒衰减 18px
};

/* ---------------- 背景星空（第十一阶段） ----------------
   三层视差：越远越慢、越小；星星从上往下漂，出界后回绕到顶部。 */
export const STARFIELD = {
  LAYERS: [
    { count: 46, speed: 4,  size: 0.5, alpha: 0.35 },
    { count: 30, speed: 9,  size: 1.0, alpha: 0.55 },
    { count: 18, speed: 16, size: 1.5, alpha: 0.75 },
  ],
  TWINKLE_RATE: 2.2,   // 闪烁角速度：sin(G.time × 2.2 + 相位)
};

// 说明：附魔（火/冰/暗）与遗物的数值表，在实现对应系统的阶段再追加到这里。
