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
  let lastPhase = "";
  let lastActionRenderKey = "";
  let lastEventId = 0;
  let visualPhase = "";

  const drafts = {
    power: { life: "", cooling: "", navigation: "", science: "" },
    navigation: { direction: "", duration: "" },
    reentry: { angle: "" },
  };

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
  const activityFeed = element("#activity-feed");
  const visualTitle = element("#visual-title");
  const visualTelemetry = element("#visual-telemetry");
  const phaseVisual = element("#phase-visual");
  const systemsStatus = element("#systems-status");
  const speedValue = element("#speed-value");
  const altitudeValue = element("#altitude-value");
  const descentValue = element("#descent-value");
  const telemetryCard = element("#telemetry-card");
  const soundButton = element("#sound-button");
  const cinematicFlash = element("#cinematic-flash");
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
    toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 3400);
  }

  function flash(type = "normal") {
    cinematicFlash.className = type === "danger" ? "flash danger" : "flash";
    window.setTimeout(() => { cinematicFlash.className = ""; }, 620);
  }

  function shake() {
    document.body.classList.remove("screen-shake");
    void document.body.offsetWidth;
    document.body.classList.add("screen-shake");
    window.setTimeout(() => document.body.classList.remove("screen-shake"), 430);
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

  /* Lightweight browser-generated sound: no downloaded audio assets. */
  const audio = {
    enabled: false,
    context: null,
    humOscillator: null,
    humGain: null,

    ensure() {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return false;
        this.context = new AudioContext();
      }
      if (this.context.state === "suspended") this.context.resume();
      return true;
    },

    startHum() {
      if (!this.ensure() || this.humOscillator) return;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      osc.type = "sawtooth";
      osc.frequency.value = 58;
      filter.type = "lowpass";
      filter.frequency.value = 145;
      gain.gain.value = 0.008;
      osc.connect(filter).connect(gain).connect(this.context.destination);
      osc.start();
      this.humOscillator = osc;
      this.humGain = gain;
    },

    stopHum() {
      if (!this.humOscillator) return;
      try { this.humOscillator.stop(); } catch { /* no-op */ }
      this.humOscillator = null;
      this.humGain = null;
    },

    tone(frequency = 480, duration = 0.12, type = "sine", volume = 0.045, delay = 0) {
      if (!this.enabled || !this.ensure()) return;
      const start = this.context.currentTime + delay;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(this.context.destination);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    },

    click() { this.tone(620, 0.07, "square", 0.025); },
    success() {
      this.tone(520, 0.11, "sine", 0.04);
      this.tone(680, 0.16, "sine", 0.04, 0.1);
    },
    warning() { this.tone(255, 0.18, "square", 0.035); },
    danger() {
      this.tone(180, 0.16, "sawtooth", 0.055);
      this.tone(150, 0.2, "sawtooth", 0.045, 0.17);
    },
    phase() {
      this.tone(390, 0.1, "sine", 0.035);
      this.tone(520, 0.13, "sine", 0.035, 0.08);
      this.tone(780, 0.16, "sine", 0.03, 0.17);
    },
  };

  soundButton.addEventListener("click", () => {
    audio.enabled = !audio.enabled;
    soundButton.textContent = `Sound: ${audio.enabled ? "on" : "off"}`;
    soundButton.setAttribute("aria-pressed", String(audio.enabled));
    if (audio.enabled) {
      audio.startHum();
      audio.phase();
    } else {
      audio.stopHum();
    }
  });

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
      candidate.addEventListener("open", () => candidate.send(JSON.stringify(firstMessage)));

      candidate.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }

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
      try { message = JSON.parse(event.data); } catch { return; }

      if (message.type === "state") {
        currentState = message.state;
        if (message.reconnectionToken) {
          reconnectionToken = message.reconnectionToken;
          localStorage.setItem("lunar_mission_reconnection_token", reconnectionToken);
        }
        render(message.state);
      } else if (message.type === "notice") {
        showToast(message.message);
        audio.click();
      } else if (message.type === "error") {
        showToast(message.message);
        audio.danger();
        sceneController.pulse("danger");
        shake();
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
      try { await openSocket({ type: "reconnect", token: reconnectionToken }, true); }
      catch { scheduleReconnect(); }
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

  function clamp(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }

  function setGauge(name, value, inverse = false) {
    const safe = clamp(value);
    const gauge = element(`#${name}-gauge`);
    element(`#${name}-value`).textContent = `${Math.round(safe)}%`;
    gauge.style.setProperty("--value", safe);
    gauge.classList.remove("warning", "critical");
    const risk = inverse ? safe : 100 - safe;
    if (risk >= 70) gauge.classList.add("critical");
    else if (risk >= 45) gauge.classList.add("warning");
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
    return new Set(String(state.completedActions || "").split(",").filter(Boolean));
  }

  function actionLabel(action) {
    return {
      align_computer: "Flight computer aligned",
      start_scrubbers: "Oxygen scrubbers running",
      seal_cabin: "Cabin sealed",
      arm_guidance: "Guidance armed",
      authorize_launch: "Launch authorized",
      allocation: "Emergency power allocated",
      burn_programmed: "Correction burn executed",
      entry_angle: "Entry angle locked",
      parachutes: "Parachutes deployed",
      parachute_attempted: "Parachute command sent",
    }[action] || String(action || "").replaceAll("_", " ");
  }

  function actionButton(label, action, preferredRole, done, icon = "◆") {
    const wrapper = document.createElement("div");
    wrapper.className = "action-group launch-action";
    const button = document.createElement("button");
    button.textContent = done ? `✓ ${label}` : `${icon}  ${label}`;
    button.className = done ? "action-done" : "";
    button.disabled = done || !socket;
    button.addEventListener("click", () => {
      audio.click();
      send("action", { action });
    });
    const hint = document.createElement("small");
    hint.textContent = `Suggested: ${preferredRole}`;
    wrapper.append(button, hint);
    return wrapper;
  }

  function numberField(label, placeholder, value = "") {
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
    input.value = value;
    field.append(title, input);
    return { field, input };
  }

  function renderLaunchActions(done) {
    const panel = document.createElement("div");
    panel.className = "launch-actions";
    panel.append(
      actionButton("Align computer", "align_computer", "Navigator / Science", done.has("align_computer"), "▣"),
      actionButton("Start scrubbers", "start_scrubbers", "Medical", done.has("start_scrubbers"), "◉"),
      actionButton("Seal cabin", "seal_cabin", "Systems", done.has("seal_cabin"), "⬡"),
      actionButton("Arm guidance", "arm_guidance", "Pilot", done.has("arm_guidance"), "⌁"),
      actionButton("Authorize launch", "authorize_launch", "Commander", done.has("authorize_launch"), "▲"),
    );
    actions.append(panel);
  }

  function renderPowerActions(done) {
    if (done.has("allocation")) {
      const confirmed = document.createElement("button");
      confirmed.className = "action-done";
      confirmed.disabled = true;
      confirmed.textContent = "✓ Allocation accepted — bus stable";
      actions.append(confirmed);
      return;
    }

    const panel = document.createElement("div");
    panel.className = "allocation-panel";
    const grid = document.createElement("div");
    grid.className = "allocation-grid";
    const life = numberField("Life support", "units", drafts.power.life);
    const cooling = numberField("Cooling", "units", drafts.power.cooling);
    const navigation = numberField("Navigation", "units", drafts.power.navigation);
    const science = numberField("Science", "units", drafts.power.science);
    const fields = { life, cooling, navigation, science };
    grid.append(life.field, cooling.field, navigation.field, science.field);

    const footer = document.createElement("div");
    footer.className = "allocation-footer";
    const total = document.createElement("strong");
    const submit = document.createElement("button");
    submit.className = "primary";
    submit.textContent = "Route power";

    const updateTotal = () => {
      let sum = 0;
      for (const [key, control] of Object.entries(fields)) {
        drafts.power[key] = control.input.value;
        sum += Number(control.input.value) || 0;
      }
      total.textContent = `TOTAL: ${sum}`;
      updatePowerVisual();
    };
    for (const control of Object.values(fields)) control.input.addEventListener("input", updateTotal);
    updateTotal();

    submit.addEventListener("click", () => {
      audio.click();
      send("action", {
        action: "submit_allocation",
        allocations: Object.fromEntries(Object.entries(drafts.power).map(([key, value]) => [key, Number(value)])),
      });
    });
    const hint = document.createElement("small");
    hint.textContent = "Use the exact total. Safety minimums are distributed across station briefs; surplus changes your final margins.";
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
    direction.value = drafts.navigation.direction;
    direction.disabled = done.has("burn_programmed");
    directionLabel.append(directionTitle, direction);

    const time = numberField("Burn duration", "whole seconds", drafts.navigation.duration);
    time.input.min = "1";
    time.input.max = "180";
    time.input.disabled = done.has("burn_programmed");

    const updateDraft = () => {
      drafts.navigation.direction = direction.value;
      drafts.navigation.duration = time.input.value;
      updateNavigationVisual();
    };
    direction.addEventListener("change", updateDraft);
    time.input.addEventListener("input", updateDraft);

    const button = document.createElement("button");
    button.textContent = done.has("burn_programmed") ? "✓ Burn complete" : "Commit burn";
    button.className = done.has("burn_programmed") ? "action-done" : "primary";
    button.disabled = done.has("burn_programmed");
    button.addEventListener("click", () => {
      audio.click();
      send("action", {
        action: "program_burn",
        direction: direction.value,
        value: Number(time.input.value),
      });
    });

    const hint = document.createElement("small");
    hint.textContent = "Adjust Δv for drift, calculate effective acceleration, then round once at the end. The preview shows your command, not whether it is correct.";
    wrapper.append(directionLabel, time.field, button, hint);
    actions.append(wrapper);
    updateNavigationVisual();
  }

  function renderReentryActions(state, done) {
    const angleWrapper = document.createElement("div");
    angleWrapper.className = "calculation-panel";
    const angle = numberField("Entry angle", "degrees to 0.1°", drafts.reentry.angle);
    angle.input.step = "0.1";
    angle.input.min = "4";
    angle.input.max = "9";
    angle.input.disabled = done.has("entry_angle");
    angle.input.addEventListener("input", () => {
      drafts.reentry.angle = angle.input.value;
      updateReentryVisual(state);
    });
    const angleButton = document.createElement("button");
    angleButton.textContent = done.has("entry_angle") ? "✓ Angle locked" : "Lock entry angle";
    angleButton.className = done.has("entry_angle") ? "action-done" : "primary";
    angleButton.disabled = done.has("entry_angle");
    angleButton.addEventListener("click", () => {
      audio.click();
      send("action", { action: "set_entry_angle", value: Number(angle.input.value) });
    });
    const angleHint = document.createElement("small");
    angleHint.textContent = "Shift the nominal corridor, intersect every limit, and choose the midpoint. Locking the angle starts the live descent clock.";
    angleWrapper.append(angle.field, angleButton, angleHint);
    actions.append(angleWrapper);

    if (done.has("entry_angle")) {
      const chute = document.createElement("div");
      chute.className = "action-group chute-control";
      const button = document.createElement("button");
      button.className = "danger-action";
      button.textContent = done.has("parachutes")
        ? "✓ Parachutes deployed"
        : `Deploy parachutes · T+${String(state.descentSeconds ?? 0).padStart(2, "0")}`;
      button.disabled = done.has("parachutes") || done.has("parachute_attempted");
      button.addEventListener("click", () => {
        audio.warning();
        send("action", { action: "deploy_parachutes" });
      });
      const hint = document.createElement("small");
      hint.textContent = "One attempt. Use the station briefs to find the overlap between the velocity-safe and altitude-safe windows.";
      chute.append(button, hint);
      actions.append(chute);
    }
  }

  function renderActions(state) {
    const key = `${state.phase}|${state.completedActions}|${state.descentSeconds === null ? "pre" : "descent"}`;
    if (key === lastActionRenderKey) return;
    lastActionRenderKey = key;
    actions.replaceChildren();
    const done = completedSet(state);

    if (state.phase === "launch") renderLaunchActions(done);
    else if (state.phase === "power") renderPowerActions(done);
    else if (state.phase === "navigation") renderNavigationActions(done);
    else if (state.phase === "reentry") renderReentryActions(state, done);
    else if (state.phase === "won" || state.phase === "lost") {
      const retry = document.createElement("button");
      retry.textContent = "Generate a new mission";
      retry.className = "primary";
      retry.disabled = state.hostSessionId !== sessionId;
      retry.addEventListener("click", () => send("reset"));
      actions.append(retry);
    }
  }

  function renderCrew(state) {
    crewList.replaceChildren();
    const players = Object.entries(state.players || {});
    crewCount.textContent = `${players.length} / 6`;
    const latest = Array.isArray(state.recentEvents) ? state.recentEvents.at(-1) : null;

    for (const [playerSessionId, player] of players) {
      const member = document.createElement("div");
      member.className = "crew-member";
      if (player.ready) member.classList.add("ready-member");
      if (latest?.actorSessionId === playerSessionId) member.classList.add("active-member");
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

  function renderActivity(state) {
    const events = Array.isArray(state.recentEvents) ? state.recentEvents.slice(-6).reverse() : [];
    activityFeed.replaceChildren();
    if (events.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = state.statusMessage || "Mission activity will appear here.";
      activityFeed.append(empty);
      return;
    }

    for (const event of events) {
      const item = document.createElement("div");
      item.className = `activity-item ${event.severity || "info"}`;
      const dot = document.createElement("i");
      const content = document.createElement("div");
      const by = document.createElement("b");
      by.textContent = event.actor ? `${event.actor}${event.role ? ` · ${event.role}` : ""}` : "MISSION CONTROL";
      const text = document.createElement("span");
      text.textContent = event.text;
      content.append(by, text);
      item.append(dot, content);
      activityFeed.append(item);
    }
  }

  function routeProgress(state) {
    const order = ["launch", "power", "navigation", "reentry"];
    const currentIndex = order.indexOf(state.phase);
    const finished = ["won", "lost"].includes(state.phase);
    const nodes = [...document.querySelectorAll("#phase-route [data-route]")];
    const lines = [...document.querySelectorAll("#phase-route i")];
    nodes.forEach((node, index) => {
      node.classList.toggle("active", index === currentIndex);
      node.classList.toggle("complete", finished || index < currentIndex);
    });
    lines.forEach((line, index) => line.classList.toggle("complete", finished || index < currentIndex));
  }

  function orbitMarkup() {
    return `
      <div class="orbit-view">
        <div class="orbit-stars"></div>
        <div class="orbit-earth"></div><span class="orbit-label earth-label">EARTH</span>
        <div class="orbit-track"></div>
        <div class="orbit-craft">◆</div>
        <div class="orbit-moon"></div><span class="orbit-label moon-label">MOON</span>
      </div>`;
  }

  function launchMarkup() {
    const nodes = [
      ["align_computer", "01", "FLIGHT COMPUTER"],
      ["start_scrubbers", "02", "SCRUBBERS"],
      ["seal_cabin", "03", "CABIN SEAL"],
      ["arm_guidance", "04", "GUIDANCE"],
      ["authorize_launch", "05", "LAUNCH AUTH"],
    ];
    return `<div class="launch-cinematic">
      <div class="launch-horizon"></div>
      <div class="launch-pad"><i></i><i></i><i></i><i></i></div>
      <div class="rocket-stack" aria-hidden="true">
        <div class="rocket-nose"></div><div class="rocket-body"><span>LUNAR<br>MISSION</span></div>
        <div class="rocket-booster left"></div><div class="rocket-booster right"></div>
        <div class="rocket-flame"></div><div class="rocket-smoke"></div>
      </div>
      <div class="launch-countdown"><small>LAUNCH WINDOW</small><strong>T− <span id="launch-visual-countdown">150</span></strong><b>KENNEDY SPACE CENTER · PAD 39</b></div>
      <div class="launch-console">${nodes.map(([action, number, label]) => `
        <div class="launch-node" data-visual-action="${action}"><em>${number}</em><span class="switch"><i></i></span><b>${label}</b><small>STANDBY</small></div>`).join("")}</div>
    </div>`;
  }

  function powerMarkup() {
    return `<div class="power-cinematic">
      <div class="reactor-wall"><span class="warning-stripe"></span><span class="warning-stripe second"></span></div>
      <div class="power-core critical"><div class="core-rings"><i></i><i></i><i></i></div><div><small>BUS B OUTPUT</small><strong id="power-core-total">0</strong><b>UNITS ROUTED</b></div></div>
      <svg class="power-cables" viewBox="0 0 1000 430" preserveAspectRatio="none" aria-hidden="true">
        <path class="cable life" d="M500,205 C420,205 400,80 250,80"/><path class="cable cooling" d="M500,205 C420,205 400,350 250,350"/>
        <path class="cable navigation" d="M500,205 C580,205 600,80 750,80"/><path class="cable science" d="M500,205 C580,205 600,350 750,350"/>
      </svg>
      <div class="power-lanes visual-power-lanes">
        ${["life", "cooling", "navigation", "science"].map((key, index) => `<div class="power-lane ${key}" style="--node-index:${index}"><span>${key === "life" ? "LIFE SUPPORT" : key.toUpperCase()}</span><div class="power-wire"><i id="lane-${key}"></i></div><strong id="lane-${key}-value">0</strong><small>POWER UNITS</small></div>`).join("")}
      </div>
      <div class="power-alert"><span>⚠</span><div><b>THERMAL RUNAWAY</b><small>Route the exact available load before the bus trips.</small></div></div>
    </div>`;
  }

  function navigationMarkup() {
    return `<div class="navigation-cinematic">
      <div class="nav-map"><div class="orbit-stars"></div><div class="orbit-earth detailed"></div><div class="orbit-moon detailed"></div>
        <div class="nav-safe-corridor"></div><div class="nav-path current"></div><div class="nav-path preview"></div><div class="nav-target"><i></i></div>
        <div class="nav-ship"><span>◆</span><i></i></div><span class="map-label earth">EARTH</span><span class="map-label moon">MOON</span>
      </div>
      <div class="nav-readout cinematic-readout">
        <div><span>BURN VECTOR</span><strong id="nav-direction">UNSET</strong></div>
        <div><span>ENGINE TIME</span><strong id="nav-duration">—</strong></div>
        <div><span>PROJECTED RETURN</span><strong id="nav-confidence">AWAITING DATA</strong></div>
      </div>
      <div class="trajectory-legend"><span class="red">CURRENT PATH</span><span class="cyan">COMMAND PREVIEW</span><span class="green">SAFE CORRIDOR</span></div>
    </div>`;
  }

  function reentryMarkup() {
    return `<div class="reentry-cinematic">
      <div class="reentry-sky"><div class="earth-curve"></div><div class="plasma-trail one"></div><div class="plasma-trail two"></div><div class="plasma-trail three"></div><div class="plasma-band"></div><div class="reentry-capsule"><span></span><i></i></div></div>
      <div class="entry-corridor"><span>−9°</span><i class="corridor-safe"></i><b class="entry-marker"></b><span>−4°</span></div>
      <div class="reentry-readout cinematic-readout">
        <div><span>ENTRY COMMAND</span><strong id="entry-command">UNLOCKED</strong></div>
        <div><span>VELOCITY</span><strong id="reentry-speed">—</strong></div>
        <div><span>ALTITUDE</span><strong id="reentry-altitude">—</strong></div>
        <div class="hot"><span>HEAT SHIELD</span><strong id="reentry-heat">—</strong></div>
      </div>
    </div>`;
  }

  function endMarkup(success) {
    return `<div class="end-visual ${success ? "success" : "fail"}"><div><div class="end-orbit"><div class="orbit-earth"></div><div class="end-ring"></div><div class="end-capsule">⬟</div></div><h4>${success ? "SPLASHDOWN CONFIRMED" : "MISSION LOST"}</h4><p>${success ? "Recovery beacon acquired. Review your margins." : "Debrief the failed assumption and try a new scenario."}</p></div></div>`;
  }

  function buildPhaseVisual(state) {
    visualPhase = state.phase;
    if (state.phase === "lobby") phaseVisual.innerHTML = orbitMarkup();
    else if (state.phase === "launch") phaseVisual.innerHTML = launchMarkup();
    else if (state.phase === "power") phaseVisual.innerHTML = powerMarkup();
    else if (state.phase === "navigation") phaseVisual.innerHTML = navigationMarkup();
    else if (state.phase === "reentry") phaseVisual.innerHTML = reentryMarkup();
    else phaseVisual.innerHTML = endMarkup(state.phase === "won");
  }

  function updatePowerVisual() {
    if (visualPhase !== "power") return;
    const values = Object.fromEntries(Object.entries(drafts.power).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    const core = document.querySelector("#power-core-total");
    if (core) core.textContent = total;
    for (const [key, value] of Object.entries(values)) {
      const lane = document.querySelector(`#lane-${key}`);
      const readout = document.querySelector(`#lane-${key}-value`);
      if (lane) lane.style.setProperty("--lane", `${Math.min(100, value)}%`);
      if (readout) readout.textContent = value;
    }
  }

  function updateNavigationVisual() {
    if (visualPhase !== "navigation") return;
    const direction = drafts.navigation.direction;
    const duration = Number(drafts.navigation.duration) || 0;
    const directionNode = document.querySelector("#nav-direction");
    const durationNode = document.querySelector("#nav-duration");
    const confidenceNode = document.querySelector("#nav-confidence");
    const path = document.querySelector(".nav-path");
    const ship = document.querySelector(".nav-ship");
    if (directionNode) directionNode.textContent = direction ? direction.toUpperCase() : "UNSET";
    if (durationNode) durationNode.textContent = duration ? `${duration}s` : "—";
    if (confidenceNode) confidenceNode.textContent = direction && duration ? "COMMAND PREVIEW" : "AWAITING DATA";
    const sign = direction === "retrograde" ? -1 : 1;
    if (path) path.style.setProperty("--path-angle", `${-4 + sign * Math.min(16, duration / 10)}deg`);
    if (ship) ship.style.setProperty("--ship-rotation", `${direction === "retrograde" ? 200 : 18}deg`);
  }

  function updateReentryVisual(state) {
    if (visualPhase !== "reentry") return;
    const telemetry = state.telemetry || {};
    const descent = state.descentSeconds;
    const capsule = document.querySelector(".reentry-capsule");
    const plasma = document.querySelector(".plasma-band");
    const entryCommand = document.querySelector("#entry-command");
    const speed = document.querySelector("#reentry-speed");
    const altitude = document.querySelector("#reentry-altitude");
    const heat = document.querySelector("#reentry-heat");
    const done = completedSet(state);

    if (entryCommand) entryCommand.textContent = done.has("entry_angle") ? "LOCKED" : (drafts.reentry.angle ? `${drafts.reentry.angle}° PREVIEW` : "UNLOCKED");
    if (speed) speed.textContent = Number.isFinite(telemetry.speed) ? `${Math.round(telemetry.speed)} m/s` : "—";
    if (altitude) altitude.textContent = Number.isFinite(telemetry.altitude) ? `${telemetry.altitude.toFixed(1)} km` : "—";
    if (heat) heat.textContent = `${Math.round(state.heat)}%`;
    if (capsule) {
      const progress = descent === null ? 8 : Math.min(88, 15 + descent * 2.25);
      capsule.style.setProperty("--capsule-y", `${progress}%`);
      capsule.classList.toggle("chutes", done.has("parachutes"));
    }
    if (plasma) plasma.style.setProperty("--plasma-y", `${Math.min(70, 32 + (state.heat || 0) * 0.28)}%`);
  }

  function updatePhaseVisual(state) {
    if (visualPhase !== state.phase) buildPhaseVisual(state);
    const done = completedSet(state);

    if (state.phase === "lobby") {
      visualTitle.textContent = "Earth departure corridor";
      visualTelemetry.textContent = `${Object.keys(state.players || {}).length} CREW CONNECTED\nMISSION STANDBY`;
      const craft = document.querySelector(".orbit-craft");
      if (craft) {
        craft.style.setProperty("--craft-x", `${34 + Object.keys(state.players || {}).length * 3}%`);
        craft.style.setProperty("--craft-y", "47%");
      }
    } else if (state.phase === "launch") {
      visualTitle.textContent = "Launch interlock sequence";
      visualTelemetry.textContent = `${done.size} / 5 SYSTEMS CONFIRMED\nT-${Math.max(0, state.phaseDeadline - state.phaseSeconds)}s`;
      const launchCountdown = document.querySelector("#launch-visual-countdown");
      if (launchCountdown) launchCountdown.textContent = String(Math.max(0, state.phaseDeadline - state.phaseSeconds)).padStart(3, "0");
      for (const node of document.querySelectorAll("[data-visual-action]")) {
        const action = node.dataset.visualAction;
        const completed = done.has(action);
        node.classList.toggle("done", completed);
        const small = node.querySelector("small");
        if (small) small.textContent = completed ? "CONFIRMED" : "STANDBY";
      }
      document.querySelector(".rocket-stack")?.classList.toggle("armed", done.has("authorize_launch"));
    } else if (state.phase === "power") {
      visualTitle.textContent = "Emergency bus routing";
      visualTelemetry.textContent = `BUS B THERMAL RUNAWAY\nHEAT ${Math.round(state.heat)}%`;
      updatePowerVisual();
    } else if (state.phase === "navigation") {
      visualTitle.textContent = "Free-return trajectory correction";
      visualTelemetry.textContent = `CORRIDOR ${Math.round(state.trajectory)}%\nONE BURN AVAILABLE`;
      updateNavigationVisual();
      document.querySelector(".orbit-craft")?.classList.toggle("burn", done.has("burn_programmed"));
    } else if (state.phase === "reentry") {
      visualTitle.textContent = "Atmospheric entry corridor";
      visualTelemetry.textContent = state.descentSeconds === null
        ? `ENTRY INTERFACE APPROACHING\nANGLE NOT LOCKED`
        : `DESCENT T+${String(state.descentSeconds).padStart(2, "0")}\nHEAT ${Math.round(state.heat)}%`;
      updateReentryVisual(state);
    } else {
      visualTitle.textContent = state.phase === "won" ? "Recovery corridor" : "Mission debrief";
      visualTelemetry.textContent = state.statusMessage;
    }
  }

  function updateTelemetry(state) {
    const telemetry = state.telemetry || {};
    const active = state.phase === "reentry" && state.descentSeconds !== null;
    telemetryCard.classList.toggle("inactive", !active);
    speedValue.textContent = Number.isFinite(telemetry.speed) ? `${Math.round(telemetry.speed)} m/s` : "—";
    altitudeValue.textContent = Number.isFinite(telemetry.altitude) ? `${telemetry.altitude.toFixed(1)} km` : "—";
    descentValue.textContent = active ? `T+${String(state.descentSeconds).padStart(2, "0")}` : "—";
  }

  function reactToEvents(state) {
    const events = Array.isArray(state.recentEvents) ? state.recentEvents : [];
    const latest = events.at(-1);
    if (latest && latest.id > lastEventId) {
      lastEventId = latest.id;
      sceneController.pulse(latest.severity === "critical" ? "danger" : "normal");
      if (latest.severity === "critical") {
        audio.danger();
        shake();
        flash("danger");
      } else if (latest.severity === "warning") {
        audio.warning();
        shake();
      } else if (latest.severity === "success") {
        audio.success();
        flash();
      } else {
        audio.click();
      }
    }

    if (state.phase === "lobby" && ["won", "lost"].includes(lastPhase)) {
      resetDrafts();
    }

    if (lastPhase && lastPhase !== state.phase) {
      audio.phase();
      flash(state.phase === "lost" ? "danger" : "normal");
      if (["launch", "reentry", "lost"].includes(state.phase)) shake();
      lastActionRenderKey = "";
    }
    lastPhase = state.phase;
  }

  function resetDrafts() {
    drafts.power = { life: "", cooling: "", navigation: "", science: "" };
    drafts.navigation = { direction: "", duration: "" };
    drafts.reentry = { angle: "" };
  }

  function updateLiveActionLabels(state) {
    if (state.phase !== "reentry") return;
    const button = document.querySelector(".chute-control button");
    const done = completedSet(state);
    if (button && !done.has("parachutes")) {
      button.textContent = `Deploy parachutes · T+${String(state.descentSeconds ?? 0).padStart(2, "0")}`;
    }
  }

  function render(state) {
    reactToEvents(state);
    sceneController.setState(state);
    phaseTitle.textContent = phaseLabel(state.phase);
    missionTime.textContent = formatTime(state.missionSeconds);
    statusMessage.textContent = state.statusMessage;
    objectiveTitle.textContent = state.objective;
    objectiveCopy.textContent = state.objectiveDetail || "";
    alertDot.className = `alert-dot ${state.alertLevel === "normal" ? "" : state.alertLevel}`;

    const me = state.players?.[sessionId];
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
    setGauge("heat", state.heat, true);
    setGauge("trajectory", state.trajectory);
    element("#data-value").textContent = `${Math.round(state.missionData)}%`;
    element("#data-bar").style.width = `${clamp(state.missionData)}%`;

    const weakest = Math.min(state.oxygen, state.power, state.trajectory, 100 - state.heat);
    systemsStatus.textContent = weakest < 25 ? "CRITICAL" : weakest < 50 ? "CAUTION" : "NOMINAL";
    systemsStatus.style.color = weakest < 25 ? "var(--red)" : weakest < 50 ? "var(--amber)" : "var(--green)";

    if (state.phaseDeadline > 0 && !["won", "lost"].includes(state.phase)) {
      const remaining = Math.max(0, state.phaseDeadline - state.phaseSeconds);
      phaseTimer.textContent = state.phase === "reentry" && state.descentSeconds !== null
        ? `DESCENT T+${String(state.descentSeconds).padStart(2, "0")} · DEADLINE ${remaining}s`
        : `PHASE DEADLINE ${remaining}s`;
      phaseTimer.style.color = remaining <= 25 ? "var(--red)" : "var(--amber)";
    } else {
      phaseTimer.textContent = state.phase === "lobby" ? "MISSION STANDBY" : "NO ACTIVE DEADLINE";
      phaseTimer.style.color = "var(--muted)";
    }

    routeProgress(state);
    renderCrew(state);
    renderActivity(state);
    updatePhaseVisual(state);
    updateTelemetry(state);
    renderActions(state);
    updateLiveActionLabels(state);
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
