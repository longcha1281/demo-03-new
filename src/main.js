// ============================================================
// main.js —— 入口装配（把各个模块接起来）
// 它自己不实现逻辑，也不画细节，只做这几件事：
//   1) 初始化画布，直接开打
//   2) 让画布随窗口 / 全屏自动等比缩放
//   3) 绑定键盘：移动 / 冲刺 / 暂停
//   4) 暂停菜单按钮、全屏按钮
//   5) 第一次按键或点击时解锁音频
//   6) 把奖励面板接到逻辑层，启动主循环
// ============================================================

import { G } from './core/state.js';
import { CANVAS, LIMITS, ENCHANT } from './config.js';
import { initCanvas, draw, HUD_BUTTONS } from './render/canvas.js';
import { spawnEnemy } from './core/enemy.js';
import { spawnBoss } from './core/boss.js';
import {
  update,
  setKey,
  clearInput,
  restartRun,
  togglePause,
  beginRoom,
  setRewardHook,
  selectCore,
  selectSecondary,
  setRouteHook,
  setSecondaryHook as setSecondaryPanelHook,
} from './core/systems.js';
import { initAudio, setMusicPaused, resetMusic, toggleMute } from './core/audio.js';
import {
  showReward,
  hideReward,
  showCoreSelect,
  hideCoreSelect,
  setCoreHook,
  showRoute,
  hideRoute,
  showSecondarySelect,
  hideSecondarySelect,
  setSecondaryHook as setSecondaryPickHook,
} from './ui/screens.js';
import { startLoop } from './core/loop.js';

// ---- 1. 准备画布 ----
initCanvas();

// ---- 2. 重置整局 ----
// restartRun() 会重置整局状态、生成第 1 房的刷怪计划、摆好玩家。
restartRun();

// ---- 2.5 开局选星核（第八阶段） ----
// 先停在 core-select，主循环不会推进战斗；选完 selectCore 会弹初始遗物三选一
G.state = 'core-select';
setCoreHook((id) => {
  selectCore(id);   // 写入主附魔、清空计数、打开 starter 奖励面板
  hideCoreSelect(); // 收起星核选择面板
});
showCoreSelect();

// ---- 3. 画布自适应 ----
/**
 * 按窗口大小算出画布该显示多大：保持 16:9，
 * 取宽高比里更紧的那个，绝不变形。多出来的空间留黑边。
 */
function fitCanvas() {
  const c = document.getElementById('game');
  const scale = Math.min(window.innerWidth / c.width, window.innerHeight / c.height);
  c.style.width = c.width * scale + 'px';
  c.style.height = c.height * scale + 'px';
}
window.addEventListener('resize', fitCanvas);

// 浏览器按 Esc 退出全屏时，keydown 经常被浏览器自己吃掉，
// 所以不能只靠键盘事件暂停；这里监听全屏状态变化，退出后补一次暂停。
let fullscreenBeforeChange = Boolean(document.fullscreenElement);
// 用按钮 / F 键主动退出全屏时，不应该顺带切换暂停，用这个标记跳过
let skipPauseAfterFullscreenExit = false;
// 记录最近一次退出全屏的时间；防止 Esc 的 keydown 和 fullscreenchange 各暂停一次
let lastFullscreenExitAt = 0;

document.addEventListener('fullscreenchange', () => {
  fitCanvas();

  const isFullscreen = Boolean(document.fullscreenElement);
  const justExited = fullscreenBeforeChange && !isFullscreen;

  if (justExited) {
    lastFullscreenExitAt = Date.now();
    if (!skipPauseAfterFullscreenExit && !debugPanelOpen && togglePause() !== null) {
      syncPauseUI();
    }
    skipPauseAfterFullscreenExit = false;
  }

  fullscreenBeforeChange = isFullscreen;
});
fitCanvas(); // 启动时先算一次

// ---- 3.5 中键锁定 ----
// 鼠标中键点敌人：40px 内最近的活敌人成为锁定目标；再点同一只取消锁定。
// 只处理输入，不改伤害逻辑；实际瞄准优先级在 systems.updateAttack 里。
const gameCanvas = document.getElementById('game');
const LOCK_RADIUS = 40; // 鼠标点到敌人中心的容差（px）

gameCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 1) return;
  if (e.target.closest && e.target.closest('#debug-panel')) return;
  e.preventDefault(); // 阻止中键自动滚动的默认行为
  if (G.state !== 'play') return;

  const rect = gameCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  // 屏幕坐标 → 960×540 逻辑坐标（画布可能被 fitCanvas 缩放过）
  const mx = ((e.clientX - rect.left) / rect.width) * CANVAS.WIDTH;
  const my = ((e.clientY - rect.top) / rect.height) * CANVAS.HEIGHT;

  let hit = null;
  let best = LOCK_RADIUS;
  for (const enemy of G.enemies) {
    if (enemy.hp <= 0) continue; // 尸体不参与锁定
    const d = Math.hypot(enemy.x - mx, enemy.y - my);
    if (d < best) {
      best = d;
      hit = enemy;
    }
  }

  if (!hit) {
    G.p.attackTarget = null;
    return;
  }

  // 再点一次同一只 = 取消锁定
  G.p.attackTarget = G.p.attackTarget === hit.id ? null : hit.id;
});

// 中键在部分浏览器还会触发 auxclick（自动滚动 / 打开新标签），一并拦掉
gameCanvas.addEventListener('auxclick', (e) => {
  if (e.button === 1) e.preventDefault();
});

// ---- 3.6 鼠标瞄准 / 手动射击（第十一阶段） ----
// mousemove 只记录逻辑坐标；左键按下才开火（autoAttack 关时由 systems 决定）
gameCanvas.addEventListener('mousemove', (e) => {
  if (e.target.closest && e.target.closest('#debug-panel')) return;
  const rect = gameCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  G.p.aimX = ((e.clientX - rect.left) / rect.width) * CANVAS.WIDTH;
  G.p.aimY = ((e.clientY - rect.top) / rect.height) * CANVAS.HEIGHT;
});

/** 判断逻辑坐标是否落在某个 HUD 按钮的矩形里。 */
function pointInHudButton(mx, my, rect) {
  return (
    mx >= rect.x &&
    mx <= rect.x + rect.w &&
    my >= rect.y &&
    my <= rect.y + rect.h
  );
}

/**
 * 主动退出全屏（按钮 / F 键）：不触发“退出全屏后暂停”的补偿逻辑。
 * 标记在 fullscreenchange 回调里消费一次；如果退出失败则立刻清掉。
 */
function exitFullscreenWithoutPause() {
  skipPauseAfterFullscreenExit = true;
  document.exitFullscreen().catch(() => {
    skipPauseAfterFullscreenExit = false;
  });
}

/** 切换全屏：Canvas 的全屏按钮和键盘 F 共用这一段。 */
function toggleFullscreen() {
  if (document.fullscreenElement) {
    exitFullscreenWithoutPause();
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

gameCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  // 调试台永远不触发开火；即使以后把面板放进画布容器也安全
  if (e.target.closest && e.target.closest('#debug-panel')) return;
  e.preventDefault();

  // 先换算成 960×540 的逻辑坐标，才能和 HUD 按钮的绘制坐标对上
  const rect = gameCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const mx = ((e.clientX - rect.left) / rect.width) * CANVAS.WIDTH;
  const my = ((e.clientY - rect.top) / rect.height) * CANVAS.HEIGHT;

  // 点中「自动攻击」：只切开关，不开火
  if (pointInHudButton(mx, my, HUD_BUTTONS.auto)) {
    G.autoAttack = !G.autoAttack;
    return;
  }

  // 点中「全屏」：只切全屏，不开火
  if (pointInHudButton(mx, my, HUD_BUTTONS.fullscreen)) {
    toggleFullscreen();
    return;
  }

  // 点空地才是射击；只有游戏进行中才按下开火键
  if (G.state !== 'play') return;
  G.mouseDown = true;
});

