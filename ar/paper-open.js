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
const START_DELAY = 0.15; // brief pause after recognition before anything moves
const COLUMN_UNFOLD_STEP = 0.5; // stagger between each column hinge starting
const COLUMN_UNFOLD_DURATION = 0.9;
const ROW_UNFOLD_DELAY = 0.4; // gap after the last column settles, before the row unfolds
const ROW_UNFOLD_DURATION = 1.0;

// Z-separation between stacked/folded panels. Generous on purpose — this is
// what stops the flat, near-coincident folded panels from z-fighting
// (flickering) against each other while folded, and it's small enough to be
// invisible once everything is unfolded flat.
const Z_STEP = 0.004;

/**
 * Plays the "manual unfolds" reveal, entirely flat in the marker's own
 * plane — the cover never leaves the position the camera found it at:
 *  1. The column strip fans open in a true alternating zigzag
 *     (mountain/valley, matching a real accordion-folded sheet) out from
 *     the cover, lying flat the whole time.
 *  2. The second row book-folds open below the now-open top row, also flat.
 *
 * Deliberately has no "pop up to standing" stage: an earlier version hinged
 * the whole assembly upright before unfolding, which (a) dragged the still
 * folded-away pages through view early since their hidden rotations
 * compounded with the parent's, and (b) separated the unfolding pages from
 * the real printed cover, pushing the cover out of frame. Real paper
 * unfolds flat from a stack — it doesn't need to stand up first.
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

    // Separate front/back materials (rather than one DoubleSide material)
    // so a page mid-fold shows a blank paper back instead of a mirrored,
    // backwards-reading copy of the front artwork.
    const polygonOffsetFactor = zOffset * 1000;
    const frontMat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor,
      polygonOffsetUnits: 1,
    });
    const backMat = new THREE.MeshBasicMaterial({
      color: 0xf2ede2,
      side: THREE.BackSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor,
      polygonOffsetUnits: 1,
    });

    const group = new THREE.Group();
    group.add(new THREE.Mesh(geom, frontMat));
    group.add(new THREE.Mesh(geom, backMat));
    return group;
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
    // Not just folded but undrawn: at the cover column there's no virtual top
    // panel to hide behind (that cell is real camera passthrough), so this
    // would otherwise sit as a solid blank plane directly over the real
    // printed page. At the other columns it would instead z-fight against
    // their top panel, which sits at the same depth. Either way, staying
    // fully undrawn until its own reveal begins (in update()) is correct.
    bottomHinge.visible = false;
    group.add(bottomHinge);
    bottomHinge.add(makePanel(textures[otherRow][col], zOffset, true));

    rowHinges.push(bottomHinge);
    return group;
  }

  // Cover column: fixed reference for the whole assembly, no accordion hinge
  // of its own, and no visible panel at the cover cell (the real printed
  // page already shows it) — only its hidden second-row page renders.
  const coverUnit = buildColumnUnit(coverCol, 0, false);

  // Attaches directly at the anchor origin — the cover cell already
  // coincides with the marker's plane, so no offset is needed to line it up.
  anchorGroup.add(coverUnit);

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
    hinge.visible = false; // same reasoning as bottomHinge.visible above
    parentUnit.add(hinge);

    const unit = buildColumnUnit(col, Z_STEP * (i + 1), true);
    unit.position.set((cellW / 2) * direction, 0, 0);
    hinge.add(unit);

    colHinges.push({ hinge, sign });
    parentUnit = unit;
  });

  const columnsStart = START_DELAY;
  const columnsEnd = columnsStart + (colHinges.length - 1) * COLUMN_UNFOLD_STEP + COLUMN_UNFOLD_DURATION;
  const rowStartTime = columnsEnd + ROW_UNFOLD_DELAY;
  const totalDuration = rowStartTime + ROW_UNFOLD_DURATION;

  let elapsed = 0;
  let done = false;

  function update(dt) {
    if (done) return true;
    elapsed += dt;

    colHinges.forEach(({ hinge, sign }, i) => {
      const startTime = columnsStart + i * COLUMN_UNFOLD_STEP;
      hinge.visible = elapsed >= startTime; // undrawn until the instant its own reveal begins
      const t = clamp01((elapsed - startTime) / COLUMN_UNFOLD_DURATION);
      hinge.rotation.y = Math.PI * sign * (1 - easeInOutCubic(t));
    });

    const rowVisible = elapsed >= rowStartTime;
    const rowT = clamp01((elapsed - rowStartTime) / ROW_UNFOLD_DURATION);
    const rowAngle = Math.PI * (1 - easeInOutCubic(rowT));
    for (const bottomHinge of rowHinges) {
      bottomHinge.visible = rowVisible;
      bottomHinge.rotation.x = rowAngle;
    }

    if (elapsed >= totalDuration) {
      done = true;
      return true;
    }
    return false;
  }

  function dispose() {
    anchorGroup.remove(coverUnit);
    coverUnit.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
  }

  return { update, dispose };
}
