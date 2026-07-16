# Seedance 2.0 — Optics: shot size, FOV, camera

Rules for the Lens / Camera / Framing lines inside SHOT blocks. They refine wording only — keep the prompt's existing structure (GLOBAL CONTINUITY, SHOT blocks, DIALOGUE LOCK, VISUAL STYLE, Strict rules) unchanged.

## Express lenses as FOV in degrees

In the prompt text state the field of view in degrees instead of millimeters ("Lens: 47° FOV" rather than "Lens: 50mm") — Seedance follows discrete FOV anchors far more reliably than lens names. Use ONLY these steps (no in-between values like 23°):

| FOV | mm equiv | Purpose | When |
|-----|----------|---------|------|
| 180° | fisheye | spherical distortion | POV, dream-state |
| 107° | 14–16mm | architectural ultra-wide | huge interiors, epic establish |
| 84° | 20–24mm | wide | establish, group blocking |
| 63° | 28–35mm | observational | wide observation, reportage |
| 47° | 40–50mm | neutral human perspective | universal establish, medium shots |
| 29° | 75–85mm | portrait compression | medium-isolate, dialogue bust |
| 18° | 100–135mm | natural portrait | close portrait, identity-preserving |
| 12° | 180–200mm | tele-detail | hands, objects, detail-on-wide |
| 8° | 300–400mm | extreme compression | distant observation, broadcast |

In a multi-shot prompt set the FOV per SHOT block and add "no drift mid-segment".

## Shot sizes

ECU — a detail: eyes, hand, object. CU — full face. MCU — head and shoulders. MS — to the waist. WS — full figure + surroundings. EWS — scale, location. Pair the size with a FOV anchor: dialogue bust = MCU at 29°, tender close-up = CU at 18°, establishing = WS at 63–84°.

## Camera lines

- Within each SHOT block keep camera information after subject and action (subject → action → camera): stated too early it fights identity references, stated last the FOV gets ignored.
- Motivate every camera move and be concrete: "low-angle 18° dolly-in, slow push from waist to chest as she realizes"; "static 47° two-shot, eye-level, locked off — lets the silence sit"; "handheld 63°, follow from behind — camera lags half a beat".
- Describe the look, not the gear: no camera / film stock / lens brand names — they get ignored or break complex moves.
- Camera speed as a number: "camera pans at 5 km/h", "dolly-in at 3 km/h" instead of "slow".

## Optical techniques (use when the scene calls for them)

- **Observation pattern (hidden-camera feel)** — all three ingredients at once: (1) out-of-focus foreground occlusion covering 20–30% of frame (wall, pillar, branch); (2) atmospheric haze between camera and subject; (3) distant vantage at 8–12° FOV, operator anchored far away. Change the occlusion type between beats; keep the vantage single.
- **Sports broadcast:** 8° super-tele + handheld 1–2 cm tremor + "anchored at distance, finding the action".
- **Detail-on-wide (snake cam):** 84° wide right up against a small low object — foreground exaggerated, background recedes into depth.
- **Intimate wide:** 63–84° on a close face — face centered, surroundings readable without blur.
- **Tele compressed air column** at 8–12°: "dust suspended in the long compressed air column between camera and subject", "heat shimmer compressed into a wall of haze in front of the figure".
