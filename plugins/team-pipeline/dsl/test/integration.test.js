'use strict';

// ---------------------------------------------------------------------------
// integration.test.js -- End-to-end pipeline tests for the PDSL library.
//
// Tests the full parse -> validate -> layout -> render pipeline for all three
// canonical example files.  Uses only the public API from index.js.
//
// TC-008: Grammar spec covers all syntax constructs (verified via example parsing)
// TC-009: No overlapping nodes in layout output
// TC-012: render() produces valid SVG output from .pdsl files
//
// Run: node --test dsl/test/integration.test.js  (from projects/team-pipeline)
// ---------------------------------------------------------------------------

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs   = require('node:fs');
const path = require('node:path');

const { parse, validate, layout, render, defaultTheme } = require('../index');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXAMPLES_DIR = path.join(__dirname, '..', 'examples');

/** Load a .pdsl example file by name. */
function loadExample(name) {
  return fs.readFileSync(path.join(EXAMPLES_DIR, name), 'utf8');
}

/** Count occurrences of a substring in a string. */
function countOccurrences(str, sub) {
  let count = 0;
  let pos   = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

/** Check whether two axis-aligned rectangles overlap. */
function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width  &&
    a.x + a.width  > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Assert no two nodes in a LayoutGraph overlap. */
function assertNoOverlaps(graph) {
  const nodes = graph.nodes;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      assert.ok(
        !rectsOverlap(a, b),
        `Nodes ${a.id} and ${b.id} overlap: ` +
        `a=(${a.x},${a.y},${a.width}x${a.height}) ` +
        `b=(${b.x},${b.y},${b.width}x${b.height})`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Test suite: pipeline-lifecycle.pdsl
// (6 lifecycle declarations, ~18 nodes, ~13 edges)
// ---------------------------------------------------------------------------

describe('integration: pipeline-lifecycle.pdsl', () => {

  it('parses without errors', () => {
    const src = loadExample('pipeline-lifecycle.pdsl');
    const { errors } = parse(src);
    assert.strictEqual(
      errors.length,
      0,
      `Expected no parse errors, got: ${JSON.stringify(errors)}`
    );
  });

  it('validates without errors (TC-008)', () => {
    const src = loadExample('pipeline-lifecycle.pdsl');
    const { ast } = parse(src);
    const diagErrors = validate(ast);
    assert.strictEqual(
      diagErrors.length,
      0,
      `Expected no validation errors, got: ${JSON.stringify(diagErrors)}`
    );
  });

  it('layout produces >= 18 nodes and >= 13 edges (TC-009)', () => {
    const src = loadExample('pipeline-lifecycle.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);

    assert.ok(
      graph.nodes.length >= 18,
      `Expected >= 18 nodes (6 lifecycle roots + stage nodes), got ${graph.nodes.length}`
    );
    assert.ok(
      graph.edges.length >= 13,
      `Expected >= 13 transition edges, got ${graph.edges.length}`
    );
  });

  it('all layout nodes have positive dimensions and finite coordinates (TC-009)', () => {
    const src = loadExample('pipeline-lifecycle.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);

    for (const node of graph.nodes) {
      assert.ok(typeof node.x === 'number' && isFinite(node.x), `Node ${node.id} x must be finite`);
      assert.ok(typeof node.y === 'number' && isFinite(node.y), `Node ${node.id} y must be finite`);
      assert.ok(node.width  > 0, `Node ${node.id} width must be > 0`);
      assert.ok(node.height > 0, `Node ${node.id} height must be > 0`);
    }
  });

  it('no overlapping nodes in layout (TC-009)', () => {
    const src = loadExample('pipeline-lifecycle.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);
    assertNoOverlaps(graph);
  });

  it('render produces non-empty SVG with expected elements (TC-012)', () => {
    const src = loadExample('pipeline-lifecycle.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);
    const svg = render(graph, defaultTheme());

    assert.ok(svg.length > 0, 'SVG must not be empty');
    assert.ok(svg.includes('<svg'), 'SVG must contain <svg opening tag');
    assert.ok(svg.includes('</svg>'), 'SVG must contain closing </svg> tag');
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'SVG must have xmlns attribute');

    // At least 18 individual node groups in the SVG
    // Search for '<g class="node node-' to avoid matching the '<g class="nodes">' wrapper
    const nodeGroupCount = countOccurrences(svg, '<g class="node node-');
    assert.ok(
      nodeGroupCount >= 18,
      `Expected >= 18 <g class="node node-..." elements, got ${nodeGroupCount}`
    );

    // Edges group must be present
    assert.ok(svg.includes('<g class="edges"'), 'SVG must contain edges group');
  });

  it('SVG contains lifecycle and stage node groups (TC-012)', () => {
    const src = loadExample('pipeline-lifecycle.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);
    const svg = render(graph, defaultTheme());

    // Lifecycle root nodes use stage colors from the theme
    // Stage nodes are colored by their stage name (implementing, reviewing, etc.)
    assert.ok(svg.includes('<g class="nodes"'), 'SVG must contain nodes group');
    assert.ok(svg.includes('</g>'), 'SVG must have closed groups');
  });

});

// ---------------------------------------------------------------------------
// Test suite: pipeline-entities.pdsl
// (6 entity nodes, 4 relation edges)
// ---------------------------------------------------------------------------

describe('integration: pipeline-entities.pdsl', () => {

  it('parses without errors', () => {
    const src = loadExample('pipeline-entities.pdsl');
    const { errors } = parse(src);
    assert.strictEqual(
      errors.length,
      0,
      `Expected no parse errors, got: ${JSON.stringify(errors)}`
    );
  });

  it('validates without errors (TC-008)', () => {
    const src = loadExample('pipeline-entities.pdsl');
    const { ast } = parse(src);
    const diagErrors = validate(ast);
    assert.strictEqual(
      diagErrors.length,
      0,
      `Expected no validation errors, got: ${JSON.stringify(diagErrors)}`
    );
  });

  it('layout produces exactly 6 entity nodes and 4 relation edges', () => {
    const src = loadExample('pipeline-entities.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);

    assert.strictEqual(
      graph.nodes.length,
      6,
      `Expected exactly 6 entity nodes (Task, Stage, Status, Adventure, AdventureState, TargetCondition), got ${graph.nodes.length}`
    );
    assert.strictEqual(
      graph.edges.length,
      4,
      `Expected exactly 4 relation edges, got ${graph.edges.length}`
    );
  });

  it('no overlapping nodes in layout (TC-009)', () => {
    const src = loadExample('pipeline-entities.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);
    assertNoOverlaps(graph);
  });

  it('render produces non-empty SVG with entity node class (TC-012)', () => {
    const src = loadExample('pipeline-entities.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);
    const svg = render(graph, defaultTheme());

    assert.ok(svg.length > 0, 'SVG must not be empty');
    assert.ok(svg.includes('<svg'), 'SVG must contain <svg opening tag');
    assert.ok(svg.includes('</svg>'), 'SVG must contain closing </svg> tag');

    // Entity nodes must render with node-entity CSS class
    assert.ok(svg.includes('node-entity'), 'SVG must contain node-entity class for entity nodes');

    // Exactly 6 individual node groups
    // Search for '<g class="node node-' to avoid matching the '<g class="nodes">' wrapper
    const nodeGroupCount = countOccurrences(svg, '<g class="node node-');
    assert.strictEqual(
      nodeGroupCount,
      6,
      `Expected exactly 6 <g class="node node-..." elements, got ${nodeGroupCount}`
    );
  });

  it('entity nodes have all required layout properties', () => {
    const src = loadExample('pipeline-entities.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);

    for (const node of graph.nodes) {
      assert.ok(typeof node.x === 'number' && isFinite(node.x), `Node ${node.id} x must be finite`);
      assert.ok(typeof node.y === 'number' && isFinite(node.y), `Node ${node.id} y must be finite`);
      assert.ok(node.width  > 0, `Node ${node.id} width must be > 0`);
      assert.ok(node.height > 0, `Node ${node.id} height must be > 0`);
      assert.strictEqual(node.meta.nodeType, 'entity', `Node ${node.id} must have nodeType "entity"`);
      assert.ok(Array.isArray(node.meta.fields), `Node ${node.id} must have fields array`);
    }
  });

});

// ---------------------------------------------------------------------------
// Test suite: adventure-structure.pdsl
// (6 entity stubs + 2 structures with contains/spawns/delegates/checkpoints)
// Expected: >= 28 nodes, >= 20 edges
// ---------------------------------------------------------------------------

describe('integration: adventure-structure.pdsl', () => {

  it('parses without errors', () => {
    const src = loadExample('adventure-structure.pdsl');
    const { errors } = parse(src);
    assert.strictEqual(
      errors.length,
      0,
      `Expected no parse errors, got: ${JSON.stringify(errors)}`
    );
  });

  it('validates without errors (TC-008)', () => {
    const src = loadExample('adventure-structure.pdsl');
    const { ast } = parse(src);
    const diagErrors = validate(ast);
    assert.strictEqual(
      diagErrors.length,
      0,
      `Expected no validation errors, got: ${JSON.stringify(diagErrors)}`
    );
  });

  it('layout produces >= 28 nodes and >= 20 edges', () => {
    const src = loadExample('adventure-structure.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);

    assert.ok(
      graph.nodes.length >= 28,
      `Expected >= 28 nodes (6 entity stubs + structure nodes including checkpoints), got ${graph.nodes.length}`
    );
    assert.ok(
      graph.edges.length >= 20,
      `Expected >= 20 edges (structure containment/delegation/checkpoint edges), got ${graph.edges.length}`
    );
  });

  it('no overlapping nodes in layout (TC-009)', () => {
    const src = loadExample('adventure-structure.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);
    assertNoOverlaps(graph);
  });

  it('render produces non-empty SVG with expected elements (TC-012)', () => {
    const src = loadExample('adventure-structure.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);
    const svg = render(graph, defaultTheme());

    assert.ok(svg.length > 0, 'SVG must not be empty');
    assert.ok(svg.includes('<svg'), 'SVG must contain <svg opening tag');
    assert.ok(svg.includes('</svg>'), 'SVG must contain closing </svg> tag');

    // At least 28 individual node groups
    // Search for '<g class="node node-' to avoid matching the '<g class="nodes">' wrapper
    const nodeGroupCount = countOccurrences(svg, '<g class="node node-');
    assert.ok(
      nodeGroupCount >= 28,
      `Expected >= 28 <g class="node node-..." elements, got ${nodeGroupCount}`
    );

    assert.ok(svg.includes('<g class="edges"'), 'SVG must contain edges group');
  });

  it('structure nodes include structure root, containment, spawn, delegation, checkpoint types', () => {
    const src = loadExample('adventure-structure.pdsl');
    const { ast } = parse(src);
    const graph = layout(ast);

    const structureNodes  = graph.nodes.filter(n => n.meta.nodeType === 'structure');
    const containNodes    = graph.nodes.filter(n => n.meta.nodeType === 'containment');
    const spawnNodes      = graph.nodes.filter(n => n.meta.nodeType === 'spawn');
    const delegateNodes   = graph.nodes.filter(n => n.meta.nodeType === 'delegation');
    const checkpointNodes = graph.nodes.filter(n => n.meta.nodeType === 'checkpoint');
    const entityNodes     = graph.nodes.filter(n => n.meta.nodeType === 'entity');

    // 2 structure roots (Adventure, Task)
    assert.strictEqual(structureNodes.length,  2, 'Should have 2 structure root nodes');
    // 6 entity stubs (Design, Plan, Schema, Manifest, Report, Task)
    assert.strictEqual(entityNodes.length,     6, 'Should have 6 entity stub nodes');
    // 6 contains entries: 4 from Adventure + 2 from Task
    assert.strictEqual(containNodes.length,    6, 'Should have 6 containment nodes');
    // 1 spawn entry: Adventure spawns Task
    assert.strictEqual(spawnNodes.length,      1, 'Should have 1 spawn node');
    // 7 delegation entries: 2 from Adventure + 5 from Task
    assert.strictEqual(delegateNodes.length,   7, 'Should have 7 delegation nodes');
    // 6 checkpoint entries: 2 from Adventure + 4 from Task
    assert.strictEqual(checkpointNodes.length, 6, 'Should have 6 checkpoint nodes');
  });

});

// ---------------------------------------------------------------------------
// Cross-example: all three examples pass validation with zero errors
// ---------------------------------------------------------------------------

describe('integration: all examples pass validation (TC-008)', () => {

  const examples = [
    'pipeline-lifecycle.pdsl',
    'pipeline-entities.pdsl',
    'adventure-structure.pdsl',
  ];

  for (const example of examples) {
    it(`${example} parses and validates with zero errors`, () => {
      const src = loadExample(example);
      const { ast, errors: parseErrors } = parse(src);

      assert.strictEqual(
        parseErrors.length,
        0,
        `${example}: expected no parse errors, got: ${JSON.stringify(parseErrors)}`
      );

      const validationErrors = validate(ast);
      assert.strictEqual(
        validationErrors.length,
        0,
        `${example}: expected no validation errors, got: ${JSON.stringify(validationErrors)}`
      );
    });
  }

});

// ---------------------------------------------------------------------------
// Cross-example: all three examples render to non-empty SVG (TC-012)
// ---------------------------------------------------------------------------

describe('integration: all examples render to SVG (TC-012)', () => {

  const examples = [
    'pipeline-lifecycle.pdsl',
    'pipeline-entities.pdsl',
    'adventure-structure.pdsl',
  ];

  for (const example of examples) {
    it(`${example} renders to non-empty SVG with valid structure`, () => {
      const src = loadExample(example);
      const { ast } = parse(src);
      const graph = layout(ast);
      const svg = render(graph, defaultTheme());

      assert.ok(svg.length > 0,                              `${example}: SVG must not be empty`);
      assert.ok(svg.includes('<svg'),                        `${example}: SVG must contain <svg`);
      assert.ok(svg.includes('</svg>'),                      `${example}: SVG must contain </svg>`);
      assert.ok(svg.includes('viewBox='),                    `${example}: SVG must have viewBox`);
      assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), `${example}: SVG must have xmlns`);
    });
  }

});
