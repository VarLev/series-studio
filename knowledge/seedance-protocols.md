# Seedance 2.0 — Cuts, timing and consistency protocols

Rules for multi-shot prompts and tricky cases. They refine wording only — keep the prompt's existing structure (GLOBAL CONTINUITY, SHOT blocks, DIALOGUE LOCK, VISUAL STYLE, Strict rules) unchanged.

## Pick the cut precision the scene needs

- Single shot (oner): write "one continuous shot, the camera does not cut on its own."
- Sequence without exact timing: describe SHOT blocks in order when beats need specific cuts but not a clock.
- Timed multishot: explicit HARD CUT at stated seconds when beats must land on a clock:

```
0.0s to 1.0s — [description]
1.0s HARD CUT
1.0s to 3.0s — [description]
```

- Whenever you specify cuts, lock them: "cuts only at the specified points, the camera does not cut on its own."
- Cut types: HARD CUT, SMASH CUT, MATCH CUT, INSERT CUT, REVERSE CUT, WHIP CUT. Fades/crossfades only if explicitly requested.

## Continuity across internal cuts

Hold across every cut inside one video: same character set, same geometry, screen direction, gaze direction, light, wardrobe, prop state. Carried state persists (wet stays wet, a bruise stays); one time-of-day and weather unless the location changes.

## Whip-pan timing

A whip shorter than 0.8s renders as a hard cut without blur. Working timing:

```
0.3s — subject A settled
0.8s — WHIP motion-blur transition
1.4s — subject B settled
```

## Mixed time-speed (real-time + slow-mo)

Hard cuts only between speed modes; each shot is ONE speed start to finish. Pin the speed per segment: "real-time", "40% slow motion".

## Cracks / breaks without impact (anti-impact lock)

When something must crack under pressure, not a blow:

- "crowd PRESSES, not strikes"
- "fracture originates from edge stress, not center impact"
- "no impact point — pressure-based crack"
- sequential timing edge-to-center, not radial from a point.

## Extreme-FOV multishot consistency stack (8° or 107°)

All four mechanisms are required, or the look breaks down after 2–3 beats:

1. Sequence-wide identity lock — single location reference across all beats.
2. LENS LOCK opener — explicit FOV phrase at the start of each beat.
3. LENS CHECK closer — confirm the FOV at the end of the beat.
4. Color via material + light, not as a list.

## Locks

A lock is a short hard fixer placed next to what it protects, in positive form, e.g. "headlights stay glowing in every shot". Write densely where control matters, sparsely where it does not; say each important thing once.
