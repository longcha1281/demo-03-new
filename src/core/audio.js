// ============================================================
// audio.js —— 音效 + 程序化 BGM（零素材：没有任何音频文件，全部现场合成）
// 只在浏览器里真正发声；Node 里导入安全（顶层不碰 window / 不启动定时器，
// 所有 sfx 和 setMusicPaused 在 ctx 为空时直接 return）。
//
// 本阶段增强：
//   1) 4 个音效改成可读的「配方数组」SFX_RECIPES，参数集中在一处
//   2) 每类音效有最短触发间隔，避免同帧叠成爆音
//   3) 同屏发声源硬上限 24，满了直接放弃这一层
//   4) M 键静音，localStorage 记忆；失焦自动停声，回来恢复
// ============================================================

// AudioContext、总音量、BGM 独立音量。第一次 initAudio() 时创建，之后复用。
let ctx = null;
let master = null;
let musicGain = null;

// 2 秒白噪声缓冲：踩镲、爆炸、激光瞬态共用，只创建一次
let noiseBuffer = null;

// 失真曲线：WaveShaper 的查找表，也只创建一次（节点每次新建，避免连接越堆越多）
let shaperCurve = null;

// BGM 调度器状态：定时器句柄、下一次排谱的时间点、16 分音符步号、是否被暂停
let bgmTimer = null;
let nextNoteTime = 0;
let stepIndex = 0;
let musicPaused = false;

// 乒乓延迟总线（只给音效加一点空间感）：左右两条延迟互相喂，最后分到左右声道
let delaySendGain = null;
let delayL = null;
let delayR = null;

// 110 BPM 的十六分音符时长（60 秒 / 110 拍 / 每拍 4 个十六分）
const STEP_SEC = 60 / 110 / 4;
// 前瞻调度：每 25ms 看一次，把未来 100ms 内的音符先排进 AudioContext 时间轴
const SCHEDULE_MS = 25;
const LOOKAHEAD_SEC = 0.1;
// BGM 音量上限，避免盖过音效
const MUSIC_VOLUME = 0.5;
// 总音量：静音时拉到这里，取消静音再回到 0.3
const MASTER_VOLUME = 0.3;

// 静音状态存在这里，刷新后由 localStorage 恢复
const MUTE_KEY = 'stellarAwakeningMuted';
let muted = false;
try {
  // Node 里没有 localStorage，用 typeof 保护，保证只导入模块不会炸
  if (typeof localStorage !== 'undefined') {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  }
} catch {
  muted = false;
}

// ------------------------------------------------------------
// 发声上限与音效间隔（导出给 node 自检）
// ------------------------------------------------------------

/** 同屏最多同时存在多少个振荡器 / 噪声源。 */
export const AUDIO_LIMITS = {
  MAX_VOICES: 24,
  DEFAULT_GAP: 0.04,
  MIN_GAPS: {
    shoot: 0.04,
    hit: 0.04,
    hurt: 0.04,
    kill: 0.06,
  },
};

/**
 * 某类音效现在能不能触发：距离上次触发是否已经过了最短间隔。
 * 没记录过 lastPlayed 时视为很久以前，第一次永远能响。
 */
export function canPlaySfx(name, now, lastPlayed) {
  const last = lastPlayed[name] ?? -Infinity;
  const gap = AUDIO_LIMITS.MIN_GAPS[name] ?? AUDIO_LIMITS.DEFAULT_GAP;
  return now - last >= gap;
}

/** 塞进去之后总数是 currentCount，是否还没超过上限（24 本身是允许的）。 */
export function hasVoiceRoom(currentCount) {
  return currentCount <= AUDIO_LIMITS.MAX_VOICES;
}

/** 当前是否静音，给外部 UI / 测试看。 */
export function isMuted() {
  return muted;
}

// 正在发声的源：振荡器、噪声源、BGM 鼓点、LFO 都在里面。
const activeVoices = new Set();
// 每个源需要一起断连的后续节点（滤波器、增益、延迟发送等）
const voiceNodes = new WeakMap();

/**
 * 登记一个正在发声的源，并挂上结束清理：
 * onended 时从 activeVoices 删除、断开自己和后续节点，避免连接越积越多。
 */
function registerVoice(source, nodes = []) {
  activeVoices.add(source);
  voiceNodes.set(source, nodes);
  source.onended = () => {
    activeVoices.delete(source);
    voiceNodes.delete(source);
    try {
      source.disconnect();
    } catch {
      // 已经断开过就忽略
    }
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // 已经断开过就忽略
      }
    }
  };
}

