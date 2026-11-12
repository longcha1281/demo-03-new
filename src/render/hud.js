// ============================================================
// hud.js —— 画面绘制的「hud」部分
// 从 canvas.js 原样拆出；只读 G，不改任何游戏数据。
// ============================================================

import {
  CANVAS,
  COLORS,
  BOSS,
  ENEMY,
  TEXT,
  ENCHANT,
  RELIC_DEFS,
  STARFIELD,
  WEAPON,
  LIGHTNING_FX,
  PICKUP,
  CAMPAIGN,
} from '../config.js';
import { G } from '../core/state.js';
import { campaignRound, isR7Wave, tierForRoom } from '../core/boss.js';
import { getCtx } from './context.js';



// 遗物 HUD 的短名：4 个槽位里的遗物用汉字标出来
const RELIC_SHORT = {
  tripleShot: '散',
  lightningLink: '链',
  hitFission: '裂',
  homing: '追',
  piercing: '穿',
  boomerangCore: '旋',
  elementMix: '混',
  bloodthirst: '嗜',
  lifesteal: '汲',
};

// HUD 统一视觉常量：颜色、间距、边框缺口都由这里控制
const HUD_STYLE = {
  background: 'rgba(5,12,20,0.38)',
  border: '#345362',
  primary: '#D5E1E8',
  secondary: '#728897',
  accent: '#54D7E8',
  boss: '#9876B4',
  gap: 8,
  cut: 8,
  lineWidth: 1,
};

// 第 2 轮首领词缀的短标签，显示在血条名称右侧
const AFFIX_LABEL = { shield: '护盾', rage: '暴怒', teleport: '瞬移' };

// 右上角两个 Canvas 按钮的点击范围（逻辑坐标）。
// main.js 用同一份数据做命中判定，避免画的位置和点的位置对不上。
export const HUD_BUTTONS = {
  // 两个按钮都右对齐到 950，跟上面数据行同一个右边线，不再横跨半个屏幕
  auto: { x: 784, y: 24, w: 106, h: 14 },
  fullscreen: { x: 896, y: 24, w: 54, h: 14 },
};

/**
 * 沿"左上 / 右下斜切"的矩形描一条闭合路径。
 * 修改为卡牌切角，修复了右上角的断线缺口。
 */
export function traceCardRect(x, y, w, h, cut) {
  const ctx = getCtx();
  ctx.beginPath();
  ctx.moveTo(x + cut, y);         // 左上切角起点
  ctx.lineTo(x + w, y);           // 右上直角
  ctx.lineTo(x + w, y + h - cut); // 右下切角起点
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x, y + h);           // 左下直角
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

