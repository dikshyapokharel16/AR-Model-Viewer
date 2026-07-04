"""Headless glTF(.glb) -> USD(.usdz) conversion, run via Blender's --background mode.

Usage:
  blender --background --python blender_glb_to_usdz.py -- <input.glb> <output.usdz>

This is a raw format conversion only (no scale/texture correction) — feed the
result through fix-usdz-scale.py and dedupe-usdz-mesh.py afterward, same as any
other raw .usdz export in this pipeline.
"""
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
in_glb, out_usdz = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=in_glb)

bpy.ops.wm.usd_export(
    filepath=out_usdz,
    export_materials=True,
    export_textures_mode="NEW",
    export_normals=True,
    export_uvmaps=True,
)

print(f"Converted {in_glb} -> {out_usdz}")
