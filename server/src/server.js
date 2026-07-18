import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLIENT_ROOT = join(ROOT, "client");
const PORT = Number.parseInt(process.env.PORT || "2567", 10);
const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROLES = new Set(["Commander", "Pilot", "Navigator", "Systems", "Science", "Medical"]);
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
    response.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
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
    this.phase = "lobby";
    this.phaseIndex = 0;
    this.missionSeconds = 0;
    this.phaseSeconds = 0;
    this.phaseDeadline = 0;
    this.oxygen = 100;
    this.power = 100;
    this.heat = 12;
    this.trajectory = 100;
    this.objective = "Select a station and ready up.";
    this.statusMessage = "Waiting for crew.";
    this.alertLevel = "normal";
    this.completedActions = [];
    this.disposed = false;
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  publicState() {
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
      roomCode: this.code,
      players,
      hostSessionId: this.hostSessionId,
      phase: this.phase,
      phaseIndex: this.phaseIndex,
      missionSeconds: this.missionSeconds,
      phaseSeconds: this.phaseSeconds,
      phaseDeadline: this.phaseDeadline,
      oxygen: this.oxygen,
      power: this.power,
      heat: this.heat,
      trajectory: this.trajectory,
      objective: this.objective,
      statusMessage: this.statusMessage,
      alertLevel: this.alertLevel,
      completedActions: this.completedActions.join(","),
    };
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
    this.broadcastState();
  }

  toggleReady(player) {
    if (this.phase !== "lobby") return;
    if (!player.role) return this.error(player, "Select a station first.");
    player.ready = !player.ready;
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

    this.phase = "lobby";
    this.phaseIndex = 0;
    this.missionSeconds = 0;
    this.phaseSeconds = 0;
    this.phaseDeadline = 0;
    this.oxygen = 100;
    this.power = 100;
    this.heat = 12;
    this.trajectory = 100;
    this.objective = "Select a station and ready up.";
    this.statusMessage = "Waiting for crew.";
    this.alertLevel = "normal";
    this.completedActions = [];
    for (const crewMember of this.players.values()) crewMember.ready = false;
    this.broadcastState();
  }

  handleAction(player, message) {
    const action = typeof message.action === "string" ? message.action : "";
    if (!action) return this.error(player, "Invalid action.");

    if (this.phase === "launch") {
      return this.handleSequenceAction(
        player,
        action,
        ["arm_guidance", "seal_cabin", "authorize_launch"],
        "power",
      );
    }

    if (this.phase === "power") {
      return this.handleSequenceAction(
        player,
        action,
        ["isolate_payload", "reroute_cooling", "prioritize_life_support"],
        "navigation",
      );
    }

    if (this.phase === "navigation" && action === "program_burn") {
      const answer = Number(message.value);
      if (answer === 39) {
        this.addCompleted("burn_39");
        this.statusMessage = "Correction burn complete. Free-return trajectory restored.";
        this.trajectory = Math.min(100, this.trajectory + 25);
        this.broadcastState();
        setTimeout(() => {
          if (this.phase === "navigation") this.transition("reentry");
        }, 1200);
      } else {
        this.trajectory = Math.max(0, this.trajectory - 15);
        this.power = Math.max(0, this.power - 6);
        this.error(player, "Incorrect burn. The failed maneuver consumed power and worsened the trajectory.");
        this.broadcastState();
      }
      return;
    }

    if (this.phase === "reentry" && action === "set_entry_angle") {
      const angle = Number(message.value);
      if (Math.abs(angle - 6.5) < 0.051) {
        this.addCompleted("entry_angle");
        this.statusMessage = "Entry angle locked. Hold through peak heating.";
      } else {
        this.heat = Math.min(100, this.heat + 12);
        this.trajectory = Math.max(0, this.trajectory - 12);
        this.error(player, "Unsafe corridor. Target the centerline, not an edge.");
      }
      this.broadcastState();
      return;
    }

    if (this.phase === "reentry" && action === "deploy_parachutes") {
      if (!this.hasCompleted("entry_angle")) return this.error(player, "Lock the entry angle first.");
      if (this.phaseSeconds < 20) {
        this.trajectory = Math.max(0, this.trajectory - 18);
        this.error(player, "Too early. The parachutes were damaged by peak heating.");
        this.broadcastState();
        return;
      }
      if (this.phaseSeconds > 40) {
        this.trajectory = Math.max(0, this.trajectory - 18);
        this.error(player, "Too late. Descent velocity is now critical.");
        this.broadcastState();
        return;
      }
      this.addCompleted("parachutes");
      this.finish(true, "Splashdown confirmed. Recovery forces are inbound.");
      return;
    }

    this.error(player, "That control is not valid in the current mission phase.");
  }

  handleSequenceAction(player, action, expected, nextPhase) {
    if (!expected.includes(action)) return this.error(player, "That control is not part of this procedure.");
    if (this.hasCompleted(action)) return;

    const requiredAction = expected[this.completedActions.length];
    if (action !== requiredAction) {
      this.power = Math.max(0, this.power - 5);
      this.trajectory = Math.max(0, this.trajectory - 4);
      this.error(player, "Incorrect sequence. Verify the crew briefs before continuing.");
      this.broadcastState();
      return;
    }

    this.addCompleted(action);
    this.statusMessage = `${action.replaceAll("_", " ")} confirmed.`;
    this.broadcastState();

    if (this.completedActions.length === expected.length) {
      const currentPhase = this.phase;
      setTimeout(() => {
        if (this.phase === currentPhase) this.transition(nextPhase);
      }, 1200);
    }
  }

  transition(phase) {
    this.phase = phase;
    this.phaseIndex += 1;
    this.phaseSeconds = 0;
    this.completedActions = [];

    if (phase === "launch") {
      this.phaseDeadline = 75;
      this.objective = "Complete launch configuration";
      this.statusMessage = "T-minus 75 seconds. Guidance, pressure, authorization.";
      this.alertLevel = "warning";
    } else if (phase === "power") {
      this.phaseDeadline = 100;
      this.objective = "Stabilize the overheating power bus";
      this.statusMessage = "Bus B thermal runaway detected.";
      this.alertLevel = "critical";
      this.power = Math.min(this.power, 86);
    } else if (phase === "navigation") {
      this.phaseDeadline = 150;
      this.objective = "Calculate and execute the correction burn";
      this.statusMessage = "Free-return trajectory error: 117 m/s correction required.";
      this.alertLevel = "warning";
      this.trajectory = Math.min(this.trajectory, 66);
    } else if (phase === "reentry") {
      this.phaseDeadline = 60;
      this.objective = "Survive re-entry and splash down";
      this.statusMessage = "Entry interface. Set corridor angle before peak heating.";
      this.alertLevel = "critical";
      this.heat = Math.max(this.heat, 35);
    }

    this.broadcastState();
  }

  tick() {
    if (this.disposed || ["lobby", "won", "lost"].includes(this.phase)) return;
    this.missionSeconds += 1;
    this.phaseSeconds += 1;
    this.oxygen = Math.max(0, this.oxygen - 0.055);
    this.power = Math.max(0, this.power - 0.045);

    if (this.phase === "power") {
      this.power = Math.max(0, this.power - 0.12);
      this.oxygen = Math.max(0, this.oxygen - 0.05);
      this.heat = Math.min(100, this.heat + (this.hasCompleted("reroute_cooling") ? 0.02 : 0.17));
    }

    if (this.phase === "navigation") {
      this.trajectory = Math.max(0, this.trajectory - 0.08);
    }

    if (this.phase === "reentry") {
      const angleLocked = this.hasCompleted("entry_angle");
      const heatingRate = this.phaseSeconds < 25 ? (angleLocked ? 1.1 : 1.55) : -0.85;
      this.heat = Math.max(0, Math.min(100, this.heat + heatingRate));

      if (this.phaseSeconds === 20 && angleLocked) {
        this.statusMessage = "Peak heating passed. Parachute corridor GREEN for 20 seconds.";
        this.alertLevel = "normal";
      }
      if (this.phaseSeconds === 41) {
        this.statusMessage = "Parachute corridor missed. Immediate deployment required.";
        this.alertLevel = "critical";
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
    this.statusMessage = message;
    this.broadcastState();
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
    const state = this.publicState();
    for (const player of this.players.values()) {
      safeSend(player.socket, {
        type: "state",
        state,
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
const websocketServer = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: 4096 });

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
    rooms.get(socket.context.roomCode)?.handleDisconnect(socket.context.sessionId, socket, false);
  });
});

const heartbeat = setInterval(() => {
  for (const socket of websocketServer.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 15_000);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[PERILUNE] Running on http://localhost:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const room of rooms.values()) room.dispose();
  websocketServer.close(() => httpServer.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
