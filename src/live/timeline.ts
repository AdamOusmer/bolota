// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import type { Pose } from "../morph";
import { IDLE_ACT, blendAct, setAct, type Act } from "./act";
import type { DecorFrame } from "./decor";
import {
  CHOREO,
  EXPRESSION_MORPH,
  blendEyes,
  clamp,
  easeInOutCubic,
  easeOutQuint,
  expressed,
  newEyes,
  setEyes,
  type Eyes,
  type StateId,
} from "./choreo";

/**
 * State playback as a pure function of the command log and the time.
 *
 * Two layers of the old engine meet here and are kept as they were: the blend
 * (`BotEngine`: cross-fade over the incoming state's `morph`, freezing a fade
 * that is interrupted, wrapping a looped `period`, stretching a `for` window)
 * and the player (`mountEngine`'s `play`/`tick`: one-shots handing back to the
 * rest state after `duration + hold`, looped states without a `period`
 * restarting every `duration + morph`).
 *
 * One deliberate difference: the player fired its automatic transitions on the
 * first frame at or past their threshold, so when they happened depended on
 * the frame rate. Here they happen at the threshold itself. A driver that
 * samples on frames sees the same thing up to that one frame of latency.
 *
 * Three behaviours of the old pair are corrected, and `test/live-parity.test.ts`
 * holds everything else to it:
 *
 * - Each side of a cross-fade keeps its own looping. The old blend wrapped the
 *   outgoing state with the incoming one's, so a looped `orbit` handed to a
 *   one-shot ran unwrapped for the length of the fade.
 * - A hand-back plays the rest state the way it was last played. A rest
 *   entered by `loop` is still looped after a one-shot over it, so a looped
 *   state without a `period` keeps restarting instead of freezing on its last
 *   frame.
 * - Replaying the current state restarts it, fading from what is on screen,
 *   like any other change. The old player only updated its looping.
 *
 * The eyes carry no lids. Blinks are the renderer's, one system: bloub's
 * blink schedule is the idle blink, and a `blinkIn` entrance fires one more
 * at the moment `blinkCue` reports.
 */

/** `STATE_HOLD` in `../engine.ts`: how long a one-shot dwells before handing back. */
export const HOLD = 0.45;

/** The longest step one frame may advance the clock, in seconds. */
export const MAX_FRAME = 0.034;

/**
 * Seconds a frame at `ms` advances the clock past one at `lastMs`, or 0 for the
 * first frame (`lastMs` of 0). The clamp turns a hitch or a backgrounded tab
 * into slowed time rather than a jump.
 */
export const frameDt = (lastMs: number, ms: number): number =>
  lastMs ? Math.min((ms - lastMs) / 1000, MAX_FRAME) : 0;

export interface PlayOptions {
  /** Repeat until told otherwise; the state becomes the rest state. */
  loop?: boolean;
  /** Seconds to dwell on the finished pose before handing back. */
  hold?: number;
  /** Where a one-shot hands back to. Defaults to the current rest state. */
  rest?: StateId;
  /** A window to fill, in seconds, when longer than the state. */
  for?: number;
}

interface Regs {
  current: StateId;
  stateStart: number;
  loop: boolean;
  rest: StateId;
  /** Whether the rest state was entered by `loop`, so a hand-back loops it again. */
  restLoop: boolean;
  hold: number;
  windowFor: number;
  windowStart: number;
  windowLoop: boolean;

  cur: StateId;
  prev: StateId | null;
  frozen: Act | null;
  frozenEyes: Eyes | null;
  exprFrom: Pose | null;
  exprTo: Pose | null;
  exprAt: number;
  tCur: number;
  tPrev: number;
  looping: boolean;
  /** The outgoing state's own looping, which its side of the fade keeps. */
  loopingPrev: boolean;
  stretchOf: StateId | null;
  stretchBy: number;
}

function local(r: Regs, id: StateId, elapsed: number, looping: boolean): number {
  const period = CHOREO[id].period;
  const t = id === r.stretchOf ? elapsed * r.stretchBy : elapsed;
  return looping && period ? t % period : t;
}

const blankAct = (): Act => ({ ...IDLE_ACT });

