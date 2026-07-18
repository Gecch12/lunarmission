(() => {
  "use strict";

  const canvas = document.querySelector("#renderCanvas");
  const sceneController = window.createLunarMissionScene(canvas);

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

  const oldPlayerName = localStorage.getItem("perilune_player_name");
  playerNameInput.value = localStorage.getItem("lunar_mission_player_name") || oldPlayerName || "";
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
    toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function setConnecting(message, busy) {
    connectionStatus.textContent = message;
    createButton.disabled = busy;
    joinButton.disabled = busy;
  }

  function playerName() {
    const value = playerNameInput.value.trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 18);
    if (!value) throw new Error("Enter a call sign first.");
    localStorage.setItem("lunar_mission_player_name", value);
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
          localStorage.setItem("lunar_mission_reconnection_token", reconnectionToken);
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
          localStorage.setItem("lunar_mission_reconnection_token", reconnectionToken);
        }
        render(message.state);
      } else if (message.type === "notice") {
        showToast(message.message);
      } else if (message.type === "error") {
        showToast(message.message);
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
      localStorage.removeItem("lunar_mission_reconnection_token");
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
      launch: "Launch logic procedure",
      power: "Emergency power allocation",
      navigation: "Lunar correction burn",
      reentry: "Re-entry and splashdown",
      won: "Mission complete",
      lost: "Mission lost",
    }[phase] || "Lunar Mission";
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
    hint.textContent = `Suggested station: ${preferredRole}`;
    wrapper.append(button, hint);
    return wrapper;
  }

  function numberField(label, placeholder) {
    const field = document.createElement("label");
    field.className = "allocation-field";
    const title = document.createElement("span");
    title.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.placeholder = placeholder;
    field.append(title, input);
    return { field, input };
  }

  function renderLaunchActions(done) {
    actions.append(
      actionButton("Align flight computer", "align_computer", "Navigator / Science", done.has("align_computer")),
      actionButton("Start oxygen scrubbers", "start_scrubbers", "Medical", done.has("start_scrubbers")),
      actionButton("Seal cabin", "seal_cabin", "Systems", done.has("seal_cabin")),
      actionButton("Arm guidance", "arm_guidance", "Pilot", done.has("arm_guidance")),
      actionButton("Authorize launch", "authorize_launch", "Commander", done.has("authorize_launch")),
    );
  }

  function renderPowerActions(done) {
    if (done.has("allocation")) {
      const confirmed = document.createElement("button");
      confirmed.className = "action-done";
      confirmed.disabled = true;
      confirmed.textContent = "✓ Allocation accepted";
      actions.append(confirmed);
      return;
    }

    const panel = document.createElement("div");
    panel.className = "allocation-panel";
    const grid = document.createElement("div");
    grid.className = "allocation-grid";
    const life = numberField("Life support", "units");
    const cooling = numberField("Cooling", "units");
    const navigation = numberField("Navigation", "units");
    const science = numberField("Science", "units");
    grid.append(life.field, cooling.field, navigation.field, science.field);

    const footer = document.createElement("div");
    footer.className = "allocation-footer";
    const total = document.createElement("strong");
    total.textContent = "TOTAL: 0";
    const submit = document.createElement("button");
    submit.className = "primary";
    submit.textContent = "Submit allocation";
    const inputs = [life.input, cooling.input, navigation.input, science.input];
    const updateTotal = () => {
      const value = inputs.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
      total.textContent = `TOTAL: ${value}`;
    };
    for (const input of inputs) input.addEventListener("input", updateTotal);
    submit.addEventListener("click", () => {
      send("action", {
        action: "submit_allocation",
        allocations: {
          life: Number(life.input.value),
          cooling: Number(cooling.input.value),
          navigation: Number(navigation.input.value),
          science: Number(science.input.value),
        },
      });
    });
    const hint = document.createElement("small");
    hint.textContent = "Use the exact total. Safety minimums are distributed across station briefs.";
    footer.append(total, submit, hint);
    panel.append(grid, footer);
    actions.append(panel);
  }

  function renderNavigationActions(done) {
    const wrapper = document.createElement("div");
    wrapper.className = "calculation-panel";
    const directionLabel = document.createElement("label");
    directionLabel.className = "allocation-field";
    const directionTitle = document.createElement("span");
    directionTitle.textContent = "Burn direction";
    const direction = document.createElement("select");
    direction.innerHTML = '<option value="">Select direction</option><option value="prograde">Prograde</option><option value="retrograde">Retrograde</option>';
    direction.disabled = done.has("burn_programmed");
    directionLabel.append(directionTitle, direction);

    const time = numberField("Burn duration", "whole seconds");
    time.input.min = "1";
    time.input.max = "180";
    time.input.disabled = done.has("burn_programmed");

    const button = document.createElement("button");
    button.textContent = done.has("burn_programmed") ? "✓ Burn programmed" : "Program burn";
    button.className = done.has("burn_programmed") ? "action-done" : "primary";
    button.disabled = done.has("burn_programmed");
    button.addEventListener("click", () => send("action", {
      action: "program_burn",
      direction: direction.value,
      value: Number(time.input.value),
    }));

    const hint = document.createElement("small");
    hint.textContent = "Adjust Δv for drift, calculate effective acceleration, then round once at the end.";
    wrapper.append(directionLabel, time.field, button, hint);
    actions.append(wrapper);
  }

  function renderReentryActions(state, done) {
    const angleWrapper = document.createElement("div");
    angleWrapper.className = "calculation-panel";
    const angle = numberField("Entry angle", "degrees to 0.1°");
    angle.input.step = "0.1";
    angle.input.min = "4";
    angle.input.max = "9";
    angle.input.disabled = done.has("entry_angle");
    const angleButton = document.createElement("button");
    angleButton.textContent = done.has("entry_angle") ? "✓ Angle locked" : "Lock entry angle";
    angleButton.className = done.has("entry_angle") ? "action-done" : "primary";
    angleButton.disabled = done.has("entry_angle");
    angleButton.addEventListener("click", () => send("action", { action: "set_entry_angle", value: Number(angle.input.value) }));
    const angleHint = document.createElement("small");
    angleHint.textContent = "Shift the nominal corridor, intersect every limit, and choose the midpoint.";
    angleWrapper.append(angle.field, angleButton, angleHint);
    actions.append(angleWrapper);

    if (done.has("entry_angle")) {
      const chute = document.createElement("div");
      chute.className = "action-group chute-control";
      const button = document.createElement("button");
      button.className = "danger-action";
      button.textContent = done.has("parachutes") ? "✓ Parachutes deployed" : `Deploy parachutes · T+${String(state.descentSeconds ?? 0).padStart(2, "0")}`;
      button.disabled = done.has("parachutes") || done.has("parachute_attempted");
      button.addEventListener("click", () => send("action", { action: "deploy_parachutes" }));
      const hint = document.createElement("small");
      hint.textContent = "One attempt. Calculate the overlap between velocity-safe and altitude-safe time windows.";
      chute.append(button, hint);
      actions.append(chute);
    }
  }

  function renderActions(state) {
    actions.replaceChildren();
    const done = completedSet(state);

    if (state.phase === "launch") renderLaunchActions(done);
    else if (state.phase === "power") renderPowerActions(done);
    else if (state.phase === "navigation") renderNavigationActions(done);
    else if (state.phase === "reentry") renderReentryActions(state, done);
    else if (state.phase === "won" || state.phase === "lost") {
      const retry = document.createElement("button");
      retry.textContent = "Generate new mission";
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
    objectiveCopy.textContent = state.objectiveDetail || "";
    alertDot.className = `alert-dot ${state.alertLevel === "normal" ? "" : state.alertLevel}`;

    const me = state.players[sessionId];
    roleClue.textContent = state.privateBrief || "Choose a role to receive your mission information.";
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
    setGauge("data", state.missionData);

    if (state.phaseDeadline > 0 && !["won", "lost"].includes(state.phase)) {
      const remaining = Math.max(0, state.phaseDeadline - state.phaseSeconds);
      phaseTimer.textContent = state.phase === "reentry" && state.descentSeconds !== null
        ? `DESCENT CLOCK: T+${String(state.descentSeconds).padStart(2, "0")} · PHASE DEADLINE: ${remaining}s`
        : `PHASE DEADLINE: ${remaining}s`;
      phaseTimer.style.color = state.phase === "reentry" && state.descentSeconds !== null ? "var(--cyan)" : "var(--amber)";
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
    localStorage.removeItem("lunar_mission_reconnection_token");
    localStorage.removeItem("perilune_reconnection_token");
    if (socket?.readyState === WebSocket.OPEN) send("leave");
    socket?.close();
    window.location.href = window.location.pathname;
  });

  window.addEventListener("beforeunload", () => {
    if (reconnectionToken && !intentionalLeave) {
      localStorage.setItem("lunar_mission_reconnection_token", reconnectionToken);
    }
  });

  const cachedToken = localStorage.getItem("lunar_mission_reconnection_token")
    || localStorage.getItem("perilune_reconnection_token");
  if (cachedToken) {
    reconnectionToken = cachedToken;
    setConnecting("Attempting to restore your mission…", true);
    openSocket({ type: "reconnect", token: cachedToken }, true)
      .then(() => setConnecting("", false))
      .catch(() => {
        localStorage.removeItem("lunar_mission_reconnection_token");
        localStorage.removeItem("perilune_reconnection_token");
        reconnectionToken = "";
        setConnecting("", false);
      });
  }
})();
