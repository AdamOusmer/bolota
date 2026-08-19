/**
 * The fixture's on-disk form.
 *
 * Line-oriented and tab-separated, because the fixture's job is to fail
 * *legibly*: the thing somebody sees when this breaks is a `git diff`, and a
 * format git can line up beats one that is cheaper to parse. Sections are
 * ordered smallest-first for the same reason — the histogram is a dozen lines
 * and usually says everything, so it goes where a reader looks first.
 */

export type Section = "histogram" | "markup" | "hashes";

/**
 * 16 hex characters of SHA-256 over the markup.
 *
 * Truncated because this is a tripwire, not a signature: the fixture and the
 * code it describes live in the same repository, so there is no adversary and
 * nothing to forge. 64 bits makes an accidental collision — two different
 * renders hashing equal, and the change going unnoticed — impossible to reach
 * with the thousand entries here.
 */
export function hash(markup: string): string {
  return new Bun.CryptoHasher("sha256").update(markup).digest("hex").slice(0, 16);
}

const HEADER = (gen: string) => `# blobatar — ${gen} golden fixture
#
# Every line here is a promise: this seed renders this markup, and it always
# will. A diff in this file is a *breaking change* — it means somebody's avatar
# changed identity — so it is never fixed by regenerating. Fix the code, or if
# the move is deliberate, it belongs in a new generation rather than in this
# file. See docs/adr/0006 and test/golden/corpus.ts.
#
# Regenerate deliberately, never as a reflex:
#   bun scripts/golden.ts --write`;

export function serialize(
  parts: Record<Section, [string, string | number][]>,
  gen: string,
): string {
  const section = (name: Section) =>
    `[${name}]\n` + parts[name].map(([k, v]) => `${k}\t${v}`).join("\n");

  return (
    `${HEADER(gen)}\n\n` +
    (["histogram", "markup", "hashes"] as const).map(section).join("\n\n") +
    "\n"
  );
}

export function parse(text: string): Record<Section, Map<string, string>> {
  const out: Record<Section, Map<string, string>> = {
    histogram: new Map(),
    markup: new Map(),
    hashes: new Map(),
  };

  let current: Section | null = null;
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      current = line.slice(1, -1) as Section;
      if (!(current in out)) throw new Error(`unknown fixture section ${line}`);
      continue;
    }
    if (!current) throw new Error(`fixture line outside any section: ${line}`);
    // `split` with a limit drops the rest; markup contains no tabs but may
    // contain anything else, so the first tab is the separator and the
    // remainder is the value verbatim.
    const tab = line.indexOf("\t");
    if (tab === -1) throw new Error(`fixture line has no tab: ${line}`);
    out[current].set(line.slice(0, tab), line.slice(tab + 1));
  }
  return out;
}
