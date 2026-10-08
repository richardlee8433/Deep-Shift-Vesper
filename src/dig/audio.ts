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

export function play(sig: Signal): void {
  if (!ac || !enabled) return;
  switch (sig.t) {
    case 'dig': {
      const now = ac.currentTime;
      if (now - lastDig > 0.11) {
        lastDig = now;
        hiss(0.06, 0.25, 900 + Math.random() * 400);
      }
      break;
    }
    case 'break':
      if (sig.source === 'monster') break;
      hiss(0.16, 0.5, sig.source === 'chain' ? 2200 : 500);
      if (sig.ore) tone(sig.ore > 1 ? 1200 : 880, 0.12, 'triangle', 0.18, sig.ore > 1 ? 1800 : 1320);
      break;
    case 'link':
      if (sig.kind === 'chain') tone(1400, 0.08, 'sawtooth', 0.06, 700);
      else tone(320, 0.12, 'square', 0.08, 640);
      break;
    case 'shot':
      if (sig.tower) {
        tone(700, 0.07, 'square', 0.05, 260);
        hiss(0.06, 0.18, 2600);
      } else tone(1600, 0.05, 'square', 0.04, 900);
      break;
    case 'ring':
      tone(sig.kind === 'cap' ? 520 : 260, 0.3, 'sine', 0.22, sig.kind === 'cap' ? 1040 : 90);
      break;
    case 'kill':
      tone(300, 0.15, 'triangle', 0.15, 80);
      break;
    case 'hurt':
      tone(140, 0.18, 'sawtooth', 0.18, 70);
      break;
    case 'quake':
      hiss(1.2, 0.5, 120);
      tone(70, 1.2, 'sawtooth', 0.12, 40);
      break;
    case 'wave':
      tone(220, 0.25, 'square', 0.12);
      tone(165, 0.4, 'square', 0.12, undefined, 0.25);
      break;
    case 'spawn':
      tone(200, 0.2, 'sawtooth', 0.05, 320);
      break;
    case 'relic':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.14, undefined, i * 0.07));
      break;
    case 'first':
      tone(988, 0.2, 'sine', 0.12, 1480);
      break;
    case 'built':
      tone(420, 0.06, 'square', 0.08);
      tone(620, 0.08, 'square', 0.06, undefined, 0.05);
      break;
    case 'smashed':
      hiss(0.3, 0.5, 300);
      break;
    case 'baseHit':
      tone(180, 0.12, 'square', 0.08, 120);
      break;
    case 'fall':
      tone(220, 1, 'sawtooth', 0.18, 50);
      break;
    case 'death':
      tone(260, 0.6, 'sawtooth', 0.15, 60);
      break;
    case 'respawn':
      tone(400, 0.4, 'sine', 0.12, 900);
      break;
    case 'unreachable':
      tone(180, 0.08, 'square', 0.06);
      break;
    case 'recall':
      if (sig.on) tone(300, 0.6, 'sine', 0.12, 900);
      break;
    default:
      break;
  }
}
