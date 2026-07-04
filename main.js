import { createArScene } from "./ar/mindar-scene.js";
import { placeInSpace } from "./ar/native-ar-handoff.js";

const landingEl = document.getElementById("landing");
const arViewEl = document.getElementById("ar-view");
const arContainerEl = document.getElementById("ar-container");
const arHintEl = document.getElementById("ar-hint");
const arButtonsEl = document.getElementById("ar-buttons");
const viewInArBtn = document.getElementById("view-in-ar-btn");
const startScanningBtn = document.getElementById("start-scanning-btn");

let currentModel = null;

async function main() {
  const models = await fetch("models.json").then((r) => r.json());

  startScanningBtn.addEventListener(
    "click",
    async () => {
      // Camera access on iOS Safari must start from a user gesture — this
      // click is that gesture, so the whole AR scene is created here rather
      // than eagerly on page load.
      landingEl.classList.add("hidden");
      arViewEl.classList.remove("hidden");

      const arScene = await createArScene({
        container: arContainerEl,
        models,
        onActiveModelChange: (modelConfig) => {
          currentModel = modelConfig;
          arHintEl.classList.add("hidden");
          arButtonsEl.classList.remove("hidden");
        },
      });
      await arScene.start();
    },
    { once: true }
  );

  viewInArBtn.addEventListener("click", async () => {
    if (!currentModel) return;
    const result = await placeInSpace(currentModel);
    if (!result.launched) showQrFallback();
  });

  document.getElementById("qr-close-btn").addEventListener("click", hideQrFallback);
}

function showQrFallback() {
  const panel = document.getElementById("qr-fallback");
  panel.classList.remove("hidden");
  const container = document.getElementById("qr-canvas-container");
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  if (window.QRCode) {
    window.QRCode.toCanvas(canvas, window.location.href, { width: 200 }, (error) => {
      if (error) console.error("QR code generation failed:", error);
    });
  }
}

function hideQrFallback() {
  document.getElementById("qr-fallback").classList.add("hidden");
}

main();
