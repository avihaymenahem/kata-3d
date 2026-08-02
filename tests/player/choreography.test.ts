/**
 * B6 PLAYER — the kata score as a playable timeline.
 *
 * Imports `src/player/choreography` DIRECTLY rather than through the block barrel, on purpose: the
 * barrel pulls `./character`, which pulls `GLTFLoader`. This module's only runtime imports are
 * `../contracts`, `../data` and `../solve` — all Node-safe — because its dependency on `Character`
 * is `import type`, and type imports are erased. So the layout is checkable with no renderer, no
 * GLB and no DOM, which is what makes it worth checking at all.
 */

import { describe, expect, it } from 'vitest';

import { getKata } from '../../src/data';
import {
  CLIP_FOR_TECHNIQUE,
  MODEL_FACING_OFFSET_RAD,
  TECHNIQUE_SOURCE,
  buildBeats,
  checkYawChain,
} from '../../src/player/choreography';
import type { KataId, TechniqueId } from '../../src/contracts';

const KATA_IDS: readonly KataId[] = ['taikyoku-shodan', 'heian-shodan'];

const TECHNIQUE_IDS: readonly TechniqueId[] = [
  'none', 'gedan-barai', 'age-uke', 'soto-uke', 'uchi-uke', 'shuto-uke',
  'choku-zuki', 'oi-zuki', 'gyaku-zuki', 'tettsui-tate-mawashi',
];

describe('the dHeadingDeg chain', () => {
  /* The load-bearing one. Yaw is accumulated from the signed per-move deltas so that Taikyoku's
   * 180° turns rotate the authored way instead of whichever way a shortest-arc tie breaks. That is
   * only safe while the running sum still agrees with every authored ABSOLUTE heading — one wrong
   * delta silently rotates the entire remainder of the kata. */
  for (const id of KATA_IDS) {
    it(`${id}: every accumulated yaw matches the authored headingDeg, mod 360`, () => {
      expect(checkYawChain(getKata(id))).toEqual([]);
    });
  }
});

describe('beat layout', () => {
  for (const id of KATA_IDS) {
    const kata = getKata(id);
    const beats = buildBeats(kata);

    it(`${id}: one beat per ceremony phase and per count`, () => {
      expect(beats.filter((b) => b.kind === 'move')).toHaveLength(kata.moves.length);
      expect(beats.filter((b) => b.kind === 'ceremony')).toHaveLength(
        kata.openingCeremony.length + kata.closingCeremony.length,
      );
    });

    it(`${id}: beats tile the timeline with no gap or overlap`, () => {
      for (let i = 1; i < beats.length; i++) {
        expect(beats[i]!.startS).toBeCloseTo(beats[i - 1]!.startS + beats[i - 1]!.durS, 9);
      }
      expect(beats[0]!.startS).toBe(0);
    });

    it(`${id}: counts are strictly ordered and every duration is positive`, () => {
      const counts = beats.filter((b) => b.kind === 'move').map((b) => b.n);
      expect(counts).toEqual(kata.moves.map((m) => m.n));
      for (const b of beats) expect(b.durS).toBeGreaterThan(0);
    });

    it(`${id}: kiai land on the counts doc 02 declares`, () => {
      expect(beats.filter((b) => b.kiai).map((b) => b.n)).toEqual([...kata.kiaiAt]);
    });

    it(`${id}: every count carries a clip, every ceremony phase carries none`, () => {
      for (const b of beats) {
        if (b.kind === 'move') expect(b.techClip).not.toBeNull();
        else expect(b.techClip).toBeNull();
      }
    });

    it(`${id}: every ceremony phase shares one spot, facing shomen`, () => {
      const ceremony = beats.filter((x) => x.kind === 'ceremony');
      const first = ceremony[0]!;
      for (const b of ceremony) {
        expect(b.x).toBeCloseTo(first.x, 9);
        expect(b.z).toBeCloseTo(first.z, 9);
        expect(b.yawRad).toBe(MODEL_FACING_OFFSET_RAD);
      }
    });

    /* The dojo paints a 4.68 m embusen marking at the world origin. doc 02 authors coordinates from
     * the kata's STARTING point — a corner of the pattern, not its middle — so the layout is
     * re-centred. Without it Taikyoku walks ~1.9 m off the far edge of its own marking. */
    it(`${id}: the floor pattern is centred on the dojo's embusen marking`, () => {
      const moves = beats.filter((b) => b.kind === 'move');
      const xs = moves.map((b) => b.x);
      const zs = moves.map((b) => b.z);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 9);
      expect((Math.min(...zs) + Math.max(...zs)) / 2).toBeCloseTo(0, 9);
    });

    it(`${id}: the whole pattern fits inside the 4.68 m marking`, () => {
      const half = 4.68 / 2;
      for (const b of beats.filter((x) => x.kind === 'move')) {
        expect(Math.abs(b.x), `count ${b.n} x`).toBeLessThanOrEqual(half);
        expect(Math.abs(b.z), `count ${b.n} z`).toBeLessThanOrEqual(half);
      }
    });
  }
});

