(() => {
  "use strict";

  function makeMaterial(scene, name, diffuse, emissive) {
    const material = new BABYLON.StandardMaterial(name, scene);
    material.diffuseColor = diffuse;
    material.specularColor = new BABYLON.Color3(0.15, 0.18, 0.22);
    if (emissive) material.emissiveColor = emissive;
    return material;
  }

  window.createPeriluneScene = function createPeriluneScene(canvas) {
    if (!window.BABYLON) {
      return { setAlert() {}, setPhase() {} };
    }

    try {
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.005, 0.009, 0.02, 1);

    const camera = new BABYLON.UniversalCamera("crew-camera", new BABYLON.Vector3(0, 1.5, -2.4), scene);
    camera.setTarget(new BABYLON.Vector3(0, 1.25, 4));
    camera.fov = 0.95;
    camera.minZ = 0.05;
    camera.speed = 0;
    camera.angularSensibility = 2800;
    camera.attachControl(canvas, true);
    camera.inputs.removeByType("FreeCameraKeyboardMoveInput");

    const ambient = new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0, 1, 0), scene);
    ambient.intensity = 0.45;
    const cabinLight = new BABYLON.PointLight("cabin-light", new BABYLON.Vector3(0, 2.4, -0.5), scene);
    cabinLight.intensity = 18;
    cabinLight.diffuse = new BABYLON.Color3(0.3, 0.55, 0.8);

    const shellMat = makeMaterial(scene, "shell", new BABYLON.Color3(0.045, 0.065, 0.085));
    const trimMat = makeMaterial(scene, "trim", new BABYLON.Color3(0.12, 0.15, 0.18));
    const screenMat = makeMaterial(
      scene,
      "screens",
      new BABYLON.Color3(0.01, 0.06, 0.07),
      new BABYLON.Color3(0.02, 0.38, 0.42),
    );

    const floor = BABYLON.MeshBuilder.CreateBox("floor", { width: 5.4, height: 0.15, depth: 8 }, scene);
    floor.position = new BABYLON.Vector3(0, 0, 1.6);
    floor.material = shellMat;

    const ceiling = BABYLON.MeshBuilder.CreateBox("ceiling", { width: 5.4, height: 0.15, depth: 8 }, scene);
    ceiling.position = new BABYLON.Vector3(0, 3.15, 1.6);
    ceiling.material = shellMat;

    for (const side of [-1, 1]) {
      const wall = BABYLON.MeshBuilder.CreateBox(`wall-${side}`, { width: 0.18, height: 3.2, depth: 8 }, scene);
      wall.position = new BABYLON.Vector3(side * 2.65, 1.55, 1.6);
      wall.rotation.z = side * -0.09;
      wall.material = shellMat;

      for (let index = 0; index < 4; index += 1) {
        const panel = BABYLON.MeshBuilder.CreateBox(
          `side-screen-${side}-${index}`,
          { width: 0.06, height: 0.58, depth: 1.1 },
          scene,
        );
        panel.position = new BABYLON.Vector3(
          side * 2.48,
          1.35 + (index % 2) * 0.78,
          -0.4 + Math.floor(index / 2) * 1.4,
        );
        panel.rotation.y = side * Math.PI * 0.5;
        panel.material = screenMat;
      }
    }

    const consoleBase = BABYLON.MeshBuilder.CreateBox(
      "console",
      { width: 4.7, height: 0.75, depth: 1.25 },
      scene,
    );
    consoleBase.position = new BABYLON.Vector3(0, 0.65, 2.3);
    consoleBase.rotation.x = -0.18;
    consoleBase.material = trimMat;

    for (let index = 0; index < 4; index += 1) {
      const screen = BABYLON.MeshBuilder.CreateBox(
        `front-screen-${index}`,
        { width: 0.88, height: 0.5, depth: 0.04 },
        scene,
      );
      screen.position = new BABYLON.Vector3(-1.5 + index, 1.03, 1.73);
      screen.rotation.x = -0.18;
      screen.material = screenMat;
    }

    const windowFrameTop = BABYLON.MeshBuilder.CreateBox(
      "window-top",
      { width: 4.7, height: 0.2, depth: 0.22 },
      scene,
    );
    windowFrameTop.position = new BABYLON.Vector3(0, 2.85, 3.25);
    windowFrameTop.material = trimMat;
    const windowFrameBottom = windowFrameTop.clone("window-bottom");
    windowFrameBottom.position.y = 1.5;

    for (const side of [-1, 1]) {
      const frame = BABYLON.MeshBuilder.CreateBox(
        `window-side-${side}`,
        { width: 0.2, height: 1.55, depth: 0.22 },
        scene,
      );
      frame.position = new BABYLON.Vector3(side * 2.3, 2.18, 3.25);
      frame.material = trimMat;
    }

    const starMat = makeMaterial(
      scene,
      "stars",
      new BABYLON.Color3(0.9, 0.95, 1),
      new BABYLON.Color3(0.75, 0.85, 1),
    );
    const starPrototype = BABYLON.MeshBuilder.CreateSphere(
      "star-prototype",
      { diameter: 0.025, segments: 3 },
      scene,
    );
    starPrototype.material = starMat;
    starPrototype.isVisible = false;

    let seed = 187;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (let index = 0; index < 240; index += 1) {
      const star = starPrototype.createInstance(`star-${index}`);
      star.position = new BABYLON.Vector3((random() - 0.5) * 30, (random() - 0.5) * 18, 7 + random() * 22);
      const scale = 0.5 + random() * 1.8;
      star.scaling = new BABYLON.Vector3(scale, scale, scale);
    }

    const moon = BABYLON.MeshBuilder.CreateSphere("moon", { diameter: 2.8, segments: 24 }, scene);
    moon.position = new BABYLON.Vector3(3.4, 1.8, 18);
    const moonMat = makeMaterial(scene, "moon-material", new BABYLON.Color3(0.48, 0.49, 0.5));
    moonMat.emissiveColor = new BABYLON.Color3(0.045, 0.045, 0.05);
    moon.material = moonMat;

    const earth = BABYLON.MeshBuilder.CreateSphere("earth", { diameter: 1.25, segments: 20 }, scene);
    earth.position = new BABYLON.Vector3(-5.5, 3.6, 22);
    earth.material = makeMaterial(
      scene,
      "earth-material",
      new BABYLON.Color3(0.02, 0.18, 0.35),
      new BABYLON.Color3(0.01, 0.06, 0.14),
    );

    const alertMat = makeMaterial(
      scene,
      "alert-material",
      new BABYLON.Color3(0.12, 0.2, 0.18),
      new BABYLON.Color3(0.04, 0.4, 0.25),
    );
    const alertLamp = BABYLON.MeshBuilder.CreateSphere("alert-lamp", { diameter: 0.14, segments: 8 }, scene);
    alertLamp.position = new BABYLON.Vector3(0, 2.9, 1.4);
    alertLamp.material = alertMat;

    let alertLevel = "normal";
    let phase = "lobby";

    scene.registerBeforeRender(() => {
      const time = performance.now() / 1000;
      moon.rotation.y += 0.00025;
      earth.rotation.y += 0.0005;
      camera.rotation.z = Math.sin(time * 0.35) * 0.002;

      const pulse = 0.55 + Math.sin(time * (alertLevel === "critical" ? 8 : 3)) * 0.25;
      if (alertLevel === "critical") {
        alertMat.emissiveColor = new BABYLON.Color3(0.8 * pulse, 0.02, 0.02);
      } else if (alertLevel === "warning") {
        alertMat.emissiveColor = new BABYLON.Color3(0.75 * pulse, 0.24 * pulse, 0.015);
      } else {
        alertMat.emissiveColor = new BABYLON.Color3(0.02, 0.35 * pulse, 0.2 * pulse);
      }

      const travel = phase === "navigation" ? time * 0.025 : time * 0.006;
      moon.position.x = 3.4 - (travel % 2.8);
    });

    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());

    return {
      setAlert(level) {
        alertLevel = level;
      },
      setPhase(nextPhase) {
        phase = nextPhase;
      },
    };
    } catch (error) {
      console.warn("3D scene unavailable; continuing with the mission interface.", error);
      canvas.style.background = "radial-gradient(circle at 65% 25%, #173044, #050912 55%)";
      return { setAlert() {}, setPhase() {} };
    }
  };
})();
