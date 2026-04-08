'use strict';

// ---------------------------------------------------------------------------
// Public API for the PDSL (Pipeline DSL) parser.
//
// parse(source)    -- tokenize + parse; returns { ast, program, errors }
// tokenize(source) -- lex source into token array
// TokenType        -- frozen object with all token type constants
// validate(ast)    -- validate a parsed AST; returns array of diagnostics
// serialize(ast)   -- serialize AST back to PDSL source string
// layout(ast)      -- convert AST to LayoutGraph (positioned nodes + edges)
// render(graph, t) -- convert LayoutGraph + Theme to SVG string
// defaultTheme()   -- returns the default pipeline theme
// createTheme(o)   -- create a theme by deep-merging overrides onto defaults
// ---------------------------------------------------------------------------

const { tokenize, parse } = require('./parser');
const { TokenType } = require('./ast');
const { validate } = require('./validator');
const { serialize } = require('./serializer');
const { layout } = require('./layout');
const { render } = require('./renderer');
const { defaultTheme, createTheme } = require('./themes');
const { applyEdit, EditCommand, addFieldCommand, removeFieldCommand, renameEntityCommand } = require('./editor');

module.exports = { parse, tokenize, serialize, TokenType, validate, layout, render, defaultTheme, createTheme, applyEdit, EditCommand, addFieldCommand, removeFieldCommand, renameEntityCommand };