/**
 * 立刻停掉所有正在播放的声音（音效 + BGM 已排进时间轴的鼓点）。
 * 失焦、静音时调用；stop 之后浏览器会异步触发 onended，这里先断连清空。
 */
function stopAllVoices() {
  for (const source of [...activeVoices]) {
    try {
      source.onended = null;
      source.stop();
    } catch {
      // 源可能已经自然结束，忽略
    }
    try {
      source.disconnect();
    } catch {
      // 已经断开过就忽略
    }
    for (const node of voiceNodes.get(source) || []) {
      try {
        node.disconnect();
      } catch {
        // 已经断开过就忽略
      }
    }
  }
  activeVoices.clear();
}

/** 停掉 BGM 调度器；已经排进时间轴的源由 stopAllVoices 负责。 */
function stopBgm() {
  if (bgmTimer !== null) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
}

/** 当前音频时刻（秒）；没有 ctx 时给 0，方便 node 里安全调用。 */
function now() {
  return ctx ? ctx.currentTime : 0;
}

// ------------------------------------------------------------
// 初始化与失焦 / 回焦
// ------------------------------------------------------------

// blur / focus 只绑定一次，重复 initAudio 不会叠加监听
let windowHooksBound = false;

/**
 * 初始化音频：创建 AudioContext + 总音量 + BGM 音量，然后启动 BGM 调度器。
 * 浏览器要求必须由用户手势（按键/点击）触发，所以由 main.js 在第一次按键/点击时调用。
 * 已经创建过就直接复用；挂起的上下文顺手 resume。
 */
export function initAudio() {
  // Node 环境没有 window，直接跳过（方便 node 自检导入本模块）
  if (typeof window === 'undefined') return;

  if (!ctx) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return; // 老浏览器不支持，静默降级为无声游戏

    try {
      ctx = new AudioCtor();
    } catch {
      ctx = null; // 创建失败也静默降级，不影响游戏
      return;
    }

    // 总音量：静音状态从 localStorage 恢复，初始化时就是 0
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);

    // BGM 单独一路 0.5，再汇入 master，避免盖过音效
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_VOLUME;
    musicGain.connect(master);

    // 乒乓延迟总线：delayL → 左声道 / delayR → 右声道，
    // delayL 还会把声音喂给 delayR，delayR 再反馈一小部分回 delayL（回声来回弹）
    delayL = ctx.createDelay(0.5);
    delayL.delayTime.value = 0.12;
    delayR = ctx.createDelay(0.5);
    delayR.delayTime.value = 0.12;

    const pannerL = ctx.createStereoPanner();
    pannerL.pan.value = -1;
    const pannerR = ctx.createStereoPanner();
    pannerR.pan.value = 1;

    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;

    delayL.connect(pannerL);
    pannerL.connect(master);
    delayL.connect(delayR);
    delayR.connect(pannerR);
    pannerR.connect(master);
    delayR.connect(feedback);
    feedback.connect(delayL);

    // 湿声总音量 0.18：只有一点点回声，不会糊掉干声
    delaySendGain = ctx.createGain();
    delaySendGain.gain.value = 0.18;
    delaySendGain.connect(delayL);
  }

  // 有些浏览器创建后是 suspended，需要用户手势里 resume
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  // 用户第一次手势后开始放 BGM（暂停或静音时都不放）
  if (!musicPaused && !muted) startBgm();

  // 失焦 / 回焦只绑一次：失焦立刻停声并挂起上下文，回焦再恢复
  if (!windowHooksBound) {
    windowHooksBound = true;

    window.addEventListener('blur', () => {
      stopAllVoices();
      stopBgm();
      if (ctx) ctx.suspend().catch(() => {});
    });

    window.addEventListener('focus', () => {
      if (!ctx) return;
      // resume 是异步的；恢复成功后按当前暂停 / 静音状态决定要不要重开 BGM
      ctx
        .resume()
        .then(() => {
          if (!musicPaused && !muted) startBgm();
        })
        .catch(() => {});
    });
  }
}

/** 2 秒白噪声缓冲，懒创建并缓存。 */
function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;

  const length = ctx.sampleRate * 2;
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1; // -1..1 的白噪声
  }
  return noiseBuffer;
}

