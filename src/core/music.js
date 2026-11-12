// 星核机械脉冲 / Stellar Pulse — original score for 星核觉醒.
// Native Web Audio, no external samples. Place as src/core/music.js when integrating.
export const BPM = 120;
export const DURATION = 64; // 32 bars, 4/4
export const DEFAULT_VOLUME = .55; // Independent music bus; SFX briefly duck it.
const SR = 22050, TAU = Math.PI * 2;
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

export async function compose(context) {
  const buffer = context.createBuffer(2, SR * DURATION, SR);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  let seed = 198912;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  function voice(time, duration, sample, pan = 0) {
    const start = Math.round(time * SR), count = Math.round(duration * SR);
    for (let i = 0; i < count; i++) {
      const at = (start + i) % left.length, value = sample(i / SR, i / count);
      left[at] += value * (1 - pan * .3); right[at] += value * (1 + pan * .3);
    }
  }
  function bass(midi, time, length, accent) {
    const f = hz(midi);
    voice(time, length, (t, p) => {
      const phase = TAU * f * t, env = Math.min(t / .005, 1) * (1 - p) ** 1.8;
      // Audible E2 body plus quiet E1 sub: survives laptop speakers without rumble.
      const body = Math.sin(phase) + .3 * Math.sin(2 * phase) + .16 * Math.sin(3 * phase) + .07 * Math.sin(5 * phase);
      return accent * env * (.23 * Math.tanh(body * 1.25) + .065 * Math.sin(phase / 2));
    });
  }
  function pulse(midi, time, duration, level, pan = 0) {
    const f = hz(midi);
    voice(time, duration, (t, p) => {
      let wave = 0;
      for (let n = 1; n <= 5; n++) wave += Math.sin(Math.PI * n * .28) * Math.sin(TAU * f * n * t) / (n * n ** .25);
      return level * Math.min(t / .008, 1) * (1 - p) ** 2.4 * wave;
    }, pan);
  }
  function kick(time, accent = 1) {
    voice(time, .23, (t, p) => .4 * accent * Math.min(t / .003, 1) * (1 - p) ** 2.8 *
      Math.sin(TAU * (48 * t + 62 * .02 * (1 - Math.exp(-t / .02)))));
  }
  function snare(time, accent = 1) {
    let low = 0;
    voice(time, .14, (t, p) => {
      low += .38 * (noise() - low);
      return accent * Math.min(t / .002, 1) * (1 - p) ** 3 * (.19 * low + .075 * Math.sin(TAU * 184 * t));
    });
  }
  function hat(time, accent, open = false) {
    let low = 0, smooth = 0;
    voice(time, open ? .085 : .035, (t, p) => {
      const n = noise(); low += .2 * (n - low); smooth += .46 * (n - low - smooth);
      const metal = Math.sin(TAU * 2381 * t) * Math.sin(TAU * 3317 * t);
      return accent * Math.min(t / .0015, 1) * (1 - p) ** 3 * (.75 * smooth + .12 * metal);
    }, .2);
  }
  // E pedal persists for 16 bars; C and D color the second half without a heroic cadence.
  const roots = [40, 40, 36, 38];
  const motifs = [[52, 59, 55, 54], [52, 55, 59, 54], [52, 55, 50, 52], [54, 57, 52, 50]];
  for (let bar = 0; bar < 32; bar++) {
    const section = bar >> 3, local = bar % 8, root = roots[section], start = bar * 2;
    // Syncopated industrial ostinato; gaps leave room for 0.32s laser sweeps.
    const steps = local % 4 === 3 ? [0, 2, 4, 7, 8, 10, 12, 14] : [0, 3, 4, 6, 8, 10, 12, 14];
    for (const step of steps) {
      if (local === 7 && step === 14) continue;
      bass(root + (step === 10 && local % 2 ? 7 : 0), start + step * .125, step % 4 === 0 ? .21 : .14, step % 4 === 0 ? 1 : .72);
    }
    kick(start); kick(start + 1);
    if (local === 2 || (section === 3 && local === 6)) kick(start + .75, .5);
    snare(start + .5); snare(start + 1.5, .9);
    for (let eighth = 0; eighth < 8; eighth++) hat(start + eighth * .25 + .125, eighth % 2 ? .045 : .065);
    if (local === 7) { snare(start + 1.75, .24); hat(start + 1.875, .04, true); }

    // Four-note radar cell, mostly below 500 Hz, away from the laser's bright attack.
    const motif = motifs[section];
    if (local % 2 === 0) {
      [0, 1, 3].forEach(n => pulse(motif[n], start + .375 + n * .375, .2, .055, -.15));
    } else if (local === 3 || local === 7) {
      pulse(motif[2], start + .875, .28, .04, -.15);
    }
    // A short, quiet sequencer response replaces a loud chorus or EDM drop.
    if ((section === 1 || section === 3) && local % 4 === 1) {
      [root + 24, root + 19, root + 26].forEach((midi, n) => pulse(midi, start + 1.25 + n * .125, .115, .021, .35));
    }
    // Overlapping cold dyads. Release tails are added back at time zero.
    if (local % 4 === 0) {
      const f = hz(root + 12);
      voice(start, 10, (t, p) => .012 * Math.sin(Math.PI * p) ** 2 *
        (Math.sin(TAU * f * t) + .48 * Math.sin(TAU * f * 1.4983 * t)), -.45);
      voice(start + .03, 10, (t, p) => .008 * Math.sin(Math.PI * p) ** 2 *
        (Math.sin(TAU * f * 1.0017 * t) + .35 * Math.sin(TAU * f * 2.2449 * t)), .45);
    }
    // Yield every two bars; synthesis happens once, not in the game frame loop.
    if (bar % 2 === 1) await new Promise(resolve => setTimeout(resolve, 0));
  }
  // Circular filtering: warm up with one complete period, then save the next.
  // Removes DC/subsonic rumble and softens top end without a special seam fade.
  for (const channel of [left, right]) {
    let high = 0, previous = 0, low = 0;
    const hp = Math.exp(-TAU * 28 / SR), lp = 1 - Math.exp(-TAU * 4200 / SR);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < channel.length; i++) {
        const x = channel[i]; high = hp * (high + x - previous); previous = x;
        low += lp * (high - low);
        if (pass === 1) channel[i] = low;
      }
    }
  }
  return buffer;
}

