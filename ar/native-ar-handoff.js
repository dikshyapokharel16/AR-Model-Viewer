// Reuses the exact native AR mechanism already proven in the Agentic Square
// project: a <model-viewer ar ar-modes="webxr scene-viewer quick-look">
// element handles ARKit Quick Look (iOS, via ios-src usdz) / Scene Viewer /
// WebXR (Android) placement, with true real-world scale and drag/walk-around
// — none of that is something MindAR's image tracking can do on its own.
//
// The element is kept in the DOM (not display:none) at all times — model-viewer
// needs to actually be laid out to activate AR reliably in Safari.

const viewerEl = document.getElementById("native-ar-viewer");

export function placeInSpace(modelConfig) {
  return new Promise((resolve) => {
    viewerEl.setAttribute("alt", `${modelConfig.name} — place in your space`);
    viewerEl.setAttribute("src", modelConfig.glb);
    if (modelConfig.usdz) viewerEl.setAttribute("ios-src", modelConfig.usdz);
    else viewerEl.removeAttribute("ios-src");

    let settled = false;
    const evaluate = () => {
      if (settled) return;
      settled = true;
      if (viewerEl.canActivateAR) {
        viewerEl.activateAR();
        resolve({ launched: true });
      } else {
        resolve({ launched: false });
      }
    };

    viewerEl.addEventListener("load", evaluate, { once: true });
    // canActivateAR isn't always accurate the instant `load` fires — same
    // fallback timing used in Agentic Square's watchArAvailability().
    setTimeout(evaluate, 600);
  });
}
