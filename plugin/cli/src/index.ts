#!/usr/bin/env node
/**
 * CLI entry point — tsup bundles this to `dist/design-lens.cjs`, the single committed artifact
 * the plugin ships (spec 01-packaging). Delegates argument parsing and exit-code handling to
 * commander; human progress goes to stderr and machine JSON to stdout per the CLI I/O contract.
 */

import { buildProgram } from './cli.js';

buildProgram().parse(process.argv);
