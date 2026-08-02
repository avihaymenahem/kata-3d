/**
 * B8 UI — `src/ui/audio.ts`, the half of it that a machine can check.
 *
 * Sound is the one subsystem in this project that cannot be asserted by listening to it in CI, so
 * the module is written with everything decidable pushed into pure functions — the count tables, the
 * label parser, the kana lexicon, the voice ranking — and this file is where they get pinned down.
 * The remaining half (does the shout sound like a shout) is measured in a browser by rendering
 * `renderSfx` offline and reading peak/RMS/centroid off the buffer; see the run notes for B8 audio.
 *
 * Two things here are worth more than the rest:
 *
 *   * The lexicon is checked against the REAL compiled beats of both kata, so adding a technique to
 *     `src/data/kata/*.kata.ts` without a kana entry fails here rather than silently downgrading a
 *     Japanese voice to reading romaji.
 *   * `createKataAudio()` is constructed and driven UNDER NODE, where there is no `window`, no
 *     `AudioContext` and no `speechSynthesis`. That is the same shape as the headless capture path,
 *     and "degrades to a no-op" is only a claim until something calls every method with no browser.
 *
 * Imports `src/ui/audio` directly rather than through the barrel, exactly as
 * `tests/player/choreography.test.ts` does with `choreography`: the barrel also re-exports the HUD
 * and the transport strip, and a unit test of the count table has no business loading them.
 */

import { describe, expect, it } from 'vitest';

import { getKata } from '../../src/data';
import { buildBeats } from '../../src/player/choreography';
import {
  countKana,
  countRomaji,
  createKataAudio,
  parseBeatLabel,
  pickVoice,
  renderSfx,
  toKana,
  type SfxKind,
  type VoiceLike,
} from '../../src/ui/audio';
import type { KataId } from '../../src/contracts';

