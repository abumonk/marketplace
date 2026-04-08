'use strict';

// ---------------------------------------------------------------------------
// layout.js -- PDSL Layout Engine
//
// Converts a parsed PDSL AST (Program node) into a LayoutGraph:
// positioned nodes (x, y, width, height) and routed edges (waypoints).
//
// Pipeline:
//   1. adaptProgram(ast)           -- AST -> intermediate graph
//   2. assignLayers(graph)         -- topological sort -> layer numbers
//   3. orderNodesInLayers(...)     -- barycenter heuristic
//   4. assignCoordinates(...)      -- fixed-spacing x,y placement
//   5. routeEdges(graph)           -- orthogonal waypoints
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = {
  nodeWidth:    120,
  nodeHeight:   40,
  layerSpacing: 80,
  nodeSpacing:  40,
};

// ---------------------------------------------------------------------------
// Factory functions -- plain objects, no classes
// ---------------------------------------------------------------------------

/**
 * Create a layout node.
 * @param {string} id
 * @param {string} label
 * @param {object} meta  -- arbitrary extra data (nodeType, fields, etc.)
 */
function createLayoutNode(id, label, meta = {}) {
  return {
    id,
    label,
    x:      0,
    y:      0,
    width:  0,
    height: 0,
    layer:  0,
    order:  0,
    meta,
  };
}

/**
 * Create a layout edge.
 * @param {string}   source  -- source node id
 * @param {string}   target  -- target node id
 * @param {string}   label   -- display label (relation type / event name)
 * @param {object}   meta    -- edgeType, cardinality, isFeedback, etc.
 */
function createLayoutEdge(source, target, label = '', meta = {}) {
  return {
    source,
    target,
    label,
    waypoints: [],
    meta,
  };
}

/**
 * Create the final LayoutGraph.
 * Width and height are computed from the positioned nodes.
 */
function createLayoutGraph(nodes, edges) {
  let width = 0;
  let height = 0;
  for (const n of nodes) {
    const right  = n.x + n.width;
    const bottom = n.y + n.height;
    if (right  > width)  width  = right;
    if (bottom > height) height = bottom;
  }
  return { nodes, edges, width, height };
}

// ---------------------------------------------------------------------------
// AST-to-graph adapters
// ---------------------------------------------------------------------------

/**
 * adaptLifecycle -- Lifecycle AST -> partial graph (nodes + edges).
 *
 * Creates one entry-point node for the lifecycle itself, plus one node for
 * each transition target stage.  Edges model event -> target stage.
 */
function adaptLifecycle(decl) {
  const nodes = [];
  const edges = [];

  // Root node for the lifecycle (entry point)
  const rootId = `lifecycle:${decl.name}`;
  nodes.push(createLayoutNode(rootId, decl.name, {
    nodeType: 'lifecycle',
    role:     decl.role  || null,
    model:    decl.model || null,
  }));

  // Collect unique stage names from transitions
  const stagesSeen = new Set();
  const transitions = Array.isArray(decl.transitions) ? decl.transitions : [];

  for (const rule of transitions) {
    if (rule && rule.target && !stagesSeen.has(rule.target)) {
      stagesSeen.add(rule.target);
      const stageId = `stage:${decl.name}:${rule.target}`;
      nodes.push(createLayoutNode(stageId, rule.target, {
        nodeType: 'stage',
        lifecycle: decl.name,
      }));
    }
  }

  // Edges: lifecycle root -> first-target stage (source of transition chain)
  // Then: stage to stage edges for each transition rule
  const stageIdFor = (name) => `stage:${decl.name}:${name}`;

  // First, connect lifecycle root to each target stage referenced in transitions
  // Model each transition as an edge from the lifecycle node to its target stage.
  for (const rule of transitions) {
    if (rule && rule.target) {
      edges.push(createLayoutEdge(
        rootId,
        stageIdFor(rule.target),
        rule.on || '',
        { edgeType: 'transition', on: rule.on }
      ));
    }
  }

  return { nodes, edges };
}

/**
 * adaptStructure -- Structure AST -> tree graph.
 *
 * Root node for the structure, child nodes for each entry in contains/spawns/delegates.
 */