// 松开可能发生在画布外，所以监听 window；切窗口也要松开
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) G.mouseDown = false;
});

// ---- 4. 拿 DOM ----
const pauseMenu = document.getElementById('pause-menu');
const btnResume = document.getElementById('btn-resume');
const btnExitFs = document.getElementById('btn-exit-fs');
const btnRestart = document.getElementById('btn-restart');

// F2 调试台打开时，暂停遮罩暂时让位；关闭后按原暂停状态恢复。
let debugPanelOpen = false;

// 音乐只跟随战斗状态；奖励、装配、死亡和暂停均保留播放位置。
let lastMusicState;
function syncMusicState() {
  if (lastMusicState === G.state) return;
  lastMusicState = G.state;
  setMusicPaused(G.state !== 'play');
}

/** 同步暂停遮罩和音乐，不改变游戏逻辑。 */
function syncPauseUI() {
  const paused = G.state === 'paused';
  pauseMenu.classList.toggle('hidden', !paused || debugPanelOpen);
  syncMusicState();
}

// 开局先同步一次（HTML 里默认就是 hidden，这里保证状态一致）
syncPauseUI();

// ---- 4.5 F2 法术调试台 ----
// 这是一个开发工具，只改玩家槽位，不碰战斗逻辑。
// 左侧 3 个普通槽支持拖拽互换；中间点击或拖入；右侧特殊遗物直接进 3 号槽。
const DEBUG_RELIC_NAMES = {
  tripleShot: '三向散射',
  lightningLink: '闪电链接',
  hitFission: '命中裂变',
  homing: '追踪',
  piercing: '穿透',
  boomerangCore: '回旋',
  bloodthirst: '嗜血',
  lifesteal: '生命汲取',
  elementMix: '元素混合',
};

// 调试台按钮从这两张表生成，名称统一查上面的 DEBUG_RELIC_NAMES，避免 HTML 和 JS 各写一份。
const DEBUG_ORDINARY_RELICS = [
  'tripleShot', 'lightningLink', 'hitFission',
  'homing', 'piercing', 'boomerangCore',
];
const DEBUG_SPECIAL_RELICS = ['bloodthirst', 'lifesteal', 'elementMix'];

// 沙盒“刷一波怪”的固定配方：8 追猎 + 4 射手 + 4 自爆蛛 + 4 分裂体 = 20 只
const DEBUG_SANDBOX_MIX = [
  'chaser', 'chaser', 'shooter', 'chaser', 'bomber',
  'splitter', 'chaser', 'chaser', 'shooter', 'bomber',
  'chaser', 'splitter', 'chaser', 'shooter', 'bomber',
  'chaser', 'splitter', 'chaser', 'shooter', 'bomber',
];

const debugPanel = document.getElementById('debug-panel');
const debugSlotsEl = document.getElementById('debug-slots');
const debugLibrary = document.getElementById('debug-library');
const debugSpecials = document.getElementById('debug-specials');
const debugClear = document.getElementById('debug-clear');
const debugSandbox = document.getElementById('debug-sandbox');
const debugSpawn = document.getElementById('debug-spawn');
const debugBoss = document.getElementById('debug-boss');
const debugClearEnemies = document.getElementById('debug-clear-enemies');
const debugAdvanced = document.getElementById('debug-advanced');

// 调试台“刷 Boss”从第 1 只开始轮换，方便按顺序测五种形态
let debugBossNumber = 1;

// 进阶考核：按 R4→R5→R6→R7 轮换，直接跳进对应 Boss 战。
const DEBUG_ADVANCED_STAGES = [
  { label: 'R4', wave: 47, bossEncounter: 15 },
  { label: 'R5', wave: 57, bossEncounter: 20 },
  { label: 'R6', wave: 67, bossEncounter: 25 },
  { label: 'R7', wave: 76, bossEncounter: 30 },
];
let debugAdvancedIndex = 0;

const DEBUG_MAX_LEVEL = 3; // 调试台允许把任意遗物调到 3 级
let debugDragPayload = null;

