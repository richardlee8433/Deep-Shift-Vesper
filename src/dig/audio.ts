// Tiny synth for feedback sounds; no audio files. Starts on the first user gesture.

import type { Signal } from './sim';

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = true;
let lastDig = 0;

export function setSound(on: boolean): void {
  enabled = on;
}

export function unlockAudio(): void {
  if (ac) {
    if (ac.state === 'suspended') void ac.resume();
    return;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ac = new Ctor();
  master = ac.createGain();
  master.gain.value = 0.35;
  master.connect(ac.destination);
  noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
  if (!ac || !master || !enabled) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hiss(dur: number, vol: number, freq: number): void {
  if (!ac || !master || !noise || !enabled) return;
  const t = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noise;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur);
}

export function play(s: Signal): void {
  if (!ac || !enabled) return;
  switch (s.t) {
    case 'dig': {
      const now = ac.currentTime;
      if (now - lastDig > 0.11) {
        lastDig = now;
        hiss(0.06, 0.25, 900 + Math.random() * 400);
      }
      break;
    }
    case 'break':
      hiss(0.16, 0.5, s.source === 'chain' ? 2200 : 500);
      if (s.ore) tone(s.ore > 1 ? 1200 : 880, 0.12, 'triangle', 0.18, s.ore > 1 ? 1800 : 1320);
      break;
    case 'link':
      if (s.kind === 'chain') tone(1400, 0.08, 'sawtooth', 0.06, 700);
      else tone(320, 0.12, 'square', 0.08, 640);
      break;
    case 'shot':
      tone(1600, 0.05, 'square', 0.05, 900);
      break;
    case 'ring':
      tone(s.kind === 'cap' ? 520 : 260, 0.3, 'sine', 0.22, s.kind === 'cap' ? 1040 : 90);
      break;
    case 'kill':
      tone(300, 0.15, 'triangle', 0.15, 80);
      break;
    case 'hurt':
      tone(140, 0.18, 'sawtooth', 0.18, 70);
      break;
    case 'warn':
      tone(660, 0.14, 'square', 0.1);
      tone(440, 0.18, 'square', 0.1, undefined, 0.16);
      break;
    case 'spawn':
      tone(200, 0.2, 'sawtooth', 0.06, 320);
      break;
    case 'relic':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.14, undefined, i * 0.07));
      break;
    case 'first':
      tone(988, 0.2, 'sine', 0.12, 1480);
      break;
    case 'nest':
      if (s.down) tone(180, 0.4, 'sawtooth', 0.15, 50);
      break;
    case 'unreachable':
      tone(180, 0.08, 'square', 0.06);
      break;
    case 'evac':
      if (s.on) tone(300, 0.6, 'sine', 0.12, 900);
      break;
    case 'end':
      if (s.result === 'success') [523, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.15, undefined, i * 0.12));
      else tone(220, 0.8, 'sawtooth', 0.15, 55);
      break;
    default:
      break;
  }
}
