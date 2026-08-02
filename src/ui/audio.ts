/**
 * B8 UI — `src/ui/audio.ts` — the dojo's voice: the count, the kiai, and the sounds a body makes.
 *
 * ═══ WHY EVERYTHING IS SYNTHESISED ═══════════════════════════════════════════════════════════
 *
 * This project generates every asset it uses — the dojo, the gi, the character — and downloading a
 * WAV of someone else's kiai would be the one imported thing in a build that imports nothing. So the
 * voice is the platform's own TTS (`window.speechSynthesis`, shipped with every browser, no network)
 * and the three sound effects are built out of oscillators, noise and biquads at run time. Nothing
 * here fetches, and the whole module adds zero bytes to the asset budget.
 *
 * ═══ WHY IT STARTS SILENT ════════════════════════════════════════════════════════════════════
 *
 * `createKataAudio()` returns a module that is OFF. Two independent reasons, and they happen to have
 * the same fix:
 *
 *   1. A page that starts shouting when you open it is hostile, and this one shouts by design.
 *   2. Every browser suspends a fresh `AudioContext` until a user gesture. Sounds scheduled on a
 *      suspended context do NOT play late — `currentTime` is frozen, so they all pile up on the same
 *      instant and detonate together the moment it resumes. Scheduling into a suspended context is
 *      therefore worse than dropping the sound, and this module drops it (see `bus()`).
 *
 * Both are answered by one toggle in the UI: the click that turns audio on IS the gesture that
 * unblocks the context. Wire `setEnabled(true)` to a button, not to boot.
 *
 * ═══ WIRING (this module never imports the player; the caller connects the two) ═══════════════
 *
 *     const audio = createKataAudio();                      // silent until enabled
 *     soundBtn.onclick = () => audio.setEnabled(!audio.enabled);
 *     // …in bootStage's onBeatChange. Note the THIRD argument is not forwarded: `i` is the beat
 *     // index, and this module's third argument is an options object precisely so that passing it
 *     // by reflex does not compile. Pass `{ slotSeconds: beat.durS }` if the beat is to hand.
 *     onBeatChange: (label, kiai, i) => { hud?.setActive(i); audio.onBeatChange(label, kiai); }
 *
 * `onBeatChange` is the whole integration: it splits `"8. migi chudan oi-zuki"` into the count and
 * the technique, barks the count, announces the name, and schedules the footfall, the gi snap and —
 * on counts 8 and 16 — the kiai at the moment of kime. The individual methods stay public for a HUD
 * that wants to fire one by hand.
 *
 * ═══ DEGRADING ═══════════════════════════════════════════════════════════════════════════════
 *
 * No `AudioContext`, no `speechSynthesis`, no voices at all, autoplay refused, no `window` (this
 * file is imported by `tests/ui/audio.test.ts` under Node): each is a quiet no-op. Not one path
 * throws, because the headless capture in `tools/capture.mjs` boots the same page and a thrown
 * `NotAllowedError` there would fail a render that has nothing to do with sound.
 *
 * The count tables, the label parser, the kana lexicon and the voice ranking are exported as PURE
 * functions with no browser in them — that is the half of this file that can actually be checked,
 * and `tests/ui/audio.test.ts` checks it against the real kata data.
 */

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The count, in Japanese
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The ceiling, and why it is not 20.
 *
 * Taikyoku Shodan has 20 counts and Heian Shodan has 21 — the first version of this table stopped at
 * 20 and `tests/ui/audio.test.ts` caught count 21 going unspoken against the real compiled score.
 * A hand-written list is the wrong shape for this: the Heian series runs to 27 and Bassai Dai to 42,
 * so the numbers are BUILT below and this bound is just the point past which nothing is a kata count.
 */
const COUNT_MAX = 99;

/**
 * 1–10 as a dojo counts them, which is NOT how a phrasebook does. Japanese has two readings for 4,
 * 7 and 9 — `yon`/`shi`, `nana`/`shichi`, `kyuu`/`ku` — and karate counting uses the Sino-Japanese
 * one throughout (`shi`, `shichi`, `ku`), because the count is a rhythm and the on-reading is the
 * one that keeps every number a clean one or two morae. A sensei who counted "yon" would be marked.
 */
const UNITS_ROMAJI: readonly string[] = Object.freeze([
  'ichi', 'ni', 'san', 'shi', 'go', 'roku', 'shichi', 'hachi', 'ku', 'juu',
]);

/**
 * The same ten in kana.
 *
 * A `ja-JP` voice handed the latin string "ichi" either spells the letters or reads them as English;
 * handed いち it says the number. Every engine tested treats kana as the only reliable input, so the
 * romaji above is the FALLBACK — what a non-Japanese voice gets — and this is the primary text.
 */
const UNITS_KANA: readonly string[] = Object.freeze([
  'いち', 'に', 'さん', 'し', 'ご', 'ろく', 'しち', 'はち', 'く', 'じゅう',
]);

/**
 * The TENS digit — and it does not use the readings above.
 *
 * This is the part that looks like a typo and is not: 4, 7 and 9 revert to `yon`, `nana`, `kyuu`
 * once they multiply. 24 is `nijuu-shi` (the ones digit keeps the counting reading) but 40 is
 * `yonjuu`, never `shijuu`; 70 is `nanajuu` and 90 is `kyuujuu`. Indexed from 2, since `juu` alone
 * carries the teens.
 */
