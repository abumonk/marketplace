'use strict';

// ---------------------------------------------------------------------------
// renderer.test.js -- Tests for dsl/renderer.js and dsl/themes.js
//
// Tests construct LayoutGraph objects manually -- no dependency on layout.js.
// Run: node --test dsl/test/renderer.test.js  (from projects/team-pipeline)
// ---------------------------------------------------------------------------

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { render } = require('../renderer');
const { defaultTheme, createTheme, getNodeStyle } = require('../themes');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal LayoutNode.
 */
function makeNode({ id, label, x = 10, y = 10, width = 120, height = 40, meta = {} }) {
  return { id, label, x, y, width, height, layer: 0, order: 0, meta };
}

/**
 * Build a minimal LayoutEdge.
 */
function makeEdge({ source, target, label = '', waypoints, meta = {} }) {
  const wp = waypoints || [
    { x: 70,  y: 50 },
    { x: 70,  y: 100 },
  ];
  return { source, target, label, waypoints: wp, meta };
}

/**
 * Build a minimal LayoutGraph.
 */
function makeGraph(nodes, edges = []) {
  let width = 0;
  let height = 0;
  for (const n of nodes) {
    const r = n.x + n.width;
    const b = n.y + n.height;
    if (r > width)  width  = r;
    if (b > height) height = b;
  }
  return { nodes, edges, width, height };
}

/**
 * Count occurrences of a substring in a string.
 */