/** 读取调试台显示的等级：没记过就按 1 级，防止出现 0 级或 NaN。 */
function debugRelicLevel(id) {
  const value = Number(G.p.relicLevels[id]);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(DEBUG_MAX_LEVEL, Math.floor(value)));
}

/** 给调试台加遗物时补上等级和收藏记录，避免装配室 / 奖励池读到空等级。 */
function ensureDebugRelic(id) {
  G.p.relicLevels[id] = debugRelicLevel(id);
  if (!G.p.relicCollection.includes(id)) G.p.relicCollection.push(id);
}

/** 调等级：只改 G.p.relicLevels，不动槽位，所以和拖拽装备互不冲突。 */
function adjustDebugLevel(id, delta) {
  ensureDebugRelic(id);
  const next = Math.max(
    1,
    Math.min(DEBUG_MAX_LEVEL, debugRelicLevel(id) + delta)
  );
  G.p.relicLevels[id] = next;
  renderDebugAll();
}

/**
 * 生成一个可拖拽的遗物条目：名字 + 实时等级 + 右侧两个极小加减按钮。
 * slotIndex 有值时表示它正放在某个普通槽里。
 */
function makeDebugItem(id, slotIndex) {
  const item = document.createElement('div');
  item.className = 'dbg-item';
  item.draggable = true;
  item.dataset.debugRelic = id;
  if (slotIndex !== undefined) item.dataset.slot = String(slotIndex);

  const name = document.createElement('span');
  name.className = 'dbg-name';
  name.textContent = `${DEBUG_RELIC_NAMES[id] || id} (Lv.${debugRelicLevel(id)})`;

  const steppers = document.createElement('span');
  steppers.className = 'dbg-steppers';

  for (const [text, step] of [['+', 1], ['-', -1]]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dbg-step';
    btn.draggable = false;
    btn.dataset.levelStep = String(step);
    btn.textContent = text;
    btn.title = step > 0 ? '提升 1 级' : '降低 1 级';
    btn.setAttribute(
      'aria-label',
      `${step > 0 ? '提升' : '降低'}${DEBUG_RELIC_NAMES[id] || id}等级`
    );
    steppers.appendChild(btn);
  }

  item.append(name, steppers);
  return item;
}

/** 把遗物放进指定普通槽；槽里原有的遗物先挪到别的空槽，避免直接消失。 */
function placeDebugRelic(id, targetSlot) {
  const slots = G.p.relicSlots;
  const from = slots.indexOf(id);

  // 同一件遗物已经在别的普通槽里：直接交换两格，避免重复装备
  if (from >= 0 && from < 3 && from !== targetSlot) {
    slots[from] = slots[targetSlot];
  } else if (slots[targetSlot] && slots[targetSlot] !== id) {
    const empty = [0, 1, 2].find((i) => i !== targetSlot && !slots[i]);
    if (empty !== undefined) slots[empty] = slots[targetSlot];
  }

  slots[targetSlot] = id;
  ensureDebugRelic(id);
}

/** 点击备选库：放进第一个空槽；没有空槽就替换槽 1。 */
function equipDebugRelic(id) {
  const slots = G.p.relicSlots;
  if (slots.indexOf(id) >= 0 && slots.indexOf(id) < 3) return;

  let target = [0, 1, 2].find((i) => !slots[i]);
  if (target === undefined) target = 0;
  placeDebugRelic(id, target);
  renderDebugAll();
}

/** 特殊遗物固定进 3 号槽。 */
function equipDebugSpecial(id) {
  G.p.relicSlots[3] = id;
  ensureDebugRelic(id);

  // 调试台没有正常的选副元素流程，直接随机补一个与主元素不同的副元素，
  // 这样在 F2 里点“元素混合”就能立刻看到双环 / 双 Debuff。
  if (id === 'elementMix' && !G.p.enchantState.secondaryUnlocked) {
    const options = ENCHANT.CORES.filter((core) => core.id !== G.p.core);
    const picked = options[Math.floor(Math.random() * options.length)];
    if (picked) {
      G.p.enchantState.secondaryId = picked.id;
      G.p.enchantState.secondaryUnlocked = true;
      G.p.enchantState.secondaryUnlockSource = 'debug';
      G.pendingSecondarySelection = false;
    }
  }

  renderDebugAll();
}

