// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { expect, test } from "bun:test";
import { decorSharesEngine } from "../scripts/decor-shared";

const text = async (entry: string, plugins?: (typeof decorSharesEngine)[]) => {
  const out = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: true,
    external: ["*/decor.js"],
    plugins,
  });
  expect(out.success).toBe(true);
  return out.outputs[0]!.text();
};

test("decor chunk imports its shared helpers from engine.js and holds no copy", async () => {
  const engine = await text("src/engine.ts");
  const decor = await text("src/live/decor.ts", [decorSharesEngine]);

  const imported = /^import\{([^}]*)\}from"\.\/engine\.js";/.exec(decor)?.[1];
  expect(imported).toBeDefined();
  const names = imported!.split(",").map((s) => s.split(" as ")[0]!);
  expect(names.length).toBeGreaterThan(0);

  const exported = /export\{([^}]*)\}/.exec(engine)![1]!.split(",").map((s) => s.split(" as ")[1]);
  for (const n of names) expect(exported).toContain(n);

  expect(decor.match(/from"\.\/engine\.js"/g)).toHaveLength(1);
  expect(decor).not.toContain("0.4122");
  expect(decor).not.toContain("1000)/1000");
  expect(decor.length).toBeLessThan(engine.length / 2);
});
