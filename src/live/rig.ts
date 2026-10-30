// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { bakePose, r3, type Posable, type Pose } from "../morph";
import { EYE_H, EYE_SPLIT, EYE_W, type Head } from "./choreo";

/** bloub's resting half spacing, `sin(EYE_SPLIT)` of the body radius. */
const REST_HALF = Math.sin((EYE_SPLIT * Math.PI) / 180);

type Eye = Posable["eyes"][number];

/**
 * A live eye's shape, as the attributes of one `<rect>`.
 *
 * A rect whose corner radius is half its short side is exactly a capsule at
 * any aspect, and a circle when its sides are equal, so an engine-driven eye
 * changes shape by writing numbers: no path string is built per frame, and a
 * transform never stretches the round caps. Centred on the eye and turned by
 * its `rot` about that centre, it covers the static `capsulePath` of the same
 * baked eye.
 */
export interface EyeRig {
  x: string;
  y: string;
  width: string;
  height: string;
  rx: string;
  ry: string;
  transform: string;
}

export function eyeRig(e: Eye): EyeRig {
  const r = r3(Math.min(e.rx, e.ry));
  return {
    x: r3(e.cx - e.rx),
    y: r3(e.cy - e.ry),
    width: r3(2 * e.rx),
    height: r3(2 * e.ry),
    rx: r,
    ry: r,
    transform: `rotate(${r3(e.rot)} ${r3(e.cx)} ${r3(e.cy)})`,
  };
}

/** Both eyes of `l` under pose `p`: the static bake's geometry, as rigs. */
export function eyeRigs(l: Posable, p: Pose): EyeRig[] {
  return bakePose(l, p).l.eyes.map(eyeRig);
}

export interface FaceLayout extends Posable {
  face: { cx: number; cy: number; rx: number; ry: number };
}

/**
 * The posed eyes a live frame shows, body frame.
 *
 * bloub draws its face on a ball; a seed's ball is its face region, the
 * ellipse each silhouette declares as where eyes belong (the whole body on a
 * round seed, a smaller one on a triangle). `own` moves the eyes the pose
 * shapes from the seeded resting pair toward bloub's on that ellipse: each eye
 * toward bloub's resting `EYE_W` × `EYE_H` of its radii, the pair toward
 * bloub's `EYE_SPLIT` spacing about its centre, level. A state that draws its
 * own face therefore comes out at bloub's size and spacing for that face, and
 * the morph in and out is a blend of the two.
 *
 * `head` then places the pair on that ball: roll turns it about its midpoint,
 * yaw slides it toward the turn, closes it a little and narrows the far eye as
 * the near one widens, and `spread` widens the split.
 */
export function faceEyes(l: FaceLayout, e: { pose: Pose; own: number; head: Head }): Eye[] {
  const u = e.own;
  const { face } = l;
  const R = face.rx;
  const [a, b] = l.eyes as [Eye, Eye];
  const mx = (a.cx + b.cx) / 2 + (face.cx - (a.cx + b.cx) / 2) * u;
  const seeded = (b.cx - a.cx) / 2;
  const half = seeded + (REST_HALF * R - seeded) * u + e.head.spread * R;
  const spread = Math.asin(Math.min(0.95, half / R));
  const lift = half * Math.sin((e.head.roll * Math.PI) / 180);
  const y = (e.head.yaw * Math.PI) / 180;
  const left = Math.cos(y - spread) / Math.cos(spread);
  const right = Math.cos(y + spread) / Math.cos(spread);
  const p = e.pose;
  const posed: Pose = {
    ...p,
    edy: p.edy - lift,
    edy2: p.edy2 + 2 * lift,
    epx: p.epx + R * Math.sin(y) * Math.cos(spread),
    edx: p.edx + half * (Math.cos(y) - 1),
    esx: p.esx * left,
    esx2: (p.esx + p.esx2) * right - p.esx * left,
  };
  const base = {
    eyes: [a, b].map((s, i) => ({
      ...s,
      cx: mx + (i ? half : -half),
      cy: s.cy + (face.cy - s.cy) * u,
      rx: s.rx + ((EYE_W / 2) * face.rx - s.rx) * u,
      ry: s.ry + ((EYE_H / 2) * face.ry - s.ry) * u,
    })),
  };
  return bakePose(base, posed).l.eyes.map(({ cx, cy, rx, ry, rot }) => ({ cx, cy, rx, ry, rot }));
}

/**
 * The live eye markup. `.mo-eye > *` is the bare `<g>`, so the idle blink and
 * wrap in `motion.css` animate it exactly as they animate the static path,
 * while the rect inside keeps its own `transform` attribute, which a CSS
 * transform on the rect would replace. `--mo-lean` is the rect's turn, so the
 * blink's lean bracket closes the eye across its own axis; the engine writes
 * it with the rect.
 */
export function rigMarkup(l: Posable, p: Pose): string {
  const baked = bakePose(l, p).l.eyes;
  return baked
    .map((e, i) => {
      const a = eyeRig(e);
      return (
        `<g class="mo-eye" style="--mo-wrap:${i ? 1 : -1};--mo-lean:${r3(e.rot)};transform-origin:${r3(e.cx)}px ${r3(e.cy)}px">` +
        `<g><rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" rx="${a.rx}" ry="${a.ry}" transform="${a.transform}"/></g></g>`
      );
    })
    .join("");
}
