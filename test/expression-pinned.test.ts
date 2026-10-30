// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * The fourth roster's static markup, pinned outside `gen2.txt`: that fixture is
 * written whole by `scripts/golden.ts`, and recording these there would rewrite
 * a file whose bytes are the gen2 contract. A failure here is a moved avatar,
 * not a hash to update.
 */

import { expect, test } from "bun:test";
import { bolota } from "../src/bolota";
import { attentive, curious, excited, laughing, proud } from "../src/expression";
import { SEEDS } from "./golden/corpus";
import { hash } from "./golden/format";

const PINNED = {
  attentive: "a33532cbd0455d81",
  excited: "386706def34ccb13",
  laughing: "08ad6dc22e508ae4",
  curious: "8e4dd3fde46ab8af",
  proud: "00d5e2619ad66790",
};

const POSES = { attentive, excited, laughing, curious, proud };

test("the fourth roster renders the recorded markup", () => {
  const now = Object.fromEntries(
    Object.entries(POSES).map(([name, e]) => [
      name,
      hash(SEEDS.slice(0, 12).map((s) => bolota(s, { expression: e })).join("\n")),
    ]),
  );
  expect(now).toEqual(PINNED);
});
