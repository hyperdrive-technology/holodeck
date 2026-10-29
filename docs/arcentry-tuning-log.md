# Arcentry 2.5D tuning log

Parameter history moved out of `.agents/TODO.md` (2026-10-13) so the backlog stays one line per item. Values read as `chosen vs rejected`. Reference: `packages/editor-2.5d-react/tests/snapshots/reference.jpg`.

## Batch 3 — Mixer lid/shaft + tank liquid/window

- dome + agitator hat on apex
- shaftLength / lid thickness / shape height sliders wired
- cutout hides window meridians
- mixer fill 0.52, fillColor #18BAE6
- liquid closed flask LIQUID_THETA_LENGTH 2π
- mixer innerRatio 0.72
- mixer liquidOpacity 0.84 vs see-through 0.69
- mixer window yaw 40 vs inherited 45
- 3-blade impeller at π/6 yaw, radius 0.03 vs fat 0.042, 4-gon bars vs sausage 6-gon, blades from hub vs through-center 6-ray star, span 0.36 vs still-large 0.45 / 0.55 / 0.70 / star-across-U 1.0 / through-flask 1.5
- impeller Y factor 0.38 vs mid-flask 0.72 / still-high 0.50 (shaft grows lid→blades so MIXER_SHAFT_LENGTH stays 0.77)
- agitator #666 vs dark star #5a5e62
- shaft radius 0.032 vs fat 0.055
- shaft 16-gon vs faceted 8-gon
- mixer shaftLength 0.77 vs through-heel 0.95
- mixer shadeMin 0.40 vs tank charcoal 0.22
- mixer hubWhite 0.88 vs greyed hub 0.77
- mixer shadeMax 0.97 vs greyed light 0.92
- mixer linerRatio 0.99 vs thick window 0.97
- mixer linerColor #ffffff vs cream #f4f4f4
- mixer capHeightRatio 0.10 vs chimney 0.18
- mixer capRadiusRatio 0.40 vs wide 0.5
- mixer capLidThickness 0.02 vs tall 0.025
- mixer radialSegments 15 vs dense 24
- mixer hat lid ring off (was a dark washer)
- mixer hat yaw π/8 (face-on vs vertex-on)
- mixer agitator depthTest on (star punched through the bottle)
- mixer heel meridians step 3 (was every radial)
- mixer bodyRings 0 vs 3 extra hoops
- tank bodyRings 0 vs 1 extra hoop
- tank shadeMin 0.22 vs pale 0.27
- tank shadeMax 0.95 vs greyed light 0.92
- tank hubWhite 0.85 vs greyed hub 0.77
- tank linerColor #ffffff vs cream #f4f4f4
- tank linerRatio 0.99 vs thick window 0.97
- tank liquidOpacity 0.78 vs see-through 0.69
- tank wallThreshold 15 vs wire-cage 7 (mixer stays 7)
- tank wall/ullage/dome meridians step 3 (was step 2 denser than flask)
- tank domeHeightSegments 2 vs latitude cage 4
- tank innerRatio 0.74 vs pie 0.9
- TANK_WINDOW_DEG 91 / TANK_WINDOW_YAW 45 exported (cut sits vs r-holdbody
- mixer stays 70/40)
- tank bowlYOffset 0 (was −0.2 ball-on-floor)
- ingredient A/B fill 0.12 (0.22 climbed the cylinder vs r-inga dish)
- liquid depthWrite false
- inner flask is one lathe not bowl+cylinder rims
- flask meridians step 3 vs dense step 2
- mixer wall meridians step 3 on the upper lathe
- mixer upper body is one windowed lathe (wall+cosine shoulder+dome) starting heelOl below the U equator
- mixer shoulder 0.18 / top 0.82
- mixer outer heel 0.28 360°
- overlaps 0.06/0.05/0.04
- mixer inner flask U matches outer heel

## Batch 4 — Routing trim + isometric labels

