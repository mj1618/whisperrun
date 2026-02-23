/**
 * Procedural audio engine for WhisperRun.
 *
 * All sounds are synthesized using Web Audio API oscillators,
 * noise buffers, and gain envelopes. No external audio files.
 */

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let initialized = false;

// Ambient loop refs
let ambientOsc: OscillatorNode | null = null;
let ambientNoise: AudioBufferSourceNode | null = null;
let ambientGain: GainNode | null = null;

// Footstep throttle
let lastFootstepTime = 0;
let footstepAlternate = false;
let lastGuardFootstepTime = 0;

/** Call on first user interaction (click/keypress) to unlock audio */
export function initAudio(): void {
  if (initialized) return;
  audioCtx = new AudioContext();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.3;
  masterGain.connect(audioCtx.destination);
  initialized = true;
}

export function isAudioReady(): boolean {
  return initialized && audioCtx?.state === "running";
}

export function setMasterVolume(v: number): void {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v));
}

/** Resume audio context if suspended (e.g. after tab switch) */
export function resumeAudio(): void {
  if (audioCtx?.state === "suspended") audioCtx.resume();
}

// ---- Internal helpers ----

function createNoiseBurst(duration: number, frequency: number, volume = 0.3): void {
  if (!audioCtx || !masterGain) return;
  const sampleRate = audioCtx.sampleRate;
  const bufferSize = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = 1;

  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter).connect(gain).connect(masterGain);
  source.start();
  source.stop(now + duration);
}

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.2,
  startOffset = 0,
): void {
  if (!audioCtx || !masterGain) return;
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const gain = audioCtx.createGain();
  const start = audioCtx.currentTime + startOffset;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

  osc.connect(gain).connect(masterGain);
  osc.start(start);
  osc.stop(start + duration + 0.01);
}

// ---- Sound effects ----

/** Runner footstep — short noise burst, alternating pitch */
export function playFootstep(crouching: boolean): void {
  const now = performance.now();
  if (now - lastFootstepTime < 167) return; // max 6/sec
  lastFootstepTime = now;

  const freq = footstepAlternate ? 190 : 210;
  footstepAlternate = !footstepAlternate;
  const vol = crouching ? 0.12 : 0.25;
  const filterFreq = crouching ? 250 : freq;
  createNoiseBurst(0.01, filterFreq, vol);
}

/** Guard footstep — heavier, lower */
export function playGuardFootstep(): void {
  const now = performance.now();
  if (now - lastGuardFootstepTime < 250) return; // max 4/sec
  lastGuardFootstepTime = now;

  createNoiseBurst(0.015, 150, 0.3);
}

/** Guard spots the Runner — ascending two-tone beep */
export function playAlertSound(): void {
  playTone(400, 0.08, "square", 0.15, 0);
  playTone(600, 0.08, "square", 0.15, 0.08);
}

/** Guard becomes suspicious — single soft tone */
export function playSuspiciousSound(): void {
  playTone(350, 0.15, "triangle", 0.1);
}

/** Item pickup — cheerful ascending arpeggio (C5-E5-G5) */
export function playItemPickup(): void {
  playTone(523, 0.08, "sine", 0.15, 0);      // C5
  playTone(659, 0.08, "sine", 0.15, 0.08);    // E5
  playTone(784, 0.12, "sine", 0.15, 0.16);    // G5
}

/** Door/exit unlock — low sweep with initial click */
export function playExitUnlock(): void {
  if (!audioCtx || !masterGain) return;
  // Click
  createNoiseBurst(0.005, 800, 0.25);

  // Sweep 200Hz -> 400Hz
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  const now = audioCtx.currentTime;
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.linearRampToValueAtTime(400, now + 0.2);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  osc.connect(gain).connect(masterGain);
  osc.start();
  osc.stop(now + 0.26);
}

/** Door open — short wooden creak (rising frequency sweep) */
export function playDoorOpen(): void {
  if (!audioCtx || !masterGain) return;
  createNoiseBurst(0.04, 400, 0.2);
  playTone(250, 0.06, "triangle", 0.1, 0.01);
}

/** Door close — short thud (falling frequency) */
export function playDoorClose(): void {
  if (!audioCtx || !masterGain) return;
  createNoiseBurst(0.03, 250, 0.25);
  playTone(180, 0.04, "triangle", 0.1);
}

