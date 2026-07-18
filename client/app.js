(() => {
  "use strict";

  const canvas = document.querySelector("#renderCanvas");
  const sceneController = window.createPeriluneScene(canvas);

  let socket = null;
  let currentState = null;
  let roomCode = "";
  let sessionId = "";
  let reconnectionToken = "";
  let reconnectAttempts = 0;
  let intentionalLeave = false;
  let toastTimeout = 0;

  const element = (selector) => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`Missing element: ${selector}`);
    return found;
  };

  const connectScreen = element("#connect-screen");
  const gameScreen = element("#game-screen");
  const playerNameInput = element("#player-name");
  const roomCodeInput = element("#room-code");
  const connectionStatus = element("#connection-status");
  const createButton = element("#create-button");
  const joinButton = element("#join-button");
  const roomDisplay = element("#room-display");
  const phaseTitle = element("#phase-title");
  const missionTime = element("#mission-time");
  const crewCount = element("#crew-count");
  const crewList = element("#crew-list");
  const roleSelect = element("#role-select");
  const readyButton = element("#ready-button");
  const startButton = element("#start-button");
  const roleControls = element("#role-controls");
  const statusMessage = element("#status-message");
  const objectiveTitle = element("#objective-title");
  const objectiveCopy = element("#objective-copy");
  const roleClue = element("#role-clue");
  const actions = element("#actions");
  const alertDot = element("#alert-dot");
  const phaseTimer = element("#phase-timer");
  const networkState = element("#network-state");
  const toast = element("#toast");

  playerNameInput.value = localStorage.getItem("perilune_player_name") || "";
  const inviteCode = new URLSearchParams(window.location.search).get("room");
  if (inviteCode) roomCodeInput.value = inviteCode.toUpperCase();

  function websocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 2500);
  }

  function setConnecting(message, busy) {
    connectionStatus.textContent = message;
    createButton.disabled = busy;
    joinButton.disabled = busy;
  }

  function playerName() {
    const value = playerNameInput.value.trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 18);
    if (!value) throw new Error("Enter a call sign first.");
    localStorage.setItem("perilune_player_name", value);
    return value;
  }

  function send(type, payload = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showToast("The connection is not ready.");
      return;
    }
    socket.send(JSON.stringify({ type, ...payload }));
  }

  function openSocket(firstMessage, isReconnect = false) {
    return new Promise((resolve, reject) => {
      const candidate = new WebSocket(websocketUrl());
      let settled = false;

      const fail = (message) => {
        if (settled) return;
        settled = true;
        try { candidate.close(); } catch { /* no-op */ }
        reject(new Error(message));
      };

      const timeout = window.setTimeout(() => fail("Connection timed out."), 10000);

      candidate.addEventListener("open", () => {
        candidate.send(JSON.stringify(firstMessage));
      });

      candidate.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === "joined") {
          window.clearTimeout(timeout);
          settled = true;
          socket = candidate;
          bindSocket(candidate);
          roomCode = message.roomCode;
          sessionId = message.sessionId;
          reconnectionToken = message.reconnectionToken;
          localStorage.setItem("perilune_reconnection_token", reconnectionToken);
          roomDisplay.textContent = roomCode;
          reconnectAttempts = 0;
          intentionalLeave = false;
          showGame();
          if (isReconnect) showToast("Mission connection restored.");
          resolve();
          return;
        }

        if (message.type === "error" && !settled) {
          window.clearTimeout(timeout);
          fail(message.message || "Unable to join mission.");
        }
      });

      candidate.addEventListener("error", () => fail("Unable to reach mission control."));
      candidate.addEventListener("close", () => {
        window.clearTimeout(timeout);
        if (!settled) fail("Connection closed before joining.");
      });
    });
  }

  function bindSocket(activeSocket) {
    activeSocket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "state") {
        currentState = message.state;
        if (message.reconnectionToken) {
          reconnectionToken = message.reconnectionToken;
          localStorage.setItem("perilune_reconnection_token", reconnectionToken);
        }
        render(message.state);
      } else if (message.type === "notice") {
        showToast(message.message);
      } else if (message.type === "error") {
        showToast(message.message);
      } else if (message.type === "pong") {
        // Application-level heartbeat response.
      }
    });

    activeSocket.addEventListener("close", () => {
      if (socket !== activeSocket) return;
      socket = null;
      networkState.textContent = "RECONNECTING";
      networkState.style.color = "var(--amber)";
      if (!intentionalLeave && reconnectionToken) scheduleReconnect();
    });

    activeSocket.addEventListener("error", () => {
      networkState.textContent = "NETWORK ERROR";
      networkState.style.color = "var(--red)";
    });
  }

  async function connect(mode) {
    try {
      setConnecting("Connecting to mission control…", true);
      const name = playerName();
      if (mode === "create") {
        await openSocket({ type: "create", playerName: name });
      } else {
        const code = roomCodeInput.value.trim().toUpperCase();
        if (code.length !== 6) throw new Error("Enter the six-character room code.");
        await openSocket({ type: "join", roomCode: code, playerName: name });
      }
      setConnecting("", false);
    } catch (error) {
      setConnecting(error instanceof Error ? error.message : "Unable to connect.", false);
    }
  }

  function scheduleReconnect() {
    if (reconnectAttempts >= 12) {
      networkState.textContent = "DISCONNECTED";
      networkState.style.color = "var(--red)";
      showToast("Reconnection window expired. Rejoin with the room code.");
      localStorage.removeItem("perilune_reconnection_token");
      return;
    }

    reconnectAttempts += 1;
    const delay = Math.min(5000, 250 * 2 ** Math.min(5, reconnectAttempts - 1));
    window.setTimeout(async () => {
      if (socket || intentionalLeave) return;
      try {
        await openSocket({ type: "reconnect", token: reconnectionToken }, true);
      } catch {
        scheduleReconnect();
      }
    }, delay);
  }

  function showGame() {
    connectScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    networkState.textContent = "CONNECTED";
    networkState.style.color = "var(--green)";
    window.history.replaceState({}, "", `?room=${roomCode}`);
  }

  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function clamp(value) {
    return Math.max(0, Math.min(100, value));
  }

  function setGauge(name, value) {
    element(`#${name}-value`).textContent = `${Math.round(value)}%`;
    element(`#${name}-bar`).style.width = `${clamp(value)}%`;
  }

  function phaseLabel(phase) {
    return {
      lobby: "Crew assembly",
      launch: "Launch and orbital checkout",
      power: "Deep-space power emergency",
      navigation: "Lunar correction burn",
      reentry: "Atmospheric re-entry",
      won: "Mission accomplished",
      lost: "Mission lost",
    }[phase] || phase;
  }

  function objectiveDescription(phase) {
    return {
      lobby: "Assign a unique station, mark yourself ready, and wait for the mission host to begin.",
      launch: "Complete the three launch actions. The order matters: prepare the ship before final authorization.",
      power: "A power bus is overheating. Protect life support by executing the correct emergency sequence.",
      navigation: "The spacecraft is drifting off the free-return trajectory. Combine the crew’s figures and calculate the burn duration.",
      reentry: "Set a survivable entry angle, monitor the heat peak, and deploy parachutes only when the green corridor opens.",
      won: "The capsule has splashed down. Your crew completed the lunar flyby and returned alive.",
      lost: "The spacecraft can no longer sustain the crew or complete a controlled return.",
    }[phase] || "";
  }

  const clues = {
    lobby: {
      default: "Different roles receive different pieces of information. Talk constantly; do not assume everyone sees what you see.",
    },
    launch: {
      Commander: "Launch authorization must be the final action, after guidance is armed and the cabin is sealed.",
      Pilot: "Arm flight guidance first. The computer needs a valid attitude solution before ignition.",
      Systems: "Seal the cabin before launch. Nominal pressure is 14.7 psi.",
      Navigator: "The ascent corridor is loaded, but guidance must be armed before the commander authorizes launch.",
      Science: "Your payload is secured. Do not delay cabin sealing for additional checks.",
      Medical: "Cabin pressure must be confirmed before launch authorization.",
      default: "Sequence: arm guidance, seal cabin, authorize launch.",
    },
    power: {
      Commander: "The approved sequence is: isolate payload → reroute cooling → prioritize life support.",
      Pilot: "Attitude control is stable. Do not spend power on propulsion during this fault.",
      Navigator: "The current trajectory is safe. Power can be removed from the science payload.",
      Systems: "Bus B is overheating. Isolate the payload before rerouting coolant or the breaker will trip.",
      Science: "The payload can be disconnected without losing mission-critical navigation data.",
      Medical: "Life support must be the final priority after the hot bus is isolated and cooling restored.",
      default: "Protect life support, but only after isolating the hot circuit and restoring cooling.",
    },
    navigation: {
      Commander: "Enter the burn as a whole number of seconds after the crew agrees.",
      Pilot: "The main engine acceleration for this maneuver is 3 m/s².",
      Navigator: "Required velocity change is 117 m/s. Burn duration equals Δv divided by acceleration.",
      Systems: "Power is sufficient for one continuous burn; do not split it.",
      Science: "Use t = Δv / a. The values supplied by Pilot and Navigator are exact for this game.",
      Medical: "A continuous burn is safe for the crew. No medical constraint changes the calculation.",
      default: "Combine Δv = 117 m/s with acceleration = 3 m/s².",
    },
    reentry: {
      Commander: "Set the angle first. Authorize parachutes only when the corridor indicator turns green.",
      Pilot: "Target the center of the safe corridor: 6.5°.",
      Navigator: "The survivable entry corridor is 5.8° to 7.2°. Centerline minimizes risk.",
      Systems: "Parachutes cannot survive deployment before the heat peak passes and the corridor opens.",
      Science: "A shallow entry risks skipping out; a steep entry increases heating. Use the centerline.",
      Medical: "The crew can tolerate the centerline profile. Wait for the green deployment corridor.",
      default: "Use 6.5°, then wait for the green parachute corridor.",
    },
    won: { default: "Recovery forces have acquired the capsule beacon." },
    lost: { default: "Review the sequence and communicate each clue aloud on the next attempt." },
  };

  function clueFor(phase, role) {
    const phaseClues = clues[phase] || clues.lobby;
    return phaseClues[role] || phaseClues.default;
  }

  function completedSet(state) {
    return new Set(state.completedActions.split(",").filter(Boolean));
  }

  function actionButton(label, action, preferredRole, done) {
    const wrapper = document.createElement("div");
    wrapper.className = "action-group";
    const button = document.createElement("button");
    button.textContent = done ? `✓ ${label}` : label;
    button.className = done ? "action-done" : "";
    button.disabled = done || !socket;
    button.addEventListener("click", () => send("action", { action }));
    const hint = document.createElement("small");
    hint.textContent = `Suggested: ${preferredRole}`;
    wrapper.append(button, hint);
    return wrapper;
  }

  function renderActions(state) {
    actions.replaceChildren();
    const done = completedSet(state);

    if (state.phase === "launch") {
      actions.append(
        actionButton("Arm guidance", "arm_guidance", "Pilot", done.has("arm_guidance")),
        actionButton("Seal cabin", "seal_cabin", "Systems", done.has("seal_cabin")),
        actionButton("Authorize launch", "authorize_launch", "Commander", done.has("authorize_launch")),
      );
    } else if (state.phase === "power") {
      actions.append(
        actionButton("Isolate payload", "isolate_payload", "Science", done.has("isolate_payload")),
        actionButton("Reroute cooling", "reroute_cooling", "Systems", done.has("reroute_cooling")),
        actionButton("Prioritize life support", "prioritize_life_support", "Commander", done.has("prioritize_life_support")),
      );
    } else if (state.phase === "navigation") {
      const wrapper = document.createElement("div");
      wrapper.className = "action-group";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.max = "180";
      input.placeholder = "Burn seconds";
      input.disabled = done.has("burn_39");
      const button = document.createElement("button");
      button.textContent = done.has("burn_39") ? "✓ Burn programmed" : "Program burn";
      button.className = done.has("burn_39") ? "action-done" : "";
      button.disabled = done.has("burn_39");
      button.addEventListener("click", () => send("action", { action: "program_burn", value: Number(input.value) }));
      const hint = document.createElement("small");
      hint.textContent = "Combine Navigator + Pilot data";
      wrapper.append(input, button, hint);
      actions.append(wrapper);
    } else if (state.phase === "reentry") {
      const angleWrapper = document.createElement("div");
      angleWrapper.className = "action-group";
      const angle = document.createElement("input");
      angle.type = "number";
      angle.step = "0.1";
      angle.placeholder = "Entry angle °";
      angle.disabled = done.has("entry_angle");
      const angleButton = document.createElement("button");
      angleButton.textContent = done.has("entry_angle") ? "✓ Angle locked" : "Set entry angle";
      angleButton.className = done.has("entry_angle") ? "action-done" : "";
      angleButton.disabled = done.has("entry_angle");
      angleButton.addEventListener("click", () => send("action", { action: "set_entry_angle", value: Number(angle.value) }));
      const angleHint = document.createElement("small");
      angleHint.textContent = "Suggested: Pilot + Navigator";
      angleWrapper.append(angle, angleButton, angleHint);

      const corridorOpen = state.phaseSeconds >= 20 && state.phaseSeconds <= 40 && done.has("entry_angle");
      const chute = actionButton(
        corridorOpen ? "Deploy parachutes — GREEN" : "Deploy parachutes",
        "deploy_parachutes",
        "Commander + Systems",
        done.has("parachutes"),
      );
      const chuteButton = chute.querySelector("button");
      if (chuteButton && !done.has("parachutes")) chuteButton.classList.toggle("primary", corridorOpen);
      actions.append(angleWrapper, chute);
    } else if (state.phase === "won" || state.phase === "lost") {
      const retry = document.createElement("button");
      retry.textContent = "Return to lobby";
      retry.disabled = state.hostSessionId !== sessionId;
      retry.addEventListener("click", () => send("reset"));
      actions.append(retry);
    }
  }

  function renderCrew(state) {
    crewList.replaceChildren();
    const players = Object.entries(state.players);
    crewCount.textContent = `${players.length} / 6`;

    for (const [playerSessionId, player] of players) {
      const member = document.createElement("div");
      member.className = "crew-member";
      const top = document.createElement("strong");
      const name = document.createElement("span");
      name.textContent = `${player.name}${playerSessionId === state.hostSessionId ? " ★" : ""}`;
      const status = document.createElement("span");
      status.textContent = player.connected ? (player.ready ? "READY" : "STANDBY") : "OFFLINE";
      status.className = player.connected ? (player.ready ? "ready" : "") : "offline";
      top.append(name, status);
      const role = document.createElement("small");
      role.textContent = player.role || "UNASSIGNED";
      member.append(top, role);
      crewList.append(member);
    }
  }

  function render(state) {
    sceneController.setAlert(state.alertLevel);
    sceneController.setPhase(state.phase);
    phaseTitle.textContent = phaseLabel(state.phase);
    missionTime.textContent = formatTime(state.missionSeconds);
    statusMessage.textContent = state.statusMessage;
    objectiveTitle.textContent = state.objective;
    objectiveCopy.textContent = objectiveDescription(state.phase);
    alertDot.className = `alert-dot ${state.alertLevel === "normal" ? "" : state.alertLevel}`;

    const me = state.players[sessionId];
    roleClue.textContent = clueFor(state.phase, me?.role || "default");
    if (me && roleSelect.value !== me.role) roleSelect.value = me.role;
    readyButton.textContent = me?.ready ? "Not ready" : "Ready";
    readyButton.classList.toggle("action-done", Boolean(me?.ready));

    const isLobby = state.phase === "lobby";
    roleControls.classList.toggle("hidden", !isLobby);
    roleSelect.disabled = Boolean(me?.ready) || !isLobby;
    startButton.classList.toggle("hidden", state.hostSessionId !== sessionId || !isLobby);

    setGauge("oxygen", state.oxygen);
    setGauge("power", state.power);
    setGauge("heat", state.heat);
    setGauge("trajectory", state.trajectory);

    if (state.phaseDeadline > 0 && !["won", "lost"].includes(state.phase)) {
      const remaining = Math.max(0, state.phaseDeadline - state.phaseSeconds);
      const corridor = state.phase === "reentry" && state.phaseSeconds >= 20 && state.phaseSeconds <= 40;
      phaseTimer.textContent = corridor
        ? `PARACHUTE CORRIDOR: GREEN · ${remaining}s remaining`
        : `PHASE DEADLINE: ${remaining}s`;
      phaseTimer.style.color = corridor ? "var(--green)" : "var(--amber)";
    } else {
      phaseTimer.textContent = "No active deadline";
    }

    renderCrew(state);
    renderActions(state);
  }

  createButton.addEventListener("click", () => connect("create"));
  joinButton.addEventListener("click", () => connect("join"));
  roomCodeInput.addEventListener("input", () => {
    roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  roleSelect.addEventListener("change", () => send("set_role", { role: roleSelect.value }));
  readyButton.addEventListener("click", () => send("toggle_ready"));
  startButton.addEventListener("click", () => send("start"));

  element("#copy-code-button").addEventListener("click", async () => {
    const invite = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    try {
      await navigator.clipboard.writeText(invite);
      showToast("Invite link copied.");
    } catch {
      showToast(invite);
    }
  });

  element("#leave-button").addEventListener("click", () => {
    intentionalLeave = true;
    localStorage.removeItem("perilune_reconnection_token");
    if (socket?.readyState === WebSocket.OPEN) send("leave");
    socket?.close();
    window.location.href = window.location.pathname;
  });

  window.addEventListener("beforeunload", () => {
    if (reconnectionToken && !intentionalLeave) {
      localStorage.setItem("perilune_reconnection_token", reconnectionToken);
    }
  });

  const cachedToken = localStorage.getItem("perilune_reconnection_token");
  if (cachedToken) {
    reconnectionToken = cachedToken;
    setConnecting("Attempting to restore your mission…", true);
    openSocket({ type: "reconnect", token: cachedToken }, true)
      .then(() => setConnecting("", false))
      .catch(() => {
        localStorage.removeItem("perilune_reconnection_token");
        reconnectionToken = "";
        setConnecting("", false);
      });
  }
})();
