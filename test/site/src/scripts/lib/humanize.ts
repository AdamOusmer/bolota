/**
 * Turns an engine id into a display label without hand-maintaining a parallel
 * list that can drift out of sync with the engine's own roster, labels here
 * are always derived from `handle.states` / `engineStates()` at runtime, so
 * a rename on the engine side (e.g. a state id changing) shows up correctly
 * with zero changes on the site.
 */
export function humanizeId(id: string): string {
  return id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * bloub's face expressions carry French ids (its own doc comments and video
 * are French-first). This is a label lookup, not a positional zip against
 * `handle.expressions`, safe even if the engine's own array order changes.
 * Unknown ids still render (via humanizeId) instead of disappearing.
 */
const EXPRESSION_LABELS: Record<string, string> = {
  neutre: "Neutral",
  attentif: "Attentive",
  surpris: "Surprised",
  excite: "Excited",
  heureux: "Happy",
  hilare: "Laughing",
  colere: "Angry",
  triste: "Sad",
  effraye: "Scared",
  mefiant: "Suspicious",
  confus: "Confused",
  curieux: "Curious",
  fier: "Proud",
  timide: "Shy",
  blase: "Unimpressed",
  somnolent: "Sleepy",
};

export function humanizeExpression(id: string): string {
  return EXPRESSION_LABELS[id] ?? humanizeId(id);
}