const TENS_ROMAJI: readonly string[] = Object.freeze([
  'ni', 'san', 'yon', 'go', 'roku', 'nana', 'hachi', 'kyuu',
]);
const TENS_KANA: readonly string[] = Object.freeze([
  'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう',
]);

/** Assemble n from its digits, or `null` for anything that is not an integer count in 1…99. */
function count(n: number, units: readonly string[], tens: readonly string[], juu: string): string | null {
  if (!Number.isInteger(n) || n < 1 || n > COUNT_MAX) return null;
  if (n <= 10) return units[n - 1] ?? null;
  const t = Math.floor(n / 10);
  const ones = n % 10;
  const head = t === 1 ? juu : `${tens[t - 2] ?? ''}${juu}`;
  return ones === 0 ? head : `${head}${units[ones - 1] ?? ''}`;
}

/** The count as romaji — the text a non-Japanese voice is handed. */
export function countRomaji(n: number): string | null {
  return count(n, UNITS_ROMAJI, TENS_ROMAJI, 'juu');
}

/** The count as kana. Same domain as `countRomaji` — the two are defined for exactly the same n. */
export function countKana(n: number): string | null {
  return count(n, UNITS_KANA, TENS_KANA, 'じゅう');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The technique name, and the handful of ceremony phases that are actually spoken
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Romaji token -> kana, for the terms `src/data/kata/*.kata.ts` can put in a beat label.
 *
 * Keyed by TOKEN, not by whole phrase, so `hidari gedan-barai` and `migi chudan oi-zuki` fall out of
 * the same twenty-odd entries and a new technique only needs the words it introduces. Split on both
 * spaces and hyphens: `gedan-barai` is one word (げだんばらい), `hidari gedan-barai` is two.
 *
 * The rendaku is deliberate — 突き is つき alone (`choku-zuki` is written with `-zuki` in the data
 * for exactly this reason) and づき in a compound, which is what `oi-zuki` → おいづき encodes.
 *
 * Covers every `romaji` string in both kata files plus every id in `CLIP_FOR_TECHNIQUE`, so the
 * lexicon does not go stale silently: `tests/ui/audio.test.ts` walks the compiled beats and fails if
 * any move label has a token that is missing here.
 */
const TERM_KANA: Readonly<Record<string, string>> = Object.freeze({
  /* side */
  hidari: 'ひだり', migi: 'みぎ',
  /* level */
  gedan: 'げだん', chudan: 'ちゅうだん', jodan: 'じょうだん',
  /* blocks */
  barai: 'ばらい', age: 'あげ', uke: 'うけ', soto: 'そと', uchi: 'うち', shuto: 'しゅとう',
  /* strikes */
  choku: 'ちょく', oi: 'おい', gyaku: 'ぎゃく', zuki: 'づき', tsuki: 'つき',
  tettsui: 'てっつい', kentsui: 'けんつい', tate: 'たて', mawashi: 'まわし',
  /* the spoken commands */
  rei: 'れい', yoi: 'ようい', yame: 'やめ', kiotsuke: 'きをつけ',
});

/**
 * A romaji phrase in kana, or `null` if ANY token is unknown.
 *
 * All-or-nothing on purpose: a half-converted "ひだり tettsui-tate-mawashi" reads worse to a
 * Japanese voice than the plain romaji does, and `null` is the signal that sends the caller to the
 * romaji fallback instead of shipping a mongrel string to the synthesiser.
 */
export function toKana(phrase: string): string | null {
  const words = phrase.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return null;
  const out: string[] = [];
  for (const w of words) {
    let acc = '';
    for (const part of w.split('-')) {
      const k = TERM_KANA[part];
      if (k === undefined) return null;
      acc += k;
    }
    out.push(acc);
  }
  return out.join(' ');
}

/**
 * Ceremony phase -> the command a sensei actually calls.
 *
 * `Beat.label` for a ceremony phase is `CeremonyPhase.id` lowercased with the underscores opened up
 * (`REI_IN` -> `rei in`), and those ids are STAGE DIRECTIONS, not speech: `announce`, `set`,
 * `final hold`, `settle` name what the body is doing, and nobody says them out loud. Only four of
 * the nine are real commands, so only four are mapped and the rest resolve to silence.
 *
 * `announce` is the one that hurts to leave out — it is the phase where the performer names the kata
 * — but the name is the KataId, and this module deliberately does not know which kata is loaded.
 * A caller that wants it can pass the name to `technique()` itself.
 */
const CEREMONY_COMMAND: Readonly<Record<string, string>> = Object.freeze({
  'rei in': 'rei',
  'rei out': 'rei',
  yoi: 'yoi',
  yame: 'yame',
  attention: 'kiotsuke',
});

export interface BeatSpeech {
  /** doc 02 count, or `null` for a ceremony phase. */
  readonly count: number | null;
  /** What to say, in romaji. `null` means SAY NOTHING — silence is a valid reading of a beat. */
  readonly phrase: string | null;
}

/**
 * Split a `Beat.label` into the count and the words.
 *
 * `buildBeats` writes moves as `` `${m.n}. ${m.label}` `` and ceremony phases as the opened-up id,
 * so one regex separates them. Tolerant of a raw `REI_IN` and of a label whose count has already
 * been stripped, because the caller may hand either.
 */
export function parseBeatLabel(label: string): BeatSpeech {
  const m = /^\s*(\d+)\s*\.\s*(.*)$/.exec(label);
  if (m !== null) {
    const n = Number.parseInt(m[1] ?? '', 10);
    const rest = (m[2] ?? '').trim();
    return { count: Number.isFinite(n) ? n : null, phrase: rest.length > 0 ? rest : null };
  }
  const key = label.trim().toLowerCase().replace(/_/g, ' ');
  return { count: null, phrase: CEREMONY_COMMAND[key] ?? null };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Choosing a voice
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** The three fields of `SpeechSynthesisVoice` the ranking reads. Structural, so it is testable. */
export interface VoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly localService?: boolean;
  readonly default?: boolean;
}

export interface VoiceChoice<T extends VoiceLike> {
  readonly voice: T;
  /** True only for a `ja*` voice — the flag that decides kana vs romaji at the utterance. */
  readonly japanese: boolean;
}

/** `ja`, `ja-JP`, `ja_JP`, `JA-jp` all mean Japanese; BCP-47 tags are case- and separator-sloppy. */
const isJapanese = (lang: string): boolean => /^ja(?:[-_]|$)/i.test(lang.trim());

/**
 * Languages a TTS engine is likely to ship that are NOT written in the Latin alphabet.
 *
 * A DENYLIST, and the direction matters: an unknown tag is treated as Latin, so a language missing
 * from this list is ranked exactly as it would have been without the check. An allowlist would fail
 * the other way and silently demote every voice nobody thought of.
 */
const NON_LATIN_SCRIPT: ReadonlySet<string> = new Set([
  'am', 'ar', 'be', 'bg', 'bn', 'dv', 'el', 'fa', 'gu', 'he', 'hi', 'hy', 'iw', 'ka', 'km', 'kn',
  'ko', 'lo', 'mk', 'ml', 'mn', 'mr', 'my', 'ne', 'pa', 'ps', 'ru', 'si', 'sr', 'ta', 'te', 'th',
  'ti', 'ug', 'uk', 'ur', 'yi', 'zh',
]);

const isLatinScript = (lang: string): boolean =>
  !NON_LATIN_SCRIPT.has((lang.trim().split(/[-_]/)[0] ?? '').toLowerCase());

/**
 * Rank one voice as a tuple, compared left to right. Two tiers, and they sort on DIFFERENT things.
 *
 * A Japanese voice wins outright, and among Japanese voices the tie-break is LOCAL before network: a
 * network voice (Google's, on Chrome) goes silent offline and stalls behind a request on a slow
 * link, and a count that arrives after the technique it counts is worse than one in the wrong
 * accent. Only then `default`.
 *
 * With no Japanese voice installed the question changes completely, so the ordering does too. We are
 * no longer choosing a Japanese speaker; we are choosing who reads a LATIN string — `hachi`,
 * `hidari gedan-barai` — and the first thing that matters is whether the engine reads Latin script
 * at all. Measured on the machine this was built on: four voices, no Japanese, and the platform
 * default is `he-IL`. Ranking on `default` first would hand romaji to a Hebrew synthesiser. So
 * script comes first here, and the user's own default voice only breaks the tie among the voices
 * that can plausibly pronounce it.
 */
function rankVoice(v: VoiceLike): readonly number[] {
  const local = v.localService === true ? 1 : 0;
  const dflt = v.default === true ? 1 : 0;
  return isJapanese(v.lang)
    ? [3, local, dflt]
    : [isLatinScript(v.lang) ? 1 : 0, dflt, local];
}

/** Lexicographic, first difference wins; equal-length tuples by construction. */
function outranks(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * The best installed voice, or `null` if the platform offers none at all.
 *
 * Generic in the voice type so the browser path keeps its `SpeechSynthesisVoice` and can assign the
 * result straight to `utterance.voice`, while a test can rank plain objects.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[]): VoiceChoice<T> | null {
  let best: T | null = null;
  let bestRank: readonly number[] = [];
  for (const v of voices) {
    const r = rankVoice(v);
    if (best === null || outranks(r, bestRank)) {
      best = v;
      bestRank = r;
    }
  }
  if (best === null) return null;
  return { voice: best, japanese: isJapanese(best.lang) };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Synthesis — the numbers
 *
 * Every frequency below is a formant or a body resonance with a reason, not a knob that sounded
 * nice. Where a value is a vowel formant it is the textbook centre for that vowel; the shout is
 * built as a vowel because a shout IS a vowel, and filtered noise alone only ever hisses.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** `exponentialRampToValueAtTime` rejects 0 — it is a ratio ramp. This is the stand-in for silence. */
const SILENT = 1e-4;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Seconds of white noise held in the shared buffer. Long enough that grains never repeat audibly. */
const NOISE_SECONDS = 1.5;
/** Each hit reads from a different offset, so ten footfalls are not ten copies of one waveform. */
const GRAIN_STRIDE_S = 0.137;

const KIAI_DUR_S = 0.42;
/** Vowel transition time. "kiai" is /k-i-a-i/; the formants sweep /i/ -> /a/ over this, then hold. */
const KIAI_VOWEL_S = 0.11;
/** Male shout: starts around a raised speaking pitch, peaks under strain, collapses at the cut-off. */
const KIAI_F0_START = 190;
const KIAI_F0_PEAK = 300;
const KIAI_F0_END = 150;
/** Two saws a few cents apart. Exact unison is a synth; the beating between them is a strained throat. */
const KIAI_DETUNE_CENTS: readonly number[] = Object.freeze([-9, 11]);
const KIAI_PEAK = 0.85;

/**
 * The vowel, as three band-passes swept from /i/ to /a/.
 *
 * Textbook adult-male centres: /i/ ≈ (270, 2290, 3010), /a/ ≈ (730, 1090, 2440). F1 rising while F2
 * falls is the entire acoustic signature of that diphthong — do it the other way round and the shout
 * says "ah-ee". Q rises with the formant index because the higher resonances are the narrower ones,
 * and the gains fall because a real vocal tract rolls off about 6 dB per formant.
 */
const KIAI_FORMANTS: readonly { from: number; to: number; q: number; gain: number }[] = Object.freeze([
  { from: 270, to: 730, q: 7, gain: 1.0 },
  { from: 2290, to: 1090, q: 9, gain: 0.55 },
  { from: 3010, to: 2440, q: 11, gain: 0.22 },
]);
/** Below F1 the band-passes leave nothing, and a shout with no chest in it sounds like a kettle. */
const KIAI_CHEST_HZ = 480;
const KIAI_CHEST_GAIN = 0.4;

const SNAP_DUR_S = 0.055;
/** Cotton drill cracking: the transient is all upper-mid, and anything below ~1.8 kHz is a thud. */
const SNAP_HIGHPASS_HZ = 1800;
const SNAP_BAND_HZ = 3800;
const SNAP_PEAK = 0.5;

const FOOT_DUR_S = 0.24;
/** A bare foot on a sprung floor: the board's note, dropping as the contact patch spreads. */
const FOOT_F_START = 118;
const FOOT_F_END = 44;
/** The slap on top of the thump. Low-passed, because skin on wood has no high end to speak of. */
const FOOT_SLAP_HZ = 520;
const FOOT_PEAK = 0.55;

/**
 * Soft clip for the shout, as `tanh` normalised to unity gain at full scale.
 *
 * A shout is a driven, non-linear source; the harmonics that make it read as EFFORT rather than as a
 * loud vowel come from the clipping, not from the oscillator. Built once at module load — it is pure
 * arithmetic, no `AudioContext` needed, so it costs nothing on the Node import path.
 */
/* The `<ArrayBuffer>` argument is not decoration: since TS 5.7 the typed arrays are generic in their
 * backing buffer, and `WaveShaperNode.curve` takes only the non-shared one. Bare `Float32Array`
 * widens to `ArrayBufferLike`, which includes `SharedArrayBuffer`, and the assignment is rejected. */
function makeDriveCurve(amount: number, n = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / norm;
  }
  return curve;
}
const DRIVE_CURVE = makeDriveCurve(2.2);

/**
 * mulberry32 — a seeded PRNG for the noise buffer.
 *
 * `Math.random()` would do acoustically, but then the gi snap in one capture is not the gi snap in
 * the next, and §6.3's determinism ledger exists precisely so a rendered frame is reproducible. The
 * seed is 'KATA' as bytes. Not exported: the noise is an implementation detail of the buffer.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Synthesis — the graph
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Everything a one-shot needs: where to build, where to land, and the shared noise. */
interface Bus {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly noise: AudioBuffer;
  /** Rotating grain index — see `GRAIN_STRIDE_S`. Mutable by design. */
  grain: number;
}

function makeNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.max(1, Math.round(ctx.sampleRate * NOISE_SECONDS));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  const rand = mulberry32(0x4b415441);
  for (let i = 0; i < len; i++) ch[i] = rand() * 2 - 1;
  return buf;
}

