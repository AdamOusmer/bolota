/** Bolota 2's frozen seed→markup contract. A failure is not a fixture update. */

import { describe, expect, test } from "bun:test";
import { HISTOGRAM_SEEDS, cases, histogram, markup } from "./golden/corpus";
import { hash, parse } from "./golden/format";

const fixture = parse(await Bun.file(`${import.meta.dir}/golden/gen2.txt`).text());

const report = (moved: string[], total: number) =>
  `${moved.length} of ${total} moved — e.g. ${moved.slice(0, 5).join(", ")}` +
  (moved.length > 5 ? `, …` : "");

describe("gen2 is frozen", () => {
  test("the shape distribution is unchanged", () => {
    const counts = histogram();
    expect(counts.map(([shape]) => String(shape))).toEqual([...fixture.histogram.keys()]);
    for (const [shape, n] of counts) {
      expect(`${shape} ${n}`).toBe(`${shape} ${Number(fixture.histogram.get(shape))}`);
    }
    expect(counts.reduce((a, [, n]) => a + n, 0)).toBe(HISTOGRAM_SEEDS);
  });

  test("the recorded renders are byte-identical", () => {
    const now = markup();
    expect(now.map(([label]) => label)).toEqual([...fixture.markup.keys()]);
    for (const [label, svg] of now) {
      expect(`${label}\n${svg}`).toBe(`${label}\n${fixture.markup.get(label)}`);
    }
  });

  test("every seed and option combination still hashes the same", () => {
    const moved: string[] = [];
    const unrecorded: string[] = [];
    let total = 0;
    for (const [label, svg] of cases()) {
      total++;
      const was = fixture.hashes.get(label);
      if (was === undefined) unrecorded.push(label);
      else if (was !== hash(svg)) moved.push(label);
    }
    expect(
      unrecorded.length === 0
        ? "every case is recorded"
        : `not in the fixture — regenerate: ${report(unrecorded, total)}`,
    ).toBe("every case is recorded");
    expect(
      moved.length === 0 ? "gen2 is unchanged" : `gen2 moved: ${report(moved, total)}`,
    ).toBe("gen2 is unchanged");
    expect(fixture.hashes.size).toBe(total);
  });
});
