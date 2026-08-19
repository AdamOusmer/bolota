/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * The 14-state animation catalog (idle, thinking, orbit, burst, comet, ...). Not adapted — see ../engine.ts for the blobatar-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic, comments and variable names (French, in the original) are
 * untouched beyond TS-strict fixes and import paths.
 */
import {
  COMET_DOT,
  COMET_RIBBONS,
  DOT_PEAK,
  DOT_R,
  DOT_X,
  NOTIF_ANGLE,
  NOTIF_DIST,
  NOTIF_MARGIN,
  NOTIF_POP,
  NOTIF_R,
  RINGS,
  SWOOSH,
  particles,
  type ArcSpec,
  type DotRender
} from './decor'
import { EYE_H, EYE_SPLIT, EYE_W, REST_GAZE, type HeadGaze } from './face'
import { TAU, clamp, easings } from './math'
import {
  circle,
  hullOfCircles,
  polyPath,
  profileFromPolygon,
  silhouette,
  type Silhouette
} from './shape'

export interface EyeCfg {
  /** largeur locale (axe court de la gelule), en unites de rayon de boule */
  w: number
  /** hauteur locale (axe long) */
  h: number
  /** 1 = ouvert, 0 = ferme */
  open: number
  /**
   * Inclinaison propre de la gelule, en degres, positif = le haut part a
   * droite. Appliquee APRES le repere tangent de la sphere. Sans elle, les deux
   * yeux penchent forcement du meme cote (le roulis de tete) et la colere comme
   * la tristesse, qui demandent des inclinaisons en miroir, sont hors de portee.
   */
  tilt?: number
}

export interface Pose {
  /** silhouette du corps, en unites de rayon de boule */
  sil: Silhouette
  /** decalage global du corps ET des yeux */
  offX: number
  offY: number
  gaze: HeadGaze
  /** demi-ecart des yeux sur la sphere, en degres */
  split: number
  /** [oeil interieur, oeil exterieur] */
  eyes: [EyeCfg, EyeCfg]
  /** opacite des yeux : sert aux etats sans visage */
  eyeAlpha: number
  bodyAlpha: number
  dots: DotRender[]
  arcs: ArcSpec[]
  notif: { x: number; y: number; r: number; notch: number } | null
  /** true = le decor passe derriere le corps (particules de l'eclatement) */
  dotsBehind: boolean
}

const pair = (w: number, h: number): [EyeCfg, EyeCfg] => [
  { w, h, open: 1 },
  { w, h, open: 1 }
]

function base(over: Partial<Pose> = {}): Pose {
  return {
    sil: circle(1),
    offX: 0,
    offY: 0,
    gaze: { ...REST_GAZE },
    split: EYE_SPLIT,
    eyes: pair(EYE_W, EYE_H),
    eyeAlpha: 1,
    bodyAlpha: 1,
    dots: [],
    arcs: [],
    notif: null,
    dotsBehind: false,
    ...over
  }
}

/* --------------------------------------------------- formes non radiales */

/**
 * Barre du "!" vertical : enveloppe convexe de deux cercles.
 * Mesure : cercle haut (0, -0.505) r 0.132, cercle bas (0, +0.130) r 0.075,
 * flancs rectilignes. Elle est donc tronconique (rapport haut/bas 1.76).
 */
const BAR_UPRIGHT_CY = -0.1875
const BAR_UPRIGHT = profileFromPolygon(
  hullOfCircles(0, -0.505, 0.132, 0, 0.13, 0.075),
  0,
  BAR_UPRIGHT_CY
)

/** Barre du "!" penche : capsule pure (largeur constante 0.269, longueur 0.776). */
const BAR_ITALIC = profileFromPolygon(hullOfCircles(0, -0.2535, 0.1345, 0, 0.2535, 0.1345), 0, 0)

const barUpright = (pose: Partial<Silhouette> = {}): Silhouette => ({
  radii: [...BAR_UPRIGHT],
  rot: 0,
  cx: 0,
  cy: BAR_UPRIGHT_CY,
  sx: 1,
  sy: 1,
  ...pose
})

const barItalic = (pose: Partial<Silhouette> = {}): Silhouette => ({
  radii: [...BAR_ITALIC],
  rot: 0,
  cx: 0,
  cy: 0,
  sx: 1,
  sy: 1,
  ...pose
})

