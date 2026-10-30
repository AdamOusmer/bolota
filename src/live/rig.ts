// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { bakePose, r3, type Posable, type Pose } from "../morph";

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
