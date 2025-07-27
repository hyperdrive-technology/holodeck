import { readdir, stat } from 'fs/promises';
import { resolve, join } from 'path';
import { createRequire } from 'module';
import type { SceneFile } from '../types/sdk';

export interface ImporterInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  supportedFormats: string[];
  validate?: (content: string) => Promise<boolean>;
  import: (content: string, config?: any) => Promise<ImportResult>;
  packagePath: string;
}

export interface ImportResult {
  scene: SceneFile;
  errors?: string[];
  warnings?: string[];
}

// Use a compatibility approach for require in both ESM and CJS
const getRequire = () => {
  if (typeof require !== 'undefined') {
    return require;
  }
  return createRequire(import.meta.url);
};

/**
 * Discover all installed Starfleet importer packages
 */
export async function discoverImporters(): Promise<ImporterInfo[]> {
  const importers: ImporterInfo[] = [];
  
  try {
    // Look in node_modules for packages matching starfleet-importer-*
    const nodeModulesPath = findNodeModules();
    const packages = await findImporterPackages(nodeModulesPath);
    
    for (const packagePath of packages) {
      try {
        const importer = await loadImporter(packagePath);
        if (importer) {
          importers.push(importer);
        }
      } catch (error) {
        console.warn(`Failed to load importer from ${packagePath}:`, error);
      }
    }
  } catch (error) {
    console.warn('Error discovering importers:', error);
  }
  
  return importers;
}

/**
 * Find the node_modules directory relative to this package
 */
function findNodeModules(): string {
  // Start from current directory and work up
  let currentDir = process.cwd();
  
  while (currentDir !== '/') {
    const nodeModulesPath = join(currentDir, 'node_modules');
    try {
      const requireFn = getRequire();
      requireFn.resolve(nodeModulesPath);
      return nodeModulesPath;
    } catch {
      // Continue searching up
    }
    currentDir = resolve(currentDir, '..');
  }
  
  // Fallback to default location
  return join(process.cwd(), 'node_modules');
}

/**
 * Find all importer packages in node_modules
 */
async function findImporterPackages(nodeModulesPath: string): Promise<string[]> {
  const packages: string[] = [];
  
  try {
    const entries = await readdir(nodeModulesPath);
    
    for (const entry of entries) {
      if (entry.startsWith('starfleet-importer-')) {
        const packagePath = join(nodeModulesPath, entry);
        const stats = await stat(packagePath);
        
        if (stats.isDirectory()) {
          packages.push(packagePath);
        }
      }
    }
  } catch (error) {
    // node_modules might not exist or be accessible
  }
  
  return packages;
}

/**
 * Load an importer from a package directory
 */
async function loadImporter(packagePath: string): Promise<ImporterInfo | null> {
  try {
    // Read package.json
    const packageJsonPath = join(packagePath, 'package.json');
    const requireFn = getRequire();
    const packageJson = requireFn(packageJsonPath);
    
    // Try to load the main module
    const mainPath = packageJson.main || 'index.js';
    const modulePath = join(packagePath, mainPath);
    
    const module = requireFn(modulePath);
    
    // Extract importer interface
    const importer = module.default || module;
    
    if (!importer.import || typeof importer.import !== 'function') {
      throw new Error('Invalid importer: missing import function');
    }
    
    return {
      id: packageJson.name.replace('starfleet-importer-', ''),
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      supportedFormats: importer.supportedFormats || ['*'],
      validate: importer.validate,
      import: importer.import,
      packagePath
    };
  } catch (error) {
    throw new Error(`Failed to load importer from ${packagePath}: ${error}`);
  }
}

/**
 * Load a specific importer by ID
 */
export async function loadImporterById(id: string): Promise<ImporterInfo | null> {
  const importers = await discoverImporters();
  return importers.find(imp => imp.id === id) || null;
}