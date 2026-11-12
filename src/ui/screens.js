// ============================================================
// screens.js —— DOM 界面：战斗之外的"屏幕"（升级 / 遗物 / 选星核）
// 只负责显示和点击；选卡后的数值变化全部交给 core/systems.js
// ============================================================

import {
  pickReward,
  moveRelic,
  confirmRoute,
} from '../core/systems.js';
import { ENCHANT, RELIC_DEFS, RELIC_MAX } from '../config.js';
import { G } from '../core/state.js';

// 面板四角科技角标的方向后缀（实际样式在 index.html 的 .panel-corner 里）
const PANEL_CORNER_CLASSES = ['tl', 'tr', 'bl', 'br'];

/** 给面板补一组四角角标；只在面板首次缓存时调用一次，避免重复叠加。 */
function decoratePanelCorners(panelEl) {
  for (const name of PANEL_CORNER_CLASSES) {
    const corner = document.createElement('span');
    corner.className = `panel-corner ${name}`;
    panelEl.append(corner);
  }
}

// 先缓存 DOM 引用。第一次用到时才取（保证 index.html 已经解析完），
// 之后每次显示都复用，不重复 getElementById。
let panel = null;
let titleEl = null;
let subEl = null;
let cardsEl = null;

/** 第一次调用时把奖励面板的节点抓下来并缓存。 */
function cacheDom() {
  if (panel) return;
  panel = document.getElementById('reward-panel');
  titleEl = document.getElementById('reward-title');
  subEl = document.getElementById('reward-sub');
  cardsEl = document.getElementById('reward-cards');
  decoratePanelCorners(panel);
}

/**
 * 往描述里追加文字：数字（含小数 / 百分数）单独包进 .num 高亮。
 * 只用 createTextNode + span，不拼 innerHTML，避免注入风险。
 */
function appendDesc(el, text) {
  const parts = String(text).split(/(\d+(?:\.\d+)?%?)/);

  for (const part of parts) {
    if (!part) continue;

    if (/^\d/.test(part)) {
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = part;
      el.append(num);
    } else {
      // 测试里的假 DOM 没有 createTextNode，退化成 innerText 节点
      if (typeof document.createTextNode === 'function') {
        el.append(document.createTextNode(part));
      } else {
        const span = document.createElement('span');
        span.textContent = part;
        el.append(span);
      }
    }
  }
}

// 还没单独画 CSS 图标的遗物，先借一个最接近的几何图形，别让卡面空着。
// 后面的 UI 精修阶段再给它们画专属图标。
const ICON_FALLBACK = {
  engine: 'rapidFire',
  firePower: 'fire',
  fireRadius: 'fire',
  iceFreeze: 'ice',
  iceRadius: 'ice',
  darkPower: 'dark',
  darkRadius: 'dark',
};

/**
 * 造一张卡：按钮 + 图标舞台 + 类型标签 + 名称 + 描述。
 * @param {object} card 卡牌数据（id/name/desc/color）
 * @param {string} tag 胶囊标签文字
 * @param {string} icon 图标 id（对应 CSS 的 .geo-<id>）
 * @param {'stat'|'relic'|'core'} kind 决定卡的大类样式
 */
function makeCard(card, tag, icon, kind) {
  // 用 <button> 当卡片：天然可聚焦、可点击、键盘也能操作
  const btn = document.createElement('button');
  btn.type = 'button';
  // 遗物卡与星核卡用大卡样式；属性卡用三选一样式
  btn.className =
    kind === 'relic' || kind === 'core' || kind === 'starter'
      ? 'core-card'
      : 'reward-card';
  // 每张卡自己的强调色，由 CSS 的 var(--accent) 使用
  btn.style.setProperty('--accent', card.color);

  // 上半区：纯 CSS 几何图标
  const art = document.createElement('div');
  art.className = 'pick-art';
  const geo = document.createElement('span');
  geo.className = `geo geo-${ICON_FALLBACK[icon] || icon}`;
  art.append(geo);

  // 类型标签
  const tagEl = document.createElement('span');
  tagEl.className = 'pick-tag';
  tagEl.textContent = tag;

  // 名称与描述
  const name = document.createElement('h3');
  name.className = 'pick-name';
  name.textContent = card.name;

  const desc = document.createElement('p');
  desc.className = 'pick-desc';
  appendDesc(desc, card.desc);

  btn.append(art, tagEl, name, desc);

  // 遗物卡额外标出等级（新获得 Lv1 / 升级后 Lv2…）
  if (card.maxLevel) {
    const levelEl = document.createElement('p');
    levelEl.className = 'pick-level';
    levelEl.textContent = card.isUpgrade
      ? '升级 · 等级 ' + card.level + ' / ' + card.maxLevel
      : '新遗物 · 等级 1 / ' + card.maxLevel;
    btn.append(levelEl);
  }

  return btn;
}

