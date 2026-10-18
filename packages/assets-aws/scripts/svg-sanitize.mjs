import { DOMImplementation, DOMParser, XMLSerializer } from '@xmldom/xmldom';

/**
 * Reject unsafe vendor SVGs before canonicalising them. Keep this policy small:
 * adding an element/attribute requires reviewing its browser behaviour first.
 *
 * @xmldom/xmldom is maintained, MIT licensed, dependency-free and usable from
 * Node 26 ESM. Its namespace-aware XML DOM decodes character references before
 * validation and gives us a real serializer. Unlike its recovery defaults, ALL
 * parser diagnostics are fatal here; malformed XML must never be repaired into
 * an accepted icon. https://github.com/xmldom/xmldom
 */

/** Per-icon size budget (bytes). The largest AWS Architecture 64px icon is ~11 KB. */
export const MAX_ICON_BYTES = 16 * 1024;

const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const length = new RegExp(`^${number}(?:px|%|em|ex|cm|mm|in|pt|pc)?$`);
const numeric = new RegExp(`^${number}%?$`);
const numbers = new RegExp(`^\\s*${number}(?:(?:\\s*,\\s*|\\s+)${number})*\\s*$`);
const fragment = '#[A-Za-z_][A-Za-z0-9_.:/-]*';
const fragmentOnly = new RegExp(`^${fragment}$`);
const localUrl = new RegExp(`^url\\(\\s*(${fragment}|"${fragment}"|'${fragment}')\\s*\\)$`);
const transform = new RegExp(`^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\\(\\s*${number}(?:(?:\\s*,\\s*|\\s+)${number})*\\s*\\)\\s*,?\\s*)+$`);

const oneOf = (...values) => (value) => values.includes(value);
const isLength = (value) => length.test(value);
const isNumber = (value) => numeric.test(value);
const isTransform = (value) => transform.test(value);
const isColour = (value) => /^(?:#[\da-fA-F]{3,4}|#[\da-fA-F]{6}|#[\da-fA-F]{8}|[a-zA-Z]+|(?:rgb|rgba|hsl|hsla)\([\d+.,%/\s-]+\))$/.test(value);
const isPaint = (value) => isColour(value) || localUrl.test(value);

// These value grammars deliberately exclude CSS escapes, comments, arbitrary
// functions and URL fallbacks. Checking only for a literal "url(" misses CSS
// obfuscation even after XML character references have been decoded.
const presentation = {
  id: (value) => /^[A-Za-z_][A-Za-z0-9_.:/-]*$/.test(value),
  fill: isPaint,
  'fill-opacity': isNumber,
  'fill-rule': oneOf('nonzero', 'evenodd'),
  stroke: isPaint,
  'stroke-width': isLength,
  'stroke-opacity': isNumber,
  'stroke-linecap': oneOf('butt', 'round', 'square'),
  'stroke-linejoin': oneOf('miter', 'round', 'bevel'),
  'stroke-miterlimit': isNumber,
  'stroke-dasharray': (value) => value === 'none' || numbers.test(value),
  'stroke-dashoffset': isLength,
  opacity: isNumber,
  color: isColour,
  'clip-path': (value) => value === 'none' || localUrl.test(value),
  'clip-rule': oneOf('nonzero', 'evenodd'),
  mask: (value) => value === 'none' || localUrl.test(value),
  display: oneOf('none', 'inline'),
  visibility: oneOf('visible', 'hidden', 'collapse'),
  'vector-effect': oneOf('none', 'non-scaling-stroke'),
  'shape-rendering': oneOf('auto', 'optimizeSpeed', 'crispEdges', 'geometricPrecision'),
  transform: isTransform,
};
const viewport = {
  viewBox: (value) => numbers.test(value) && value.trim().split(/[\s,]+/).length === 4,
  preserveAspectRatio: (value) => /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value),
};
const region = { x: isLength, y: isLength, width: isLength, height: isLength };
const units = oneOf('userSpaceOnUse', 'objectBoundingBox');
const gradient = {
  gradientUnits: units,
  gradientTransform: isTransform,
  spreadMethod: oneOf('pad', 'reflect', 'repeat'),
};
const attributes = (...groups) => Object.assign(Object.create(null), ...groups);