/** A looping read of the shared noise, windowed to `durS`, starting at a fresh grain each call. */
function noiseSource(bus: Bus, t0: number, durS: number): AudioBufferSourceNode {
  const src = bus.ctx.createBufferSource();
  src.buffer = bus.noise;
  src.loop = true;
  const offset = (bus.grain * GRAIN_STRIDE_S) % NOISE_SECONDS;
  /* 97 is prime and coprime with everything in the timing above, so the grain cycle never falls into
   * step with the beat and turns a rhythm of footfalls into an audible loop. */
  bus.grain = (bus.grain + 1) % 97;
  src.start(t0, offset);
  src.stop(t0 + durS);
  return src;
}

/** Percussive envelope: near-instant attack, exponential decay, then pinned to a true zero. */
function burst(param: AudioParam, t0: number, peak: number, attackS: number, decayS: number): void {
  const p = Math.max(peak, SILENT * 2);
  param.setValueAtTime(SILENT, t0);
  param.exponentialRampToValueAtTime(p, t0 + attackS);
  param.exponentialRampToValueAtTime(SILENT, t0 + attackS + decayS);
  param.linearRampToValueAtTime(0, t0 + attackS + decayS + 0.004);
}

function scheduleKiai(bus: Bus, t0: number, intensity: number): void {
  const { ctx } = bus;

  const env = ctx.createGain();
  const drive = ctx.createWaveShaper();
  drive.curve = DRIVE_CURVE;
  drive.oversample = '2x';
  drive.connect(env);
  env.connect(bus.out);

  /* The glottal source, summed here and split into the formants below. */
  const src = ctx.createGain();
  src.gain.value = 0.5;

  let lifetime: OscillatorNode | null = null;
  for (const detune of KIAI_DETUNE_CENTS) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    /* The pitch gesture is the shout: a fast lift into the strain, a hold, then a collapse as the
     * air runs out. A flat f0 reads as a sung note, not as someone yelling. */
    osc.frequency.setValueAtTime(KIAI_F0_START, t0);
    osc.frequency.exponentialRampToValueAtTime(KIAI_F0_PEAK, t0 + 0.055);
    osc.frequency.setValueAtTime(KIAI_F0_PEAK, t0 + 0.12);
    osc.frequency.exponentialRampToValueAtTime(KIAI_F0_END, t0 + KIAI_DUR_S);
    osc.connect(src);
    osc.start(t0);
    osc.stop(t0 + KIAI_DUR_S + 0.05);
    lifetime = osc;
  }

  /* Breath. A voiced source alone is a buzz; the turbulence is what puts a throat behind it. */
  const breath = noiseSource(bus, t0, KIAI_DUR_S);
  const breathBand = ctx.createBiquadFilter();
  breathBand.type = 'bandpass';
  breathBand.frequency.value = 2000;
  breathBand.Q.value = 0.7;
  const breathGain = ctx.createGain();
  breathGain.gain.value = 0.2;
  breath.connect(breathBand).connect(breathGain).connect(src);

  for (const f of KIAI_FORMANTS) {
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = f.q;
    band.frequency.setValueAtTime(f.from, t0);
    band.frequency.linearRampToValueAtTime(f.to, t0 + KIAI_VOWEL_S);
    const g = ctx.createGain();
    g.gain.value = f.gain;
    src.connect(band).connect(g).connect(drive);
  }

  const chest = ctx.createBiquadFilter();
  chest.type = 'lowpass';
  chest.frequency.value = KIAI_CHEST_HZ;
  const chestGain = ctx.createGain();
  chestGain.gain.value = KIAI_CHEST_GAIN;
  src.connect(chest).connect(chestGain).connect(drive);

  /* The /k/. A 14 ms noise transient in front of the vowel, routed past the formants — it is a
   * plosive, it has no vowel colour, and it is the difference between "aaa" and a word. */
  const plosive = noiseSource(bus, t0, 0.014);
  const plosiveHp = ctx.createBiquadFilter();
  plosiveHp.type = 'highpass';
  plosiveHp.frequency.value = 1400;
  const plosiveGain = ctx.createGain();
  burst(plosiveGain.gain, t0, 0.45 * clamp01(intensity), 0.002, 0.012);
  plosive.connect(plosiveHp).connect(plosiveGain).connect(env);

  /* Loud almost at once, held for a tenth of a second, then cut. The sharp tail is the point: a
   * kiai that fades sounds like a sigh, and the shout has to end where the technique locks. */
  const peak = Math.max(KIAI_PEAK * clamp01(intensity), SILENT * 2);
  env.gain.setValueAtTime(SILENT, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
  env.gain.setValueAtTime(peak, t0 + 0.11);
  env.gain.exponentialRampToValueAtTime(peak * 0.5, t0 + 0.21);
  env.gain.exponentialRampToValueAtTime(SILENT, t0 + KIAI_DUR_S);
  env.gain.linearRampToValueAtTime(0, t0 + KIAI_DUR_S + 0.02);

  if (lifetime !== null) {
    lifetime.onended = (): void => {
      env.disconnect();
      src.disconnect();
    };
  }
}