/**
 * Le point du "!" penche n'est pas un disque : c'est une goutte, bout rond
 * (r 0.118) du cote de la barre et pointe effilee a l'oppose, longueur 0.300
 * dans l'axe du glyphe. Centree sur le barycentre du bout rond.
 */
const TEAR = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012))

/**
 * Le triangle ne tourne pas sur lui-meme : son centre decrit un cercle de
 * rayon 0.213 autour de l'origine (mesure). C'est ce decalage qui donne
 * l'impression qu'il bascule au lieu de pivoter sur place.
 */
const TRI_ORBIT = 0.213

/**
 * blobatar addition: `orbit`'s loop phase — 4 whole revolutions at the
 * state's own measured 1.25 rev/s (`4 / 1.25`), so `rot` (and everything
 * trig-derived from it) is back at its `t = 0` value, exactly, when the
 * phase wraps. See `StateDef.period` and the `orbit` entry below for the
 * rest of the mechanism this feeds.
 */
export const ORBIT_PERIOD = 4 / 1.25

function spinningTriangle(rot: number): Silhouette {
  return silhouette('triangle', {
    rot,
    cx: -TRI_ORBIT * Math.sin(rot),
    cy: TRI_ORBIT * Math.cos(rot)
  })
}

/* ------------------------------------------------------------------ etats */

export type StateId =
  | 'idle'
  | 'thinking'
  | 'wink'
  | 'wide'
  | 'alert'
  | 'notify'
  | 'exclaim'
  | 'snooze'
  | 'play'
  | 'orbit'
  | 'burst'
  | 'comet'
  /** transition d'interface, pas une animation du catalogue : hors `SEQUENCE` */
  | 'swirl'

export interface StateDef {
  id: StateId
  /** duree de maintien quand la sequence complete est jouee */
  duration: number
  /**
   * duree en dessous de laquelle l'animation est coupee avant d'aboutir : le
   * "!" ne revient pas, le corps reste eclate. Elle se lit dans les constantes
   * de `pose` ci-dessous, elle ne se choisit pas. Absente = l'etat ignore le
   * temps ou boucle, n'importe quelle duree lui va (voir `MIN_BLOCK`).
   */
  minDuration?: number
  /** duree du morph d'entree */
  morph: number
  /** true = l'entree est masquee par un clignement, comme dans la video */
  blinkIn: boolean
  /**
   * true = le corps est la silhouette "au repos", donc remplacable par la forme
   * choisie dans le personnalisateur. Les etats qui dessinent leur propre forme
   * (le "!", les points, l'oeuf, le triangle...) valent false : c'est cette forme
   * la qui EST l'animation.
   */
  baseBody: boolean
  /**
   * true = l'etat porte le visage "au repos", donc remplacable par l'expression
   * choisie. Seul `idle` : les autres etats a visage ont une expression relevee
   * sur la video, c'est precisement ce qu'on reproduit.
   */
  baseFace: boolean
  /**
   * blobatar addition (not from bloub — every other flag on this interface
   * is verbatim): true = this state's own `pose(t)` already animates gaze
   * and/or body position (`sil.cx/cy` via `offX/offY`) itself, so idle's
   * background liveliness (`face.ts`'s wander/drift/breath) must contribute
   * NOTHING while it plays — composing idle's own gaze noise or center
   * float on top of a state that is already driving those same channels is
   * exactly the arbitration bug `follow` vs `idle` had (`gaze.ts`), just
   * between `idle`'s wander and a *different* active state instead of the
   * cursor. `orbit` is the only state this applies to today (`gaze.yaw`
   * swings +-65deg via its own `sin(t*6.5)`, `sil.cx/cy` recenters every
   * frame) — every other state's `gaze`/`sil.cx/cy` is a constant for its
   * whole duration and NEEDS idle's wander, or it would read as frozen
   * apart from blinking. Blink and breathing are unaffected either way:
   * blink is independent of `wander` already (gated on `eyeAlpha` alone,
   * see `bloub/engine.ts`'s `sample()`), and this flag zeroes breathing
   * too (`float`) only because `orbit`'s own silhouette scale animation
   * (triangle collapsing to ball) already fills that role — a second,
   * uncoordinated size wobble on top would be the same bug again.
   * Defaults to false/absent, i.e. bloub's own unconditional-wander
   * behavior, for every state that doesn't opt in.
   */
  ownsLiveliness?: boolean
  /**
   * blobatar addition (not from bloub): the phase length this state repeats
   * on when played with `loop: true`. Absent = not loop-safe as a single
   * timeline (the caller's existing periodic-`reset()` bridge mechanism
   * still handles it, unchanged); present = `BotEngine.sample()` itself
   * wraps the local clock to `[0, period)` BEFORE calling `pose()`, so this
   * function only ever sees a value in that range while looping. That is
   * the whole mechanism: EVERY channel `pose()` returns — silhouette,
   * gaze, rings, dots, whatever — is a function of that one wrapped
   * number, so nothing downstream can wrap on its own schedule and drift
   * out of phase with anything else (`orbit`'s old per-channel `t % 3.6`
   * ring-fade band-aid, replaced by this, is the bug this prevents: ONE
   * wrap point, upstream of every channel, not one per channel hoping they
   * agree).
   *
   * The value itself must make every one of `pose()`'s own periodic terms
   * land back where they started at `t = period` — `orbit`'s `ORBIT_PERIOD`
   * (its own comment) is the worked example: chosen as a whole number of
   * its rotation's own period so the wrap is exact, not approximate.
   */
  period?: number
  pose(local: number): Pose
}