function adaptStructure(decl) {
  const nodes = [];
  const edges = [];

  const rootId = `structure:${decl.name}`;
  nodes.push(createLayoutNode(rootId, decl.name, {
    nodeType: 'structure',
    id:    decl.id    || null,
    state: decl.state || null,
  }));

  // Containment entries
  const contains = Array.isArray(decl.contains) ? decl.contains : [];
  for (let i = 0; i < contains.length; i++) {
    const entry = contains[i];
    const childId = `contains:${decl.name}:${entry.path || i}`;
    const label   = entry.targetType
      ? (entry.cardinality ? `${entry.targetType}[${entry.cardinality.notation}]` : entry.targetType)
      : (entry.path || String(i));
    nodes.push(createLayoutNode(childId, label, {
      nodeType:    'containment',
      path:        entry.path || null,
      targetType:  entry.targetType || null,
      cardinality: entry.cardinality || null,
    }));
    const cardLabel = entry.cardinality ? entry.cardinality.notation : '';
    edges.push(createLayoutEdge(rootId, childId, cardLabel, { edgeType: 'containment' }));
  }

  // Spawns entries
  const spawns = Array.isArray(decl.spawns) ? decl.spawns : [];
  for (let i = 0; i < spawns.length; i++) {
    const entry  = spawns[i];
    const childId = `spawn:${decl.name}:${entry.targetType || i}`;
    const label   = entry.targetType
      ? (entry.cardinality ? `${entry.targetType}[${entry.cardinality.notation}]` : entry.targetType)
      : String(i);
    nodes.push(createLayoutNode(childId, label, {
      nodeType:    'spawn',
      targetType:  entry.targetType || null,
      source:      entry.source || null,
      cardinality: entry.cardinality || null,
    }));
    const cardLabel = entry.cardinality ? entry.cardinality.notation : '';
    edges.push(createLayoutEdge(rootId, childId, cardLabel, { edgeType: 'containment' }));
  }

  // Delegation entries -- child per stage/role pair
  const delegates = Array.isArray(decl.delegates) ? decl.delegates : [];
  for (let i = 0; i < delegates.length; i++) {
    const entry  = delegates[i];
    const childId = `delegate:${decl.name}:${entry.stage || i}`;
    const label   = entry.role ? `${entry.stage} -> ${entry.role}` : (entry.stage || String(i));
    nodes.push(createLayoutNode(childId, label, {
      nodeType: 'delegation',
      stage:    entry.stage || null,
      role:     entry.role  || null,
    }));
    edges.push(createLayoutEdge(rootId, childId, 'delegates', { edgeType: 'delegation' }));
  }

  // Checkpoints -- cross-edges between state nodes (skip if state nodes not present; just record as metadata)
  // We model checkpoints as cross-edges from root to a checkpoint node
  const checkpoints = Array.isArray(decl.checkpoints) ? decl.checkpoints : [];
  for (let i = 0; i < checkpoints.length; i++) {
    const entry  = checkpoints[i];
    const chkId  = `checkpoint:${decl.name}:${entry.fromState}:${entry.toState}`;
    const label  = entry.condition || `${entry.fromState} -> ${entry.toState}`;
    nodes.push(createLayoutNode(chkId, label, {
      nodeType:  'checkpoint',
      fromState: entry.fromState || null,
      toState:   entry.toState   || null,
      condition: entry.condition || null,
    }));
    edges.push(createLayoutEdge(rootId, chkId, entry.condition || '', { edgeType: 'containment' }));
  }

  return { nodes, edges };
}

/**
 * adaptEntity -- Entity AST -> single node (fields as metadata).
 * Returns a partial graph with just one node, no edges.
 */
function adaptEntity(decl) {
  const nodeId = `entity:${decl.name}`;
  const fields = Array.isArray(decl.fields) ? decl.fields.map(f => ({
    name:     f.name,
    type:     f.fieldType ? (f.fieldType.name || f.fieldType.kind || 'unknown') : 'unknown',
    optional: f.optional || false,
  })) : [];

  const node = createLayoutNode(nodeId, decl.name, {
    nodeType: 'entity',
    fields,
  });

  return { nodes: [node], edges: [] };
}

/**
 * adaptRelations -- Relation declarations + existing entity nodes -> edges.
 *
 * @param {Array}  relationDecls  -- array of Relation AST nodes
 * @param {Map}    entityNodeMap  -- Map<entityName, nodeId>
 */
function adaptRelations(relationDecls, entityNodeMap) {
  const edges = [];

  for (const decl of relationDecls) {
    const srcId = entityNodeMap.get(decl.source);
    const tgtId = entityNodeMap.get(decl.target);

    // If either end is missing, create a placeholder node reference
    const source = srcId || `entity:${decl.source}`;
    const target = tgtId || `entity:${decl.target}`;

    const cardNotation = decl.cardinality ? decl.cardinality.notation : '';
    const label = [decl.relationType, cardNotation].filter(Boolean).join(' ');

    const isSelfRef = (decl.source === decl.target);
    edges.push(createLayoutEdge(source, target, label, {
      edgeType:    'relation',
      relationType: decl.relationType || null,
      cardinality:  decl.cardinality  || null,
      isSelfRef,
      via:         decl.via || null,
    }));
  }

  return edges;
}

