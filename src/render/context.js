// ============================================================
// context.js —— 保存唯一的 2D 上下文，供各绘制模块取用。
// canvas.js 在 initCanvas() 里调用 setContext()，其他模块用 getCtx()。
// ============================================================

let ctx = null;

/** 保存画布上下文。 */
export function setContext(value) {
  ctx = value;
}

/** 取画布上下文；initCanvas() 之前调用会得到 null。 */
export function getCtx() {
  return ctx;
}
