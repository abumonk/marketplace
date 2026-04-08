'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { tokenize, parse } = require('../parser');
const { TokenType } = require('../ast');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function types(tokens) {
  return tokens.map(t => t.type);
}

function values(tokens) {
  return tokens.map(t => t.value);
}

// ---------------------------------------------------------------------------
// 3.1 Basic tokenization
// ---------------------------------------------------------------------------

describe('basic tokenization', () => {
  it('empty input produces only EOF', () => {
    const toks = tokenize('');
    assert.strictEqual(toks.length, 1);
    assert.strictEqual(toks[0].type, TokenType.EOF);
  });

  it('whitespace-only input produces only EOF', () => {
    const toks = tokenize('   \t  \n  ');
    assert.strictEqual(toks.length, 1);
    assert.strictEqual(toks[0].type, TokenType.EOF);
  });

  it('single keyword produces keyword token + EOF', () => {
    const toks = tokenize('lifecycle');
    assert.strictEqual(toks.length, 2);
    assert.strictEqual(toks[0].type, TokenType.LIFECYCLE);
    assert.strictEqual(toks[0].value, 'lifecycle');
    assert.strictEqual(toks[1].type, TokenType.EOF);
  });

  it('single identifier produces IDENTIFIER + EOF', () => {
    const toks = tokenize('PlanningCycle');
    assert.strictEqual(toks.length, 2);
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[0].value, 'PlanningCycle');
  });

  it('string literal produces STRING token without surrounding quotes', () => {
    const toks = tokenize('"hello world"');
    assert.strictEqual(toks.length, 2);
    assert.strictEqual(toks[0].type, TokenType.STRING);
    assert.strictEqual(toks[0].value, 'hello world');
  });

  it('empty string literal produces STRING token with empty value', () => {
    const toks = tokenize('""');
    assert.strictEqual(toks.length, 2);
    assert.strictEqual(toks[0].type, TokenType.STRING);
    assert.strictEqual(toks[0].value, '');
  });

  it('number literal produces NUMBER token', () => {
    const toks = tokenize('42');
    assert.strictEqual(toks.length, 2);
    assert.strictEqual(toks[0].type, TokenType.NUMBER);
    assert.strictEqual(toks[0].value, '42');
  });

  it('pattern literal produces PATTERN token with regex body without slashes', () => {
    const toks = tokenize('/TASK-\\d+/');
    assert.strictEqual(toks.length, 2);
    assert.strictEqual(toks[0].type, TokenType.PATTERN);
    assert.strictEqual(toks[0].value, 'TASK-\\d+');
  });

  it('pattern with complex body', () => {
    const toks = tokenize('/[A-Z]+-\\d{3}/');
    assert.strictEqual(toks.length, 2);
    assert.strictEqual(toks[0].type, TokenType.PATTERN);
    assert.strictEqual(toks[0].value, '[A-Z]+-\\d{3}');
  });
});

// ---------------------------------------------------------------------------
// 3.2 Operators and punctuation
// ---------------------------------------------------------------------------

describe('operators and punctuation', () => {
  it('arrow operator ->', () => {
    const toks = tokenize('->');
    assert.strictEqual(toks[0].type, TokenType.ARROW);
    assert.strictEqual(toks[0].value, '->');
  });

  it('dot-dot operator ..', () => {
    const toks = tokenize('..');
    assert.strictEqual(toks[0].type, TokenType.DOT_DOT);
    assert.strictEqual(toks[0].value, '..');
  });

  it('comparison operators', () => {
    const input = '== != <= >= < >';
    const toks = tokenize(input).slice(0, -1); // remove EOF
    assert.deepStrictEqual(types(toks), [
      TokenType.COMP_EQ,
      TokenType.COMP_NE,
      TokenType.COMP_LE,
      TokenType.COMP_GE,
      TokenType.COMP_LT,
      TokenType.COMP_GT,
    ]);
    assert.deepStrictEqual(values(toks), ['==', '!=', '<=', '>=', '<', '>']);
  });

  it('logical operators && ||', () => {
    const toks = tokenize('&& ||').slice(0, -1);
    assert.deepStrictEqual(types(toks), [TokenType.LOGIC_AND, TokenType.LOGIC_OR]);
    assert.deepStrictEqual(values(toks), ['&&', '||']);
  });

  it('single-char operators', () => {
    const input = '= : | ? . *';
    const toks = tokenize(input).slice(0, -1);
    assert.deepStrictEqual(types(toks), [
      TokenType.EQUALS,
      TokenType.COLON,
      TokenType.PIPE,
      TokenType.QUESTION,
      TokenType.DOT,
      TokenType.STAR,
    ]);
  });

  it('punctuation { } [ ] ( ) ,', () => {
    const input = '{ } [ ] ( ) ,';
    const toks = tokenize(input).slice(0, -1);
    assert.deepStrictEqual(types(toks), [
      TokenType.LBRACE,
      TokenType.RBRACE,
      TokenType.LBRACKET,
      TokenType.RBRACKET,
      TokenType.LPAREN,
      TokenType.RPAREN,
      TokenType.COMMA,
    ]);
  });

  it('-> is ARROW not COMP_GT followed by EQUALS', () => {
    const toks = tokenize('->');
    assert.strictEqual(toks[0].type, TokenType.ARROW);
    assert.strictEqual(toks.length, 2); // ARROW + EOF, not 3 tokens
  });

  it('== is COMP_EQ not two EQUALS tokens', () => {
    const toks = tokenize('==');
    assert.strictEqual(toks[0].type, TokenType.COMP_EQ);
    assert.strictEqual(toks.length, 2);
  });

  it('.. is DOT_DOT not two DOT tokens', () => {
    const toks = tokenize('..');
    assert.strictEqual(toks[0].type, TokenType.DOT_DOT);
    assert.strictEqual(toks.length, 2);
  });

  it('&& is LOGIC_AND not two ERROR tokens', () => {
    const toks = tokenize('&&');
    assert.strictEqual(toks[0].type, TokenType.LOGIC_AND);
    assert.strictEqual(toks.length, 2);
  });

  it('|| is LOGIC_OR not two PIPE tokens', () => {
    const toks = tokenize('||');
    assert.strictEqual(toks[0].type, TokenType.LOGIC_OR);
    assert.strictEqual(toks.length, 2);
  });

  it('bare / produces SLASH token', () => {
    const toks = tokenize('a / b');
    // IDENTIFIER, SLASH, IDENTIFIER, EOF
    assert.strictEqual(toks[1].type, TokenType.SLASH);
    assert.strictEqual(toks[1].value, '/');
  });
});

