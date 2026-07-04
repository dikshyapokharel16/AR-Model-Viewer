import * as THREE from "three";

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

function loadTexture(path) {
  if (!textureCache.has(path)) {
    textureCache.set(path, new Promise((resolve, reject) => textureLoader.load(path, resolve, undefined, reject)));
  }
  return textureCache.get(path);
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);

// Slower, deliberately-paced choreography (seconds) — fast enough to not
// drag, slow enough that each stage actually reads as its own motion.
const POPUP_DURATION = 1.0;
const POPUP_START_DELAY = 0.15;
const COLUMN_UNFOLD_STEP = 0.5; // stagger between each column hinge starting
const COLUMN_UNFOLD_DURATION = 0.9;
const ROW_UNFOLD_DELAY = 0.4; // gap after the last column settles, before the row unfolds
const ROW_UNFOLD_DURATION = 1.0;

// Z-separation between stacked/folded panels. Generous on purpose — this is
// what stops the flat, near-coincident folded panels from z-fighting
// (flickering) against each other and against the pop-up hinge's own panel,
// and it's small enough to be invisible once everything is unfolded flat.
const Z_STEP = 0.004;

/**
 * Plays the "manual pops up and unfolds" reveal:
 *  1. The whole folded sheet pops up from lying flat on the marker to
 *     standing vertical, hinged along its bottom edge — like a pop-up book
 *     page opening.
 *  2. Once standing, the column strip fans open in a true alternating
 *     zigzag (mountain/valley, matching a real accordion-folded sheet) out
 *     from the cover.
 *  3. The second row book-folds open below the now-open top row.
 *
 * The cover cell itself is never rendered — the real printed page is
 * already visible through the camera at that position, so only the *other*
 * 7 pages (genuinely new content) get virtual panels.
 *
 * Assumes a 2-row grid with the cover in row 0 or row 1 — matches the one
 * real manual this was built against; a 3+ row sheet isn't handled here.
 *
 * Returns a controller with .update(dt) — call every frame until it reports
 * done, then it's safe to stop calling.
 */
