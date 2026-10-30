// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

type Value = string | number | null;

/** One attribute or custom property of one element, and the last value written there. */
export interface Slot {
  /** Writes `value` unless it equals the last one written; whether it wrote. `null` removes. */
  set(value: Value): boolean;
}

export type Put = {
  (el: Element, key: string, value: Value): boolean;
  /** The slot behind `put(el, key, …)`, for a caller that writes the same place every frame. */
  slot(el: Element, key: string): Slot;
};

const UNSET = {};

class Cell implements Slot {
  last: Value | typeof UNSET = UNSET;

  constructor(
    private readonly el: Element,
    private readonly key: string,
    private readonly css: boolean,
  ) {}

  set(value: Value): boolean {
    if (this.last === value) return false;
    this.last = value;
    if (this.css) {
      const style = (this.el as SVGElement).style;
      if (value === null) style.removeProperty(this.key);
      else style.setProperty(this.key, String(value));
    } else if (value === null) this.el.removeAttribute(this.key);
    else this.el.setAttribute(this.key, String(value));
    return true;
  }
}

/**
 * A writer of attributes, and of custom properties for keys starting `--`,
 * that skips a write equal to the last one it made there. `null` removes.
 * Returns whether anything was written. Each caller keeps its own, so a
 * mount that is torn down and redone on the same element starts clean.
 */
export function putter(): Put {
  const cells = new WeakMap<Element, Record<string, Cell>>();
  const slot = (el: Element, key: string): Slot => {
    let row = cells.get(el);
    if (!row) cells.set(el, (row = Object.create(null) as Record<string, Cell>));
    return (row[key] ??= new Cell(el, key, key.startsWith("--")));
  };
  const put = ((el, key, value) => slot(el, key).set(value)) as Put;
  put.slot = slot;
  return put;
}