/**
 * adaptProgram -- top-level orchestrator.
 * Iterates program.body, dispatches to the appropriate adapter,
 * merges all partial graphs into a single intermediate graph.
 */
function adaptProgram(program) {
  const allNodes = [];
  const allEdges = [];

  // Collect entity nodes first so adaptRelations can reference them
  const entityNodeMap = new Map(); // entityName -> nodeId

  const body = Array.isArray(program.body) ? program.body : [];

  // First pass: lifecycle, structure, entity
  for (const decl of body) {
    if (!decl) continue;

    if (decl.type === 'Lifecycle') {
      const { nodes, edges } = adaptLifecycle(decl);
      allNodes.push(...nodes);
      allEdges.push(...edges);
    } else if (decl.type === 'Structure') {
      const { nodes, edges } = adaptStructure(decl);
      allNodes.push(...nodes);
      allEdges.push(...edges);
    } else if (decl.type === 'Entity') {
      const { nodes, edges } = adaptEntity(decl);
      allNodes.push(...nodes);
      allEdges.push(...edges);
      // Track entity name -> node id mapping
      for (const n of nodes) {
        entityNodeMap.set(decl.name, n.id);
      }
    }
  }

  // Second pass: relations (need entity nodes to be present)
  const relationDecls = body.filter(d => d && d.type === 'Relation');
  if (relationDecls.length > 0) {
    const relEdges = adaptRelations(relationDecls, entityNodeMap);
    allEdges.push(...relEdges);
  }

  return { nodes: allNodes, edges: allEdges };
}

// ---------------------------------------------------------------------------
// Layout algorithm -- Stage 1: assignLayers (Kahn's topological sort)
// ---------------------------------------------------------------------------

/**
 * assignLayers -- assign a layer (rank) to each node using Kahn's algorithm.
 * Cycles are handled by detecting back-edges and marking them as feedback.
 *
 * @param {object} graph  -- { nodes, edges }
 * @returns {Map<string, number>}  nodeId -> layer number
 */
function assignLayers(graph) {
  const { nodes, edges } = graph;

  // Build adjacency: nodeId -> Set of successor nodeIds
  // Build in-degree map
  const nodeIds = new Set(nodes.map(n => n.id));
  const inDegree = new Map();
  const successors = new Map();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    successors.set(id, []);
  }

  // Detect cycles: use DFS to find back-edges before running Kahn's
  // Mark back-edges in edge.meta.isFeedback = true
  const visited    = new Set();
  const inStack    = new Set();
  const adjForDFS  = new Map();

  for (const id of nodeIds) adjForDFS.set(id, []);
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjForDFS.get(edge.source).push(edge);
    }
  }

  function dfs(id) {
    visited.add(id);
    inStack.add(id);
    for (const edge of adjForDFS.get(id) || []) {
      if (!nodeIds.has(edge.target)) continue;
      if (!visited.has(edge.target)) {
        dfs(edge.target);
      } else if (inStack.has(edge.target)) {
        // Back-edge -- mark as feedback
        edge.meta = edge.meta || {};
        edge.meta.isFeedback = true;
      }
    }
    inStack.delete(id);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) dfs(id);
  }

  // Now build in-degree ignoring feedback edges
  for (const edge of edges) {
    if (edge.meta && edge.meta.isFeedback) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (edge.source !== edge.target) { // skip self-loops for in-degree
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
      successors.get(edge.source).push(edge.target);
    }
  }

  // Kahn's BFS
  const layers    = new Map();
  const queue     = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const id = queue.shift();
    const layer = layers.get(id) || 0;
    for (const succId of successors.get(id) || []) {
      const newLayer = Math.max(layers.get(succId) || 0, layer + 1);
      layers.set(succId, newLayer);
      inDegree.set(succId, inDegree.get(succId) - 1);
      if (inDegree.get(succId) === 0) queue.push(succId);
    }
  }

  // Ensure every node has a layer (handles disconnected / cycle-only graphs)
  for (const id of nodeIds) {
    if (!layers.has(id)) layers.set(id, 0);
  }

  return layers;
}

// ---------------------------------------------------------------------------
// Layout algorithm -- Stage 2: orderNodesInLayers (barycenter heuristic)
// ---------------------------------------------------------------------------