/** Whisper ping sounds */
export function playPingSound(type: "go" | "danger" | "item"): void {
  if (type === "go") {
    playTone(800, 0.05, "sine", 0.12);
  } else if (type === "danger") {
    playTone(300, 0.03, "square", 0.12, 0);
    playTone(300, 0.03, "square", 0.12, 0.05);
  } else {
    // item — sparkly tone with vibrato
    if (!audioCtx || !masterGain) return;
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 1000;

    const vibrato = audioCtx.createOscillator();
    vibrato.frequency.value = 20;
    const vibratoGain = audioCtx.createGain();
    vibratoGain.gain.value = 30;
    vibrato.connect(vibratoGain).connect(osc.frequency);

    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain).connect(masterGain);
    osc.start();
    vibrato.start();
    osc.stop(now + 0.09);
    vibrato.stop(now + 0.09);
  }
}

/** Quick-comm sound cues — different tones for urgent/info/celebrate */
export function playQuickCommSound(category: "urgent" | "info" | "celebrate"): void {
  if (!audioCtx || !masterGain) return;
  switch (category) {
    case "urgent":
      playTone(600, 0.1, "square", 0.25);
      playTone(800, 0.15, "square", 0.25, 0.1);
      break;
    case "info":
      playTone(520, 0.2, "sine", 0.15);
      break;
    case "celebrate":
      playTone(523, 0.1, "sine", 0.15);
      playTone(659, 0.1, "sine", 0.15, 0.1);
      playTone(784, 0.15, "sine", 0.15, 0.2);
      break;
  }
}

/** Game over — caught: descending "wah wah" trombone */
export function playGameOverCaught(): void {
  if (!audioCtx || !masterGain) return;
  const osc = audioCtx.createOscillator();
  osc.type = "sawtooth";
  const now = audioCtx.currentTime;
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.linearRampToValueAtTime(200, now + 0.5);

  // Slight vibrato
  const vibrato = audioCtx.createOscillator();
  vibrato.frequency.value = 5;
  const vibratoGain = audioCtx.createGain();
  vibratoGain.gain.value = 8;
  vibrato.connect(vibratoGain).connect(osc.frequency);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

  osc.connect(gain).connect(masterGain);
  osc.start();
  vibrato.start();
  osc.stop(now + 0.61);
  vibrato.stop(now + 0.61);
}

/** Game over — escaped: victory fanfare (C4-E4-G4-C5) */
export function playGameOverEscaped(): void {
  playTone(262, 0.1, "sine", 0.15, 0);       // C4
  playTone(330, 0.1, "sine", 0.15, 0.1);      // E4
  playTone(392, 0.1, "sine", 0.15, 0.2);      // G4
  playTone(523, 0.25, "sine", 0.18, 0.3);     // C5 — held longer
}

/** Start ambient background hum during heist */
export function playAmbientLoop(): void {
  if (!audioCtx || !masterGain) return;
  stopAmbientLoop();

  ambientGain = audioCtx.createGain();
  ambientGain.gain.value = 0.05;
  ambientGain.connect(masterGain);

  // Low hum
  ambientOsc = audioCtx.createOscillator();
  ambientOsc.type = "sine";
  ambientOsc.frequency.value = 60;
  ambientOsc.connect(ambientGain);
  ambientOsc.start();

  // Brown noise (filtered)
  const bufferSize = audioCtx.sampleRate * 2;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[i] = lastOut * 3.5;
  }
  ambientNoise = audioCtx.createBufferSource();
  ambientNoise.buffer = buffer;
  ambientNoise.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 100;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = 0.03;

  ambientNoise.connect(filter).connect(noiseGain).connect(ambientGain);
  ambientNoise.start();
}

/** Stop ambient background hum */
export function stopAmbientLoop(): void {
  try {
    ambientOsc?.stop();
    ambientOsc?.disconnect();
  } catch { /* already stopped */ }
  try {
    ambientNoise?.stop();
    ambientNoise?.disconnect();
  } catch { /* already stopped */ }
  try {
    ambientGain?.disconnect();
  } catch { /* already disconnected */ }
  ambientOsc = null;
  ambientNoise = null;
  ambientGain = null;
}

/** Countdown tick — short click for last 10 seconds */
export function playCountdownTick(): void {
  playTone(1000, 0.02, "sine", 0.1);
}

/** Countdown urgent — tick with lower harmonic for last 3 seconds */
export function playCountdownUrgent(): void {
  playTone(1000, 0.03, "sine", 0.15);
  playTone(500, 0.03, "sine", 0.12);
}