describe('the embusen it walks', () => {
  /* doc 02 §4.1: Taikyoku Shodan's floor pattern is a capital I — two bars joined by a stem, walked
   * top bar, down the stem, bottom bar, back up, top bar. Asserted as SHAPE rather than as twenty
   * coordinates, so the test survives a legitimate re-authoring of the score but still fails if the
   * handedness conversion or the `L` scaling regresses. */
  const beats = buildBeats(getKata('taikyoku-shodan')).filter((b) => b.kind === 'move');
  const at = (n: number) => beats.find((b) => b.n === n)!;

  it('counts 1-4 stay on the top bar', () => {
    const z1 = at(1).z;
    for (const n of [2, 3, 4]) expect(at(n).z).toBeCloseTo(z1, 9);
  });

  it('counts 5-8 walk down the stem, count 8 furthest out', () => {
    const zs = [5, 6, 7, 8].map((n) => at(n).z);
    for (let i = 1; i < zs.length; i++) expect(zs[i]!).toBeLessThan(zs[i - 1]!);
    expect(at(8).kiai).toBe(true);
  });

  it('counts 9-12 stay on the bottom bar', () => {
    const z9 = at(9).z;
    for (const n of [10, 11, 12]) expect(at(n).z).toBeCloseTo(z9, 9);
    expect(z9).toBeLessThan(at(1).z);
  });

  it('counts 13-16 walk back up the stem to the second kiai', () => {
    const zs = [13, 14, 15, 16].map((n) => at(n).z);
    for (let i = 1; i < zs.length; i++) expect(zs[i]!).toBeGreaterThan(zs[i - 1]!);
    expect(at(16).kiai).toBe(true);
  });

  it('ends back on the top bar where it began', () => {
    expect(at(17).z).toBeCloseTo(at(1).z, 9);
    expect(at(17).x).toBeCloseTo(at(1).x, 9);
    expect(at(20).x).toBeCloseTo(at(4).x, 9);
  });

  it('stays inside a real dojo footprint', () => {
    const xs = beats.map((b) => b.x);
    const zs = beats.map((b) => b.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(4);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(6);
  });
});

describe('the clip table', () => {
  it('maps every technique doc 02 can author', () => {
    for (const t of TECHNIQUE_IDS) {
      expect(CLIP_FOR_TECHNIQUE[t], `no clip for '${t}'`).toBeTruthy();
    }
  });

  it('covers exactly the TechniqueId union — no stale keys', () => {
    expect(Object.keys(CLIP_FOR_TECHNIQUE).sort()).toEqual([...TECHNIQUE_IDS].sort());
  });

  /* Not a style check. Every clip named here has to exist by the time the kata plays, and a typo
   * degrades to `play()` returning null — the technique silently never fires and the figure keeps
   * walking. The mocap names are registered at boot by `MOCAP_CLIPS`, not declared in the glTF, so
   * they are listed explicitly; if that list and this one drift, this test is the alarm. */
  it('names no clip outside the vendored library or the retargeted mocap', () => {
    const MOCAP = ['heian-nidan', 'karate', 'mocap-oi-zuki', 'mocap-gedan-barai'];
    const AVAILABLE = new Set([
      ...MOCAP,
      'A_TPose', 'Crouch_Fwd_Loop', 'Crouch_Idle_Loop', 'Dance_Loop', 'Death01', 'Driving_Loop',
      'Fixing_Kneeling', 'Hit_Chest', 'Hit_Head', 'Idle_Loop', 'Idle_Talking_Loop',
      'Idle_Torch_Loop', 'Interact', 'Jog_Fwd_Loop', 'Jump_Land', 'Jump_Loop', 'Jump_Start',
      'PickUp_Table', 'Pistol_Aim_Down', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Idle_Loop',
      'Pistol_Reload', 'Pistol_Shoot', 'Punch_Cross', 'Punch_Enter', 'Punch_Jab', 'Push_Loop',
      'Roll', 'Roll_RM', 'Sitting_Enter', 'Sitting_Exit', 'Sitting_Idle_Loop',
      'Sitting_Talking_Loop', 'Spell_Simple_Enter', 'Spell_Simple_Exit', 'Spell_Simple_Idle_Loop',
      'Spell_Simple_Shoot', 'Sprint_Loop', 'Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Sword_Attack',
      'Sword_Attack_RM', 'Sword_Idle', 'Walk_Formal_Loop', 'Walk_Loop',
    ]);
    for (const [tech, clip] of Object.entries(CLIP_FOR_TECHNIQUE)) {
      expect(AVAILABLE.has(clip), `${tech} -> '${clip}' is neither vendored nor mocap`).toBe(true);
    }
  });

  /* The provenance badges in the HUD are only worth anything if they cannot drift from the clip
   * table they claim to describe. A technique pointing at a `mocap-*` clip while still labelled
   * `standin` would under-report progress; the reverse would claim work that was never done. */
  it('every technique has a provenance, and it matches the clip it points at', () => {
    for (const t of TECHNIQUE_IDS) {
      const src = TECHNIQUE_SOURCE[t];
      expect(src, `no provenance for '${t}'`).toBeTruthy();
      const clip = CLIP_FOR_TECHNIQUE[t];
      if (clip.startsWith('mocap-')) {
        expect(src, `'${t}' plays ${clip} but is labelled '${src}'`).toBe('mocap');
      } else if (src === 'mocap' && t !== 'none') {
        expect.fail(`'${t}' is labelled 'mocap' but plays the library clip '${clip}'`);
      }
    }
  });
});
