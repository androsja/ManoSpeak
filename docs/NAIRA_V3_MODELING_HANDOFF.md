# Naira v3 Static Modeling Handoff

## Decision

The Naira v2 procedural output failed human visual review on 2026-11-04. It is a
technical rig/export prototype only. The current primitive assembly approach must not
be iterated into a production character: its topology cannot express the approved
concept's connected shoulder girdle, facial planes, palms, tapered fingers or layered
crest without effectively becoming a manual modeling project.

Naira v3 must therefore start as an authored Blender model. Rigging, animation, runtime
integration and size optimization remain paused until the static model passes the gate
in this document.

The approved concept remains visual reference only:

- Path: `tmp/avatar-candidates/naira-v2-concept/naira-stylized-concept-v1.png`
- SHA-256: `d1b8a0f71751ab9b96ca8c150c0789b66712e14b624efcbe6babd5a42d64f456`
- It may be displayed beside the viewport, but must not be imported as geometry,
  projected as a texture, photogrammetrically reconstructed or traced vertex by vertex.

## Why the current prototype fails

The objective side-by-side evidence is
`tmp/avatar-candidates/naira-v2/naira-v2-failed-side-by-side.png`.

| Area | Approved shape language | Rejected prototype |
| --- | --- | --- |
| Character read | Friendly, elegant, stylized non-human adult | Generic assembled mannequin |
| Head | Tapered jaw, cheek planes, integrated muzzle and eye sockets | Uniform oval mask |
| Eyes | Large hazel eyes seated inside lids and sockets | Layered discs attached to the face |
| Hair/crest | Swept, overlapping locks with a directional silhouette | Detached rounded spikes |
| Torso | Continuous neck, clavicle, shoulder and waist transitions | Flat extruded shirt prism |
| Arms | Organic shoulder-to-elbow-to-wrist taper | Constant-radius tubes |
| Hands | Broad palms and five shaped, separated, tapered fingers | Small palm pieces and stick fingers |
| Surface | Intentional primary, secondary and tertiary forms | Visible primitive construction |

## Required Blender workflow

### 1. Proportion blockout

Create a new Blender 5.2.x source file. Block the upper body with a connected base mesh
or voxel-remeshed sculpt, not a collection of renderable primitives. Match the concept's
head-to-shoulder ratio, long neck, narrow waist, broad signing envelope and oversized
hands. Work in a neutral open-hand A-pose with palms visible.

Deliver frontal and three-quarter clay renders before adding facial detail. The product
owner must recognize the same character at first glance. Failure here returns to the
blockout; it must not proceed to topology or rigging.

### 2. Sculpted primary and secondary forms

Use Multiresolution or a duplicated high-resolution sculpt to author:

- a tapered cranium, jaw, chin, cheek planes and muzzle volume;
- recessed eye sockets with upper and lower eyelid volume around spherical eyeballs;
- an integrated nose bridge, nostril indication and smiling mouth volume;
- clavicles, deltoids, armpits, elbows and wrist transitions;
- palms with thenar/hypothenar masses and five individually tapered digits;
- layered crest locks with overlapping roots and pointed swept tips.

The result must not expose spheres, capsules, cylinders, cones or planar cards as the
final surface. Skin, shirt and crest may remain separate logical meshes, but each mesh
must read as a designed continuous surface.

### 3. Retopology

Build an all-quad deformation mesh around the approved sculpt. Required deformation
loops are:

- concentric mouth loops continuing into nasolabial and cheek flow;
- eyelid loops that close over the eyeball without scaling it;
- brow and forehead loops independent of the eyelids;
- jaw-to-neck loops with room for head rotation;
- clavicle, deltoid and armpit loops supporting arm elevation;
- elbow and wrist support loops;
- palm webbing and three articulating segments for every finger and thumb.

Use mirror symmetry for the base, then add subtle facial/crest asymmetry only after the
neutral topology passes. Preserve separate eyeballs and teeth/mouth cavity if used.

Suggested budgets are 45,000–80,000 quads for the authored subdivision cage and
25,000–45,000 triangles for the first review GLB. These are review targets, not hard
acceptance limits; fidelity takes priority over the former 666 KiB prototype target.

### 4. Static materials and presentation

Use procedural/base-color materials only for the first gate: warm rose skin, teal shirt,
indigo hair and coral accents. Hazel irises must always sit inside clearly visible white
sclera. Avoid black or empty eyes. Use a neutral charcoal background and soft three-point
lighting equivalent across all review renders.

The mobile model is upper-body only. Finish the torso with a natural closed waist crop;
do not model visible legs, feet or shoes. Keep both complete hands inside every review
frame.

## Static review deliverables

Place candidate outputs under `tmp/avatar-candidates/naira-v3-static/`:

1. `naira-v3-source.blend`, with unapplied subdivision available for inspection.
2. `naira-v3-front.png`, 1280x1280 or larger.
3. `naira-v3-three-quarter.png`, same camera height, lens and lighting.
4. `naira-v3-mobile-front.png`, exactly 360x640 with both hands visible.
5. `naira-v3-wireframe-front.png` and `naira-v3-wireframe-hands.png`.
6. `naira-v3-concept-comparison.png`, concept and both candidate views at equal visual
   scale, without perspective or crop tricks.
7. `naira-v3-static-review.json`, recording concept checksum, Blender version, source
   checksum, render checksums and every decision below as `pending`, `pass` or `fail`.

Do not generate a production GLB, rig, motion preview or mobile asset before this review
passes. A temporary unrigged GLB may be exported only for topology inspection and must be
clearly named `inspection-only`.

## Human visual acceptance gate

All rows require an explicit human `pass`; automated checks cannot substitute for them.

| Criterion | Pass condition |
| --- | --- |
| Character identity | Recognizable as the same character as the concept at first glance in both views |
| Silhouette | Swept crest, tapered head/neck, elegant torso and readable hands match the concept's shape language |
| Face | Integrated sockets, lids, brows, nose, lips, cheeks and jaw; no oval mask or stuck-on discs |
| Hair/crest | Layered directional locks; no detached ellipsoid spikes |
| Torso/shoulders | Coherent neck-clavicle-deltoid-armpit flow; no flat shirt cone or prism |
| Arms | Anatomical taper and landmarks; no tubes or capsule seams |
| Hands | Five well-shaped, separated, tapered fingers per hand with readable webbing and palms |
| Mobile read | Face, wrists, palms and all fingertips remain clear at 360x640 |
| Palette | Teal/indigo/coral harmony and warm skin read consistently without washed-out eyes |
| Originality | New authored topology; concept used only as visual reference |

Any failed row keeps Task 2 open and returns the asset to static modeling. Only after all
rows pass may the team proceed in order to retopology cleanup, facial shape keys, Rigify
binding, deformation tests, GLB optimization, animation evidence and mobile integration.

## Exact current blocker

No authored sculpt/topology conforming to this specification exists in the repository.
Headless scripting can validate, render and export such a source, but it cannot make the
subjective sculpting decisions needed to reproduce this character's appeal and coherent
anatomy. Continuing to add scripted primitives would repeat the rejected approach.

The concrete unblock is a Blender character artist (or an interactive Blender sculpting
session directed by the product owner) completing stages 1–3 and delivering the static
files above. A character artist should budget approximately two to four focused working
days for blockout, feedback, sculpt, retopology and static presentation, before rigging.