export function createMusic({ context = null, destination = null, volume = DEFAULT_VOLUME, muted = false } = {}) {
  let audio = context, bus, building, source, started = 0, offset = 0;
  let wanted = false, revision = 0;
  volume = Math.max(0, Math.min(1, Number(volume) || 0));
  function halt(reset) {
    wanted = false; revision++;
    if (source) {
      offset = (offset + Math.max(0, audio.currentTime - started)) % DURATION;
      const old = source; source = null;
      bus.gain.cancelScheduledValues(audio.currentTime);
      bus.gain.setTargetAtTime(0, audio.currentTime, .004);
      old.onended = () => old.disconnect(); old.stop(audio.currentTime + .025);
    }
    if (reset) offset = 0;
  }
  async function start() {
    if (source) return true;
    wanted = true;
    const token = ++revision;
    try {
      if (!audio) {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio) return false;
        audio = new Audio();
      }
      // Call within a real Start/Continue gesture. Attach rejection handling now.
      const resuming = audio.state === 'suspended' ? audio.resume().then(() => true, () => false) : Promise.resolve(true);
      if (!bus) { bus = audio.createGain(); bus.gain.value = 0; bus.connect(destination || audio.destination); }
      building ||= compose(audio);
      const buffer = await building;
      if (!await resuming || token !== revision || !wanted || source) return false;
      source = audio.createBufferSource(); source.buffer = buffer;
      source.loop = true; source.loopEnd = DURATION; source.connect(bus);
      started = audio.currentTime; source.start(started, offset);
      bus.gain.cancelScheduledValues(started); bus.gain.setValueAtTime(0, started);
      bus.gain.linearRampToValueAtTime(muted ? 0 : volume, started + .04);
      return true;
    } catch (error) {
      building = null; wanted = false;
      console.warn('Stellar Pulse music unavailable:', error); return false;
    }
  }
  function updateGain() {
    if (bus) {
      bus.gain.cancelScheduledValues(audio.currentTime);
      bus.gain.setTargetAtTime(source && !muted ? volume : 0, audio.currentTime, .008);
    }
  }
  return {
    start, pause: () => halt(false), stop: () => halt(true),
    setMuted(value) { muted = Boolean(value); updateGain(); },
    // Audio-clock ducking: audible between attacks, clear space for laser/warnings.
    duck() {
      if (!source || muted) return;
      const t = audio.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(volume * .18, t, .006);
      bus.gain.setTargetAtTime(volume, t + .1, .055);
    },
    setVolume(value) { if (Number.isFinite(value)) volume = Math.max(0, Math.min(1, value)); updateGain(); }
  };
}
