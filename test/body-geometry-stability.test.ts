import { describe, expect, test } from "bun:test";
import { blobatar } from "../src/blobatar";

/**
 * Pinned regression guard, prompted by a user report: seed "anna" appeared
 * to render a different silhouette than before, suspected as the bloub
 * engine work leaking into the static renderer. It wasn't — `src/engine.ts`
 * and `src/bloub/` are a separate render path from `blobatar()`/`parts()`
 * (`styles/compose.ts`'s own `render()`), and nothing in this fork's session
 * touched `styles/blob.ts`'s `BANDS` table (last changed at `bf26067 feat:
 * release v2`, upstream, before this fork's first commit `acb549c`). The
 * mismatch the report compared against was `blobatar@1.0.0` from npm — gen1,
 * a different major with a different shape vocabulary entirely. Verified
 * directly: `anna`'s body is byte-identical between `acb549c` (this fork's
 * first commit, before any eye or engine work) and current HEAD.
 *
 * These three fixtures are exactly that comparison, pinned so it stays true:
 * the `<g fill="...">` body group only — eyes are the *only* sanctioned
 * diff (the capsule-eye rework), and this file does not look at them.
 */
function bodyGroup(svg: string): string {
  return svg.match(/<g fill="[^"]+">(?:(?!<\/g>).)*<\/g>/)![0];
}

const PINNED_BODY: Record<string, string> = {
  anna:
    '<g fill="#d8c6ff"><path d="M30.67 40.52L47.34 19.93Q50.05 16.58 52.76 19.93L69.43 40.52Z"/><path d="M75.1 56.57C75.1 70.56 63.88 81.91 50.05 81.91C36.21 81.91 25 70.56 25 56.57C25 42.58 36.21 31.24 50.05 31.24C63.88 31.24 75.1 42.58 75.1 56.57Z"/></g>',
  alain:
    '<g fill="#d0d897"><path d="M88.1 50.49C88.1 73.31 73.75 87.6 50.83 87.6C27.91 87.6 13.56 73.31 13.56 50.49C13.56 27.67 27.91 13.39 50.83 13.39C73.75 13.39 88.1 27.67 88.1 50.49Z"/></g>',
  mavey:
    '<g fill="#afae3b"><path d="M83.74 49.73C83.74 70.55 71.53 81.83 49 81.83C26.47 81.83 14.26 70.55 14.26 49.73C14.26 28.9 26.47 17.62 49 17.62C71.53 17.62 83.74 28.9 83.74 49.73Z"/></g>',
};

describe("body geometry is byte-stable vs. this fork's pre-eye-rework commit", () => {
  for (const [seed, expected] of Object.entries(PINNED_BODY)) {
    test(`"${seed}"`, () => {
      const svg = blobatar(seed, { background: false });
      expect(bodyGroup(svg)).toBe(expected);
    });
  }
});
