import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLIENT_ROOT = resolve(ROOT, "client");
const PORT = Number.parseInt(process.env.PORT || "2567", 10);
const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROLE_LIST = ["Commander", "Pilot", "Navigator", "Systems", "Science", "Medical"];
const ROLES = new Set(ROLE_LIST);
const rooms = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const LAUNCH_VARIANTS = [
  {
    order: ["align_computer", "start_scrubbers", "seal_cabin", "arm_guidance", "authorize_launch"],
    clues: {
      Commander: "Launch authorization is the final action. Nothing may follow it.",
      Pilot: "Guidance may be armed only after the cabin is sealed.",
      Navigator: "The flight computer must be aligned before the scrubbers start.",
      Systems: "The scrubbers must be running immediately before the cabin is sealed.",
      Science: "Computer alignment must occur before any environmental system is activated.",
      Medical: "Cabin sealing must happen immediately after the scrubbers start.",
    },
  },
  {
    order: ["start_scrubbers", "align_computer", "arm_guidance", "seal_cabin", "authorize_launch"],
    clues: {
      Commander: "Launch authorization is the final action.",
      Pilot: "Arm guidance immediately after the flight computer is aligned.",
      Navigator: "Guidance must be armed before the cabin is sealed.",
      Systems: "The cabin cannot be sealed until guidance is armed.",
      Science: "The computer must be aligned after the scrubbers start, not before.",
      Medical: "Start the scrubbers before any avionics action.",
    },
  },
  {
    order: ["align_computer", "arm_guidance", "start_scrubbers", "seal_cabin", "authorize_launch"],
    clues: {
      Commander: "Launch authorization is the final action.",
      Pilot: "Arm guidance immediately after computer alignment.",
      Navigator: "Guidance must be armed before the scrubbers start.",
      Systems: "The cabin is sealed after the scrubbers are running.",
      Science: "Computer alignment is the first action in the procedure.",
      Medical: "Start the scrubbers immediately before sealing the cabin.",
    },
  },
];

const POWER_VARIANTS = [
  { available: 86, lifeBase: 18, lifePerCrew: 2, coolingMin: 30, navigationMin: 16 },
  { available: 84, lifeBase: 20, lifePerCrew: 1, coolingMin: 28, navigationMin: 18 },
  { available: 88, lifeBase: 18, lifePerCrew: 1, coolingMin: 32, navigationMin: 16 },
];

const NAVIGATION_VARIANTS = [
  { targetDv: 124, drift: 8, driftMode: "assists", acceleration: 2.5, efficiency: 0.8, direction: "prograde" },
  { targetDv: 132, drift: 12, driftMode: "assists", acceleration: 2.4, efficiency: 0.8, direction: "retrograde" },
  { targetDv: 108, drift: 6, driftMode: "opposes", acceleration: 2.5, efficiency: 0.8, direction: "prograde" },
  { targetDv: 140, drift: 10, driftMode: "assists", acceleration: 2.6, efficiency: 1.0, direction: "retrograde" },
];

const REENTRY_VARIANTS = [
  {
    nominalMin: 5.8,
    nominalMax: 7.2,
    weatherShift: 0.2,
    heatShieldMax: 6.8,
    medicalMin: 6.2,
    speedStart: 600,
    speedDrop: 18,
    chuteMaxSpeed: 258,
    altitudeStart: 15.5,
    altitudeDrop: 0.42,
    minimumAltitude: 5.0,
  },
  {
    nominalMin: 5.7,
    nominalMax: 7.1,
    weatherShift: -0.2,
    heatShieldMax: 6.6,
    medicalMin: 5.9,
    speedStart: 620,
    speedDrop: 20,
    chuteMaxSpeed: 260,
    altitudeStart: 16.0,
    altitudeDrop: 0.45,
    minimumAltitude: 5.5,
  },
  {
    nominalMin: 5.9,
    nominalMax: 7.3,
    weatherShift: 0.1,
    heatShieldMax: 6.9,
    medicalMin: 6.1,
    speedStart: 580,
    speedDrop: 16,
    chuteMaxSpeed: 260,
    altitudeStart: 14.8,
    altitudeDrop: 0.4,
    minimumAltitude: 5.6,
  },
  {
    nominalMin: 5.6,
    nominalMax: 7.0,
    weatherShift: 0.3,
    heatShieldMax: 6.7,
    medicalMin: 6.0,
    speedStart: 640,
    speedDrop: 22,
    chuteMaxSpeed: 266,
    altitudeStart: 16.2,
    altitudeDrop: 0.48,
    minimumAltitude: 5.7,
  },
];

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://cdn.babylonjs.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:;",
  );
}

