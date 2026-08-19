/**
 * Writes the golden fixture.
 *
 * Deliberately not part of `check`, and deliberately requiring `--write`. The
 * failure mode this guards against is the ordinary one: a threshold moves, the
 * golden test goes red, and the quickest way to green is to regenerate. That
 * would turn the only check on the library's central promise into a formality.
 *
 * Regenerating is correct only when beginning a new major's contract, and that
 * is something somebody should have to type a flag to say.
 */

import { cases, histogram, markup } from "../test/golden/corpus";
import { hash, serialize } from "../test/golden/format";

const DIR = "test/golden";

if (!process.argv.includes("--write")) {
  console.error(
    `Refusing to write without --write.\n\n` +
      `  A diff in ${DIR}/*.txt is a breaking change, not a test to update.\n` +
      `  If a seed's markup moved, fix the code. If the move is intended,\n` +
      `  it belongs in a new generation.\n\n` +
      `  bun scripts/golden.ts --write`,
  );
  process.exit(1);
}

const path = `${DIR}/gen2.txt`;
const hashes = [...cases()].map(([label, svg]) => [label, hash(svg)] as [string, string]);
const renders = markup();
const text = serialize({ histogram: histogram(), markup: renders, hashes }, "gen2");
await Bun.write(path, text);
console.log(
  `✓ ${path}\n` +
    `  ${hashes.length} hashed cases, ${renders.length} full renders, ` +
    `${(text.length / 1024).toFixed(1)} KB`,
);
