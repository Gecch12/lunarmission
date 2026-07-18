# LUNAR MISSION MVP — v0.2

**LUNAR MISSION** is a private browser game for **1–6 players**. The crew combines incomplete role-specific clues to solve a launch logic procedure, allocate emergency power, calculate a correction burn, and determine a safe re-entry and parachute window.

This version replaces the original guided checklist with actual deduction, calculation, and trade-offs.

## What changed in v0.2

- Public game name changed to **LUNAR MISSION**
- Clues now come from the server and are private to each player
- Unfilled roles are cross-assigned, so 1–6 players can always solve the mission
- Solo training displays all six station briefs
- Randomized mission variants reduce memorization
- Five-action launch logic puzzle
- Emergency allocation puzzle with safety minimums and a science-versus-margin trade-off
- Navigation requires direction, drift adjustment, engine efficiency, and a rounded burn duration
- Re-entry requires intersecting angle constraints and calculating a one-attempt parachute window
- Mission Data gauge and final ratings: Survival Return, Nominal Return, or Scientific Triumph

## Mission flow

1. **Launch logic:** Deduce the only valid order from distributed constraints.
2. **Power allocation:** Use the exact available total, satisfy safety minimums, and choose how much to preserve for science.
3. **Correction burn:** Combine Δv, drift, direction, acceleration, and efficiency.
4. **Re-entry:** Calculate the safe angle and the overlap between velocity-safe and altitude-safe parachute windows.

Expected first-run duration is approximately **12–20 minutes**, depending on crew size and discussion.

## Updating the live Render version without local installation

1. Unzip the update package.
2. Open the existing GitHub repository.
3. Choose **Add file → Upload files**.
4. Drag all files and folders from the unzipped update into the repository and allow GitHub to replace files with the same names.
5. Commit the changes to `main`.
6. Render will automatically deploy the new commit.

The Render service remains internally named `perilune` so the existing URL continues working. Players will see **LUNAR MISSION** everywhere in the game.

## Project structure

```text
client/
  index.html       Browser interface and Lunar Mission branding
  styles.css       Responsive visual design
  scene.js         Procedural Babylon.js spacecraft cabin
  app.js           Multiplayer client, private briefs, and puzzle controls
server/src/
  server.js        Hosting, WebSockets, private clues, randomized scenarios, and game rules
render.yaml        Existing free Render deployment configuration
```

## Security model

- Rooms are unlisted and use random six-character codes.
- New players cannot join after launch.
- Private clues, answers, resource changes, and mission results are validated on the server.
- Incoming message size and frequency are limited.
- This remains a private friends-only prototype, not public competitive matchmaking.