// ---------------------------------------------------------------------------
// 3.3 Keyword vs identifier distinction
// ---------------------------------------------------------------------------

describe('keyword vs identifier', () => {
  const allKeywords = [
    ['lifecycle',   TokenType.LIFECYCLE],
    ['structure',   TokenType.STRUCTURE],
    ['entity',      TokenType.ENTITY],
    ['relation',    TokenType.RELATION],
    ['input',       TokenType.INPUT],
    ['execute',     TokenType.EXECUTE],
    ['transitions', TokenType.TRANSITIONS],
    ['completion',  TokenType.COMPLETION],
    ['contains',    TokenType.CONTAINS],
    ['spawns',      TokenType.SPAWNS],
    ['delegates',   TokenType.DELEGATES],
    ['checkpoints', TokenType.CHECKPOINTS],
    ['on',          TokenType.ON],
    ['from',        TokenType.FROM],
    ['type',        TokenType.TYPE],
    ['via',         TokenType.VIA],
    ['cardinality', TokenType.CARDINALITY],
    ['constraint',  TokenType.CONSTRAINT],
    ['values',      TokenType.VALUES],
    ['role',        TokenType.ROLE],
    ['model',       TokenType.MODEL],
    ['trigger',     TokenType.TRIGGER],
    ['state',       TokenType.STATE],
    ['id',          TokenType.ID],
  ];

  for (const [kw, expectedType] of allKeywords) {
    it(`keyword '${kw}' is recognized as type '${expectedType}'`, () => {
      const toks = tokenize(kw);
      assert.strictEqual(toks[0].type, expectedType);
      assert.strictEqual(toks[0].value, kw);
    });
  }

  it('identifier prefix of keyword (e.g. mod) is IDENTIFIER', () => {
    const toks = tokenize('mod');
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
  });

  it('identifier containing keyword (e.g. on_error) is IDENTIFIER', () => {
    const toks = tokenize('on_error');
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
  });

  it('identifier with hyphen (e.g. adventure-planner) is single IDENTIFIER', () => {
    const toks = tokenize('adventure-planner');
    assert.strictEqual(toks.length, 2); // IDENTIFIER + EOF
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[0].value, 'adventure-planner');
  });

  it('keyword followed by ident-continue chars is IDENTIFIER (e.g. lifecycle2)', () => {
    const toks = tokenize('lifecycle2');
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[0].value, 'lifecycle2');
  });

  it('keyword followed by hyphen is IDENTIFIER (e.g. on-success)', () => {
    const toks = tokenize('on-success');
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[0].value, 'on-success');
  });

  it('identifier with underscore-prefixed keyword (e.g. _entity) is IDENTIFIER', () => {
    const toks = tokenize('_entity');
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
  });
});

// ---------------------------------------------------------------------------
// 3.4 Line/column tracking
// ---------------------------------------------------------------------------

describe('line and column tracking', () => {
  it('single-line: first token is line 1, col 1', () => {
    const toks = tokenize('hello');
    assert.strictEqual(toks[0].line, 1);
    assert.strictEqual(toks[0].column, 1);
  });

  it('single-line: second token column advances past first', () => {
    const toks = tokenize('hello world');
    // 'hello' starts at col 1, 'world' starts at col 7 (after 'hello' + space)
    assert.strictEqual(toks[0].column, 1);
    assert.strictEqual(toks[1].column, 7);
  });

  it('multi-line: tokens on line 2 have line=2', () => {
    const toks = tokenize('hello\nworld');
    assert.strictEqual(toks[0].line, 1);
    assert.strictEqual(toks[1].line, 2);
    assert.strictEqual(toks[1].column, 1);
  });

  it('multi-line: column resets after newline', () => {
    const toks = tokenize('ab\ncd');
    assert.strictEqual(toks[1].column, 1);
  });

  it('tab counts as 1 column', () => {
    const toks = tokenize('\thello');
    assert.strictEqual(toks[0].column, 2); // tab advances by 1
  });

  it('windows-style \\r\\n treated as single newline', () => {
    const toks = tokenize('a\r\nb');
    assert.strictEqual(toks[0].line, 1);
    assert.strictEqual(toks[1].line, 2);
    assert.strictEqual(toks[1].column, 1);
  });

  it('EOF token has correct position after last token', () => {
    const toks = tokenize('hi');
    const eof = toks[toks.length - 1];
    assert.strictEqual(eof.type, TokenType.EOF);
    assert.strictEqual(eof.line, 1);
  });

  it('column tracking across multiple tokens on same line', () => {
    const toks = tokenize('a b c');
    assert.strictEqual(toks[0].column, 1);
    assert.strictEqual(toks[1].column, 3);
    assert.strictEqual(toks[2].column, 5);
  });
});

// ---------------------------------------------------------------------------
// 3.5 Comments
// ---------------------------------------------------------------------------