export function drawHud() {
  const ctx = getCtx();
  const p = G.p;
  const font = '"Consolas", "Courier New", monospace';

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowBlur = 0;

  // ======================================
  // 1. 左上：一行 HP 文字 + 贴边细血条
  // ======================================

  const hpX = 10;
  const hpY = 15;
  const hpH = 4;
  const hpBarX = 48;

  // 一格固定 8px 宽、间距固定 2px：上限越高，格子越多，血条整体向右变长
  const hpCellW = 8;
  const hpCellGap = 2;

  // 一格 = 10 点血：120 上限 12 格，200 上限 20 格
  const maxCells = Math.max(1, Math.ceil(p.max / 10));
  const hpBarLen =
    maxCells * hpCellW + (maxCells - 1) * hpCellGap;

  // 当前血量占几格也按向上取整算，1 点血也会亮一格
  const filledCells = Math.max(
    0,
    Math.min(maxCells, Math.ceil(p.hp / 10))
  );

  // HP 文字放在血条左侧，和分段条同一水平线
  ctx.font = `10px ${font}`;
  ctx.fillStyle = HUD_STYLE.primary;
  ctx.fillText(
    `HP ${Math.ceil(p.hp)}`,
    hpX,
    hpY
  );

  // 固定宽度的小段：上限越高格子越多，整条血条向右变长
  for (let i = 0; i < maxCells; i++) {
    const sx = hpBarX + i * (hpCellW + hpCellGap);

    ctx.beginPath();
    ctx.moveTo(sx + 2, hpY - hpH / 2);
    ctx.lineTo(sx + hpCellW, hpY - hpH / 2);
    ctx.lineTo(sx + hpCellW - 2, hpY + hpH / 2);
    ctx.lineTo(sx, hpY + hpH / 2);
    ctx.closePath();

    if (i < filledCells) {
      ctx.save();
      ctx.shadowColor = '#39f6ff';
      ctx.shadowBlur = 5;
      ctx.fillStyle = '#39f6ff';
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(57,246,255,0.16)';
      ctx.fill();
    }
  }

  // 嗜血层数：只在装备时出现，写在分段血条右侧
  if (p.relicSlots.includes('bloodthirst')) {
    const level = p.relicLevels.bloodthirst || 1;
    const cfg = WEAPON.BLOODTHIRST;

    // 层数上限直接读 KILL_CAP，别用“倍率差 ÷ 每杀”反算，避免浮点显示 199/499
    const cap = cfg.KILL_CAP[level - 1];

    const stacks = Math.min(
      p.bloodthirstKills,
      cap
    );

    ctx.font = `8px ${font}`;
    ctx.fillStyle = '#A9764E';
    ctx.fillText(
      `嗜血×${stacks}`,
      hpBarX + hpBarLen + 6,
      hpY + 2
    );
  }

  // ======================================
  // 2. 右上：单行纯文字数据，不要面板
  // ======================================

  const roomLabel = G.endless
    ? (isR7Wave(G.wave)
      ? '房 ' + String(G.wave).padStart(2, '0') +
        ' · 绝对死亡 · 存活 ' + Math.floor(G.r7Time) + ' 秒'
      : '房 ' + String(G.wave).padStart(2, '0') +
        ' · 轮 ' + tierForRoom(G.wave, G.bossEncounter))
    : '房 ' + String(G.wave).padStart(2, '0') + '/' + CAMPAIGN.TOTAL_ROOMS +
      ' · 轮 ' + campaignRound(G.wave);

  const stats = [
    { text: roomLabel, color: '#8ff8ff' },
    {
      text: ' | ',
      color: 'rgba(111,135,148,0.55)'
    },
    { text: '击杀 ', color: HUD_STYLE.secondary },
    {
      text: String(G.kills),
      color: '#8ff8ff'
    },
    {
      text: ' | ',
      color: 'rgba(111,135,148,0.55)'
    },
    { text: '分数 ', color: HUD_STYLE.secondary },
    {
      text: String(G.score),
      color: '#8ff8ff'
    }
  ];

  ctx.font = `10px ${font}`;
  ctx.textAlign = 'left';

  let statsWidth = 0;

  for (let i = 0; i < stats.length; i++) {
    statsWidth += hudTextWidth(stats[i].text);
  }

  let statsX = 950 - statsWidth;

  for (let i = 0; i < stats.length; i++) {
    ctx.fillStyle = stats[i].color;
    ctx.fillText(stats[i].text, statsX, 14);
    statsX += hudTextWidth(stats[i].text);
  }

  // ======================================
  // 3. 右上：纯文字按钮，没有矩形框
  // 紧贴数据行下方、右对齐到数据行右边界；宽度按实际文字算，
  // 写回 HUD_BUTTONS，保证 main.js 的命中区和画出来的文字重合
  // ======================================

  const autoLabel = `[ 自动：${G.autoAttack ? '开' : '关'} ]`;
  const fsLabel = '[ 全屏 ]';

  ctx.font =
    '10px "Consolas", "Courier New", monospace';
  const autoW = hudTextWidth(autoLabel);
  const fsW = hudTextWidth(fsLabel);

  HUD_BUTTONS.fullscreen = {
    x: 950 - fsW,
    y: 20,
    w: fsW,
    h: 14,
  };
  HUD_BUTTONS.auto = {
    x: HUD_BUTTONS.fullscreen.x - 10 - autoW,
    y: 20,
    w: autoW,
    h: 14,
  };

  drawHudTextButton(
    HUD_BUTTONS.auto,
    autoLabel,
    G.autoAttack
  );

  drawHudTextButton(
    HUD_BUTTONS.fullscreen,
    fsLabel,
    true
  );

  // ======================================
  // 4. 左下：四个极简遗物槽 + 图标
  // ======================================

  const slotSize = 14;
  const slotGap = 6;
  const slotY = CANVAS.HEIGHT - 35;
  let hoveredRelic = null;

  for (let slot = 0; slot < 4; slot++) {
    const sx = 10 + slot * (slotSize + slotGap);
    const id = p.relicSlots[slot];

    const def = id
      ? RELIC_DEFS.find(item => item.id === id)
      : null;

    // 空槽只留一条极暗的边，不画底色
    ctx.strokeStyle = def
      ? def.color
      : 'rgba(66,97,107,0.30)';

    ctx.lineWidth = 1;

    ctx.strokeRect(
      sx + 0.5,
      slotY + 0.5,
      slotSize - 1,
      slotSize - 1
    );

    if (def) {
      drawRelicIcon(
        ctx,
        id,
        sx + slotSize / 2,
        slotY + slotSize / 2,
        def.color
      );

      // 等级用槽下 1px 小点表示，不占图标空间
      const level = Math.max(
        1,
        Math.min(3, p.relicLevels[id] || 1)
      );

      ctx.fillStyle = def.color;

      for (let dot = 0; dot < level; dot++) {
        ctx.fillRect(
          sx + 2 + dot * 3,
          slotY + slotSize + 2,
          2,
          1
        );
      }

      // 鼠标落在槽位的 14×14 矩形里，就记下来，循环结束后画提示框
      if (
        G.state === 'play' &&
        p.aimX >= sx &&
        p.aimX <= sx + slotSize &&
        p.aimY >= slotY &&
        p.aimY <= slotY + slotSize
      ) {
        hoveredRelic = { def, level, sx };
      }
    }
  }

  // 悬停提示：画在遗物槽上方，靠近边缘时自动夹回屏幕内
  if (hoveredRelic) {
    drawRelicTooltip(
      hoveredRelic.sx,
      slotY - 56,
      hoveredRelic.def,
      hoveredRelic.level
    );
  }

  // ======================================
  // 5. 左下：一行操作提示，贴屏幕边缘
  // ======================================

  ctx.font = `9px ${font}`;
  ctx.fillStyle = HUD_STYLE.secondary;
  ctx.textAlign = 'left';

  ctx.fillText(
    'WASD 移动 | SPACE 冲刺',
    10,
    CANVAS.HEIGHT - 10
  );

  ctx.restore();
}