function scheduleGiSnap(bus: Bus, t0: number, intensity: number): void {
  const { ctx } = bus;
  const src = noiseSource(bus, t0, SNAP_DUR_S);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = SNAP_HIGHPASS_HZ;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = SNAP_BAND_HZ;
  band.Q.value = 1.1;
  const env = ctx.createGain();
  /* 1.5 ms attack and a 40 ms decay. Longer than this and the crack becomes a shhh — the whole
   * character of fabric snapping is that it is over before you locate it. */
  burst(env.gain, t0, SNAP_PEAK * clamp01(intensity), 0.0015, 0.04);
  src.connect(hp).connect(band).connect(env).connect(bus.out);
  src.onended = (): void => env.disconnect();
}

function scheduleFootfall(bus: Bus, t0: number, intensity: number): void {
  const { ctx } = bus;
  const amp = clamp01(intensity);

  /* The board. A sine dropping an octave and a half in 60 ms is the standard synthetic kick, and it
   * is the right shape here for the same reason: a falling pitch is what a struck panel does as the
   * contact area grows and its effective stiffness changes. */
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(FOOT_F_START, t0);
  osc.frequency.exponentialRampToValueAtTime(FOOT_F_END, t0 + 0.06);
  const thump = ctx.createGain();
  burst(thump.gain, t0, FOOT_PEAK * amp, 0.004, FOOT_DUR_S);
  osc.connect(thump).connect(bus.out);
  osc.start(t0);
  osc.stop(t0 + FOOT_DUR_S + 0.05);

  /* The sole. Low-passed noise, gone in 50 ms — the contact, not the resonance. */
  const slap = noiseSource(bus, t0, 0.09);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = FOOT_SLAP_HZ;
  lp.Q.value = 0.8;
  const slapGain = ctx.createGain();
  burst(slapGain.gain, t0, 0.34 * amp, 0.002, 0.05);
  slap.connect(lp).connect(slapGain).connect(bus.out);

  osc.onended = (): void => {
    thump.disconnect();
    slapGain.disconnect();
  };
}

