/**
 * B6 PLAYER — `src/player/sampler.ts`
 *
 * `createSampler(track)` — §3.13's `PoseSource`, implementing §6.2 **term for term**.
 *
 * ═══ THIS FILE IS THE WHOLE RUNTIME READ PATH ════════════════════════════════════════════════
 * §6.1's claim is that `sample(tick, w, out)` writes the same BYTES regardless of how the transport
 * arrived at `tick`. That is not a promise this file makes by being careful; it is a property of
 * the eight terms below, each of which is a pure function of `(track, tick, w)`:
 *
 *   1 seg    = the segment containing `tick`                       binary search, no state
 *   2 f0     = (tick − seg.startTick) / seg.ticksPerFrame | 0      integer division
 *   3 alpha  = `frameAlpha(...)` — exactly k/32, k/16, k/8 or k/4, EXACT in float64
 *   4 q      = slerp(frame f0, frame f0+1, alpha)                  52 bones
 *   5 q      = q · slerp(IDENTITY, slerp(dq[f0], dq[f0+1], alpha), w[id])   in LAYER_ORDER
 *   6 root   = lerp(rootPos), slerp(rootQuat)
 *   7 chan   = lerp(chan[cf], chan[cf+1], (tick % 8) / 8)          uniform 480 Hz grid
 *   8 ribcage= lerp(dScaleRibcage[f0], [f0+1], alpha) scaled by w.breath
 *
 * There is no accumulator, no spring, no IK solve, no clock read and no branch on playback
 * direction anywhere below. Reverse playback is free because nothing here remembers the last tick.
 *
 * ═══ THE ONE PIECE OF MUTABLE STATE, AND WHY IT CANNOT CHANGE AN OUTPUT BYTE ═════════════════
 * §6.1 permits exactly one: a segment cursor cache "whose sole effect is to skip a binary search".
 * The trap is a cursor that answers a *slightly different question* than the cold lookup — e.g.
 * "is `tick` still inside the cached segment's tick span?", which is ambiguous on a shared boundary
 * frame and therefore resolves a boundary tick to segment `k` when walking forward and to `k+1`
 * when seeking cold. Two segments straddling one tick pick different `alpha`s (their rungs differ),
 * so the two paths would disagree in the low bits of every bone — exactly the failure
 * `tests/contracts/seek-purity.test.ts` compares byte images to catch.
 *
 * The fix is structural: `segmentAt` states the cold predicate ONCE — "the LAST segment whose
 * `startTick <= tick`" — and the cursor fast path re-evaluates that same predicate on the cached
 * index. A hit is therefore, by construction, the index the binary search would have returned.
 *
 * ═══ SEGMENTS SHARE THEIR BOUNDARY FRAME (`src/solve/bake.ts`, `bake-error.test.ts` step 4) ════
 * Segment `k`'s LAST frame sits on segment `k+1`'s `startTick`; the frame is stored twice, once per
 * segment. So a boundary tick is representable in both, and a rule is needed. "Last segment with
 * `startTick <= tick`" — i.e. prefer the LATER segment — is chosen because
 * `seek-purity.test.ts`'s `keyTickAtOrBefore` assertion resolves the segment for a returned key
 * with `[...track.segments].reverse().find((sg) => sg.startTick <= key)`, which IS that rule.
 * Preferring the earlier segment would still land on a shared frame, but the sampler and the test
 * would be reasoning about different segments and the agreement would be a coincidence rather than
 * a consequence.
 *
 * ═══ WHY THE SCRATCH IS AT MODULE SCOPE ══════════════════════════════════════════════════════
 * §3.9: "the sampler never allocates", and `seek-purity.test.ts` proves it by asserting the caller's
 * five `ArrayBuffer`s are the SAME objects after 10 000 calls. That only forbids allocating the
 * OUTPUT, but §6.6 budgets the whole call at 3.6 us, which a per-call temporary would blow on GC
 * alone. Module scope rather than per-sampler closure scope because the cold-seek path of the
 * frozen test builds a fresh sampler for every one of its 512 ticks: per-instance scratch would
 * make "cold seek" mean "allocate", which is the opposite of what that path is measuring.
 *
 * The safety condition for sharing scratch across sampler instances is that `sample` is
 * synchronous, non-reentrant and never yields — true here, and it is the reason no `await`, no
 * callback and no getter may ever be introduced into the body below.
 *
 * ═══ ONE SLERP IN THE PROJECT ════════════════════════════════════════════════════════════════
 * `slerpInto` comes from the `src/solve` barrel, not from a local copy and not from three's
 * `Quaternion.slerp`. `src/solve/bake.ts` says why in its own header: **G-9a measures the bake
 * error against exactly this arithmetic**. A second implementation agreeing to 1e-7 would turn
 * `maxSlerpErrDeg` into a measurement of the difference between two slerps rather than of the
 * bake, and the 0.25 deg gate would be reporting the wrong quantity.
 *
 * The one place this file and B3's compile-time `composeInto` can differ: `composeInto` scales a
 * layer delta with three's `Quaternion.slerp` and this file uses `slerpInto`. They agree exactly at
 * `w = 0` and `w = 1` (both short-circuit), so the S14 recompose gate and every capture — which
 * `layerWeightsDirty` forces onto the default all-ones vector (§6.5 interlock 3) — measure
 * identical arithmetic. Only a look-dev slider parked between 0 and 1 sees the ~1e-7 difference,
 * and nothing numeric is read in that state by construction.
 */

