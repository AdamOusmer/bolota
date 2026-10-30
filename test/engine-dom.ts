// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { mountEngine, type EngineOptions } from "../src/engine";
import { FakeDocument, FakeElement, frame, makeSvg } from "./live-dom";

export { FakeDocument, FakeElement, frame, makeSvg };

export const asSvg = (el: FakeElement) => el as unknown as SVGSVGElement;

export function mountOn(doc: FakeDocument, name: string, opts?: EngineOptions) {
  const svg = makeSvg(doc);
  const handle = mountEngine(asSvg(svg), name, { animate: "hover", ...opts });
  return { doc, svg, handle };
}

export function mounted(name = "facade-seed", opts?: EngineOptions) {
  return mountOn(new FakeDocument(), name, opts);
}

export const rectsOf = (svg: FakeElement) =>
  svg.querySelectorAll(".mo-eye").map((e) => e.children[0]!.children[0]!);

/** Where a live eye's rect is drawn: the translation of its `matrix()`, the rect itself sitting on the origin. */
export function eyeCentre(rect: FakeElement): [number, number] {
  const m = /matrix\(([^)]+)\)/.exec(rect.getAttribute("transform") ?? "");
  if (!m) throw new Error("eye rect without a matrix");
  const v = m[1]!.trim().split(/[\s,]+/).map(Number);
  return [v[4]!, v[5]!];
}

export const eyeAttrs = (svg: FakeElement) => rectsOf(svg).map((r) => [...r.attrs.values()].join(","));

export const actOf = (svg: FakeElement) => svg.querySelector(".mo-act")!.getAttribute("transform");

export function nodes(svg: FakeElement): FakeElement[] {
  const all: FakeElement[] = [];
  svg.walk((e) => all.push(e));
  return all;
}

/** Steps 60 Hz frames from `from` ms until the queue drains or `limit` seconds pass; returns the last ms and whether it drained. */
export function drain(doc: FakeDocument, from: number, limit = 30) {
  let ms = from;
  const end = from + limit * 1000;
  while (doc.defaultView.queue.length && ms < end) frame(doc, (ms += 16));
  return { ms, drained: doc.defaultView.queue.length === 0 };
}