/**
 * orderNodesInLayers -- sort nodes within each layer by barycenter value
 * to minimize edge crossings.
 *
 * Mutates graph.nodes by setting node.layer and node.order.
 *
 * @param {object}          graph   -- { nodes, edges }
 * @param {Map<string,number>} layerMap -- nodeId -> layer
 */
function orderNodesInLayers(graph, layerMap) {
  const { nodes, edges } = graph;

  // Group nodes by layer
  const byLayer = new Map();
  for (const node of nodes) {
    const layer = layerMap.get(node.id) || 0;
    node.layer = layer;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(node);
  }

  // Build predecessor lists for barycenter (ignore feedback and self-ref edges)
  const predPositions = new Map(); // nodeId -> [predecessor order values]

  for (const edge of edges) {
    if (edge.meta && edge.meta.isFeedback)         continue;
    if (edge.meta && edge.meta.isSelfRef)           continue;
    if (edge.source === edge.target)                continue;

    const srcLayer = layerMap.get(edge.source);
    const tgtLayer = layerMap.get(edge.target);
    if (srcLayer === undefined || tgtLayer === undefined) continue;
    if (srcLayer >= tgtLayer) continue; // only forward edges

    if (!predPositions.has(edge.target)) predPositions.set(edge.target, []);
    // We'll fill in actual positions after layer 0 is assigned
    predPositions.get(edge.target).push(edge.source);
  }

  // Assign initial order to layer 0
  const sortedLayers = Array.from(byLayer.keys()).sort((a, b) => a - b);
  const orderMap = new Map(); // nodeId -> order within its layer

  for (const layer of sortedLayers) {
    const nodesInLayer = byLayer.get(layer);
    if (layer === 0 || !nodesInLayer) {
      // Initial order: alphabetical for determinism
      nodesInLayer.sort((a, b) => a.id.localeCompare(b.id));
      nodesInLayer.forEach((n, i) => {
        n.order = i;
        orderMap.set(n.id, i);
      });
      continue;
    }

    // Compute barycenter for each node based on predecessor positions
    const withBary = nodesInLayer.map(node => {
      const preds = predPositions.get(node.id) || [];
      if (preds.length === 0) return { node, bary: Infinity };
      let sum = 0;
      let count = 0;
      for (const predId of preds) {
        if (orderMap.has(predId)) {
          sum += orderMap.get(predId);
          count++;
        }
      }
      const bary = count > 0 ? sum / count : Infinity;
      return { node, bary };
    });

    // Sort by barycenter, use alphabetical id as tiebreaker
    withBary.sort((a, b) => {
      if (a.bary !== b.bary) return a.bary - b.bary;
      return a.node.id.localeCompare(b.node.id);
    });

    withBary.forEach(({ node }, i) => {
      node.order = i;
      orderMap.set(node.id, i);
    });
  }
}

// ---------------------------------------------------------------------------
// Layout algorithm -- Stage 3: assignCoordinates (fixed-spacing)
// ---------------------------------------------------------------------------

/**
 * assignCoordinates -- assign x, y, width, height to each node.
 *
 * Nodes are centered per layer:
 *   y = layer  * (nodeHeight + layerSpacing)
 *   x = order  * (nodeWidth  + nodeSpacing), then center-aligned per layer
 *
 * @param {object} graph
 * @param {Map<string,number>} layerMap
 * @param {object} options  -- nodeWidth, nodeHeight, layerSpacing, nodeSpacing
 */
function assignCoordinates(graph, layerMap, options = {}) {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options);
  const { nodeWidth, nodeHeight, layerSpacing, nodeSpacing } = opts;

  // Group nodes by layer again (already assigned in orderNodesInLayers)
  const byLayer = new Map();
  for (const node of graph.nodes) {
    const layer = node.layer;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(node);
  }

  // Find the widest layer for centering
  let maxLayerWidth = 0;
  for (const [, nodesInLayer] of byLayer) {
    const w = nodesInLayer.length * (nodeWidth + nodeSpacing) - nodeSpacing;
    if (w > maxLayerWidth) maxLayerWidth = w;
  }

  for (const [layer, nodesInLayer] of byLayer) {
    // Sort by order for deterministic placement
    nodesInLayer.sort((a, b) => a.order - b.order);

    const totalWidth = nodesInLayer.length * (nodeWidth + nodeSpacing) - nodeSpacing;
    const xOffset    = Math.floor((maxLayerWidth - totalWidth) / 2);

    const y = layer * (nodeHeight + layerSpacing);
    nodesInLayer.forEach((node, i) => {
      node.x      = xOffset + i * (nodeWidth + nodeSpacing);
      node.y      = y;
      node.width  = nodeWidth;
      node.height = nodeHeight;
    });
  }
}