/**
 * 遗物悬停提示框：160×48，半透明黑底 + 遗物色细边。
 * 名称/等级一行，效果说明最多两行；整框会被夹在屏幕内。
 */
export function drawRelicTooltip(x, y, def, level) {
  const ctx = getCtx();
  const w = 160;
  const h = 48;
  const font = '"Consolas", "Courier New", monospace';

  // 先夹住左上角，保证提示框不越出 960×540 的逻辑屏幕
  const tx = Math.max(8, Math.min(CANVAS.WIDTH - w - 8, x));
  const ty = Math.max(8, Math.min(CANVAS.HEIGHT - h - 8, y));

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowBlur = 0;

  // 半透明黑底 + 1px 遗物色边框
  ctx.fillStyle = 'rgba(3,8,14,0.94)';
  ctx.fillRect(tx, ty, w, h);

  ctx.strokeStyle = def.color;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1;
  ctx.strokeRect(tx + 0.5, ty + 0.5, w - 1, h - 1);
  ctx.globalAlpha = 1;

  // 第一行：名称 + 等级
  ctx.font = `11px ${font}`;
  ctx.fillStyle = def.color;
  ctx.fillText(
    `${def.name} Lv.${level}`,
    tx + 8,
    ty + 7,
    w - 16
  );

  // 第二、三行：当前等级的效果说明，按宽度自动折行
  ctx.font = `9px ${font}`;
  ctx.fillStyle = '#b8c8d4';

  const description =
    (def.levels && def.levels[level - 1]) || '';

  const lines = wrapTooltipText(
    description,
    w - 16,
    2
  );

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(
      lines[i],
      tx + 8,
      ty + 23 + i * 11,
      w - 16
    );
  }

  ctx.restore();
}

/**
 * 把说明文字按像素宽度折成最多 maxLines 行；放不下时最后一行加省略号。
 */