/** 拖拽数据同时存内存和 dataTransfer，兼容不同浏览器。 */
function readDebugPayload(e) {
  if (debugDragPayload) return debugDragPayload;
  try {
    const raw = e.dataTransfer.getData('text/plain');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 从备选库或槽位开始拖拽；只允许拖整条遗物，不允许从 +/- 按钮上拖。 */
function beginDebugDrag(e, source) {
  const item = e.target.closest('.dbg-item');
  if (!item) return;

  // 如果点的是加减号按钮，直接退出，不触发拖拽
  if (e.target.closest('.dbg-step')) return;

  const id = item.dataset.debugRelic;
  const payload = { source, id };
  if (source === 'slot') payload.slot = Number(item.dataset.slot);

  debugDragPayload = payload;

  // 关键：使用 'all' 允许一切操作，避免和 dropEffect 冲突
  e.dataTransfer.effectAllowed = 'all';
  e.dataTransfer.setData('text/plain', JSON.stringify(payload));
  item.classList.add('dragging');
}

/** 拖拽结束：清掉高亮和缓存，下一次拖拽不会读到旧数据。 */
function finishDebugDrag(e) {
  const item = e.target.closest('.dbg-item');
  if (item) item.classList.remove('dragging');
  debugDragPayload = null;
}

/** 判断点击的是不是 +/- 按钮；是就只调等级，不触发装备。 */
function handleDebugItemClick(e, source) {
  const stepBtn = e.target.closest('[data-level-step]');
  if (stepBtn) {
    const item = stepBtn.closest('.dbg-item');
    if (item) {
      adjustDebugLevel(item.dataset.debugRelic, Number(stepBtn.dataset.levelStep));
    }
    return;
  }

  const item = e.target.closest('.dbg-item');
  if (!item) return;
  if (source === 'library') equipDebugRelic(item.dataset.debugRelic);
  if (source === 'special') equipDebugSpecial(item.dataset.debugRelic);
}

/** 重新画 3 个普通槽位；拖拽放入、互换和调等级后都会刷新。 */
function renderDebugSlots() {
  debugSlotsEl.textContent = '';

  for (let i = 0; i < 3; i++) {
    const slot = document.createElement('div');
    slot.className = 'debug-slot';
    slot.dataset.slot = String(i);

    const head = document.createElement('div');
    head.className = 'debug-slot-head';
    head.textContent = `槽 ${i + 1} · 第 ${i + 1} 发`;
    slot.appendChild(head);

    const id = G.p.relicSlots[i];
    slot.classList.toggle('empty', !id);
    if (!id) {
      const empty = document.createElement('div');
      empty.className = 'debug-empty';
      empty.textContent = '拖到这里';
      slot.appendChild(empty);
    } else {
      slot.appendChild(makeDebugItem(id, i));
    }

    slot.addEventListener('dragover', (e) => {
      e.preventDefault(); // 必须保留，表示允许放下
      // 不设置 dropEffect，让浏览器根据 effectAllowed 自动匹配
      slot.classList.add('over');
    });
    slot.addEventListener('dragleave', (e) => {
      // 只有真正离开整个槽位才取消高亮，经过子元素时不闪
      if (!slot.contains(e.relatedTarget)) slot.classList.remove('over');
    });
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('over');

      const payload = readDebugPayload(e);
      debugDragPayload = null;
      if (!payload) return;

      if (payload.source === 'library') {
        // 从备选库拖进来：占住这个槽，原有遗物尽量挪到空槽
        placeDebugRelic(payload.id, i);
      } else if (payload.source === 'slot') {
        // 槽位之间拖拽：直接交换两格的内容，顺序立即写回 G.p.relicSlots
        const from = payload.slot;
        if (from === i || from < 0 || from > 2) return;
        if (G.p.relicSlots[from] !== payload.id) return;
        const slots = G.p.relicSlots;
        const tmp = slots[i];
        slots[i] = slots[from];
        slots[from] = tmp;
      }

      renderDebugAll();
    });

    debugSlotsEl.appendChild(slot);
  }
}

