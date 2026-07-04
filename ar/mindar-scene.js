import * as THREE from "three";
import { MindARThree } from "../vendor/mind-ar/mindar-image-three.prod.js";
import { playManualUnfold } from "./paper-open.js";

/**
 * Wires up MindAR image tracking for every model that has a real targetIndex
 * (models still waiting on marker art have targetIndex: null and are simply
 * skipped — no anchor is created for them yet).
 *
 * onActiveModelChange(modelConfig) fires whenever "the model the app should
 * currently offer View in AR for" changes. That binding persists after the
 * marker leaves frame (it only changes when a *different* target is found),
 * so it's driven by last-found, not by anchor.group.visible.
 *
 * The 3D model itself is never shown in this live camera view — scanning
 * only reveals the manual's own pages (see ar/paper-open.js). Seeing the
 * actual 3D model is a separate native AR handoff from the "View in AR"
 * button (ar/native-ar-handoff.js).
 */
export async function createArScene({ container, models, onActiveModelChange }) {
  const trackedModels = models.filter((m) => m.targetIndex !== null && m.targetIndex !== undefined);

  const mindarThree = new MindARThree({
    container,
    imageTargetSrc: "assets/targets/targets.mind",
    maxTrack: trackedModels.length,
    uiScanning: "no",
    uiLoading: "no",
    uiError: "no",
  });

  const { renderer, scene, camera } = mindarThree;

  const activeAnimations = new Set();
  const revealedOnce = new Set(); // model ids that have already played their manual unfold

  const anchors = trackedModels.map((modelConfig) => {
    const anchor = mindarThree.addAnchor(modelConfig.targetIndex);

    anchor.onTargetFound = async () => {
      // Defensive guard: only one model visible at a time, even if multiple
      // printed covers are framed together — MindAR tracks each target's
      // visibility independently, so this overrides that when needed.
      for (const other of anchors) {
        if (other && other.anchor !== anchor) other.anchor.group.visible = false;
      }

      onActiveModelChange(modelConfig);

      if (!revealedOnce.has(modelConfig.id) && modelConfig.manualGrid) {
        revealedOnce.add(modelConfig.id);
        const controller = await playManualUnfold({ anchorGroup: anchor.group, modelConfig });
        activeAnimations.add(controller);
      }
    };

    anchor.onTargetLost = () => {
      // lastTargetIndex (and therefore the "View in AR" binding) intentionally
      // persists here — a visitor naturally looks away from the page to tap it.
    };

    return { anchor, modelConfig };
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    for (const controller of activeAnimations) {
      if (controller.update(dt)) activeAnimations.delete(controller);
    }
    renderer.render(scene, camera);
  });

  return {
    async start() {
      await mindarThree.start();
    },
    stop() {
      mindarThree.stop();
      renderer.setAnimationLoop(null);
    },
  };
}
