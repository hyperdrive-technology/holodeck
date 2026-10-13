# Three.js notes for Holodeck

Lessons pulled from [Braffolk/fable5-world-demo](https://github.com/Braffolk/fable5-world-demo) (LAAS, June 2026) and checked against this repo. Source of the raw API log: [`docs/THREE-NOTES.md`](https://github.com/Braffolk/fable5-world-demo/blob/main/docs/THREE-NOTES.md). Diagnosis history: [`STATUS.md`](https://github.com/Braffolk/fable5-world-demo/blob/main/STATUS.md).

These are working notes for agents, not a renderer port. Do not copy LAAS source. Their stack and ours are different.

## Where we are

| | Holodeck / Hyperdrive UI | LAAS |
|---|---|---|
| three | `0.186.1` in `editor-2.5d-react` and `viewer-3d-react` | `0.184.0`, pinned |
| Types | `@types/three@0.186.0` | `@types/three@0.184.1` |
| Renderer | R3F `9.8.1` `Canvas` → `WebGPURenderer` (`three/webgpu`). No WebGL fallback | `WebGPURenderer` + TSL + raw WGSL. No WebGL fallback |
| React | `19.2.5` (fiber 9 peers are `>=19 <19.4`; drei `10.7.9`) | not React |
| Scene | Orthographic process plant (`editor-2.5d-react`) and a `SceneFile` viewer (`viewer-3d-react`). `hyperdrive-ui` factory-3d mounts R3F intrinsics inside that Canvas and does not depend on `three` itself | 4 km procedural world |

Both canvases call `WebGPURenderer.init()` from an async `gl` factory and bail out when `navigator.gpu` is missing. `dpr={[1, 2]}`. The 3D viewer sets `shadows`, but no mesh sets `castShadow` / `receiveShadow`.

Two Chrome 140 shims live in `createWebGPURenderer` (Playwright 1.59's Chromium; found by the scene snapshot throwing, not by reading the spec):

- three r186 sets `GPUTextureViewDescriptor.swizzle = 'rgba'`. Chrome 140 rejects that string (`GPUTextureComponentSwizzle`). The shim deletes `swizzle` only after the browser throws once.
- `InstancedBufferGeometry.instanceCount` still defaults to `Infinity` (WebGL means "all"). `drawIndexed` throws, and that exception aborts the R3F frame, so the canvas stays white. Non-finite counts are skipped. Fat edges also start at `instanceCount = 0` until `setPositions`.

Iso fill shading is a TSL `colorNode` on `MeshBasicNodeMaterial` (`assets/process/Shell.tsx`). `onBeforeCompile` does not run on this renderer. Fat edges are `Line2NodeMaterial` (`assets/process/Edges.tsx`), not drei's WebGL `Line2`. The floor grid is TSL (`src/iso/FloorGrid.tsx`), not drei's GLSL `Grid`. Fittings that repeat use drei `Instances` with `INSTANCE_LIMIT = 1024`. Troika text (drei `Text`) still draws on this renderer.

Verify unfamiliar TSL against `node_modules/three` before using it. The r184 gotchas below still apply on r186 unless a line says otherwise.

## Still true on our r186 WebGPU canvases

### Instancing

- CPU vertex colours on a shared geometry break instancing. R3F caches geometries. We already moved the iso gradient into the vertex shader for this reason (`Shell.tsx`).
- `USE_INSTANCING` is defined only when the material is on an `InstancedMesh`. Shader chunks that assume a single mesh will be wrong on the pools.
- A custom vertex displacement must also feed the shadow pass. On WebGL that is `customDepthMaterial` (and `castShadow`). On TSL it is `castShadowPositionNode`. Missing it looks like "this mesh does not cast."
- Custom instancing must rotate normals with the instance (`normalLocal` in their TSL; the normal matrix / `instanceMatrix` on WebGL). Unrotated normals flip lighting per fragment. Their "quasi-radial normals don't need rotation" guess was wrong.
- Shadow alpha is `color.a` times the alpha-test copy. A `vec3` colour node discards every caster fragment. Alpha-tested cutouts need an explicit shadow mask. Our pipes are opaque, so this bites foliage cards and any future cutout, not the current plant meshes.
- Screen-space dither on shadow casters flickers, because cascade (or shadow-camera) boxes move every frame. Anchor dither in world space, or don't dither the shadow pass.
- A hard cutoff by camera distance draws a circle of missing shadows on the ground. Fade casters out.
- `matrixAutoUpdate = false` on static pools. Their profiler showed ~0.67 ms/frame recomposing matrices for objects that never move (veg pools, terrain tiles, depth-prepass twins).

### Shadows and lighting

- Judge whether a shadow exists only when it falls toward the camera. Shadows behind the caster read as "does not cast."
- `CSMShadowNode` clones `light.shadow`. Defaults (`near` 0.5, `far` 500) can be smaller than the light margin and produce empty maps with no error. If we add cascades, set near/far explicitly and call `updateFrustums()` after the camera settles. First-frame jitter can cache NaN extents forever.
- In a TSL shadow pass, `cameraPosition` is the cascade camera, not the view camera. Any distance fade that uses it deletes casters from every cascade while the main view stays correct. Pass an explicit view-camera uniform. The WebGL equivalent is `shadowMap` shader chunks seeing the shadow camera.
- `maskNode` discards in the main pass. The shadow pass uses `maskShadowNode ?? maskNode`. If both LOD rings dither the shadow pass with the same screen pattern, the shadow thins exactly on the crossfade band.
- Specular F0 on `MeshStandardNodeMaterial` is hardcoded. Glancing sun turned flat card normals into a silver sheet. The fix was `MeshPhysicalNodeMaterial` plus a low `specularIntensity` (cards ~0.18, terrain ~0.35). Same lighting model. Our iso shader is unlit on purpose; this matters the day the 3D viewer uses standard/physical materials on large flat surfaces.
- An "identical" frame after a lighting change often means auto-exposure renormalised it. Judge by an A/B diff or an ambient-only debug view, not by absolute brightness. We do not have auto-exposure yet. Don't add it without a lock for snapshot tests.

### Materials and geometry

- `DoubleSide` hides reversed winding. Their bark tubes were inside-out for two phases because DoubleSide was "insurance." `FrontSide` on closed meshes exposes it. A debug that paints front green / back red is cheaper than reading screenshots.
- `frontFacing` on double-sided cards is ambiguous (both sides show). Check winding on tubes or single-sided geometry.
- Ortho captures of leaf cards need `DoubleSide`, or back faces cull and the atlas is empty.
- Sub-pixel real geometry (needles, thin edges) disappears under TAA at review distance. Cluster cards read as lush; real meshes belong in the near ring only. Not our plant style, but the same trap if we billboard far fittings.
- 8-bit textures of dark albedo band. Sqrt-encode on write, square on sample.
- Auto-exposure crushes emissive debug overlays. Keep debug emissive dim, or disable tone mapping while probing.

### Camera

- Mutating a camera outside the renderer's `updateMatrixWorld` leaves `matrixWorld` / `matrixWorldInverse` one frame stale. Copies made in update callbacks must call `camera.updateMatrixWorld()` first.
- Update order: whoever moves the camera registers first; whoever copies camera uniforms registers after, or copies at render time. Their cloud-lag bug was three stacked causes, and one of them was the fly camera registered last, so every post uniform saw the previous pose. Headless `setPose` between frames cannot reproduce this. It only shows up while the camera moves inside the frame.
- R3F `OrbitControls` owns the camera after mount. A scene that also calls `lookAt` will fight it. Programmatic poses need one owner.
- Their pointer-lock cooldown (Chrome refuses `requestPointerLock` for ~1.25 s after exit) is irrelevant until we capture the pointer. If we do: defer the retry, and don't test it in headless Playwright (WrongDocumentError).

### Measuring

- `dpr` up to 2 on a retina laptop is a different scene from a 1080p headless shot. Their interactive session was 10–15 fps while headless 1080p reported 33–45. Reproduce the real viewport before ranking costs. Both of our canvases opt into `dpr={[1, 2]}`.
- On Apple GPUs, per-pass timestamps are encoder wall spans, including waits on earlier passes. Sums match the frame only when passes are serial. Rank with timestamps, confirm with frame time and by turning the pass off.
- M1-class chips drift ~50% hotter across runs. Compare with ABAB pairs in one session, not two medians taken minutes apart.
- Headless fps is not GPU time when the CPU submit queue runs ahead. Draw count dominates `cpu.submit`. Instancing (what the 2.5D editor already does) is the lever. Their forest was ~905 draws and 12–15 ms of submit before any GPU pass mattered.
- Unaligned screenshots differ 20–27% from TAA jitter alone. Pixel diffs need a frozen frame index, frozen motion, and locked exposure. Their deterministic floor once pinned was ≤0.2%.
- "The change did nothing" — confirm the served module actually changed before touching the algorithm. Vite missed tool-driven writes until `server.watch.usePolling`. esbuild strips comments and rewrites `1000` to `1e3`, so grep the bundle for identifiers.
- Ablation (`?ablate=ao`) beats guessing which stage is wrong, but the matrix goes stale after an upstream fix. Re-run it. Differential questions ("terrain casts, vegetation doesn't") localised bugs faster than turning whole pipeline stages off.
- A flat class-colour debug (`hue = class * 47°`) identified the wrong mesh in minutes after hours of lighting theories. Worth a dev-only mode if the 3D factory scene gets dense.
- Silent black frames were usually bad uniforms, not WebGPU validation errors. They still wired `device.onuncapturederror`.

### Performance, without dropping detail

Their user rule was: no closer LOD, no dynamic resolution, no density cuts, no fog used to hide cost. The wins that transfer:

- Bake noise. A terrain splat with ~35 live noise evaluations per pixel was ~52 ms of a 73 ms frame. A pre-baked value/gradient texture removed it. Our iso shade is one dot product; don't grow it into per-pixel noise.
- Alpha-tested overdraw (grass, cards): depth-only prepass, then colour with `depthFunc = EQUAL`. Opaque twins were a loss. Skip this for solid pipes and tanks.
- On WebGPU/Metal that prepass needs `@invariant` on clip position. Metal fuses the position math differently per pipeline, so `depthFunc = EQUAL` drops the shaded pass. three r184 has no API for it; they patched the WGSL builder prototype. A second `three/src/...` import is a different module instance, and patching that does nothing.
- Shared shadow materials that flip `alphaTest` between 0 and a cutout bump `material.version` every object and rehash the node graph hundreds of times per frame. Give the shadow material its own plain `alphaTest`. A cache keyed only by material identity collides across geometries; key it per render object.
- Far cascades do not need to redraw every frame when the sun is still. Cache the map and the light pose together. A moved light over a cached map slides every shadow.
- `BundleGroup` in r184 is not production-ready: it records pipelines at first render (async compiles ⇒ objects missing forever), ignores `renderOrder`, and dropped per-cascade caster layers. They reverted it.

## WebGPU / TSL gotchas (from r184, still the ones to check on r186)

Verify every unfamiliar API against `node_modules/three` and `node_modules/@types/three`. Memory of the TSL surface is wrong often enough that they kept an append-only log.

Import convention they settled on: core math from `three`, renderer and node materials from `three/webgpu`, TSL functions from `three/tsl`. `three/webgpu` re-exports core; Vite dedupes.

`RenderPipeline.outputNode` runs on a full-screen quad camera. `cameraPosition`, `cameraWorldMatrix`, and `cameraProjectionMatrixInverse` inside that pass are the quad camera, silently. Pass scene-camera uniforms yourself. Stock GTAO and TRAA take a `camera` argument for this reason.

Depth in their r184 WebGPU renderer was classic (sky = 1), not reversed-Z. Probe in-shader. Don't trust the docs for a 4 km far plane.

`VelocityNode` projects raw `positionLocal`. Anything moved by `positionNode` (morph, instancing, wind) writes garbage velocity, and TRAA then rejects history — TAA silently off on that geometry. Sky pixels write velocity 0, so history smears clouds for ~20 frames. Their fix was analytic camera reprojection from each pixel's depth. `getViewPosition` flips v; a hand-rolled projection must flip it back or the result is mirrored.

`TRAANode` samples velocity once, via `.load(texel)`. A duck-typed `{ load }` is a valid substitute. It also jitters the camera only inside the render pipeline and clears the offset after, so uniforms copied between frames are unjittered.

GTAO at grazing distance goes black for two independent reasons: (1) the world-space sample radius projects inside one depth texel, the sample normalises to ~0, and the pixel is treated as fully occluded — reject same-texel samples and clamp the horizon cosine before the sqrt; (2) a joint-bilateral upsample with `exp2(-k·|Δz|)` rejects every tap on a slope, and `acc / ε` becomes 0. Gate on weight sum and fall back to a plain average. A global weight floor is not the same fix; it tinted their hero trunk ~1%.

Timestamp queries: every `compute()` allocates a pair into a Map three never clears, and the 2048-query pool only resets its write index on resolve. Resolve every frame or attribution dies after ~10 frames. Apple per-pass numbers include stalls (see Measuring).

Compute: `instancedArray(count, 'vec4').element(i)` inside `Fn`, then `.compute(count, [64])`, then `renderer.computeAsync`. Default storage-buffer limit is 8 per stage. Indirect draws that worked: `Mesh` (not `InstancedMesh`) + `geometry.setIndirect` + `frustumCulled = false`, counts written by compute into one `IndirectStorageBufferAttribute`. Pad kernels past the 65535-workgroup split (`If(i >= N) Return()`).

TSL `.assign()` / `.toVar()` need an active `Fn()` stack. Material graphs are not inside one. Shared helpers must be pure expressions. `@types/three` types `Fn` loosely; `Fn<[]>` when `Fn(() => {})()` fails to typecheck.

`StorageTexture` defaults to `rgba8unorm` with mipmaps auto-updating after compute. Set `.type` for float data. Readback rows are top-left origin.

`PassTextureNode.size()` returned 0 for an MRT attachment. Use `screenSize` when the pass is at drawing-buffer resolution.

## How they kept the agent honest

Worth copying as practice, independent of Three version.

- One brief (`PROJECT_LAAS_v2.md`) sets the visual bar, numeric floors, and banned outcomes (black shadows, cloned trees, fog as cover, `MeshBasicMaterial`, CPU per-instance updates). It does not say how.
- `STATUS.md` is the rehydration file: mission, hard rules, verified environment, phase checklist, next actions, decisions, append-only gotchas. Resume from "next actions." Don't re-plan.
- `docs/THREE-NOTES.md` is append-only and only records APIs checked against the installed package.
- `docs/DEVIATIONS.md` is where an infeasible floor goes, with the nearest thing that still meets the intent. A closed phase has no TODOs left in its code.
- One commit per milestone. Screenshot gates are frame-aligned and compared to a reference, not eyeballed once.
- User feedback that a model cannot judge from a still (motion, interactive fps, whether an artifact shows while moving) stays a human call. They were explicit about which constants were waiting on that.