/** 重画备选库；名称右侧实时显示等级和 +/-。 */
function renderDebugLibrary() {
  debugLibrary.textContent = '';
  for (const id of DEBUG_ORDINARY_RELICS) {
    debugLibrary.appendChild(makeDebugItem(id));
  }
}

/** 重画特殊遗物列。 */
function renderDebugSpecials() {
  debugSpecials.textContent = '';
  for (const id of DEBUG_SPECIAL_RELICS) {
    debugSpecials.appendChild(makeDebugItem(id));
  }
}

/** 三块一起刷新，等级改动后名字和槽位都保持同步。 */
function renderDebugAll() {
  renderDebugLibrary();
  renderDebugSpecials();
  renderDebugSlots();
}

/** 刷新沙盒按钮：开启后文字变成“沙盒运行中”，并保持绿色高亮。 */
function syncDebugSandbox() {
  debugSandbox.textContent = G.isSandbox ? '沙盒运行中' : '开启沙盒';
  debugSandbox.classList.toggle('on', G.isSandbox);
  debugSandbox.setAttribute('aria-pressed', G.isSandbox ? 'true' : 'false');
}

/** 沙盒刷怪：在屏幕四边随机生成固定配方的 20 只混合怪，受同屏硬上限保护。 */
function spawnDebugWave() {
  for (let i = 0; i < DEBUG_SANDBOX_MIX.length; i++) {
    if (G.enemies.length >= LIMITS.enemies) break;
    spawnEnemy(DEBUG_SANDBOX_MIX[i]);
  }
}

/** 沙盒清怪：怪、敌弹、首领危险区和残影一起清掉，方便下一轮重新摆场。 */
function clearDebugEnemies() {
  G.enemies.length = 0;
  G.hostile.length = 0;
  G.bossHazards.length = 0;
  G.bossGhosts.length = 0;
  G.p.attackTarget = null;
  G.shake = 0;
}

/** 打开 / 关闭调试台。打开时若正在战斗就自动暂停，关闭时恢复。 */
function toggleDebugPanel(force) {
  const isHidden = debugPanel.classList.contains('hidden');
  const shouldShow = typeof force === 'boolean' ? force : isHidden;
  if (shouldShow === !isHidden) return;

  if (shouldShow) {
    debugPanelOpen = true;
    debugPanel.classList.remove('hidden');
    // 调试面板是最高层；暂停遮罩只保留状态，不再画出来挡面板。
    pauseMenu.classList.add('debug-suspended');
    G.mouseDown = false;
    clearInput();

    renderDebugAll();
    syncDebugSandbox();
  } else {
    debugPanel.classList.add('hidden');
    debugPanelOpen = false;
    pauseMenu.classList.remove('debug-suspended');
    debugDragPayload = null;
  }
}

// 备选库：拖拽装备；点击条目装备；点 +/- 只调等级。
debugLibrary.addEventListener('click', (e) => handleDebugItemClick(e, 'library'));
debugLibrary.addEventListener('dragstart', (e) => beginDebugDrag(e, 'library'));
debugLibrary.addEventListener('dragend', finishDebugDrag);

// 从槽位拖回备选库：清空对应槽位，遗物仍留在收藏里，可再次拖出。
debugLibrary.addEventListener('dragover', (e) => {
  e.preventDefault(); // 允许放下
});
debugLibrary.addEventListener('drop', (e) => {
  e.preventDefault();
  const payload = readDebugPayload(e);
  debugDragPayload = null;
  if (!payload || payload.source !== 'slot') return;

  const from = payload.slot;
  if (from < 0 || from > 2) return;
  if (G.p.relicSlots[from] !== payload.id) return;

  G.p.relicSlots[from] = null;
  renderDebugAll();
});

