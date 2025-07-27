import chalk from 'chalk';
import { Command } from 'commander';
import { readFile } from 'fs/promises';
import ora from 'ora';
import { resolve, extname } from 'path';
import { z } from 'zod';
import { discoverImporters } from '../utils/discovery';

// Basic Starfleet scene schema validation
const SceneSchema = z.object({
  metadata: z.object({
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    created: z.string().optional(),
    modified: z.string().optional(),
    author: z.string().optional(),
    tags: z.array(z.string()).optional()
  }),
  scene: z.object({
    nodes: z.array(z.object({
      id: z.string(),
      type: z.string(),
      position: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number().optional()
      }),
      properties: z.record(z.any()).optional(),
      metadata: z.record(z.any()).optional()
    })),
    edges: z.array(z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      type: z.string().optional(),
      properties: z.record(z.any()).optional(),
      metadata: z.record(z.any()).optional()
    })),
    materials: z.record(z.object({
      type: z.string(),
      properties: z.record(z.any())
    })).optional(),
    camera: z.object({
      position: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number()
      }),
      target: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number()
      }),
      up: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number()
      }).optional()
    }).optional()
  })
});

export const validateCommand = new Command('validate')
  .description('Validate Starfleet scene file or input file')
  .argument('<input>', 'Input file path to validate')
  .option('-t, --type <type>', 'Force input file type (auto-detect by default)')
  .option('--schema-only', 'Only validate JSON schema, skip importer validation')
  .option('--strict', 'Enable strict validation (fail on warnings)')
  .option('--verbose', 'Show detailed validation results')
  .action(async (input, options) => {
    const spinner = ora('Validating file...').start();

    try {
      const inputPath = resolve(input);
      
      if (options.verbose) {
        spinner.info(`Validating: ${inputPath}`);
      }

      // Read the file
      spinner.text = 'Reading file...';
      const content = await readFile(inputPath, 'utf-8');
      
      let jsonData: any;
      try {
        jsonData = JSON.parse(content);
      } catch (error) {
        spinner.fail('Invalid JSON format');
        console.error(chalk.red('JSON parsing error:', error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }

      const issues: ValidationIssue[] = [];
      let isStarfleetFile = false;

      // Check if it's already a Starfleet file
      if (jsonData.metadata && jsonData.scene) {
        isStarfleetFile = true;
        spinner.text = 'Validating Starfleet schema...';
        
        if (!options.schemaOnly) {
          const schemaIssues = await validateStarfleetSchema(jsonData);
          issues.push(...schemaIssues);
        }
      } else {
        // It's an input file, find importer and validate
        if (options.schemaOnly) {
          spinner.fail('Cannot use --schema-only with input files (not Starfleet format)');
          process.exit(1);
        }

        spinner.text = 'Discovering importers...';
        const importers = await discoverImporters();

        if (importers.length === 0) {
          spinner.fail('No importers found. Cannot validate input file format.');
          process.exit(1);
        }

        // Find appropriate importer
        const importer = await findImporter(inputPath, options.type, importers);
        if (!importer) {
          spinner.fail('No suitable importer found for this file.');
          console.log(chalk.gray('\nAvailable importers:'));
          importers.forEach(imp => {
            console.log(chalk.gray(`  - ${imp.name}: ${imp.supportedFormats.join(', ')}`));
          });
          process.exit(1);
        }

        spinner.text = `Validating with ${importer.name}...`;
        const importerIssues = await validateWithImporter(content, importer);
        issues.push(...importerIssues);
      }

      // Report results
      const errors = issues.filter(i => i.severity === 'error');
      const warnings = issues.filter(i => i.severity === 'warning');
      const infos = issues.filter(i => i.severity === 'info');

      if (errors.length === 0 && (warnings.length === 0 || !options.strict)) {
        spinner.succeed('Validation passed');
        
        if (isStarfleetFile) {
          const nodeCount = jsonData.scene?.nodes?.length || 0;
          const edgeCount = jsonData.scene?.edges?.length || 0;
          console.log(chalk.gray(`  📊 Nodes: ${nodeCount}, Edges: ${edgeCount}`));
        }
        
        if (warnings.length > 0) {
          console.log(chalk.yellow(`  ⚠️  ${warnings.length} warning(s)`));
        }
        
        if (infos.length > 0) {
          console.log(chalk.blue(`  ℹ️  ${infos.length} info message(s)`));
        }
      } else {
        spinner.fail('Validation failed');
      }

      // Print detailed issues
      if (options.verbose || errors.length > 0 || (warnings.length > 0 && options.strict)) {
        console.log();
        printIssues(issues, options.verbose);
      }

      // Exit with appropriate code
      if (errors.length > 0 || (warnings.length > 0 && options.strict)) {
        process.exit(1);
      }

    } catch (error) {
      spinner.fail('Validation error');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  path?: string;
  line?: number;
  column?: number;
}

async function validateStarfleetSchema(data: any): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  try {
    SceneSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) {
        issues.push({
          severity: 'error',
          message: `${issue.path.join('.')}: ${issue.message}`,
          path: issue.path.join('.')
        });
      }
    } else {
      issues.push({
        severity: 'error',
        message: 'Unknown schema validation error'
      });
    }
  }

  // Additional semantic validation
  if (data.scene?.nodes) {
    const nodeIds = new Set();
    for (const [index, node] of data.scene.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        issues.push({
          severity: 'error',
          message: `Duplicate node ID: ${node.id}`,
          path: `scene.nodes[${index}].id`
        });
      }
      nodeIds.add(node.id);
    }

    // Validate edge references
    if (data.scene?.edges) {
      for (const [index, edge] of data.scene.edges.entries()) {
        if (!nodeIds.has(edge.from)) {
          issues.push({
            severity: 'error',
            message: `Edge references non-existent node: ${edge.from}`,
            path: `scene.edges[${index}].from`
          });
        }
        if (!nodeIds.has(edge.to)) {
          issues.push({
            severity: 'error',
            message: `Edge references non-existent node: ${edge.to}`,
            path: `scene.edges[${index}].to`
          });
        }
      }
    }
  }

  return issues;
}

