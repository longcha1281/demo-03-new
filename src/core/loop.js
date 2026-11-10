// ============================================================
// loop.js —— 主循环（requestAnimationFrame 的壳子）
// 只干一件事：每帧算 dt、按状态决定要不要跑逻辑、最后一定画一帧。
// 具体逻辑在 systems.js，具体画面在 render/canvas.js。
// ============================================================

import { G } from './state.js';

// 只在这两个状态下推进游戏逻辑。
// play  = 正常战斗
// salvage = 清房/结算界面（第五阶段才真正用到，先留好）
const RUNNING_STATES = ['play', 'salvage'];

/**
 * 启动主循环。
 * @param {(dt: number) => void} update 逻辑更新函数（systems.js 的 update）
 * @param {() => void} draw           画面绘制函数（render/canvas.js 的 draw）
 */
export function startLoop(update, draw) {
  // 先取一次当前时间，保证第一帧的 dt 不会是一个巨大的数
  let last = performance.now();

  // 每一帧要做的事
  function frame(now) {
    // dt = 这一帧过去了多少秒。
    // 封顶 0.04s（40ms）：切到后台再切回来时，一帧不会跳太远，
    // 否则玩家会瞬间穿过敌人。
    const dt = Math.min((now - last) / 1000, 0.04);
    last = now;

    // 只有在跑游戏的状态下才推进逻辑；其余状态（标题/升级/死亡……）
    // 只画画面，不更新世界。
    if (RUNNING_STATES.includes(G.state)) {
      update(dt);
    }

    // 不管什么状态，每帧都要画
    draw();

    // 预约下一帧，形成循环
    requestAnimationFrame(frame);
  }

  // 启动循环（第一帧从这里开始）
  requestAnimationFrame(frame);
}
