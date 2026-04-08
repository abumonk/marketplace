#!/usr/bin/env node
'use strict';

// ---------------------------------------------------------------------------
// cli.js -- PDSL Command-Line Interface
//
// Usage: node dsl/cli.js <command> <file> [flags]
//
// Commands:
//   render    Parse, validate, layout and render .pdsl file to SVG
//   validate  Parse and validate .pdsl file, report errors
//   format    Parse .pdsl file and output canonical PDSL text
//
// Flags:
//   --output <path>   Write output to file instead of stdout (render, format)
//   --write           Overwrite the input file with formatted output (format)
//
// Exit codes:
//   0 - success
//   1 - error (file not found, parse error, validation error, unknown command)
// ---------------------------------------------------------------------------

const fs   = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Usage / help
// ---------------------------------------------------------------------------

function printUsage() {
  process.stderr.write([
    'Usage: node dsl/cli.js <command> <file> [flags]',
    '',
    'Commands:',
    '  render    Parse, validate, layout and render .pdsl file to SVG',
    '  validate  Parse and validate .pdsl file, report errors',
    '  format    Parse .pdsl file and output canonical PDSL text',
    '',
    'Flags:',
    '  --output <path>   Write output to file instead of stdout',
    '  --write           Overwrite the input file with formatted output',
    '',
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// parseArgs(argv) -- parse process.argv.slice(2)
//
// Returns: { command, inputFile, outputFile, writeBack }
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const COMMANDS = new Set(['render', 'validate', 'format']);

  if (!argv || argv.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = argv[0];
  if (!COMMANDS.has(command)) {
    process.stderr.write(`Error: unknown command: ${command}\n`);
    printUsage();
    process.exit(1);
  }

  if (!argv[1]) {
    process.stderr.write(`Error: missing input file\n`);
    printUsage();
    process.exit(1);
  }

  const inputFile = argv[1];
  let outputFile = null;
  let writeBack = false;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--output') {
      if (!argv[i + 1]) {
        process.stderr.write('Error: --output requires a file path argument\n');
        process.exit(1);
      }
      outputFile = argv[i + 1];
      i++; // skip the value token
    } else if (argv[i] === '--write') {
      writeBack = true;
    } else {
      process.stderr.write(`Error: unknown flag: ${argv[i]}\n`);
      printUsage();
      process.exit(1);
    }
  }

  return { command, inputFile, outputFile, writeBack };
}

// ---------------------------------------------------------------------------
// readFile(filePath) -- read a file or exit 1 if missing
// ---------------------------------------------------------------------------

function readFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    process.stderr.write(`Error: file not found: ${filePath}\n`);
    process.exit(1);
  }
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch (err) {
    process.stderr.write(`Error: could not read file: ${filePath}: ${err.message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// writeOutput(content, opts) -- write to stdout, --output file, or --write
// ---------------------------------------------------------------------------

function writeOutput(content, opts) {
  if (opts.writeBack) {
    try {
      fs.writeFileSync(path.resolve(opts.inputFile), content, 'utf8');
    } catch (err) {
      process.stderr.write(`Error: could not write file: ${opts.inputFile}: ${err.message}\n`);
      process.exit(1);
    }
  } else if (opts.outputFile) {
    try {
      fs.writeFileSync(path.resolve(opts.outputFile), content, 'utf8');
    } catch (err) {
      process.stderr.write(`Error: could not write file: ${opts.outputFile}: ${err.message}\n`);
      process.exit(1);
    }
  } else {
    process.stdout.write(content);
    // Ensure output ends with a newline
    if (!content.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }
}

// ---------------------------------------------------------------------------
// formatErrors(errors, filePath) -- format validation errors for stderr
//
// Format: {filePath}:{line}:{column}: {severity}: {message} [{rule}]
// ---------------------------------------------------------------------------

function formatErrors(errors, filePath) {
  return errors.map(function(e) {
    const loc = (e.node && e.node.loc) ? e.node.loc : { line: 0, column: 0 };
    const line   = (loc.start ? loc.start.line   : loc.line)   || 0;
    const column = (loc.start ? loc.start.column : loc.column) || 0;
    const sev    = e.severity || 'error';
    return `${filePath}:${line}:${column}: ${sev}: ${e.message} [${e.rule}]`;
  });
}

// ---------------------------------------------------------------------------
// runValidate(opts) -- parse -> validate -> print errors -> exit
// ---------------------------------------------------------------------------

function runValidate(opts) {
  const { parse, validate } = require('./index');
  const source = readFile(opts.inputFile);
  const { ast, errors: parseErrors } = parse(source);

  if (parseErrors && parseErrors.length > 0) {
    parseErrors.forEach(function(e) {
      process.stderr.write(`${opts.inputFile}:${e.line || 0}:${e.column || 0}: parse error: ${e.message}\n`);
    });
    process.exit(1);
  }

  const errors = validate(ast);
  const warnings = errors.filter(function(e) { return e.severity === 'warning'; });
  const fatal    = errors.filter(function(e) { return e.severity !== 'warning'; });

  formatErrors(warnings, opts.inputFile).forEach(function(l) { process.stderr.write(l + '\n'); });
  formatErrors(fatal,    opts.inputFile).forEach(function(l) { process.stderr.write(l + '\n'); });

  if (fatal.length > 0) {
    process.exit(1);
  }
  process.stdout.write('OK\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// runFormat(opts) -- parse -> serialize -> write output -> exit
// ---------------------------------------------------------------------------

function runFormat(opts) {
  const { parse, serialize } = require('./index');
  const source = readFile(opts.inputFile);
  const { ast, errors: parseErrors } = parse(source);

  if (parseErrors && parseErrors.length > 0) {
    parseErrors.forEach(function(e) {
      process.stderr.write(`${opts.inputFile}:${e.line || 0}:${e.column || 0}: parse error: ${e.message}\n`);
    });
    process.exit(1);
  }

  const formatted = serialize(ast);
  writeOutput(formatted, opts);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// runRender(opts) -- parse -> validate -> layout -> render -> write output
//
// Note: renderer.js is required lazily here (inside runRender) so that the
// validate and format commands work even if renderer.js is unavailable.
// ---------------------------------------------------------------------------

function runRender(opts) {
  var dsl;
  try {
    dsl = require('./index');
  } catch (err) {
    process.stderr.write(`Error: could not load DSL modules: ${err.message}\n`);
    process.exit(1);
  }

  var parse      = dsl.parse;
  var validate   = dsl.validate;
  var layout     = dsl.layout;
  var render     = dsl.render;
  var defaultTheme = dsl.defaultTheme;

  if (typeof render !== 'function') {
    process.stderr.write('Error: render command requires renderer.js (not yet available)\n');
    process.exit(1);
  }

  const source = readFile(opts.inputFile);
  const { ast, errors: parseErrors } = parse(source);

  if (parseErrors && parseErrors.length > 0) {
    parseErrors.forEach(function(e) {
      process.stderr.write(`${opts.inputFile}:${e.line || 0}:${e.column || 0}: parse error: ${e.message}\n`);
    });
    process.exit(1);
  }

  const errors = validate(ast);
  const fatal = errors.filter(function(e) { return e.severity !== 'warning'; });
  if (fatal.length > 0) {
    formatErrors(fatal, opts.inputFile).forEach(function(l) { process.stderr.write(l + '\n'); });
    process.exit(1);
  }

  const graph = layout(ast);
  const svg   = render(graph, defaultTheme());
  writeOutput(svg, opts);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// main() -- entry point
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  switch (opts.command) {
    case 'render':   return runRender(opts);
    case 'validate': return runValidate(opts);
    case 'format':   return runFormat(opts);
    default:
      printUsage();
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, formatErrors };
