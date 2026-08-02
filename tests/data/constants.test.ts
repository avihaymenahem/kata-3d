/**
 * tests/data/constants.test.ts — B1's provenance gate.
 *
 * OWNERSHIP B1: "every `Num` has a resolvable `src`; units match field suffixes".
 *
 * "Resolvable" is enforced against the MARKDOWN ON DISK, not against a regex: every citation is
 * split into `{ file, section }` and both must exist — the file as a real doc, the section as a real
 * heading inside it. That is the half of `tools/verify-constants.mjs` that does not need the tool:
 * B9's verifier greps the cited section for the literal VALUE, this test proves the section the
 * verifier is about to grep is actually there. A citation that points at a section that does not
 * exist is the failure mode the whole `Num` design exists to prevent, and it is invisible until
 * something tries to follow the anchor.
 *
 * The docs are read through `import.meta.glob(..., { query: '?raw' })` for the same reason
 * `tests/contracts/imports.test.ts` does: the orchestrator-owned tsconfig sets
 * `types: ["vite/client"]` with no `@types/node`, and adding a dependency is forbidden.
 */

import { describe, expect, it } from 'vitest';
import * as DATA from '../../src/data';
import {
  DISPUTES,
  DISPUTE_COUNT,
  SUFFIX_EXEMPT,
  SUFFIX_UNITS,
  collectNums,
  isAltNum,
  parseSrc,
  type NumEntry,
} from '../../src/data/num';
import { BONE_ORDER, CHANNEL_ORDER, TAUP_MONOTONE_CHAIN } from '../../src/contracts';
import { ROM, ROM_MID_JOINTS, ROM_SIGNED, ROM_BLOCK_TOTALS } from '../../src/data/constants/rom';

/* ── the docs, as raw text ─────────────────────────────────────────────────────────────────── */

const RAW_DOCS = import.meta.glob('/docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const DOCS: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_DOCS).map(([k, v]) => [k.replace(/^\//, ''), v]),
);

/**
 * True iff `file` carries a markdown heading that opens section `section`. Headings in this project
 * are numbered (`## 10. Copy-paste constant block`, `### 3.1 Footprint`, `### 7.B Named half
 * stances`), so the test is "some `#…#` line begins with that number".
 */
function hasSection(file: string, section: string): boolean {
  const body = DOCS[file];
  if (body === undefined) return false;
  const esc = section.replace(/\./g, '\\.');
  const re = new RegExp(`^#{1,6}\\s+${esc}(?:[.\\s]|$)`, 'm');
  return re.test(body);
}

/**
 * The full set of `Num`s reachable from the barrel, with a dotted path. Only own enumerable
 * exports are walked; `collectNums` recurses through frozen object literals and arrays.
 */
const ALL_NUMS: readonly NumEntry[] = collectNums(DATA);

/* ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the walk itself', () => {
  it('reaches the docs and a substantial number of Nums', () => {
    expect(Object.keys(DOCS).length, 'docs/**/*.md must be readable').toBeGreaterThan(5);
    expect(DOCS['docs/research/01-stances.md']).toBeTruthy();
    expect(ALL_NUMS.length, 'the barrel must expose hundreds of cited numbers').toBeGreaterThan(250);
  });

  it('every barrel export named in §3.13 exists', () => {
    for (const name of [
      'ANTHRO', 'JOINT_Y', 'LIMB_R', 'SEG_MASS',
      'STANCES', 'FIGHT_PELVIS_Y', 'mirrorStance',
      'TECHNIQUES', 'HIKITE_HIP_A', 'HIKITE_TATE_B', 'TARGET_H', 'HAND_SHAPE_ANGLES',
      'DYN', 'CHANNEL_DYN', 'SETTLE', 'TEMPO_CLASSES', 'PAUSE_CLASSES', 'TEMPO_SCALE',
      'ROM', 'CLOTH', 'GARMENTS',
      'LIGHTS', 'SHADOW', 'POST', 'MATERIAL_PARAMS', 'ENV',
      'CAMERA_PRESET_PARAMS',
      'L_H', 'L_M', 'EMB_H_H', 'ZENKUTSU_HEEL_TO_HEEL_H', 'PELVIS_AHEAD_OF_C_H',
      'footPlanFor', 'embusenPolyline', 'assertEmbusenInvariants',
      'getKata',
    ]) {
      expect(name in DATA, `barrel must export ${name}`).toBe(true);
    }
  });
});