function serveStatic(request, response) {
  setSecurityHeaders(response);

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok", game: "Lunar Mission", version: "0.3.0", rooms: rooms.size }));
    return;
  }

  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath === "/") relativePath = "/index.html";
  const safePath = normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(CLIENT_ROOT, `.${safePath}`);

  if (!filePath.startsWith(CLIENT_ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=300",
  });
  createReadStream(filePath).pipe(response);
}

function randomId(bytes = 12) {
  return randomBytes(bytes).toString("base64url");
}

function choose(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function createMissionScenario() {
  const navigation = { ...choose(NAVIGATION_VARIANTS) };
  const adjustedDv = navigation.driftMode === "assists"
    ? navigation.targetDv - navigation.drift
    : navigation.targetDv + navigation.drift;
  navigation.answerSeconds = Math.round(adjustedDv / (navigation.acceleration * navigation.efficiency));

  const reentry = { ...choose(REENTRY_VARIANTS) };
  const shiftedMin = reentry.nominalMin + reentry.weatherShift;
  const shiftedMax = reentry.nominalMax + reentry.weatherShift;
  const finalMin = Math.max(shiftedMin, reentry.medicalMin);
  const finalMax = Math.min(shiftedMax, reentry.heatShieldMax);
  reentry.answerAngle = roundOne((finalMin + finalMax) / 2);
  reentry.earliestChute = Math.ceil((reentry.speedStart - reentry.chuteMaxSpeed) / reentry.speedDrop);
  reentry.latestChute = Math.floor((reentry.altitudeStart - reentry.minimumAltitude) / reentry.altitudeDrop);

  return {
    launch: choose(LAUNCH_VARIANTS),
    power: { ...choose(POWER_VARIANTS) },
    navigation,
    reentry,
  };
}

function createRoomCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += ROOM_CODE_CHARACTERS[Math.floor(Math.random() * ROOM_CODE_CHARACTERS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("Unable to allocate a room code.");
}

function safeName(raw) {
  if (typeof raw !== "string") return "Crew";
  const cleaned = raw.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 18);
  return cleaned || "Crew";
}

function safeSend(socket, payload) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

class MissionRoom {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.hostSessionId = "";
    this.scenario = createMissionScenario();
    this.phase = "lobby";
    this.phaseIndex = 0;
    this.missionSeconds = 0;
    this.phaseSeconds = 0;
    this.phaseDeadline = 0;
    this.angleLockedAt = null;
    this.oxygen = 100;
    this.power = 100;
    this.heat = 12;
    this.trajectory = 82;
    this.missionData = 10;
    this.objective = "Select a station and ready up.";
    this.objectiveDetail = "In multiplayer, missing station briefs are cross-assigned so every clue remains available.";
    this.statusMessage = "Waiting for crew.";
    this.alertLevel = "normal";
    this.completedActions = [];
    this.eventSequence = 0;
    this.events = [];
    this.disposed = false;
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.recordEvent(null, "Mission room created. Awaiting crew.", "info");
  }

  sharedState() {
    const players = {};
    for (const [id, player] of this.players) {
      players[id] = {
        name: player.name,
        role: player.role,
        ready: player.ready,
        connected: player.connected,
      };
    }

    return {
      gameName: "Lunar Mission",
      roomCode: this.code,
      players,
      hostSessionId: this.hostSessionId,
      phase: this.phase,
      phaseIndex: this.phaseIndex,
      missionSeconds: this.missionSeconds,
      phaseSeconds: this.phaseSeconds,
      phaseDeadline: this.phaseDeadline,
      descentSeconds: this.angleLockedAt === null ? null : Math.max(0, this.phaseSeconds - this.angleLockedAt),
      oxygen: this.oxygen,
      power: this.power,
      heat: this.heat,
      trajectory: this.trajectory,
      missionData: this.missionData,
      objective: this.objective,
      objectiveDetail: this.objectiveDetail,
      statusMessage: this.statusMessage,
      alertLevel: this.alertLevel,
      telemetry: this.telemetry(),
      recentEvents: this.events.slice(-8),
      completedActions: this.completedActions.join(","),
    };
  }

  telemetry() {
    if (this.phase !== "reentry" || this.angleLockedAt === null) {
      return { speed: null, altitude: null };
    }

    const elapsed = Math.max(0, this.phaseSeconds - this.angleLockedAt);
    const profile = this.scenario.reentry;
    return {
      speed: Math.max(0, profile.speedStart - profile.speedDrop * elapsed),
      altitude: Math.max(0, profile.altitudeStart - profile.altitudeDrop * elapsed),
    };
  }

  stateFor(player) {
    return {
      ...this.sharedState(),
      privateBrief: this.privateBriefFor(player),
      assignedBriefRoles: this.assignedBriefRoles(player),
    };
  }

  assignedBriefRoles(player) {
    if (!player || this.players.size === 0 || !player.role) return [];
    const activePlayers = [...this.players.values()];
    const owners = new Map();

    for (const crewMember of activePlayers) {
      if (crewMember.role) owners.set(crewMember.role, crewMember);
    }

    let cursor = 0;
    for (const role of ROLE_LIST) {
      if (!owners.has(role)) {
        owners.set(role, activePlayers[cursor % activePlayers.length]);
        cursor += 1;
      }
    }

    return ROLE_LIST.filter((role) => owners.get(role)?.sessionId === player.sessionId);
  }

  privateBriefFor(player) {
    if (!player?.role) return "Choose a station to receive your mission information.";
    if (this.phase === "lobby") {
      const extra = this.players.size === 1
        ? "Solo training will show all six station briefs after launch."
        : "Unfilled stations will be cross-assigned when the mission launches.";
      return `${player.role} station selected. ${extra}`;
    }
    if (this.phase === "won") return "Recovery forces have acquired the capsule beacon. Compare your remaining margins and mission data.";
    if (this.phase === "lost") return "Debrief the failed assumption. On the next attempt, report every number and constraint before anyone acts.";

    const assignedRoles = this.assignedBriefRoles(player);
    return assignedRoles
      .map((role) => `[${role.toUpperCase()}]\n${this.briefForRole(this.phase, role)}`)
      .join("\n\n");
  }

  briefForRole(phase, role) {
    if (phase === "launch") return this.scenario.launch.clues[role];

    if (phase === "power") {
      const p = this.scenario.power;
      const crewCount = this.players.size;
      const clues = {
        Commander: `The allocation bus has exactly ${p.available} units. Submit four whole-number allocations that total exactly ${p.available}; no unit may remain unused.`,
        Pilot: "A balanced allocation is safer than maximizing one system. Navigation surplus improves trajectory margin.",
        Navigator: `Navigation requires at least ${p.navigationMin} units. Every unit above that minimum improves the return corridor.`,
        Systems: `Cooling requires at least ${p.coolingMin} units to stop the thermal runaway. Extra cooling reduces heat.`,
        Science: "Any units assigned to Science become mission data. Science may receive zero, but higher data improves the final mission rating.",
        Medical: `Life-support minimum = ${p.lifeBase} + (${p.lifePerCrew} × number of crew). There are ${crewCount} crew member${crewCount === 1 ? "" : "s"} in this mission.`,
      };
      return clues[role];
    }

    if (phase === "navigation") {
      const n = this.scenario.navigation;
      const driftText = n.driftMode === "assists" ? "already assists the correction" : "opposes the required correction";
      const clues = {
        Commander: "Agree on burn direction and duration. Round the final duration to the nearest whole second.",
        Pilot: `Main-engine rated acceleration is ${n.acceleration} m/s².`,
        Navigator: `The required correction is ${n.targetDv} m/s ${n.direction.toUpperCase()}.`,
        Systems: `Engine efficiency is ${(n.efficiency * 100).toFixed(0)}%. Multiply rated acceleration by efficiency before calculating time.`,
        Science: `Existing drift is ${n.drift} m/s and ${driftText}. Adjust Δv first, then use time = adjusted Δv ÷ effective acceleration.`,
        Medical: "One continuous burn is acceptable. Do not split the burn into separate maneuvers.",
      };
      return clues[role];
    }

    if (phase === "reentry") {
      const r = this.scenario.reentry;
      const shift = `${r.weatherShift >= 0 ? "+" : ""}${r.weatherShift.toFixed(1)}°`;
      const clues = {
        Commander: "For entry angle, use the midpoint of the final safe overlap and round to 0.1°. Locking the angle starts the descent clock at T+00.",
        Pilot: `At T+00, speed is ${r.speedStart} m/s and falls by ${r.speedDrop} m/s each second.`,
        Navigator: `Nominal entry corridor is ${r.nominalMin.toFixed(1)}°–${r.nominalMax.toFixed(1)}°. At T+00 altitude is ${r.altitudeStart.toFixed(1)} km and falls by ${r.altitudeDrop.toFixed(2)} km each second.`,
        Systems: `Heat-shield damage limits entry angle to no more than ${r.heatShieldMax.toFixed(1)}°. Parachutes tolerate at most ${r.chuteMaxSpeed} m/s.`,
        Science: `Weather shifts both edges of the nominal corridor by ${shift}. Apply the shift before intersecting all limits.`,
        Medical: `Crew g-load requires an angle of at least ${r.medicalMin.toFixed(1)}°. Parachutes must deploy while altitude remains above ${r.minimumAltitude.toFixed(1)} km.`,
      };
      return clues[role];
    }

    return "Stand by for mission instructions.";
  }

  addPlayer(socket, name) {
    if (this.phase !== "lobby") throw new Error("This mission has already launched.");
    if (this.players.size >= 6) throw new Error("This mission already has six crew members.");

    const sessionId = randomId(9);
    const reconnectToken = randomId(24);
    const player = {
      sessionId,
      reconnectToken,
      name: safeName(name),
      role: "",
      ready: false,
      connected: true,
      socket,
      disconnectTimer: null,
    };
    this.players.set(sessionId, player);
    if (!this.hostSessionId) this.hostSessionId = sessionId;
    this.attachSocket(socket, player);
    this.recordEvent(player, "Joined the crew.", "info");
    this.broadcastNotice(`${player.name} joined the crew.`);
    this.broadcastState();
    return player;
  }

  reconnect(socket, token) {
    const player = [...this.players.values()].find((candidate) => candidate.reconnectToken === token);
    if (!player || player.connected) throw new Error("This reconnection token is no longer valid.");

    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    player.connected = true;
    player.socket = socket;
    player.reconnectToken = randomId(24);
    this.attachSocket(socket, player);
    this.recordEvent(player, "Reconnected to the mission.", "success");
    this.broadcastNotice(`${player.name} reconnected.`);
    this.broadcastState();
    return player;
  }

  attachSocket(socket, player) {
    socket.context = { roomCode: this.code, sessionId: player.sessionId };
    safeSend(socket, {
      type: "joined",
      roomCode: this.code,
      sessionId: player.sessionId,
      reconnectionToken: player.reconnectToken,
    });
  }

  handleDisconnect(sessionId, socket, consented = false) {
    const player = this.players.get(sessionId);
    if (!player || player.socket !== socket) return;

    player.socket = null;
    player.connected = false;

    if (consented) {
      this.removePlayer(sessionId);
      return;
    }

    player.disconnectTimer = setTimeout(() => this.removePlayer(sessionId), 45_000);
    this.broadcastState();
  }

  removePlayer(sessionId) {
    const player = this.players.get(sessionId);
    if (!player) return;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    this.players.delete(sessionId);

    if (this.hostSessionId === sessionId) {
      this.hostSessionId = this.players.keys().next().value || "";
    }

    this.recordEvent(player, "Left the crew.", "warning");
    this.broadcastNotice(`${player.name} left the crew.`);
    this.broadcastState();
    if (this.players.size === 0) this.dispose();
  }

  handleMessage(sessionId, message) {
    const player = this.players.get(sessionId);
    if (!player || !player.connected) return;

    switch (message.type) {
      case "set_role":
        this.setRole(player, message.role);
        break;
      case "toggle_ready":
        this.toggleReady(player);
        break;
      case "start":
        this.startMission(player);
        break;
      case "action":
        this.handleAction(player, message);
        break;
      case "reset":
        this.resetMission(player);
        break;
      case "leave":
        this.handleDisconnect(sessionId, player.socket, true);
        break;
      case "ping":
        safeSend(player.socket, { type: "pong" });
        break;
      default:
        this.error(player, "Unknown mission command.");
    }
  }

  setRole(player, role) {
    if (this.phase !== "lobby") return this.error(player, "Roles are locked after launch.");
    const normalizedRole = typeof role === "string" ? role : "";
    if (normalizedRole && !ROLES.has(normalizedRole)) return this.error(player, "Unknown crew role.");

    if (normalizedRole) {
      for (const other of this.players.values()) {
        if (other.sessionId !== player.sessionId && other.role === normalizedRole) {
          return this.error(player, `${normalizedRole} is already assigned.`);
        }
      }
    }

    player.role = normalizedRole;
    player.ready = false;
    this.recordEvent(player, normalizedRole ? `Selected ${normalizedRole} station.` : "Cleared station assignment.", "info");
    this.broadcastState();
  }

  toggleReady(player) {
    if (this.phase !== "lobby") return;
    if (!player.role) return this.error(player, "Select a station first.");
    player.ready = !player.ready;
    this.recordEvent(player, player.ready ? "Reported ready for launch." : "Returned to standby.", player.ready ? "success" : "warning");
    this.broadcastState();
  }

  startMission(player) {
    if (this.phase !== "lobby") return;
    if (player.sessionId !== this.hostSessionId) return this.error(player, "Only the host can start.");

    for (const crewMember of this.players.values()) {
      if (!crewMember.connected || !crewMember.ready || !crewMember.role) {
        return this.error(player, "Every connected crew member must select a role and be ready.");
      }
    }
    this.transition("launch");
  }

  resetMission(player) {
    if (!["won", "lost"].includes(this.phase)) return;
    if (player.sessionId !== this.hostSessionId) return this.error(player, "Only the host can reset the mission.");

    this.scenario = createMissionScenario();
    this.phase = "lobby";
    this.phaseIndex = 0;
    this.missionSeconds = 0;
    this.phaseSeconds = 0;
    this.phaseDeadline = 0;
    this.angleLockedAt = null;
    this.oxygen = 100;
    this.power = 100;
    this.heat = 12;
    this.trajectory = 82;
    this.missionData = 10;
    this.objective = "Select a station and ready up.";
    this.objectiveDetail = "A new randomized mission profile has been generated.";
    this.statusMessage = "Waiting for crew.";
    this.alertLevel = "normal";
    this.completedActions = [];
    this.events = [];
    this.recordEvent(player, "Generated a new randomized mission profile.", "info");
    for (const crewMember of this.players.values()) crewMember.ready = false;
    this.broadcastState();
  }

  handleAction(player, message) {
    const action = typeof message.action === "string" ? message.action : "";
    if (!action) return this.error(player, "Invalid action.");

    if (this.phase === "launch") {
      return this.handleSequenceAction(player, action, this.scenario.launch.order, "power");
    }

    if (this.phase === "power" && action === "submit_allocation") {
      return this.handlePowerAllocation(player, message.allocations);
    }

    if (this.phase === "navigation" && action === "program_burn") {
      return this.handleBurn(player, message);
    }

    if (this.phase === "reentry" && action === "set_entry_angle") {
      return this.handleEntryAngle(player, message.value);
    }

    if (this.phase === "reentry" && action === "deploy_parachutes") {
      return this.handleParachutes(player);
    }

    this.recordEvent(player, "Attempted a control outside the current procedure.", "warning");
    this.error(player, "That control is not valid in the current mission phase.");
  }

  handleSequenceAction(player, action, expected, nextPhase) {
    if (!expected.includes(action)) return this.error(player, "That control is not part of this procedure.");
    if (this.hasCompleted(action)) return;

    const requiredAction = expected[this.completedActions.length];
    if (action !== requiredAction) {
      this.power = Math.max(0, this.power - 4);
      this.trajectory = Math.max(0, this.trajectory - 3);
      this.recordEvent(player, `${action.replaceAll("_", " ")} rejected: sequence constraint violated.`, "critical");
      this.error(player, "Sequence rejected. One or more crew constraints were violated.");
      this.broadcastState();
      return;
    }

    this.addCompleted(action);
    this.statusMessage = `${action.replaceAll("_", " ")} confirmed.`;
    this.recordEvent(player, `${action.replaceAll("_", " ")} confirmed.`, "success");
    this.broadcastState();

    if (this.completedActions.length === expected.length) {
      const currentPhase = this.phase;
      setTimeout(() => {
        if (this.phase === currentPhase) this.transition(nextPhase);
      }, 1200);
    }
  }

  handlePowerAllocation(player, rawAllocations) {
    if (this.hasCompleted("allocation")) return;
    const keys = ["life", "cooling", "navigation", "science"];
    const allocations = {};
    for (const key of keys) {
      const value = Number(rawAllocations?.[key]);
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        return this.error(player, "Enter a non-negative whole number for every allocation.");
      }
      allocations[key] = value;
    }

    const p = this.scenario.power;
    const lifeMinimum = p.lifeBase + p.lifePerCrew * this.players.size;
    const total = keys.reduce((sum, key) => sum + allocations[key], 0);
    const issues = [];

    if (total !== p.available) issues.push("the allocations do not use the exact available total");
    if (allocations.life < lifeMinimum) {
      issues.push("life support is below its medical minimum");
      this.oxygen = Math.max(0, this.oxygen - 10);
    }
    if (allocations.cooling < p.coolingMin) {
      issues.push("cooling is below the thermal minimum");
      this.heat = Math.min(100, this.heat + 14);
    }
    if (allocations.navigation < p.navigationMin) {
      issues.push("navigation is below the return-corridor minimum");
      this.trajectory = Math.max(0, this.trajectory - 14);
    }

    if (issues.length > 0) {
      this.power = Math.max(0, this.power - 5);
      this.recordEvent(player, `Power allocation rejected: ${issues.join("; ")}.`, "critical");
      this.error(player, `Allocation rejected: ${issues.join("; ")}.`);
      this.broadcastState();
      return;
    }

    const lifeSurplus = allocations.life - lifeMinimum;
    const coolingSurplus = allocations.cooling - p.coolingMin;
    const navigationSurplus = allocations.navigation - p.navigationMin;
    this.oxygen = Math.min(100, this.oxygen + lifeSurplus * 0.8);
    this.heat = Math.max(0, this.heat - coolingSurplus * 1.2);
    this.trajectory = Math.min(100, this.trajectory + navigationSurplus * 2);
    this.missionData = Math.min(100, this.missionData + allocations.science * 3);
    this.addCompleted("allocation");
    this.statusMessage = `Power bus stabilized. ${allocations.science} units preserved for science.`;
    this.recordEvent(player, `Stabilized Bus B; ${allocations.science} units routed to science.`, "success");
    this.broadcastState();
    setTimeout(() => {
      if (this.phase === "power") this.transition("navigation");
    }, 1400);
  }

  handleBurn(player, message) {
    if (this.hasCompleted("burn_programmed")) return;
    const direction = typeof message.direction === "string" ? message.direction.toLowerCase() : "";
    const seconds = Number(message.value);
    const n = this.scenario.navigation;

    if (!["prograde", "retrograde"].includes(direction) || !Number.isInteger(seconds) || seconds < 1 || seconds > 180) {
      return this.error(player, "Enter a burn direction and a whole-number duration between 1 and 180 seconds.");
    }

    if (direction !== n.direction || seconds !== n.answerSeconds) {
      const durationError = Math.abs(seconds - n.answerSeconds);
      this.trajectory = Math.max(0, this.trajectory - Math.min(18, 7 + durationError * 0.6));
      this.power = Math.max(0, this.power - 5);
      this.recordEvent(player, `Burn command rejected (${direction || "no direction"}, ${Number.isFinite(seconds) ? `${seconds}s` : "invalid time"}).`, "critical");
      this.error(player, "Burn solution rejected. Recheck drift sign, effective acceleration, direction, and rounding.");
      this.broadcastState();
      return;
    }

    this.addCompleted("burn_programmed");
    this.trajectory = Math.min(100, this.trajectory + 24);
    this.missionData = Math.min(100, this.missionData + 8);
    this.statusMessage = "Correction burn complete. Free-return trajectory restored.";
    this.recordEvent(player, `Executed ${direction} correction burn for ${seconds}s.`, "success");
    this.broadcastState();
    setTimeout(() => {
      if (this.phase === "navigation") this.transition("reentry");
    }, 1400);
  }

  handleEntryAngle(player, rawValue) {
    if (this.hasCompleted("entry_angle")) return;
    const angle = Number(rawValue);
    const target = this.scenario.reentry.answerAngle;
    if (!Number.isFinite(angle) || angle < 4 || angle > 9) {
      return this.error(player, "Enter a valid entry angle between 4.0° and 9.0°.");
    }

    if (Math.abs(angle - target) > 0.051) {
      this.heat = Math.min(100, this.heat + 10);
      this.trajectory = Math.max(0, this.trajectory - 10);
      this.recordEvent(player, `Entry command ${angle.toFixed(1)}° rejected.`, "critical");
      this.error(player, "Entry solution rejected. Apply the weather shift, intersect every limit, then use the midpoint.");
      this.broadcastState();
      return;
    }

    this.addCompleted("entry_angle");
    this.angleLockedAt = this.phaseSeconds;
    this.statusMessage = "Entry angle locked. Descent clock running; calculate the parachute window.";
    this.recordEvent(player, `Locked entry angle at ${angle.toFixed(1)}°. Descent clock started.`, "success");
    this.broadcastState();
  }

  handleParachutes(player) {
    if (!this.hasCompleted("entry_angle")) return this.error(player, "Lock the entry angle before parachute deployment.");
    if (this.hasCompleted("parachute_attempted")) return;

    this.addCompleted("parachute_attempted");
    const elapsed = Math.max(0, this.phaseSeconds - this.angleLockedAt);
    this.recordEvent(player, `Commanded parachute deployment at T+${elapsed}s.`, "warning");
    const r = this.scenario.reentry;

    if (elapsed < r.earliestChute) {
      this.finish(false, "Parachutes deployed above their maximum safe velocity and failed.");
      return;
    }
    if (elapsed > r.latestChute) {
      this.finish(false, "Parachutes deployed below the minimum recovery altitude.");
      return;
    }

    this.addCompleted("parachutes");
    const averageMargin = (this.oxygen + this.power + (100 - this.heat) + this.trajectory) / 4;
    let rating = "SURVIVAL RETURN";
    if (this.missionData >= 55 && averageMargin >= 68) rating = "SCIENTIFIC TRIUMPH";
    else if (averageMargin >= 52) rating = "NOMINAL RETURN";
    this.finish(true, `Splashdown confirmed. Mission rating: ${rating}.`);
  }

  transition(phase) {
    this.phase = phase;
    this.phaseIndex += 1;
    this.phaseSeconds = 0;
    this.completedActions = [];
    this.angleLockedAt = null;

    if (phase === "launch") {
      this.phaseDeadline = 150;
      this.objective = "Deduce the launch procedure";
      this.objectiveDetail = "Five controls, one valid order. Read every assigned station brief before clicking.";
      this.statusMessage = "T-minus 150 seconds. Procedure constraints distributed to the crew.";
      this.alertLevel = "warning";
    } else if (phase === "power") {
      this.phaseDeadline = 180;
      this.objective = "Allocate the emergency power bus";
      this.objectiveDetail = "Meet all safety minimums, use the exact available total, then decide how much margin to preserve for science.";
      this.statusMessage = "Bus B thermal runaway detected. Manual allocation required.";
      this.alertLevel = "critical";
      this.power = Math.min(this.power, 88);
      this.heat = Math.max(this.heat, 28);
    } else if (phase === "navigation") {
      this.phaseDeadline = 180;
      this.objective = "Calculate the correction burn";
      this.objectiveDetail = "Determine direction and duration from target Δv, drift, rated acceleration, and engine efficiency.";
      this.statusMessage = "Free-return corridor degrading. One continuous correction burn available.";
      this.alertLevel = "warning";
      this.trajectory = Math.min(this.trajectory, 62);
    } else if (phase === "reentry") {
      this.phaseDeadline = 180;
      this.objective = "Solve the entry corridor and chute window";
      this.objectiveDetail = "First intersect the angle constraints. Then use speed and altitude equations to calculate the safe descent-clock window.";
      this.statusMessage = "Entry interface approaching. Crew calculations required.";
      this.alertLevel = "critical";
      this.heat = Math.max(this.heat, 34);
    }

    const phaseNames = {
      launch: "Launch procedure active.",
      power: "Emergency power phase active.",
      navigation: "Correction-burn phase active.",
      reentry: "Atmospheric return phase active.",
    };
    this.recordEvent(null, phaseNames[phase] || `${phase} phase active.`, phase === "power" || phase === "reentry" ? "warning" : "info");
    this.broadcastState();
  }

  tick() {
    if (this.disposed || ["lobby", "won", "lost"].includes(this.phase)) return;
    this.missionSeconds += 1;
    this.phaseSeconds += 1;
    this.oxygen = Math.max(0, this.oxygen - 0.035);
    this.power = Math.max(0, this.power - 0.03);

    if (this.phase === "power") {
      this.power = Math.max(0, this.power - 0.08);
      this.heat = Math.min(100, this.heat + 0.09);
    }

    if (this.phase === "navigation") {
      this.trajectory = Math.max(0, this.trajectory - 0.045);
    }

    if (this.phase === "reentry") {
      if (this.angleLockedAt === null) {
        this.heat = Math.min(100, this.heat + (this.phaseSeconds > 75 ? 0.32 : 0.08));
      } else {
        const descent = Math.max(0, this.phaseSeconds - this.angleLockedAt);
        this.heat = Math.max(0, Math.min(100, this.heat + (descent < 22 ? 1.15 : -0.55)));
        if (descent > this.scenario.reentry.latestChute) {
          this.trajectory = Math.max(0, this.trajectory - 0.6);
          this.alertLevel = "critical";
        }
      }
    }

    if (this.phaseDeadline > 0 && this.phaseSeconds >= this.phaseDeadline) {
      this.finish(false, "The crew exceeded the phase deadline.");
      return;
    }

    if (this.oxygen <= 0) this.finish(false, "Cabin oxygen depleted.");
    else if (this.power <= 0) this.finish(false, "Spacecraft power depleted.");
    else if (this.heat >= 100) this.finish(false, "Thermal protection system failed.");
    else if (this.trajectory <= 0) this.finish(false, "The spacecraft departed the recoverable corridor.");
    else this.broadcastState();
  }

  finish(success, message) {
    if (["won", "lost"].includes(this.phase)) return;
    this.phase = success ? "won" : "lost";
    this.phaseDeadline = 0;
    this.alertLevel = success ? "normal" : "critical";
    this.objective = success ? "Mission accomplished" : "Mission lost";
    this.objectiveDetail = success
      ? "Review your remaining margins and mission data, then try a newly randomized mission."
      : "Identify the assumption that failed. A reset generates new numbers and a new procedure.";
    this.statusMessage = message;
    this.recordEvent(null, message, success ? "success" : "critical");
    this.broadcastState();
  }

  recordEvent(player, text, severity = "info") {
    this.eventSequence += 1;
    this.events.push({
      id: this.eventSequence,
      missionSecond: this.missionSeconds,
      actorSessionId: player?.sessionId || "",
      actor: player?.name || "",
      role: player?.role || "",
      text,
      severity,
    });
    if (this.events.length > 20) this.events.splice(0, this.events.length - 20);
  }

  hasCompleted(action) {
    return this.completedActions.includes(action);
  }

  addCompleted(action) {
    if (!this.hasCompleted(action)) this.completedActions.push(action);
  }

  error(player, message) {
    safeSend(player.socket, { type: "error", message });
  }

  broadcastNotice(message) {
    this.broadcast({ type: "notice", message });
  }

  broadcastState() {
    for (const player of this.players.values()) {
      safeSend(player.socket, {
        type: "state",
        state: this.stateFor(player),
        reconnectionToken: player.reconnectToken,
      });
    }
  }

  broadcast(payload) {
    for (const player of this.players.values()) safeSend(player.socket, payload);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.tickTimer);
    rooms.delete(this.code);
  }
}

