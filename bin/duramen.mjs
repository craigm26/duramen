#!/usr/bin/env node
// duramen check|build|run <record> ...   (run `duramen help` for the options)
import { cli } from '../src/cli.mjs';

await cli(process.argv.slice(2));
