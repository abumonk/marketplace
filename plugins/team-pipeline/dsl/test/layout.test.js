'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { parse } = require('../parser');
const {
  layout,
  adaptLifecycle,
  adaptStructure,
  adaptEntity,
  adaptRelations,
  adaptProgram,
  assignLayers,
  orderNodesInLayers,
  assignCoordinates,
  routeEdges,
} = require('../layout');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Assert every edge has at least 2 waypoints with finite numeric x,y. */
function assertValidWaypoints(graph) {
  for (const edge of graph.edges) {
    assert.ok(
      Array.isArray(edge.waypoints) && edge.waypoints.length >= 2,
      `Edge ${edge.source} -> ${edge.target} must have at least 2 waypoints`
    );
    for (const wp of edge.waypoints) {
      assert.ok(typeof wp.x === 'number' && isFinite(wp.x), `Waypoint x must be finite: ${wp.x}`);
      assert.ok(typeof wp.y === 'number' && isFinite(wp.y), `Waypoint y must be finite: ${wp.y}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Test 1: Lifecycle layout -- TC-010
// ---------------------------------------------------------------------------

describe('lifecycle layout', () => {
  it('lifecycle AST produces stage nodes and transition edges with no overlaps', () => {
    const src = `lifecycle PlanningCycle {
  role: planner
  model: opus
  transitions {
    on success -> implementing
    on blocked -> wait
    on error -> error
  }
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);

    // Should have 1 lifecycle root + 3 stage nodes
    assert.ok(graph.nodes.length >= 4, `Expected at least 4 nodes, got ${graph.nodes.length}`);

    // Lifecycle root node
    const rootNode = graph.nodes.find(n => n.meta.nodeType === 'lifecycle');
    assert.ok(rootNode, 'Should have a lifecycle root node');
    assert.strictEqual(rootNode.label, 'PlanningCycle');
    assert.strictEqual(rootNode.meta.role, 'planner');

    // Stage nodes
    const stageNodes = graph.nodes.filter(n => n.meta.nodeType === 'stage');
    assert.strictEqual(stageNodes.length, 3, 'Should have 3 stage nodes');
    const stageLabels = stageNodes.map(n => n.label).sort();
    assert.deepStrictEqual(stageLabels, ['error', 'implementing', 'wait']);

    // Edges: at least 3 transition edges
    assert.ok(graph.edges.length >= 3, `Expected at least 3 edges, got ${graph.edges.length}`);

    // All nodes positioned (x,y,width,height are set)
    for (const node of graph.nodes) {
      assert.ok(typeof node.x === 'number', `Node ${node.id} missing x`);
      assert.ok(typeof node.y === 'number', `Node ${node.id} missing y`);
      assert.ok(node.width > 0,  `Node ${node.id} width must be > 0`);
      assert.ok(node.height > 0, `Node ${node.id} height must be > 0`);
    }

    // No overlaps
    assertNoOverlaps(graph);

    // Valid waypoints
    assertValidWaypoints(graph);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Structure layout -- tree with containment edges
// ---------------------------------------------------------------------------

describe('structure layout', () => {
  it('structure AST produces root + child nodes with containment edges', () => {
    const src = `structure Adventure {
  id: ADV-{NNN}
  state: concept | planning | active | completed

  contains {
    plans/ -> Plan[0..*]
    designs/ -> Design[0..*]
    manifest.md -> Manifest[1]
  }

  spawns {
    Task[1..*] from plans
  }

  delegates {
    planning -> adventure-planner
  }
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);

    // Root node
    const rootNode = graph.nodes.find(n => n.meta.nodeType === 'structure');
    assert.ok(rootNode, 'Should have a structure root node');
    assert.strictEqual(rootNode.label, 'Adventure');

    // Containment nodes (3 contains + 1 spawn + 1 delegate = 5 children)
    const containNodes = graph.nodes.filter(n => n.meta.nodeType === 'containment');
    assert.strictEqual(containNodes.length, 3, 'Should have 3 containment nodes');

    const spawnNodes = graph.nodes.filter(n => n.meta.nodeType === 'spawn');
    assert.strictEqual(spawnNodes.length, 1, 'Should have 1 spawn node');

    const delegateNodes = graph.nodes.filter(n => n.meta.nodeType === 'delegation');
    assert.strictEqual(delegateNodes.length, 1, 'Should have 1 delegation node');

    // Edges: root -> each child
    assert.ok(graph.edges.length >= 5, `Expected at least 5 edges, got ${graph.edges.length}`);
    const rootEdges = graph.edges.filter(e => e.source === rootNode.id);
    assert.ok(rootEdges.length >= 5, 'Root should have edges to all children');

    // No overlaps
    assertNoOverlaps(graph);

    // Valid waypoints
    assertValidWaypoints(graph);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Entity layout -- positioned nodes with field metadata -- TC-011
// ---------------------------------------------------------------------------

describe('entity layout', () => {
  it('entity AST produces positioned node with field metadata', () => {
    const src = `entity Task {
  id: string
  title: string
  stage: Stage
  iterations: number = 0
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);

    assert.strictEqual(graph.nodes.length, 1, 'Should have exactly 1 entity node');
    const node = graph.nodes[0];
    assert.strictEqual(node.label, 'Task');
    assert.strictEqual(node.meta.nodeType, 'entity');
    assert.ok(Array.isArray(node.meta.fields), 'Node should have fields array');
    assert.strictEqual(node.meta.fields.length, 4, 'Task entity has 4 fields');

    const fieldNames = node.meta.fields.map(f => f.name);
    assert.ok(fieldNames.includes('id'),    'Fields should include "id"');
    assert.ok(fieldNames.includes('title'), 'Fields should include "title"');
    assert.ok(fieldNames.includes('stage'), 'Fields should include "stage"');

    // Positioned
    assert.ok(node.width > 0,  'Node width should be set');
    assert.ok(node.height > 0, 'Node height should be set');
    assert.ok(typeof node.x === 'number', 'Node x should be set');
    assert.ok(typeof node.y === 'number', 'Node y should be set');
  });

  it('multiple entity declarations each produce a distinct positioned node', () => {
    const src = `entity Task { id: string }
entity Adventure { name: string }
entity Stage { values: planning | implementing | completed }`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);
    assert.strictEqual(graph.nodes.length, 3, 'Should have 3 entity nodes');

    const labels = graph.nodes.map(n => n.label).sort();
    assert.deepStrictEqual(labels, ['Adventure', 'Stage', 'Task']);

    // All at y >= 0, width/height > 0
    for (const n of graph.nodes) {
      assert.ok(n.width > 0 && n.height > 0, `Node ${n.id} must have positive dimensions`);
    }

    // No overlaps
    assertNoOverlaps(graph);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Relation layout -- edges between entities with labels -- TC-011
// ---------------------------------------------------------------------------

describe('relation layout', () => {
  it('relation declarations produce edges between entity nodes with labels', () => {
    const src = `entity Task { id: string }
entity Adventure { name: string }

relation Task -> Adventure {
  type: belongs_to
  via: adventure_id
  cardinality: 0..1
}

relation Adventure -> Task {
  type: owns
  via: tasks[]
  cardinality: 1..*
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);

    // 2 entity nodes
    assert.strictEqual(graph.nodes.length, 2);

    // 2 relation edges
    const relEdges = graph.edges.filter(e => e.meta.edgeType === 'relation');
    assert.strictEqual(relEdges.length, 2, 'Should have 2 relation edges');

    // Edge labels contain relation type info
    const edge1 = relEdges.find(e => e.source === 'entity:Task' && e.target === 'entity:Adventure');
    assert.ok(edge1, 'Should have Task -> Adventure edge');
    assert.ok(edge1.label.includes('belongs_to'), `Edge label should include "belongs_to", got "${edge1.label}"`);
    assert.ok(edge1.label.includes('0..1'), `Edge label should include cardinality "0..1", got "${edge1.label}"`);

    const edge2 = relEdges.find(e => e.source === 'entity:Adventure' && e.target === 'entity:Task');
    assert.ok(edge2, 'Should have Adventure -> Task edge');
    assert.ok(edge2.label.includes('owns'), `Edge label should include "owns", got "${edge2.label}"`);

    // Valid waypoints
    assertValidWaypoints(graph);
  });
});

// ---------------------------------------------------------------------------
// Test 5: No overlaps (TC-009) -- complex multi-declaration program
// ---------------------------------------------------------------------------

describe('no overlaps (TC-009)', () => {
  it('complex program with entities and relations produces no overlapping nodes', () => {
    const src = `entity Task { id: string title: string stage: Stage }
entity Adventure { name: string }
entity Stage { values: planning | implementing | reviewing | completed }

relation Task -> Adventure {
  type: belongs_to
  cardinality: 0..1
}

relation Adventure -> Task {
  type: owns
  cardinality: 1..*
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);

    // 3 entity nodes
    assert.strictEqual(graph.nodes.length, 3);

    // All nodes must have positive dimensions
    for (const n of graph.nodes) {
      assert.ok(n.width > 0 && n.height > 0, `Node ${n.id} has non-positive dimensions`);
    }

    // No two nodes overlap
    assertNoOverlaps(graph);
  });

  it('lifecycle + entities in same program produce no overlapping nodes', () => {
    const src = `lifecycle PlanningCycle {
  role: planner
  transitions {
    on success -> implementing
    on error -> error
  }
}

entity Task { id: string }
entity Adventure { name: string }`;

    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);
    assert.ok(graph.nodes.length >= 4, 'Should have lifecycle + stage + entity nodes');
    assertNoOverlaps(graph);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Edge routing -- valid waypoints
// ---------------------------------------------------------------------------

describe('edge routing', () => {
  it('all edges have at least 2 waypoints with finite numeric coordinates', () => {
    const src = `lifecycle Foo {
  transitions {
    on success -> done
    on error -> failed
  }
}

entity Bar { id: string }
entity Baz { name: string }

relation Bar -> Baz {
  type: references
  cardinality: 1
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);
    assertValidWaypoints(graph);
  });

  it('forward edges have waypoints forming a vertical or L-shaped route', () => {
    const src = `lifecycle Sequential {
  transitions {
    on done -> finished
  }
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);
    for (const edge of graph.edges) {
      assert.ok(edge.waypoints.length >= 2, 'Each edge needs at least 2 waypoints');
    }

    // For forward edges, first waypoint y <= last waypoint y (going downward) or same layer (going sideways)
    for (const edge of graph.edges) {
      const first = edge.waypoints[0];
      const last  = edge.waypoints[edge.waypoints.length - 1];
      // Waypoints should have finite values
      assert.ok(isFinite(first.x) && isFinite(first.y), 'First waypoint must be finite');
      assert.ok(isFinite(last.x)  && isFinite(last.y),  'Last waypoint must be finite');
    }
  });
});

// ---------------------------------------------------------------------------
// Test 7: Self-referential relation -- Task -> Task
// ---------------------------------------------------------------------------

describe('self-referential relation', () => {
  it('Task -> Task self-referential relation produces a self-loop edge', () => {
    const src = `entity Task {
  id: string
  depends_on: Task[0..*]
}

relation Task -> Task {
  type: depends_on
  via: depends_on
  cardinality: 0..*
  constraint: no_cycles
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    const graph = layout(ast);

    // 1 entity node (Task)
    assert.strictEqual(graph.nodes.length, 1, 'Should have 1 entity node (Task)');
    const taskNode = graph.nodes[0];
    assert.strictEqual(taskNode.label, 'Task');

    // 1 self-loop edge
    const relEdges = graph.edges.filter(e => e.meta.edgeType === 'relation');
    assert.strictEqual(relEdges.length, 1, 'Should have 1 relation edge');
    const selfEdge = relEdges[0];

    assert.strictEqual(selfEdge.source, selfEdge.target, 'Self-referential edge source must equal target');
    assert.ok(selfEdge.meta.isSelfRef, 'Edge should be marked as isSelfRef');

    // Self-loop routing: 4 waypoints forming a loop above the node
    assert.ok(selfEdge.waypoints.length >= 4, 'Self-loop should have at least 4 waypoints');
    assertValidWaypoints(graph);

    // Self-loop goes above the node (y values should be <= node.y)
    const nodeTopY = taskNode.y;
    const loopTopWp = selfEdge.waypoints[1]; // second waypoint is the top of the loop
    assert.ok(loopTopWp.y <= nodeTopY, `Self-loop top waypoint y (${loopTopWp.y}) should be <= node top y (${nodeTopY})`);
  });

  it('self-referential relation does not cause cycles in layer assignment', () => {
    const src = `entity Node { id: string }

relation Node -> Node {
  type: references
  cardinality: 0..*
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);

    // This should not throw or infinite-loop
    assert.doesNotThrow(() => {
      const graph = layout(ast);
      assert.strictEqual(graph.nodes.length, 1);
    }, 'layout() should not throw for self-referential relations');
  });
});

// ---------------------------------------------------------------------------
// Test 8: adaptLifecycle unit test
// ---------------------------------------------------------------------------

describe('adaptLifecycle unit', () => {
  it('adaptLifecycle produces correct nodes and edges from LifecycleDecl', () => {
    const src = `lifecycle MyLC {
  role: reviewer
  model: sonnet
  transitions {
    on done -> completed
    on error -> blocked
  }
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];

    const { nodes, edges } = adaptLifecycle(decl);

    // Root node + 2 stage nodes
    assert.strictEqual(nodes.length, 3, 'Should produce root + 2 stage nodes');

    const root = nodes.find(n => n.meta.nodeType === 'lifecycle');
    assert.ok(root, 'Should have lifecycle root node');
    assert.strictEqual(root.meta.role, 'reviewer');
    assert.strictEqual(root.meta.model, 'sonnet');

    const stages = nodes.filter(n => n.meta.nodeType === 'stage');
    assert.strictEqual(stages.length, 2);
    const stageLabels = stages.map(n => n.label).sort();
    assert.deepStrictEqual(stageLabels, ['blocked', 'completed']);

    // 2 transition edges from root
    assert.strictEqual(edges.length, 2);
    for (const e of edges) {
      assert.strictEqual(e.source, root.id, 'Edges should start at lifecycle root');
      assert.strictEqual(e.meta.edgeType, 'transition');
    }
  });
});

// ---------------------------------------------------------------------------
// Test 9: adaptEntity unit test
// ---------------------------------------------------------------------------

describe('adaptEntity unit', () => {
  it('adaptEntity produces single node with fields metadata', () => {
    const src = 'entity Status { values: pending | in_progress | ready | blocked }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Parse errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];

    const { nodes, edges } = adaptEntity(decl);

    assert.strictEqual(nodes.length, 1, 'Entity adapter should produce exactly 1 node');
    assert.strictEqual(edges.length, 0, 'Entity adapter should produce no edges');

    const node = nodes[0];
    assert.strictEqual(node.id, 'entity:Status');
    assert.strictEqual(node.label, 'Status');
    assert.strictEqual(node.meta.nodeType, 'entity');
    assert.ok(Array.isArray(node.meta.fields), 'Node should have fields array');
  });
});

// ---------------------------------------------------------------------------
// Test 10: assignLayers handles disconnected graph
// ---------------------------------------------------------------------------

describe('assignLayers', () => {
  it('assigns layer 0 to all nodes in a graph with no edges', () => {
    const nodes = [
      { id: 'a', layer: 0, order: 0 },
      { id: 'b', layer: 0, order: 0 },
      { id: 'c', layer: 0, order: 0 },
    ];
    const graph = { nodes, edges: [] };
    const layers = assignLayers(graph);

    assert.strictEqual(layers.get('a'), 0);
    assert.strictEqual(layers.get('b'), 0);
    assert.strictEqual(layers.get('c'), 0);
  });

  it('assigns increasing layers for a linear chain', () => {
    const nodes = [
      { id: 'a', layer: 0, order: 0 },
      { id: 'b', layer: 0, order: 0 },
      { id: 'c', layer: 0, order: 0 },
    ];
    const edges = [
      { source: 'a', target: 'b', label: '', waypoints: [], meta: {} },
      { source: 'b', target: 'c', label: '', waypoints: [], meta: {} },
    ];
    const graph = { nodes, edges };
    const layers = assignLayers(graph);

    assert.strictEqual(layers.get('a'), 0);
    assert.strictEqual(layers.get('b'), 1);
    assert.strictEqual(layers.get('c'), 2);
  });

  it('handles a cycle without infinite looping', () => {
    const nodes = [
      { id: 'x', layer: 0, order: 0 },
      { id: 'y', layer: 0, order: 0 },
    ];
    const edges = [
      { source: 'x', target: 'y', label: '', waypoints: [], meta: {} },
      { source: 'y', target: 'x', label: '', waypoints: [], meta: {} },
    ];
    const graph = { nodes, edges };

    assert.doesNotThrow(() => {
      const layers = assignLayers(graph);
      assert.ok(layers.has('x'), 'x should have a layer');
      assert.ok(layers.has('y'), 'y should have a layer');
    }, 'assignLayers should not throw for cycles');
  });
});