function countOccurrences(str, sub) {
  let count = 0;
  let pos   = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Test 1: Basic SVG structure
// ---------------------------------------------------------------------------

describe('basic SVG structure', () => {
  it('renders a single-node graph with valid SVG', () => {
    const node = makeNode({ id: 'n1', label: 'MyNode', meta: { kind: 'generic' } });
    const graph = makeGraph([node]);
    const svg = render(graph);

    // Must start with the <svg tag
    assert.ok(svg.includes('<svg'), 'output must contain <svg');
    // Must have xmlns
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'must have SVG xmlns');
    // Must have viewBox
    assert.ok(svg.includes('viewBox='), 'must have viewBox attribute');
    // Must close the svg tag
    assert.ok(svg.includes('</svg>'), 'must have closing </svg>');
    // Must contain exactly 1 <rect element for the node body
    const rectCount = countOccurrences(svg, '<rect ');
    assert.ok(rectCount >= 1, `must have at least 1 <rect, got ${rectCount}`);
    // Must contain <defs for arrowhead
    assert.ok(svg.includes('<defs>'), 'must have <defs> block');
    // Must contain the arrowhead marker
    assert.ok(svg.includes('id="arrowhead"'), 'must define arrowhead marker');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Lifecycle diagram (TC-010) -- stage nodes + transition edges
// ---------------------------------------------------------------------------

describe('lifecycle diagram', () => {
  it('renders stage nodes and directed transition edges with arrowheads', () => {
    const n1 = makeNode({ id: 'planning',      label: 'planning',      x: 10,  y: 10,  meta: { kind: 'planning'      } });
    const n2 = makeNode({ id: 'implementing',  label: 'implementing',  x: 160, y: 10,  meta: { kind: 'implementing'  } });
    const n3 = makeNode({ id: 'reviewing',     label: 'reviewing',     x: 310, y: 10,  meta: { kind: 'reviewing'     } });

    const e1 = makeEdge({
      source: 'planning',
      target: 'implementing',
      label:  'on success',
      waypoints: [{ x: 70, y: 50 }, { x: 70, y: 80 }, { x: 220, y: 80 }, { x: 220, y: 50 }],
    });
    const e2 = makeEdge({
      source: 'implementing',
      target: 'reviewing',
      label:  'on done',
      waypoints: [{ x: 220, y: 50 }, { x: 220, y: 80 }, { x: 370, y: 80 }, { x: 370, y: 50 }],
    });

    const graph = makeGraph([n1, n2, n3], [e1, e2]);
    const svg   = render(graph);

    // 3 rect elements (one per stage node)
    const rectCount = countOccurrences(svg, '<rect ');
    assert.ok(rectCount >= 3, `expected >= 3 <rect elements, got ${rectCount}`);

    // 2 polyline elements (one per edge)
    const polylineCount = countOccurrences(svg, '<polyline ');
    assert.strictEqual(polylineCount, 2, `expected 2 <polyline elements, got ${polylineCount}`);

    // Arrowhead marker defined in defs
    assert.ok(svg.includes('id="arrowhead"'), 'arrowhead marker must be defined');

    // Arrowhead marker referenced on edges
    const arrowRefCount = countOccurrences(svg, 'marker-end="url(#arrowhead)"');
    assert.ok(arrowRefCount >= 2, `expected marker-end on at least 2 edges, got ${arrowRefCount}`);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Entity node with fields (TC-011 partial)
// ---------------------------------------------------------------------------

describe('entity node with fields', () => {
  it('renders entity node showing field names and types', () => {
    const fields = [
      { name: 'id',    type: 'string' },
      { name: 'title', type: 'string' },
    ];
    const node = makeNode({
      id:     'entity:Task',
      label:  'Task',
      height: 80,
      meta:   { kind: 'entity', nodeType: 'entity', fields },
    });
    const graph = makeGraph([node]);
    const svg   = render(graph);

    // Entity field text must appear in output
    assert.ok(svg.includes('id: string'),    'must render "id: string" field');
    assert.ok(svg.includes('title: string'), 'must render "title: string" field');

    // Must have a header band (at least 2 rects for the entity box)
    const rectCount = countOccurrences(svg, '<rect ');
    assert.ok(rectCount >= 2, `entity node must have at least 2 rects (body + header), got ${rectCount}`);

    // Node class indicates entity type
    assert.ok(svg.includes('node-entity'), 'must have node-entity CSS class');
  });
});

// ---------------------------------------------------------------------------
// Test 4: Edge with cardinality label (TC-011)
// ---------------------------------------------------------------------------

describe('edge with cardinality label', () => {
  it('renders cardinality text near the edge midpoint', () => {
    const n1 = makeNode({ id: 'entity:Task',      label: 'Task',      x: 10,  y: 10, meta: { kind: 'entity', nodeType: 'entity', fields: [] } });
    const n2 = makeNode({ id: 'entity:Adventure', label: 'Adventure', x: 200, y: 10, meta: { kind: 'entity', nodeType: 'entity', fields: [] } });

    const e = makeEdge({
      source:    'entity:Task',
      target:    'entity:Adventure',
      label:     '1..*',
      waypoints: [{ x: 130, y: 30 }, { x: 200, y: 30 }],
    });

    const graph = makeGraph([n1, n2], [e]);
    const svg   = render(graph);

    // Cardinality label text must appear in SVG
    assert.ok(svg.includes('1..*'), 'must render "1..*" cardinality label');

    // Must have a <text element for the label
    const textCount = countOccurrences(svg, '<text ');
    assert.ok(textCount >= 1, 'must have at least one <text element for the label');
  });
});

// ---------------------------------------------------------------------------
// Test 5: Theme stage colors applied correctly
// ---------------------------------------------------------------------------

describe('theme stage colors', () => {
  it('applies planning stage fill color to planning node rect', () => {
    const node = makeNode({
      id:    'n1',
      label: 'Planning',
      meta:  { kind: 'planning' },
    });
    const graph  = makeGraph([node]);
    const theme  = defaultTheme();
    const svg    = render(graph, theme);

    // The planning stage fill should appear in the SVG
    const planningFill = theme.stages.planning.fill; // '#E3F2FD'
    assert.ok(svg.includes(planningFill), `SVG must contain planning fill color ${planningFill}`);
  });

  it('each stage color is distinct in the theme', () => {
    const theme  = defaultTheme();
    const stages = Object.keys(theme.stages);
    const fills  = stages.map(s => theme.stages[s].fill);
    const unique = new Set(fills);
    assert.strictEqual(unique.size, stages.length, 'all stage fill colors must be distinct');
  });
});

// ---------------------------------------------------------------------------
// Test 6: Multiple node types in single SVG
// ---------------------------------------------------------------------------

describe('multiple node types', () => {
  it('renders mixed stage nodes and entity node correctly', () => {
    const fields = [{ name: 'id', type: 'string' }];
    const n1 = makeNode({ id: 'planning',     label: 'planning',  x: 10,  y: 10,  meta: { kind: 'planning'  } });
    const n2 = makeNode({ id: 'implementing', label: 'implementing', x: 160, y: 10, meta: { kind: 'implementing' } });
    const n3 = makeNode({
      id:     'entity:Task',
      label:  'Task',
      x:      310, y: 10,
      height: 70,
      meta:   { kind: 'entity', nodeType: 'entity', fields },
    });

    const e1 = makeEdge({
      source: 'planning',
      target: 'implementing',
      waypoints: [{ x: 70, y: 50 }, { x: 220, y: 50 }],
    });
    const e2 = makeEdge({
      source: 'implementing',
      target: 'entity:Task',
      waypoints: [{ x: 220, y: 50 }, { x: 370, y: 50 }],
    });

    const graph = makeGraph([n1, n2, n3], [e1, e2]);
    const svg   = render(graph);

    // 2 standard nodes + at least 2 rects for entity node = at least 4 rects total
    const rectCount = countOccurrences(svg, '<rect ');
    assert.ok(rectCount >= 4, `expected >= 4 <rect elements for mixed graph, got ${rectCount}`);

    // 2 edges rendered as polylines
    const polylineCount = countOccurrences(svg, '<polyline ');
    assert.strictEqual(polylineCount, 2, `expected 2 polylines for 2 edges, got ${polylineCount}`);

    // Entity field text present
    assert.ok(svg.includes('id: string'), 'entity field text must be present');

    // Stage fill colors present
    const theme = defaultTheme();
    assert.ok(svg.includes(theme.stages.planning.fill),      'planning fill must be present');
    assert.ok(svg.includes(theme.stages.implementing.fill),  'implementing fill must be present');
  });
});

// ---------------------------------------------------------------------------
// Test 7: Custom theme override via createTheme
// ---------------------------------------------------------------------------

describe('custom theme override', () => {
  it('createTheme with custom planning fill renders correct color', () => {
    const customTheme = createTheme({ stages: { planning: { fill: '#FF0000' } } });
    const node = makeNode({ id: 'n1', label: 'Plan', meta: { kind: 'planning' } });
    const graph = makeGraph([node]);
    const svg   = render(graph, customTheme);

    assert.ok(svg.includes('#FF0000'), 'custom planning fill #FF0000 must appear in SVG');
    // Default planning fill should NOT appear (it was overridden)
    const defaultFill = defaultTheme().stages.planning.fill; // '#E3F2FD'
    assert.ok(!svg.includes(defaultFill), `default fill ${defaultFill} must not appear when overridden`);
  });

  it('createTheme preserves non-overridden stage colors', () => {
    const customTheme = createTheme({ stages: { planning: { fill: '#FF0000' } } });
    const implementingFill = defaultTheme().stages.implementing.fill;
    assert.strictEqual(
      customTheme.stages.implementing.fill,
      implementingFill,
      'non-overridden stages must keep default colors'
    );
  });

  it('getNodeStyle resolves entity style for entity nodes', () => {
    const theme = defaultTheme();
    const node  = makeNode({ id: 'e1', label: 'Foo', meta: { kind: 'entity' } });
    const style = getNodeStyle(theme, node);
    assert.strictEqual(style, theme.entity, 'entity node must use entity style');
  });

  it('getNodeStyle falls back to generic for unknown kind', () => {
    const theme = defaultTheme();
    const node  = makeNode({ id: 'x1', label: 'Unknown', meta: { kind: 'something_else' } });
    const style = getNodeStyle(theme, node);
    assert.strictEqual(style, theme.generic, 'unknown kind must use generic style');
  });
});

// ---------------------------------------------------------------------------
// Test 8: Self-referential edge rendering
// ---------------------------------------------------------------------------

describe('self-referential edge', () => {
  it('renders a self-loop edge as a valid path element', () => {
    const node = makeNode({
      id:     'entity:Task',
      label:  'Task',
      x:      60, y: 80,
      height: 60,
      meta:   { kind: 'entity', nodeType: 'entity', fields: [] },
    });

    const selfEdge = makeEdge({
      source: 'entity:Task',
      target: 'entity:Task',
      label:  '0..*',
      waypoints: [
        { x: 100, y: 80  },
        { x: 100, y: 40  },
        { x: 140, y: 40  },
        { x: 140, y: 80  },
      ],
      meta: { isSelfRef: true, edgeType: 'relation' },
    });

    const graph = makeGraph([node], [selfEdge]);
    const svg   = render(graph);

    // Self-loop uses <path> not <polyline>
    assert.ok(svg.includes('<path d='), 'self-loop must render as <path>');
    assert.ok(!svg.includes('<polyline'), 'self-loop must not render as <polyline>');

    // Path must not be degenerate -- should have M and L commands
    assert.ok(svg.includes('M '), 'path must contain M (moveto) command');
    assert.ok(svg.includes(' L '), 'path must contain L (lineto) commands');

    // Cardinality label present
    assert.ok(svg.includes('0..*'), 'self-loop cardinality label must appear');

    // Arrowhead applied
    assert.ok(svg.includes('marker-end="url(#arrowhead)"'), 'self-loop must have arrowhead');

    // Must have edge-selfref class
    assert.ok(svg.includes('edge-selfref'), 'self-loop must have edge-selfref CSS class');
  });

  it('renders self-loop even when meta.isSelfRef is absent but source === target', () => {
    const node = makeNode({ id: 'n1', label: 'Loop', x: 10, y: 10, meta: { kind: 'generic' } });
    const edge = makeEdge({
      source: 'n1',
      target: 'n1',
      label:  '',
      waypoints: [
        { x: 50, y: 10 },
        { x: 50, y: -20 },
        { x: 80, y: -20 },
        { x: 80, y: 10 },
      ],
      meta: {},
    });
    const graph = makeGraph([node], [edge]);
    const svg   = render(graph);

    // Should still detect self-loop (source === target)
    assert.ok(svg.includes('<path d='), 'same source/target edge must be rendered as path');
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('renders empty graph without errors', () => {
    const graph = makeGraph([]);
    const svg   = render(graph);
    assert.ok(svg.includes('<svg'), 'empty graph still renders SVG wrapper');
    assert.ok(svg.includes('</svg>'), 'empty graph SVG must close');
  });

  it('renders all 6 pipeline stages', () => {
    const stages = ['planning', 'implementing', 'reviewing', 'fixing', 'completed', 'researching'];
    const theme  = defaultTheme();
    const nodes  = stages.map((s, i) =>
      makeNode({ id: s, label: s, x: i * 160, y: 10, meta: { kind: s } })
    );
    const graph = makeGraph(nodes);
    const svg   = render(graph, theme);

    for (const stage of stages) {
      const fill = theme.stages[stage].fill;
      assert.ok(svg.includes(fill), `fill for stage "${stage}" must appear in SVG`);
    }
  });
});
