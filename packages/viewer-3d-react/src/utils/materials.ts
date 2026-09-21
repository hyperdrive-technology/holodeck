import type { Color, Material, SceneNode } from '@holodeck/sdk';

/**
 * ISA-101 grey-normal base (≈ #9ca3af).
 * Saturated colour is reserved for abnormal status only — never green-for-running.
 */
export const ISA101_GREY: Color = { r: 0.6, g: 0.63, b: 0.67, a: 1 };

/** Amber for warning / off-normal. */
export const ISA101_WARNING: Color = { r: 0.96, g: 0.62, b: 0.04, a: 1 };

/** Red for critical. */
export const ISA101_CRITICAL: Color = { r: 0.94, g: 0.27, b: 0.27, a: 1 };

/**
 * Map `SceneNode.status` → ISA-101 display colour.
 * healthy / unknown / missing → grey; warning → amber; critical → red.
 */
export function colorForStatus(status?: SceneNode['status']): Color {
  switch (status) {
    case 'warning':
      return { ...ISA101_WARNING };
    case 'critical':
      return { ...ISA101_CRITICAL };
    case 'healthy':
    case 'unknown':
    default:
      return { ...ISA101_GREY };
  }
}

/**
 * Build a Three-friendly material colour for a node.
 * Status always owns hue; node.material only contributes opacity / metalness extras.
 */
export function resolveNodeColor(node: SceneNode): Color {
  const base = colorForStatus(node.status);
  const opacity = node.material?.opacity ?? node.material?.color?.a ?? base.a ?? 1;
  return { ...base, a: opacity };
}

/**
 * Convert an SDK Color to a CSS/Three hex-friendly RGB tuple (0–1).
 */
export function colorToRgb(color: Color): [number, number, number] {
  return [color.r, color.g, color.b];
}

/**
 * Resolve opacity + transparency flags from an SDK material, defaulting to opaque.
 * Opacity < 1 always implies transparency (createMaterial defaults transparent:false).
 */
export function resolveOpacity(material?: Material): {
  opacity: number;
  transparent: boolean;
} {
  const opacity = material?.opacity ?? material?.color?.a ?? 1;
  const transparent = Boolean(material?.transparent) || opacity < 1;
  return { opacity, transparent };
}