/** What a query builds its answer in before it copies the result out; one per role, since a query is never re-entered. */
const ACT_CUR = blankAct();
const ACT_ORIGIN = blankAct();
const EYES_OWN = newEyes();
const EYES_TO = newEyes();
const EYES_FROM = newEyes();
const EYES_CUR = newEyes();
const EYES_ORIGIN = newEyes();

function posed(r: Regs, id: StateId, since: number, looping: boolean, out: Act): Act {
  return CHOREO[id].act(local(r, id, Math.max(0, since), looping), out);
}

function composed(r: Regs, now: number, out: Act): Act {
  const since = now - r.tCur;
  const act = posed(r, r.cur, since, r.looping, ACT_CUR);
  const morph = CHOREO[r.cur].morph;
  if (since >= morph) return setAct(out, act);
  const origin = r.frozen ?? (r.prev ? posed(r, r.prev, now - r.tPrev, r.loopingPrev, ACT_ORIGIN) : null);
  if (!origin) return setAct(out, act);
  return blendAct(origin, act, easeOutQuint(clamp(since / morph)), out);
}

/** A state's eyes with the held expression shown through, mid-change included. */
function posedEyes(r: Regs, id: StateId, since: number, now: number, looping: boolean, out: Eyes): Eyes {
  const c = CHOREO[id];
  const own = c.eyes(local(r, id, Math.max(0, since), looping), EYES_OWN);
  const to = expressed(c, own, r.exprTo, EYES_TO);
  const k = clamp((now - r.exprAt) / EXPRESSION_MORPH);
  if (r.exprFrom === r.exprTo || k >= 1) return setEyes(out, to);
  return blendEyes(expressed(c, own, r.exprFrom, EYES_FROM), to, easeInOutCubic(k), out);
}

/** The eyes on screen: the same cross-fade as `composed`. */
function composedEyes(r: Regs, now: number, out: Eyes): Eyes {
  const since = now - r.tCur;
  const morph = CHOREO[r.cur].morph;
  if (since >= morph) return posedEyes(r, r.cur, since, now, r.looping, out);
  const eyes = posedEyes(r, r.cur, since, now, r.looping, EYES_CUR);
  const origin = r.frozenEyes ?? (r.prev ? posedEyes(r, r.prev, now - r.tPrev, now, r.loopingPrev, EYES_ORIGIN) : null);
  return origin ? blendEyes(origin, eyes, easeOutQuint(clamp(since / morph)), out) : setEyes(out, eyes);
}

/**
 * Only an interrupted fade freezes its origin. Freezing on every change would
 * stop the outgoing state dead for the whole fade, when outside a fade it is
 * already exactly what is on screen.
 */
function setState(r: Regs, id: StateId, now: number, loop: boolean): void {
  const midMorph = r.prev !== null && now - r.tCur < CHOREO[r.cur].morph;
  r.frozen = midMorph ? composed(r, now, blankAct()) : null;
  r.frozenEyes = midMorph ? composedEyes(r, now, newEyes()) : null;
  r.prev = r.cur;
  r.tPrev = r.tCur;
  r.loopingPrev = r.looping;
  r.cur = id;
  r.tCur = now;
  r.looping = loop;
}

function stretch(r: Regs, id: StateId | null, scale: number): void {
  r.stretchOf = id;
  r.stretchBy = scale > 0 ? scale : 1;
}

function restartPeriod(r: Regs): number {
  const c = CHOREO[r.current];
  return r.loop && !c.period ? c.duration + c.morph : 0;
}

function framed(into: DecorFrame[], i: number, state: StateId, at: number, weight: number): void {
  const f = into[i];
  if (f) {
    f.state = state;
    f.local = at;
    f.weight = weight;
  } else into[i] = { state, local: at, weight };
}

/** Whether `advance` would apply a transition by `now`. */
function ready(r: Regs, now: number): boolean {
  const period = restartPeriod(r);
  return period ? Math.floor((now - r.stateStart) / period) >= 1 : due(r) <= now;
}

