# PERILUNE MVP

**PERILUNE** is a private browser game for **1–6 players**. A cooperative crew operates a fictional lunar spacecraft, solves science-based emergencies, performs a lunar flyby, survives re-entry, and splashes down.

This repository is a working vertical slice designed to be easy to test and ship. It uses one Node.js service for both the website and real-time multiplayer, so there is only one link to share.

## Included

- Private six-character room codes
- 1–6 online players
- Six unique crew roles
- Solo play
- Responsive laptop and phone interface
- Lightweight 3D first-person spacecraft cabin using Babylon.js
- Server-authoritative mission state, sequencing, puzzle answers, resources, and victory
- Four mission phases
- Reconnection window of 45 seconds
- No accounts, database, installation, analytics, or paid assets

## Mission flow

1. Complete launch checks in the correct order.
2. Survive an overheating power bus.
3. Calculate and program the lunar correction burn.
4. Set the re-entry angle and deploy parachutes in the safe corridor.

A successful run is approximately **7–10 minutes**. The planned full game can later expand to 20–30 minutes.

## Run locally

Requirements: Node.js 22 and npm.

```bash
npm install
npm start
```

Open:

```text
http://localhost:2567
```

Open several browser windows to test multiplayer. One player creates the mission and shares the room code or invite link.

## Validate the source

```bash
npm run check
```

## Ship on Render

1. Create an empty GitHub repository.
2. Upload this project and push it to GitHub.
3. In Render, choose **New → Blueprint**.
4. Connect the GitHub repository.
5. Render reads `render.yaml` and creates the `perilune` web service.
6. When deployment finishes, open the Render URL and create a mission.

Every GitHub push automatically redeploys the game. The client and WebSocket server use the same public URL, so no environment-variable wiring is required.

### Free-tier note

A free Render service can sleep after inactivity. Open the game link shortly before the group session to wake it up.

## Basic security model

- Rooms are unlisted and addressed by a random code.
- New players cannot join after launch.
- All puzzle validation and resource changes happen on the server.
- Incoming message size and message frequency are limited.
- This is suitable for a private friends-only prototype, not competitive public matchmaking.

## Project structure

```text
client/
  index.html       Browser interface
  styles.css       Responsive visual design
  scene.js         Procedural Babylon.js spacecraft cabin
  app.js           Multiplayer client and game UI
server/src/
  server.js        HTTP hosting, WebSockets, rooms, game rules
render.yaml        One-click Render configuration
```

## Recommended next iteration

Play once with four friends and record where people become confused. Then prioritize:

1. Better onboarding and role instructions
2. Original sound effects and music
3. Role-private information enforced by the server
4. Branching science and philosophy events
5. A 20–30 minute complete lunar mission
6. Accessibility settings and broader mobile testing