- west stub toX −2, hex nut 0.24×0.26 + 6-gon rings radial 2.28–2.52 π/6 face roll, inset 0.08·half, nip 0.18·half
- west ring Edges 15 vs wire-cage 1 (nut stays 1)
- west ring along-pipe 0.11–0.13 vs pancake discs 0.08–0.10
- west tank-end collar 1.28×0.07 vs fat 1.5×0.1
- steam nut Euler XYZ X=π/6 flat-top Y=π/12 (Y=0 cubed), round bore 16-gon
- steam-out +90° inner wedge — do not retouch yaw
- steam-out-b through hex toX 12.9, thin collars
- steam hex 0.40×0.50 unlit
- STEAM_NUT_EDGE_THRESHOLD 15 vs wireframe/threshold 1 cage (west nut stays 1)
- squat 8-gon mixer hat
- snapshot HTML pins via screenX/Y
- snapshot visuals are slab Troika Text at unprojected pins (tick 186 Html transform overshot huge mirrored type — do not retry)
- snapshot letterSpacing -0.03em vs unset wide glyphs
- snapshot Helvetica vs system-ui
- snapshot fontWeight 300 vs 400 heavy
- A Input 542/133 vs left 532/130
- A Input chevron 520/132 vs left 515/130
- B Input 685/211 vs left 675/208
- B Input chevron 648/207 vs right 655/206
- Out to Packaging 88/343 vs left 78/340
- packaging chevron 16/334 vs right 20/332 / 26/329
- Supply Tanks 488/208 (472 overshot onto pipes)
- Ingredient A 330/124 vs left 325/123 / tank-wall 332/125
- Ingredient B 630/294 vs left-high 622/286 / high-right 640/272
- two-line lineHeight 1.45
- two-line textAlign right vs centered Tank under Holding
- valve-b on pipe-b-h
- holding 218/358 vs left 204/356
- steam 464/444
- pressure size 0.26 pin 358/420
- 14 deg 542/326
- temp 438/302
- rpm 432/314
- rpm-val 536/338
- liquid closed flask 2π + flat waterline

## Batch 5 — Interior rings, mixer agitator, flange rotation (Des review 2026-10-29)

- Reverses Batch 3's "no lines inside the window": inner back-wall rings (bottom rim, `TANK_INTERIOR_HOOPS` 2 hoops, top rim) on the back arc only (`interiorRingArc` = window arc + π, margin 0.08 rad); horizontal only, no meridians / wire cage
- rings follow the liner facets (`facetedRadiusAt`) vs smooth circle at 0.995 r (hid behind each flat facet → dashed ring)
- tank liquidOpacity 0.8 (depthWrite on) vs solid 1 (hid the rings below the waterline) / 0.88 depthWrite off (flask back faces printed through)
- mixer liquidOpacity 0.72 vs 0.84 (shaft + impeller vanished below the waterline)
- mixer hat: round 24-gon drum (aspect 0.72 × radius) + neck sunk 0.03 into the dome + cover plate 1.04 r vs squat 8-gon puck; aspect 0.9 sat tall
- impeller: hub (2.2 × shaft r) + 3 pitched paddles (π/5, chord 3.5 × impellerRadius) vs round 4-gon bars ("stray orange sticks")
- impeller height fixed: dome apex − shaftLength × H, clamped ≥ 0.16 H above the floor, shaft ends in the hub vs fill × 0.38 (floated off the shaft, rode the waterline)
- MIXER_SHAFT_LENGTH 0.9 (apex → hub) vs 0.77 (lid → old blades); MIXER_IMPELLER_SPAN 0.7 vs 0.36 (tiny star as blades)
- shaft #8c9196, blades #c9cdd1 + edges vs #666 (vanished in the liquid)
- mash tun = mixer bottle body (MIXER_BODY_PRESET) R 1.0 × H 2.5 on 0.22 legs vs squat 1.7 dish-bottom can; Mixer part and mash tun share `Tank` + `TankAgitator` (Mixer no longer draws its own agitator)
- legs yaw 0 (pairs either side of the camera axis) vs π/4 (one leg dead centre under the cutaway); legs on a heel stop at the heel surface at their inner edge (higher poked through into the window)
- whirlpool nozzle: shared pipe geometry (`tankNozzleGeometry`, flange = routed-pipe flange) posed by `tankNozzlePose` quaternion vs group yaw + X-cylinder roll; runs −tangent from a foot 0.32 rad past the jamb, buried 1 r + 0.03 R inside the shell; nozzle r 0.08 R vs 0.06 R
- nozzle rejected: +tangent at 0.38 (axis 23° off camera → round face on a long pipe read as a twisted flange), +tangent at 0.2 (still a bolt end-on), −tangent tangent-outside (capped stub floating at the jamb), foot 0.04 / 0.24 (foot showed through the window), chord depth 0.5 (near end poked out)
- steam nut Euler [π/6, 0, −π/2] XYZ vs [π/6, π/12, −π/2] (π/12 yawed the nut 15° off its +X run)
- fidelity (system Chrome 15x, same build reproduces the darwin record 0.16487 on main): 0.18745 vs 0.16487