import { Quaternion } from 'three';

import {
  BONE_COUNT,
  CHANNEL_COUNT,
  CHAN_TICKS_PER_FRAME,
  LAYER_ORDER,
  frameAlpha,
  type LayerTrack,
  type PoseSource,
  type PoseTrack,
} from '../contracts';
import { slerpInto } from '../solve';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Module scratch. See "WHY THE SCRATCH IS AT MODULE SCOPE" above.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Floats per baked frame in `PoseTrack.q`. `PoseSegment.qOffset` is already in floats. */
const Q_STRIDE = BONE_COUNT * 4;

/** The identity quaternion, as the `slerpInto` operand of §6.2 term 5's `slerp(IDENTITY, dq, w)`. */
const IDENTITY_Q = new Float32Array([0, 0, 0, 1]);

/** One layer delta, interpolated across the frame pair and then scaled by its weight. */
const _dq = new Float32Array(4);
/** The bone's current composed value, and the delta, as three quaternions for the post-multiply. */
const _qBone = new Quaternion();
const _qDelta = new Quaternion();

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The sampler
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export function createSampler(track: PoseTrack): PoseSource {
  const segs = track.segments;
  if (segs.length === 0) {
    // A track with no segments cannot answer any tick. Failing at construction names the compile
    // that produced it; failing inside `sample` would surface 60 times a second as NaN quaternions,
    // which read as a rig collapsed to the origin and send the reader after the rig instead.
    throw new Error(`createSampler: track '${track.kataId}' has no segments`);
  }

  const segCount = segs.length;
  const lastSeg = segs[segCount - 1]!;

  /**
   * `startTick` lifted out of the frozen `PoseSegment` objects into one contiguous array. The
   * binary search touches only this, so a cold seek walks ~log2(segments) cache lines instead of
   * chasing that many object headers.
   */
  const starts = new Int32Array(segCount);
  for (let i = 0; i < segCount; i++) starts[i] = segs[i]!.startTick;

  /**
   * The CLAMP RANGE, and why its upper bound is not `durationTicks - 1`.
   *
   * `planSegments` snaps the final span DOWN onto its own frame grid
   * (`durationTicks - durationTicks % tpf`), so the last baked frame can sit up to 31 ticks before
   * the end of the clip — while `seek-purity.test.ts` samples right up to `durationTicks - 1` and
   * the transport can be parked there. Clamping to the last baked FRAME rather than to the clip
   * length is what keeps those trailing ticks inside a real frame pair; clamping to
   * `durationTicks - 1` would leave `f0` past the end of the segment and read whatever floats the
   * next segment's storage happens to hold — or, in the last segment, past the end of `q`.
   *
   * It is applied identically on every path because it is a pure function of `tick` alone: the
   * cold, forward and reverse walks all clamp before anything else happens (§6.1).
   */
  const firstTick = starts[0]!;
  const lastTick = lastSeg.startTick + (lastSeg.frameCount - 1) * lastSeg.ticksPerFrame;

  /**
   * The five layers in `LAYER_ORDER`, resolved once. Quaternion post-multiplication does not
   * commute, so the composition order IS part of the contract (§3.9: "FROZEN composition order");
   * reading `track.layers` positionally would make the pose depend on the order B3 happened to emit
   * them in, and that dependency would be invisible until a layer moved.
   */
  const layers: readonly (LayerTrack | null)[] = LAYER_ORDER.map(
    (id) => track.layers.find((l) => l.id === id) ?? null,
  );

  /** §2.8: `breath` is the only layer carrying a ribcage scale, and `ribcage` the only scalable bone. */
  const breath = track.layers.find((l) => l.id === 'breath') ?? null;
  const ribcageScale = breath?.dScaleRibcage ?? null;

  const chanFrameCount = track.chanFrameCount;
  const lastChanFrame = chanFrameCount - 1;

  /**
   * §6.1's one piece of mutable state. Its ONLY effect is to skip the binary search below; the hit
   * test re-evaluates the cold predicate verbatim, so a hit cannot resolve to a different segment
   * than a miss would. Clearing it (which is what a fresh sampler per tick amounts to) therefore
   * changes no output byte — the property `seek-purity.test.ts` compares path A against paths B
   * and C to prove.
   */
  let cursor = 0;

  /**
   * THE segment predicate: the LAST index whose `startTick <= tick`. Stated once, used by the
   * cursor fast path, the binary search and `keyTickAtOrBefore`, so there is no second reading of
   * "which segment owns a shared boundary frame" anywhere in the file.
   *
   * `tick` must already be clamped into `[firstTick, lastTick]`, so `starts[0] <= tick` holds and
   * the search always terminates on a real index.
   */
  const segmentAt = (tick: number): number => {
    const c = cursor;
    if (starts[c]! <= tick && (c === segCount - 1 || starts[c + 1]! > tick)) return c;

    let lo = 0;
    let hi = segCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= tick) lo = mid;
      else hi = mid - 1;
    }
    cursor = lo;
    return lo;
  };

  const clampTick = (tick: number): number =>
    tick < firstTick ? firstTick : tick > lastTick ? lastTick : tick;

  return {
    track,

    sample(tick, weights, out): void {
      const t = clampTick(tick);

      /* ── term 1: the segment ─────────────────────────────────────────────────────────────── */
      const seg = segs[segmentAt(t)]!;
      const tpf = seg.ticksPerFrame;

      /* ── terms 2 and 3: the frame pair and the alpha between them ───────────────────────── */
      let f0 = Math.floor((t - seg.startTick) / tpf);
      /* `frameAlpha` rather than a local `(t - start - f0*tpf) / tpf`: §2.4's dyadic-ladder claim
       * is stated in `src/contracts/time.ts` and proved green there from Phase 0. A second
       * expression of it here could drift (a `Math.round`, a float divisor) and take term 3's
       * exactness — the single property §6.1 rests on — with it. */
      let alpha = frameAlpha(t, seg.startTick, tpf);
      if (f0 >= seg.frameCount - 1) {
        /* `t` is the segment's LAST frame, which happens only at `lastTick` — every interior
         * boundary tick belongs to the NEXT segment under term 1's rule and lands at f0 = 0 there.
         * Reading the pair (last−1, last) at alpha = 1 keeps `f0 + 1` in range without a second
         * code path for "exactly on the final frame", and slerp at t = 1 returns the final frame's
         * own value (renormalised), so the clip's last tick shows the pose that was baked for it. */
        f0 = seg.frameCount - 2;
        alpha = 1;
      }

      /* Layer deltas, the root and the ribcage scale are all indexed by the GLOBAL base-frame
       * number — `buildLayers` is handed one `frameCount` spanning every segment — while `q` is
       * indexed by `qOffset`, which is that same frame number pre-multiplied by the stride. */
      const frame0 = seg.frameOffset + f0;
      const frame1 = frame0 + 1;
      const inv = 1 - alpha;

      /* ── term 4: the base pose, 52 slerps ───────────────────────────────────────────────── */
      const q = track.q;
      const qa = seg.qOffset + f0 * Q_STRIDE;
      const qb = qa + Q_STRIDE;
      for (let b = 0; b < BONE_COUNT; b++) {
        const o = b * 4;
        slerpInto(q, qa + o, q, qb + o, alpha, out.q, o);
      }

      /* ── term 5: the five delta layers, post-multiplied in the bone's own frame ─────────── */
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        if (layer === null) continue;
        const w = weights[layer.id];
        /* `w === 0` is the identity delta, and post-multiplying by identity is a no-op even in
         * float32 — skipping it is a speed choice, not a semantic one, and mirrors `composeInto`. */
        if (w === 0) continue;

        const bones = layer.bones;
        const n = bones.length;
        const dq = layer.dq;
        const d0 = frame0 * n * 4;
        const d1 = frame1 * n * 4;

        for (let k = 0; k < n; k++) {
          const ko = k * 4;
          /* The layer shares `PoseTrack.segments` exactly (§3.9), so the SAME alpha interpolates
           * the delta — a layer interpolated on its own grid would slide against the base pose by
           * up to one frame and show up as the arms lagging the hips by 8 ms. */
          slerpInto(dq, d0 + ko, dq, d1 + ko, alpha, _dq, 0);
          if (w !== 1) {
            /* A delta at weight `w` is the delta SLERPED FROM IDENTITY by `w` — scaling the four
             * components is meaningless for a quaternion and denormalises it. `slerpInto` reads
             * both operands before it writes, so aliasing `_dq` as source and destination is safe. */
            slerpInto(IDENTITY_Q, 0, _dq, 0, w, _dq, 0);
          }
          const bo = bones[k]! * 4;
          _qDelta.set(_dq[0]!, _dq[1]!, _dq[2]!, _dq[3]!);
          _qBone.set(out.q[bo]!, out.q[bo + 1]!, out.q[bo + 2]!, out.q[bo + 3]!);
          _qBone.multiply(_qDelta);
          out.q[bo] = _qBone.x;
          out.q[bo + 1] = _qBone.y;
          out.q[bo + 2] = _qBone.z;
          out.q[bo + 3] = _qBone.w;
        }
      }

      /* ── term 6: the root ───────────────────────────────────────────────────────────────── */
      const rp = track.rootPos;
      const p0 = frame0 * 3;
      const p1 = frame1 * 3;
      /* `a*(1−alpha) + b*alpha`, not `a + (b−a)*alpha`: the first form returns `a` and `b`
       * bit-exactly at alpha 0 and 1, so a tick sitting on a baked frame reproduces the baked
       * root position rather than a rounding of it. */
      out.rootPos[0] = rp[p0]! * inv + rp[p1]! * alpha;
      out.rootPos[1] = rp[p0 + 1]! * inv + rp[p1 + 1]! * alpha;
      out.rootPos[2] = rp[p0 + 2]! * inv + rp[p1 + 2]! * alpha;
      slerpInto(track.rootQuat, frame0 * 4, track.rootQuat, frame1 * 4, alpha, out.rootQuat, 0);

      /* ── term 7: the channels, on their own UNIFORM 480 Hz grid ─────────────────────────── */
      /* `chan` is not segmented — §3.9 bakes it at a single rate — so it gets its own frame pair
       * and its own alpha, `(tick % 8) / 8`, one of eight exact eighths. Reusing the pose alpha
       * here would sample the wrong point of the tension envelope everywhere the pose is at 120 or
       * 960 Hz, which is most of the clip. */
      const chan = track.chan;
      let cf0 = Math.floor(t / CHAN_TICKS_PER_FRAME);
      const cAlpha = (t % CHAN_TICKS_PER_FRAME) / CHAN_TICKS_PER_FRAME;
      if (cf0 > lastChanFrame) cf0 = lastChanFrame;
      const cf1 = cf0 < lastChanFrame ? cf0 + 1 : lastChanFrame;
      const cInv = 1 - cAlpha;
      const c0 = cf0 * CHANNEL_COUNT;
      const c1 = cf1 * CHANNEL_COUNT;
      for (let i = 0; i < CHANNEL_COUNT; i++) {
        out.chan[i] = chan[c0 + i]! * cInv + chan[c1 + i]! * cAlpha;
      }

      /* ── term 8: the ribcage scale ──────────────────────────────────────────────────────── */
      if (ribcageScale === null) {
        out.scaleRibcage[0] = 1;
        out.scaleRibcage[1] = 1;
        out.scaleRibcage[2] = 1;
      } else {
        /* The scale analogue of term 5's `slerp(IDENTITY, dq, w)`: lerp from the NO-BREATH value,
         * which is 1, not from 0. `w = 0` must mean "ribcage at rest", and `s * w` would mean
         * "ribcage collapsed to a point" — a whole-torso implosion the moment the breath slider
         * reaches its documented floor. */
        const wBreath = weights.breath;
        const s0 = frame0 * 3;
        const s1 = frame1 * 3;
        for (let i = 0; i < 3; i++) {
          const s = ribcageScale[s0 + i]! * inv + ribcageScale[s1 + i]! * alpha;
          out.scaleRibcage[i] = 1 + wBreath * (s - 1);
        }
      }
    },

    keyTickAtOrBefore(tick: number): number {
      /**
       * Monotone, `<= tick`, and exactly on a baked frame — the three properties
       * `seek-purity.test.ts` asserts, and what makes `,`/`.` frame-stepping in §6.7 land on real
       * data instead of between two frames.
       *
       * Monotonicity survives a segment change because the segments are contiguous on their shared
       * boundary frame: for `tick` just below `segments[k+1].startTick` the answer is a frame of
       * segment `k` at or below that boundary, and at the boundary itself term 1's rule moves to
       * segment `k+1` and returns the boundary tick — the same tick, from the other side.
       */
      const t = clampTick(tick);
      const seg = segs[segmentAt(t)]!;
      const tpf = seg.ticksPerFrame;
      return seg.startTick + Math.floor((t - seg.startTick) / tpf) * tpf;
    },
  };
}
