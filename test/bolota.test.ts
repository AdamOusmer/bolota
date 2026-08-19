// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { bolota } from "../src/bolota";
import { VERSION } from "../src/index";
import { bolotaUri } from "../src/uri";
import { palette } from "../src/color";

const SEEDS = Array.from({ length: 300 }, (_, i) => `user-${i}`);

describe("output", () => {
  test("is well-formed SVG with no numeric leakage", () => {
    for (const s of SEEDS) {
      const svg = bolota(s);
      expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"');
      expect(svg).toEndWith("</svg>");
      expect(svg).not.toContain("NaN");
      expect(svg).not.toContain("undefined");
      expect(svg).not.toContain("Infinity");
    }
  });

  test("parses as XML", () => {
    // Bun ships no DOM parser, so lean on a structural check: tags balance.
    for (const s of SEEDS.slice(0, 50)) {
      const svg = bolota(s);
      const open = (svg.match(/<(?!\/)[a-z]/g) ?? []).length;
      const close = (svg.match(/<\/[a-z]/g) ?? []).length + (svg.match(/\/>/g) ?? []).length;
      expect(open).toBe(close);
    }
  });

  test("emits no ids, so many bolotas on one page cannot collide", () => {
    for (const s of SEEDS.slice(0, 50)) {
      expect(bolota(s)).not.toContain("id=");
      expect(bolota(s)).not.toContain("url(#");
    }
  });

  test("stays small enough to inline", () => {
    const sizes = SEEDS.map(s => bolota(s).length);
    expect(Math.max(...sizes)).toBeLessThan(2600);
  });
});

describe("options", () => {
  test("size adds explicit dimensions", () => {
    expect(bolota("a", { size: 64 })).toContain('width="64" height="64"');
    expect(bolota("a")).not.toContain("width=");
  });

  test("background toggles the backdrop plate", () => {
    const on = bolota("a", { background: true }).match(/<path/g)!.length;
    const off = bolota("a", { background: false }).match(/<path/g)!.length;
    expect(on).toBe(off + 1);
  });

  test("the default is no backdrop at all", () => {
    // The body *is* the bolota, so nothing is drawn behind it unless asked.
    expect(bolota("a").match(/<path/g)!.length).toBe(
      bolota("a", { background: false }).match(/<path/g)!.length,
    );
  });

  test("hue and tone lock color while leaving shape seed-driven", () => {
    // Feature presence varies by seed, so the *set* of colors used differs.
    // What must hold is that no color outside the locked palette appears.
    const allowed = new Set(Object.values(palette(200, true, 0.5)));
    for (const s of SEEDS.slice(0, 50)) {
      for (const hex of bolota(s, { hue: 200, tone: 0.5 }).match(/#[0-9a-f]{6}/g) ?? []) {
        expect(allowed).toContain(hex);
      }
    }
    expect(bolota("alain", { hue: 200, tone: 0.5 })).not.toBe(
      bolota("bob", { hue: 200, tone: 0.5 }),
    );
  });

  test("palette overrides are applied verbatim", () => {
    expect(bolota("a", { palette: { head: "#ff0000" } })).toContain("#ff0000");
  });

  test("title is escaped", () => {
    expect(bolota("a", { title: "<script>&" })).toContain("<title>&lt;script&gt;&amp;</title>");
  });
});

describe("data uri", () => {
  test("is smaller than the base64 equivalent", () => {
    const svg = bolota("alain");
    const b64 = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    expect(bolotaUri("alain").length).toBeLessThan(b64.length);
  });

  test("escapes every character that would break an attribute or URL", () => {
    for (const s of SEEDS.slice(0, 50)) {
      const uri = bolotaUri(s);
      expect(uri).not.toContain('"');
      expect(uri).not.toContain("#");
      expect(uri).not.toContain("<");
    }
  });
});

describe("the published surface", () => {
  test("VERSION matches package.json", async () => {
    // `VERSION` is not decoration: it is the one live binding keeping the
    // barrel from compiling to a stub that Node refuses to link. See the
    // comment on it in `src/index.ts`. Pinned here so it cannot go stale.
    const pkg = await Bun.file(
      new URL("../package.json", import.meta.url),
    ).json();
    expect(VERSION).toBe(pkg.version);
  });
});