const httpServer = createServer(serveStatic);
const websocketServer = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: 8192 });

websocketServer.on("connection", (socket) => {
  socket.isAlive = true;
  socket.messageTimes = [];
  const joinTimeout = setTimeout(() => {
    if (!socket.context) socket.close(1008, "Join timeout");
  }, 10_000);

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", (rawData) => {
    const now = Date.now();
    socket.messageTimes = socket.messageTimes.filter((timestamp) => now - timestamp < 1000);
    socket.messageTimes.push(now);
    if (socket.messageTimes.length > 25) {
      socket.close(1008, "Rate limit exceeded");
      return;
    }

    let message;
    try {
      message = JSON.parse(rawData.toString());
    } catch {
      safeSend(socket, { type: "error", message: "Invalid message format." });
      return;
    }

    if (!socket.context) {
      try {
        if (message.type === "create") {
          const code = createRoomCode();
          const room = new MissionRoom(code);
          rooms.set(code, room);
          room.addPlayer(socket, message.playerName);
          clearTimeout(joinTimeout);
          return;
        }

        if (message.type === "join") {
          const code = typeof message.roomCode === "string" ? message.roomCode.trim().toUpperCase() : "";
          const room = rooms.get(code);
          if (!room) throw new Error("Mission not found. Check the room code.");
          room.addPlayer(socket, message.playerName);
          clearTimeout(joinTimeout);
          return;
        }

        if (message.type === "reconnect") {
          const token = typeof message.token === "string" ? message.token : "";
          let restored = false;
          for (const room of rooms.values()) {
            try {
              room.reconnect(socket, token);
              restored = true;
              break;
            } catch {
              // Search the next private room without exposing room membership.
            }
          }
          if (!restored) throw new Error("The reconnection window has expired.");
          clearTimeout(joinTimeout);
          return;
        }

        throw new Error("Create, join, or reconnect first.");
      } catch (error) {
        safeSend(socket, { type: "error", message: error instanceof Error ? error.message : "Unable to join." });
        return;
      }
    }

    const room = rooms.get(socket.context.roomCode);
    room?.handleMessage(socket.context.sessionId, message);
  });

  socket.on("close", () => {
    clearTimeout(joinTimeout);
    if (!socket.context) return;
    const room = rooms.get(socket.context.roomCode);
    room?.handleDisconnect(socket.context.sessionId, socket);
  });
});

const heartbeatTimer = setInterval(() => {
  for (const socket of websocketServer.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 20_000);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Lunar Mission listening on http://0.0.0.0:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeatTimer);
  for (const room of rooms.values()) room.dispose();
  websocketServer.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