/** Onde de pulsation qui parcourt les trois points de gauche a droite. */
function dotPulse(t: number, index: number): number {
  const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1
  const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0
  return clamp(k * 2)
}

export const STATES: StateDef[] = [
  {
    id: 'idle',
    duration: 2.4,
    morph: 0.45,
    blinkIn: false,
    baseFace: true,
    baseBody: true,
    pose: () => base()
  },

  {
    id: 'thinking',
    duration: 2.6,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    // blobatar eye-visibility audit (see `burst`/`comet` below for the cases that
    // DID change): left at `eyeAlpha: 0`, deliberately. The body does not shrink
    // toward a face here, it BECOMES one of the three dots (comment below, and
    // `sil` reuses the dot's own radius/position) — same size and shape as its two
    // un-eyed siblings. There is no face plane left to anchor a pair of capsule
    // eyes to; forcing them on would mean drawing eyes floating over a plain dot
    // indistinguishable from the decor either side of it, not "keeping the avatar's
    // identity," so this is the "truly impossible" case the fix explicitly carves
    // out. The pop this state's own entry/exit would otherwise have is still
    // covered: `BotEngine.sample`'s state-transition cross-fade (`blendPose`,
    // eased) ramps `eyeAlpha` over the transition `morph`, so going in and out of
    // `thinking` fades rather than pops even though this pose itself never turns
    // the eyes back on.
    pose: (t) => {
      const mid = dotPulse(t, 1)
      // Les points lateraux sortent des flancs de la boule : dans la video ils
      // restent fusionnes avec elle 1-2 frames avant de se detacher.
      const emerge = 0.3 + 0.7 * easings.easeOutCubic(clamp(t / 0.3))
      return base({
        // la boule DEVIENT le point du milieu : le morph reste continu
        sil: circle(DOT_R * (1 + (DOT_PEAK - 1) * mid), { cx: DOT_X[1]! }),
        eyeAlpha: 0,
        dots: [0, 2].map((i) => {
          const k = dotPulse(t, i)
          return {
            x: DOT_X[i]! * emerge,
            y: 0,
            r: DOT_R * (1 + (DOT_PEAK - 1) * k),
            opacity: 0.55 + 0.45 * k
          }
        })
      })
    }
  },

  {
    id: 'wink',
    duration: 1.6,
    morph: 0.3,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: () =>
      base({
        gaze: { yaw: -5.37, pitch: 4.55, roll: 6.7 },
        split: 16.25,
        // L'oeil ferme n'est pas l'oeil ouvert ecrase : c'est un tiret
        // horizontal PLUS LARGE que l'oeil ouvert (0.447 contre 0.236).
        eyes: [
          { w: 0.236, h: 0.464, open: 1 },
          { w: 0.447, h: 0.089, open: 1 }
        ]
      })
  },

  {
    id: 'wide',
    duration: 1.8,
    morph: 0.55,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: () =>
      base({
        gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 },
        split: 18.43,
        eyes: pair(0.356, 0.875)
      })
  },

  {
    id: 'alert',
    duration: 2.4,
    // le "!" revient en place a 1.6 + 0.4
    minDuration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // blobatar eye-visibility audit: left at `eyeAlpha: 0`. `sil` here is
    // `barItalic` — a thin italic glyph bar, not a round body — there is no face
    // plane for a pair of capsule eyes to sit on. Truly impossible, not overlooked;
    // covered by the same cross-fade as `thinking` above.
    pose: (t) => {
      // Course mesuree : -0.087 -> +0.732 en 1.5 s, ease-in-out, micro-overshoot.
      const p = clamp(t / 1.5)
      const travel = easings.easeInOutCubic(p) * 0.82 - 0.087
      const back = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0
      const x = travel * (1 - back) + 0.1 * back
      // Vibration secondaire a 2.5 Hz, barre et point en opposition de phase.
      const buzz = Math.sin(t * 2.5 * TAU) * 0.005
      const tilt = (17.7 * Math.PI) / 180
      return base({
        sil: barItalic({ rot: tilt, cx: x, cy: -0.325 - buzz }),
        eyeAlpha: 0,
        dots: [
          {
            // le point suit l'axe du glyphe, a 0.580 du centre de la barre
            x: x - Math.sin(tilt) * 0.58,
            y: -0.325 + Math.cos(tilt) * 0.58 + buzz * 2.8,
            r: 0.118,
            d: TEAR,
            rot: (tilt * 180) / Math.PI,
            opacity: 1
          }
        ]
      })
    }
  },

  {
    id: 'notify',
    duration: 2.2,
    morph: 0.5,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: (t) => {
      // Pop du point bleu : pic a +14 % vers 0.3 s puis stabilisation.
      const p = clamp(t / 0.45)
      const pop = 1 + (NOTIF_POP - 1) * Math.sin(p * Math.PI) * (1 - p * 0.35)
      const r = NOTIF_R * (p < 1 ? pop : 1)
      const a = (NOTIF_ANGLE * Math.PI) / 180
      return base({
        // le regard part a l'oppose de la pastille
        gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 },
        split: 18.89,
        eyes: pair(0.505, 0.498),
        notif: {
          x: Math.cos(a) * NOTIF_DIST,
          y: Math.sin(a) * NOTIF_DIST,
          r,
          notch: r + NOTIF_MARGIN
        }
      })
    }
  },

  {
    id: 'exclaim',
    duration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // blobatar eye-visibility audit: left at `eyeAlpha: 0` — same reasoning as
    // `alert`, `sil` is `barUpright()`, a bar glyph with no face plane.
    pose: () =>
      base({
        sil: barUpright(),
        eyeAlpha: 0,
        dots: [{ x: -0.012, y: 0.526, r: 0.113, opacity: 1 }]
      })
  },

  {
    // Renamed from bloub's original id `sleep` to `snooze` (user-sanctioned
    // divergence from verbatim): this package also has an eye EXPRESSION
    // named `sleepy` (unrelated, untouched), and the two names side by side
    // read as the same concept when they are not — this is a body-morph
    // STATE, not a face expression. Original bloub keeps `sleep`; see
    // github.com/AdamOusmer/bloub for the unrenamed fork this was ported
    // from.
    id: 'snooze',
    duration: 2.4,
    morph: 0.5,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // blobatar eye-visibility audit: left at `eyeAlpha: 0`, but for a different
    // reason than `thinking`/`alert`/`exclaim` above — `sil` here IS still a round
    // body (a small bouncing ball), so a face plane exists. This is the one state
    // where "no eyes" is the correct read regardless: the bot is asleep, and closed
    // eyes are what "asleep" means — showing open eyes here would read as a bug in
    // the other direction. Not changed.
    pose: (t) =>
      base({
        // Rebond vertical mesure : +-0.19 autour de +0.11, periode 0.6 s.
        sil: circle(0.1585, { cy: 0.11 + Math.sin(t * (TAU / 0.6)) * 0.19 }),
        eyeAlpha: 0
      })
  },

  // `egg` and `hexagon` removed from the catalog (user decision): both were
  // shape-swap states (`silhouette('egg')`/`silhouette('hexagon')`, a
  // static named profile for their whole duration, no radius variation),
  // which is exactly what the seeded-shape enforcement in
  // `bloub/engine.ts`'s `posed()` makes meaningless — after that fix they
  // rendered as an unchanging seeded body with a fixed squint,
  // indistinguishable from idle. Deleted rather than kept unexported: no
  // remaining caller, so there was nothing a provenance comment would have
  // been guarding. Original bloub (both states intact) lives on unrenamed
  // at github.com/AdamOusmer/bloub.

  {
    id: 'play',
    duration: 2,
    morph: 0.5,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: (t) => {
      // Le triangle reste quasi immobile pendant que le bouquet le traverse.
      const fade = clamp(t / 0.35) * clamp((2.2 - t) / 0.5)
      return base({
        sil: spinningTriangle(0),
        gaze: { yaw: 12, pitch: -8, roll: -6 },
        split: 15,
        eyes: pair(0.18, 0.34),
        // le bouquet balaie de la droite vers la gauche par-dessus le triangle
        arcs: SWOOSH.map((s, i) => ({
          id: `sw${i}`,
          seed: { ...s, cx: 0.45 - t * 0.42 },
          t,
          opacity: fade
        }))
      })
    }
  },

  {
    id: 'orbit',
    duration: 3.4,
    morph: 0.6,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // blobatar addition: see `StateDef.ownsLiveliness`'s own comment — this
    // state drives body center (`sil.cx/cy` via `spinningTriangle`) itself,
    // so idle's wander/drift/breath must not also compose on top of it. Gaze
    // no longer needs the same guard: see `ORBIT_PERIOD`'s comment below,
    // the eyes are calm and no longer a moving channel to protect.
    ownsLiveliness: true,
    // blobatar addition: whole revolutions (`1.25 tour/s` below) of the
    // rotation's own rate — 4 turns at 1.25 rev/s. `rot`'s value at
    // `t = ORBIT_PERIOD` is therefore an exact multiple of a full turn,
    // i.e. identical (mod 2*PI) to its value at `t = 0`: `sil.rot` and
    // `sil.cx/cy` (both pure trig functions of `rot` now, see below) land
    // back where they started, exactly, not approximately.
    //
    // This replaced two DIFFERENT bugs a full-channel continuity sweep
    // found, not one. `t % 3.6` on the ring fade alone was the first
    // (git history) — one channel wrapping on a period nothing else
    // respected. The second was subtler and survived that first fix:
    // bloub's own verbatim choreography had the body settle from a
    // spinning TRIANGLE into a plain ball once, over its first ~2.5s (an
    // ease `back` ramp, 0 -> 1, scaling `cx/cy`'s wobble down to a dead
    // stop and blending `radii` from triangle to ball) — correct for a
    // ONE-SHOT playback, but `back(0) = 0` while `back(ORBIT_PERIOD) = 1`
    // (long saturated): looping wrapped `t` straight from "fully settled,
    // cy = 0" back to "just started settling, cy = TRI_ORBIT" every
    // cycle — measured, a same-frame `sil.cy` jump of 0.213 against a
    // mid-cycle max of 0.05, i.e. the actual "eyes keep repinning" report
    // (`sil.cx/cy` is what round 3's fix made the eyes ride). A settle
    // transient fundamentally can't wrap: it has a start and an end that
    // differ on purpose, and looping erases the distinction between "the
    // end of the story" and "the start of it" every cycle.
    //
    // Fix: no settle transient in the loop at all. The wobble is now a
    // pure function of `rot` (`spinningTriangle`'s own `cx/cy`, unscaled)
    // — periodic by construction, for the same reason `rot` itself is,
    // with nothing left to fall out of sync with it. One wrap, upstream of
    // every channel (`BotEngine.sample()`'s `wrapped()`, gated on this
    // field): every term below is simply a function of `t`, already
    // guaranteed to fall in `[0, ORBIT_PERIOD)` while looping, so nothing
    // here needs a modulo of its own.
    period: ORBIT_PERIOD,
    pose: (t) => {
      // Rotation mesuree : 1.25 tour/s (sens antihoraire). Constant-rate,
      // deliberately: a ramp-up here would go back to 0 every loop, briefly
      // slowing the spin down and re-accelerating it each cycle — smooth,
      // but still a recurring hitch a full sweep would flag, and everything
      // this state needs a "wraps clean" story to be free of gets one.
      const rot = -TAU * 1.25 * t
      // Le triangle tourne autour de l'origine (mesure) : c'est ce decalage
      // qui donne l'impression qu'il bascule au lieu de pivoter sur place.
      // `sil.radii`'s own angular shape never reaches the screen either way
      // — `BotEngine.posed()` substitutes the seed's own profile, scaled to
      // this array's mean, for every non-`baseBody` state (see its own doc
      // comment) — so `spinningTriangle` is used here purely for its
      // already-periodic `cx/cy`, not for its triangle.
      const sil = spinningTriangle(rot)
      // Rise over the same 0.8s the rings take to enter, hold, fall over the
      // last 0.9s before the loop wraps — symmetric with the entrance so the
      // wrap point (both fully faded) is where the visual seam already is.
      const fade = clamp(t / 0.8) * clamp((ORBIT_PERIOD - t) / 0.9)
      return base({
        sil,
        // blobatar divergence from verbatim bloub (user-sanctioned, see
        // src/engine.ts's header): bloub's own reference had the eyes race
        // around the sphere ~3x faster than the silhouette (+-65deg yaw,
        // its own separate 6.5rad/s sweep, no relation to `rot`'s 0.8s
        // period or `ORBIT_PERIOD`) — a THIRD independent frequency, and
        // reintroducing it here would put right back the exact class of bug
        // `period` above exists to kill: another channel wrapping (or not
        // wrapping) on its own schedule. It also read as chaotic on its own
        // merits, independent of any phase bug — measured before removal,
        // a single 1/60s frame during the sweep moved an eye center 16+
        // viewBox units on a R=100 ball. Calm, forward, level eyes while
        // the body drifts and the rings do the spectacle instead: fewer
        // moving parts to desync, and readable.
        gaze: { ...REST_GAZE },
        // Constant too (was `0.34 + back * 0.07`, another `back`-driven
        // grow that would have reset every loop) — same reasoning as `rot`
        // and `sil` above, one fewer channel with a start/end to desync.
        eyes: pair(0.18, 0.34),
        // les anneaux entrent un par un sur 0.8 s
        arcs: RINGS.map((s, i) => ({
          id: `rg${i}`,
          seed: s,
          t,
          opacity: fade * clamp((t - i * 0.13) / 0.3)
        }))
      })
    }
  },

  {
    /**
     * Entree dans la vue des reglages.
     *
     * SEUL etat qui n'est pas releve sur la video : il est CHOISI, comme la
     * couleur `--ink`. Il emprunte le vocabulaire d'`orbit` — les memes anneaux,
     * avec leurs parametres mesures — mais coupe court : 1 s au lieu de 3,4, la
     * moitie des anneaux, et aucun triangle.
     *
     * Les deux drapeaux a `true` sont tout l'interet de cet etat :
     *
     * - `baseBody` laisse la forme choisie remplacer le corps, donc la vue peut
     *   imposer le cercle et le galet ou la goutte y MORPHENT au lieu de sauter ;
     * - `baseFace` fait porter le visage de repos, donc le suivi du curseur
     *   s'applique des cette entree. Un etat qui aurait sa propre pose de regard
     *   (comme `orbit`) rendrait la main a l'etat suivant en pleine course, et
     *   les yeux sauteraient d'un coup a la reprise.
     *
     * Il n'est volontairement PAS dans `SEQUENCE` : ce n'est pas une animation du
     * catalogue, c'est une transition d'interface.
     */
    id: 'swirl',
    // un peu plus que le tour du regard (`TURN_TIME`, 1,1 s) : les yeux doivent
    // etre poses a gauche avant que les anneaux ne s'effacent
    duration: 1.3,
    minDuration: 1.3,
    morph: 0.3,
    baseFace: true,
    baseBody: true,
    // le morph de forme est masque par un clignement, comme partout ailleurs
    blinkIn: true,
    pose: (t) =>
      base({
        // trois anneaux sur les six d'`orbit` : la moitie du bouquet suffit a le
        // reconnaitre, et c'est autant d'arcs en moins a rasteriser par image
        arcs: RINGS.slice(0, 3).map((s, i) => ({
          id: `sw${i}`,
          seed: s,
          t,
          // ils entrent l'un apres l'autre puis s'effacent avant la fin du bloc,
          // pour que la reprise au repos se fasse sur une image deja propre
          opacity: clamp((t - i * 0.06) / 0.14) * clamp((1.22 - t) / 0.34)
        }))
      })
  },

  {
    id: 'burst',
    duration: 2.6,
    // le corps est recompose a 1.7 + 0.7
    minDuration: 2.4,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // blobatar eye-visibility audit: unlike `thinking`/`alert`/`exclaim`, `sil`
    // never stops being a circle here — it shrinks to 0.166 of resting radius and
    // regrows, but a face plane exists the whole time. Verbatim bloub hid the eyes
    // from t=0 to 1.85 (85% of the 2.6s duration) and popped them in over the last
    // 0.4s instead. Divergence: `eyeAlpha` now tracks the same `collapse`/`regrow`
    // curve driving the body (`bodyScale` below), floored at 0.18 instead of 0 —
    // the eyes shrink and dim toward the collapse instant exactly as much as the
    // body does (via the existing `bodyRadius` fit in `bloub/engine.ts`'s
    // `sample()`, unchanged), staying faintly present instead of vanishing, then
    // regrow with the body. No new snap: the driving curve is the same
    // `easeOutQuint` already used for `sil`, so alpha and size move together.
    pose: (t) => {
      // Effondrement mesure : 1.0 -> 0.166 en 0.7 s, ease-out, sans rebond.
      const collapse = 1 - 0.834 * easings.easeOutQuint(clamp(t / 0.7))
      const regrow = easings.easeOutQuint(clamp((t - 1.7) / 0.7))
      const bodyScale = collapse + (1 - collapse) * regrow
      return base({
        sil: circle(bodyScale),
        eyeAlpha: 0.18 + 0.82 * bodyScale,
        dots: particles(t, 1),
        dotsBehind: true
      })
    }
  },

  {
    id: 'comet',
    duration: 2.4,
    // le point se recompose a 1.85 + 0.6 = 2.45, soit 0.05 s apres la coupe de
    // la video : ce reliquat se termine pendant le fondu suivant, comme dans la
    // reference. On ne descend donc pas sous la duree mesuree.
    minDuration: 2.4,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // blobatar eye-visibility audit: same case as `burst` above — `sil` shrinks to
    // `COMET_DOT` (0.129 of resting radius, comparable to burst's 0.166) but never
    // stops being a circular body, so a face plane exists throughout. User report
    // named this one explicitly ("comet collapses to a dot"). Same divergence:
    // `eyeAlpha` now tracks `bodyScale` (floored at 0.18) instead of staying at 0
    // until t=2 (83% of the 2.4s duration) and popping in over the last 0.35s.
    // At `COMET_DOT` scale the eyes render tiny — a natural fade by proportion, not
    // a second alpha ramp fighting the geometry.
    pose: (t) => {
      const collapse = 1 - (1 - COMET_DOT) * easings.easeOutQuint(clamp(t / 0.55))
      const regrow = easings.easeOutQuint(clamp((t - 1.85) / 0.6))
      const bodyScale = collapse + (1 - collapse) * regrow
      const fade = clamp((t - 0.15) / 0.25) * clamp((1.95 - t) / 0.3)
      return base({
        // Le point derive de 0.035 vers le bas puis remonte (wobble mesure).
        sil: circle(bodyScale, {
          cy: Math.sin(clamp(t / 1.7) * Math.PI) * 0.035
        }),
        eyeAlpha: 0.18 + 0.82 * bodyScale,
        arcs: COMET_RIBBONS.map((s, i) => ({ id: `cm${i}`, seed: s, t, opacity: fade }))
      })
    }
  }
]

export const STATE_BY_ID = new Map(STATES.map((s) => [s.id, s]))

/** Ordre de lecture de la sequence complete, calque sur la video de reference. */
/**
 * Date, en temps local, ou chaque etat est le plus lisible : c'est la pose que
 * montrent les vignettes et la planche. Rendu deterministe, donc comparable
 * d'une execution a l'autre. Le type force a couvrir tout nouvel etat.
 */
export const POSES: Record<StateId, number> = {
  idle: 1,
  thinking: 1.1,
  wink: 0.8,
  wide: 0.8,
  alert: 0.75,
  notify: 0.9,
  exclaim: 0.8,
  snooze: 0.45,
  play: 0.9,
  orbit: 1.2,
  swirl: 0.5,
  burst: 0.45,
  comet: 1.15
}

export const SEQUENCE: StateId[] = [
  'idle',
  'thinking',
  'wink',
  'wide',
  'alert',
  'notify',
  'exclaim',
  'snooze',
  'play',
  'orbit',
  'burst',
  'comet'
]