/** 失真曲线：tanh(x*3)，柔和削波，让激光听起来更"脏"一点。 */
function getShaperCurve() {
  if (shaperCurve) return shaperCurve;

  const n = 1024;
  shaperCurve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; // 映射到 -1..1
    shaperCurve[i] = Math.tanh(x * 3);
  }
  return shaperCurve;
}

/**
 * 放一段经过滤波的白噪声，用来做爆炸、踩镲、激光空气感。
 * 音量从 gain 指数衰减到 0.0001（指数曲线不允许到 0）。
 * dest 默认是总音量；BGM 的踩镲会传 musicGain，走独立音量。
 * 噪声源同样登记进 activeVoices，受 24 上限约束。
 * @param {{duration:number, filterType?:BiquadFilterType, filterFrom:number,
 *          filterTo:number, gain:number, when?:number, dest?:AudioNode}} opts
 */
function playNoise({
  duration,
  filterType = 'lowpass',
  filterFrom,
  filterTo,
  gain,
  when,
  dest = master,
}) {
  if (!ctx || !dest) return;

  const t = when ?? now();
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();

  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFrom, t);
  filter.frequency.exponentialRampToValueAtTime(filterTo, t + duration);

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  registerVoice(src, [filter, g]);
  src.start(t);
  src.stop(t + duration);
}

/**
 * 给一个 GainNode 套标准的 ADSR 包络（起音 → 衰减 → 持续 → 释放）。
 * 指数曲线不能到 0，所以起点和终点都用 0.0001 代替。
 * @param {GainNode} node 要套包络的音量节点
 * @param {number} t 开始时刻（秒）
 * @param {number} peak 峰值音量
 * @param {number} attack 起音时长
 * @param {number} decay 衰减时长
 * @param {number} sustain 持续电平比例（相对峰值）
 * @param {number} release 释放时长
 */
function adsr(node, t, peak, attack, decay, sustain, release) {
  const g = node.gain;
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(
    Math.max(0.0001, peak * sustain),
    t + attack + decay
  );
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay + release);
}

// ------------------------------------------------------------
// 音效配方：一个数组就是一套音色，照着从上到下叠层
// kind:'tone' 用振荡器；kind:'noise' 用白噪声
// at 是相对开头的延迟（秒），不写就是 0
// ------------------------------------------------------------

const SFX_RECIPES = {
  // 开火：科幻激光 "Pew"。
  // 锯齿波 1800→160Hz 快速扫频 + 轻微失真 + 低通 4000→800Hz，
  // 再叠 0.03 秒高通噪声做"空气感"。
  shoot: [
    {
      kind: 'tone',
      wave: 'sawtooth',
      from: 1800,
      to: 160,
      dur: 0.18,
      env: { peak: 0.22, attack: 0.005, decay: 0.05, sustain: 0.35, release: 0.12 },
      filter: { type: 'lowpass', from: 4000, to: 800 },
      shaper: true,
      delay: true,
    },
    {
      kind: 'noise',
      dur: 0.03,
      filter: { type: 'highpass', from: 2000, to: 6000 },
      gain: 0.08,
    },
  ],

  // 彻底静音，只有开火和击杀有声音
  hit: [], 

  // 击杀：旧版经典方波爆炸声
  kill: [
    {
      kind: 'tone',
      wave: 'square',         // 方波：极其干脆的复古街机感
      from: 350,              // 起始频率
      to: 70,                 // 结束频率（快速坠落，模拟爆炸）
      dur: 0.15,              // 持续 0.15 秒
      env: { peak: 0.35, attack: 0.005, decay: 0.1, sustain: 0.01, release: 0.035 },
    },
  ],

  // 受伤：警告嗡鸣。
  // 72Hz 正弦做基频，8Hz LFO 让频率上下抖 ±6Hz；
  // 再叠 110Hz 微弱锯齿波增加粗糙感，最后用 120→45Hz 短正弦给冲击力。
  hurt: [
    {
      kind: 'tone',
      wave: 'sine',
      from: 72,
      dur: 0.45,
      env: { peak: 0.6, attack: 0.05, decay: 0.1, sustain: 0.35, release: 0.3 },
      lfo: { rate: 8, depth: 6 },
    },
    {
      kind: 'tone',
      wave: 'sawtooth',
      from: 110,
      dur: 0.45,
      gain: 0.12,
    },
    {
      kind: 'tone',
      wave: 'sine',
      from: 120,
      to: 45,
      dur: 0.2,
      gain: 0.6,
    },
    // 👇 4. 新增：中频穿透层（让小喇叭能发声）
    {
      kind: 'tone',
      wave: 'square',         // 方波带有极强的泛音
      from: 220,              // 和 72Hz 形成谐波关系
      to: 180,
      dur: 0.2,               // 短促
      gain: 0.25,             // 音量不用大，刚好能听到就行
    },
    // 👇 5. 新增：高频受击噪声（模拟撕裂感）
    {
      kind: 'noise',
      dur: 0.08,
      filter: { type: 'highpass', from: 4000, to: 2000 },
      gain: 0.3,
    }
  ],
};