/**
 * 显示奖励面板。
 * @param {Array<{id:string,name:string,desc:string,color:string}>} cards
 * @param {'stat'|'relic'} kind 普通房属性三选一 / 首领房遗物四选一
 */
export function showReward(cards, kind) {
  cacheDom();

  // 标题区分三种面板（首领字符串沿用旧版，测试可能断言）
  if (kind === 'relic') {
    titleEl.textContent = '首领遗物 · 四选一';
  } else if (kind === 'starter') {
    titleEl.textContent = '初始遗物 · 三选一';
  } else {
    titleEl.textContent = '核心强化 · 三选一';
  }

  // 副标题给玩家一句"现在在选什么"
  if (subEl) {
    if (kind === 'relic') {
      subEl.textContent = '选择一件遗物，改造你的弹道';
    } else if (kind === 'starter') {
      subEl.textContent = '选择一件遗物，开始本局';
    } else {
      subEl.textContent = '选择一项强化，继续深入';
    }
  }

  // 清空上一次的卡（replaceChildren 不拼接 HTML 字符串，安全又简单）
  cardsEl.replaceChildren();

  cards.forEach((card, index) => {
    // 标签：补给 / 初始遗物 / 首领普通或特殊遗物 / 属性强化
    let tag;
    if (card.id === 'heal') {
      tag = '应急补给';
    } else if (kind === 'starter') {
      tag = '初始遗物';
    } else if (kind === 'relic') {
      tag = card.kind === 'special' ? '特殊遗物' : '普通遗物';
    } else {
      tag = '属性强化';
    }

    const btn = makeCard(card, tag, card.id, kind);

    // 点击 = 选这张卡：先收起面板，再让逻辑层应用并进入下一房
    btn.addEventListener('click', () => {
      hideReward();
      pickReward(index);
    });

    cardsEl.append(btn);
  });

  panel.classList.remove('hidden');
}

/** 收起奖励面板并清空卡片。 */
export function hideReward() {
  cacheDom();
  panel.classList.add('hidden');
  cardsEl.replaceChildren();
}

/* ---------------- 开局选择星核（第八阶段） ---------------- */

// 星核面板的 DOM 缓存
let corePanel = null;
let coreCardsEl = null;

// 选核心的回调：systems 是纯逻辑，由 main.js 把 selectCore 注进来
let coreHook = null;

/** 注册"选完核心"的回调（main.js 传入 selectCore + 收面板）。 */
export function setCoreHook(fn) {
  coreHook = fn;
}

/** 第一次调用时把星核面板节点抓下来并缓存。 */
function cacheCoreDom() {
  if (corePanel) return;
  corePanel = document.getElementById('core-panel');
  coreCardsEl = document.getElementById('core-cards');
  decoratePanelCorners(corePanel);
}

/**
 * 显示星核三选一面板：按 config.ENCHANT.CORES 生成三张卡。
 * 点击某张卡只负责调 hook，具体"写入核心 + 进第 1 房"由 main.js 安排。
 */
export function showCoreSelect() {
  cacheCoreDom();
  coreCardsEl.replaceChildren();

  ENCHANT.CORES.forEach((core) => {
    const btn = makeCard(core, '主附魔', core.id, 'core');

    btn.addEventListener('click', () => {
      if (coreHook) coreHook(core.id);
    });

    coreCardsEl.append(btn);
  });

  corePanel.classList.remove('hidden');
}

/** 收起星核面板并清空卡片。 */
export function hideCoreSelect() {
  cacheCoreDom();
  corePanel.classList.add('hidden');
  coreCardsEl.replaceChildren();
}

/* ---------------- 选择副元素（第十阶段） ---------------- */

let secondaryPanel = null;
let secondaryCardsEl = null;
let secondaryHook = null;

/** 注册"选完副元素"的回调（main.js 传入 systems.selectSecondary）。 */
export function setSecondaryHook(fn) {
  secondaryHook = fn;
}

