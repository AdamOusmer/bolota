// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { parts } from "../src/bolota";
import { engineExpressions, engineStates } from "../src/engine";
import { mountLive } from "../src/live/mount";
import { FakeDocument, FakeElement, frame, makeSvg, run } from "./live-dom";

const NAME = "mount-seed";
const inner = parts(NAME, { animate: "always" }).inner;
const asSvg = (el: FakeElement) => el as unknown as SVGSVGElement;
const rectsOf = (svg: FakeElement) => svg.querySelectorAll(".mo-eye").map((e) => e.children[0]!.children[0]!.children[0]!);
const attrs = (svg: FakeElement) => rectsOf(svg).map((r) => [...r.attrs.values()].join(","));

function ssr() {
  const doc = new FakeDocument();
  const svg = makeSvg(doc, `<g class="mo-root">${inner}</g>`);
  return { doc, svg };
}

function mounted(expression?: string) {
  const doc = new FakeDocument();
  const svg = makeSvg(doc);
  const handle = mountLive(asSvg(svg), NAME, { expression });
  return { doc, svg, handle };
}

describe("mountLive markup", () => {
  test("the figure is parts().inner with the eye paths swapped for rigs", () => {
    const { svg } = mounted();
    const figure = svg.querySelector(".mo-bob")!.children[0]!;
    expect(figure.hasAttribute("data-mo-figure")).toBe(true);
    expect(figure.children.map((c) => c.tagName)).toEqual(["defs", "g", "g", "g"]);
    expect(figure.children[2]!.hasAttribute("data-mo-head")).toBe(true);
    expect(figure.children[2]!.children.map((c) => c.getAttribute("class"))).toEqual(["mo-act"]);
    const expected = inner.replace(/(<g class="mo-eye"[^>]*><g>)<path[^>]*\/>(<\/g><\/g>)/g, "$1<g><rect/></g>$2");
    const actual = svg
      .querySelector(".mo-breathe")!
      .outerHTML.replace(/<g data-mo-figure=""><defs\/><g\/><g data-mo-head=""><g class="mo-act"[^>]*>/, "")
      .replace("</g></g><g/></g>", "")
      .replace(/(class="mo-eyes"[^>]*>)<g>(.*)<\/g>(<\/g>)/, "$1$2$3")
      .replace(/<rect[^>]*\/>/g, "<rect/>");
    expect(actual).toBe(expected);
    expect(svg.getAttribute("overflow")).toBe("visible");
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 100");
  });

  test("an SSR figure is adopted in place, node for node", () => {
    const { doc, svg } = ssr();
    const before = svg.outerHTML;
    const nodes: FakeElement[] = [];
    svg.walk((e) => nodes.push(e));
    const eyePaths = nodes.filter((n) => n.tagName === "path" && n.parentNode?.parentNode?.getAttribute("class") === "mo-eye");
    const handle = mountLive(asSvg(svg), NAME);
    const kept = nodes.filter((n) => !eyePaths.includes(n));
    expect(eyePaths.length).toBe(2);
    expect(kept.every((n) => n.parentNode !== null)).toBe(true);
    expect(svg.querySelectorAll(".mo-root").length).toBe(1);
    expect(svg.querySelector(".mo-breathe")).toBe(nodes.find((n) => n.getAttribute("class") === "mo-breathe")!);
    expect(svg.querySelectorAll(".mo-eye")[0]).toBe(nodes.find((n) => n.getAttribute("class") === "mo-eye")!);
    expect(svg.querySelectorAll(".mo-act").length).toBe(1);
    handle.destroy();
    expect(svg.outerHTML).toBe(before);
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("destroy restores the original paths, and a remount works", () => {
    const { svg } = ssr();
    const paths: FakeElement[] = [];
    svg.walk((e) => e.tagName === "path" && paths.push(e));
    const before = svg.outerHTML;
    mountLive(asSvg(svg), NAME).destroy();
    expect(svg.outerHTML).toBe(before);
    const eyePaths = svg.querySelectorAll(".mo-eye").map((e) => e.children[0]!.children[0]!);
    expect(eyePaths.every((p) => paths.includes(p))).toBe(true);
    const again = mountLive(asSvg(svg), NAME);
    expect(svg.querySelectorAll(".mo-act").length).toBe(1);
    again.destroy();
    expect(svg.outerHTML).toBe(before);
  });

  test("a fresh mount removes everything it added", () => {
    const { svg, handle } = mounted();
    handle.destroy();
    expect(svg.outerHTML).toBe('<svg viewBox="0 0 100 100"/>');
  });

  test("expression vars and mo-expr are cleared at mount and restored at destroy", () => {
    const doc = new FakeDocument();
    const svg = makeSvg(doc, `<g class="mo-root mo-expr" style="--mo-tilt:4">${inner}</g>`);
    svg.setAttribute("style", "--mo-esx:1.4;--mo-lean:3");
    const before = svg.outerHTML;
    const handle = mountLive(asSvg(svg), NAME);
    const root = svg.querySelector(".mo-root")!;
    expect(root.getAttribute("class")).toBe("mo-root");
    expect(root.getAttribute("style")).toBe("");
    expect(svg.getAttribute("style")).not.toContain("--mo-esx");
    handle.destroy();
    expect(svg.outerHTML).toBe(before);
  });

  test("the handle lists the same states and expressions as the old engine", () => {
    const { handle } = mounted();
    expect(handle.states).toEqual(engineStates());
    expect(handle.expressions).toEqual(engineExpressions());
  });
});

describe("mountLive clock", () => {
  test("nothing is registered at rest", () => {
    const { doc } = mounted();
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("a looped static state and a quiet gaze park too", () => {
    const { doc, handle } = mounted();
    handle.loop("wander");
    expect(doc.defaultView.queue.length).toBe(1);
    run(doc, 0, 4);
    expect(doc.defaultView.queue.length).toBe(0);
    handle.loop("idle");
    run(doc, 5000, 4);
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("a one-shot registers, writes while it plays, and parks after the hand-back settles", () => {
    const { doc, svg, handle } = mounted();
    const rest = attrs(svg);
    handle.play("wide");
    expect(doc.defaultView.queue.length).toBe(1);
    let moved = false;
    let ms = 0;
    while (doc.defaultView.queue.length && ms < 20_000) {
      frame(doc, (ms += 16));
      if (attrs(svg).join() !== rest.join()) moved = true;
    }
    expect(moved).toBe(true);
    expect(ms).toBeLessThan(10_000);
    expect(doc.defaultView.queue.length).toBe(0);
    expect(attrs(svg)).toEqual(rest);
  });

  test("a looped periodic state never parks until another state replaces it", () => {
    const { doc, handle } = mounted();
    handle.loop("orbit");
    const ms = run(doc, 0, 8);
    expect(doc.defaultView.queue.length).toBe(1);
    handle.loop("idle");
    run(doc, ms, 5);
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("stop pauses, play resumes", () => {
    const { doc, handle } = mounted();
    handle.loop("orbit");
    frame(doc, 16);
    handle.stop();
    expect(doc.defaultView.queue.length).toBe(0);
    handle.play("wide");
    expect(doc.defaultView.queue.length).toBe(1);
    handle.destroy();
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("orbit holds the ambient idle; the resting face does not", () => {
    const { doc, svg, handle } = mounted();
    expect(svg.getAttribute("data-mo-still")).toBeNull();
    handle.loop("orbit");
    frame(doc, 16);
    frame(doc, 32);
    expect(svg.getAttribute("data-mo-still")).toBe("");
    handle.loop("wander");
    run(doc, 32, 3);
    expect(svg.getAttribute("data-mo-still")).toBeNull();
  });

  test("a blinkIn entrance fires the one-shot blink once", () => {
    const { doc, svg, handle } = mounted();
    handle.play("thinking");
    run(doc, 0, 0.5);
    const first = svg.getAttribute("data-mo-blink");
    expect(first).not.toBeNull();
    run(doc, 600, 0.3);
    expect(svg.getAttribute("data-mo-blink")).toBe(first);
  });

  test("unknown states throw; unknown expressions are ignored", () => {
    const { handle, svg } = mounted();
    expect(() => handle.play("nope")).toThrow();
    expect(() => handle.play("idle", { rest: "nope" })).toThrow();
    const before = svg.outerHTML;
    expect(() => handle.setExpression("nope")).not.toThrow();
    expect(() => handle.setExpression("toString")).not.toThrow();
    expect(svg.outerHTML).toBe(before);
  });
});

describe("mountLive expressions", () => {
  test("old bloub names and roster names move the eyes; null returns them", () => {
    const { doc, svg, handle } = mounted();
    const rest = attrs(svg);
    for (const name of ["angry", "surprised", "mad", "happy"]) {
      handle.setExpression(name);
      run(doc, 0, 2);
      expect(attrs(svg), name).not.toEqual(rest);
      handle.setExpression(null);
      run(doc, 0, 2);
      expect(attrs(svg), name).toEqual(rest);
    }
  });

  test("wander means the resting face, and the initial option applies at once", () => {
    const { doc, svg, handle } = mounted("sad");
    expect(doc.defaultView.queue.length).toBe(0);
    const sad = attrs(svg);
    expect(sad).not.toEqual(attrs(mounted().svg));
    handle.setExpression("wander");
    run(doc, 0, 2);
    expect(attrs(svg)).toEqual(attrs(mounted().svg));
  });

  test("body channels ride custom properties", () => {
    const { svg, handle } = mounted();
    handle.setExpression("sad");
    expect(svg.style.getPropertyValue("--mo-bdy")).not.toBe("");
    handle.setExpression(null);
    expect(svg.style.getPropertyValue("--mo-bdy")).toBe("");
  });
});

describe("mountLive gaze", () => {
  test("rects are read on mount, scroll and resize only, and before the frame writes", () => {
    const { doc, svg, handle } = mounted();
    const win = doc.defaultView;
    doc.log = { events: [] };
    handle.follow();
    expect(doc.rects).toBe(0);
    frame(doc, 16);
    expect(doc.rects).toBe(1);
    for (let i = 0; i < 40; i++) {
      win.fire("pointermove", { clientX: 200 + i * 5, clientY: 40, pointerType: "mouse" });
      frame(doc, 32 + i * 16);
    }
    expect(doc.rects).toBe(1);

    doc.log.events.length = 0;
    win.fire("scroll");
    win.fire("scroll");
    win.fire("resize");
    frame(doc, 1000);
    expect(doc.rects).toBe(2);
    const events = doc.log.events;
    const read = events.indexOf("read rect");
    expect(read).toBe(0);
    expect(events.slice(read).filter((e) => e === "read rect").length).toBe(1);
    void svg;
  });

  test("the eyes follow the pointer on the resting face, then return, and the loop parks", () => {
    const { doc, svg, handle } = mounted();
    const win = doc.defaultView;
    const rest = attrs(svg);
    handle.follow();
    frame(doc, 16);
    win.fire("pointermove", { clientX: 900, clientY: 50, pointerType: "mouse" });
    run(doc, 16, 1);
    const looked = attrs(svg);
    expect(looked).not.toEqual(rest);
    expect(Number(rectsOf(svg)[0]!.getAttribute("x"))).toBeGreaterThan(Number(rest[0]!.split(",")[0]));
    expect(svg.style.getPropertyValue("--mo-track-hold")).toBe("1.000");
    run(doc, 2000, 4);
    expect(doc.defaultView.queue.length).toBe(0);

    win.fire("pointermove", { clientX: 900, clientY: 50, pointerType: "touch" });
    expect(doc.defaultView.queue.length).toBe(0);

    doc.fire("pointerleave");
    run(doc, 6000, 3);
    expect(attrs(svg)).toEqual(rest);
    expect(svg.style.getPropertyValue("--mo-track-hold")).toBe("");
  });

  test("follow(false) releases every listener", () => {
    const { doc, handle } = mounted();
    handle.follow();
    expect(doc.defaultView.count() + doc.count()).toBeGreaterThan(0);
    handle.follow(false);
    expect(doc.defaultView.count() + doc.count()).toBe(1);
    handle.follow();
    handle.destroy();
    expect(doc.defaultView.count() + doc.count()).toBe(0);
  });

  test("a state that owns its gaze ignores the pointer", () => {
    const { doc, svg, handle } = mounted();
    handle.loop("wide");
    handle.follow();
    const win = doc.defaultView;
    frame(doc, 16);
    run(doc, 16, 2);
    const still = attrs(svg);
    win.fire("pointermove", { clientX: 900, clientY: 50, pointerType: "mouse" });
    run(doc, 3000, 1);
    expect(attrs(svg)).toEqual(still);
  });
});

describe("mountLive reduced motion", () => {
  function reduced() {
    const doc = new FakeDocument();
    doc.defaultView.reduced = true;
    const svg = makeSvg(doc, `<g class="mo-root">${inner}</g>`);
    const before = svg.outerHTML;
    return { doc, svg, before, handle: mountLive(asSvg(svg), NAME) };
  }

  test("the markup is untouched until a state asks for its still frame", () => {
    const { doc, svg, before, handle } = reduced();
    expect(svg.outerHTML).toBe(before);
    handle.loop("idle");
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("a state renders its still frame once and never loops", () => {
    const { doc, svg, before, handle } = reduced();
    handle.loop("wide");
    expect(doc.defaultView.queue.length).toBe(0);
    expect(svg.outerHTML).not.toBe(before);
    const shown = svg.outerHTML;
    frame(doc, 16);
    expect(svg.outerHTML).toBe(shown);
    handle.follow();
    expect(doc.defaultView.queue.length).toBe(0);
    expect(doc.defaultView.count()).toBe(0);
    handle.destroy();
    expect(svg.outerHTML).toBe(before);
  });
});