// 每类音效上次真正发声的时刻；最短间隔判断用
const lastPlayed = {};

/**
 * 生成一层振荡器音色：扫频 / 可选滤波 / 可选失真 / ADSR 或指数衰减 /
 * 可选延迟发送 / 可选 LFO。
 */
function spawnToneLayer(layer, baseTime) {
  const at = baseTime + (layer.at || 0);
  const nodes = [];

  const osc = ctx.createOscillator();
  osc.type = layer.wave;
  osc.frequency.setValueAtTime(layer.from, at);
  if (layer.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(layer.to, at + layer.dur);
  }

  // 从振荡器出发，一层层接到输出，同时记下所有中间节点方便一起断连
  let tail = osc;

  if (layer.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = layer.filter.type;
    filter.frequency.setValueAtTime(layer.filter.from, at);
    filter.frequency.exponentialRampToValueAtTime(
      layer.filter.to,
      at + layer.dur
    );
    tail.connect(filter);
    tail = filter;
    nodes.push(filter);
  }

  if (layer.shaper) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = getShaperCurve();
    tail.connect(shaper);
    tail = shaper;
    nodes.push(shaper);
  }

  const g = ctx.createGain();
  if (layer.env) {
    const env = layer.env;
    adsr(g, at, env.peak, env.attack, env.decay, env.sustain, env.release);
  } else {
    // 没有 ADSR 的层统一用“起音即峰值，然后指数衰减到几乎听不见”
    g.gain.setValueAtTime(layer.gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + layer.dur);
  }
  tail.connect(g);
  g.connect(master);
  if (layer.delay && delaySendGain) g.connect(delaySendGain);
  nodes.push(g);

  // LFO 只接频率参数，不直接发声；它也算一个发声源，所以创建前已按 2 个额度检查
  let lfo = null;
  if (layer.lfo) {
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(layer.lfo.rate, at);

    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(layer.lfo.depth, at);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    nodes.push(lfoGain);
  }

  osc.start(at);
  osc.stop(at + layer.dur);
  registerVoice(osc, nodes);

  if (lfo) {
    lfo.start(at);
    lfo.stop(at + layer.dur);
    registerVoice(lfo, []);
  }
}

/** 生成一层噪声音色：时长 / 滤波扫频 / 音量，统一走 playNoise。 */
function spawnNoiseLayer(layer, baseTime) {
  playNoise({
    duration: layer.dur,
    filterType: layer.filter.type,
    filterFrom: layer.filter.from,
    filterTo: layer.filter.to,
    gain: layer.gain,
    when: baseTime + (layer.at || 0),
    dest: master,
  });
}

/**
 * 统一音效入口：静音 / 上下文没跑 / 间隔太短都直接丢弃。
 * 发声源预算按层检查，不够就跳过这一层（不排队，避免延迟音越积越多）。
 * @param {'shoot'|'hit'|'kill'|'hurt'} name
 */
export function playSfx(name) {
  if (muted || !ctx || ctx.state !== 'running') return;

  const recipe = SFX_RECIPES[name];
  if (!recipe) return;

  const t = now();
  if (!canPlaySfx(name, t, lastPlayed)) return;
  lastPlayed[name] = t;

  for (const layer of recipe) {
    // LFO 也是振荡器，要占 2 个名额；普通层占 1 个
    const needed = layer.lfo ? 2 : 1;
    if (!hasVoiceRoom(activeVoices.size + needed)) break;

    if (layer.kind === 'noise') {
      spawnNoiseLayer(layer, t);
    } else {
      spawnToneLayer(layer, t);
    }
  }
}

// 调用处不用改：保留原来的四个薄包装
export function sfxShoot() {
  playSfx('shoot');
}

