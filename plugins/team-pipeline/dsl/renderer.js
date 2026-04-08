'use strict';

// ---------------------------------------------------------------------------
// renderer.js -- PDSL SVG Renderer
//
// Converts a LayoutGraph (from layout.js) + Theme (from themes.js) into a
// self-contained SVG string suitable for display in any SVG viewer.
//
// Main export:
//   render(layoutGraph, theme?)  -- returns SVG string
//
// SVG structure:
//   <svg xmlns="..." viewBox="0 0 W H" width="W" height="H">
//     <defs> <!-- arrowhead marker --> </defs>
//     <g class="edges"> <!-- one <path> or <polyline> per edge --> </g>
//     <g class="nodes"> <!-- one <g> per node --> </g>
//   </svg>
// ---------------------------------------------------------------------------

const { defaultTheme, getNodeStyle } = require('./themes');

// ---------------------------------------------------------------------------
// SVG generation helpers
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe embedding in XML/SVG attributes and text nodes.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert an array of {x, y} waypoints into an SVG polyline points string.
 * @param {Array<{x: number, y: number}>} waypoints
 * @returns {string}
 */
function waypointsToPoints(waypoints) {
  return waypoints.map(p => `${p.x},${p.y}`).join(' ');
}

/**
 * Compute the midpoint of an array of waypoints (for label placement).
 * Uses the point at the middle index of the array.
 * @param {Array<{x: number, y: number}>} waypoints
 * @returns {{x: number, y: number}}
 */