// Exact, case-sensitive SVG names, with no prototype properties as fallbacks.
// No style attributes/elements, animation, links, images or embedded documents.
const ELEMENTS = new Map(Object.entries({
  svg: attributes(presentation, region, viewport, { version: oneOf('1.0', '1.1', '2.0') }),
  g: attributes(presentation),
  path: attributes(presentation, {
    d: (value) => /^[MmZzLlHhVvCcSsQqTtAaEe\d+.,\s-]*$/.test(value),
    pathLength: isNumber,
  }),
  rect: attributes(presentation, region, { rx: isLength, ry: isLength, pathLength: isNumber }),
  circle: attributes(presentation, { cx: isLength, cy: isLength, r: isLength, pathLength: isNumber }),
  ellipse: attributes(presentation, { cx: isLength, cy: isLength, rx: isLength, ry: isLength, pathLength: isNumber }),
  line: attributes(presentation, { x1: isLength, y1: isLength, x2: isLength, y2: isLength, pathLength: isNumber }),
  polyline: attributes(presentation, { points: (value) => numbers.test(value), pathLength: isNumber }),
  polygon: attributes(presentation, { points: (value) => numbers.test(value), pathLength: isNumber }),
  title: attributes({ id: presentation.id }),
  desc: attributes({ id: presentation.id }),
  defs: attributes(presentation),
  linearGradient: attributes(presentation, gradient, { x1: isLength, y1: isLength, x2: isLength, y2: isLength }),
  radialGradient: attributes(presentation, gradient, { cx: isLength, cy: isLength, r: isLength, fx: isLength, fy: isLength, fr: isLength }),
  stop: attributes(presentation, { offset: isNumber, 'stop-color': isColour, 'stop-opacity': isNumber }),
  clipPath: attributes(presentation, { clipPathUnits: units }),
  mask: attributes(presentation, region, { maskUnits: units, maskContentUnits: units, 'mask-type': oneOf('luminance', 'alpha') }),
  use: attributes(presentation, region, { href: (value) => fragmentOnly.test(value) }),
}));

