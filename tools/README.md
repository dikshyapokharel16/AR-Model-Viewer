# Model scale-correction & compression tools

Adapted from the `Agentic Square/tools/` pipeline for this project's 4 raw SketchUp
exports (Pallet Planters, Pallet Seatings, Bench, Stepped brick seating). Run each raw
export through the matching script before dropping it into `../assets/models/<id>/`.

Models are sized to their **true real-world dimensions** (not a stylized room-scale
fit) — this project's native AR handoff (Quick Look / Scene Viewer) places them at
literal 1:1 scale, so getting the factor right matters more here than in a kiosk-scale
project. Always confirm with the inspect scripts below rather than assuming a factor.

**`.glb` and `.usdz` need different factor values** — they're independent exports, so
the same raw model can need a different absolute factor per format. Verify actual
resulting size with the inspect scripts rather than assuming a factor carries over
between formats.

## `.glb` (Android — Scene Viewer / WebXR, and the in-page MindAR reveal)

One-time setup: `npm install` in this folder.

```
node fix-glb-scale.mjs "../source-assets/01 Pallet Planters/01 model.glb" ../assets/models/01-pallet-planters/model.glb <factor>
```

No default factor is known yet for these 4 files (different SketchUp export origin
than the Agentic Square models) — start with the script's default (`0.05`), check
actual size with `node inspect-glb.mjs ../assets/models/<id>/model.glb`, and adjust
until the model's real-world size (measure against the actual physical
planter/bench/seating, if available, or its design dimensions) is correct.

This script also **dedupes** repeated geometry (pallets/bricks baked as independent
copies), resizes/re-encodes textures (2048x2048 max, WebP), **simplifies** geometry
(meshoptimizer, ratio 0.5), then Draco-compresses. Target ≤2-3MB per model — unlike
`<model-viewer>`, MindAR/three.js has no progressive/poster loading, so the app lazy
loads each model only once its marker is first detected; keep them small so that first
load is fast.

## `.usdz` (iOS Quick Look)

Requires Python with `usd-core` and `Pillow`: `pip install usd-core Pillow`.

```
python fix-usdz-scale.py "../source-assets/01 Pallet Planters/01 model.glb" ../assets/models/01-pallet-planters/model.usdz --factor <factor>
```

`--factor` is an **absolute** scale on the raw export (not a multiplier on the current
file, unlike the `.glb` script). Confirm with:

```
python inspect-usdz.py ../assets/models/<id>/model.usdz
```

which prints both the baked-in scale op and the actual world-space size in meters —
this must match the real physical object's size, since Quick Look places it at exactly
this scale with no further adjustment available to the visitor.

This script also resizes/re-encodes textures the same way the `.glb` script does, and
converts opaque PNGs to JPEG (USDZ/RealityKit doesn't support WebP).

**Known limitation: geometry is not compressed or simplified for `.usdz`** — file size
scales directly with polygon count. If a model needs to be smaller after
`dedupe-usdz-mesh.py` below, decimate it in Blender before exporting to `.usdz`.

## `.usdz` mesh deduplication (repeated objects)

These SketchUp exports don't preserve component/instance reuse — every pallet, brick,
or plank is exported as its own fully-baked, independent copy of the geometry. This is
very likely to matter for all 4 of these models given their repetitive
pallet/brick/plank construction:

```
python dedupe-usdz-mesh.py ../assets/models/<id>/model.usdz ../assets/models/<id>/model.usdz
```

Verify with `inspect-usdz.py` afterwards (scale/size should be unchanged).

## Previewing on a phone/tablet

Camera access (both for MindAR's marker scanning and for native AR) requires HTTPS (or
`localhost`) — a plain `http://<lan-ip>` origin will not work on a phone, even on the
same Wi-Fi.

- **Fast iteration loop:** serve the folder locally and tunnel it over HTTPS:
  ```
  npx serve ..                                    # from this tools/ folder, serves the app root
  cloudflared tunnel --url http://localhost:3000   # no account needed
  ```
  Open the printed `https://*.trycloudflare.com` URL on the device.
- **Confirm on the real pipeline:** push to the linked Vercel project for a normal
  HTTPS preview deployment URL.
