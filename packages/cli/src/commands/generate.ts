import chalk from 'chalk';
import { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import ora from 'ora';
import { basename, extname, resolve } from 'path';
import { discoverImporters } from '../utils/discovery';

export const generateCommand = new Command('generate')
  .description('Generate Holodeck scene from input file')
  .argument('<input>', 'Input file path')
  .option('-o, --output <output>', 'Output file path (default: <input>.holodeck.json)')
  .option('-t, --type <type>', 'Force importer type (auto-detect by default)')
  .option('-c, --config <config>', 'Configuration file or preset')
  .option('--dry-run', 'Show what would be generated without writing files')
  .option('--verbose', 'Enable verbose output')
  .action(async (input, options) => {
    const spinner = ora('Generating Holodeck scene...').start();

    try {
      const inputPath = resolve(input);
      const outputPath = options.output || getDefaultOutputPath(inputPath);

      if (options.verbose) {
        spinner.info(`Input: ${inputPath}`);
        spinner.info(`Output: ${outputPath}`);
      }

      // Read input file
      spinner.text = 'Reading input file...';
      const content = await readFile(inputPath, 'utf-8');

      // Discover importers
      spinner.text = 'Discovering importers...';
      const importers = await discoverImporters();

      if (importers.length === 0) {
        spinner.fail('No importers found. Please install an importer package.');
        process.exit(1);
      }

      // Find appropriate importer
      let importer;
      if (options.type) {
        importer = importers.find(imp => imp.id === options.type);
        if (!importer) {
          spinner.fail(`Importer '${options.type}' not found.`);
          process.exit(1);
        }
      } else {
        // Auto-detect by file extension
        const ext = extname(inputPath).toLowerCase();
        importer = importers.find(imp =>
          imp.supportedFormats.includes(ext) ||
          imp.supportedFormats.includes('*')
        );

        if (!importer) {
          spinner.fail(`No importer found for file extension '${ext}'.`);
          spinner.info('Available importers:');
          importers.forEach(imp => {
            console.log(`  - ${imp.id}: ${imp.supportedFormats.join(', ')}`);
          });
          process.exit(1);
        }
      }

      spinner.text = `Using importer: ${importer.name}`;

      // Validate input
      if (importer.validate) {
        spinner.text = 'Validating input...';
        const isValid = await importer.validate(content);
        if (!isValid) {
          spinner.fail('Input validation failed');
          process.exit(1);
        }
      }

      // Import
      spinner.text = 'Converting to Holodeck format...';
      const result = await importer.import(content, parseConfig(options.config));

      if (result.errors && result.errors.length > 0) {
        spinner.fail('Import failed with errors:');
        result.errors.forEach(error => console.error(chalk.red(`  - ${error}`)));
        process.exit(1);
      }

      if (result.warnings && result.warnings.length > 0) {
        spinner.warn('Import completed with warnings:');
        result.warnings.forEach(warning => console.warn(chalk.yellow(`  - ${warning}`)));
      }

      // Write output
      if (options.dryRun) {
        spinner.succeed('Dry run completed successfully');
        console.log(chalk.gray('Scene preview:'));
        console.log(JSON.stringify(result.scene, null, 2));
      } else {
        spinner.text = 'Writing output file...';
        await writeFile(outputPath, JSON.stringify(result.scene, null, 2));

        spinner.succeed(`Generated: ${outputPath}`);
        console.log(chalk.gray(`  Nodes: ${result.scene.scene.nodes.length}`));
        console.log(chalk.gray(`  Edges: ${result.scene.scene.edges.length}`));
      }

    } catch (error) {
      spinner.fail('Generation failed');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

function getDefaultOutputPath(inputPath: string): string {
  const baseName = basename(inputPath, extname(inputPath));
  return `${baseName}.holodeck.json`;
}

function parseConfig(configOption?: string): any {
  if (!configOption) {
    return {};
  }

  // If it's a JSON string, parse it
  if (configOption.startsWith('{')) {
    try {
      return JSON.parse(configOption);
    } catch {
      throw new Error('Invalid JSON configuration');
    }
  }

  // Otherwise, treat as preset name
  return { preset: configOption };
}
