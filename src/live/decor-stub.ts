// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

// TEMPORARY: the decor contract and a no-op implementation, so `mount.ts`
// compiles before `decor.ts` lands. The merge deletes this file and points
// `mount.ts`'s one import at `./decor`.

import type { StateId } from "./choreo";

export interface DecorHost {
  back: SVGGElement;
  front: SVGGElement;
  defs: SVGDefsElement;
  head: SVGGElement;
}

export interface DecorPalette {
  head: string;
  eye: string;
  bg?: string;
}

export interface DecorFrame {
  state: StateId;
  local: number;
  weight: number;
}

export interface Decor {
  update(frames: readonly DecorFrame[]): void;
  clear(): void;
  destroy(): void;
}

export function createDecor(
  _host: DecorHost,
  _layout: { body: { cx: number; cy: number; rx: number } },
  _palette: DecorPalette,
  _uid: string,
): Decor {
  return { update() {}, clear() {}, destroy() {} };
}