describe('OWNERSHIP B1 — every Num has a RESOLVABLE src anchor', () => {
  it('every src parses into { file, section }', () => {
    const bad = ALL_NUMS.filter((e) => parseSrc(e.num.src) === null);
    expect(bad.map((e) => `${e.path}: '${e.num.src}'`)).toEqual([]);
  });

  it('every cited file exists on disk', () => {
    const bad = ALL_NUMS.filter((e) => {
      const a = parseSrc(e.num.src);
      return a === null || DOCS[a.file] === undefined;
    });
    expect(bad.map((e) => `${e.path}: ${e.num.src}`)).toEqual([]);
  });

  it('every cited SECTION exists as a heading in that file', () => {
    const bad = ALL_NUMS.filter((e) => {
      const a = parseSrc(e.num.src);
      return a === null || !hasSection(a.file, a.section);
    });
    expect(bad.map((e) => `${e.path}: ${e.num.src}`)).toEqual([]);
  });

  it('every AltNum alt carries a resolvable src too', () => {
    const bad: string[] = [];
    for (const e of ALL_NUMS) {
      if (!isAltNum(e.num)) continue;
      for (const alt of e.num.alt) {
        const a = parseSrc(alt.src);
        if (a === null || !hasSection(a.file, a.section)) bad.push(`${e.path} alt '${alt.label}': ${alt.src}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every citation points at docs/research or docs/ARCHITECTURE.md, and never at a proposal', () => {
    const bad = ALL_NUMS.filter((e) => {
      const a = parseSrc(e.num.src);
      if (a === null) return true;
      return !(a.file.startsWith('docs/research/') || a.file === 'docs/ARCHITECTURE.md');
    });
    expect(bad.map((e) => `${e.path}: ${e.num.src}`)).toEqual([]);
  });

  it('only ART / DERIVED values may cite docs/ARCHITECTURE.md — a FACT must cite a research doc', () => {
    // §2.6: research docs win on FACTS, ARCHITECTURE wins on DECISIONS. A MEASURED or TRAD value
    // citing the plan would mean the plan invented a fact.
    const bad = ALL_NUMS.filter(
      (e) => e.num.src.startsWith('docs/ARCHITECTURE.md') && (e.num.conf === 'MEASURED' || e.num.conf === 'TRAD'),
    );
    expect(bad.map((e) => `${e.path}: ${e.num.conf} cites the plan`)).toEqual([]);
  });

  it('every conf is one of the four classes, and every tol is finite and non-negative', () => {
    const bad: string[] = [];
    for (const e of ALL_NUMS) {
      if (!['MEASURED', 'TRAD', 'DERIVED', 'ART'].includes(e.num.conf)) bad.push(`${e.path}: conf ${e.num.conf}`);
      if (!Number.isFinite(e.num.tol) || e.num.tol < 0) bad.push(`${e.path}: tol ${e.num.tol}`);
      if (!Number.isFinite(e.num.v)) bad.push(`${e.path}: v ${e.num.v}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('§2.2 — units match field suffixes', () => {
  /**
   * The rule applies to INTERFACE-STYLE field names (camelCase, no underscore, not a SCREAMING_
   * SNAKE table key). §2.2 is about "every numeric field name in a frozen interface"; a constant
   * table key such as `LEN_FOREARM` ends in `M` without being a length in metres, so applying the
   * suffix rule to it would be a false positive by construction.
   */
  const isFieldName = (k: string) => /^[A-Za-z][A-Za-z0-9]*$/.test(k) && !/^[A-Z0-9]+$/.test(k);
  /** Longest suffix wins: `omegaPsiDegS` is `deg/s`, not `s`. */
  const SUFFIXES = [...SUFFIX_UNITS].sort((a, b) => b.suffix.length - a.suffix.length);

  it('no Num field contradicts its own suffix', () => {
    const bad: string[] = [];
    for (const e of ALL_NUMS) {
      const key = e.path.split('.').pop()!.replace(/\[\d+\]$/, '');
      if (!isFieldName(key) || SUFFIX_EXEMPT.includes(key)) continue;
      const hit = SUFFIXES.find((s) => key.endsWith(s.suffix));
      if (hit && !hit.units.includes(e.num.unit)) {
        bad.push(`${e.path}: suffix '${hit.suffix}' wants ${hit.units.join('|')}, carries '${e.num.unit}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the two frozen field names whose suffix lies carry the truth on the Num', () => {
    // §3.8: `vPkMs` is doc 04 §10's `v_pk`, a speed in m/s. `Ms` there is NOT milliseconds.
    for (const [key, row] of Object.entries(DATA.DYN)) {
      expect(row.vPkMs.unit, `DYN.${key}.vPkMs`).toBe('m/s');
      expect(row.TtechS.unit).toBe('s');
      expect(row.TthrustS.unit).toBe('s');
      expect(row.TkimeS.unit).toBe('s');
      expect(row.omegaPsiDegS.unit).toBe('deg/s');
      expect(row.dPsiDeg.unit).toBe('deg');
    }
    // SETTLE[*].ampFracL is per-channel: a path fraction, an angle, or a height.
    expect(DATA.SETTLE.fist.ampFracL.unit).toBe('ratio');
    expect(DATA.SETTLE.pelvis.ampFracL.unit).toBe('deg');
    expect(DATA.SETTLE.comY.ampFracL.unit).toBe('H');
    expect(DATA.SETTLE.obi.ampFracL.unit).toBe('H');
    for (const row of Object.values(DATA.SETTLE)) expect(row.omegaN.unit).toBe('rad/s');
  });
});

describe('§2.5 — all fourteen disputes ship as AltNums', () => {
  it('DISPUTES has exactly 14 rows with unique ids D01..D14', () => {
    expect(DISPUTES).toHaveLength(DISPUTE_COUNT);
    const ids = DISPUTES.map((d) => d.id);
    expect(new Set(ids).size).toBe(DISPUTE_COUNT);
    for (let i = 1; i <= DISPUTE_COUNT; i++) {
      expect(ids, `D${String(i).padStart(2, '0')} must exist`).toContain(
        `D${String(i).padStart(2, '0')}`,
      );
    }
  });

  it('every disputeId that ships on an AltNum is one of the 14, and each has >= 1 alt', () => {
    const shipped = new Set<string>();
    for (const e of ALL_NUMS) {
      if (!isAltNum(e.num)) continue;
      shipped.add(e.num.disputeId);
      expect(e.num.alt.length, `${e.path} (${e.num.disputeId}) needs at least one alt`).toBeGreaterThan(0);
      for (const alt of e.num.alt) {
        expect(alt.v, `${e.path}: an alt must differ from the shipped value`).not.toBe(e.num.v);
        expect(alt.label.length).toBeGreaterThan(0);
      }
    }
    for (const id of shipped) {
      expect(DISPUTES.map((d) => d.id), `${id} must be enumerated in DISPUTES`).toContain(id);
    }
  });

  it('every one of the 14 disputes is actually reachable as an AltNum through the barrel', () => {
    const shipped = new Set(
      ALL_NUMS.flatMap((e) => (isAltNum(e.num) ? [e.num.disputeId as string] : [])),
    );
    const missing = DISPUTES.filter((d) => !shipped.has(d.id)).map((d) => `${d.id} (${d.knob})`);
    expect(missing).toEqual([]);
  });

  it('the six disputes ARCHITECTURE §2.5 names by number ship the value §2.5 resolves to', () => {
    expect(DATA.STANCES.zenkutsu.loadFront.v, 'D01 — 59 % front').toBe(59);
    expect(DATA.AGE_UKE_FOREARM_INCL_DEG.v, 'D03 — 25 deg').toBe(25);
    expect(DATA.TECHNIQUES['soto-uke-chudan']!.elbowIncludedDeg.v, 'D04 — included, not 90').toBe(62);
    expect(DATA.STANCES.zenkutsu.yawRear.v, 'D05 — 30 deg').toBe(30);
    expect(DATA.STANCES.zenkutsu.pelvisYawHanmi.v, 'D06 — 45 deg').toBe(45);
    expect(DATA.MATERIAL_PARAMS.M_GI!.sheen!.v, 'D09 — sheen 0.45').toBe(0.45);
  });
});

describe('the ROM exemption (OWNERSHIP B1) behaves exactly as documented', () => {
  it('ROM is total over BONE_ORDER and every group carries a doc-cited src', () => {
    for (const b of BONE_ORDER) {
      expect(ROM[b], b).toBeDefined();
      const a = parseSrc(ROM_SIGNED[b].src);
      expect(a, `${b}: '${ROM_SIGNED[b].src}'`).not.toBeNull();
      expect(hasSection(a!.file, a!.section), `${b}: ${ROM_SIGNED[b].src}`).toBe(true);
    }
  });

  it('every cone semi-axis is the SMALLER magnitude of its two signed limits', () => {
    for (const b of BONE_ORDER) {
      const s = ROM_SIGNED[b];
      expect(ROM[b].swingConeXDeg, `${b} swing1`).toBe(
        Math.min(Math.abs(s.swing1.minDeg), Math.abs(s.swing1.maxDeg)),
      );
      expect(ROM[b].swingConeZDeg, `${b} swing2`).toBe(
        Math.min(Math.abs(s.swing2.minDeg), Math.abs(s.swing2.maxDeg)),
      );
      expect(ROM[b].twistMinDeg).toBe(s.twist.minDeg);
      expect(ROM[b].twistMaxDeg).toBe(s.twist.maxDeg);
    }
  });

  it('the four MID joints have a near-zero cone — the documented landmine S12 must skip', () => {
    expect([...ROM_MID_JOINTS].sort()).toEqual(['calf_L', 'calf_R', 'lowerarm_L', 'lowerarm_R']);
    // Knee: doc 06 §3.1 `0 / -140`, "hyperextension hard-locked at 0" => cone 0.
    expect(ROM.calf_L.swingConeXDeg).toBe(0);
    expect(ROM_SIGNED.calf_L.swing1).toEqual({ minDeg: -140, maxDeg: 0 });
    // Elbow: doc 06 §3.1 `+3 / -152` => cone 3.
    expect(ROM.lowerarm_L.swingConeXDeg).toBe(3);
    expect(ROM_SIGNED.lowerarm_L.swing1).toEqual({ minDeg: -152, maxDeg: 3 });
    // And the real flexion ranges are available for TwoBoneArgs.midMin/MaxDeg.
    expect(DATA.MID_JOINT_SIGNED_DEG.knee!.minDeg).toBe(-140);
    expect(DATA.MID_JOINT_SIGNED_DEG.elbow!.minDeg).toBe(-152);
    // root and ribcage join them on the exempt list.
    expect(DATA.ROM_CLAMP_EXEMPT).toContain('root');
    expect(DATA.ROM_CLAMP_EXEMPT).toContain('ribcage');
  });

  it('doc 06 §3.1 validates AS A BLOCK: the spine and neck sums are its own totals', () => {
    const spine = ['spine_01', 'spine_02', 'spine_03', 'chest'] as const;
    const sum = (f: (b: (typeof spine)[number]) => number) => spine.reduce((a, b) => a + f(b), 0);
    expect(sum((b) => ROM_SIGNED[b].swing1.maxDeg)).toBe(ROM_BLOCK_TOTALS.thoracoLumbarFlexDeg);
    expect(sum((b) => -ROM_SIGNED[b].swing1.minDeg)).toBe(ROM_BLOCK_TOTALS.thoracoLumbarExtDeg);
    expect(sum((b) => ROM_SIGNED[b].swing2.maxDeg)).toBe(ROM_BLOCK_TOTALS.thoracoLumbarLatDeg);
    expect(sum((b) => ROM_SIGNED[b].twist.maxDeg)).toBe(ROM_BLOCK_TOTALS.thoracoLumbarRotDeg);

    const cerv = ['neck_01', 'head'] as const;
    const csum = (f: (b: (typeof cerv)[number]) => number) => cerv.reduce((a, b) => a + f(b), 0);
    expect(csum((b) => ROM_SIGNED[b].swing1.maxDeg)).toBe(ROM_BLOCK_TOTALS.cervicalFlexDeg);
    expect(csum((b) => -ROM_SIGNED[b].swing1.minDeg)).toBe(ROM_BLOCK_TOTALS.cervicalExtDeg);
    expect(csum((b) => ROM_SIGNED[b].swing2.maxDeg)).toBe(ROM_BLOCK_TOTALS.cervicalLatDeg);
    expect(csum((b) => ROM_SIGNED[b].twist.maxDeg)).toBe(ROM_BLOCK_TOTALS.cervicalRotDeg);
  });

  it('the forearm chain can reach the >= 180 deg of pronation doc 06 §3.1 requires', () => {
    const total =
      ROM.lowerarm_twist_01_L.twistMaxDeg -
      ROM.lowerarm_twist_01_L.twistMinDeg;
    expect(total).toBeGreaterThanOrEqual(ROM_BLOCK_TOTALS.forearmTotalRequiredDeg - 7);
    expect(ROM.hand_L.twistMaxDeg).toBe(85);
    expect(ROM.hand_L.twistMinDeg).toBe(-88);
  });

  it('every ROM cone is finite, non-negative, and its twist range is ordered', () => {
    for (const b of BONE_ORDER) {
      const l = ROM[b];
      expect(l.swingConeXDeg, b).toBeGreaterThanOrEqual(0);
      expect(l.swingConeZDeg, b).toBeGreaterThanOrEqual(0);
      expect(l.twistMinDeg, b).toBeLessThanOrEqual(l.twistMaxDeg);
    }
  });

  it('ROM_PERP_AXES names two axes perpendicular to the primary axis, never the primary itself', () => {
    for (const b of BONE_ORDER) {
      const [a1, a2] = DATA.ROM_PERP_AXES[b];
      expect(a1, b).not.toBe(a2);
      expect(['x', 'y', 'z']).toContain(a1);
      expect(['x', 'y', 'z']).toContain(a2);
    }
    // Spot-check one bone per axis family (see rom.ts note 1).
    expect(DATA.ROM_PERP_AXES.thigh_L).toEqual(['x', 'z']); // primary -Y
    expect(DATA.ROM_PERP_AXES.upperarm_L).toEqual(['y', 'z']); // primary +X
    expect(DATA.ROM_PERP_AXES.foot_L).toEqual(['x', 'y']); // primary -Z
  });
});

describe('doc 04 §11 — the channel contract stage S6 asserts', () => {
  it('every ChannelId has a row, including the one doc 04 §11 omits', () => {
    for (const c of CHANNEL_ORDER) expect(DATA.CHANNEL_DYN[c], c).toBeDefined();
  });

  it('invariant 1: leads descend strictly proximal -> distal, and wristLock is still positive', () => {
    const order = ['rearFootDrive', 'pelvisYaw', 'thoraxYaw', 'shoulderGirdle', 'elbowExtend', 'wristLock'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(DATA.CHANNEL_DYN[order[i]!].leadMs.v).toBeLessThanOrEqual(
        DATA.CHANNEL_DYN[order[i - 1]!].leadMs.v,
      );
    }
    expect(DATA.CHANNEL_DYN.wristLock.leadMs.v).toBeGreaterThan(0);
  });

  it('invariant 2 is the SPAN: monotone along TAUP_MONOTONE_CHAIN, min at rearFootDrive', () => {
    for (let i = 1; i < TAUP_MONOTONE_CHAIN.length; i++) {
      expect(DATA.CHANNEL_DYN[TAUP_MONOTONE_CHAIN[i]!].tauP.v).toBeGreaterThanOrEqual(
        DATA.CHANNEL_DYN[TAUP_MONOTONE_CHAIN[i - 1]!].tauP.v,
      );
    }
    const min = Math.min(...Object.values(DATA.CHANNEL_DYN).map((c) => c.tauP.v));
    expect(min).toBe(DATA.CHANNEL_DYN.rearFootDrive.tauP.v);
    expect(min).toBeCloseTo(0.3, 6);
  });

  it('doc 04 §2.3: the hikite LEADS the punching shoulder by 14..20 ms', () => {
    const lead = DATA.CHANNEL_DYN.hikite.leadMs.v - DATA.CHANNEL_DYN.shoulderGirdle.leadMs.v;
    expect(lead).toBeGreaterThanOrEqual(14);
    expect(lead).toBeLessThanOrEqual(20);
  });

  it('doc 04 §10: every DYN row has T_thrust < T_tech, and a *zuki* row carries 0.13 s', () => {
    for (const [key, r] of Object.entries(DATA.DYN)) {
      expect(r.TthrustS.v, key).toBeLessThan(r.TtechS.v);
    }
    const zuki = Object.entries(DATA.DYN).filter(([k]) => k.includes('zuki'));
    expect(zuki.length).toBeGreaterThan(0);
    expect(zuki.some(([, r]) => Math.abs(r.TthrustS.v - 0.13) < 1e-9)).toBe(true);
    // BRIEFS: choku-zuki keeps its MEASURED 0.10 — do not "fix" it to 0.13.
    expect(DATA.DYN['choku-zuki']!.TthrustS.v).toBe(0.1);
    expect(DATA.DYN['choku-zuki']!.TthrustS.conf).toBe('MEASURED');
  });

  it('every DYN row shares the 0.340 s reference channel table, so nothing double-scales', () => {
    for (const [key, r] of Object.entries(DATA.DYN)) {
      expect(r.channels, key).toBe(DATA.CHANNEL_DYN);
    }
    // doc 04 §10's own per-row arrival offsets ship separately.
    expect(DATA.DYN_ARRIVAL_OFFSETS['gyaku-zuki-chudan']!.hipMs.v).toBe(245);
    expect(DATA.DYN_ARRIVAL_OFFSETS['gyaku-zuki-chudan']!.shoulderMs.v).toBe(186);
    expect(DATA.DYN_ARRIVAL_OFFSETS['gyaku-zuki-chudan']!.elbowMs.v).toBe(88);
  });

  it('BRIEFS: no settle zeta reaches SETTLE_ZETA_MAX = 0.65', () => {
    expect(DATA.SETTLE_ZETA_MAX).toBe(0.65);
    for (const [k, row] of Object.entries(DATA.SETTLE)) {
      expect(row.zeta.v, `SETTLE.${k}.zeta`).toBeLessThan(DATA.SETTLE_ZETA_MAX);
      expect(row.zeta.v, `SETTLE.${k}.zeta`).toBeGreaterThan(0);
    }
    for (const [k, row] of Object.entries(DATA.CLOTH_SETTLE)) {
      expect(row.zeta.v, `CLOTH_SETTLE.${k}.zeta`).toBeLessThan(DATA.SETTLE_ZETA_MAX);
    }
  });

  it('doc 02 §1.4: tHoldFor reproduces the Taikyoku hold column exactly', () => {
    // t_hold = t_slot - (t_prep + t_transit + t_kime). doc 02 §1.4's own second column.
    expect(DATA.tHoldFor('taikyoku-shodan', 'M1')).toBeCloseTo(1.17, 9);
    expect(DATA.tHoldFor('taikyoku-shodan', 'N')).toBeCloseTo(1.25, 9);
    expect(DATA.tHoldFor('taikyoku-shodan', 'F')).toBeCloseTo(0.4, 9);
    expect(DATA.tHoldFor('taikyoku-shodan', 'T90')).toBeCloseTo(1.29, 9);
    expect(DATA.tHoldFor('taikyoku-shodan', 'T180')).toBeCloseTo(1.21, 9);
    expect(DATA.tHoldFor('taikyoku-shodan', 'T270')).toBeCloseTo(1.46, 9);
    // The Heian column is the authored one.
    expect(DATA.tHoldFor('heian-shodan', 'M1')).toBeCloseTo(1.37, 9);
    expect(DATA.tHoldFor('heian-shodan', 'D45')).toBeCloseTo(1.13, 9);
    expect(DATA.tHoldFor('heian-shodan', 'T135')).toBeCloseTo(1.56, 9);
    // T135 and D45 are Heian-only: asking for them in Taikyoku throws rather than returning NaN.
    expect(() => DATA.tHoldFor('taikyoku-shodan', 'T135')).toThrow();
  });
});

describe('doc 06 §7.3 — the cloth layout adds up', () => {
  it('nine simulated parts, 988 particles, cols x rows per part', () => {
    expect(DATA.GARMENTS).toHaveLength(9);
    let total = 0;
    for (const g of DATA.GARMENTS) {
      expect(g.cols * g.rows, g.part).toBe(g.particles);
      expect(g.approach, g.part).toBe('xpbd');
      total += g.particles;
    }
    expect(total).toBe(DATA.GARMENT_PARTICLE_TOTAL);
    expect(total).toBe(988);
  });

  it('every GarmentPartId has a drag and a layer offset', () => {
    for (const g of DATA.GARMENTS) {
      expect(DATA.GARMENT_DRAG[g.part], g.part).toBeGreaterThan(0);
      expect(DATA.GARMENT_LAYER_OFFSET_H[g.part], g.part).toBeGreaterThanOrEqual(0);
    }
    // doc 06 §7.3: front-L gets the outward offset so the overlapping layers never fight.
    expect(DATA.GARMENT_LAYER_OFFSET_H.skirt_front_L).toBe(0.004);
    expect(DATA.GARMENT_LAYER_OFFSET_H.skirt_front_R).toBe(0);
  });
});

describe('the camera table (C16) is authored from units.ts, not from doc 07 §6.6', () => {
  it('all 12 presets exist, and the four measurement cameras are frozen ortho', () => {
    const ids = Object.keys(DATA.CAMERA_PRESET_PARAMS);
    expect(ids).toHaveLength(12);
    for (const id of ['M_FRONT', 'M_LEFT', 'M_RIGHT', 'M_TOP'] as const) {
      const p = DATA.CAMERA_PRESET_PARAMS[id];
      expect(p.kind, id).toBe('ortho');
      expect(p.frozen, id).toBe(true);
      expect(p.orthoHeightH, id).toBe(2.2);
      expect(p.nearH, id).toBe(0.1);
      expect(p.farH, id).toBe(10);
      expect(p.anchorBone, id).toBeNull();
    }
  });

  it('M_LEFT is at world -3H and M_RIGHT at +3H — doc 07 wrote them the other way round', () => {
    expect(DATA.CAMERA_PRESET_PARAMS.M_LEFT.posH[0]).toBe(-3);
    expect(DATA.CAMERA_PRESET_PARAMS.M_RIGHT.posH[0]).toBe(3);
    expect(DATA.CAMERA_PRESET_PARAMS.M_FRONT.posH[2]).toBe(3);
    expect(DATA.CAMERA_PRESET_PARAMS.M_TOP.posH[1]).toBe(4);
    expect(DATA.CAMERA_PRESET_PARAMS.M_TOP.upIsMinusZ).toBe(true);
    expect(DATA.CAMERA_PRESET_PARAMS.EMBUSEN.upIsMinusZ).toBe(true);
    expect(DATA.CAMERA_PRESET_PARAMS.M_FRONT.upIsMinusZ).toBe(false);
  });

  it('every perspective preset has a fov and every ortho preset an orthoHeight', () => {
    for (const [id, p] of Object.entries(DATA.CAMERA_PRESET_PARAMS)) {
      if (p.kind === 'persp') {
        expect(p.fovDeg, id).toBeGreaterThan(0);
        expect(p.orthoHeightH, id).toBeUndefined();
      } else {
        expect(p.orthoHeightH, id).toBeGreaterThan(0);
        expect(p.fovDeg, id).toBeUndefined();
      }
      expect(p.id, id).toBe(id);
    }
  });

  it('the anchored presets are exactly the ones with a non-null anchorBone, at §5.7 radii', () => {
    for (const id of DATA.CAMERA_ANCHORED) {
      expect(DATA.CAMERA_PRESET_PARAMS[id].anchorBone).not.toBeNull();
    }
    const hands = DATA.CAMERA_PRESET_PARAMS.DETAIL_HANDS.posH;
    expect(Math.hypot(...hands)).toBeCloseTo(DATA.CAMERA_DETAIL_RADIUS_H.hands, 9);
    expect(DATA.CAMERA_DETAIL_RADIUS_H.hands).toBeCloseTo(1.4 / 1.75, 9);
    const feet = DATA.CAMERA_PRESET_PARAMS.DETAIL_FEET.posH;
    expect(Math.hypot(...feet)).toBeCloseTo(DATA.CAMERA_DETAIL_RADIUS_H.feet, 9);
  });
});

describe('mirrorStance — doc 01 §10 "negate every yaw and every pelvisYaw" for migi', () => {
  it("hidari is the authored form and comes back identical", () => {
    for (const id of Object.keys(DATA.STANCES) as (keyof typeof DATA.STANCES)[]) {
      expect(DATA.mirrorStance(DATA.STANCES[id], 'L'), id).toBe(DATA.STANCES[id]);
    }
  });

  it('migi flips exactly the three yaw fields and nothing else', () => {
    const z = DATA.STANCES.zenkutsu;
    const m = DATA.mirrorStance(z, 'R');
    expect(m.yawFront.v).toBe(-z.yawFront.v);
    expect(m.yawRear.v).toBe(-z.yawRear.v);
    expect(m.pelvisYawHanmi.v).toBe(-z.pelvisYawHanmi.v);
    // Lengths, flexions and load shares are side-independent and pass through by identity.
    expect(m.S).toBe(z.S);
    expect(m.W).toBe(z.W);
    expect(m.pelvisY).toBe(z.pelvisY);
    expect(m.kneeFront).toBe(z.kneeFront);
    expect(m.loadFront).toBe(z.loadFront);
    expect(m.pelvisTiltPost).toBe(z.pelvisTiltPost);
    expect(m.id).toBe('zenkutsu');
    // The mirror is an INVOLUTION: applying the migi flip twice returns the authored hidari value.
    expect(DATA.mirrorStance(m, 'R').yawRear.v).toBe(z.yawRear.v);
    expect(DATA.mirrorStance(m, 'R').pelvisYawHanmi.v).toBe(z.pelvisYawHanmi.v);
  });

  it('provenance survives the mirror — a mirrored yaw still cites doc 01', () => {
    const m = DATA.mirrorStance(DATA.STANCES.zenkutsu, 'R');
    expect(parseSrc(m.yawRear.src)).not.toBeNull();
    expect(m.yawRear.unit).toBe('deg');
  });
});

describe('HAND_SHAPE_ANGLES — doc 03 §12, total over BONE_ORDER', () => {
  it('all four hand shapes cover every bone with a 3-tuple', () => {
    for (const shape of ['seiken', 'shuto', 'open', 'nukite'] as const) {
      for (const b of BONE_ORDER) {
        const t = DATA.HAND_SHAPE_ANGLES[shape][b];
        expect(t, `${shape}.${b}`).toHaveLength(3);
        for (const v of t) expect(Number.isFinite(v), `${shape}.${b}`).toBe(true);
      }
    }
  });

  it('only hand bones are non-zero, and both sides carry identical local angles', () => {
    const HAND_STEMS = ['hand', 'fingers_prox', 'fingers_dist', 'fingers_end', 'thumb', 'thumb_end'];
    for (const shape of ['seiken', 'shuto', 'open', 'nukite'] as const) {
      for (const b of BONE_ORDER) {
        const stem = b.replace(/_(?:L|R)$/, '');
        const t = DATA.HAND_SHAPE_ANGLES[shape][b];
        const nonZero = t.some((v) => v !== 0);
        if (nonZero) expect(HAND_STEMS, `${shape}.${b} must be a hand bone`).toContain(stem);
      }
      expect(DATA.HAND_SHAPE_ANGLES[shape].fingers_prox_L).toEqual(
        DATA.HAND_SHAPE_ANGLES[shape].fingers_prox_R,
      );
    }
  });

  it('doc 03 §12.1 seiken: MCP 88, PIP 105, DIP 72, flexion NEGATIVE about local X', () => {
    const s = DATA.HAND_SHAPE_ANGLES.seiken;
    expect(s.fingers_prox_L[0]).toBe(-88);
    expect(s.fingers_dist_L[0]).toBe(-105);
    expect(s.fingers_end_L[0]).toBe(-72);
    // doc 03 §12.2 shuto: near-straight but actively tensed, and zero wrist deviation.
    const k = DATA.HAND_SHAPE_ANGLES.shuto;
    expect(k.fingers_prox_L[0]).toBe(-6);
    expect(k.hand_L).toEqual([0, 0, 0]);
    // Every posed finger angle must be inside its own ROM cone.
    for (const b of ['fingers_prox_L', 'fingers_dist_L', 'fingers_end_L'] as const) {
      expect(Math.abs(s[b][0]), b).toBeLessThanOrEqual(ROM_SIGNED[b].swing1.maxDeg - ROM_SIGNED[b].swing1.minDeg);
    }
  });
});