/** `from` copied into `into`, or into a new record when there is none yet. */
function copyRegs(into: Regs | null, from: Regs): Regs {
  if (!into) return { ...from };
  into.current = from.current;
  into.stateStart = from.stateStart;
  into.loop = from.loop;
  into.rest = from.rest;
  into.restLoop = from.restLoop;
  into.hold = from.hold;
  into.windowFor = from.windowFor;
  into.windowStart = from.windowStart;
  into.windowLoop = from.windowLoop;
  into.cur = from.cur;
  into.prev = from.prev;
  into.frozen = from.frozen;
  into.frozenEyes = from.frozenEyes;
  into.exprFrom = from.exprFrom;
  into.exprTo = from.exprTo;
  into.exprAt = from.exprAt;
  into.tCur = from.tCur;
  into.tPrev = from.tPrev;
  into.looping = from.looping;
  into.loopingPrev = from.loopingPrev;
  into.stretchOf = from.stretchOf;
  into.stretchBy = from.stretchBy;
  return into;
}

/** When the next automatic transition fires, from these registers. */
function due(r: Regs): number {
  const period = restartPeriod(r);
  if (period) return r.stateStart + period;
  if ((r.loop && !r.windowLoop) || r.current === r.rest) return Infinity;
  const end = r.stateStart + (CHOREO[r.current].duration + r.hold);
  return r.windowFor === 0 ? end : Math.max(end, r.windowStart + r.windowFor);
}

/**
 * Applies every automatic transition up to and including `now`. A looped
 * restart cuts all history, so only the last one before `now` matters and it
 * is found in closed form, however far `now` is.
 */
function advance(r: Regs, now: number): void {
  while (step(r, now));
}

/** Applies the next automatic transition if it is due by `now`; whether one was. */
function step(r: Regs, now: number): boolean {
  const period = restartPeriod(r);
  if (period) {
    const k = Math.floor((now - r.stateStart) / period);
    if (k < 1) return false;
    const at = r.stateStart + k * period;
    r.cur = r.current;
    r.prev = null;
    r.frozen = null;
    r.frozenEyes = null;
    r.tCur = at;
    r.tPrev = at;
    r.looping = false;
    r.stateStart = at;
    return true;
  }
  const at = due(r);
  if (at > now) return false;
  r.current = r.rest;
  r.stateStart = at;
  r.loop = r.restLoop;
  r.windowFor = 0;
  r.windowLoop = false;
  stretch(r, null, 1);
  setState(r, r.rest, at, r.restLoop);
  return true;
}

function play(r: Regs, id: StateId, o: PlayOptions, now: number): void {
  const c = CHOREO[id];
  r.current = id;
  r.stateStart = now;
  r.loop = !!o.loop;
  r.hold = Math.max(0, o.hold ?? HOLD);
  r.windowStart = now;
  const asked = r.loop ? 0 : Math.max(0, o.for ?? 0);
  // A window shorter than the state is a floor already met.
  r.windowFor = asked > c.duration ? asked : 0;
  const stretching = r.windowFor > 0 && !c.period && c.fill !== "hold";
  stretch(r, stretching ? id : null, stretching ? c.duration / r.windowFor : 1);
  // A periodic state fills a window by running on, so it needs its wrap, and
  // hands back on a whole number of periods where the wrap is seamless.
  r.windowLoop = r.windowFor > 0 && !!c.period;
  if (r.windowLoop) r.windowFor = Math.ceil(r.windowFor / c.period!) * c.period!;
  const rest = o.rest ?? (r.loop ? id : r.rest);
  r.restLoop = r.loop ? true : rest === r.rest && r.restLoop;
  r.rest = rest;
  setState(r, id, now, r.loop || r.windowLoop);
}

/**
 * Commands go in with the time they happen, in order; `sample` reads the act at
 * any time, past ones included, without changing anything. Each command keeps a
 * snapshot of the registers it left, so a sample replays only the automatic
 * transitions since the last command before it.
 */
export class Timeline {
  private readonly log: { at: number; regs: Regs }[];

  constructor(initial: StateId = "idle") {
    this.log = [
      {
        at: -Infinity,
        regs: {
          current: initial,
          stateStart: 0,
          loop: false,
          rest: initial,
          restLoop: false,
          hold: HOLD,
          windowFor: 0,
          windowStart: 0,
          windowLoop: false,
          cur: initial,
          prev: null,
          frozen: null,
          frozenEyes: null,
          exprFrom: null,
          exprTo: null,
          exprAt: 0,
          tCur: 0,
          tPrev: 0,
          looping: false,
          loopingPrev: false,
          stretchOf: null,
          stretchBy: 1,
        },
      },
    ];
  }