// ---------------------------------------------------------------------------
// Layout algorithm -- Stage 4: routeEdges (orthogonal routing)
// ---------------------------------------------------------------------------

/**
 * routeEdges -- compute waypoints for each edge.
 *
 * Simple orthogonal routing:
 * - Normal forward edges: exit bottom-center of source, enter top-center of target.
 *   Two extra waypoints form the L-shape (or straight line for same x).
 * - Same-layer edges: route horizontally with an arc above/below.
 * - Feedback edges: route on the left side with extra waypoints.
 * - Self-loops: small loop above the node.
 *
 * @param {object} graph -- { nodes, edges }
 */
function routeEdges(graph) {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

  for (const edge of graph.edges) {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);

    if (!src || !tgt) {
      // At least provide 2 stub waypoints
      edge.waypoints = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
      continue;
    }

    // Self-loop
    if (src === tgt || edge.source === edge.target) {
      const cx = src.x + src.width / 2;
      const cy = src.y;
      const r  = 20;
      edge.waypoints = [
        { x: cx - r, y: cy },
        { x: cx - r, y: cy - r * 2 },
        { x: cx + r, y: cy - r * 2 },
        { x: cx + r, y: cy },
      ];
      continue;
    }

    // Center-bottom of source, center-top of target
    const srcX = src.x + src.width  / 2;
    const srcY = src.y + src.height;
    const tgtX = tgt.x + tgt.width  / 2;
    const tgtY = tgt.y;

    // Feedback edge -- route on the left
    if (edge.meta && edge.meta.isFeedback) {
      const leftX  = Math.min(src.x, tgt.x) - 30;
      const midSrcY = src.y + src.height / 2;
      const midTgtY = tgt.y + tgt.height / 2;
      edge.waypoints = [
        { x: src.x,  y: midSrcY },
        { x: leftX,  y: midSrcY },
        { x: leftX,  y: midTgtY },
        { x: tgt.x,  y: midTgtY },
      ];
      continue;
    }

    // Same-layer edge -- route via horizontal offset above
    if (src.layer === tgt.layer) {
      const aboveY = src.y - 30;
      edge.waypoints = [
        { x: srcX, y: src.y },
        { x: srcX, y: aboveY },
        { x: tgtX, y: aboveY },
        { x: tgtX, y: tgt.y },
      ];
      continue;
    }

    // Normal forward edge -- orthogonal L-route
    const midY = srcY + (tgtY - srcY) / 2;
    if (srcX === tgtX) {
      // Straight vertical
      edge.waypoints = [
        { x: srcX, y: srcY },
        { x: tgtX, y: tgtY },
      ];
    } else {
      // Bent route through midpoint
      edge.waypoints = [
        { x: srcX, y: srcY },
        { x: srcX, y: midY },
        { x: tgtX, y: midY },
        { x: tgtX, y: tgtY },
      ];
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * layout(ast, options) -- convert a parsed PDSL AST to a LayoutGraph.
 *
 * @param {object} ast      -- Program node from parse()
 * @param {object} options  -- layout options (nodeWidth, nodeHeight, layerSpacing, nodeSpacing)
 * @returns {LayoutGraph}   -- { nodes, edges, width, height }
 */
function layout(ast, options = {}) {
  // Handle both parse() return shapes: { ast, program, errors } or direct Program node
  const program = ast && ast.type === 'Program'
    ? ast
    : (ast && ast.ast ? ast.ast : (ast && ast.program ? ast.program : ast));

  // 1. Adapt AST to intermediate graph
  const graph = adaptProgram(program || { body: [] });

  // 2. Assign layers
  const layerMap = assignLayers(graph);

  // 3. Order nodes within layers
  orderNodesInLayers(graph, layerMap);

  // 4. Assign coordinates
  assignCoordinates(graph, layerMap, options);

  // 5. Route edges
  routeEdges(graph);

  // 6. Return LayoutGraph
  return createLayoutGraph(graph.nodes, graph.edges);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  layout,
  // Exposed for testing
  createLayoutNode,
  createLayoutEdge,
  createLayoutGraph,
  adaptLifecycle,
  adaptStructure,
  adaptEntity,
  adaptRelations,
  adaptProgram,
  assignLayers,
  orderNodesInLayers,
  assignCoordinates,
  routeEdges,
};