export function sfxHit() {
  playSfx('hit');
}

export function sfxKill() {
  playSfx('kill');
}

export function sfxHurt() {
  playSfx('hurt');
}

// ------------------------------------------------------------
// 静音开关
// ------------------------------------------------------------

/**
 * 切换静音：写 localStorage、平滑拉总音量、静音时停掉所有声音和 BGM。
 * 返回切换后的静音状态（true = 现在静音）。
 */
export function toggleMute() {
  muted = !muted;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    }
  } catch {
    // 隐私模式等情况下写不进去也不影响本次静音
  }

  if (ctx && master) {
    master.gain.setTargetAtTime(
      muted ? 0 : MASTER_VOLUME,
      ctx.currentTime,
      0.02
    );
  }

  if (muted) {
    stopAllVoices();
    stopBgm();
  } else if (!musicPaused) {
    startBgm();
  }

  return muted;
}

// ------------------------------------------------------------
// BGM：110 BPM 程序化 4/4 鼓点
// ------------------------------------------------------------

/** 底鼓：正弦 150→48Hz 快速下滑，0.14 秒。 */
function playKick(when) {
  if (!ctx || !musicGain) return;
  // BGM 也吃 24 上限：满了就少这一记，不排队
  if (!hasVoiceRoom(activeVoices.size + 1)) return;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, when);
  osc.frequency.exponentialRampToValueAtTime(48, when + 0.14);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.28, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);

  osc.connect(g);
  g.connect(musicGain);
  registerVoice(osc, [g]);
  osc.start(when);
  osc.stop(when + 0.14);
}

/** 踩镲：0.03 秒白噪声过 7000Hz 高通，走 BGM 独立音量。 */
function playHat(when) {
  if (!musicGain) return;
  if (!hasVoiceRoom(activeVoices.size + 1)) return;

  playNoise({
    duration: 0.03,
    filterType: 'highpass',
    filterFrom: 7000,
    filterTo: 7000,
    gain: 0.08,
    when,
    dest: musicGain,
  });
}

/** 按 16 分步号排这一拍的鼓：每 4 步（每拍）底鼓，每 2 步（八分）踩镲。 */
function scheduleBgmStep(step, when) {
  if (step % 4 === 0) playKick(when);
  if (step % 2 === 0) playHat(when);
}

/** 前瞻调度：把未来 0.1 秒内该响的鼓点排进 AudioContext。 */
function bgmTick() {
  if (!ctx) return;

  // 切到后台时浏览器会把 setInterval 限流，回来时 nextNoteTime 可能已经落后很多。
  // 直接把它拉回"现在"，否则会把积压的拍子一次性全部排上、听起来像爆音。
  if (nextNoteTime < ctx.currentTime) nextNoteTime = ctx.currentTime;

  const horizon = ctx.currentTime + LOOKAHEAD_SEC;
  while (nextNoteTime < horizon) {
    scheduleBgmStep(stepIndex, nextNoteTime);
    stepIndex = (stepIndex + 1) % 16; // 16 步一小节循环
    nextNoteTime += STEP_SEC;
  }
}

/** 启动 BGM 调度器（幂等）：从当前时刻对齐，从第 1 拍重新开始。 */
function startBgm() {
  // 静音 / 暂停 / 已经有调度器时都不重复启动
  if (!ctx || muted || bgmTimer !== null) return;

  nextNoteTime = ctx.currentTime;
  stepIndex = 0;
  bgmTimer = setInterval(bgmTick, SCHEDULE_MS);
}

/**
 * 暂停 / 恢复 BGM。
 * 暂停：停掉调度器并把 BGM 音量迅速拉到 0，已经排进时间轴的音也不会再响。
 * 恢复：音量回到 0.5，把 nextNoteTime 对齐到"现在"并从第 1 拍继续（不记暂停瞬间的相位）。
 */
export function setMusicPaused(paused) {
  musicPaused = paused;
  if (!ctx) return; // 还没初始化：只用记下状态，等 initAudio 时再决定放不放

  if (paused) {
    stopBgm();
    if (musicGain) musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    return;
  }

  if (musicGain) musicGain.gain.setTargetAtTime(MUSIC_VOLUME, ctx.currentTime, 0.01);
  // 静音时恢复“未暂停”状态，但不能真的开始放 BGM；等取消静音再启动
  if (!muted) startBgm();
}
