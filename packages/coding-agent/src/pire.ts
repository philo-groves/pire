#!/usr/bin/env node

process.title = "pire";
process.emitWarning = (() => {}) as typeof process.emitWarning;

import { runCliMain } from "@mariozechner/pi-security-agent/run-cli";

void runCliMain(process.argv.slice(2));