export type SfxKind = 'kiai' | 'gi-snap' | 'footfall';

/**
 * Schedule one sound into any context at `when` — including an `OfflineAudioContext`.
 *
 * Exported for exactly one reason: it is the only way to MEASURE these sounds. Rendering a kiai
 * offline and reading its peak, RMS and spectral centroid turns "it should sound like a shout" into
 * a number, and a sound effect nobody can measure is a sound effect nobody can debug. The live
 * module below drives the same three functions, so what an offline render measures is what plays.
 */
export function renderSfx(
  kind: SfxKind,
  ctx: BaseAudioContext,
  out: AudioNode,
  when = 0,
  intensity = 1,
): void {
  const bus: Bus = { ctx, out, noise: makeNoiseBuffer(ctx), grain: 0 };
  if (kind === 'kiai') scheduleKiai(bus, when, intensity);
  else if (kind === 'gi-snap') scheduleGiSnap(bus, when, intensity);
  else scheduleFootfall(bus, when, intensity);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The module
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface KataAudioOpts {
  /** Default `false`. See the header: the toggle that enables audio is also the autoplay gesture. */
  enabled?: boolean;
  /** Master, 0…1. Default 0.5 — this is a viewer, not a PA system. */
  volume?: number;
  /** Speak counts and technique names. Default `true`; the effects survive turning it off. */
  voice?: boolean;
}

export interface KataAudio {
  /** Bark the count. `n` outside 1…20 is ignored. */
  countIn(n: number): void;
  /** Announce a beat label — `"8. migi chudan oi-zuki"` or `"hidari gedan-barai"` or `"yoi"`. */
  technique(label: string): void;
  /** The shout. `delayS` places it at kime rather than at the top of the count. */
  kiai(delayS?: number): void;
  footfall(intensity?: number): void;
  giSnap(intensity?: number): void;
  /**
   * The whole integration — see the header.
   *
   * The third argument is an OPTIONS OBJECT and not a number on purpose. `bootStage`'s callback is
   * `(label, kiai, index)`, forwarding all three of its arguments is the obvious thing to write, and
   * a `durationS: number` here would accept the beat INDEX without a murmur — count 8 would schedule
   * its kiai 3.4 seconds late and nothing would report it. An object makes that a compile error.
   */
  onBeatChange(label: string, kiai: boolean, opts?: { slotSeconds?: number }): void;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
  readonly enabled: boolean;
  /** The TTS voice in use, `null` if the platform offered none. For a HUD readout and for debugging. */
  readonly voiceName: string | null;
  dispose(): void;
}

/**
 * `TECH_FIRE_FRAC` from `src/player/choreography.ts`, copied rather than imported.
 *
 * B8 may import the `src/player` barrel, but that barrel pulls `character.ts` and therefore
 * `GLTFLoader` — three.js, into an audio module, for one float. `src/ui` is on the three allowlist
 * so nothing would fail; it would just be wrong. Treat a change over there as a change here.
 */
const TECH_FIRE_FRAC = 0.42;

/**
 * Where the foot lands, and why it is NOT `choreography.ts`'s `TRAVEL_END_FRAC`.
 *
 * That constant is 0.55 — the root finishes gliding to the new embusen point AFTER the technique
 * fires at 0.42, which is deliberate over there (the overlap is what stops a count reading as two
 * separate events) and unusable here. Sound has no such tolerance: a thump heard after the punch is
 * a stumble, not a step, and at the F tempo of counts 8 and 16 (`tSlotS` 0.8 s) that is what
 * 0.55 × slot would produce. So the footfall is placed relative to the KIME instead, a fixed
 * fraction of the count ahead of it — 50 ms early on a fast count, 110 ms on a normal one, which is
 * the order the ear needs and the same order at every tempo.
 */
const FOOT_LAND_FRAC = TECH_FIRE_FRAC - 0.06;
/** An N-tempo count at T1 (`tSlotS` 1.85 s). Used when the caller cannot say how long the beat is. */
const DEFAULT_BEAT_S = 1.85;

/** Faster than this and a spoken count cannot keep up — arrow-key scrubbing fires beats every frame. */
const COUNT_MIN_GAP_MS = 260;
/** A technique name that has waited longer than this belongs to a count that is already over. */
const TECHNIQUE_STALE_MS = 1500;
/** `onend` is not guaranteed — a backgrounded tab can swallow it. Never stay "speaking" forever. */
const SPEECH_WATCHDOG_MS = 3000;

/** Prosody. The count is barked short and low; the name is announced, so it gets room. */
const COUNT_PROSODY = { rate: 1.05, pitch: 0.9 };
const NAME_PROSODY = { rate: 0.95, pitch: 1.0 };

type Prosody = { rate: number; pitch: number };

export function createKataAudio(opts?: KataAudioOpts): KataAudio {
  let enabled = opts?.enabled ?? false;
  let volume = clamp01(opts?.volume ?? 0.5);
  const voiceOn = opts?.voice ?? true;
  let disposed = false;

  const win: (Window & typeof globalThis) | null = typeof window === 'undefined' ? null : window;

  /* ── the audio graph ──────────────────────────────────────────────────────────────────────── */

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  /** The live bus. Persistent so its grain counter keeps rotating across every hit of the session. */
  let sfxBus: Bus | null = null;
  /** Latched after a failed construction, so a browser without Web Audio is asked exactly once. */
  let audioDead = false;

  function ensureCtx(): AudioContext | null {
    if (disposed || audioDead) return null;
    if (ctx !== null) return ctx;
    const w = win as unknown as {
      AudioContext?: new () => AudioContext;
      webkitAudioContext?: new () => AudioContext;
    } | null;
    /* `webkitAudioContext` is still the only constructor on older iOS Safari, and it is the browser
     * most likely to be pointed at a page like this one. */
    const ctor = w?.AudioContext ?? w?.webkitAudioContext;
    if (ctor === undefined) {
      audioDead = true;
      return null;
    }
    try {
      const c = new ctor();
      const m = c.createGain();
      m.gain.value = enabled ? volume : 0;
      /* One compressor across everything. A kiai landing on the same instant as a footfall and a gi
       * snap sums to well over unity, and the alternative to 3 dB of catch here is a click. */
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      m.connect(comp).connect(c.destination);
      ctx = c;
      master = m;
      sfxBus = { ctx: c, out: m, noise: makeNoiseBuffer(c), grain: 0 };
      return c;
    } catch {
      /* Some embeddings throw on construction (too many contexts, no output device). One try. */
      audioDead = true;
      return null;
    }
  }

  /**
   * The bus, or `null` if nothing may be scheduled right now.
   *
   * The `state === 'running'` check is the load-bearing line of the whole autoplay story — see the
   * header. A suspended context has a FROZEN `currentTime`, so anything scheduled against it queues
   * up at the same instant and fires as one blast on resume. Dropping the sound is the only sane
   * answer, and the resume kicked off here means the next one lands.
   */
  function bus(): Bus | null {
    if (disposed || !enabled) return null;
    const c = ensureCtx();
    if (c === null || sfxBus === null) return null;
    if (c.state !== 'running') {
      void resume();
      return null;
    }
    return sfxBus;
  }

  function resume(): Promise<void> {
    const c = ctx;
    if (c === null || c.state === 'running') return Promise.resolve();
    /* Before a gesture, Chrome leaves this promise PENDING rather than rejecting — never await it. */
    return c.resume().catch(() => undefined);
  }

  /**
   * First gesture wins.
   *
   * Registered at construction rather than at `setEnabled`, because the click that enables audio is
   * usually the only gesture the page ever gets, and the context has to exist before it can be
   * resumed by it. Passive and capturing, so nothing here can interfere with OrbitControls.
   */
  const onGesture = (): void => {
    if (disposed || !enabled) return;
    if (ensureCtx() !== null) void resume();
  };
  const GESTURES: readonly string[] = ['pointerdown', 'keydown', 'touchend'];
  if (win !== null) {
    for (const type of GESTURES) {
      win.addEventListener(type, onGesture, { passive: true, capture: true });
    }
  }

  /* ── speech ───────────────────────────────────────────────────────────────────────────────── */

  const synth: SpeechSynthesis | null =
    win !== null && 'speechSynthesis' in win && typeof win.SpeechSynthesisUtterance === 'function'
      ? win.speechSynthesis
      : null;

  let chosen: VoiceChoice<SpeechSynthesisVoice> | null = null;
  let live: SpeechSynthesisUtterance | null = null;
  let pending: { romaji: string; at: number } | null = null;
  let lastCountAtMs = 0;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  /**
   * `getVoices()` returns `[]` on the first call in every browser that loads its voice list
   * asynchronously (Chrome, and Safari on a cold start), and `voiceschanged` is the only signal that
   * it has filled in. Called once now for the browsers that answer immediately, and again on the
   * event — the list can also change mid-session when a system voice is installed.
   */
  function refreshVoices(): void {
    if (synth === null) return;
    let list: SpeechSynthesisVoice[] = [];
    try {
      list = synth.getVoices();
    } catch {
      return;
    }
    if (list.length === 0) return;
    chosen = pickVoice(list);
  }
  if (synth !== null) {
    refreshVoices();
    synth.addEventListener('voiceschanged', refreshVoices);
  }

  function clearWatchdog(): void {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  /**
   * Speak now, cancelling whatever is mid-word.
   *
   * `cancel()` first, always: the alternative is `speechSynthesis`'s own FIFO, which does not drop
   * anything, so a few seconds of stepping through counts leaves the voice minutes behind the
   * figure. One utterance at a time is the only policy that keeps sound and motion together.
   */
  function speakNow(romaji: string, prosody: Prosody): void {
    if (disposed || !enabled || !voiceOn || synth === null) return;
    const kana = toKana(romaji);
    const japanese = chosen?.japanese === true;
    /* A Japanese voice gets kana when the lexicon has the words for it, romaji when it does not —
     * an unmapped technique is still announced, just with a foreign accent. */
    const text = japanese && kana !== null ? kana : romaji;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (chosen !== null) {
        u.voice = chosen.voice;
        u.lang = chosen.voice.lang;
      }
      u.rate = prosody.rate;
      u.pitch = prosody.pitch;
      u.volume = volume;
      u.onend = (): void => {
        if (live !== u) return;
        live = null;
        clearWatchdog();
        flushPending();
      };
      u.onerror = (): void => {
        if (live !== u) return;
        live = null;
        pending = null;
        clearWatchdog();
      };
      synth.cancel();
      live = u;
      clearWatchdog();
      watchdog = setTimeout(() => {
        watchdog = null;
        if (live === u) live = null;
      }, SPEECH_WATCHDOG_MS);
      synth.speak(u);
    } catch {
      /* Safari throws from `speak()` when the page is not yet allowed to make sound. Not fatal. */
      live = null;
      clearWatchdog();
    }
  }

  /**
   * The technique name, once the count has finished saying itself.
   *
   * One slot, not a queue: if the next count arrives first the name is simply dropped. A dojo says
   * "hachi!" and then names the technique; it never says the name of a count you are already two
   * moves past.
   */
  function flushPending(): void {
    const p = pending;
    pending = null;
    if (p === null || disposed || !enabled) return;
    if (Date.now() - p.at > TECHNIQUE_STALE_MS) return;
    speakNow(p.romaji, NAME_PROSODY);
  }

  /* ── the surface ──────────────────────────────────────────────────────────────────────────── */

  function countIn(n: number): void {
    const romaji = countRomaji(n);
    if (romaji === null || disposed || !enabled || !voiceOn) return;
    const now = Date.now();
    if (now - lastCountAtMs < COUNT_MIN_GAP_MS) return;
    lastCountAtMs = now;
    /* The stashed name belongs to the count being replaced. It is stale by definition. */
    pending = null;
    speakNow(romaji, COUNT_PROSODY);
  }

  function technique(label: string): void {
    if (disposed || !enabled || !voiceOn) return;
    const { phrase } = parseBeatLabel(label);
    if (phrase === null) return;
    if (live !== null) {
      pending = { romaji: phrase, at: Date.now() };
      return;
    }
    speakNow(phrase, NAME_PROSODY);
  }

  function kiai(delayS = 0): void {
    const b = bus();
    if (b === null) return;
    scheduleKiai(b, b.ctx.currentTime + Math.max(0, delayS), 1);
  }

  function footfall(intensity = 1): void {
    const b = bus();
    if (b === null) return;
    scheduleFootfall(b, b.ctx.currentTime, intensity);
  }

  function giSnap(intensity = 1): void {
    const b = bus();
    if (b === null) return;
    scheduleGiSnap(b, b.ctx.currentTime, intensity);
  }

  /** One scheduling pass over a beat: count, name, step, kime, and the shout if this count has one. */
  function onBeatChange(
    label: string,
    kiaiOnThisBeat: boolean,
    opts?: { slotSeconds?: number },
  ): void {
    if (disposed) return;
    const { count, phrase } = parseBeatLabel(label);
    const slot = opts?.slotSeconds ?? DEFAULT_BEAT_S;
    /* The authored slots run 0.8 s (doc 02's F rows) to 2.5 s (the 270° turn). Anything outside that
     * is not a count length, so it is a caller mistake rather than an unusual kata — take the
     * default and stay in time instead of scheduling a kiai somewhere in the next minute. */
    const dur = Number.isFinite(slot) && slot >= 0.2 && slot <= 6 ? slot : DEFAULT_BEAT_S;

    if (count !== null) countIn(count);
    if (phrase !== null) technique(label);
    if (count === null) return; // ceremony: no step, no kime, no shout

    const b = bus();
    if (b === null) return;
    const t0 = b.ctx.currentTime;
    /* Step, then strike — doc 04's shape for a count, and the order the ear reads as one movement
     * rather than two. Close enough together that they overlap; never the other way round. */
    const kime = t0 + TECH_FIRE_FRAC * dur;
    scheduleFootfall(b, t0 + FOOT_LAND_FRAC * dur, 0.85);
    scheduleGiSnap(b, kime, 1);
    if (kiaiOnThisBeat) scheduleKiai(b, kime, 1);
  }

  function setEnabled(on: boolean): void {
    if (disposed || on === enabled) return;
    enabled = on;
    if (!on) {
      pending = null;
      live = null;
      clearWatchdog();
      try {
        synth?.cancel();
      } catch {
        /* cancel() on a synth mid-teardown; nothing to do about it and nothing to report. */
      }
    }
    applyGain();
    if (on && ensureCtx() !== null) void resume();
  }

  function applyGain(): void {
    if (master === null || ctx === null) return;
    const target = enabled ? volume : 0;
    /* Ramped, not assigned. A step on a gain node is a discontinuity, and a discontinuity is a click
     * — which is exactly the artefact the mute button exists to avoid. */
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.015);
  }

  function setVolume(v: number): void {
    volume = clamp01(v);
    applyGain();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    enabled = false;
    pending = null;
    live = null;
    clearWatchdog();
    if (win !== null) {
      for (const type of GESTURES) win.removeEventListener(type, onGesture, { capture: true });
    }
    if (synth !== null) {
      synth.removeEventListener('voiceschanged', refreshVoices);
      try {
        synth.cancel();
      } catch {
        /* see setEnabled */
      }
    }
    const c = ctx;
    ctx = null;
    master = null;
    sfxBus = null;
    if (c !== null) void c.close().catch(() => undefined);
  }

  return {
    countIn,
    technique,
    kiai,
    footfall,
    giSnap,
    onBeatChange,
    setEnabled,
    setVolume,
    get enabled(): boolean {
      return enabled;
    },
    get voiceName(): string | null {
      return chosen?.voice.name ?? null;
    },
    dispose,
  };
}
