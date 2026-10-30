// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
//
// FROZEN from bolota 0.1.7's engine (the bloub port: src/bloub/* driven by test/oracle.ts's
// mountEngine, last present at commit 2f5b313). Per "seed|state": the times each eye starts to close ([left, right]) over 0.5 s to 0.5 + max(duration, 9) s, sampled every 1/180 s and rounded to 1e-6, as test/live-blinks.test.ts defines closing; IDLE is the fixed idle blinks of the resting face per seed.
// Never edit by hand and do not regenerate from the live engine: these numbers are the old
// engine's answers, which the native engine in src/live/ is held to.

export const CLOSINGS: Record<string, readonly (readonly number[])[]> = {
  "alain|idle": [[1.444444,5.261111],[1.444444,5.261111]],
  "alain|wander": [[1.45,5.266667],[1.444444,5.261111]],
  "alain|thinking": [[0.55],[0.561111]],
  "alain|wink": [[0.555556,1.444444,5.261111],[0.544444,1.444444,2.077778,3.577778,5.077778,6.577778,8.077778]],
  "alain|wide": [[0.555556,1.444444,5.266667],[0.561111,1.444444,5.261111]],
  "alain|alert": [[1.444444,5.261111],[1.444444,5.261111]],
  "alain|notify": [[0.538889,1.444444,5.261111],[0.533333,1.444444,5.261111]],
  "alain|exclaim": [[1.444444,5.261111],[1.444444,5.261111]],
  "alain|snooze": [[],[]],
  "alain|play": [[0.55,1.444444,5.261111],[0.555556,1.444444,5.266667]],
  "alain|orbit": [[1.45,5.261111],[1.438889,5.255556]],
  "alain|swirl": [[0.555556,1.444444,5.261111],[0.555556,1.444444,5.261111]],
  "alain|burst": [[5.261111],[5.261111]],
  "alain|comet": [[5.261111],[5.261111]],
  "seed-7|idle": [[1.444444,5.261111],[1.444444,5.261111]],
  "seed-7|wander": [[1.45,5.266667],[1.444444,5.261111]],
  "seed-7|thinking": [[0.55],[0.561111]],
  "seed-7|wink": [[0.555556,1.444444,5.261111],[0.544444,1.444444,2.077778,3.577778,5.077778,6.577778,8.077778]],
  "seed-7|wide": [[0.555556,1.444444,5.266667],[0.561111,1.444444,5.261111]],
  "seed-7|alert": [[1.444444,5.261111],[1.444444,5.261111]],
  "seed-7|notify": [[0.538889,1.444444,5.261111],[0.533333,1.444444,5.261111]],
  "seed-7|exclaim": [[1.444444,5.261111],[1.444444,5.261111]],
  "seed-7|snooze": [[],[]],
  "seed-7|play": [[0.55,1.444444,5.261111],[0.555556,1.444444,5.266667]],
  "seed-7|orbit": [[1.45,5.261111],[1.438889,5.255556]],
  "seed-7|swirl": [[0.555556,1.444444,5.261111],[0.555556,1.444444,5.261111]],
  "seed-7|burst": [[5.261111],[5.261111]],
  "seed-7|comet": [[5.261111],[5.261111]],
};

export const IDLE: Record<string, readonly number[]> = {"alain":[1.444444,5.261111],"seed-7":[1.444444,5.261111]};