function parseSvg(text) {
  if (Buffer.byteLength(text) > MAX_ICON_BYTES) throw new Error(`larger than ${MAX_ICON_BYTES} bytes`);
  // xmldom drops empty CDATA and accepts bare '&' without a diagnostic (covered
  // by regression tests). Check these lexical constraints before parsing, while
  // leaving actual comments to the parser to validate. This is not a cleanup:
  // parse the original bytes so rejected constructs cannot disappear first.
  // One leading XML declaration (`<?xml version="1.0" encoding="UTF-8"?>`, as in
  // AWS's own icon files) is allowed and dropped; every other `<?` / `<!` (PIs,
  // DOCTYPE, entities, CDATA) is still rejected (GPT review of #182). The parser
  // sees the text without it, so the node walk below still rejects every PI.
  const withoutDecl = text.replace(/^\uFEFF?\s*<\?xml(?:\s+(?:version|encoding|standalone)\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*\s*\?>/, '');
  const withoutComments = withoutDecl.replace(/<!--[\s\S]*?-->/g, '');
  if (/<[!?]/.test(withoutComments)) throw new Error('DOCTYPE, entity, processing instruction or CDATA is not allowed');
  if (/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/.test(withoutComments)) {
    throw new Error('invalid XML character/entity reference');
  }
  const doc = new DOMParser({
    onError: (_level, message) => { throw new Error(`invalid XML: ${message}`); },
  }).parseFromString(withoutDecl, 'application/xml');
  if (doc.documentElement?.localName !== 'svg') throw new Error('root element must be <svg>');
  return doc;
}

/** Validate, then rebuild a deterministic DOM; never serialize the untrusted DOM. */
export function sanitizeSvg(text) {
  const source = parseSvg(text);
  const output = new DOMImplementation().createDocument(SVG, 'svg', null);
  let usesXlink = false;

  function copy(node, parent, depth = 0) {
    if (depth > 64) throw new Error('SVG nesting exceeds 64 levels');
    switch (node.nodeType) {
      case node.DOCUMENT_NODE:
        for (const child of Array.from(node.childNodes)) copy(child, parent, depth);
        return;
      case node.COMMENT_NODE:
        return;
      case node.TEXT_NODE:
        if (parent?.localName === 'title' || parent?.localName === 'desc') {
          parent.appendChild(output.createTextNode(node.data));
        } else if (node.data.trim()) throw new Error('text is only allowed in title/desc');
        return;
      case node.ELEMENT_NODE: {
        const allowed = ELEMENTS.get(node.localName);
        if (node.namespaceURI !== SVG || node.prefix || !allowed) {
          throw new Error(`element <${node.nodeName}> or its namespace is not allowed`);
        }
        if (parent?.localName === 'title' || parent?.localName === 'desc') {
          throw new Error('title/desc must contain text only');
        }
        const element = parent ? output.createElementNS(SVG, node.localName) : output.documentElement;
        const attrs = [];
        for (const attr of Array.from(node.attributes)) {
          if (attr.namespaceURI === XMLNS) {
            if (attr.name === 'xmlns' && attr.value === SVG) continue;
            if (attr.name === 'xmlns:xlink' && attr.value === XLINK) continue;
            throw new Error(`namespace declaration ${attr.name} is not allowed`);
          }
          if (attr.namespaceURI || attr.prefix) {
            if (node.localName !== 'use' || attr.name !== 'xlink:href' || attr.namespaceURI !== XLINK || !fragmentOnly.test(attr.value)) {
              throw new Error(`attribute ${attr.name} or its namespace/value is not allowed on ${node.localName}`);
            }
            usesXlink = true;
          } else if (!Object.hasOwn(allowed, attr.name) || !allowed[attr.name](attr.value)) {
            throw new Error(`attribute ${attr.name} or its value is not allowed on ${node.localName}`);
          }
          attrs.push(attr);
        }
        attrs.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        for (const attr of attrs) element.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
        if (parent) parent.appendChild(element);
        for (const child of Array.from(node.childNodes)) copy(child, element, depth + 1);
        return;
      }
      default:
        // Includes DOCTYPE/entity nodes, CDATA, and all PIs (also XML prologs).
        throw new Error('DOCTYPE, entity, processing instruction or CDATA is not allowed');
    }
  }

  copy(source, null);
  // A single default SVG declaration, plus xlink only when a use needs it.
  output.documentElement.setAttributeNS(XMLNS, 'xmlns', SVG);
  if (usesXlink) output.documentElement.setAttributeNS(XMLNS, 'xmlns:xlink', XLINK);
  const result = new XMLSerializer().serializeToString(output, { requireWellFormed: true }) + '\n';
  if (Buffer.byteLength(result) > MAX_ICON_BYTES) throw new Error(`canonical SVG larger than ${MAX_ICON_BYTES} bytes`);
  return result;
}

/** Existing assets:sync API: no problems for accepted input, a reason otherwise. */
export function svgProblems(text) {
  try {
    sanitizeSvg(text);
    return [];
  } catch (error) {
    return [error.message];
  }
}

/** The icon's tile colour, independent of canonical attribute ordering. */
export function tileColour(text) {
  const doc = parseSvg(text);
  for (const element of Array.from(doc.getElementsByTagName('g'))) {
    if (!element.getAttribute('id')?.includes('Icon-Architecture-BG')) continue;
    const fill = element.getAttribute('fill') || element.getElementsByTagName('rect')[0]?.getAttribute('fill');
    if (/^#[\da-fA-F]{6}$/.test(fill)) return fill.toUpperCase();
  }
  return undefined;
}
