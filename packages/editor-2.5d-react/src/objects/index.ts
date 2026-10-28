/**
 * Arcentry-parity object model (holodeck#36): validation, connector paths,
 * stroke geometry, icons, logo anchors, opacity / z-order. Renderers live in
 * the *.tsx files next to these and are reached through the part registry.
 */
export {
  appearanceProblems,
  assetUrlProblem,
  normalizeUrlForScheme,
  isHexColor,
  linkProblems,
  metaProblems,
  paramsProblems,
  paramValueProblem,
  MAX_LINK_VIA,
  MAX_META_ENTRIES,
  MAX_META_KEY,
  MAX_META_VALUE,
  MAX_PARAM_STRING,
  MAX_URL_LENGTH,
  MAX_Z,
} from './validate';
export type { IsoLayer, IsoLink, IsoLinkEnd, IsoMetaValue, IsoPipeAttach, IsoPipeEnds } from './validate';
export {
  connectorExtent,
  freeConnectorPath,
  resolveConnectorPath,
  resolveConnectorPaths,
  resolveLinkEnd,
  DEFAULT_CONNECTOR_LENGTH,
} from './connector';
export type { ConnectorPath, ConnectorRoute, ResolvedLinkEnd } from './connector';
export { pointAt, polylineLength, simplifyPolyline, strokePolyline, MAX_DASHES } from './stroke';
export type { DashStyle, StrokeMesh, StrokeOptions, TipStyle, Vec2 } from './stroke';
export { BUILTIN_ICONS, BUILTIN_ICON_NAMES, drawIcon, MAX_GLYPH_LENGTH } from './icons';
export type { BuiltinIconName, IconShape } from './icons';
export { logoAnchorFromModel, logoAnchorForBlock, LOGO_NODE_NAME } from './logo';
export type { LogoAnchor } from './logo';
export { applyAppearance, AppearanceState, hasVisibleMeta, needsAppearance, needsUniqueRender, Z_RENDER_STEP } from './appearance';
export { Appearance } from './AppearanceGroup';
export { Connector, connectorLook } from './ConnectorLine';
export type { ConnectorLook } from './ConnectorLine';
export { IconMark, ImageMark, MetaPlane } from './Marks';
export { resetTextureCache, useTrackedTexture } from './assets';
