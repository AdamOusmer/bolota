/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * Eye placement on the body sphere, blink and idle-life math. Not adapted — see ../engine.ts for the blobatar-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic, comments and variable names (French, in the original) are
 * untouched beyond TS-strict fixes and import paths.
 */
import { clamp, createRng, loopNoise } from './math'

/**
 * Les yeux sont peints sur une sphere, pas poses a plat.
 *
 * Mesure sur la video : l'oeil le plus proche du bord fait 0.69 fois la largeur
 * de l'autre, et son aire 0.663 fois — exactement le facteur de profondeur
 * (z = 0.669) d'un point de sphere a cette distance du centre. On modelise donc
 * une vraie orientation de tete : chaque oeil recupere le repere tangent de la
 * sphere, projete en orthographique. La compression et l'inclinaison en
 * decoulent toutes seules, c'est ce qui donne le volume.
 *
 * Les constantes ci-dessous ne sont pas choisies a la main : elles sortent d'un
 * ajustement du modele sur les positions et tailles relevees image par image
 * (erreur residuelle ~1 px sur un rayon de 190 px).
 */

type Vec3 = [number, number, number]

/** Demi-ecart des yeux sur la sphere, en degres (separation totale ~31deg). */
export const EYE_SPLIT = 15.46
/** Taille de l'oeil au repos, en unites de rayon de boule. */
export const EYE_W = 0.186
export const EYE_H = 0.412

/** Orientation de tete au repos, ajustee sur les frames de reference. */
export const REST_GAZE: HeadGaze = { yaw: 28.49, pitch: 28.62, roll: -13 }

export interface EyePose {
  x: number
  y: number
  /** matrice tangente 2x2 : [a b c d] au sens SVG matrix(a,b,c,d,e,f) */
  a: number
  b: number
  c: number
  d: number
  /** composante z de la normale : > 0 = face visible */
  depth: number
}

export interface HeadGaze {
  /** lacet, degres, positif = regarde a droite */
  yaw: number
  /** tangage, degres, positif = regarde en haut */
  pitch: number
  /** roulis, degres, inclinaison de la tete */
  roll: number
}

const deg = (d: number) => (d * Math.PI) / 180

/** Fait tourner deux vecteurs d'un repere orthonorme dans leur plan commun. */
function spin(u: Vec3, v: Vec3, angle: number): [Vec3, Vec3] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [
    [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s],
    [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s]
  ]
}

/**
 * Repere de la tete puis des deux yeux.
 * Repere ecran : x a droite, y vers le bas, z vers le spectateur.
 * L'indice 0 est l'oeil interieur, l'indice 1 l'oeil exterieur.
 */
export function eyePoses(gaze: HeadGaze, scale: number, split = EYE_SPLIT): [EyePose, EyePose] {
  let f: Vec3 = [0, 0, 1]
  let right: Vec3 = [1, 0, 0]
  let down: Vec3 = [0, 1, 0]

  // lacet : forward bascule vers right
  ;[f, right] = spin(f, right, deg(gaze.yaw))
  // tangage : forward bascule vers le haut (donc a l'oppose de down)
  ;[down, f] = spin(down, f, deg(gaze.pitch))
  // roulis : la tete penche dans son propre plan
  ;[right, down] = spin(right, down, deg(gaze.roll))

  const build = (side: number): EyePose => {
    const [ef, er] = spin(f, right, deg(split * side))
    return {
      x: ef[0] * scale,
      y: ef[1] * scale,
      a: er[0],
      b: er[1],
      c: down[0],
      d: down[1],
      depth: ef[2]
    }
  }

  return [build(-1), build(1)]
}

/**
 * Vie au repos : derive lente du regard, saccades, clignements.
 *
 * Fonction pure du temps (aucun etat interne), donc pause, reprise et saut a
 * une date arbitraire donnent toujours la meme image. Les valeurs sont des
 * ECARTS a ajouter a la pose de l'etat courant.
 */
export interface Liveliness {
  dYaw: number
  dPitch: number
  dRoll: number
  /** 1 = oeil ouvert, 0 = ferme (ecrasement vertical en repere ecran) */
  lid: number
  driftX: number
  driftY: number
  breath: number
}

const BLINK_RNG = createRng(0x5eed)
/** Calendrier de clignements pre-tire : deterministe et sans etat. */
const BLINKS: number[] = (() => {
  const out: number[] = []
  let t = 1.4
  while (t < 900) {
    out.push(t)
    // 1.9 a 4.6 s entre deux clignements, plus un double clignement parfois
    t += 1.9 + BLINK_RNG() * 2.7
    if (BLINK_RNG() < 0.18) {
      out.push(t)
      t += 0.24
    }
  }
  return out
})()

/** Mesure : 1 a 2 frames a 10 fps. */
const BLINK_DUR = 0.18

function blinkLid(t: number): number {
  for (let i = 0; i < BLINKS.length; i++) {
    const start = BLINKS[i]!
    if (t < start) break
    const k = (t - start) / BLINK_DUR
    if (k >= 0 && k <= 1) {
      // fermeture rapide, reouverture un peu plus lente
      return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55
    }
  }
  return 1
}

export interface LivelinessOptions {
  wander?: number
  blink?: boolean
  float?: boolean
}