async function findImporter(inputPath: string, forceType: string | undefined, importers: any[]) {
  if (forceType) {
    return importers.find(imp => imp.id === forceType);
  }

  // Auto-detect by file extension
  const ext = extname(inputPath).toLowerCase();
  return importers.find(imp =>
    imp.supportedFormats.includes(ext) ||
    imp.supportedFormats.includes('*')
  );
}

async function validateWithImporter(content: string, importer: any): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  try {
    if (importer.validate) {
      const isValid = await importer.validate(content);
      if (!isValid) {
        issues.push({
          severity: 'error',
          message: `${importer.name} validation failed`
        });
      }
    } else {
      issues.push({
        severity: 'info',
        message: `${importer.name} does not provide validation`
      });
    }

    // Try to import to catch additional issues
    try {
      const result = await importer.import(content, {});
      
      if (result.errors && result.errors.length > 0) {
        for (const error of result.errors) {
          issues.push({
            severity: 'error',
            message: error
          });
        }
      }

      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          issues.push({
            severity: 'warning',
            message: warning
          });
        }
      }

      // Validate resulting Starfleet schema
      if (result.scene) {
        const schemaIssues = await validateStarfleetSchema(result.scene);
        issues.push(...schemaIssues);
      }

    } catch (error) {
      issues.push({
        severity: 'error',
        message: `Import test failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }

  } catch (error) {
    issues.push({
      severity: 'error',
      message: `Importer validation error: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  return issues;
}

function printIssues(issues: ValidationIssue[], verbose: boolean) {
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');

  if (errors.length > 0) {
    console.log(chalk.red.bold('❌ Errors:'));
    for (const issue of errors) {
      const path = issue.path ? ` (${issue.path})` : '';
      console.log(chalk.red(`  • ${issue.message}${path}`));
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log(chalk.yellow.bold('⚠️  Warnings:'));
    for (const issue of warnings) {
      const path = issue.path ? ` (${issue.path})` : '';
      console.log(chalk.yellow(`  • ${issue.message}${path}`));
    }
    console.log();
  }

  if (verbose && infos.length > 0) {
    console.log(chalk.blue.bold('ℹ️  Info:'));
    for (const issue of infos) {
      const path = issue.path ? ` (${issue.path})` : '';
      console.log(chalk.blue(`  • ${issue.message}${path}`));
    }
    console.log();
  }
}