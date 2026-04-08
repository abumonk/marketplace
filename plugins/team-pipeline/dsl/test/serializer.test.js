'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { parse } = require('../parser');
const { serialize } = require('../serializer');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively remove `loc` properties from an object to compare ASTs
 * without positional information.
 */
function stripLoc(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(stripLoc);
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key !== 'loc') {
      result[key] = stripLoc(value);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Test Suite: Serializer
// ---------------------------------------------------------------------------

describe('PDSL Serializer', () => {
  describe('serialize() produces valid output', () => {
    it('minimal lifecycle serializes to non-empty string', () => {
      const src = `lifecycle PlanningCycle {
  role: planner
  trigger: task.status == "pending"
  execute {}
}`;
      const result = parse(src);
      assert.ok(!result.errors || result.errors.length === 0, 'parse errors');
      const output = serialize(result.ast);
      assert.ok(typeof output === 'string', 'serialize returns string');
      assert.ok(output.length > 0, 'serialize output non-empty');
    });
  });

  describe('indentation consistency', () => {
    it('2-space indentation only', () => {
      const src = `lifecycle PlanningCycle {
  role: planner
  trigger: task.status == "pending"
  execute {
    log "Starting"
  }
}`;
      const result = parse(src);
      assert.ok(!result.errors || result.errors.length === 0, 'parse errors');
      const output = serialize(result.ast);
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.length === 0) continue;
        const match = line.match(/^(\s*)/);
        const indent = match ? match[1].length : 0;
        // Each indent level should be a multiple of 2
        assert.strictEqual(indent % 2, 0, `line has non-2-space indent: "${line}"`);
      }
    });
  });

  describe('round-trip tests', () => {
    it('lifecycle declaration round-trips', () => {
      const src = `lifecycle PlanningCycle {
  role: planner
  model: opus
  trigger: task.status == "pending"
  execute {
    log "Starting"
    read codebase
  }
  transitions {
    on complete -> completed
  }
}`;
      const result1 = parse(src);
      assert.ok(!result1.errors || result1.errors.length === 0, 'parse errors on input');

      const output = serialize(result1.ast);
      const result2 = parse(output);
      assert.ok(!result2.errors || result2.errors.length === 0, 're-parse errors');

      assert.deepStrictEqual(
        stripLoc(result1.ast),
        stripLoc(result2.ast),
        'ASTs differ after round-trip'
      );
    });

    it('structure declaration round-trips', () => {
      const src = `structure Adventure {
  id: ADV-{NNN}
  state: open | completed

  contains {
    .agent/tasks -> Task[1..*]
  }
  delegates {
    implementing -> implementer
  }
  checkpoints {
    implementing -> reviewing: "tests pass"
  }
}`;
      const result1 = parse(src);
      assert.ok(!result1.errors || result1.errors.length === 0, 'parse errors on input');

      const output = serialize(result1.ast);
      const result2 = parse(output);
      assert.ok(!result2.errors || result2.errors.length === 0, 're-parse errors');

      assert.deepStrictEqual(
        stripLoc(result1.ast),
        stripLoc(result2.ast),
        'ASTs differ after round-trip'
      );
    });

    it('entity declaration round-trips', () => {
      const src = `entity Task {
  id: string
  status: planning | implementing | reviewing | completed
  values: draft | active | closed
}`;
      const result1 = parse(src);
      assert.ok(!result1.errors || result1.errors.length === 0, 'parse errors on input');

      const output = serialize(result1.ast);
      const result2 = parse(output);
      assert.ok(!result2.errors || result2.errors.length === 0, 're-parse errors');

      assert.deepStrictEqual(
        stripLoc(result1.ast),
        stripLoc(result2.ast),
        'ASTs differ after round-trip'
      );
    });

    it('relation declaration round-trips', () => {
      const src = `relation Adventure -> Task {
  type: contains
  via: tasks[]
  cardinality: 1..*
  constraint: required
  lifecycle: TaskLifecycle
}`;
      const result1 = parse(src);
      assert.ok(!result1.errors || result1.errors.length === 0, 'parse errors on input');

      const output = serialize(result1.ast);
      const result2 = parse(output);
      assert.ok(!result2.errors || result2.errors.length === 0, 're-parse errors');

      assert.deepStrictEqual(
        stripLoc(result1.ast),
        stripLoc(result2.ast),
        'ASTs differ after round-trip'
      );
    });

    it('empty program round-trips', () => {
      const src = '';
      const result1 = parse(src);
      const output = serialize(result1.ast);
      assert.strictEqual(output, '', 'empty program serializes to empty string');

      const result2 = parse(output);
      assert.deepStrictEqual(
        stripLoc(result1.ast),
        stripLoc(result2.ast),
        'empty program ASTs differ'
      );
    });
  });

  describe('field serialization', () => {
    it('entity field with pattern, optional, default, and cardinality round-trips', () => {
      const src = `entity Item {
  status: string /TASK-\\d+/ ? = pending [1]
}`;
      const result1 = parse(src);
      assert.ok(!result1.errors || result1.errors.length === 0, 'parse errors on input');

      const output = serialize(result1.ast);
      assert.ok(output.includes('/TASK-\\d+/'), 'pattern present in output');
      assert.ok(output.includes('?'), 'optional marker present in output');
      assert.ok(output.includes('= pending'), 'default value present in output');
      assert.ok(output.includes('[1]'), 'cardinality present in output');

      const result2 = parse(output);
      assert.ok(!result2.errors || result2.errors.length === 0, 're-parse errors');

      assert.deepStrictEqual(
        stripLoc(result1.ast),
        stripLoc(result2.ast),
        'ASTs differ after round-trip'
      );
    });
  });
});
