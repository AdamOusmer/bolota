// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

export type Put = (el: Element, key: string, value: string | number | null) => boolean;

/**
 * A writer of attributes, and of custom properties for keys starting `--`,
 * that skips a write equal to the last one it made there. `null` removes.
 * Returns whether anything was written. Each caller keeps its own, so a
 * mount that is torn down and redone on the same element starts clean.
 */
export function putter(): Put {
  const written = new WeakMap<Element, Record<string, string | number | null>>();
  return (el, key, value) => {
    let seen = written.get(el);
    if (!seen) written.set(el, (seen = Object.create(null) as Record<string, string | number | null>));
    if (key in seen && seen[key] === value) return false;
    seen[key] = value;
    if (key.startsWith("--")) {
      const style = (el as SVGElement).style;
      if (value === null) style.removeProperty(key);
      else style.setProperty(key, String(value));
    } else if (value === null) el.removeAttribute(key);
    else el.setAttribute(key, String(value));
    return true;
  };
}
