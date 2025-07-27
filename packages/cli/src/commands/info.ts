import chalk from 'chalk';
import { Command } from 'commander';
import { readFile, stat } from 'fs/promises';
import ora from 'ora';
import { resolve, basename, extname } from 'path';
import { discoverImporters } from '../utils/discovery';

export const infoCommand = new Command('info')
  .description('Show information about a scene file')
  .argument('<input>', 'Input file path to analyze')
  .option('-t, --type <type>', 'Force input file type (auto-detect by default)')
  .option('--format <format>', 'Output format: table (default), json, yaml', 'table')
  .option('--detailed', 'Show detailed analysis including node/edge properties')
  .option('--stats-only', 'Show only basic statistics')
  .action(async (input, options) => {
    const spinner = ora('Analyzing file...').start();

    try {
      const inputPath = resolve(input);
      const fileStats = await stat(inputPath);
      
      // Read the file
      spinner.text = 'Reading file...';
      const content = await readFile(inputPath, 'utf-8');
      
      let jsonData: any;
      let isStarfleetFile = false;
      
      try {
        jsonData = JSON.parse(content);
        isStarfleetFile = !!(jsonData.metadata && jsonData.scene);
      } catch (error) {
        spinner.fail('Invalid JSON format');
        console.error(chalk.red('JSON parsing error:', error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }

      let sceneData: any;
      let importerInfo: any = null;

      if (isStarfleetFile) {
        sceneData = jsonData;
        spinner.succeed('Starfleet scene file detected');
      } else {
        // Process with importer
        spinner.text = 'Discovering importers...';
        const importers = await discoverImporters();

        if (importers.length === 0) {
          spinner.fail('No importers found. Cannot analyze input file format.');
          process.exit(1);
        }

        // Find appropriate importer
        const importer = await findImporter(inputPath, options.type, importers);
        if (!importer) {
          spinner.fail('No suitable importer found for this file.');
          process.exit(1);
        }

        importerInfo = importer;
        spinner.text = `Processing with ${importer.name}...`;
        
        try {
          const result = await importer.import(content, {});
          sceneData = result.scene;
          spinner.succeed(`Processed with ${importer.name}`);
        } catch (error) {
          spinner.fail('Failed to process file');
          console.error(chalk.red(error instanceof Error ? error.message : String(error)));
          process.exit(1);
        }
      }

      // Analyze the scene
      const analysis = analyzeScene(sceneData, content, fileStats, importerInfo);

      // Output results
      if (options.format === 'json') {
        console.log(JSON.stringify(analysis, null, 2));
      } else if (options.format === 'yaml') {
        console.log(formatAsYaml(analysis));
      } else {
        printTableFormat(analysis, options);
      }

    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

interface SceneAnalysis {
  file: {
    path: string;
    name: string;
    size: number;
    modified: Date;
    type: 'starfleet' | 'input';
    format?: string;
  };
  importer?: {
    name: string;
    version: string;
    supportedFormats: string[];
  };
  metadata?: {
    name?: string;
    version?: string;
    description?: string;
    author?: string;
    created?: string;
    modified?: string;
    tags?: string[];
  };
  scene: {
    nodes: {
      count: number;
      types: Record<string, number>;
    };
    edges: {
      count: number;
      types: Record<string, number>;
    };
    materials?: {
      count: number;
      types: Record<string, number>;
    };
    bounds?: {
      min: { x: number; y: number; z?: number };
      max: { x: number; y: number; z?: number };
      center: { x: number; y: number; z?: number };
      size: { x: number; y: number; z?: number };
    };
    camera?: {
      position: { x: number; y: number; z: number };
      target: { x: number; y: number; z: number };
    };
  };
  properties?: {
    nodeProperties: Record<string, number>;
    edgeProperties: Record<string, number>;
  };
}

function analyzeScene(sceneData: any, content: string, fileStats: any, importerInfo?: any): SceneAnalysis {
  const analysis: SceneAnalysis = {
    file: {
      path: fileStats.path || 'unknown',
      name: basename(fileStats.path || 'unknown'),
      size: fileStats.size,
      modified: fileStats.mtime,
      type: sceneData.metadata ? 'starfleet' : 'input',
      format: importerInfo ? importerInfo.name : undefined
    },
    scene: {
      nodes: {
        count: 0,
        types: {}
      },
      edges: {
        count: 0,
        types: {}
      }
    }
  };

  if (importerInfo) {
    analysis.importer = {
      name: importerInfo.name,
      version: importerInfo.version,
      supportedFormats: importerInfo.supportedFormats
    };
  }

  if (sceneData.metadata) {
    analysis.metadata = { ...sceneData.metadata };
  }

  // Analyze nodes
  if (sceneData.scene?.nodes) {
    analysis.scene.nodes.count = sceneData.scene.nodes.length;
    
    for (const node of sceneData.scene.nodes) {
      const type = node.type || 'unknown';
      analysis.scene.nodes.types[type] = (analysis.scene.nodes.types[type] || 0) + 1;
    }

    // Calculate bounds
    if (sceneData.scene.nodes.length > 0) {
      const positions = sceneData.scene.nodes.map((n: any) => n.position).filter(Boolean);
      if (positions.length > 0) {
        analysis.scene.bounds = calculateBounds(positions);
      }
    }
  }

  // Analyze edges
  if (sceneData.scene?.edges) {
    analysis.scene.edges.count = sceneData.scene.edges.length;
    
    for (const edge of sceneData.scene.edges) {
      const type = edge.type || 'default';
      analysis.scene.edges.types[type] = (analysis.scene.edges.types[type] || 0) + 1;
    }
  }

  // Analyze materials
  if (sceneData.scene?.materials) {
    const materials = Object.values(sceneData.scene.materials);
    analysis.scene.materials = {
      count: materials.length,
      types: {}
    };
    
    for (const material of materials as any[]) {
      const type = material.type || 'unknown';
      analysis.scene.materials.types[type] = (analysis.scene.materials.types[type] || 0) + 1;
    }
  }

  // Camera info
  if (sceneData.scene?.camera) {
    analysis.scene.camera = {
      position: sceneData.scene.camera.position,
      target: sceneData.scene.camera.target
    };
  }

  // Property analysis
  if (sceneData.scene?.nodes || sceneData.scene?.edges) {
    analysis.properties = analyzeProperties(sceneData.scene);
  }

  return analysis;
}

function calculateBounds(positions: any[]) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const pos of positions) {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y);
    
    if (pos.z !== undefined) {
      minZ = Math.min(minZ, pos.z);
      maxZ = Math.max(maxZ, pos.z);
    }
  }

  const bounds: any = {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    size: { x: maxX - minX, y: maxY - minY }
  };

  if (minZ !== Infinity) {
    bounds.min.z = minZ;
    bounds.max.z = maxZ;
    bounds.center.z = (minZ + maxZ) / 2;
    bounds.size.z = maxZ - minZ;
  }

  return bounds;
}

function analyzeProperties(scene: any) {
  const nodeProperties: Record<string, number> = {};
  const edgeProperties: Record<string, number> = {};

  if (scene.nodes) {
    for (const node of scene.nodes) {
      if (node.properties) {
        for (const key of Object.keys(node.properties)) {
          nodeProperties[key] = (nodeProperties[key] || 0) + 1;
        }
      }
    }
  }

  if (scene.edges) {
    for (const edge of scene.edges) {
      if (edge.properties) {
        for (const key of Object.keys(edge.properties)) {
          edgeProperties[key] = (edgeProperties[key] || 0) + 1;
        }
      }
    }
  }

  return { nodeProperties, edgeProperties };
}

async function findImporter(inputPath: string, forceType: string | undefined, importers: any[]) {
  if (forceType) {
    return importers.find(imp => imp.id === forceType);
  }

  const ext = extname(inputPath).toLowerCase();
  return importers.find(imp =>
    imp.supportedFormats.includes(ext) ||
    imp.supportedFormats.includes('*')
  );
}

function printTableFormat(analysis: SceneAnalysis, options: any) {
  console.log(chalk.bold.blue('📊 Scene Information\n'));

  // File info
  console.log(chalk.bold('📁 File'));
  console.log(`  Name: ${analysis.file.name}`);
  console.log(`  Size: ${formatBytes(analysis.file.size)}`);
  console.log(`  Modified: ${analysis.file.modified.toLocaleString()}`);
  console.log(`  Type: ${analysis.file.type === 'starfleet' ? '🚀 Starfleet Scene' : '📥 Input File'}`);
  
  if (analysis.file.format) {
    console.log(`  Format: ${analysis.file.format}`);
  }
  console.log();

  // Importer info
  if (analysis.importer) {
    console.log(chalk.bold('🔧 Importer'));
    console.log(`  Name: ${analysis.importer.name}`);
    console.log(`  Version: ${analysis.importer.version}`);
    console.log(`  Supports: ${analysis.importer.supportedFormats.join(', ')}`);
    console.log();
  }

  // Metadata
  if (analysis.metadata && !options.statsOnly) {
    console.log(chalk.bold('📝 Metadata'));
    if (analysis.metadata.name) console.log(`  Name: ${analysis.metadata.name}`);
    if (analysis.metadata.version) console.log(`  Version: ${analysis.metadata.version}`);
    if (analysis.metadata.description) console.log(`  Description: ${analysis.metadata.description}`);
    if (analysis.metadata.author) console.log(`  Author: ${analysis.metadata.author}`);
    if (analysis.metadata.tags?.length) console.log(`  Tags: ${analysis.metadata.tags.join(', ')}`);
    console.log();
  }

  // Scene statistics
  console.log(chalk.bold('📈 Scene Statistics'));
  console.log(`  Nodes: ${chalk.green(analysis.scene.nodes.count)}`);
  console.log(`  Edges: ${chalk.green(analysis.scene.edges.count)}`);
  
  if (analysis.scene.materials) {
    console.log(`  Materials: ${chalk.green(analysis.scene.materials.count)}`);
  }
  console.log();

  // Node types
  if (Object.keys(analysis.scene.nodes.types).length > 0) {
    console.log(chalk.bold('🔗 Node Types'));
    for (const [type, count] of Object.entries(analysis.scene.nodes.types)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log();
  }

  // Edge types
  if (Object.keys(analysis.scene.edges.types).length > 0) {
    console.log(chalk.bold('↔️  Edge Types'));
    for (const [type, count] of Object.entries(analysis.scene.edges.types)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log();
  }

  // Bounds
  if (analysis.scene.bounds) {
    console.log(chalk.bold('📐 Scene Bounds'));
    const b = analysis.scene.bounds;
    console.log(`  Min: (${b.min.x.toFixed(2)}, ${b.min.y.toFixed(2)}${b.min.z !== undefined ? `, ${b.min.z.toFixed(2)}` : ''})`);
    console.log(`  Max: (${b.max.x.toFixed(2)}, ${b.max.y.toFixed(2)}${b.max.z !== undefined ? `, ${b.max.z.toFixed(2)}` : ''})`);
    console.log(`  Size: ${b.size.x.toFixed(2)} × ${b.size.y.toFixed(2)}${b.size.z !== undefined ? ` × ${b.size.z.toFixed(2)}` : ''}`);
    console.log();
  }

  // Properties (detailed mode)
  if (options.detailed && analysis.properties) {
    if (Object.keys(analysis.properties.nodeProperties).length > 0) {
      console.log(chalk.bold('🏷️  Node Properties'));
      for (const [prop, count] of Object.entries(analysis.properties.nodeProperties)) {
        console.log(`  ${prop}: ${count} nodes`);
      }
      console.log();
    }

    if (Object.keys(analysis.properties.edgeProperties).length > 0) {
      console.log(chalk.bold('🏷️  Edge Properties'));
      for (const [prop, count] of Object.entries(analysis.properties.edgeProperties)) {
        console.log(`  ${prop}: ${count} edges`);
      }
      console.log();
    }
  }

  // Camera (detailed mode)
  if (options.detailed && analysis.scene.camera) {
    console.log(chalk.bold('📷 Camera'));
    const c = analysis.scene.camera;
    console.log(`  Position: (${c.position.x.toFixed(2)}, ${c.position.y.toFixed(2)}, ${c.position.z.toFixed(2)})`);
    console.log(`  Target: (${c.target.x.toFixed(2)}, ${c.target.y.toFixed(2)}, ${c.target.z.toFixed(2)})`);
    console.log();
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatAsYaml(obj: any, indent = 0): string {
  const spaces = '  '.repeat(indent);
  let result = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result += `${spaces}${key}:\n${formatAsYaml(value, indent + 1)}`;
    } else if (Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object') {
          result += `${spaces}  -\n${formatAsYaml(item, indent + 2)}`;
        } else {
          result += `${spaces}  - ${item}\n`;
        }
      }
    } else {
      result += `${spaces}${key}: ${value}\n`;
    }
  }

  return result;
}