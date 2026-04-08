'use strict';

const {
  TokenType, KEYWORDS, createToken,
  Program, LifecycleDecl, StructureDecl, EntityDecl, RelationDecl,
  FieldDecl, PatternLiteral, EnumType, TypeExpression, Cardinality, Literal,
  TransitionRule, ActionStep,
  ContainmentEntry, SpawnEntry, DelegationEntry, CheckpointEntry,
  BinaryExpression, LogicalExpression, FieldRef,
  loc,
} = require('./ast');

// ---------------------------------------------------------------------------
// Lexer helpers
// ---------------------------------------------------------------------------

// Identifier start: letter or underscore
function isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') ||
         (ch >= 'A' && ch <= 'Z') ||
         ch === '_';
}

// Identifier continue: letter, digit, underscore, or hyphen
function isIdentContinue(ch) {
  return (ch >= 'a' && ch <= 'z') ||
         (ch >= 'A' && ch <= 'Z') ||
         (ch >= '0' && ch <= '9') ||
         ch === '_' ||
         ch === '-';
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

// ---------------------------------------------------------------------------
// tokenize(source) -- single-pass lexer
//
// Returns an array of Token objects (plain {type, value, line, column}).
// Never throws. Unknown or unterminated constructs produce ERROR tokens.
// ---------------------------------------------------------------------------

function tokenize(source) {
  const tokens = [];
  let pos    = 0;
  let line   = 1;
  let column = 1;

  const len = source.length;

  function peek(offset = 0) {
    return source[pos + offset];
  }

  function advance() {
    const ch = source[pos];
    pos++;
    if (ch === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
    return ch;
  }

  // Advance pos/line/col by a known number of characters (no newlines expected)
  function advanceBy(n) {
    for (let i = 0; i < n; i++) advance();
  }

  function emit(type, value, startLine, startCol) {
    tokens.push(createToken(type, value, startLine, startCol));
  }

  // Track whether the most recent consumed character(s) included whitespace.
  // Used to distinguish PATTERN literal (/regex/) from path SLASH:
  // a '/' preceded by whitespace can start a pattern; one immediately
  // after an identifier character is a path separator.
  let prevWasSpace = true; // start as true so leading '/' can be a pattern

  while (pos < len) {
    const startLine = line;
    const startCol  = column;
    const ch        = source[pos];

    // ------------------------------------------------------------------
    // 1. Whitespace (skip, but track newlines)
    // ------------------------------------------------------------------
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      prevWasSpace = true;
      // Handle \r\n as a single newline
      if (ch === '\r' && peek(1) === '\n') {
        pos++;    // skip \r (column not changed; \n will increment line)
        column++; // actually: \r doesn't change line, just advance position
      }
      advance();
      continue;
    }

    // Capture prevWasSpace before resetting it.
    // Used below for PATTERN literal vs SLASH disambiguation.
    const wasPrecededBySpace = prevWasSpace;
    // After handling whitespace (which sets prevWasSpace=true and continues),
    // any non-whitespace token resets the flag to false.
    prevWasSpace = false;

    // ------------------------------------------------------------------
    // 2. Line comment: //
    // ------------------------------------------------------------------
    if (ch === '/' && peek(1) === '/') {
      // Consume to end of line (skip, do not emit)
      while (pos < len && source[pos] !== '\n') {
        pos++;
        column++;
      }
      continue;
    }

    // ------------------------------------------------------------------
    // 3. Block comment: /* ... */
    // ------------------------------------------------------------------
    if (ch === '/' && peek(1) === '*') {
      const errLine = startLine;
      const errCol  = startCol;
      pos += 2; column += 2; // consume /*
      let closed = false;
      while (pos < len) {
        if (source[pos] === '*' && source[pos + 1] === '/') {
          pos += 2; column += 2;
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        emit(TokenType.ERROR, '/* (unterminated block comment)', errLine, errCol);
      }
      continue;
    }

    // ------------------------------------------------------------------
    // 4. String literal: "..."
    // ------------------------------------------------------------------
    if (ch === '"') {
      pos++; column++; // consume opening "
      let str = '';
      let terminated = false;
      while (pos < len) {
        const c = source[pos];
        if (c === '"') {
          pos++; column++;
          terminated = true;
          break;
        }
        str += c;
        advance();
      }
      if (!terminated) {
        emit(TokenType.ERROR, '"' + str + ' (unterminated string)', startLine, startCol);
      } else {
        emit(TokenType.STRING, str, startLine, startCol);
      }
      continue;
    }

    // ------------------------------------------------------------------
    // 5. Pattern literal or SLASH: /
    // /content/ on same line = PATTERN; bare / = SLASH
    // ------------------------------------------------------------------
    if (ch === '/') {
      // Check if this looks like a pattern literal:
      // - must be preceded by whitespace (prevWasSpace) -- a / immediately after
      //   an identifier is a path separator, not a pattern delimiter
      // - the next character must be non-whitespace and non-/
      // - there must be a closing / on the same line
      const nextCh = peek(1);
      const isPatternStart = wasPrecededBySpace &&
                             nextCh !== undefined &&
                             nextCh !== ' ' && nextCh !== '\t' &&
                             nextCh !== '\r' && nextCh !== '\n' &&
                             nextCh !== '/'; // avoid matching // (line comment, handled above)

      if (isPatternStart) {
        // Look ahead for closing / on same line
        let scanPos = pos + 1;
        let found = false;
        while (scanPos < len && source[scanPos] !== '\n') {
          if (source[scanPos] === '/') {
            found = true;
            break;
          }
          scanPos++;
        }

        if (found) {
          // Consume as PATTERN
          pos++; column++; // skip opening /
          let body = '';
          while (pos < len && source[pos] !== '/' && source[pos] !== '\n') {
            body += source[pos];
            advance();
          }
          if (pos < len && source[pos] === '/') {
            pos++; column++; // skip closing /
            emit(TokenType.PATTERN, body, startLine, startCol);
          } else {
            // No closing / on same line (shouldn't reach here due to lookahead, but safety)
            emit(TokenType.ERROR, '/' + body + ' (unterminated pattern)', startLine, startCol);
          }
          continue;
        }

        // isPatternStart is true (non-whitespace follows /) but no closing / on same line
        // Consume until end of line and emit as ERROR
        pos++; column++; // skip opening /
        let errBody = '';
        while (pos < len && source[pos] !== '\n') {
          errBody += source[pos];
          advance();
        }
        emit(TokenType.ERROR, '/' + errBody + ' (unterminated pattern)', startLine, startCol);
        continue;
      }

      // Bare slash (path separator -- / followed by whitespace or end of input)
      pos++; column++;
      emit(TokenType.SLASH, '/', startLine, startCol);
      continue;
    }

    // ------------------------------------------------------------------
    // 6. Number literal: [0-9]+
    // ------------------------------------------------------------------
    if (isDigit(ch)) {
      let num = '';
      while (pos < len && isDigit(source[pos])) {
        num += source[pos];
        advance();
      }
      emit(TokenType.NUMBER, num, startLine, startCol);
      continue;
    }

    // ------------------------------------------------------------------
    // 7. Identifiers and keywords: [a-zA-Z_][a-zA-Z0-9_-]*
    // ------------------------------------------------------------------
    if (isIdentStart(ch)) {
      let word = '';
      while (pos < len && isIdentContinue(source[pos])) {
        word += source[pos];
        advance();
      }
      if (KEYWORDS.has(word)) {
        emit(word, word, startLine, startCol); // keyword type IS the keyword string
      } else {
        emit(TokenType.IDENTIFIER, word, startLine, startCol);
      }
      continue;
    }

    // ------------------------------------------------------------------
    // 8. Multi-character operators (longer before shorter)
    // ------------------------------------------------------------------
    const ch2 = ch + (peek(1) || '');

    if (ch2 === '->') { advanceBy(2); emit(TokenType.ARROW,     '->', startLine, startCol); continue; }
    if (ch2 === '..') { advanceBy(2); emit(TokenType.DOT_DOT,   '..', startLine, startCol); continue; }
    if (ch2 === '==') { advanceBy(2); emit(TokenType.COMP_EQ,   '==', startLine, startCol); continue; }
    if (ch2 === '!=') { advanceBy(2); emit(TokenType.COMP_NE,   '!=', startLine, startCol); continue; }
    if (ch2 === '<=') { advanceBy(2); emit(TokenType.COMP_LE,   '<=', startLine, startCol); continue; }
    if (ch2 === '>=') { advanceBy(2); emit(TokenType.COMP_GE,   '>=', startLine, startCol); continue; }
    if (ch2 === '&&') { advanceBy(2); emit(TokenType.LOGIC_AND, '&&', startLine, startCol); continue; }
    if (ch2 === '||') { advanceBy(2); emit(TokenType.LOGIC_OR,  '||', startLine, startCol); continue; }

    // ------------------------------------------------------------------
    // 9. Single-character operators and punctuation
    // ------------------------------------------------------------------
    switch (ch) {
      case '=': advance(); emit(TokenType.EQUALS,   '=', startLine, startCol); break;
      case ':': advance(); emit(TokenType.COLON,    ':', startLine, startCol); break;
      case '|': advance(); emit(TokenType.PIPE,     '|', startLine, startCol); break;
      case '?': advance(); emit(TokenType.QUESTION, '?', startLine, startCol); break;
      case '.': advance(); emit(TokenType.DOT,      '.', startLine, startCol); break;
      case '*': advance(); emit(TokenType.STAR,     '*', startLine, startCol); break;
      case '<': advance(); emit(TokenType.COMP_LT,  '<', startLine, startCol); break;
      case '>': advance(); emit(TokenType.COMP_GT,  '>', startLine, startCol); break;
      case '{': advance(); emit(TokenType.LBRACE,   '{', startLine, startCol); break;
      case '}': advance(); emit(TokenType.RBRACE,   '}', startLine, startCol); break;
      case '[': advance(); emit(TokenType.LBRACKET, '[', startLine, startCol); break;
      case ']': advance(); emit(TokenType.RBRACKET, ']', startLine, startCol); break;
      case '(': advance(); emit(TokenType.LPAREN,   '(', startLine, startCol); break;
      case ')': advance(); emit(TokenType.RPAREN,   ')', startLine, startCol); break;
      case ',': advance(); emit(TokenType.COMMA,    ',', startLine, startCol); break;

      // ------------------------------------------------------------------
      // 10. Unknown character -- emit ERROR, continue
      // ------------------------------------------------------------------
      default:
        advance();
        emit(TokenType.ERROR, ch, startLine, startCol);
        break;
    }
  }

  // Always end with EOF
  emit(TokenType.EOF, '', line, column);
  return tokens;
}

// ---------------------------------------------------------------------------
// Known action verbs -- used to detect action step boundaries
// ---------------------------------------------------------------------------

const KNOWN_VERBS = new Set(['read', 'write', 'update', 'explore', 'emit', 'log']);

// ---------------------------------------------------------------------------
// Parser class -- recursive-descent parser for PDSL
// ---------------------------------------------------------------------------

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.errors = [];
  }

  // ---- Cursor helpers -------------------------------------------------------

  peek() {
    return this.tokens[this.pos];
  }

  advance() {
    const tok = this.tokens[this.pos];
    if (tok.type !== TokenType.EOF) {
      this.pos++;
    }
    return tok;
  }

  check(type) {
    return this.peek().type === type;
  }

  // Consume current token if it matches type; otherwise record an error and
  // return a synthetic error token so parsing can continue.
  expect(type) {
    const tok = this.peek();
    if (tok.type === type) {
      return this.advance();
    }
    this.errors.push({
      message: `Expected '${type}' but got '${tok.type}' ('${tok.value}')`,
      line: tok.line,
      column: tok.column,
    });
    // Return a synthetic token so callers get a usable value
    return { type, value: '', line: tok.line, column: tok.column };
  }

  // Return true and advance if current token matches type
  match(type) {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  // ---- Top-level dispatch ---------------------------------------------------

  parseProgram() {
    const firstTok = this.peek();
    const body = [];
    while (!this.check(TokenType.EOF)) {
      if (this.check(TokenType.LIFECYCLE)) {
        body.push(this.parseLifecycle());
      } else if (this.check(TokenType.ENTITY)) {
        body.push(this.parseEntityDecl());
      } else if (this.check(TokenType.RELATION)) {
        const decl = this.parseRelationDecl();
        if (decl) body.push(decl);
      } else if (this.check(TokenType.STRUCTURE)) {
        body.push(this.parseStructure());
      } else {
        // Unknown top-level token -- skip with error
        const tok = this.peek();
        this.errors.push({
          message: `Unexpected token '${tok.type}' ('${tok.value}') at top level`,
          line: tok.line,
          column: tok.column,
        });
        this.advance();
      }
    }
    const lastTok = this.tokens[this.pos]; // EOF
    return Program(body, [], loc(firstTok, lastTok));
  }

  // ---- Lifecycle ------------------------------------------------------------

  parseLifecycle() {
    const start = this.expect(TokenType.LIFECYCLE);
    const nameToken = this.expect(TokenType.IDENTIFIER);
    const name = nameToken.value;
    this.expect(TokenType.LBRACE);

    const props = {
      role: null,
      model: null,
      trigger: null,
      input: [],
      execute: [],
      transitions: [],
      completion: [],
    };

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.ROLE)) {
        this.parseLifecycleField(props, 'role');
      } else if (this.check(TokenType.MODEL)) {
        this.parseLifecycleField(props, 'model');
      } else if (this.check(TokenType.TRIGGER)) {
        this.parseLifecycleTrigger(props);
      } else if (this.check(TokenType.INPUT)) {
        props.input = this.parseActionBlock();
      } else if (this.check(TokenType.EXECUTE)) {
        props.execute = this.parseActionBlock();
      } else if (this.check(TokenType.COMPLETION)) {
        props.completion = this.parseActionBlock();
      } else if (this.check(TokenType.TRANSITIONS)) {
        props.transitions = this.parseTransitionsBlock();
      } else {
        // Unknown field -- record error and skip
        const tok = this.peek();
        this.errors.push({
          message: `Unexpected token '${tok.type}' ('${tok.value}') in lifecycle body`,
          line: tok.line,
          column: tok.column,
        });
        this.advance();
      }
    }

    const end = this.expect(TokenType.RBRACE);
    return LifecycleDecl(name, props, loc(start, end));
  }

  // Parse a simple key-value lifecycle field: keyword ':' identifier
  parseLifecycleField(props, field) {
    this.advance(); // consume the keyword (role / model)
    this.expect(TokenType.COLON);
    const valueTok = this.expect(TokenType.IDENTIFIER);
    props[field] = valueTok.value;
  }

  // Parse trigger: expression
  parseLifecycleTrigger(props) {
    this.advance(); // consume 'trigger'
    this.expect(TokenType.COLON);
    props.trigger = this.parseExpression();
  }

  // ---- Action blocks --------------------------------------------------------

  // Shared by input{}, execute{}, completion{}.
  parseActionBlock() {
    this.advance(); // consume block keyword (input / execute / completion)
    this.expect(TokenType.LBRACE);
    const steps = [];
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      steps.push(this.parseActionStep());
    }
    this.expect(TokenType.RBRACE);
    return steps;
  }

  // An action step is: Verb Operand+
  // Verb is an IDENTIFIER whose value is in KNOWN_VERBS (or any unknown identifier
  // at action-step position -- forward compatible).
  parseActionStep() {
    const start = this.peek();
    const verbTok = this.advance(); // consume the verb identifier
    const verb = verbTok.value;
    const operands = [];

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      // If the next token is an identifier that is a known verb, start a new step.
      // Exception: DOT at start of path (e.g., .agent/...) is not a verb.
      if (this.check(TokenType.IDENTIFIER) && KNOWN_VERBS.has(this.peek().value) && operands.length > 0) {
        break;
      }
      // An identifier that is a keyword (like 'input', 'execute', etc.) signals
      // the end of this action step.
      if (this.isBlockKeyword()) {
        break;
      }
      operands.push(this.parseOperand());
    }

    const endPos = this.pos > 0 ? this.pos - 1 : 0;
    return ActionStep(verb, operands, loc(start, this.tokens[endPos]));
  }

  // Returns true if the current token is a top-level declaration keyword.
  // Used for entity body loop exit -- prevents consuming top-level keywords as field names.
  isTopLevelKeyword() {
    const t = this.peek().type;
    return t === TokenType.ENTITY ||
           t === TokenType.RELATION ||
           t === TokenType.LIFECYCLE ||
           t === TokenType.STRUCTURE;
  }

  // Returns true if the current token is a keyword that starts a lifecycle block
  isBlockKeyword() {
    const t = this.peek().type;
    return t === TokenType.INPUT ||
           t === TokenType.EXECUTE ||
           t === TokenType.COMPLETION ||
           t === TokenType.TRANSITIONS ||
           t === TokenType.ROLE ||
           t === TokenType.MODEL ||
           t === TokenType.TRIGGER;
  }

  // ---- Operand parsing ------------------------------------------------------

  parseOperand() {
    const start = this.peek();

    // String literal
    if (this.check(TokenType.STRING)) {
      const tok = this.advance();
      return Literal('string', tok.value, loc(tok, tok));
    }

    // Path starting with DOT (e.g., .agent/tasks/...)
    if (this.check(TokenType.DOT)) {
      return this.parseDotPath();
    }

    // Identifier -- could be a FieldRef (with dots) or start of PathExpr (with slashes)
    // or a bare identifier operand (e.g., 'codebase')
    if (this.check(TokenType.IDENTIFIER)) {
      return this.parseIdentOrFieldRefOrPath();
    }

    // Star (glob)
    if (this.check(TokenType.STAR)) {
      const tok = this.advance();
      return Literal('path', '*', loc(tok, tok));
    }

    // Fallback -- consume and emit error
    const tok = this.advance();
    this.errors.push({
      message: `Unexpected token '${tok.type}' ('${tok.value}') in operand position`,
      line: tok.line,
      column: tok.column,
    });
    return Literal('error', tok.value, loc(tok, tok));
  }

  // Parse a path that starts with '.' (e.g., .agent/tasks/{task.id}.md)
  parseDotPath() {
    const start = this.peek();
    let path = '';

    // Consume initial dot
    this.advance(); // DOT
    path += '.';

    // Consume the segment after the dot (identifier)
    if (this.check(TokenType.IDENTIFIER)) {
      path += this.advance().value;
    }

    // Continue consuming path segments separated by slashes
    path = this.consumePathSegments(path, start);

    return Literal('path', path, loc(start, this.tokens[this.pos - 1]));
  }

  // Parse: identifier, then check for dots (FieldRef), slashes (PathExpr), or nothing (bare ident)
  parseIdentOrFieldRefOrPath() {
    const start = this.peek();
    const firstIdent = this.advance(); // IDENTIFIER
    let accum = firstIdent.value;

    // If followed by SLASH, it's a path (e.g., 'designs/')
    if (this.check(TokenType.SLASH)) {
      accum = this.consumePathSegments(accum, start);
      return Literal('path', accum, loc(start, this.tokens[this.pos - 1]));
    }

    // Collect dot-separated segments to build a field ref (e.g., task.status, task.id)
    const segments = [firstIdent.value];
    while (this.check(TokenType.DOT)) {
      // Lookahead: could be another field segment or start of a path extension like .md
      this.advance(); // consume DOT
      if (this.check(TokenType.IDENTIFIER)) {
        segments.push(this.advance().value);
      } else {
        // Dot not followed by identifier -- could be e.g. ".md" extension in a path
        // Put the dot into the path-like string and finish
        accum = segments.join('.') + '.';
        if (this.check(TokenType.IDENTIFIER)) {
          accum += this.advance().value;
        }
        // Check for more path segments
        if (this.check(TokenType.SLASH)) {
          accum = this.consumePathSegments(accum, start);
          return Literal('path', accum, loc(start, this.tokens[this.pos - 1]));
        }
        return Literal('path', accum, loc(start, this.tokens[this.pos - 1]));
      }

      // After collecting a dot-segment, if we see a slash, switch to path mode
      if (this.check(TokenType.SLASH)) {
        accum = segments.join('.');
        accum = this.consumePathSegments(accum, start);
        return Literal('path', accum, loc(start, this.tokens[this.pos - 1]));
      }
    }

    // If we have more than one segment, it's a FieldRef (e.g., task.status)
    if (segments.length > 1) {
      // Check for optional -> "value" assignment
      let assignment = null;
      if (this.check(TokenType.ARROW)) {
        this.advance(); // consume ->
        if (this.check(TokenType.STRING)) {
          assignment = this.advance().value;
        } else {
          this.errors.push({
            message: `Expected string literal after '->' in field ref assignment`,
            line: this.peek().line,
            column: this.peek().column,
          });
        }
      }
      const ref = FieldRef(segments, loc(start, this.tokens[this.pos - 1]));
      if (assignment !== null) {
        ref.assignment = assignment;
      }
      return ref;
    }

    // Single bare identifier (e.g., 'codebase')
    return FieldRef([firstIdent.value], loc(start, firstIdent));
  }

  // Consume path segments after an initial segment has been parsed.
  // Handles: /segment, /{interp}, /* (glob), .ext
  // Returns the accumulated path string.
  consumePathSegments(initial, startTok) {
    let path = initial;

    while (this.check(TokenType.SLASH)) {
      this.advance(); // consume /
      path += '/';

      // Path segment: { interp }, *, or identifier
      if (this.check(TokenType.LBRACE)) {
        this.advance(); // consume {
        path += '{';
        // Inside interpolation: can be "task.id" (identifier DOT identifier)
        if (this.check(TokenType.IDENTIFIER)) {
          path += this.advance().value;
        }
        while (this.check(TokenType.DOT)) {
          this.advance(); // consume .
          path += '.';
          if (this.check(TokenType.IDENTIFIER)) {
            path += this.advance().value;
          }
        }
        this.expect(TokenType.RBRACE);
        path += '}';
        // After interpolation: could be .ext (e.g., {task.id}.md)
        if (this.check(TokenType.DOT)) {
          this.advance(); // consume .
          path += '.';
          if (this.check(TokenType.IDENTIFIER)) {
            path += this.advance().value;
          }
        }
      } else if (this.check(TokenType.STAR)) {
        this.advance(); // consume *
        path += '*';
      } else if (this.check(TokenType.IDENTIFIER)) {
        path += this.advance().value;
        // Allow .ext suffix (e.g., config.md)
        if (this.check(TokenType.DOT)) {
          this.advance(); // consume .
          path += '.';
          if (this.check(TokenType.IDENTIFIER)) {
            path += this.advance().value;
          }
        }
        // Allow hyphenated segment continuation (design.md already consumed above,
        // but handle cases like {task.id}-design.md where - is part of ident)
      } else {
        // Empty segment after slash -- could be trailing slash, just leave path as is
      }
    }

    // Also consume a trailing file extension if we ended on an identifier (no slash)
    // e.g., identifier followed by .ext without a slash -- this is handled in the caller

    return path;
  }

  // ---- Entity/Relation helpers -----------------------------------------------

  // Accept an IDENTIFIER or any keyword token as a "name".
  // Handles field names like `id`, `type`, `state` emitted as keyword tokens.
  expectIdentifierOrKeyword() {
    const tok = this.peek();
    if (tok.type === TokenType.IDENTIFIER || KEYWORDS.has(tok.type)) {
      return this.advance();
    }
    this.errors.push({
      message: `Expected identifier but got '${tok.type}' ('${tok.value}')`,
      line: tok.line,
      column: tok.column,
    });
    return null;
  }

  // Skip the block body including opening brace and all nested content.
  skipBlock() {
    if (!this.check(TokenType.LBRACE)) {
      while (!this.check(TokenType.EOF) && !this.check(TokenType.LBRACE) &&
             !this.check(TokenType.LIFECYCLE) && !this.check(TokenType.ENTITY) &&
             !this.check(TokenType.RELATION) && !this.check(TokenType.STRUCTURE)) {
        this.advance();
      }
      if (!this.check(TokenType.LBRACE)) return;
    }
    this.advance(); // consume opening '{'
    let depth = 1;
    while (depth > 0 && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.LBRACE)) {
        depth++;
        this.advance();
      } else if (this.check(TokenType.RBRACE)) {
        depth--;
        this.advance();
      } else {
        this.advance();
      }
    }
  }

  // Skip to and consume the end of a declaration block (error recovery).
  skipToEndOfBlock() {
    let depth = 0;
    while (!this.check(TokenType.EOF)) {
      if (this.check(TokenType.LBRACE)) {
        depth++;
        this.advance();
      } else if (this.check(TokenType.RBRACE)) {
        if (depth === 0) {
          this.advance();
          break;
        }
        depth--;
        this.advance();
      } else {
        this.advance();
      }
    }
  }

  // ---- TypeExpr parser -------------------------------------------------------

  // Grammar: EnumValues / TypeRef  (EnumValues = Identifier (Pipe Identifier)*)
  // Single identifier = 'reference'; pipe-separated = 'enum'.
  parseTypeExpr() {
    const startTok = this.peek();
    const first = this.expectIdentifierOrKeyword();
    if (!first) return null;

    if (this.check(TokenType.PIPE)) {
      const values = [first.value];
      while (this.match(TokenType.PIPE)) {
        const next = this.expectIdentifierOrKeyword();
        if (next) values.push(next.value);
      }
      return TypeExpression('enum', null, values, loc(startTok, this.tokens[this.pos - 1]));
    }

    // Single identifier -- treat as reference
    return TypeExpression('reference', first.value, null, loc(startTok, first));
  }

  // ---- Cardinality parser ----------------------------------------------------

  // Grammar: LBracket NumberLiteral (DotDot (Star / NumberLiteral))? RBracket
  parseCardinality() {
    const startTok = this.peek();
    if (!this.match(TokenType.LBRACKET)) return null;

    const minTok = this.expect(TokenType.NUMBER);
    if (!minTok || !minTok.value) {
      while (!this.check(TokenType.EOF) && !this.check(TokenType.RBRACKET)) this.advance();
      this.match(TokenType.RBRACKET);
      return null;
    }
    const min = parseInt(minTok.value, 10);

    let max, notation;
    if (this.match(TokenType.DOT_DOT)) {
      if (this.match(TokenType.STAR)) {
        max = Infinity;
        notation = `${min}..*`;
      } else {
        const maxTok = this.expect(TokenType.NUMBER);
        if (!maxTok || !maxTok.value) {
          while (!this.check(TokenType.EOF) && !this.check(TokenType.RBRACKET)) this.advance();
          this.match(TokenType.RBRACKET);
          return null;
        }
        max = parseInt(maxTok.value, 10);
        notation = `${min}..${max}`;
      }
    } else {
      max = min;
      notation = `${min}`;
    }

    this.expect(TokenType.RBRACKET);
    return Cardinality(min, max, notation, loc(startTok, this.tokens[this.pos - 1]));
  }

  // Bare cardinality notation (no brackets), used in relation body.
  // Grammar: NumberLiteral DotDot (Star / NumberLiteral) / NumberLiteral
  parseCardinalityNotation() {
    const startTok = this.peek();
    const minTok = this.expect(TokenType.NUMBER);
    if (!minTok || !minTok.value) return null;
    const min = parseInt(minTok.value, 10);

    let max, notation;
    if (this.match(TokenType.DOT_DOT)) {
      if (this.match(TokenType.STAR)) {
        max = Infinity;
        notation = `${min}..*`;
      } else {
        const maxTok = this.expect(TokenType.NUMBER);
        if (!maxTok || !maxTok.value) return null;
        max = parseInt(maxTok.value, 10);
        notation = `${min}..${max}`;
      }
    } else {
      max = min;
      notation = `${min}`;
    }

    return Cardinality(min, max, notation, loc(startTok, this.tokens[this.pos - 1]));
  }

  // ---- ViaRef parser ---------------------------------------------------------

  // Grammar: Identifier LBracket RBracket / Identifier
  parseViaRef() {
    const nameTok = this.expectIdentifierOrKeyword();
    if (!nameTok) return null;

    // Check for array notation []
    if (this.check(TokenType.LBRACKET) &&
        this.tokens[this.pos + 1] &&
        this.tokens[this.pos + 1].type === TokenType.RBRACKET) {
      this.advance(); // [
      this.advance(); // ]
      return { name: nameTok.value, array: true };
    }
    return { name: nameTok.value, array: false };
  }

  // ---- DefaultValue parser ---------------------------------------------------

  parseDefaultValue() {
    const tok = this.peek();
    if (this.check(TokenType.STRING)) {
      this.advance();
      return Literal('string', tok.value, loc(tok, tok));
    }
    if (this.check(TokenType.NUMBER)) {
      this.advance();
      return Literal('number', tok.value, loc(tok, tok));
    }
    if (this.check(TokenType.IDENTIFIER) || KEYWORDS.has(tok.type)) {
      this.advance();
      return Literal('identifier', tok.value, loc(tok, tok));
    }
    this.errors.push({
      message: `Expected default value (string, number, or identifier) but got '${tok.type}'`,
      line: tok.line,
      column: tok.column,
    });
    return null;
  }

  // ---- Entity field parsers --------------------------------------------------

  // Grammar: Identifier Colon TypeExpr PatternLiteral? Question? DefaultValue? Cardinality?
  parseEntityField() {
    const startTok = this.peek();
    const nameTok = this.expectIdentifierOrKeyword();
    if (!nameTok) {
      // Recovery: skip to next line or '}'
      const currentLine = startTok.line;
      while (!this.check(TokenType.EOF) && !this.check(TokenType.RBRACE) &&
             this.peek().line === currentLine) {
        this.advance();
      }
      return null;
    }

    if (!this.check(TokenType.COLON)) {
      this.errors.push({
        message: `Expected ':' after field name '${nameTok.value}'`,
        line: this.peek().line,
        column: this.peek().column,
      });
      const currentLine = nameTok.line;
      while (!this.check(TokenType.EOF) && !this.check(TokenType.RBRACE) &&
             this.peek().line === currentLine) {
        this.advance();
      }
      return null;
    }
    this.advance(); // consume ':'

    const fieldType = this.parseTypeExpr();

    // Optional pattern literal
    let pattern = null;
    if (this.check(TokenType.PATTERN)) {
      const patTok = this.advance();
      pattern = PatternLiteral(patTok.value, loc(patTok, patTok));
    }

    // Optional '?'
    const optional = this.match(TokenType.QUESTION);

    // Optional '= DefaultValue'
    let defaultValue = null;
    if (this.match(TokenType.EQUALS)) {
      defaultValue = this.parseDefaultValue();
    }

    // Optional cardinality [N], [N..M], [N..*]
    let cardinality = null;
    if (this.check(TokenType.LBRACKET)) {
      cardinality = this.parseCardinality();
    }

    const endTok = this.tokens[this.pos - 1];
    return FieldDecl(nameTok.value, { fieldType, optional, defaultValue, pattern, cardinality },
      loc(startTok, endTok));
  }

  // Values field: 'values' Colon EnumValues
  parseValuesField() {
    const startTok = this.peek();
    this.advance(); // consume 'values' keyword

    if (!this.check(TokenType.COLON)) {
      this.errors.push({
        message: `Expected ':' after 'values'`,
        line: this.peek().line,
        column: this.peek().column,
      });
      const currentLine = startTok.line;
      while (!this.check(TokenType.EOF) && !this.check(TokenType.RBRACE) &&
             this.peek().line === currentLine) {
        this.advance();
      }
      return null;
    }
    this.advance(); // consume ':'

    const firstTok = this.peek();
    const first = this.expectIdentifierOrKeyword();
    if (!first) return null;

    const values = [first.value];
    while (this.match(TokenType.PIPE)) {
      const next = this.expectIdentifierOrKeyword();
      if (next) values.push(next.value);
    }

    const endTok = this.tokens[this.pos - 1];
    const fieldType = EnumType(values, loc(firstTok, endTok));
    return FieldDecl('values', { fieldType, optional: false, defaultValue: null, pattern: null, cardinality: null },
      loc(startTok, endTok));
  }

  // ---- Entity declaration parser ---------------------------------------------

  parseEntityDecl() {
    const startTok = this.peek();
    this.advance(); // consume 'entity'

    const nameTok = this.expect(TokenType.IDENTIFIER);
    if (!nameTok.value) {
      this.skipBlock();
      return EntityDecl('(error)', [], loc(startTok, this.tokens[this.pos - 1]));
    }

    if (!this.check(TokenType.LBRACE)) {
      this.errors.push({
        message: `Expected '{' after entity name '${nameTok.value}'`,
        line: this.peek().line,
        column: this.peek().column,
      });
      this.skipToEndOfBlock();
      return EntityDecl(nameTok.value, [], loc(startTok, this.tokens[this.pos - 1]));
    }
    this.advance(); // consume '{'

    const fields = [];
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF) &&
           !this.isTopLevelKeyword()) {
      if (this.check(TokenType.VALUES)) {
        const field = this.parseValuesField();
        if (field) fields.push(field);
      } else {
        const field = this.parseEntityField();
        if (field) fields.push(field);
      }
    }

    if (!this.match(TokenType.RBRACE)) {
      if (!this.isTopLevelKeyword() && !this.check(TokenType.EOF)) {
        this.errors.push({
          message: `Expected '}' to close entity '${nameTok.value}'`,
          line: this.peek().line,
          column: this.peek().column,
        });
      } else {
        this.errors.push({
          message: `Expected '}' to close entity '${nameTok.value}' (missing closing brace)`,
          line: this.peek().line,
          column: this.peek().column,
        });
      }
    }

    return EntityDecl(nameTok.value, fields, loc(startTok, this.tokens[this.pos - 1]));
  }

  // ---- Relation declaration parser -------------------------------------------

  parseRelationDecl() {
    const startTok = this.peek();
    this.advance(); // consume 'relation'

    const sourceTok = this.expect(TokenType.IDENTIFIER);
    if (!sourceTok.value) {
      this.skipBlock();
      return null;
    }

    if (!this.check(TokenType.ARROW)) {
      this.errors.push({
        message: `Expected '->' in relation declaration`,
        line: this.peek().line,
        column: this.peek().column,
      });
      this.skipBlock();
      return null;
    }
    this.advance(); // consume '->'

    const targetTok = this.expect(TokenType.IDENTIFIER);
    if (!targetTok.value) {
      this.skipBlock();
      return null;
    }

    if (!this.check(TokenType.LBRACE)) {
      this.errors.push({
        message: `Expected '{' in relation '${sourceTok.value} -> ${targetTok.value}'`,
        line: this.peek().line,
        column: this.peek().column,
      });
      this.skipToEndOfBlock();
      return RelationDecl(sourceTok.value, targetTok.value, {}, loc(startTok, this.tokens[this.pos - 1]));
    }
    this.advance(); // consume '{'

    const fields = {
      relationType: null,
      via: null,
      cardinality: null,
      constraints: [],
      lifecycle: null,
    };

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.TYPE)) {
        this.advance();
        this.expect(TokenType.COLON);
        const val = this.expectIdentifierOrKeyword();
        if (val) fields.relationType = val.value;
      } else if (this.check(TokenType.VIA)) {
        this.advance();
        this.expect(TokenType.COLON);
        fields.via = this.parseViaRef();
      } else if (this.check(TokenType.CARDINALITY)) {
        this.advance();
        this.expect(TokenType.COLON);
        fields.cardinality = this.parseCardinalityNotation();
      } else if (this.check(TokenType.CONSTRAINT)) {
        this.advance();
        this.expect(TokenType.COLON);
        const val = this.expectIdentifierOrKeyword();
        if (val) fields.constraints.push(val.value);
      } else if (this.check(TokenType.LIFECYCLE)) {
        this.advance();
        this.expect(TokenType.COLON);
        const val = this.expectIdentifierOrKeyword();
        if (val) fields.lifecycle = val.value;
      } else {
        const fieldTok = this.peek();
        this.errors.push({
          message: `Unexpected token '${fieldTok.value}' in relation body`,
          line: fieldTok.line,
          column: fieldTok.column,
        });
        this.advance(); // recover
      }
    }

    if (!this.match(TokenType.RBRACE)) {
      this.errors.push({
        message: `Expected '}' to close relation '${sourceTok.value} -> ${targetTok.value}'`,
        line: this.peek().line,
        column: this.peek().column,
      });
    }

    // Build RelationDecl and attach lifecycle as extra field
    const node = RelationDecl(sourceTok.value, targetTok.value, fields, loc(startTok, this.tokens[this.pos - 1]));
    node.lifecycle = fields.lifecycle;
    return node;
  }

  // ---- Structure declaration parser -----------------------------------------

  parseStructure() {
    const startTok = this.expect(TokenType.STRUCTURE);
    const nameTok = this.expect(TokenType.IDENTIFIER);
    const name = (nameTok && nameTok.value) ? nameTok.value : '(error)';

    if (!this.check(TokenType.LBRACE)) {
      this.errors.push({
        message: `Expected '{' after structure name '${name}'`,
        line: this.peek().line,
        column: this.peek().column,
      });
      this.skipToEndOfBlock();
      return StructureDecl(name, { id: null, state: null, contains: [], spawns: [], delegates: [], checkpoints: [] },
        loc(startTok, this.tokens[this.pos - 1]));
    }
    this.advance(); // consume '{'

    let id = null;
    let state = null;
    const contains = [];
    const spawns = [];
    const delegates = [];
    const checkpoints = [];

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.ID)) {
        id = this.parseIdField();
      } else if (this.check(TokenType.STATE)) {
        state = this.parseStateField();
      } else if (this.check(TokenType.CONTAINS)) {
        const entries = this.parseContainsBlock();
        for (const e of entries) contains.push(e);
      } else if (this.check(TokenType.SPAWNS)) {
        const entries = this.parseSpawnsBlock();
        for (const e of entries) spawns.push(e);
      } else if (this.check(TokenType.DELEGATES)) {
        const entries = this.parseDelegatesBlock();
        for (const e of entries) delegates.push(e);
      } else if (this.check(TokenType.CHECKPOINTS)) {
        const entries = this.parseCheckpointsBlock();
        for (const e of entries) checkpoints.push(e);
      } else {
        // Unknown token in structure body -- record error and skip
        const tok = this.peek();
        this.errors.push({
          message: `Unexpected token '${tok.type}' ('${tok.value}') in structure body`,
          line: tok.line,
          column: tok.column,
        });
        this.advance();
      }
    }

    const end = this.expect(TokenType.RBRACE);
    return StructureDecl(name, { id, state, contains, spawns, delegates, checkpoints },
      loc(startTok, end));
  }

  // Parse: id: ADV-{NNN}
  // Tokens: ID COLON IDENTIFIER LBRACE IDENTIFIER RBRACE
  // Or: id: /pattern/  (PATTERN token)
  // Or: id: "string"  (STRING token)
  parseIdField() {
    this.advance(); // consume 'id' keyword
    this.expect(TokenType.COLON);

    const tok = this.peek();

    // Pattern literal: /regex/
    if (this.check(TokenType.PATTERN)) {
      const patTok = this.advance();
      return PatternLiteral(patTok.value, loc(patTok, patTok));
    }

    // String literal: "value"
    if (this.check(TokenType.STRING)) {
      const strTok = this.advance();
      return strTok.value;
    }

    // Identifier-based pattern: ADV-{NNN} -> IDENTIFIER('ADV-') LBRACE IDENTIFIER('NNN') RBRACE
    if (this.check(TokenType.IDENTIFIER)) {
      let pattern = this.advance().value;
      if (this.check(TokenType.LBRACE)) {
        this.advance(); // consume '{'
        pattern += '{';
        if (this.check(TokenType.IDENTIFIER)) {
          pattern += this.advance().value;
        }
        this.expect(TokenType.RBRACE);
        pattern += '}';
      }
      return pattern;
    }

    // Fallback -- record error
    this.errors.push({
      message: `Expected id pattern (identifier, pattern literal, or string) but got '${tok.type}'`,
      line: tok.line,
      column: tok.column,
    });
    return null;
  }

  // Parse: state: val1 | val2 | val3
  parseStateField() {
    const startTok = this.peek();
    this.advance(); // consume 'state' keyword
    this.expect(TokenType.COLON);

    const firstTok = this.peek();
    const first = this.expectIdentifierOrKeyword();
    if (!first) return null;

    const values = [first.value];
    while (this.match(TokenType.PIPE)) {
      const next = this.expectIdentifierOrKeyword();
      if (next) values.push(next.value);
    }

    return EnumType(values, loc(startTok, this.tokens[this.pos - 1]));
  }

  // Parse: contains { path -> Type[cardinality] ... }
  parseContainsBlock() {
    this.advance(); // consume 'contains'
    this.expect(TokenType.LBRACE);
    const entries = [];

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      const startTok = this.peek();

      // Greedy path parsing: consume IDENTIFIER, DOT, SLASH tokens until ARROW
      let path = '';
      while (!this.check(TokenType.ARROW) && !this.check(TokenType.RBRACE) &&
             !this.check(TokenType.EOF)) {
        const t = this.peek();
        if (t.type === TokenType.IDENTIFIER) {
          path += this.advance().value;
        } else if (t.type === TokenType.DOT) {
          path += '.';
          this.advance();
        } else if (t.type === TokenType.SLASH) {
          path += '/';
          this.advance();
        } else {
          // Unexpected token in path -- skip with error
          this.errors.push({
            message: `Unexpected token '${t.type}' ('${t.value}') in containment path`,
            line: t.line,
            column: t.column,
          });
          this.advance();
          break;
        }
      }

      this.expect(TokenType.ARROW);

      const typeTok = this.expect(TokenType.IDENTIFIER);
      const targetType = typeTok.value;

      let cardinality = null;
      if (this.check(TokenType.LBRACKET)) {
        cardinality = this.parseCardinality();
      }

      entries.push(ContainmentEntry(path, targetType, cardinality, loc(startTok, this.tokens[this.pos - 1])));
    }

    this.expect(TokenType.RBRACE);
    return entries;
  }

  // Parse: spawns { Type[cardinality] from source ... }
  parseSpawnsBlock() {
    this.advance(); // consume 'spawns'
    this.expect(TokenType.LBRACE);
    const entries = [];

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      const startTok = this.peek();
      const typeTok = this.expect(TokenType.IDENTIFIER);
      const targetType = typeTok.value;

      const cardinality = this.parseCardinality();

      this.expect(TokenType.FROM);

      const sourceTok = this.expectIdentifierOrKeyword();
      const source = sourceTok ? sourceTok.value : '';

      entries.push(SpawnEntry(targetType, cardinality, source, loc(startTok, this.tokens[this.pos - 1])));
    }

    this.expect(TokenType.RBRACE);
    return entries;
  }

  // Parse: delegates { stage -> role ... }
  parseDelegatesBlock() {
    this.advance(); // consume 'delegates'
    this.expect(TokenType.LBRACE);
    const entries = [];

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      const startTok = this.peek();
      const stageTok = this.expectIdentifierOrKeyword();
      const stage = stageTok ? stageTok.value : '';

      this.expect(TokenType.ARROW);

      const roleTok = this.expectIdentifierOrKeyword();
      const role = roleTok ? roleTok.value : '';

      entries.push(DelegationEntry(stage, role, loc(startTok, this.tokens[this.pos - 1])));
    }

    this.expect(TokenType.RBRACE);
    return entries;
  }

  // Parse: checkpoints { fromState -> toState: "condition" ... }
  parseCheckpointsBlock() {
    this.advance(); // consume 'checkpoints'
    this.expect(TokenType.LBRACE);
    const entries = [];

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      const startTok = this.peek();
      const fromTok = this.expectIdentifierOrKeyword();
      const fromState = fromTok ? fromTok.value : '';

      this.expect(TokenType.ARROW);

      const toTok = this.expectIdentifierOrKeyword();
      const toState = toTok ? toTok.value : '';

      this.expect(TokenType.COLON);

      const condTok = this.expect(TokenType.STRING);
      const condition = condTok.value;

      entries.push(CheckpointEntry(fromState, toState, condition, loc(startTok, this.tokens[this.pos - 1])));
    }

    this.expect(TokenType.RBRACE);
    return entries;
  }

  // ---- Transitions block ----------------------------------------------------

  parseTransitionsBlock() {
    this.advance(); // consume 'transitions'
    this.expect(TokenType.LBRACE);
    const rules = [];
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      rules.push(this.parseTransitionRule());
    }
    this.expect(TokenType.RBRACE);
    return rules;
  }

  parseTransitionRule() {
    const start = this.expect(TokenType.ON);
    const eventTok = this.expect(TokenType.IDENTIFIER);
    this.expect(TokenType.ARROW);
    const targetTok = this.expect(TokenType.IDENTIFIER);
    return TransitionRule(eventTok.value, targetTok.value, loc(start, this.tokens[this.pos - 1]));
  }

  // ---- Expression parsing (for trigger:) ------------------------------------

  // Expression <- Conjunction (LogicOr Conjunction)*
  parseExpression() {
    const start = this.peek();
    let left = this.parseConjunction();
    while (this.check(TokenType.LOGIC_OR)) {
      this.advance(); // consume ||
      const right = this.parseConjunction();
      left = LogicalExpression('||', left, right, loc(start, this.tokens[this.pos - 1]));
    }
    return left;
  }

  // Conjunction <- Comparison (LogicAnd Comparison)*
  parseConjunction() {
    const start = this.peek();
    let left = this.parseComparison();
    while (this.check(TokenType.LOGIC_AND)) {
      this.advance(); // consume &&
      const right = this.parseComparison();
      left = LogicalExpression('&&', left, right, loc(start, this.tokens[this.pos - 1]));
    }
    return left;
  }

  // Comparison <- FieldRef CompOp (StringLiteral / Identifier)
  //            / LParen Expression RParen
  parseComparison() {
    const start = this.peek();

    // Parenthesized expression
    if (this.check(TokenType.LPAREN)) {
      this.advance(); // consume (
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    // FieldRef: identifier (dot identifier)*
    const fieldRef = this.parseFieldRefExpr();
    const op = this.parseCompOp();

    let right;
    if (this.check(TokenType.STRING)) {
      const tok = this.advance();
      right = Literal('string', tok.value, loc(tok, tok));
    } else if (this.check(TokenType.IDENTIFIER)) {
      const tok = this.advance();
      right = Literal('identifier', tok.value, loc(tok, tok));
    } else {
      const tok = this.peek();
      this.errors.push({
        message: `Expected string or identifier as right-hand side of comparison, got '${tok.type}'`,
        line: tok.line,
        column: tok.column,
      });
      right = Literal('error', '', loc(tok, tok));
    }

    return BinaryExpression(op, fieldRef, right, loc(start, this.tokens[this.pos - 1]));
  }

  parseCompOp() {
    const tok = this.peek();
    const compOps = [
      TokenType.COMP_EQ,
      TokenType.COMP_NE,
      TokenType.COMP_LE,
      TokenType.COMP_GE,
      TokenType.COMP_LT,
      TokenType.COMP_GT,
    ];
    if (compOps.includes(tok.type)) {
      this.advance();
      return tok.value;
    }
    this.errors.push({
      message: `Expected comparison operator but got '${tok.type}' ('${tok.value}')`,
      line: tok.line,
      column: tok.column,
    });
    return '=='; // fallback
  }

  // FieldRef in expression context: identifier (dot identifier)*
  parseFieldRefExpr() {
    const start = this.peek();
    const firstTok = this.expect(TokenType.IDENTIFIER);
    const segments = [firstTok.value];
    while (this.check(TokenType.DOT)) {
      this.advance(); // consume .
      const segTok = this.expect(TokenType.IDENTIFIER);
      segments.push(segTok.value);
    }
    return FieldRef(segments, loc(start, this.tokens[this.pos - 1]));
  }
}

// ---------------------------------------------------------------------------
// parse(source) -- entry point
//
// Returns { ast: Program, program: Program, errors: ParseError[] }
// Both `ast` and `program` refer to the same Program node.
// ---------------------------------------------------------------------------

function parse(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const program = parser.parseProgram();
  return { ast: program, program, errors: parser.errors };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { tokenize, parse, Parser };