describe('comments', () => {
  it('line comment is skipped: // comment\\nidentifier', () => {
    const toks = tokenize('// comment\nidentifier');
    assert.strictEqual(toks.length, 2); // IDENTIFIER + EOF
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[0].value, 'identifier');
  });

  it('block comment is skipped: /* block */ identifier', () => {
    const toks = tokenize('/* block */ identifier');
    assert.strictEqual(toks.length, 2); // IDENTIFIER + EOF
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[0].value, 'identifier');
  });

  it('block comment spanning multiple lines: line tracking correct after', () => {
    const toks = tokenize('/* line1\nline2\n*/\nhello');
    assert.strictEqual(toks.length, 2); // IDENTIFIER + EOF
    assert.strictEqual(toks[0].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[0].line, 4);
  });

  it('line comment at end of file (no trailing newline) is skipped', () => {
    const toks = tokenize('// no newline at end');
    assert.strictEqual(toks.length, 1); // only EOF
    assert.strictEqual(toks[0].type, TokenType.EOF);
  });

  it('inline comment after tokens does not affect subsequent token', () => {
    const toks = tokenize('role // this is role\nplanner');
    assert.strictEqual(toks[0].type, TokenType.ROLE);
    assert.strictEqual(toks[1].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[1].value, 'planner');
  });
});

// ---------------------------------------------------------------------------
// 3.6 Error tokens
// ---------------------------------------------------------------------------

describe('error tokens', () => {
  it('unterminated string produces ERROR token', () => {
    const toks = tokenize('"hello');
    const errTok = toks[0];
    assert.strictEqual(errTok.type, TokenType.ERROR);
    assert.strictEqual(errTok.line, 1);
    assert.strictEqual(errTok.column, 1);
  });

  it('unterminated block comment produces ERROR token', () => {
    const toks = tokenize('/* no close');
    const errTok = toks[0];
    assert.strictEqual(errTok.type, TokenType.ERROR);
    assert.strictEqual(errTok.line, 1);
    assert.strictEqual(errTok.column, 1);
  });

  it('unterminated pattern literal produces ERROR token', () => {
    // A /.../ where the closing / is on a different line
    const toks = tokenize('/unclosed\nnext');
    // The / followed by 'u' looks like a pattern start, but closing / is not on same line
    const errTok = toks[0];
    assert.strictEqual(errTok.type, TokenType.ERROR);
  });

  it('unknown character @ produces ERROR token', () => {
    const toks = tokenize('@');
    assert.strictEqual(toks[0].type, TokenType.ERROR);
    assert.strictEqual(toks[0].value, '@');
  });

  it('unknown character # produces ERROR token', () => {
    const toks = tokenize('#');
    assert.strictEqual(toks[0].type, TokenType.ERROR);
    assert.strictEqual(toks[0].value, '#');
  });

  it('unknown character ~ produces ERROR token', () => {
    const toks = tokenize('~');
    assert.strictEqual(toks[0].type, TokenType.ERROR);
    assert.strictEqual(toks[0].value, '~');
  });

  it('lexer continues after error token (does not bail)', () => {
    const toks = tokenize('@hello');
    // ERROR('@') + IDENTIFIER('hello') + EOF
    assert.strictEqual(toks.length, 3);
    assert.strictEqual(toks[0].type, TokenType.ERROR);
    assert.strictEqual(toks[1].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[1].value, 'hello');
  });

  it('multiple error tokens in sequence', () => {
    const toks = tokenize('@#~');
    assert.strictEqual(toks.length, 4); // 3 ERROR + EOF
    assert.strictEqual(toks[0].type, TokenType.ERROR);
    assert.strictEqual(toks[1].type, TokenType.ERROR);
    assert.strictEqual(toks[2].type, TokenType.ERROR);
  });

  it('error token carries line/column position', () => {
    const toks = tokenize('hello @');
    const errTok = toks[1];
    assert.strictEqual(errTok.type, TokenType.ERROR);
    assert.strictEqual(errTok.line, 1);
    assert.strictEqual(errTok.column, 7);
  });
});

// ---------------------------------------------------------------------------
// 3.7 Realistic PDSL snippets
// ---------------------------------------------------------------------------

