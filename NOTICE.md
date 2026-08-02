# Third-party assets

This project is licensed **GPL-3.0-or-later** (see `LICENSE`). The choice is not
arbitrary — it is inherited. One bundled asset is GPL, and copyleft propagates.

## Why this repository is GPL

`public/models/mocap/heian-nidan.bvh` is a real Shotokan Heian Nidan performance,
20 joints at 100 Hz, 26.9 s. It was extracted from the **RMoCap** R package by
**Tomasz Hachaj and Marek R. Ogiela** (`browarsoftware/RMoCap`, `License: GPL (>= 3)`),
whose `data/heian.nidan.bvh.rda` stores the BVH as a single serialised string.
`tools/extract-rda-bvh.mjs` recovers it without needing R installed.

Related work by the same authors:

> Hachaj T., Piekarczyk M., Ogiela M. (2017). "Human Actions Analysis: Templates
> Generation, Matching and Visualization Applied to Motion Capture of Highly-Skilled
> Karate Athletes." *Sensors* 17(11), 1–24. doi:10.3390/s17112590

Redistributing that file is what obliges this repository to carry GPL-3 terms. Remove
it and nothing else here requires copyleft — every other asset is permissive.

## Everything else

| Asset | Source | Licence |
|---|---|---|
| `public/models/AnimLib.glb` | Universal Animation Library, [Quaternius](https://quaternius.com) | **CC0 1.0** — public domain, no attribution required |
| `public/models/Xbot.glb`, `Soldier.glb` | [three.js](https://github.com/mrdoob/three.js) example assets | three.js licence terms |
| `public/models/mocap/karate.bvh` | `sinisterchipmunk/bvh` test fixtures | see that repository |

Everything else in the dojo — the floor, the shoji walls, the kumiko, the props, the
gi, the hair, the audio — is **generated procedurally in code**. There are no
downloaded textures, fonts, HDRIs or sounds anywhere in this project, which is a
deliberate constraint rather than an accident.

## A note on `karate.bvh`

It is registered and auditionable but deliberately **not** wired into any technique.
Measured on its own source skeleton: the head drops to 3.8 units above the hips
(≈27 standing) on 11 % of frames, hip height falls to 4.1 of 37.2, and the lowest
foot reaches −4.0 — through the floor. It is a BVH parser's test fixture, not a dojo
recording. `heian-nidan.bvh` is the real capture.
