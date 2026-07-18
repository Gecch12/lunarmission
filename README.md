# LUNAR MISSION — v0.4

**LUNAR MISSION** is a private browser game for **1–6 players**. The crew combines incomplete role-specific clues to solve a launch logic procedure, allocate emergency power, calculate a correction burn, and survive re-entry.

Version 0.4 keeps the harder v0.2 puzzles and rebuilds the browser presentation around a full-screen cinematic mission view rather than a page of forms.

## What changed in v0.4

- Animated Earth–Moon mission display with phase-specific visuals
- Visual launch interlocks, emergency power circuits, orbit preview, and re-entry descent
- Circular spacecraft gauges with warning and critical states
- Live re-entry velocity, altitude, heat, and descent telemetry
- Crew activity feed showing who acted and what happened
- Crew station cards pulse when a player performs an action
- Generated cockpit hum, switch tones, warnings, success cues, screen shake, and flashes
- Sound is optional and starts only after the player enables it
- Inputs are no longer rebuilt every second, so calculations remain on screen while the server updates
- Responsive layout for laptops and phones
- Public game name remains **LUNAR MISSION** throughout the interface and health endpoint

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
7. When Render shows **Live**, refresh the game with `Ctrl + Shift + R`.

The Render service and website are named **LUNAR MISSION**.

## Project structure

```text
client/
  index.html       Game layout and Lunar Mission branding
  styles.css       Responsive visual system and phase displays
  scene.js         Procedural animated Babylon.js cockpit background
  app.js           Multiplayer client, visuals, audio, briefs, and controls
server/src/
  server.js        Hosting, WebSockets, event feed, telemetry, clues, and rules
render.yaml        Existing free Render deployment configuration
```

## Security model

- Rooms are unlisted and use random six-character codes.
- New players cannot join after launch.
- Private clues, answers, resource changes, and mission results are validated on the server.
- Incoming message size and frequency are limited.
- This remains a private friends-only prototype, not public competitive matchmaking.