describe('realistic PDSL snippets', () => {
  it('tokenizes lifecycle Foo { role: planner }', () => {
    const toks = tokenize('lifecycle Foo { role: planner }');
    // Expected: lifecycle IDENTIFIER({ Foo ) LBRACE role COLON IDENTIFIER(planner) RBRACE EOF
    const expected = [
      TokenType.LIFECYCLE,
      TokenType.IDENTIFIER,
      TokenType.LBRACE,
      TokenType.ROLE,
      TokenType.COLON,
      TokenType.IDENTIFIER,
      TokenType.RBRACE,
      TokenType.EOF,
    ];
    assert.deepStrictEqual(types(toks), expected);
    assert.strictEqual(toks[1].value, 'Foo');
    assert.strictEqual(toks[5].value, 'planner');
  });

  it('tokenizes entity Task { id: string /TASK-\\d+/ } with PATTERN token', () => {
    const src = 'entity Task {\n  id: string /TASK-\\d+/\n}';
    const toks = tokenize(src);
    const typList = types(toks);
    assert.ok(typList.includes(TokenType.PATTERN), 'should contain PATTERN token');
    const patTok = toks.find(t => t.type === TokenType.PATTERN);
    assert.strictEqual(patTok.value, 'TASK-\\d+');
  });

  it('tokenizes relation Task -> Adventure { type: belongs_to } with ARROW', () => {
    const src = 'relation Task -> Adventure { type: belongs_to }';
    const toks = tokenize(src);
    const typList = types(toks);
    assert.ok(typList.includes(TokenType.ARROW), 'should contain ARROW token');
    assert.ok(typList.includes(TokenType.RELATION), 'should contain RELATION token');
    const arrowTok = toks.find(t => t.type === TokenType.ARROW);
    assert.strictEqual(arrowTok.value, '->');
  });

  it('tokenizes trigger expression with && and ==', () => {
    const src = 'task.status == "pending" && task.stage == "planning"';
    const toks = tokenize(src);
    const typList = types(toks).slice(0, -1); // exclude EOF
    assert.ok(typList.includes(TokenType.COMP_EQ), 'should have COMP_EQ');
    assert.ok(typList.includes(TokenType.LOGIC_AND), 'should have LOGIC_AND');
    assert.ok(typList.includes(TokenType.DOT), 'should have DOT');
  });

  it('tokenizes cardinality expression [0..*]', () => {
    const src = '[0..*]';
    const toks = tokenize(src).slice(0, -1);
    assert.deepStrictEqual(types(toks), [
      TokenType.LBRACKET,
      TokenType.NUMBER,
      TokenType.DOT_DOT,
      TokenType.STAR,
      TokenType.RBRACKET,
    ]);
  });

  it('tokenizes on success -> implementing transition rule', () => {
    const src = 'on success -> implementing';
    const toks = tokenize(src).slice(0, -1);
    assert.deepStrictEqual(types(toks), [
      TokenType.ON,
      TokenType.IDENTIFIER,
      TokenType.ARROW,
      TokenType.IDENTIFIER,
    ]);
    assert.strictEqual(toks[1].value, 'success');
    assert.strictEqual(toks[3].value, 'implementing');
  });

  it('tokenizes state enum field: state: active | blocked | completed', () => {
    const src = 'state: active | blocked | completed';
    const toks = tokenize(src).slice(0, -1);
    assert.deepStrictEqual(types(toks), [
      TokenType.STATE,
      TokenType.COLON,
      TokenType.IDENTIFIER,
      TokenType.PIPE,
      TokenType.IDENTIFIER,
      TokenType.PIPE,
      TokenType.IDENTIFIER,
    ]);
  });

  it('full lifecycle block tokenizes without errors', () => {
    const src = `lifecycle PlanningCycle {
  role: planner
  model: opus
}`;
    const toks = tokenize(src);
    const errorToks = toks.filter(t => t.type === TokenType.ERROR);
    assert.strictEqual(errorToks.length, 0, 'should have no error tokens');
    assert.ok(toks.some(t => t.type === TokenType.LIFECYCLE));
    assert.ok(toks.some(t => t.type === TokenType.ROLE));
    assert.ok(toks.some(t => t.type === TokenType.MODEL));
  });

  it('identifier with hyphens (adventure-planner) is single token', () => {
    const src = 'planning -> adventure-planner';
    const toks = tokenize(src).slice(0, -1);
    // IDENTIFIER ARROW IDENTIFIER
    assert.strictEqual(toks.length, 3);
    assert.strictEqual(toks[2].type, TokenType.IDENTIFIER);
    assert.strictEqual(toks[2].value, 'adventure-planner');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle parsing tests
// ---------------------------------------------------------------------------

describe('lifecycle parsing', () => {

  // Test 1: Minimal lifecycle -- empty body
  it('minimal lifecycle {} parses to LifecycleDecl with name and empty/null props', () => {
    const { program, errors } = parse('lifecycle Foo {}');
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    assert.strictEqual(program.body.length, 1);
    const decl = program.body[0];
    assert.strictEqual(decl.type, 'Lifecycle');
    assert.strictEqual(decl.name, 'Foo');
    assert.strictEqual(decl.role, null);
    assert.strictEqual(decl.model, null);
    assert.strictEqual(decl.trigger, null);
    assert.deepStrictEqual(decl.input, []);
    assert.deepStrictEqual(decl.execute, []);
    assert.deepStrictEqual(decl.transitions, []);
    assert.deepStrictEqual(decl.completion, []);
  });

  // Test 2: role and model fields
  it('parses role: and model: fields correctly', () => {
    const src = 'lifecycle Foo { role: planner  model: opus }';
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = program.body[0];
    assert.strictEqual(decl.role, 'planner');
    assert.strictEqual(decl.model, 'opus');
  });

  // Test 3: trigger with simple comparison
  it('parses trigger: with simple == comparison', () => {
    const src = 'lifecycle Foo { trigger: task.status == "pending" }';
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = program.body[0];
    assert.ok(decl.trigger, 'trigger should not be null');
    assert.strictEqual(decl.trigger.type, 'BinaryExpression');
    assert.strictEqual(decl.trigger.operator, '==');
    assert.strictEqual(decl.trigger.left.type, 'FieldRef');
    assert.deepStrictEqual(decl.trigger.left.segments, ['task', 'status']);
    assert.strictEqual(decl.trigger.right.type, 'Literal');
    assert.strictEqual(decl.trigger.right.value, 'pending');
  });

  // Test 4: trigger with && conjunction
  it('parses trigger: with && conjunction into LogicalExpression', () => {
    const src = 'lifecycle Foo { trigger: task.status == "pending" && task.stage == "planning" }';
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const trigger = program.body[0].trigger;
    assert.strictEqual(trigger.type, 'LogicalExpression');
    assert.strictEqual(trigger.operator, '&&');
    assert.strictEqual(trigger.left.type, 'BinaryExpression');
    assert.strictEqual(trigger.right.type, 'BinaryExpression');
    assert.deepStrictEqual(trigger.left.left.segments, ['task', 'status']);
    assert.deepStrictEqual(trigger.right.left.segments, ['task', 'stage']);
  });

  // Test 5: trigger with || disjunction
  it('parses trigger: with || disjunction into LogicalExpression with operator "||"', () => {
    const src = 'lifecycle Foo { trigger: a == "x" || b == "y" }';
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const trigger = program.body[0].trigger;
    assert.strictEqual(trigger.type, 'LogicalExpression');
    assert.strictEqual(trigger.operator, '||');
  });

  // Test 6: input block with read actions (path operands)
  it('parses input block with read actions producing ActionStep nodes', () => {
    const src = `lifecycle Foo {
  input {
    read .agent/config.md
    read .agent/tasks/task.md
  }
}`;
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = program.body[0];
    assert.strictEqual(decl.input.length, 2);
    assert.strictEqual(decl.input[0].type, 'Action');
    assert.strictEqual(decl.input[0].verb, 'read');
    assert.strictEqual(decl.input[1].verb, 'read');
    // Each has one path operand
    assert.strictEqual(decl.input[0].operands.length, 1);
    assert.strictEqual(decl.input[0].operands[0].type, 'Literal');
    assert.strictEqual(decl.input[0].operands[0].kind, 'path');
  });

  // Test 7: execute block with multiple verb types
  it('parses execute block with explore, write, update verbs', () => {
    const src = `lifecycle Foo {
  execute {
    explore codebase
    write .agent/designs/design.md
    update task.status -> "ready"
  }
}`;
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const steps = program.body[0].execute;
    assert.strictEqual(steps.length, 3);
    assert.strictEqual(steps[0].verb, 'explore');
    assert.strictEqual(steps[1].verb, 'write');
    assert.strictEqual(steps[2].verb, 'update');

    // 'explore codebase' -- codebase is a bare FieldRef operand
    assert.strictEqual(steps[0].operands.length, 1);
    assert.strictEqual(steps[0].operands[0].type, 'FieldRef');
    assert.deepStrictEqual(steps[0].operands[0].segments, ['codebase']);

    // 'write .agent/designs/design.md' -- path operand
    assert.strictEqual(steps[1].operands[0].type, 'Literal');
    assert.strictEqual(steps[1].operands[0].kind, 'path');

    // 'update task.status -> "ready"' -- FieldRef with assignment
    const updateOp = steps[2].operands[0];
    assert.strictEqual(updateOp.type, 'FieldRef');
    assert.deepStrictEqual(updateOp.segments, ['task', 'status']);
    assert.strictEqual(updateOp.assignment, 'ready');
  });

  // Test 8: transitions block with on/target rules
  it('parses transitions block producing TransitionRule nodes', () => {
    const src = `lifecycle Foo {
  transitions {
    on success -> implementing
    on error -> error
  }
}`;
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const rules = program.body[0].transitions;
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].type, 'Transition');
    assert.strictEqual(rules[0].on, 'success');
    assert.strictEqual(rules[0].target, 'implementing');
    assert.strictEqual(rules[1].on, 'error');
    assert.strictEqual(rules[1].target, 'error');
  });

  // Test 9: completion block with emit and log
  it('parses completion block with emit (FieldRef operand) and log (string operand)', () => {
    const src = `lifecycle Foo {
  completion {
    emit task.planned
    log "task done"
  }
}`;
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const steps = program.body[0].completion;
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].verb, 'emit');
    assert.strictEqual(steps[1].verb, 'log');

    // emit: FieldRef operand
    assert.strictEqual(steps[0].operands[0].type, 'FieldRef');
    assert.deepStrictEqual(steps[0].operands[0].segments, ['task', 'planned']);

    // log: string literal operand
    assert.strictEqual(steps[1].operands[0].type, 'Literal');
    assert.strictEqual(steps[1].operands[0].kind, 'string');
    assert.strictEqual(steps[1].operands[0].value, 'task done');
  });

  // Test 10: multiple lifecycles in one program
  it('parses two lifecycle declarations into Program.body with two entries', () => {
    const src = `lifecycle Alpha {}
lifecycle Beta { role: reviewer }`;
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    assert.strictEqual(program.body.length, 2);
    assert.strictEqual(program.body[0].name, 'Alpha');
    assert.strictEqual(program.body[1].name, 'Beta');
    assert.strictEqual(program.body[1].role, 'reviewer');
  });

  // Test 11: error recovery -- missing closing brace reports error
  it('missing closing brace reports a parse error', () => {
    const src = 'lifecycle Foo { role: planner';
    const { program, errors } = parse(src);
    // Should have at least one error (missing RBRACE)
    assert.ok(errors.length > 0, 'Expected at least one error for missing }');
  });

  // Test 12: unknown field in lifecycle body is skipped with error
  it('unknown field in lifecycle body is skipped and reported as error', () => {
    const src = 'lifecycle Foo { unknown foo }';
    const { program, errors } = parse(src);
    // Should have errors but still produce a Lifecycle node
    assert.ok(errors.length > 0, 'Expected errors for unknown field');
    assert.strictEqual(program.body[0].type, 'Lifecycle');
    assert.strictEqual(program.body[0].name, 'Foo');
  });

  // Test 13: full PlanningCycle example from grammar.md
  it('parses the full PlanningCycle example from grammar spec', () => {
    const src = `lifecycle PlanningCycle {
  role: planner
  model: opus
  trigger: task.status == "pending" && task.stage == "planning"

  input {
    read .agent/tasks/task.md
    read .agent/config.md
  }

  execute {
    explore codebase
    write .agent/designs/design.md
    update task.files
    update task.status -> "ready"
  }

  transitions {
    on success -> implementing
    on blocked -> wait
    on error -> error
  }

  completion {
    emit task.planned
    log "planner: design complete"
  }
}`;
    const { program, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = program.body[0];
    assert.strictEqual(decl.type, 'Lifecycle');
    assert.strictEqual(decl.name, 'PlanningCycle');
    assert.strictEqual(decl.role, 'planner');
    assert.strictEqual(decl.model, 'opus');
    assert.ok(decl.trigger !== null, 'trigger should be parsed');
    assert.strictEqual(decl.input.length, 2);
    assert.strictEqual(decl.execute.length, 4);
    assert.strictEqual(decl.transitions.length, 3);
    assert.strictEqual(decl.completion.length, 2);
    assert.strictEqual(decl.transitions[0].on, 'success');
    assert.strictEqual(decl.transitions[0].target, 'implementing');
  });
});

// ---------------------------------------------------------------------------
// Entity parsing tests (TC-003)
// ---------------------------------------------------------------------------

describe('entity parsing', () => {

  // Test 1: Minimal entity with empty body
  it('minimal entity {} parses to EntityDecl with name and empty fields', () => {
    const { ast, errors } = parse('entity Foo { }');
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    assert.strictEqual(ast.body.length, 1);
    const decl = ast.body[0];
    assert.strictEqual(decl.type, 'Entity');
    assert.strictEqual(decl.name, 'Foo');
    assert.deepStrictEqual(decl.fields, []);
  });

  // Test 2: Entity with simple string and reference fields
  it('entity with two simple fields produces two FieldDecl nodes', () => {
    const src = `entity Task {
  title: string
  stage: Stage
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.fields.length, 2);
    assert.strictEqual(decl.fields[0].type, 'Field');
    assert.strictEqual(decl.fields[0].name, 'title');
    assert.strictEqual(decl.fields[0].fieldType.kind, 'reference');
    assert.strictEqual(decl.fields[0].fieldType.name, 'string');
    assert.strictEqual(decl.fields[1].name, 'stage');
    assert.strictEqual(decl.fields[1].fieldType.name, 'Stage');
  });

  // Test 3: Entity field with pattern constraint
  it('entity field with pattern literal produces FieldDecl with pattern property', () => {
    const src = 'entity Task {\n  id: string /TASK-\\d+/\n}';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const field = ast.body[0].fields[0];
    assert.strictEqual(field.name, 'id');
    assert.ok(field.pattern !== null, 'pattern should be set');
    assert.strictEqual(field.pattern.type, 'Pattern');
    assert.strictEqual(field.pattern.regex, 'TASK-\\d+');
  });

  // Test 4: Entity field with optional marker
  it('entity field with ? suffix produces FieldDecl with optional=true', () => {
    const src = 'entity Task { adventure_id: Adventure? }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const field = ast.body[0].fields[0];
    assert.strictEqual(field.name, 'adventure_id');
    assert.strictEqual(field.optional, true);
    assert.strictEqual(field.fieldType.name, 'Adventure');
  });

  // Test 5: Entity field with default value
  it('entity field with = default produces FieldDecl with default literal', () => {
    const src = 'entity Task { iterations: number = 0 }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const field = ast.body[0].fields[0];
    assert.strictEqual(field.name, 'iterations');
    assert.ok(field.default !== null && field.default !== undefined, 'default should be set');
    assert.strictEqual(field.default.kind, 'number');
    assert.strictEqual(field.default.value, '0');
  });

  // Test 6: Entity field with cardinality [0..*]
  it('entity field with [0..*] cardinality produces Cardinality node', () => {
    const src = 'entity Task { depends_on: Task[0..*] }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const field = ast.body[0].fields[0];
    assert.strictEqual(field.name, 'depends_on');
    assert.ok(field.cardinality !== null, 'cardinality should be set');
    assert.strictEqual(field.cardinality.type, 'Cardinality');
    assert.strictEqual(field.cardinality.min, 0);
    assert.strictEqual(field.cardinality.max, Infinity);
    assert.strictEqual(field.cardinality.notation, '0..*');
  });

  // Test 7: Entity with values (enum) field
  it('entity with values: field produces FieldDecl with EnumType', () => {
    const src = 'entity Stage { values: planning | implementing | reviewing }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const field = ast.body[0].fields[0];
    assert.strictEqual(field.name, 'values');
    assert.strictEqual(field.fieldType.type, 'Enum');
    assert.deepStrictEqual(field.fieldType.values, ['planning', 'implementing', 'reviewing']);
  });

  // Test 8: Entity with keyword field names (id, type, state)
  it('entity field names that are keywords (id, state) are accepted', () => {
    const src = `entity Task {
  id: string
  state: Status
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const fields = ast.body[0].fields;
    assert.strictEqual(fields[0].name, 'id');
    assert.strictEqual(fields[1].name, 'state');
  });

  // Test 9: Entity field with all optional suffixes (pattern, ?, default, cardinality)
  it('entity field with all optional suffixes produces complete FieldDecl', () => {
    const src = 'entity X { f: string /abc/ ? = "default" [0..3] }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const field = ast.body[0].fields[0];
    assert.strictEqual(field.name, 'f');
    assert.ok(field.pattern !== null, 'pattern should be set');
    assert.strictEqual(field.optional, true);
    assert.ok(field.default !== null, 'default should be set');
    assert.strictEqual(field.default.value, 'default');
    assert.ok(field.cardinality !== null, 'cardinality should be set');
    assert.strictEqual(field.cardinality.min, 0);
    assert.strictEqual(field.cardinality.max, 3);
    assert.strictEqual(field.cardinality.notation, '0..3');
  });

  // Test 10: Full entity example from grammar.md (Task entity)
  it('parses the full Task entity from grammar spec correctly', () => {
    const src = `entity Task {
  id:               string /TASK-\\d+/
  title:            string
  stage:            Stage
  iterations:       number = 0
  depends_on:       Task[0..*]
  adventure_id:     Adventure?
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.type, 'Entity');
    assert.strictEqual(decl.name, 'Task');
    assert.strictEqual(decl.fields.length, 6);

    // id field: string type with pattern
    assert.strictEqual(decl.fields[0].name, 'id');
    assert.ok(decl.fields[0].pattern !== null);

    // title field: plain reference
    assert.strictEqual(decl.fields[1].name, 'title');
    assert.strictEqual(decl.fields[1].fieldType.kind, 'reference');

    // iterations field: default value
    assert.strictEqual(decl.fields[3].name, 'iterations');
    assert.strictEqual(decl.fields[3].default.value, '0');

    // depends_on field: cardinality
    assert.strictEqual(decl.fields[4].name, 'depends_on');
    assert.strictEqual(decl.fields[4].cardinality.notation, '0..*');

    // adventure_id field: optional
    assert.strictEqual(decl.fields[5].name, 'adventure_id');
    assert.strictEqual(decl.fields[5].optional, true);
  });
});

// ---------------------------------------------------------------------------
// Relation parsing tests (TC-003)
// ---------------------------------------------------------------------------

describe('relation parsing', () => {

  // Test 1: Simple relation with type, via, cardinality
  it('simple relation produces RelationDecl with correct source, target, fields', () => {
    const src = `relation Task -> Adventure {
  type: belongs_to
  via: adventure_id
  cardinality: 0..1
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    assert.strictEqual(ast.body.length, 1);
    const decl = ast.body[0];
    assert.strictEqual(decl.type, 'Relation');
    assert.strictEqual(decl.source, 'Task');
    assert.strictEqual(decl.target, 'Adventure');
    assert.strictEqual(decl.relationType, 'belongs_to');
    assert.deepStrictEqual(decl.via, { name: 'adventure_id', array: false });
    assert.strictEqual(decl.cardinality.notation, '0..1');
    assert.strictEqual(decl.cardinality.min, 0);
    assert.strictEqual(decl.cardinality.max, 1);
  });

  // Test 2: Relation with array via reference
  it('relation with via: tasks[] produces via with array=true', () => {
    const src = `relation Adventure -> Task {
  type: owns
  via: tasks[]
  cardinality: 1..*
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.deepStrictEqual(decl.via, { name: 'tasks', array: true });
    assert.strictEqual(decl.cardinality.notation, '1..*');
    assert.strictEqual(decl.cardinality.min, 1);
    assert.strictEqual(decl.cardinality.max, Infinity);
  });

  // Test 3: Relation with constraint field
  it('relation with constraint: no_cycles populates constraints array', () => {
    const src = `relation Task -> Task {
  type: depends_on
  constraint: no_cycles
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.relationType, 'depends_on');
    assert.deepStrictEqual(decl.constraints, ['no_cycles']);
  });

  // Test 4: Relation with lifecycle field
  it('relation with lifecycle: cascade_delete sets lifecycle property', () => {
    const src = `relation Adventure -> Task {
  lifecycle: cascade_delete
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.lifecycle, 'cascade_delete');
  });
});

// ---------------------------------------------------------------------------
// Error handling tests (TC-004)
// ---------------------------------------------------------------------------

describe('entity/relation error handling', () => {

  // Test 1: Missing closing brace for entity
  it('entity without closing brace produces non-empty errors array', () => {
    const { ast, errors } = parse('entity Foo {');
    assert.ok(errors.length > 0, 'Expected at least one error');
    // Should still produce an EntityDecl node (partial AST)
    assert.strictEqual(ast.body.length, 1);
    assert.strictEqual(ast.body[0].type, 'Entity');
  });

  // Test 2: Invalid field syntax -- number as field name
  it('number as entity field name reports error with line/column', () => {
    const { errors } = parse('entity Foo { 123: bad }');
    assert.ok(errors.length > 0, 'Expected at least one error');
    // Error should carry line and column info
    const err = errors[0];
    assert.ok(typeof err.line === 'number', 'Error should have line number');
    assert.ok(typeof err.column === 'number', 'Error should have column number');
  });

  // Test 3: Error recovery -- good entities still parse after bad one
  it('parse error in one entity does not prevent other entities from parsing', () => {
    const src = `entity Good { }
entity Bad {
relation A -> B { }`;
    const { ast, errors } = parse(src);
    // Should have errors
    assert.ok(errors.length > 0, 'Expected at least one error');
    // But Good entity should still parse
    const good = ast.body.find(n => n.type === 'Entity' && n.name === 'Good');
    assert.ok(good !== undefined, 'Good entity should be in AST');
    // Relation A -> B should also parse
    const rel = ast.body.find(n => n.type === 'Relation');
    assert.ok(rel !== undefined, 'Relation A -> B should be in AST');
    assert.strictEqual(rel.source, 'A');
    assert.strictEqual(rel.target, 'B');
  });
});

// ---------------------------------------------------------------------------
// Structure parsing tests (TC-002, TC-004)
// ---------------------------------------------------------------------------

describe('structure parsing', () => {

  // Test 1: Minimal structure -- empty body
  it('minimal structure {} parses to StructureDecl with name and empty sub-blocks', () => {
    const { ast, errors } = parse('structure Foo {}');
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    assert.strictEqual(ast.body.length, 1);
    const decl = ast.body[0];
    assert.strictEqual(decl.type, 'Structure');
    assert.strictEqual(decl.name, 'Foo');
    assert.strictEqual(decl.id, null);
    assert.strictEqual(decl.state, null);
    assert.deepStrictEqual(decl.contains, []);
    assert.deepStrictEqual(decl.spawns, []);
    assert.deepStrictEqual(decl.delegates, []);
    assert.deepStrictEqual(decl.checkpoints, []);
  });

  // Test 2: Structure with id field (identifier pattern ADV-{NNN})
  it('structure with id: TASK-{NNN} produces id as string "TASK-{NNN}"', () => {
    const src = 'structure Task { id: TASK-{NNN} }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.type, 'Structure');
    assert.strictEqual(decl.id, 'TASK-{NNN}');
  });

  // Test 3: Structure with state field (pipe-separated identifiers)
  it('structure with state: active | blocked produces EnumType with 2 values', () => {
    const src = 'structure Task { state: active | blocked }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.ok(decl.state !== null, 'state should not be null');
    assert.strictEqual(decl.state.type, 'Enum');
    assert.deepStrictEqual(decl.state.values, ['active', 'blocked']);
  });

  // Test 4: Contains block with directory path -> Type[cardinality]
  it('contains { designs/ -> Design[0..*] } produces ContainmentEntry with correct fields', () => {
    const src = 'structure X { contains { designs/ -> Design[0..*] } }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.contains.length, 1);
    const entry = decl.contains[0];
    assert.strictEqual(entry.type, 'Containment');
    assert.strictEqual(entry.path, 'designs/');
    assert.strictEqual(entry.targetType, 'Design');
    assert.ok(entry.cardinality !== null, 'cardinality should be set');
    assert.strictEqual(entry.cardinality.min, 0);
    assert.strictEqual(entry.cardinality.max, Infinity);
    assert.strictEqual(entry.cardinality.notation, '0..*');
  });

  // Test 5: Contains block with file path (dots)
  it('contains { manifest.md -> Manifest[1] } produces path "manifest.md" and cardinality {min:1,max:1}', () => {
    const src = 'structure X { contains { manifest.md -> Manifest[1] } }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const entry = ast.body[0].contains[0];
    assert.strictEqual(entry.path, 'manifest.md');
    assert.strictEqual(entry.targetType, 'Manifest');
    assert.strictEqual(entry.cardinality.min, 1);
    assert.strictEqual(entry.cardinality.max, 1);
    assert.strictEqual(entry.cardinality.notation, '1');
  });

  // Test 6: Spawns block
  it('spawns { Task[1..*] from plans } produces SpawnEntry with targetType="Task", source="plans"', () => {
    const src = 'structure X { spawns { Task[1..*] from plans } }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.spawns.length, 1);
    const entry = decl.spawns[0];
    assert.strictEqual(entry.type, 'Spawn');
    assert.strictEqual(entry.targetType, 'Task');
    assert.strictEqual(entry.source, 'plans');
    assert.ok(entry.cardinality !== null, 'cardinality should be set');
    assert.strictEqual(entry.cardinality.min, 1);
    assert.strictEqual(entry.cardinality.max, Infinity);
    assert.strictEqual(entry.cardinality.notation, '1..*');
  });

  // Test 7: Delegates block
  it('delegates { planning -> adventure-planner } produces DelegationEntry with stage and role', () => {
    const src = 'structure X { delegates { planning -> adventure-planner } }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.delegates.length, 1);
    const entry = decl.delegates[0];
    assert.strictEqual(entry.type, 'Delegation');
    assert.strictEqual(entry.stage, 'planning');
    assert.strictEqual(entry.role, 'adventure-planner');
  });

  // Test 8: Checkpoints block
  it('checkpoints { concept -> planning: "user approves concept" } produces CheckpointEntry', () => {
    const src = 'structure X { checkpoints { concept -> planning: "user approves concept" } }';
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.checkpoints.length, 1);
    const entry = decl.checkpoints[0];
    assert.strictEqual(entry.type, 'Checkpoint');
    assert.strictEqual(entry.fromState, 'concept');
    assert.strictEqual(entry.toState, 'planning');
    assert.strictEqual(entry.condition, 'user approves concept');
  });

  // Test 9: Full Adventure structure with all sub-blocks
  it('full Adventure structure with all sub-blocks parses without error and has correct counts', () => {
    const src = `structure Adventure {
  id: ADV-{NNN}
  state: concept | planning | implementing | completed

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
    implementing -> implementer
  }

  checkpoints {
    concept -> planning: "user approves concept"
    planning -> implementing: "user reviews plan"
  }
}`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    const decl = ast.body[0];
    assert.strictEqual(decl.type, 'Structure');
    assert.strictEqual(decl.name, 'Adventure');
    assert.strictEqual(decl.id, 'ADV-{NNN}');
    assert.ok(decl.state !== null, 'state should not be null');
    assert.strictEqual(decl.state.values.length, 4);
    assert.strictEqual(decl.contains.length, 3);
    assert.strictEqual(decl.spawns.length, 1);
    assert.strictEqual(decl.delegates.length, 2);
    assert.strictEqual(decl.checkpoints.length, 2);
  });

  // Test 10: Error: missing closing brace reports error with line/column
  it('structure with missing closing brace produces parse error with line and column', () => {
    const src = 'structure Foo { state: active | blocked';
    const { errors } = parse(src);
    assert.ok(errors.length > 0, 'Expected at least one error for missing }');
    const err = errors[0];
    assert.ok(typeof err.line === 'number', 'Error should have line number');
    assert.ok(typeof err.column === 'number', 'Error should have column number');
  });

  // Test 11: Multiple structures in same file
  it('two structure declarations in same file both appear in Program.body', () => {
    const src = `structure Alpha {}
structure Beta { state: a | b }`;
    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    assert.strictEqual(ast.body.length, 2);
    assert.strictEqual(ast.body[0].type, 'Structure');
    assert.strictEqual(ast.body[0].name, 'Alpha');
    assert.strictEqual(ast.body[1].type, 'Structure');
    assert.strictEqual(ast.body[1].name, 'Beta');
    assert.ok(ast.body[1].state !== null, 'Beta state should not be null');
    assert.deepStrictEqual(ast.body[1].state.values, ['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// Integration test: full multi-declaration program (TC-003)
// ---------------------------------------------------------------------------

describe('full PDSL program integration', () => {

  it('parses entity Task, entity Stage, entity Status, and three relations', () => {
    const src = `entity Task {
  id: string /TASK-\\d+/
  title: string
  stage: Stage
  iterations: number = 0
  depends_on: Task[0..*]
  adventure_id: Adventure?
}

entity Stage {
  values: planning | implementing | reviewing | fixing | completed | researching
}

entity Status {
  values: pending | in_progress | ready | blocked
}

relation Task -> Adventure {
  type: belongs_to
  via: adventure_id
  cardinality: 0..1
}

relation Task -> Task {
  type: depends_on
  via: depends_on
  cardinality: 0..*
  constraint: no_cycles
}

relation Adventure -> Task {
  type: owns
  via: tasks[]
  cardinality: 1..*
  lifecycle: cascade_delete
}`;

    const { ast, errors } = parse(src);
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);

    const entities = ast.body.filter(n => n.type === 'Entity');
    const relations = ast.body.filter(n => n.type === 'Relation');

    assert.strictEqual(entities.length, 3);
    assert.strictEqual(relations.length, 3);

    // Verify entity names
    assert.strictEqual(entities[0].name, 'Task');
    assert.strictEqual(entities[1].name, 'Stage');
    assert.strictEqual(entities[2].name, 'Status');

    // Verify Stage has values field with enum
    const stageValues = entities[1].fields[0];
    assert.strictEqual(stageValues.name, 'values');
    assert.strictEqual(stageValues.fieldType.type, 'Enum');
    assert.ok(stageValues.fieldType.values.includes('planning'));
    assert.ok(stageValues.fieldType.values.includes('completed'));

    // Verify relation sources/targets
    assert.strictEqual(relations[0].source, 'Task');
    assert.strictEqual(relations[0].target, 'Adventure');
    assert.strictEqual(relations[1].source, 'Task');
    assert.strictEqual(relations[1].target, 'Task');
    assert.strictEqual(relations[2].source, 'Adventure');
    assert.strictEqual(relations[2].target, 'Task');

    // Verify lifecycle on third relation
    assert.strictEqual(relations[2].lifecycle, 'cascade_delete');

    // Verify constraint on second relation
    assert.deepStrictEqual(relations[1].constraints, ['no_cycles']);
  });
});
