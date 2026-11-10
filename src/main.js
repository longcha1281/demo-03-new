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
import { CANVAS } from './config.js';
import { initCanvas, draw, HUD_BUTTONS } from './render/canvas.js';
import {
  update,
  setKey,
  clearInput,
  restartRun,
  togglePause,
  setRewardHook,
  selectCore,
  selectSecondary,
  setRouteHook,
  setSecondaryHook as setSecondaryPanelHook,
} from './core/systems.js';
import { initAudio, setMusicPaused, toggleMute } from './core/audio.js';
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
    if (!skipPauseAfterFullscreenExit && togglePause() !== null) {
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

/** 让暂停遮罩跟着游戏状态显示 / 隐藏（只有 paused 才显示），同时暂停/恢复 BGM。 */
function syncPauseUI() {
  const paused = G.state === 'paused';
  pauseMenu.classList.toggle('hidden', !paused);
  setMusicPaused(paused);
}

// 开局先同步一次（HTML 里默认就是 hidden，这里保证状态一致）
syncPauseUI();

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

  // F：切换全屏（和 Canvas 上的全屏按钮一样）；按住不放只处理第一次
  if (e.code === 'KeyF' && !e.repeat) {
    toggleFullscreen();
    return; // 全屏键不传给移动/冲刺
  }

  // Esc：在全屏里先退出全屏，由 fullscreenchange 补暂停；
  // 不在全屏时直接切换暂停（按住不放只处理第一次）。
  if (e.code === 'Escape' && !e.repeat) {
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
  setMusicPaused(false); // 重开后回到 play，音乐也跟着恢复
  syncPauseUI();
});

// ---- 9. 音频解锁 ----
// 浏览器不允许在没有用户手势时创建/播放音频，第一次按键或点击时初始化一次
window.addEventListener('keydown', initAudio, { once: true });
window.addEventListener('pointerdown', initAudio, { once: true });

// ---- 10. 启动主循环 ----
startLoop(update, draw);
