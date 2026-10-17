# Scene objects (Arcentry parity, holodeck#36)

The `holodeck.iso` object model beyond process parts: data-only components with brand logos,
connectors, styled areas and labels, icons, images, a metadata plane, opacity and z-order. Every
object is an ordinary placement of a registry part, so it has inspector controls for its params and
can bind them to live data (`bindings`).

Body format: `holodeck.iso.scene.v1`, JSON Schema in
[`schema/holodeck-iso-scene.v1.schema.json`](../schema/holodeck-iso-scene.v1.schema.json)
(also `@holodeck/editor-2.5d-react/schema/holodeck-iso-scene.v1.schema.json`). The TS validator
(`parseSceneFile`) is authoritative: on top of the schema it checks that parts are installed, that
param values match the installed part's param specs, and that footprints stay within the routing
limits. `src/objects/scene-schema.test.ts` keeps the two in step.

## Fields on every placement

| Field | Meaning | Limits |
|---|---|---|
| `opacity` | 0..1, default 1. Below 1 the placement renders with its own faded material clones (never pooled). | 0..1 |
| `z` | Draw order among overlapping objects (renderOrder offset of `z * 100`). Higher draws on top. | integer, ±1000 |
| `meta` | Metadata plane: `key: value` rows on the floor in front of the object. | ≤ 32 rows, key 1..64 chars, value string ≤ 256 / finite number / boolean |
| `metaHidden` | Keep `meta` but hide the plane. | boolean |
| `link` | Connector anchors (see below). | `via` ≤ 64 points |
| `layer` | Editor layer id (`scene.layers`). Absent or undeclared = the default layer. | 1..64 chars |
| `group` | Group id: members select, move, copy and delete together in the editor (one level). | 1..64 chars |
| `params` | Checked against the part's param specs: numbers finite and within `min`/`max` (reading params such as label `value` also take a boolean or a string state), enums one of `options`, `color` params hex or `''`, strings ≤ 4096 chars (`maxLength`), `format: 'url'` params an allowed URL. Undeclared params must be finite JSON. | |

Asset URLs (logos, images) may be relative paths, `http(s):`, `blob:` or `data:image/…`; any other
scheme (`javascript:`, `file:` …) is rejected, after stripping what browsers strip before the scheme
(leading / trailing control characters and spaces, tab / LF / CR anywhere). The same check runs again
when an image loads, so URLs set by the inspector or a host's live values are covered too.
Placements with a visible `meta` plane render as unique meshes even for pooled parts (valve, pipe …). A URL that fails to load draws nothing and warns once.

## Data-only parts

A part definition needs no React `component`. Without one it renders through `DataPart`:

```json
{
  "id": "aws:lambda", "label": "Lambda", "category": "Compute",
  "footprint": { "w": 1, "h": 1 }, "params": {},
  "model": "https://cdn.example.com/archetypes/function.glb",
  "logo": { "url": "https://cdn.example.com/aws/lambda.svg", "size": 0.7 },
  "colors": { "body": "#ffffff", "accent": "#ff9900", "edge": "#333333" }
}
```

- `model` (optional): a GLB styled by the active theme (`applyHolodeckStyle`); `colors.body` recolours
  `hd.white`, `colors.accent` recolours `hd.accent` (a placement's `color` beats it), `colors.edge` the
  outlines. Without a model the part is a plain block of the footprint and `blockHeight` (default 1).
- `logo`: a textured plane on the top face, grid-aligned, letterboxed to the image's aspect.
  **Logo-plane contract (Blender archetypes, lane A1):** if the GLB has an empty named `logo`, the
  plane sits at that empty facing up and its X/Z scale is the edge length (a unit empty = 1 world
  unit; `logo.size` overrides). Without one the plane sits on the model's bounding-box top, 60% of the
  short side.
- `floor: true` makes a pack part a floor annotation (never a routing obstacle); `extent(placement)`
  tells fit-to-view about anything beyond the footprint.

## Connectors

Part `connector`. Ends come from `link` or the placement itself:

```json
{ "id": "c1", "object": "connector", "x": 0, "y": 0,
  "link": { "from": { "object": "web", "port": "east" }, "to": { "object": "db" } },
  "params": { "color": "#d0021b", "width": 0.12, "dash": "dashed", "startTip": "dot", "endTip": "arrow",
              "label": "HTTPS", "flow": true, "flowSpeed": 2, "route": "auto" } }
```

- End `{ object, port }`: that part's port cell and heading (the same ports pipes use).
  `{ object }`: the part's centre, clipped where the line leaves its footprint. `{ x, y }` or absent:
  a free point (absent `from` = the placement's `x, y`; absent `to` = `toX, toY`, else 3 cells along +x).
  An anchor naming a deleted placement draws nothing.
- `route: "auto"` routes with the pipe router (A*, `planRoute`) around part footprints, ignoring the
  anchored parts and floor annotations; no clear route falls back to the manhattan L. `"straight"`
  draws one segment. `link.via` waypoints make a fixed polyline.
- Look: `color` / `width` empty or 0 use the theme (`HolodeckStyle.annotation.connector` /
  `connectorWidth`). `dash`: solid, dashed, dotted. Tips: none, arrow, dot. `label` is a caption at
  the midpoint. `flow` animates dots along the line (`flowSpeed` cells/s, negative = backwards).

## Areas, labels, icons, images

- **area** params: `fill`, `outline` (hex, `''` = theme), `outlineStyle` solid / dashed / dotted / none,
  `shadow` 0..3, `walled` + `wallHeight` (Arcentry's "VPN" area). The default look is unchanged.
- **label** params (in addition to `text` / `value` / `unit` / `format`): `bold`, `italic`, `align`
  (auto / left / center / right), `outline` (halo colour), `orient` flat / upright (stands up and
  faces the camera). Size and rotation stay on the placement (`size`, `rotation`).
- **icon** params: `icon` (built-in set: server, database, cloud, user, lock, bolt, warning, check,
  cross, globe, queue, arrow, star, circle, square), or `glyph` (≤ 8 characters of any font),
  `color`, `size` (cells), `orient`.
- **image** params: `src` (URL), `mode` floor / billboard, `width`, `height` (0 = keep aspect).

## Theme tokens

Annotation colours come from `HolodeckStyle.annotation` (`annotationStyle(style)`), never from
per-part constants: connector colour and width, flow dots, icon and text colour, dashed outline
width, wall colour / opacity / height, shadow colour / opacity, metadata panel. Themes written
before these tokens existed fall back to `HOLODECK_ANNOTATION_STYLE`.

## Layers

`scene.layers` (≤ 64): `{ "id": "piping", "name": "Piping", "hidden": true, "locked": false }`. The
default layer (`"default"`) always exists; declaring it only renames, hides or locks it. Hidden layers
are not drawn (edit and run mode); hidden and locked placements cannot be selected or edited, but stay
obstacles for pipe routing. The editor's Layers tab edits all of this as undoable steps.

In the editor, the connector tool (C) draws a connector with two clicks (a part, its port within one
cell, or an empty cell), dragging a selected connector's end handles re-anchors or frees that end, and
deleting a part turns connector ends anchored to it into free points where they were. Waypoints: a selected
connector shows a small "+" handle in the middle of each segment; press and drag it to insert a
waypoint (`link.via`), drag a square waypoint handle to move it, double-click it to remove it. Each
is one undo step. A live `route` value (a binding on the `route` param) re-routes the line like the
static param does.

## Not here yet

- The `chart` widget (time series from a provider's `history`): holodeck#90.