/** 第一次调用时抓住副元素面板节点。 */
function cacheSecondaryDom() {
  if (secondaryPanel) return;
  secondaryPanel = document.getElementById('secondary-panel');
  secondaryCardsEl = document.getElementById('secondary-cards');
  decoratePanelCorners(secondaryPanel);
}

/**
 * 显示「选择副元素」面板：只列与主元素不同的另外两个核心。
 * 点击后由 main.js 调 selectSecondary，面板随即收起。
 * @param {'fire'|'ice'|'dark'} mainCore 当前主附魔 id
 */
export function showSecondarySelect(mainCore) {
  cacheSecondaryDom();
  secondaryCardsEl.replaceChildren();

  ENCHANT.CORES.filter((core) => core.id !== mainCore).forEach((core) => {
    const card = {
      id: core.id,
      name: core.name,
      color: core.color,
      desc: core.desc,
    };
    const btn = makeCard(card, '副附魔', core.id, 'core');

    btn.addEventListener('click', () => {
      if (secondaryHook) secondaryHook(core.id);
    });

    secondaryCardsEl.append(btn);
  });

  secondaryPanel.classList.remove('hidden');
}

/** 收起副元素面板并清空卡片。 */
export function hideSecondarySelect() {
  cacheSecondaryDom();
  secondaryPanel.classList.add('hidden');
  secondaryCardsEl.replaceChildren();
}

/* ---------------- 遗物装配室（第十一阶段） ---------------- */

// 4 个槽的标题：0/1/2 普通，3 特殊
const SLOT_NAMES = ['普通 I', '普通 II', '普通 III', '特殊'];

let routePanel = null;
let routeSlotsEl = null;
let routeBackupEl = null;
let routeContinueBtn = null;
let routeBound = false;
let routeBackupBound = false;

/** 第一次调用时抓住装配室节点，并只绑定一次"继续深入"按钮。 */
function cacheRouteDom() {
  if (routePanel) return;
  routePanel = document.getElementById('route-panel');
  routeSlotsEl = document.getElementById('route-slots');
  routeBackupEl = document.getElementById('route-backup');
  routeContinueBtn = document.getElementById('route-continue');
}

/* 装配室遗物图标：内联 SVG 线条，30px 下比 .geo 位图式形状更清晰 */
const routeIcon = (body) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  body +
  '</svg>';

const ROUTE_ICON_SVG = {
  // 三发扇形弹
  tripleShot: routeIcon(
    '<path d="M12 21V5"/><path d="m9.5 7.5 2.5-2.5 2.5 2.5"/>' +
      '<path d="M7 21 4 7"/><path d="m2.5 9 1.5-2.5 2.5 1"/>' +
      '<path d="M17 21l3-14"/><path d="m19 9 2.5-1 1 2.5"/>'
  ),
  // 闪电
  lightningLink: routeIcon('<path d="M13 2 5 14h6l-1 8 8-12h-6l1-8Z"/>'),
  // 命中裂变：中心 + 四散碎片
  hitFission: routeIcon(
    '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19"/>'
  ),
  // 追踪：准星
  homing: routeIcon(
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>' +
      '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'
  ),
  // 穿透：箭矢穿过挡板
  piercing: routeIcon(
    '<path d="M4 12h15"/><path d="m15 7 5 5-5 5"/><path d="M8 3v18"/>'
  ),
  // 回旋：弯折的飞镖轨迹
  boomerangCore: routeIcon(
    '<path d="M3 4c5 7 10 11 18 13"/><path d="m17 18 4-1-1-4"/>' +
      '<path d="M7 7c4 4 7 7 11 9"/>'
  ),
  // 元素混合：三圆交叠
  elementMix: routeIcon(
    '<circle cx="9" cy="9" r="5"/><circle cx="15" cy="9" r="5"/><circle cx="12" cy="15" r="5"/>'
  ),
  // 嗜血：血滴
  bloodthirst: routeIcon(
    '<path d="M12 3c4 5 6 7.5 6 10.5a6 6 0 0 1-12 0C6 10.5 8 8 12 3Z"/>'
  ),
  // 生命汲取：心形
  lifesteal: routeIcon(
    '<path d="M12 20S4 15 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 6-8 11-8 11Z"/>'
  ),
};

const ROUTE_ICON_FALLBACK = routeIcon(
  '<circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/>'
);

