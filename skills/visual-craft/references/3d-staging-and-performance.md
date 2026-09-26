# 3D staging, materials, and constrained-hardware performance

Read before placing or moving objects in a 3D scene (especially under a fixed camera), setting up materials, or doing a performance pass on a scene meant for mobile or low-end hardware.

## Placement under a fixed camera

- **Screen-relative language needs a measured mapping.** "Move it to the top-left" or "make it bottom-right" does not translate to world coordinates by intuition under a fixed, non-orthogonal camera. Sample the engine's own world-to-viewport projection at a few known landmark coordinates, and trust that mapping over intuition every time.
- **Work out what the camera actually reveals first** - what is closest, largest, most contrasted from that angle - and design around it, not around an idealized top-down plan.
- **Clearance, not just non-overlap.** Check real clearance against each neighbor's actual footprint.
- **Screen extremes are not always simultaneously reachable.** Say so explicitly rather than forcing a worse compromise between two named directions.
- **Block out first.** A genuinely new layout gets placeholder shapes before final geometry; building full detail on an unconfirmed position is the expensive way to find out it's wrong.
- **Adapt before authoring.** An existing, already-verified shape or asset adapted is cheaper and more consistent than new geometry from scratch.
- **Lighting is its own pass**, separate from materials. Under a fixed camera this is an advantage: a rim light placed for that exact angle stays correct.

## Materials

- **Let the engine's lighting do its physical job; put the style elsewhere** - in narrowed value ranges, palette restraint, simplified geometry and exaggerated proportions. Fighting the shading model is what makes disparate assets stop reading as one product.
- **PBR base color for non-metals stays in a physically plausible mid-range**, away from near-black and near-white. Values at the extremes break the lighting response and are a common, easy-to-miss reason a scene looks subtly "off." A common practitioner rule of thumb is roughly 50-240 in 8-bit sRGB (about 30 as a tolerant floor for very dark materials such as charcoal); your engine's or material tool's own guidance wins where it differs.
- **Material agreement is checked across neighbors**, not per object: copy-pasting one element's setup is how a lone glossy object ends up in a matte room.

## Performance on constrained hardware (scene-authoring side)

- **LOD ladders earn their cost only when viewing distance varies.** A fixed camera never changes viewing distance, so don't import that checklist item reflexively.
- **Overdraw is the usual mobile-GPU killer.** Multiple overlapping semi-transparent layers - a casual second glow or overlay "for richness" - is a rejection on constrained hardware, not a preference call.
- **Don't split a shared material or texture atlas without a reason.** A second atlas is a real draw-call cost with no visual gain.
- **Profile on the weakest target device**, not the development machine.