export async function playManualUnfold({ anchorGroup, modelConfig }) {
  const { manualDir, manualGrid, coverGridPosition } = modelConfig;
  const cols = manualGrid[0].length;
  const { row: coverRow, col: coverCol } = coverGridPosition;
  const otherRow = coverRow === 0 ? 1 : 0;

  const textures = await Promise.all(
    manualGrid.map((rowFiles) => Promise.all(rowFiles.map((f) => loadTexture(`${manualDir}/${f}`))))
  );

  // All cells share the cover's aspect ratio (they were cropped from one
  // consistent grid), and the cover is sized to match the marker (1 unit
  // wide, in MindAR's anchor space) so the virtual sheet lines up with the
  // real printed page underneath it.
  const coverTex = textures[coverRow][coverCol];
  const cellW = 1;
  const cellH = coverTex.image.height / coverTex.image.width;

  function makePanel(texture, zOffset, pivotAtTop) {
    const geom = new THREE.PlaneGeometry(cellW, cellH);
    // pivotAtTop: shift geometry so its top edge is the local origin (for
    // panels that hang from a hinge above them); otherwise centered.
    if (pivotAtTop) geom.translate(0, -cellH / 2, 0);
    geom.translate(0, 0, zOffset);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: zOffset * 1000,
      polygonOffsetUnits: 1,
    });
    return new THREE.Mesh(geom, mat);
  }

  const rowHinges = []; // every column's book-fold hinge, animated together in phase 3
  const colHinges = []; // each column's accordion hinge, animated in a cascading zigzag in phase 2

  function buildColumnUnit(col, zOffset, includeTopPanel) {
    const group = new THREE.Group();

    if (includeTopPanel) {
      group.add(makePanel(textures[coverRow][col], zOffset, false));
    }

    const bottomHinge = new THREE.Group();
    bottomHinge.position.set(0, -cellH / 2, 0);
    bottomHinge.rotation.x = Math.PI; // starts folded up behind the top panel, hidden
    group.add(bottomHinge);
    bottomHinge.add(makePanel(textures[otherRow][col], zOffset, true));

    rowHinges.push(bottomHinge);
    return group;
  }

  // Cover column: fixed reference for the whole assembly, no accordion hinge
  // of its own, and no visible panel at the cover cell (the real printed
  // page already shows it) — only its hidden second-row page renders.
  const coverUnit = buildColumnUnit(coverCol, 0, false);

  // The whole sheet pops up hinged along the cover's bottom edge. Rotation 0
  // here is flat, exactly matching the marker's plane (verified: hinge.position
  // + Rx(0)*contentOffset = (0,0,0), i.e. coincides with the anchor origin).
  const popupHinge = new THREE.Group();
  popupHinge.position.set(0, -cellH / 2, 0);
  const popupContent = new THREE.Group();
  popupContent.position.set(0, cellH / 2, 0);
  popupHinge.add(popupContent);
  popupContent.add(coverUnit);
  anchorGroup.add(popupHinge);

  // Remaining columns, chained outward from the cover in a single direction
  // (matches this sheet's real fold: cover at one end of the row), each
  // hinge alternating fold direction for a true zigzag/fan cross-section.
  const direction = coverCol === cols - 1 ? -1 : 1;
  let parentUnit = coverUnit;
  const order = [];
  for (let step = 1; step < cols; step++) {
    const col = coverCol + step * direction;
    if (col < 0 || col >= cols) break;
    order.push(col);
  }

  order.forEach((col, i) => {
    const hinge = new THREE.Group();
    hinge.position.set((cellW / 2) * direction, 0, 0);
    // Alternate the fold's sign each panel for a real zigzag/fan (mountain,
    // valley, mountain, ...) instead of rolling every panel the same way.
    const sign = i % 2 === 0 ? 1 : -1;
    hinge.rotation.y = Math.PI * sign;
    parentUnit.add(hinge);

    const unit = buildColumnUnit(col, Z_STEP * (i + 1), true);
    unit.position.set((cellW / 2) * direction, 0, 0);
    hinge.add(unit);

    colHinges.push({ hinge, sign });
    parentUnit = unit;
  });

  const columnsEnd = POPUP_START_DELAY + POPUP_DURATION + (colHinges.length - 1) * COLUMN_UNFOLD_STEP + COLUMN_UNFOLD_DURATION;
  const rowStartTime = columnsEnd + ROW_UNFOLD_DELAY;
  const totalDuration = rowStartTime + ROW_UNFOLD_DURATION;

  let elapsed = 0;
  let done = false;

  function update(dt) {
    if (done) return true;
    elapsed += dt;

    const popupT = clamp01((elapsed - POPUP_START_DELAY) / POPUP_DURATION);
    popupHinge.rotation.x = (Math.PI / 2) * easeInOutCubic(popupT);

    const columnsStart = POPUP_START_DELAY + POPUP_DURATION;
    colHinges.forEach(({ hinge, sign }, i) => {
      const t = clamp01((elapsed - columnsStart - i * COLUMN_UNFOLD_STEP) / COLUMN_UNFOLD_DURATION);
      hinge.rotation.y = Math.PI * sign * (1 - easeInOutCubic(t));
    });

    const rowT = clamp01((elapsed - rowStartTime) / ROW_UNFOLD_DURATION);
    const rowAngle = Math.PI * (1 - easeInOutCubic(rowT));
    for (const bottomHinge of rowHinges) bottomHinge.rotation.x = rowAngle;

    if (elapsed >= totalDuration) {
      done = true;
      return true;
    }
    return false;
  }

  function dispose() {
    anchorGroup.remove(popupHinge);
    popupHinge.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
  }

  return { update, dispose };
}