// 槽位内部：拖拽互换；点 +/- 调等级。
debugSlotsEl.addEventListener('click', (e) => handleDebugItemClick(e, 'slot'));
debugSlotsEl.addEventListener('dragstart', (e) => beginDebugDrag(e, 'slot'));
debugSlotsEl.addEventListener('dragend', finishDebugDrag);

// 特殊遗物：点击装备到 3 号槽；+/- 调等级。
debugSpecials.addEventListener('click', (e) => handleDebugItemClick(e, 'special'));
debugSpecials.addEventListener('dragend', finishDebugDrag);

// 清空遗物：槽位、等级、收藏和副元素一起归零，方便从空构筑重新测。
debugClear.addEventListener('click', () => {
  G.p.relicSlots.fill(null);
  G.p.relicLevels = {};
  G.p.relicCollection.length = 0;
  G.p.enchantState.secondaryId = null;
  G.p.enchantState.secondaryUnlocked = false;
  G.p.enchantState.secondaryUnlockSource = null;
  G.p.attackTarget = null;
  debugDragPayload = null;
  renderDebugAll();
});

// 沙盒开关：只改一个布尔值，真正的拦截在 finishRoom 和 hurtPlayer 里。
debugSandbox.addEventListener('click', () => {
  G.isSandbox = !G.isSandbox;
  syncDebugSandbox();
});

// 刷一波混合怪：只在战斗/暂停时生效，生成位置由 spawnEnemy 自己选屏幕边缘。
debugSpawn.addEventListener('click', () => {
  if (G.state !== 'play' && G.state !== 'paused') return;
  spawnDebugWave();
});

// 刷 Boss：清掉当前怪和弹幕后，按 1→5 轮换生成五种基础形态，方便逐个试手感
debugBoss.addEventListener('click', () => {
  if (G.state !== 'play' && G.state !== 'paused') return;

  G.enemies.length = 0;
  G.hostile.length = 0;
  G.bossHazards.length = 0;
  G.bossGhosts.length = 0;
  spawnBoss(debugBossNumber);
  debugBossNumber = (debugBossNumber % 5) + 1;
});

// 清怪：同时清掉敌弹和首领危险区，避免清完还被残留弹幕打到。
debugClearEnemies.addEventListener('click', clearDebugEnemies);

// 进阶考核：按任务卡设 wave / bossEncounter，beginRoom 会给 Boss 房再 +1。
debugAdvanced.addEventListener('click', () => {
  if (G.state !== 'play' && G.state !== 'paused') return;

  const stage = DEBUG_ADVANCED_STAGES[debugAdvancedIndex];
  debugAdvancedIndex = (debugAdvancedIndex + 1) % DEBUG_ADVANCED_STAGES.length;

  G.endless = true;
  G.isSandbox = false;
  G.wave = stage.wave;
  G.bossEncounter = stage.bossEncounter;
  G.state = 'play';
  beginRoom(stage.wave);
  debugAdvanced.textContent = '进阶考核 ' + stage.label;
  syncDebugSandbox();
});

// 页面启动时先把隐藏面板的内容画好；F2 打开时直接显示。
renderDebugAll();
syncDebugSandbox();

// ---- 5. 奖励面板接线 ----
// systems.js 是纯逻辑不能碰 DOM：把"显示面板"这个函数注进去，
// 以后 openReward() 一调用，这里就会弹出卡片。
setRewardHook(showReward);

// ---- 5.5 遗物装配室接线 ----
// 选完奖励卡后 systems 进入 route 状态并调 routeHook；这里负责把拖拽面板弹出来。
// 玩家点「继续深入」才由 screens 调 confirmRoute() 开下一房。
setRouteHook(showRoute);

// ---- 5.6 副元素选择接线 ----
// systems 在第一次拿到「元素混合」时弹出面板；玩家点选后写回副元素，再进装配室。
setSecondaryPanelHook(showSecondarySelect);
setSecondaryPickHook((id) => {
  // 只有真的写入成功才收面板；失败时留在面板上，避免卡在 secondary-select
  if (selectSecondary(id)) hideSecondarySelect();
});

