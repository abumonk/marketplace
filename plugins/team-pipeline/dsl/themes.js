'use strict';

// ---------------------------------------------------------------------------
// themes.js -- PDSL Theme System
//
// Defines the color and styling theme for pipeline diagram rendering.
//
// Exports:
//   defaultTheme()               -- returns the frozen default pipeline theme
//   createTheme(overrides)       -- deep-merge overrides onto the default theme
//   getNodeStyle(theme, node)    -- resolve style for a node based on meta.kind
// ---------------------------------------------------------------------------

/**
 * Deep-merge two plain objects. Arrays are replaced (not merged).
 * @param {object} base
 * @param {object} overrides
 * @returns {object}
 */
function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return overrides !== undefined ? overrides : base;
  }
  const result = Object.assign({}, base);
  for (const key of Object.keys(overrides)) {
    const bVal = base[key];
    const oVal = overrides[key];
    if (
      oVal !== null &&
      typeof oVal === 'object' &&
      !Array.isArray(oVal) &&
      bVal !== null &&
      typeof bVal === 'object' &&
      !Array.isArray(bVal)
    ) {
      result[key] = deepMerge(bVal, oVal);
    } else {
      result[key] = oVal;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Default theme definition
// ---------------------------------------------------------------------------

const DEFAULT_THEME = {
  // Stage colors -- all 6 pipeline stages
  stages: {
    planning: {
      fill:        '#E3F2FD',
      stroke:      '#1976D2',
      headerFill:  '#1976D2',
      textColor:   '#0D47A1',
    },
    implementing: {
      fill:        '#E8F5E9',
      stroke:      '#388E3C',
      headerFill:  '#388E3C',
      textColor:   '#1B5E20',
    },
    reviewing: {
      fill:        '#FFF3E0',
      stroke:      '#F57C00',
      headerFill:  '#F57C00',
      textColor:   '#E65100',
    },
    fixing: {
      fill:        '#FFEBEE',
      stroke:      '#D32F2F',
      headerFill:  '#D32F2F',
      textColor:   '#B71C1C',
    },
    completed: {
      fill:        '#E0F2F1',
      stroke:      '#00796B',
      headerFill:  '#00796B',
      textColor:   '#004D40',
    },
    researching: {
      fill:        '#F3E5F5',
      stroke:      '#7B1FA2',
      headerFill:  '#7B1FA2',
      textColor:   '#4A148C',
    },
  },

  // Entity node -- UML-style with darker header band
  entity: {
    fill:         '#FAFAFA',
    stroke:       '#455A64',
    headerFill:   '#455A64',
    headerStroke: '#263238',
    textColor:    '#212121',
    headerText:   '#FFFFFF',
  },

  // Generic node -- neutral gray for nodes that don't map to a stage
  generic: {
    fill:        '#F5F5F5',
    stroke:      '#9E9E9E',
    headerFill:  '#9E9E9E',
    textColor:   '#424242',
  },

  // Edge styling
  edge: {
    stroke:      '#546E7A',
    strokeWidth: 1.5,
    arrowSize:   8,
    labelColor:  '#37474F',
  },

  // Font settings
  font: {
    family:     'monospace, "Courier New", Courier',
    sizeTitle:  13,
    sizeBody:   11,
    sizeLabel:  10,
  },

  // Spacing / geometry
  spacing: {
    padding:        8,
    headerHeight:   24,
    fieldRowHeight: 18,
    cornerRadius:   4,
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the default pipeline theme as a frozen (deep-copied) object.
 * @returns {object}
 */
function defaultTheme() {
  // Return a frozen deep copy so callers cannot mutate the singleton
  return Object.freeze(JSON.parse(JSON.stringify(DEFAULT_THEME)));
}

/**
 * Create a theme by deep-merging overrides onto the default theme.
 * Only the provided keys are overridden; all others retain their defaults.
 *
 * @param {object} overrides  -- partial theme shape (any depth)
 * @returns {object}          -- merged theme (not frozen)
 */
function createTheme(overrides = {}) {
  return deepMerge(JSON.parse(JSON.stringify(DEFAULT_THEME)), overrides);
}

/**
 * Resolve the correct style object for a node based on its meta.kind.
 *
 * meta.kind may be:
 *   - a pipeline stage name: 'planning', 'implementing', 'reviewing',
 *     'fixing', 'completed', 'researching'
 *   - 'entity'
 *   - 'generic' (or any unrecognized value)
 *
 * For backward compatibility, meta.nodeType is also checked when meta.kind
 * is absent.
 *
 * @param {object} theme  -- theme object (from defaultTheme or createTheme)
 * @param {object} node   -- LayoutNode with .meta
 * @returns {object}      -- style object { fill, stroke, headerFill, textColor, ... }
 */
function getNodeStyle(theme, node) {
  const meta = node.meta || {};
  const kind = meta.kind || meta.nodeType || 'generic';

  if (kind === 'entity') {
    return theme.entity;
  }

  if (theme.stages && theme.stages[kind]) {
    return theme.stages[kind];
  }

  return theme.generic;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { defaultTheme, createTheme, getNodeStyle };