/**
 * blobatar divergence from the bloub port: the four amplitude terms below (feeding
 * `dYaw`/`dPitch`/`dRoll`) were measured off bloub's own reference video at
 * 5.5+1.6deg yaw, 4.2+1.3deg pitch, 2.2deg roll — correct for THAT video, but user
 * testing on blobatar avatars called the resulting idle drift "stuck... they move but
 * subtle movement, we need more."
 *
 * Round 1 raised these ~2.2x (yaw 7.1deg -> 16.1deg, pitch 5.5deg -> 12.4deg, roll
 * 2.2deg -> 4.8deg; measured 10s eye-center path 50.96 -> 112.50 viewBox units).
 * Round 2 verdict: still not enough, and x-travel (82.78) visibly led y-travel
 * (61.90, ratio 1.34) — the old 16.1/12.4 yaw/pitch split.
 *
 * What actually gates this is NOT the 10s window, it's `eyefit.ts`'s anchor solve:
 * `decalagePour` covers the worst case by testing gaze at the FOUR corners of
 * (+-MAX_YAW_DRIFT, +-MAX_PITCH_DRIFT) — a bound that (per this file's own earlier
 * comment) `loopNoise`'s two summed terms genuinely reach, given enough time
 * (incommensurate periods -> arbitrarily close recurrence, not a paranoid
 * overestimate). Long sweeps (600s-1800s, 5 baseBody states x 3 realistic seed
 * profiles spanning the real `body.n`/squash range from `styles/shapes.ts`)
 * confirmed this empirically: round 1's exact 16.1/12.4 sits right at that solver's
 * feasibility cliff for the tightest combo (`notify`'s large capsule eyes on a
 * squashed, high-exponent seed) — a further amplitude increase of as little as 2%
 * flips the solve infeasible (measured overflow ratio jumping past 1.7, not a
 * graceful degradation). Amplitude is NOT the free lever it looks like.
 *
 * Period, on the other hand, turned out to be almost entirely free: the same long
 * sweeps showed the worst-case containment ratio is amplitude-gated only — moving
 * from the original periods to noticeably shorter ones at the SAME amplitude left
 * the worst ratio unchanged (0.835 -> 0.830 over 600s) while nearly doubling 10s
 * travel on its own. So round 2 spends its budget on period, not amplitude, and
 * only redistributes amplitude (yaw down a hair, pitch up) to equalize the x/y
 * split rather than grow the total drift bound much at all:
 *
 * - yaw/pitch sums brought to near-equal (16.0 / 16.0, was 16.1 / 12.4) — small
 *   step up for pitch, imperceptible step down for yaw, tested safe with real
 *   margin (worst containment ratio 0.875 over 600s, 0.873 over 1800s — i.e. it
 *   converges, it does not keep creeping toward 1).
 * - periods roughly halved (11.3/3.7 -> 6.0/1.8 yaw, 9.1/4.3 -> 5.1/2.1 pitch,
 *   13.7/3.2 -> 7.3/3.2 roll): same smooth 3-term `loopNoise` sum, just cycling
 *   faster — more frequent glances, not jitter (`loopNoise` has no added noise
 *   term, just a shorter period on the same sinusoid sum).
 *
 * Measured 10s eye-center path at these values: 112.50 -> 252.48 (x 82.78 -> 166.90,
 * y 61.90 -> 158.13 — x/y now 1.06, was 1.34).
 *
 * `eyefit.ts`'s `DERIVE_YAW`/`DERIVE_PITCH` import `MAX_YAW_DRIFT`/`MAX_PITCH_DRIFT`
 * below rather than restating these sums, so the anchor-correction coverage always
 * matches the amplitude actually in play here — see that file's comment on why a
 * stale copy there is exactly the bug this whole module exists to prevent.
 */
const WANDER_YAW_SLOW = 12.4
const WANDER_YAW_FAST = 3.6
const WANDER_PITCH_SLOW = 12.3
const WANDER_PITCH_FAST = 3.7
const WANDER_ROLL = 5.2

/** Exported so `eyefit.ts` can bound its correction table on the real amplitude. */
export const MAX_YAW_DRIFT = WANDER_YAW_SLOW + WANDER_YAW_FAST
export const MAX_PITCH_DRIFT = WANDER_PITCH_SLOW + WANDER_PITCH_FAST

export function liveliness(t: number, opt: LivelinessOptions = {}): Liveliness {
  const { wander = 1, blink = true, float = true } = opt

  // Periodes premieres entre elles : la derive ne se repete jamais a l'oeil.
  return {
    dYaw: (loopNoise(t, 6.0, 0.4) * WANDER_YAW_SLOW + loopNoise(t, 1.8, 2.1) * WANDER_YAW_FAST) * wander,
    dPitch:
      (loopNoise(t, 5.1, 1.3) * WANDER_PITCH_SLOW + loopNoise(t, 2.1, 0.7) * WANDER_PITCH_FAST) * wander,
    dRoll: loopNoise(t, 7.3, 3.2) * WANDER_ROLL * wander,
    lid: blink ? blinkLid(t) : 1,
    // Au repos la video est quasiment immobile (centre stable a +-0.003, rayon
    // constant) : toute la vie passe par le regard et les clignements. On garde
    // juste de quoi ne pas figer completement l'image.
    driftX: float ? loopNoise(t, 7.9, 1.9) * 0.006 : 0,
    driftY: float ? loopNoise(t, 5.3, 0.3) * 0.007 : 0,
    // La largeur est constante, seule la hauteur respire tres legerement.
    breath: float ? 1 + Math.sin((t / 3.4) * Math.PI * 2) * 0.005 : 1
  }
}

/**
 * Le clignement est un ecrasement VERTICAL en repere ecran autour du centre de
 * l'oeil (mesure : la largeur de bbox est conservee, la hauteur tombe a ~0.35),
 * pas un retrecissement le long de l'axe incline de la gelule. On le compose
 * donc apres la matrice tangente, en n'affectant que les sorties en y.
 */
export function blinkScale(lid: number): number {
  return 0.06 + 0.94 * clamp(lid)
}
