# Selected mining props

Author: loafbrr_1, **Mine Object collection**, 2022-04-05.
Source: https://opengameart.org/content/mine-object-collection
Original download: https://opengameart.org/sites/default/files/mines_asset_fbx_gltf_blend.zip
License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
Downloaded 2026-11-07. Original author README is retained alongside these assets.
Archive SHA256: 460bf6e666186b3244bf6e915c4e60cc89a920517bd19793ff451b79aedbabfb

Only selected original glTF meshes were converted to OBJ, retaining vertex positions, normals and triangle indices. UV V was converted from glTF image coordinates to OBJ, and node translation was baked. The shoring beam and brace were shortened in depth to fit this site's footprint.

- OreCart.obj: CartFrame, lower Cart_2 tub and the two wheel assemblies; 798 vertices / 564 triangles. Wheel radii were enlarged 1.65x and the body/axles raised 0.053 source units together, preserving ground contact.
- QuarryRail.obj: one straight Rail; 288 vertices / 152 triangles.
- PitShoring.obj: WoodPost, its two PostBase metal shoes, one shortened beam and one shortened brace; 108 vertices / 54 triangles.
- Cart* and Rails* PNG: author's 1K albedo, OpenGL normal, metallic and roughness maps.

Selected mesh/maps total: approximately 1.63 MB before Unity import. Full archive, unused objects, explosives, collection scenes and Blender/Godot files are not shipped. Runtime materials use the project shader and original authored UVs/maps. No animations or package dependencies were added.