/** 造一张可拖拽的小卡（装配室用，不是奖励面板的大卡）。 */
function makeRouteCard(id) {
  const def = RELIC_DEFS.find((item) => item.id === id);
  const level = G.p.relicLevels[id] || 1;
  if (!def) return null;

  const el = document.createElement('div');
  el.className = 'route-relic';
  el.draggable = true;
  el.style.setProperty('--accent', def.color);

  // 内联 SVG 线条图标：按遗物 id 区分，未知 id 用十字圆兜底
  const icon = document.createElement('span');
  icon.className = 'route-geo';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ROUTE_ICON_SVG[id] || ROUTE_ICON_FALLBACK;

  // 右侧名称 + 等级竖排
  const body = document.createElement('div');
  body.className = 'route-body';

  const name = document.createElement('strong');
  name.textContent = def.name;

  const lv = document.createElement('span');
  lv.textContent = 'Lv' + level + ' / ' + RELIC_MAX[def.kind];

  body.append(name, lv);
  el.append(icon, body);

  // 拖拽开始：把遗物 id 写进 dataTransfer，drop 时再读出来
  el.addEventListener('dragstart', (e) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  });

  return el;
}

/** 按 G.p 的槽位 / 收藏 / 等级重画整个装配室。 */
function renderRoute() {
  const p = G.p;

  routeSlotsEl.replaceChildren();
  for (let i = 0; i < 4; i++) {
    const slot = document.createElement('div');
    slot.className = 'route-slot';
    slot.dataset.slot = String(i);

    const head = document.createElement('div');
    head.className = 'route-slot-head';
    head.textContent = SLOT_NAMES[i];
    slot.append(head);

    const id = p.relicSlots[i];
    if (id) {
      const card = makeRouteCard(id);
      if (card) slot.append(card);
    } else {
      const empty = document.createElement('div');
      empty.className = 'route-empty';
      empty.textContent = '空槽';
      slot.append(empty);
    }

    // 拖到槽位上：高亮 + 松手时调用 moveRelic（类型不匹配会返回 false）
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      slot.classList.add('over');
    });
    slot.addEventListener('dragleave', () => {
      slot.classList.remove('over');
    });
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('over');
      const dropped = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      if (dropped) moveRelic(dropped, i);
      renderRoute();
    });

    routeSlotsEl.append(slot);
  }

  // 备选库：收藏过、但当前不在 4 个槽里的遗物
  routeBackupEl.replaceChildren();
  const backupIds = p.relicCollection.filter(
    (id) => !p.relicSlots.includes(id)
  );

  if (backupIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'route-empty';
    empty.textContent = '暂无备选遗物';
    routeBackupEl.append(empty);
  } else {
    for (const id of backupIds) {
      const card = makeRouteCard(id);
      if (card) routeBackupEl.append(card);
    }
  }
}

/** 显示遗物装配室：route 状态下玩家可拖拽换装。 */
export function showRoute() {
  cacheRouteDom();
  bindRouteContinue();
  bindRouteBackup();
  renderRoute();
  routePanel.classList.remove('hidden');
}

/** 收起装配室。 */
export function hideRoute() {
  cacheRouteDom();
  routePanel.classList.add('hidden');
}

/**
 * 备选库接住从槽位拖出来的遗物：清空那个槽，但遗物仍留在本局收藏里。
 * 只绑一次，避免每次 renderRoute 重复堆事件。
 */
function bindRouteBackup() {
  if (!routeBackupEl || routeBackupBound) return;
  routeBackupBound = true;

  routeBackupEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    routeBackupEl.classList.add('over');
  });
  routeBackupEl.addEventListener('dragleave', (e) => {
    // 指针还在备选库内部移动时不要闪掉高亮
    if (!routeBackupEl.contains(e.relatedTarget)) {
      routeBackupEl.classList.remove('over');
    }
  });
  routeBackupEl.addEventListener('drop', (e) => {
    e.preventDefault();
    routeBackupEl.classList.remove('over');
    const dropped = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
    if (!dropped) return;
    const idx = G.p.relicSlots.indexOf(dropped);
    if (idx === -1) return; // 本来就是备选库里的，不用处理
    G.p.relicSlots[idx] = null;
    renderRoute();
  });
}

// 「继续深入」只绑一次：应用装配结果并开下一房
function bindRouteContinue() {
  cacheRouteDom();
  if (!routeContinueBtn || routeBound) return;
  routeBound = true;
  routeContinueBtn.addEventListener('click', () => {
    hideRoute();
    confirmRoute();
  });
}