  /**
   * Forgets the commands no sample at `now` or later can reach: every entry
   * before the last one at or before `now`, which already holds their whole
   * effect. Samples earlier than `now` are undefined afterwards.
   */
  release(now: number): void {
    let i = this.log.length - 1;
    while (i > 0 && this.log[i]!.at > now) i--;
    if (i > 0) this.log.splice(0, i);
  }

  private seen: Regs | null = null;
  private seenAt = NaN;
  private seenFrom: Regs | null = null;

  /** The registers at `now`, to read and never to change: a command's own entry when nothing is due since, else one reused copy. */
  private at(now: number): Regs {
    let i = this.log.length - 1;
    while (i > 0 && this.log[i]!.at > now) i--;
    const base = this.log[i]!.regs;
    if (!ready(base, now)) return base;
    if (this.seenAt === now && this.seenFrom === base) return this.seen!;
    const r = (this.seen = copyRegs(this.seen, base));
    advance(r, now);
    this.seenAt = now;
    this.seenFrom = base;
    return r;
  }

  private command(now: number, apply: (r: Regs) => void): void {
    if (now < this.log[this.log.length - 1]!.at) {
      throw new RangeError(`Timeline: command at ${now} is earlier than the last one`);
    }
    let i = this.log.length - 1;
    while (i > 0 && this.log[i]!.at > now) i--;
    const r = { ...this.log[i]!.regs };
    advance(r, now);
    apply(r);
    this.log.push({ at: now, regs: r });
  }

  play(id: StateId, now: number, o: PlayOptions = {}): void {
    this.command(now, (r) => play(r, id, o, now));
  }

  /**
   * Holds an expression pose, or clears it with `null`. Seen only on states
   * that let one through; the change glides over `EXPRESSION_MORPH` and, as in
   * bloub, a change mid-glide starts from the old target rather than from
   * where the glide had got to.
   */
  express(pose: Pose | null, now: number): void {
    this.command(now, (r) => {
      if (pose === r.exprTo) return;
      r.exprFrom = r.exprTo;
      r.exprTo = pose;
      r.exprAt = now;
    });
  }

  /** The state the player is on at `now`, hand-backs included. */
  state(now: number): StateId {
    return this.at(now).current;
  }

  /** When the next automatic transition after `now` fires, or `Infinity`. */
  next(now: number): number {
    return due(this.at(now));
  }

  /** The act at `now`, written into `out` when a caller that samples every frame brings one. */
  sample(now: number, out: Act = blankAct()): Act {
    return composed(this.at(now), now, out);
  }

  /**
   * What decor draws at `now`: the current state, and during its entrance the
   * outgoing one, weighted by the same curve `sample` blends the act on.
   * `into` is refilled and returned in place of a new array.
   */
  decorFrames(now: number, into: DecorFrame[] = []): DecorFrame[] {
    const r = this.at(now);
    const since = now - r.tCur;
    const morph = CHOREO[r.cur].morph;
    const here = Math.max(0, since);
    if (since >= morph || !r.prev) {
      framed(into, 0, r.cur, local(r, r.cur, here, r.looping), 1);
      into.length = 1;
      return into;
    }
    const k = easeOutQuint(clamp(since / morph));
    framed(into, 0, r.prev, local(r, r.prev, Math.max(0, now - r.tPrev), r.loopingPrev), 1 - k);
    framed(into, 1, r.cur, local(r, r.cur, here, r.looping), k);
    into.length = 2;
    return into;
  }

  /** The eyes at `now`, blended alongside the act, written into `out` when given. */
  eyes(now: number, out: Eyes = newEyes()): Eyes {
    return composedEyes(this.at(now), now, out);
  }

  /**
   * When a `blinkIn` state was entered in `(from, to]`, or `null`: the moment a
   * renderer fires the entrance blink. A looped restart is not an entrance.
   */
  blinkCue(from: number, to: number): number | null {
    const r = this.at(to);
    return r.prev !== null && CHOREO[r.cur].blinkIn && r.tCur > from && r.tCur <= to ? r.tCur : null;
  }
}