function midpoint(waypoints) {
  if (!waypoints || waypoints.length === 0) return { x: 0, y: 0 };
  const mid = Math.floor(waypoints.length / 2);
  if (waypoints.length === 1) return waypoints[0];
  // For even counts, average the two middle points
  const a = waypoints[mid - 1];
  const b = waypoints[mid];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ---------------------------------------------------------------------------
// Node rendering
// ---------------------------------------------------------------------------

/**
 * Render a standard (non-entity) node: rounded rect + centered label.
 * @param {object} node    -- LayoutNode
 * @param {object} style   -- style from getNodeStyle()
 * @param {object} theme   -- full theme
 * @returns {string}       -- SVG fragment
 */
function renderStandardNode(node, style, theme) {
  const { x, y, width, height, label } = node;
  const r  = theme.spacing.cornerRadius;
  const cx = x + width / 2;
  const cy = y + height / 2;

  const rect = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${r}" ry="${r}" ` +
    `fill="${escapeXml(style.fill)}" stroke="${escapeXml(style.stroke)}" stroke-width="1.5" />`;

  const text = `<text x="${cx}" y="${cy}" ` +
    `text-anchor="middle" dominant-baseline="central" ` +
    `font-family="${escapeXml(theme.font.family)}" font-size="${theme.font.sizeTitle}" ` +
    `fill="${escapeXml(style.textColor)}">${escapeXml(label)}</text>`;

  return `<g class="node node-standard" data-id="${escapeXml(node.id)}">\n    ${rect}\n    ${text}\n  </g>`;
}

/**
 * Render an entity node: UML-style box with header band + field rows.
 * @param {object} node    -- LayoutNode (meta.fields: [{name, type}])
 * @param {object} style   -- style from getNodeStyle() (entity style)
 * @param {object} theme   -- full theme
 * @returns {string}       -- SVG fragment
 */
function renderEntityNode(node, style, theme) {
  const { x, y, width, height, label } = node;
  const { headerHeight, fieldRowHeight, cornerRadius: r, padding } = theme.spacing;
  const fields = (node.meta && Array.isArray(node.meta.fields)) ? node.meta.fields : [];

  const lines = [];

  // Outer rounded rect (full body)
  lines.push(
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${r}" ry="${r}" ` +
    `fill="${escapeXml(style.fill)}" stroke="${escapeXml(style.stroke)}" stroke-width="1.5" />`
  );

  // Header band (solid background)
  lines.push(
    `<rect x="${x}" y="${y}" width="${width}" height="${headerHeight}" rx="${r}" ry="${r}" ` +
    `fill="${escapeXml(style.headerFill)}" stroke="${escapeXml(style.stroke)}" stroke-width="1.5" />`
  );
  // Extra rect to square off bottom corners of header
  lines.push(
    `<rect x="${x}" y="${y + headerHeight / 2}" width="${width}" height="${headerHeight / 2}" ` +
    `fill="${escapeXml(style.headerFill)}" stroke="none" />`
  );

  // Header text (entity name, centered, white)
  const headerTextColor = style.headerText || '#FFFFFF';
  lines.push(
    `<text x="${x + width / 2}" y="${y + headerHeight / 2}" ` +
    `text-anchor="middle" dominant-baseline="central" ` +
    `font-family="${escapeXml(theme.font.family)}" font-size="${theme.font.sizeTitle}" ` +
    `font-weight="bold" fill="${escapeXml(headerTextColor)}">${escapeXml(label)}</text>`
  );

  // Divider line between header and body
  lines.push(
    `<line x1="${x}" y1="${y + headerHeight}" x2="${x + width}" y2="${y + headerHeight}" ` +
    `stroke="${escapeXml(style.stroke)}" stroke-width="1" />`
  );

  // Field rows
  fields.forEach((field, i) => {
    const fieldY = y + headerHeight + padding / 2 + (i + 1) * fieldRowHeight - fieldRowHeight / 2;
    const fieldText = `${field.name}: ${field.type}`;
    lines.push(
      `<text x="${x + padding}" y="${fieldY}" ` +
      `text-anchor="start" dominant-baseline="central" ` +
      `font-family="${escapeXml(theme.font.family)}" font-size="${theme.font.sizeBody}" ` +
      `fill="${escapeXml(style.textColor)}">${escapeXml(fieldText)}</text>`
    );
  });

  return `<g class="node node-entity" data-id="${escapeXml(node.id)}">\n    ${lines.join('\n    ')}\n  </g>`;
}

/**
 * Render a single node, choosing entity or standard rendering.
 * @param {object} node   -- LayoutNode
 * @param {object} theme  -- full theme
 * @returns {string}      -- SVG fragment
 */
function renderNode(node, theme) {
  const style = getNodeStyle(theme, node);
  const kind  = (node.meta && (node.meta.kind || node.meta.nodeType)) || 'generic';

  if (kind === 'entity' && node.meta && Array.isArray(node.meta.fields)) {
    return renderEntityNode(node, style, theme);
  }
  return renderStandardNode(node, style, theme);
}

// ---------------------------------------------------------------------------
// Edge rendering
// ---------------------------------------------------------------------------

/**
 * Build a self-loop SVG path using a cubic bezier curve.
 * The loop rises above the node.
 * @param {Array<{x:number, y:number}>} waypoints -- at least 4 waypoints
 * @returns {string} -- SVG <path> d attribute value
 */
function buildSelfLoopPath(waypoints) {
  if (waypoints.length < 4) {
    // Fallback: small cubic loop
    const p = waypoints[0] || { x: 0, y: 0 };
    return `M ${p.x},${p.y} C ${p.x - 30},${p.y - 60} ${p.x + 30},${p.y - 60} ${p.x},${p.y}`;
  }
  const [p0, p1, p2, p3] = waypoints;
  // Cubic bezier: start -> control1 -> control2 -> end
  return `M ${p0.x},${p0.y} L ${p1.x},${p1.y} L ${p2.x},${p2.y} L ${p3.x},${p3.y}`;
}

/**
 * Render a single edge as a <path> or <polyline> with optional label.
 * @param {object} edge   -- LayoutEdge { source, target, waypoints, label, meta }
 * @param {object} theme  -- full theme
 * @returns {string}      -- SVG fragment
 */
function renderEdge(edge, theme) {
  const { waypoints = [], label, meta = {} } = edge;
  const { stroke, strokeWidth, labelColor } = theme.edge;

  const isSelfRef = meta.isSelfRef || edge.source === edge.target;
  const lines = [];

  if (isSelfRef) {
    // Self-referential loop: use a path element with explicit waypoints
    const d = buildSelfLoopPath(waypoints);
    lines.push(
      `<path d="${escapeXml(d)}" ` +
      `fill="none" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" ` +
      `marker-end="url(#arrowhead)" />`
    );
  } else if (waypoints.length >= 2) {
    // Polyline for standard edges
    const pts = waypointsToPoints(waypoints);
    lines.push(
      `<polyline points="${escapeXml(pts)}" ` +
      `fill="none" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" ` +
      `marker-end="url(#arrowhead)" />`
    );
  } else {
    // Degenerate: no waypoints -- render nothing meaningful
    lines.push(`<!-- edge ${escapeXml(edge.source)} -> ${escapeXml(edge.target)}: no waypoints -->`);
  }

  // Optional label at midpoint
  if (label && label.trim()) {
    const mp = midpoint(waypoints);
    lines.push(
      `<text x="${mp.x}" y="${mp.y - 6}" ` +
      `text-anchor="middle" dominant-baseline="auto" ` +
      `font-family="${escapeXml(theme.font.family)}" font-size="${theme.font.sizeLabel}" ` +
      `fill="${escapeXml(labelColor)}">${escapeXml(label)}</text>`
    );
  }

  const edgeClass = isSelfRef ? 'edge edge-selfref' : 'edge';
  const srcAttr   = escapeXml(edge.source);
  const tgtAttr   = escapeXml(edge.target);

  return `<g class="${edgeClass}" data-source="${srcAttr}" data-target="${tgtAttr}">\n    ${lines.join('\n    ')}\n  </g>`;
}

// ---------------------------------------------------------------------------
// Arrowhead marker definition
// ---------------------------------------------------------------------------

/**
 * Generate the <defs> block containing the arrowhead marker.
 * @param {object} theme
 * @returns {string}
 */
function renderDefs(theme) {
  const { stroke, arrowSize } = theme.edge;
  const half = arrowSize / 2;
  return `<defs>
    <marker id="arrowhead" markerWidth="${arrowSize}" markerHeight="${arrowSize}" ` +
    `refX="${arrowSize - 1}" refY="${half}" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,${arrowSize} L${arrowSize},${half} z" fill="${escapeXml(stroke)}" />
    </marker>
  </defs>`;
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Render a LayoutGraph to a self-contained SVG string.
 *
 * @param {object} layoutGraph  -- { nodes, edges, width, height }
 * @param {object} [theme]      -- theme object (defaults to defaultTheme())
 * @returns {string}            -- complete SVG document string
 */
function render(layoutGraph, theme) {
  if (!theme) theme = defaultTheme();

  const nodes  = layoutGraph.nodes  || [];
  const edges  = layoutGraph.edges  || [];

  // Add margin around the diagram
  const MARGIN = 20;
  const width  = (layoutGraph.width  || 0) + MARGIN * 2;
  const height = (layoutGraph.height || 0) + MARGIN * 2;

  // If graph has no nodes, use a minimum canvas size
  const svgWidth  = Math.max(width,  100);
  const svgHeight = Math.max(height, 60);

  const lines = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${svgWidth} ${svgHeight}" ` +
    `width="${svgWidth}" height="${svgHeight}">`
  );

  // Defs (arrowhead)
  lines.push(`  ${renderDefs(theme)}`);

  // Edges group (rendered before nodes so nodes appear on top)
  lines.push('  <g class="edges">');
  for (const edge of edges) {
    lines.push('  ' + renderEdge(edge, theme));
  }
  lines.push('  </g>');

  // Nodes group
  lines.push('  <g class="nodes">');
  for (const node of nodes) {
    lines.push('  ' + renderNode(node, theme));
  }
  lines.push('  </g>');

  lines.push('</svg>');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { render };
