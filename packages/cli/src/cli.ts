#!/usr/bin/env node

/**
 * Holodeck CLI - Main entry point
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';
import { devCommand } from './commands/dev';
import { generateCommand } from './commands/generate';
import { infoCommand } from './commands/info';
import { validateCommand } from './commands/validate';

const program = new Command();

// Read package.json for version
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

program
  .name('holodeck')
  .description('CLI for Holodeck infrastructure visualization')
  .version(packageJson.version);

// Register commands
program.addCommand(generateCommand);
program.addCommand(devCommand);
program.addCommand(validateCommand);
program.addCommand(infoCommand);

// Global options
program.option('-v, --verbose', 'Enable verbose logging');
program.option('--debug', 'Enable debug output');

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught Exception:'), error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled Rejection at:'), promise, 'reason:', reason);
  process.exit(1);
});

// Parse CLI arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