// ---- 6. 键盘 ----
window.addEventListener('keydown', (e) => {
  // M：随时静音 / 取消静音，状态由 audio.js 写进 localStorage，刷新后保留。
  // 放在最前面，静音键不传给移动 / 冲刺 / 全屏逻辑。
  if (e.code === 'KeyM' && !e.repeat) {
    toggleMute();
    return;
  }

  // F2：法术调试台。打开时自动暂停，关闭时如果原本是调试台暂停的，就恢复游戏。
  if (e.code === 'F2' && !e.repeat) {
    e.preventDefault();
    toggleDebugPanel();
    return;
  }

  // F：切换全屏（和 Canvas 上的全屏按钮一样）；按住不放只处理第一次
  if (e.code === 'KeyF' && !e.repeat) {
    toggleFullscreen();
    return; // 全屏键不传给移动/冲刺
  }

  // Esc：在全屏里先退出全屏，由 fullscreenchange 补暂停；
  // 不在全屏时直接切换暂停（按住不放只处理第一次）。
  if (e.code === 'Escape' && !e.repeat) {
    // 调试台打开时 Esc 只负责退出全屏，不在这里把游戏放回运行（面板还开着）
    if (debugPanelOpen) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      return;
    }

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // 极少数浏览器取消失败时没有 fullscreenchange，兜底暂停一次
        if (togglePause() !== null) syncPauseUI();
      });
      return;
    }

    // 刚由 Esc 退出全屏时，fullscreenchange 已经暂停过了，这里不要再切回去
    if (Date.now() - lastFullscreenExitAt < 250) return;

    if (togglePause() !== null) {
      syncPauseUI();
      return; // 暂停键不往下传给移动逻辑
    }
  }

  // 空格和方向键默认会让页面滚动，先阻止
  if (
    e.code === 'Space' ||
    e.code === 'ArrowUp' ||
    e.code === 'ArrowDown' ||
    e.code === 'ArrowLeft' ||
    e.code === 'ArrowRight'
  ) {
    e.preventDefault();
  }
  // 胜利结算按 R：重开一局并回到星核选择（本作没有独立标题页，星核选择即标题）。
  // E 进入无尽交给 setKey 处理，不在这里拦截。
  if (G.state === 'victory' && e.code === 'KeyR' && !e.repeat) {
    restartRun();
    G.state = 'core-select';
    showCoreSelect();
    resetMusic();
    syncPauseUI();
    return;
  }

  if (e.code === 'KeyR' && G.state === 'dead') resetMusic();
  setKey(e.code, true);

});

// 松开：把对应的按键状态清掉
window.addEventListener('keyup', (e) => {
  setKey(e.code, false);
});

// 切换窗口（失去焦点）：松开所有键 / 鼠标，防止回来时角色一直往一个方向走
window.addEventListener('blur', () => {
  clearInput();
  G.mouseDown = false;
});

// ---- 7. 暂停菜单按钮 ----
btnResume.addEventListener('click', () => {
  if (G.state === 'paused') {
    togglePause();
    syncPauseUI();
  }
});

btnExitFs.addEventListener('click', () => {
  // 只有确实在全屏时才退出；暂停菜单里的退出按钮不额外切换暂停
  if (document.fullscreenElement) {
    exitFullscreenWithoutPause();
  }
});

btnRestart.addEventListener('click', () => {
  restartRun();
  hideReward();          // 奖励面板如果还开着，一并收起
  hideCoreSelect();      // 星核面板同理（重开保留已选核心，不再弹）
  hideRoute();           // 装配室也收起
  resetMusic();         // 新一局从乐曲开头开始
  syncPauseUI();
});

// ---- 9. 音频解锁 ----
// 在真实手势内解锁；复用上下文，也允许浏览器意外挂起后再次尝试恢复
window.addEventListener('keydown', initAudio);
window.addEventListener('pointerdown', initAudio);

// ---- 10. 启动主循环 ----
startLoop(update, () => {
  syncMusicState(); // 仅状态变化时启停，不在每帧重复操作音源。
  draw();
});
