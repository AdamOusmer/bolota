// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { bakePose, r3, type Posable, type Pose } from "../morph";
import { EYE_H, EYE_SPLIT, EYE_W, type Head } from "./choreo";
import { ballEdge, ballRadius, type OutlineLayout } from "./outline";

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
 * `rot` degrees about that centre (the `transform` the driver composes with the
 * idle layers), it covers the static `capsulePath` of the same baked eye.
 */
export interface EyeRig {
  x: string;
  y: string;
  width: string;
  height: string;
  rx: string;
  ry: string;
  rot: string;
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
    rot: r3(e.rot),
  };
}

/** Both eyes of `l` under pose `p`: the static bake's geometry, as rigs. */
export function eyeRigs(l: Posable, p: Pose): EyeRig[] {
  return bakePose(l, p).l.eyes.map(eyeRig);
}

export interface FaceLayout extends Posable, OutlineLayout {
  face: { cx: number; cy: number; rx: number; ry: number };
}

interface Face {
  pose: Pose;
  own: number;
  head: Head;
}

const pick = ({ cx, cy, rx, ry, rot }: Eye): Eye => ({ cx, cy, rx, ry, rot });

/**
 * The seeded face under a head turn: the seeded eyes at their seeded spacing,
 * placed on the face ellipse's sphere. Roll turns the pair about its midpoint,
 * yaw slides it toward the turn, closes it a little and narrows the far eye
 * as the near one widens.
 */
function seededEyes(l: FaceLayout, { pose: p, head }: Face): Eye[] {
  const R = l.face.rx;
  const [a, b] = l.eyes as [Eye, Eye];
  const half = (b.cx - a.cx) / 2 + head.spread * R;
  const spread = Math.asin(Math.min(0.95, half / R));
  const lift = half * Math.sin((head.roll * Math.PI) / 180);
  const y = (head.yaw * Math.PI) / 180;
  const left = Math.cos(y - spread) / Math.cos(spread);
  const right = Math.cos(y + spread) / Math.cos(spread);
  const posed: Pose = {
    ...p,
    edy: p.edy - lift,
    edy2: p.edy2 + 2 * lift,
    epx: p.epx + R * Math.sin(y) * Math.cos(spread),
    edx: p.edx + half * (Math.cos(y) - 1) + head.spread * R,
    esx: p.esx * left,
    esx2: (p.esx + p.esx2) * right - p.esx * left,
  };
  return bakePose(l, posed).l.eyes.map(pick);
}

/**
 * bloub's own face on this seed, as its engine draws it: eyes `EYE_W` ×
 * `EYE_H` of the body radius, on a sphere of the body radius turned by the
 * head, each centre then drawn in or out by the head's radius in its
 * direction over the body radius (`bloub/engine.ts`'s `bodyRadius` fit, here
 * from the exact outline). `turn` is how far the body is turned under a level
 * face.
 *
 * The body radius is `body.rx`, as bloub's engine took it, except on a
 * polygon, whose `rx` is the distance to a corner: a triangle's head is half
 * that across, and bloub's stare would not fit it on any seed. There the ball
 * of the polygon's own mean radius stands in, as `posed()` scales by the mean
 * radius of a profile.
 */
function bloubEyes(l: FaceLayout, { pose: p, head }: Face, turn: number): Eye[] {
  const R = l.body.sides ? ballRadius(l) : l.body.rx;
  const y = (head.yaw * Math.PI) / 180;
  const r = (head.roll * Math.PI) / 180;
  const split = Math.asin(Math.min(0.95, REST_HALF + head.spread));
  const cy = Math.cos(y), sy = Math.sin(y), cr = Math.cos(r), sr = Math.sin(r);
  const width: number[] = [];
  const eyes = l.eyes.map((s, i) => {
    const a = split * (i ? 1 : -1);
    const ca = Math.cos(a), sa = Math.sin(a);
    const x = (sy * ca + cy * cr * sa) * R;
    const v = sr * sa * R;
    width.push(Math.hypot(cy * cr * ca - sy * sa, sr * ca));
    const fit = ballEdge(l, Math.atan2(v, x) - (turn * Math.PI) / 180) / R;
    return { ...s, cx: l.body.cx + x * fit, cy: l.body.cy + v * fit, rx: (EYE_W / 2) * R, ry: (EYE_H / 2) * R };
  });
  const posed: Pose = {
    ...p,
    esx: p.esx * width[0]!,
    esx2: (p.esx + p.esx2) * width[1]! - p.esx * width[0]!,
  };
  return bakePose({ eyes }, posed).l.eyes.map(pick);
}

/**
 * The posed eyes a live frame shows, body frame. `own` blends the seeded face
 * (0) into bloub's own (1), field by field, so a state that draws its own face
 * shows bloub's eyes at bloub's size and place, and the morph in and out of it
 * is continuous.
 */
export function faceEyes(l: FaceLayout, e: Face, turn = 0): Eye[] {
  const u = e.own;
  if (u <= 0) return seededEyes(l, e);
  const b = bloubEyes(l, e, turn);
  if (u >= 1) return b;
  const s = seededEyes(l, e);
  return s.map((x, i) => {
    const y = b[i]!;
    return {
      cx: x.cx + (y.cx - x.cx) * u,
      cy: x.cy + (y.cy - x.cy) * u,
      rx: x.rx + (y.rx - x.rx) * u,
      ry: x.ry + (y.ry - x.ry) * u,
      rot: x.rot + (y.rot - x.rot) * u,
    };
  });
}

/**
 * The live eye markup. `.mo-eye > *` stays a bare group, as in the static
 * markup; the rect carries the driver's `transform` (turn, idle blink and wrap).
 */
export function rigMarkup(l: Posable, p: Pose): string {
  const baked = bakePose(l, p).l.eyes;
  return baked
    .map((e, i) => {
      const a = eyeRig(e);
      return (
        `<g class="mo-eye" style="--mo-wrap:${i ? 1 : -1};--mo-lean:${r3(e.rot)};transform-origin:${r3(e.cx)}px ${r3(e.cy)}px">` +
        `<g><rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" rx="${a.rx}" ry="${a.ry}" transform="rotate(${a.rot} ${r3(e.cx)} ${r3(e.cy)})"/></g></g>`
      );
    })
    .join("");
}
