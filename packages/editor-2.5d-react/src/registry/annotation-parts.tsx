/**
 * Arcentry-parity annotation parts (holodeck#36): connector, icon, image.
 * Like every built-in, they are ordinary registry contributions; the editor
 * knows none of these ids. Their look comes from params (inspector controls
 * for free, bindable to live data) with theme defaults from
 * `HolodeckStyle.annotation` for anything left empty.
 */

import { Connector, connectorLook } from '../objects/ConnectorLine';
import { connectorExtent, freeConnectorPath } from '../objects/connector';
import { BUILTIN_ICON_NAMES, MAX_GLYPH_LENGTH } from '../objects/icons';
import { imageAspect } from '../objects/image-aspect';
import { IconMark, ImageMark, type MarkOrient } from '../objects/Marks';
import { gridToWorld } from '../iso/grid';
import type { IsoPartDefinition, IsoPartParamSpec, IsoPartProps } from './types';

const ANNOTATION = 'Annotation';

const ORIENT: IsoPartParamSpec = { type: 'enum', label: 'Orientation', default: 'flat', options: ['flat', 'upright'] };

const orientOf = (v: unknown, fallback: MarkOrient = 'flat'): MarkOrient =>
  v === 'upright' || v === 'billboard' ? 'upright' : v === 'flat' || v === 'floor' ? 'flat' : fallback;
const numberOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function ConnectorPart({ placement, params, style, tuning }: IsoPartProps) {
  const path = tuning?.connectorPaths?.get(placement.id) ?? freeConnectorPath(placement);
  if (!path) return null;
  return <Connector points={path.points} look={connectorLook(params, style)} />;
}

function IconPart({ placement, params, style }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  return (
    <IconMark
      x={wx}
      z={wz}
      icon={typeof params.icon === 'string' ? params.icon : 'server'}
      glyph={typeof params.glyph === 'string' ? params.glyph : ''}
      color={typeof params.color === 'string' ? params.color : ''}
      size={numberOr(params.size, 1)}
      orient={orientOf(params.orient)}
      style={style}
    />
  );
}

function ImagePart({ placement, params }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  return (
    <ImageMark
      x={wx}
      z={wz}
      src={typeof params.src === 'string' ? params.src : ''}
      width={numberOr(params.width, 2)}
      height={numberOr(params.height, 0)}
      orient={orientOf(params.mode)}
    />
  );
}

export const CONNECTOR_PART: IsoPartDefinition = {
  id: 'connector',
  label: 'Connector',
  hint: 'line with arrow tips',
  category: ANNOTATION,
  footprint: { w: 1, h: 1 },
  floor: true,
  connector: true,
  params: {
    color: { type: 'color', label: 'Colour', default: '' },
    // 0 = the theme's annotation.connectorWidth.
    width: { type: 'number', label: 'Width', default: 0, min: 0, max: 2, step: 0.01 },
    dash: { type: 'enum', label: 'Line', default: 'solid', options: ['solid', 'dashed', 'dotted'] },
    startTip: { type: 'enum', label: 'Start tip', default: 'none', options: ['none', 'arrow', 'dot'] },
    endTip: { type: 'enum', label: 'End tip', default: 'arrow', options: ['none', 'arrow', 'dot'] },
    label: { type: 'string', label: 'Label', default: '', maxLength: 200 },
    labelSize: { type: 'number', label: 'Label size', default: 0.28, min: 0.1, max: 2, step: 0.01 },
    flow: { type: 'boolean', label: 'Animated flow', default: false },
    flowSpeed: { type: 'number', label: 'Flow speed', default: 1, min: -20, max: 20, step: 0.1, unit: 'cells/s' },
    route: { type: 'enum', label: 'Route', default: 'auto', options: ['auto', 'straight'] },
  },
  extent: connectorExtent,
  component: ConnectorPart,
};

export const ICON_PART: IsoPartDefinition = {
  id: 'icon',
  label: 'Icon',
  hint: 'floor symbol',
  category: ANNOTATION,
  footprint: { w: 1, h: 1 },
  floor: true,
  params: {
    icon: { type: 'enum', label: 'Icon', default: 'server', options: [...BUILTIN_ICON_NAMES] },
    // Any short text instead of a built-in icon: an emoji, "S3", a font-icon code point.
    glyph: { type: 'string', label: 'Glyph', default: '', maxLength: MAX_GLYPH_LENGTH },
    color: { type: 'color', label: 'Colour', default: '' },
    size: { type: 'number', label: 'Size', default: 1, min: 0.2, max: 16, step: 0.1, unit: 'cells' },
    orient: ORIENT,
  },
  component: IconPart,
};

export const IMAGE_PART: IsoPartDefinition = {
  id: 'image',
  label: 'Image',
  hint: 'picture on the floor or a billboard',
  category: ANNOTATION,
  footprint: { w: 1, h: 1 },
  floor: true,
  params: {
    src: { type: 'string', label: 'Image URL', default: '', format: 'url' },
    mode: { type: 'enum', label: 'Mode', default: 'floor', options: ['floor', 'billboard'] },
    width: { type: 'number', label: 'Width', default: 2, min: 0.1, max: 64, step: 0.1, unit: 'cells' },
    // 0 = keep the image's aspect ratio at `width`.
    height: { type: 'number', label: 'Height', default: 0, min: 0, max: 64, step: 0.1, unit: 'cells' },
  },
  extent: (p) => {
    const w = numberOr(p.params?.width, 2);
    // height 0 = width / the loaded aspect, as ImageMarkLoaded draws it
    // (holodeck#108); square until the image has loaded.
    const src = typeof p.params?.src === 'string' ? p.params.src : '';
    const h = numberOr(p.params?.height, 0) || w / (imageAspect(src) ?? 1);
    return { minX: p.x - w / 2, minY: p.y - h / 2, maxX: p.x + w / 2, maxY: p.y + h / 2 };
  },
  component: ImagePart,
};

export const ANNOTATION_PARTS: readonly IsoPartDefinition[] = [CONNECTOR_PART, ICON_PART, IMAGE_PART];