export function wrapTooltipText(text, maxWidth, maxLines) {
  const lines = [];
  let current = '';

  for (const ch of text) {
    const next = current + ch;

    if (hudTextWidth(next) > maxWidth && current) {
      lines.push(current);
      current = ch;

      if (lines.length === maxLines) {
        lines[maxLines - 1] += '…';
        return lines;
      }
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

/**
 * 量一段 HUD 文字大概有多宽。
 * 浏览器里用 measureText；测试桩没有这个方法时按字符估算。
 */
export function hudTextWidth(text) {
  const ctx = getCtx();
  if (typeof ctx.measureText === 'function') {
    try {
      const metrics = ctx.measureText(text);

      if (
        metrics &&
        typeof metrics.width === 'number' &&
        isFinite(metrics.width)
      ) {
        return metrics.width;
      }
    } catch (error) {
      // 测试桩可能没有实现 measureText，忽略并走估算
    }
  }

  let width = 0;

  for (const ch of text) {
    // 中文按 11px 估算，英文/数字按 6.6px 估算
    width += ch.charCodeAt(0) > 255 ? 11 : 6.6;
  }

  return width;
}

/**
 * 画一个纯文字按钮：没有框，只有文字本身和颜色状态。
 */
export function drawHudTextButton(rect, label, active) {
  const ctx = getCtx();
  ctx.save();
  ctx.font =
    '10px "Consolas", "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = active
    ? '#8ff8ff'
    : '#6f8794';

  ctx.fillText(
    label,
    rect.x + rect.w,
    rect.y + rect.h / 2
  );

  ctx.restore();
}

/**
 * 用 1px 几何线画遗物图标。
 * 坐标以格子中心为原点，整体控制在 10×10 内。
 */
export function drawRelicIcon(ctx, id, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 3;

  ctx.beginPath();

  if (id === 'tripleShot') {
    // 三向散射：三条向外发散的线
    ctx.moveTo(-2, 4);
    ctx.lineTo(-4, -4);
    ctx.moveTo(0, 4);
    ctx.lineTo(0, -5);
    ctx.moveTo(2, 4);
    ctx.lineTo(4, -4);
  } else if (id === 'lightningLink') {
    // 闪电：一个 Z 字
    ctx.moveTo(-4, -4);
    ctx.lineTo(2, -4);
    ctx.lineTo(-2, 0);
    ctx.lineTo(4, 0);
  } else if (id === 'hitFission') {
    // 命中裂变：中心点 + 四条斜向碎片
    ctx.arc(0, 0, 1.2, 0, Math.PI * 2);
    ctx.moveTo(2, 2);
    ctx.lineTo(4, 4);
    ctx.moveTo(-2, 2);
    ctx.lineTo(-4, 4);
    ctx.moveTo(2, -2);
    ctx.lineTo(4, -4);
    ctx.moveTo(-2, -2);
    ctx.lineTo(-4, -4);
  } else if (id === 'homing') {
    // 追踪：一条弯钩 + 箭头
    ctx.moveTo(-4, 4);
    ctx.quadraticCurveTo(1, -7, 4, -1);
    ctx.moveTo(4, -1);
    ctx.lineTo(1, -2);
    ctx.moveTo(4, -1);
    ctx.lineTo(3, 1.6);
  } else if (id === 'piercing') {
    // 穿透：一支贯穿的箭
    ctx.moveTo(-4, 4);
    ctx.lineTo(4, -4);
    ctx.moveTo(4, -4);
    ctx.lineTo(1, -4);
    ctx.moveTo(4, -4);
    ctx.lineTo(4, -1);
  } else if (id === 'boomerangCore') {
    // 回旋：一个 U 形轨迹 + 箭头
    ctx.moveTo(-4, -4);
    ctx.bezierCurveTo(-7, 3, -2, 6, 0, 6);
    ctx.bezierCurveTo(2, 6, 7, 3, 4, -4);
    ctx.moveTo(4, -4);
    ctx.lineTo(1, -3);
    ctx.moveTo(4, -4);
    ctx.lineTo(3, -1);
  } else if (id === 'elementMix') {
    // 元素混合：两个相交的小圆
    ctx.arc(-1.8, 0, 3, 0, Math.PI * 2);
    ctx.moveTo(4.8, 0);
    ctx.arc(1.8, 0, 3, 0, Math.PI * 2);
  } else if (id === 'bloodthirst') {
    // 嗜血：一滴水
    ctx.moveTo(0, -5);
    ctx.bezierCurveTo(4, -1, 4, 3, 0, 5);
    ctx.bezierCurveTo(-4, 3, -4, -1, 0, -5);
  } else if (id === 'lifesteal') {
    // 汲取：一个十字
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.moveTo(-4, 0);
    ctx.lineTo(4, 0);
  } else {
    // 未知遗物：小菱形兜底
    ctx.moveTo(0, -4);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 4);
    ctx.lineTo(-4, 0);
    ctx.closePath();
  }

  ctx.stroke();
  ctx.restore();
}

export function drawHudPanel(x, y, w, h, isBoss = false) {
  const ctx = getCtx();
  ctx.save();
  ctx.shadowBlur = 0;

  // 面板底色：完整矩形，保证内容区不透明
  ctx.fillStyle = HUD_STYLE.background;
  ctx.fillRect(x, y, w, h);

  // 边框：标准直角；只在右下角留 8px 缺口
  ctx.strokeStyle = isBoss
    ? HUD_STYLE.boss
    : HUD_STYLE.border;

  ctx.lineWidth = HUD_STYLE.lineWidth;

  ctx.beginPath();

  // 顶边
  ctx.moveTo(x + 0.5, y + 0.5);
  ctx.lineTo(x + w - 0.5, y + 0.5);

  // 右边，到缺口上沿停住
  ctx.lineTo(
    x + w - 0.5,
    y + h - HUD_STYLE.cut + 0.5
  );

  // 缺口下沿开始画底边
  ctx.moveTo(
    x + w - HUD_STYLE.cut + 0.5,
    y + h - 0.5
  );

  // 底边
  ctx.lineTo(x + 0.5, y + h - 0.5);

  // 左边
  ctx.lineTo(x + 0.5, y + 0.5);

  ctx.stroke();
  ctx.restore();
}

export function drawBossBar() {
  const ctx = getCtx();
  const bosses = G.enemies.filter(
    e => e.type === 'boss' && e.hp > 0 && !e.dead
  );

  if (bosses.length === 0) return;

  // 单 Boss 保持原位置；双 Boss 上下两条，各自带形态/词缀/终极标签。
  if (bosses.length === 1) {
    drawOneBossBar(ctx, bosses[0], 340, 8, 280, 40);
    return;
  }
  // 双血条下移，避开右上角房间/存活数据行。
  drawOneBossBar(ctx, bosses[0], 340, 52, 280, 36);
  drawOneBossBar(ctx, bosses[1], 340, 94, 280, 36);
}

/** 画一条 Boss 血条；双 Boss 时用更矮的面板上下排列。 */
function drawOneBossBar(ctx, boss, x, y, w, h) {
  const big = h >= 40;
  const nameY = y + (big ? 15 : 12);

  drawHudPanel(x, y, w, h, true);

  ctx.save();
  ctx.shadowBlur = 0;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // BOSS 名称
  ctx.font =
    '12px "Consolas", "Courier New", monospace';

  ctx.fillStyle = HUD_STYLE.primary;

  ctx.fillText(
    String(boss.archetype || ''),
    x + 10,
    nameY,
    w - 20
  );

  // 词缀和终极可能同时存在（R4/R6/R7），两个标签都要给玩家看。
  const tags = [];
  if (boss.affix) {
    tags.push(`词缀 · ${AFFIX_LABEL[boss.affix] || boss.affix}`);
  }
  if (boss.ultimate !== null && boss.ultimate !== undefined) {
    tags.push(`终极 · ${String(boss.archetype || '')}`);
  }
  const tag = tags.join(' · ');
  if (tag) {
    ctx.textAlign = 'right';
    ctx.font = '10px "Consolas", "Courier New", monospace';
    ctx.fillStyle = boss.affix === 'shield' ? COLORS.ice
      : boss.affix === 'rage' ? COLORS.fire
      : boss.affix === 'teleport' ? '#c39bff'
      : HUD_STYLE.accent;
    ctx.fillText(tag, x + w - 10, nameY);
  }

  // 12 格紫灰色分段血条
  const barX = x + 10;
  const barY = y + (big ? 26 : 23);
  const barW = w - 20;
  const barH = big ? 6 : 5;

  const ratio = Math.max(
    0,
    Math.min(
      1,
      boss.hp / Math.max(1, boss.max)
    )
  );

  // 血条分段：每只 Boss 可以配置段数（熔核巨像用 20 段表现“装甲很厚”）
  const count = Math.max(1, boss.segments || 12);
  const gap = 1.5;

  const segW =
    (barW - gap * (count - 1)) / count;

  for (let i = 0; i < count; i++) {
    const sx = barX + i * (segW + gap);

    const fill = Math.max(
      0,
      Math.min(1, ratio * count - i)
    );

    // 空血槽
    ctx.fillStyle = '#241A31';
    ctx.fillRect(sx, barY, segW, barH);

    // 当前血量
    if (fill > 0) {
      ctx.fillStyle = HUD_STYLE.boss;
      ctx.fillRect(sx, barY, segW * fill, barH);
    }
  }

  ctx.restore();
}

/** 房间提示：进房 / 清房时在屏幕中央短暂显示的文字（只读 G.notice）。 */
export function drawNotice() {
  const ctx = getCtx();
  const notice = G.notice;

  // timer 归零就不画
  if (notice.timer <= 0) return;

  // 最后 0.5 秒淡出，不要"啪"地消失
  const alpha = Math.min(1, notice.timer / 0.5);

  ctx.save();
  ctx.globalAlpha = alpha;

  // 主文字：居中、加粗，放在屏幕上方 30% 的位置
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillText(notice.text, CANVAS.WIDTH / 2, CANVAS.HEIGHT * 0.3);

  // 副文字：主文字下面 22px，小一号、暗一点
  ctx.fillStyle = COLORS.textDim;
  ctx.font = '11px "Courier New", monospace';
  ctx.fillText(notice.sub, CANVAS.WIDTH / 2, CANVAS.HEIGHT * 0.3 + 22);

  ctx.restore();
}

/** 死亡遮罩：半透明黑幕 + 标题 + 重开提示 + 本局分数。 */
export function drawDeadOverlay() {
  const ctx = getCtx();
  // 黑幕：盖住游戏画面，但还能隐约看到战场
  ctx.fillStyle = 'rgba(4, 6, 11, 0.72)';
  ctx.fillRect(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT);

  // 所有文字居中
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 主标题
  ctx.fillStyle = COLORS.hp;
  ctx.font = 'bold 28px "Courier New", monospace';
  ctx.fillText('你被打倒了', CANVAS.WIDTH / 2, CANVAS.HEIGHT / 2 - 22);

  // 重开提示
  ctx.fillStyle = COLORS.text;
  ctx.font = '12px "Courier New", monospace';
  ctx.fillText('按 R 重开', CANVAS.WIDTH / 2, CANVAS.HEIGHT / 2 + 14);

  // 本局分数
  ctx.fillStyle = COLORS.textDim;
  ctx.font = '11px "Courier New", monospace';
  ctx.fillText(`本局分数 ${G.score}`, CANVAS.WIDTH / 2, CANVAS.HEIGHT / 2 + 36);
}

/** 胜利遮罩：黑幕 + 战役完成 + 分数/最高分/击败数 + 再战/无尽提示。 */
export function drawVictoryOverlay() {
  const ctx = getCtx();
  const cx = CANVAS.WIDTH / 2;
  const cy = CANVAS.HEIGHT / 2;

  // 黑幕：盖住战场，但保留一点背景层次
  ctx.fillStyle = 'rgba(4, 6, 11, 0.80)';
  ctx.fillRect(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 主标题
  ctx.fillStyle = HUD_STYLE.accent;
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.fillText('战役完成', cx, cy - 62);

  // 本局分数与最高分
  ctx.fillStyle = COLORS.text;
  ctx.font = '14px "Courier New", monospace';
  ctx.fillText(`本局分数 ${G.score}`, cx, cy - 16);

  ctx.font = '12px "Courier New", monospace';
  ctx.fillText(`最高分 ${G.bestScore}`, cx, cy + 8);

  // 房数与首领击败数
  ctx.fillStyle = COLORS.textDim;
  ctx.font = '11px "Courier New", monospace';
  ctx.fillText(
    `房数 ${CAMPAIGN.TOTAL_ROOMS} · 击败首领 ${G.bossesCleared}`,
    cx,
    cy + 30
  );

  // 操作提示
  ctx.fillStyle = COLORS.text;
  ctx.font = '12px "Courier New", monospace';
  ctx.fillText('R 再战 / E 无尽', cx, cy + 58);
}