const KATA_IDS: readonly KataId[] = ['taikyoku-shodan', 'heian-shodan'];

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The count
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('counting in a dojo', () => {
  /**
   * The whole of 1..21, written out — 21 because that is Heian Shodan's last count and the first
   * version of this table stopped at 20. A generated expectation would reproduce whatever bug the
   * implementation has, and the interesting part of this table is precisely the irregular bits:
   * `shi` not `yon`, `shichi` not `nana`, `ku` not `kyuu`, and `nijuu` breaking the `juu`+unit rule.
   */
  const EXPECTED: readonly string[] = [
    'ichi', 'ni', 'san', 'shi', 'go', 'roku', 'shichi', 'hachi', 'ku', 'juu',
    'juuichi', 'juuni', 'juusan', 'juushi', 'juugo', 'juuroku', 'juushichi', 'juuhachi', 'juuku',
    'nijuu', 'nijuuichi',
  ];

  it('says every count 1..21 the way karate counts', () => {
    expect(Array.from({ length: 21 }, (_, i) => countRomaji(i + 1))).toEqual(EXPECTED);
  });

  it('keeps the on-readings in the ONES place, never yon / nana / kyuu', () => {
    for (const n of [4, 7, 9, 14, 17, 19, 24, 27, 29]) {
      expect(countRomaji(n), `count ${n}`).not.toMatch(/yon|nana|kyuu/);
    }
  });

  it('switches to yon / nana / kyuu in the TENS place, which is not the same rule', () => {
    expect(countRomaji(40)).toBe('yonjuu');
    expect(countRomaji(70)).toBe('nanajuu');
    expect(countRomaji(90)).toBe('kyuujuu');
    expect(countKana(40)).toBe('よんじゅう');
  });

  it('has kana for every count it has romaji for', () => {
    for (let n = 1; n <= 99; n++) {
      expect(countKana(n), `count ${n}`).not.toBeNull();
      /* The kana is the text a `ja` voice is actually handed — if any of it leaked latin the voice
       * would spell it out, which is the exact failure the kana table exists to prevent. */
      expect(countKana(n), `count ${n}`).not.toMatch(/[a-z]/i);
    }
  });

  it('builds the teens as juu + unit and the twenties as nijuu + unit', () => {
    for (let n = 11; n <= 19; n++) {
      expect(countRomaji(n)).toBe(`juu${countRomaji(n - 10)}`);
      expect(countKana(n)).toBe(`じゅう${countKana(n - 10)}`);
    }
    for (let n = 21; n <= 29; n++) {
      expect(countRomaji(n)).toBe(`nijuu${countRomaji(n - 20)}`);
      expect(countKana(n)).toBe(`にじゅう${countKana(n - 20)}`);
    }
    expect(countKana(20)).toBe('にじゅう');
  });

  it('returns null for anything that is not an integer count in range', () => {
    for (const n of [0, -1, 100, 1.5, NaN, Infinity, -0.0001]) {
      expect(countRomaji(n), String(n)).toBeNull();
      expect(countKana(n), String(n)).toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The label
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('reading a Beat.label', () => {
  it('splits a move into its count and its words', () => {
    expect(parseBeatLabel('1. hidari gedan-barai')).toEqual({
      count: 1,
      phrase: 'hidari gedan-barai',
    });
    expect(parseBeatLabel('20. migi chudan oi-zuki')).toEqual({
      count: 20,
      phrase: 'migi chudan oi-zuki',
    });
  });

  it('speaks the four ceremony phases that are commands', () => {
    expect(parseBeatLabel('rei in').phrase).toBe('rei');
    expect(parseBeatLabel('rei out').phrase).toBe('rei');
    expect(parseBeatLabel('yoi').phrase).toBe('yoi');
    expect(parseBeatLabel('yame').phrase).toBe('yame');
    expect(parseBeatLabel('attention').phrase).toBe('kiotsuke');
  });

  it('stays SILENT on the phases that are stage directions, not speech', () => {
    /* Nobody in a dojo says "settle". Saying it would be worse than saying nothing. */
    for (const label of ['announce', 'set', 'final hold', 'settle']) {
      expect(parseBeatLabel(label), label).toEqual({ count: null, phrase: null });
    }
  });

  it('accepts the raw CeremonyPhase id as well as the opened-up label', () => {
    expect(parseBeatLabel('REI_IN').phrase).toBe('rei');
    expect(parseBeatLabel('  Yame  ').phrase).toBe('yame');
  });

  it('accepts a label whose count has already been stripped', () => {
    expect(parseBeatLabel('hidari gedan-barai').count).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The kana lexicon
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('romaji -> kana', () => {
  it('joins a hyphenated compound and keeps the word break', () => {
    expect(toKana('hidari gedan-barai')).toBe('ひだり げだんばらい');
    expect(toKana('migi chudan oi-zuki')).toBe('みぎ ちゅうだん おいづき');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(toKana('  MIGI   JODAN-AGE-UKE ')).toBe('みぎ じょうだんあげうけ');
  });

  it('returns null — not a half-converted string — when a token is unknown', () => {
    expect(toKana('hidari mawashi-geri')).toBeNull();
    expect(toKana('')).toBeNull();
    expect(toKana('nonsense')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Against the real score — the test that stops the lexicon rotting
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('every beat of every kata is speakable', () => {
  for (const id of KATA_IDS) {
    const beats = buildBeats(getKata(id));

    it(`${id}: every move label yields its count and a kana technique name`, () => {
      const moves = beats.filter((b) => b.kind === 'move');
      expect(moves.length).toBeGreaterThan(0);
      const bad: string[] = [];
      for (const b of moves) {
        const { count, phrase } = parseBeatLabel(b.label);
        if (count !== b.n) bad.push(`${b.label}: parsed count ${String(count)}, want ${b.n}`);
        if (phrase === null) bad.push(`${b.label}: no phrase`);
        else if (countRomaji(b.n) === null) bad.push(`${b.label}: count ${b.n} out of range`);
        /* The one that will actually fire one day: a new technique in the kata data whose words are
         * not in TERM_KANA. The name still gets announced, but in romaji — so this is the warning
         * that the Japanese voice has quietly stopped saying it properly. */
        else if (toKana(phrase) === null) bad.push(`${b.label}: '${phrase}' has no kana`);
      }
      expect(bad).toEqual([]);
    });

    it(`${id}: the ceremony speaks exactly rei · yoi · yame · kiotsuke · rei`, () => {
      const spoken = beats
        .filter((b) => b.kind === 'ceremony')
        .map((b) => parseBeatLabel(b.label).phrase)
        .filter((p): p is string => p !== null);
      expect(spoken).toEqual(['rei', 'yoi', 'yame', 'kiotsuke', 'rei']);
      for (const p of spoken) expect(toKana(p), p).not.toBeNull();
    });

    it(`${id}: no ceremony phase is ever mistaken for a count`, () => {
      for (const b of beats.filter((x) => x.kind === 'ceremony')) {
        expect(parseBeatLabel(b.label).count, b.label).toBeNull();
      }
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Voice ranking
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('pickVoice', () => {
  const v = (name: string, lang: string, extra?: Partial<VoiceLike>): VoiceLike => ({
    name,
    lang,
    ...extra,
  });

  it('returns null when the platform offers no voices at all', () => {
    expect(pickVoice([])).toBeNull();
  });

  it('takes a Japanese voice over a default English one', () => {
    const chosen = pickVoice([
      v('Zira', 'en-US', { default: true, localService: true }),
      v('Haruka', 'ja-JP', { localService: true }),
    ]);
    expect(chosen?.voice.name).toBe('Haruka');
    expect(chosen?.japanese).toBe(true);
  });

  it('prefers a LOCAL Japanese voice over a network one', () => {
    /* A network voice goes silent offline and lags behind the figure on a slow link. */
    const chosen = pickVoice([
      v('Google 日本語', 'ja-JP', { localService: false, default: true }),
      v('Kyoko', 'ja-JP', { localService: true }),
    ]);
    expect(chosen?.voice.name).toBe('Kyoko');
  });

  it('accepts every spelling of the ja tag', () => {
    for (const lang of ['ja', 'ja-JP', 'ja_JP', 'JA-jp']) {
      expect(pickVoice([v('x', lang)])?.japanese, lang).toBe(true);
    }
    /* …and does not fall for a tag that merely starts with the letters. */
    for (const lang of ['jam', 'java', 'jv-ID']) {
      expect(pickVoice([v('x', lang)])?.japanese, lang).toBe(false);
    }
  });

  it('still returns a voice when no Japanese one exists, flagged as not Japanese', () => {
    /* The romaji fallback depends on this: no ja voice must mean an ACCENTED count, not silence. */
    const chosen = pickVoice([
      v('Zira', 'en-US', { localService: true }),
      v('Daniel', 'en-GB', { localService: true, default: true }),
    ]);
    expect(chosen).not.toBeNull();
    expect(chosen?.japanese).toBe(false);
    expect(chosen?.voice.name).toBe('Daniel');
  });

  it('will not hand romaji to a non-Latin-script engine, even the platform default one', () => {
    /* Not hypothetical — this is the voice list of the machine the module was built on, verbatim:
     * four voices, no Japanese, and the system default is Hebrew. Ranking on `default` first sends
     * "hidari gedan-barai" to a he-IL synthesiser. */
    const chosen = pickVoice([
      v('Microsoft Asaf - Hebrew (Israel)', 'he-IL', { localService: true, default: true }),
      v('Microsoft Mark - English (United States)', 'en-US', { localService: true }),
      v('Microsoft Zira - English (United States)', 'en-US', { localService: true }),
    ]);
    expect(chosen?.voice.lang).toBe('en-US');
    expect(chosen?.japanese).toBe(false);
  });

  it('still prefers a JAPANESE voice whatever its script or service', () => {
    /* The script rule is a fallback rule only. A ja voice is handed kana and outranks everything. */
    const chosen = pickVoice([
      v('Mark', 'en-US', { localService: true, default: true }),
      v('Google 日本語', 'ja-JP', { localService: false }),
    ]);
    expect(chosen?.voice.lang).toBe('ja-JP');
    expect(chosen?.japanese).toBe(true);
  });

  it('treats an unrecognised language tag as Latin rather than demoting it', () => {
    /* The denylist fails open on purpose — a language nobody listed ranks as it always did. */
    const chosen = pickVoice([
      v('Hebrew', 'he-IL', { localService: true, default: true }),
      v('Something', 'qq-QQ', {}),
    ]);
    expect(chosen?.voice.name).toBe('Something');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Degrading to nothing — this file runs with no window, no AudioContext, no speechSynthesis
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('with no browser at all', () => {
  it('has no browser at all (the premise of everything below)', () => {
    expect(typeof globalThis.window).toBe('undefined');
  });

  it('constructs silent and stays silent', () => {
    const a = createKataAudio();
    expect(a.enabled).toBe(false);
    expect(a.voiceName).toBeNull();
    a.dispose();
  });

  it('survives every method being called with nothing underneath it', () => {
    const a = createKataAudio({ enabled: true, volume: 1, voice: true });
    expect(() => {
      a.countIn(8);
      a.countIn(0);
      a.countIn(NaN);
      a.technique('8. migi chudan oi-zuki');
      a.technique('settle');
      a.kiai();
      a.kiai(0.34);
      a.footfall();
      a.footfall(0.3);
      a.giSnap();
      a.giSnap(0);
      a.onBeatChange('8. migi chudan oi-zuki', true, { slotSeconds: 0.8 });
      a.onBeatChange('yoi', false);
      a.onBeatChange('16. migi chudan oi-zuki', true, { slotSeconds: NaN });
      /* The mistake the options object exists to prevent, in the one form that still compiles. */
      a.onBeatChange('20. migi chudan oi-zuki', false, { slotSeconds: 19 });
      a.setVolume(2);
      a.setVolume(-1);
      a.setEnabled(false);
      a.setEnabled(true);
      a.dispose();
      /* Post-dispose calls are the ones a real teardown race actually makes. */
      a.kiai();
      a.onBeatChange('1. hidari gedan-barai', false);
      a.dispose();
    }).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The synthesis graph, against a recording stub
 *
 * There is no Web Audio in Node, so this cannot make a sound. What it CAN do is catch the failure
 * mode this code is actually prone to: `exponentialRampToValueAtTime` is a ratio ramp and throws
 * `RangeError` on a target of 0 — which is what an `intensity` of 0 would feed it if the envelopes
 * did not clamp. Every scheduled time is checked for sanity at the same time, because a NaN in a
 * `when` is silent in a way that is very hard to hear.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

interface ParamEvent {
  readonly kind: 'set' | 'exp' | 'lin' | 'target';
  readonly value: number;
  readonly time: number;
}

interface Recording {
  readonly params: ParamEvent[][];
  readonly sources: { start: number; stop: number }[];
  nodes: number;
}

function stubContext(rec: Recording): { ctx: unknown; out: unknown } {
  const param = (): AudioParam => {
    const events: ParamEvent[] = [];
    rec.params.push(events);
    const p = {
      value: 0,
      setValueAtTime: (value: number, time: number) => events.push({ kind: 'set', value, time }),
      exponentialRampToValueAtTime: (value: number, time: number) =>
        events.push({ kind: 'exp', value, time }),
      linearRampToValueAtTime: (value: number, time: number) =>
        events.push({ kind: 'lin', value, time }),
      setTargetAtTime: (value: number, time: number) => events.push({ kind: 'target', value, time }),
    };
    return p as unknown as AudioParam;
  };

  const node = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
    rec.nodes += 1;
    const n: Record<string, unknown> = {
      connect: (dest: unknown) => dest,
      disconnect: () => undefined,
      ...extra,
    };
    return n;
  };

  const ctx = {
    sampleRate: 48_000,
    currentTime: 0,
    createGain: () => node({ gain: param() }),
    createWaveShaper: () => node({ curve: null, oversample: 'none' }),
    createBiquadFilter: () =>
      node({ type: 'lowpass', frequency: param(), Q: param(), gain: param() }),
    createOscillator: () =>
      node({
        type: 'sine',
        frequency: param(),
        detune: param(),
        start: (t: number) => rec.sources.push({ start: t, stop: Infinity }),
        stop: (t: number) => {
          const last = rec.sources[rec.sources.length - 1];
          if (last !== undefined) last.stop = t;
        },
        onended: null,
      }),
    createBufferSource: () =>
      node({
        buffer: null,
        loop: false,
        start: (t: number) => rec.sources.push({ start: t, stop: Infinity }),
        stop: (t: number) => {
          const last = rec.sources[rec.sources.length - 1];
          if (last !== undefined) last.stop = t;
        },
        onended: null,
      }),
    createBuffer: (_ch: number, len: number, rate: number) => ({
      length: len,
      sampleRate: rate,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(len),
    }),
  };
  return { ctx, out: node() };
}

const KINDS: readonly SfxKind[] = ['kiai', 'gi-snap', 'footfall'];

describe('renderSfx builds a legal graph', () => {
  for (const kind of KINDS) {
    it(`${kind}: schedules real nodes with finite, ordered times`, () => {
      const rec: Recording = { params: [], sources: [], nodes: 0 };
      const { ctx, out } = stubContext(rec);
      expect(() =>
        renderSfx(kind, ctx as BaseAudioContext, out as AudioNode, 0, 1),
      ).not.toThrow();

      expect(rec.nodes, 'built no nodes at all').toBeGreaterThan(2);
      expect(rec.sources.length, 'scheduled no sources').toBeGreaterThan(0);

      for (const s of rec.sources) {
        expect(Number.isFinite(s.start)).toBe(true);
        expect(s.stop).toBeGreaterThan(s.start);
      }
      for (const events of rec.params) {
        let prev = -Infinity;
        for (const e of events) {
          expect(Number.isFinite(e.time), `${kind}: non-finite time`).toBe(true);
          expect(e.time).toBeGreaterThanOrEqual(prev);
          prev = e.time;
          expect(Number.isFinite(e.value), `${kind}: non-finite value`).toBe(true);
          /* The RangeError that Web Audio actually throws. */
          if (e.kind === 'exp') expect(e.value, `${kind}: exponential ramp to 0`).toBeGreaterThan(0);
        }
      }
    });

    it(`${kind}: survives intensity 0, where a naive envelope would ramp to zero`, () => {
      const rec: Recording = { params: [], sources: [], nodes: 0 };
      const { ctx, out } = stubContext(rec);
      expect(() => renderSfx(kind, ctx as BaseAudioContext, out as AudioNode, 0, 0)).not.toThrow();
      for (const events of rec.params) {
        for (const e of events) if (e.kind === 'exp') expect(e.value).toBeGreaterThan(0);
      }
    });

    it(`${kind}: is over inside half a second`, () => {
      /* A count at the fastest authored tempo is 0.8 s long (doc 02's F rows, counts 8 and 16). A
       * sound effect that outlasts its own count would still be ringing under the next one. */
      const rec: Recording = { params: [], sources: [], nodes: 0 };
      const { ctx, out } = stubContext(rec);
      renderSfx(kind, ctx as BaseAudioContext, out as AudioNode, 0, 1);
      const last = Math.max(...rec.sources.map((s) => s.stop));
      expect(last).toBeLessThanOrEqual(0.5);
    });
  }
});
