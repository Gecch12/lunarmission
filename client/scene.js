(() => {
  "use strict";

  function material(scene, name, diffuse, emissive = null, alpha = 1) {
    const mat = new BABYLON.StandardMaterial(name, scene);
    mat.diffuseColor = diffuse;
    mat.specularColor = new BABYLON.Color3(0.08, 0.11, 0.14);
    mat.alpha = alpha;
    if (emissive) mat.emissiveColor = emissive;
    return mat;
  }

  function fallback(canvas) {
    canvas.style.background = "radial-gradient(circle at 72% 28%, #24445f 0, #07111d 30%, #02060c 70%)";
    return { setState() {}, pulse() {} };
  }

  window.createLunarMissionScene = function createLunarMissionScene(canvas) {
    if (!window.BABYLON) return fallback(canvas);

    try {
      const engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        antialias: true,
      });
      engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio > 1.5 ? 1.35 : 1));

      const scene = new BABYLON.Scene(engine);
      scene.clearColor = new BABYLON.Color4(0.002, 0.006, 0.012, 1);
      scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
      scene.fogDensity = 0.007;
      scene.fogColor = new BABYLON.Color3(0.003, 0.008, 0.015);

      const camera = new BABYLON.UniversalCamera("crew-camera", new BABYLON.Vector3(0, 1.55, -2.7), scene);
      camera.setTarget(new BABYLON.Vector3(0, 1.55, 7));
      camera.fov = 0.88;
      camera.minZ = 0.05;
      camera.speed = 0;
      camera.angularSensibility = 4500;
      camera.attachControl(canvas, true);
      camera.inputs.removeByType("FreeCameraKeyboardMoveInput");

      const ambient = new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0, 1, -0.4), scene);
      ambient.intensity = 0.22;
      ambient.diffuse = new BABYLON.Color3(0.35, 0.5, 0.62);
      ambient.groundColor = new BABYLON.Color3(0.02, 0.03, 0.045);

      const cabinLight = new BABYLON.PointLight("cabin-light", new BABYLON.Vector3(0, 2.65, -0.4), scene);
      cabinLight.intensity = 3.8;
      cabinLight.diffuse = new BABYLON.Color3(0.2, 0.55, 0.68);
      cabinLight.range = 8;

      const rimLight = new BABYLON.DirectionalLight("rim", new BABYLON.Vector3(-0.35, -0.2, -1), scene);
      rimLight.intensity = 0.7;
      rimLight.diffuse = new BABYLON.Color3(0.55, 0.68, 0.78);

      const shell = material(scene, "shell", new BABYLON.Color3(0.018, 0.03, 0.045));
      const trim = material(scene, "trim", new BABYLON.Color3(0.055, 0.075, 0.09));
      const screen = material(
        scene,
        "screen",
        new BABYLON.Color3(0.004, 0.025, 0.035),
        new BABYLON.Color3(0.01, 0.2, 0.24),
      );
      const warningScreen = material(
        scene,
        "warning-screen",
        new BABYLON.Color3(0.04, 0.012, 0.008),
        new BABYLON.Color3(0.35, 0.045, 0.015),
      );

      // Dark cockpit silhouette. The UI carries the detail; this creates atmosphere and depth.
      const floor = BABYLON.MeshBuilder.CreateBox("floor", { width: 6.2, height: 0.12, depth: 9 }, scene);
      floor.position.set(0, -0.05, 2.1);
      floor.material = shell;

      const ceiling = BABYLON.MeshBuilder.CreateBox("ceiling", { width: 6.2, height: 0.12, depth: 9 }, scene);
      ceiling.position.set(0, 3.45, 2.1);
      ceiling.material = shell;

      for (const side of [-1, 1]) {
        const wall = BABYLON.MeshBuilder.CreateBox(`wall-${side}`, { width: 0.24, height: 3.5, depth: 9 }, scene);
        wall.position.set(side * 3.02, 1.65, 2.1);
        wall.rotation.z = side * -0.075;
        wall.material = shell;

        for (let index = 0; index < 3; index += 1) {
          const panel = BABYLON.MeshBuilder.CreateBox(
            `side-display-${side}-${index}`,
            { width: 0.055, height: 0.56, depth: 1.05 },
            scene,
          );
          panel.position.set(side * 2.82, 1.25 + (index % 2) * 0.8, 0.3 + Math.floor(index / 2) * 1.45);
          panel.rotation.y = side * Math.PI * 0.5;
          panel.material = index === 2 ? warningScreen : screen;
        }
      }

      const consoleBase = BABYLON.MeshBuilder.CreateBox("console-base", { width: 5.3, height: 0.68, depth: 1.4 }, scene);
      consoleBase.position.set(0, 0.55, 2.45);
      consoleBase.rotation.x = -0.14;
      consoleBase.material = trim;

      const consoleGlow = [];
      for (let index = 0; index < 5; index += 1) {
        const display = BABYLON.MeshBuilder.CreateBox(
          `front-display-${index}`,
          { width: 0.82, height: 0.45, depth: 0.035 },
          scene,
        );
        display.position.set(-1.72 + index * 0.86, 0.94, 1.79);
        display.rotation.x = -0.14;
        display.material = screen;
        consoleGlow.push(display);
      }

      // Window framing.
      const windowTop = BABYLON.MeshBuilder.CreateBox("window-top", { width: 5.35, height: 0.18, depth: 0.22 }, scene);
      windowTop.position.set(0, 3.06, 3.35);
      windowTop.material = trim;
      const windowBottom = windowTop.clone("window-bottom");
      windowBottom.position.y = 1.45;
      for (const side of [-1, 1]) {
        const frame = BABYLON.MeshBuilder.CreateBox(`window-side-${side}`, { width: 0.18, height: 1.72, depth: 0.22 }, scene);
        frame.position.set(side * 2.6, 2.25, 3.35);
        frame.material = trim;
      }

      // Star field.
      const starMaterial = material(
        scene,
        "star-material",
        new BABYLON.Color3(0.75, 0.86, 0.95),
        new BABYLON.Color3(0.55, 0.72, 0.9),
      );
      const starPrototype = BABYLON.MeshBuilder.CreateSphere("star-prototype", { diameter: 0.025, segments: 3 }, scene);
      starPrototype.material = starMaterial;
      starPrototype.isVisible = false;
      const stars = [];
      let seed = 429;
      const random = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let index = 0; index < 300; index += 1) {
        const star = starPrototype.createInstance(`star-${index}`);
        star.position.set((random() - 0.5) * 34, (random() - 0.5) * 20, 8 + random() * 28);
        const scale = 0.4 + random() * 1.8;
        star.scaling.set(scale, scale, scale);
        stars.push(star);
      }

      const moon = BABYLON.MeshBuilder.CreateSphere("moon", { diameter: 3.5, segments: 32 }, scene);
      moon.position.set(3.8, 2.2, 19);
      const moonMaterial = material(scene, "moon-material", new BABYLON.Color3(0.38, 0.4, 0.42));
      moonMaterial.emissiveColor = new BABYLON.Color3(0.025, 0.027, 0.03);
      moon.material = moonMaterial;

      const earth = BABYLON.MeshBuilder.CreateSphere("earth", { diameter: 1.35, segments: 28 }, scene);
      earth.position.set(-5.5, 3.7, 23);
      const earthMaterial = material(
        scene,
        "earth-material",
        new BABYLON.Color3(0.025, 0.18, 0.36),
        new BABYLON.Color3(0.006, 0.035, 0.09),
      );
      earth.material = earthMaterial;

      const alertMaterial = material(
        scene,
        "alert-material",
        new BABYLON.Color3(0.01, 0.1, 0.06),
        new BABYLON.Color3(0.01, 0.35, 0.18),
      );
      const alertLamp = BABYLON.MeshBuilder.CreateSphere("alert-lamp", { diameter: 0.13, segments: 10 }, scene);
      alertLamp.position.set(0, 3.12, 1.35);
      alertLamp.material = alertMaterial;

      // Plasma ribbons outside the window, only visible during re-entry.
      const plasmaMaterial = material(
        scene,
        "plasma-material",
        new BABYLON.Color3(0.95, 0.16, 0.025),
        new BABYLON.Color3(1, 0.18, 0.02),
        0.45,
      );
      plasmaMaterial.disableLighting = true;
      const plasma = [];
      for (let index = 0; index < 18; index += 1) {
        const ribbon = BABYLON.MeshBuilder.CreatePlane(`plasma-${index}`, { width: 0.04 + random() * 0.08, height: 1.5 + random() * 2.4 }, scene);
        ribbon.position.set((random() - 0.5) * 8, (random() - 0.5) * 5 + 2, 6 + random() * 8);
        ribbon.rotation.z = -0.75 + random() * 0.2;
        ribbon.material = plasmaMaterial;
        ribbon.isVisible = false;
        plasma.push(ribbon);
      }

      let state = { phase: "lobby", alertLevel: "normal", heat: 12, trajectory: 82 };
      let pulseStrength = 0;
      let pulseType = "normal";
      let previousTime = performance.now();

      scene.registerBeforeRender(() => {
        const now = performance.now();
        const delta = Math.min(0.05, (now - previousTime) / 1000);
        previousTime = now;
        const time = now / 1000;

        moon.rotation.y += delta * 0.015;
        earth.rotation.y += delta * 0.025;

        const critical = state.alertLevel === "critical";
        const warning = state.alertLevel === "warning";
        const pulse = 0.58 + Math.sin(time * (critical ? 9 : warning ? 4.5 : 2.2)) * 0.28;
        if (critical) alertMaterial.emissiveColor.set(0.95 * pulse, 0.015, 0.01);
        else if (warning) alertMaterial.emissiveColor.set(0.8 * pulse, 0.22 * pulse, 0.01);
        else alertMaterial.emissiveColor.set(0.01, 0.36 * pulse, 0.18 * pulse);

        let shake = 0.0015;
        let starSpeed = 0.005;
        let lightTarget = 3.8;

        if (state.phase === "launch") {
          shake = 0.006 + Math.sin(time * 17) * 0.003;
          starSpeed = 0.18;
          lightTarget = 5.2;
        } else if (state.phase === "power") {
          shake = 0.0025;
          lightTarget = critical && Math.sin(time * 15) > 0.45 ? 0.55 : 2.3;
        } else if (state.phase === "navigation") {
          shake = 0.001;
          starSpeed = 0.02;
          moon.position.x += (-0.6 - moon.position.x) * delta * 0.08;
          moon.position.z += (15.5 - moon.position.z) * delta * 0.08;
        } else if (state.phase === "reentry") {
          shake = 0.008 + Math.max(0, (state.heat || 0) - 45) / 12000;
          lightTarget = 2.3;
          plasmaMaterial.emissiveColor.set(1, 0.09 + Math.sin(time * 16) * 0.04, 0.005);
          for (const ribbon of plasma) {
            ribbon.isVisible = true;
            ribbon.position.y -= delta * (2.5 + Math.abs(ribbon.position.x) * 0.15);
            ribbon.position.x += delta * 0.8;
            if (ribbon.position.y < -1.5) {
              ribbon.position.y = 5.5;
              ribbon.position.x = (random() - 0.5) * 8;
            }
          }
        } else {
          for (const ribbon of plasma) ribbon.isVisible = false;
        }

        if (state.phase === "won") {
          lightTarget = 4.8;
          earth.position.x += (-0.4 - earth.position.x) * delta * 0.09;
          earth.position.z += (17 - earth.position.z) * delta * 0.09;
        } else if (state.phase === "lost") {
          lightTarget = 1.3;
          shake = 0.012;
        }

        if (pulseStrength > 0.001) {
          shake += pulseStrength * 0.012;
          pulseStrength *= 0.91;
          cabinLight.diffuse = pulseType === "danger"
            ? new BABYLON.Color3(0.8, 0.04, 0.03)
            : new BABYLON.Color3(0.2, 0.75, 0.78);
        } else {
          cabinLight.diffuse = state.phase === "reentry"
            ? new BABYLON.Color3(0.85, 0.12, 0.035)
            : new BABYLON.Color3(0.2, 0.55, 0.68);
        }
        cabinLight.intensity += (lightTarget - cabinLight.intensity) * Math.min(1, delta * 8);

        camera.rotation.z = Math.sin(time * 15.7) * shake;
        camera.position.x = Math.sin(time * 18.3) * shake * 1.9;
        camera.position.y = 1.55 + Math.sin(time * 16.8) * shake * 1.4;

        for (const star of stars) {
          star.position.z -= delta * starSpeed;
          if (star.position.z < 7) star.position.z = 34;
        }

        const screenPulse = 0.8 + Math.sin(time * 2.4) * 0.15;
        screen.emissiveColor.set(0.008, 0.18 * screenPulse, 0.23 * screenPulse);
        warningScreen.emissiveColor.set(0.3 * (critical ? pulse : 0.35), 0.035, 0.008);
      });

      engine.runRenderLoop(() => scene.render());
      window.addEventListener("resize", () => engine.resize());

      return {
        setState(nextState) {
          state = { ...state, ...nextState };
        },
        pulse(type = "normal") {
          pulseType = type;
          pulseStrength = 1;
        },
      };
    } catch (error) {
      console.warn("3D scene unavailable; continuing with the mission interface.", error);
      return fallback(canvas);
    }
  };
})();
