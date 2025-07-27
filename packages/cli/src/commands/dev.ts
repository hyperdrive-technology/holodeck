import chalk from 'chalk';
import chokidar from 'chokidar';
import { Command } from 'commander';
import { readFile } from 'fs/promises';
import ora from 'ora';
import { resolve, dirname, join } from 'path';
import { createServer, InlineConfig } from 'vite';
import { discoverImporters } from '../utils/discovery';

export const devCommand = new Command('dev')
  .description('Start development server with live preview')
  .argument('<input>', 'Input file path to watch')
  .option('-p, --port <port>', 'Development server port', '3000')
  .option('-o, --open', 'Open browser automatically')
  .option('-t, --type <type>', 'Force importer type (auto-detect by default)')
  .option('--verbose', 'Enable verbose output')
  .action(async (input, options) => {
    const spinner = ora('Starting development server...').start();

    try {
      const inputPath = resolve(input);
      const port = parseInt(options.port);

      if (options.verbose) {
        spinner.info(`Watching: ${inputPath}`);
        spinner.info(`Port: ${port}`);
      }

      // Discover importers
      spinner.text = 'Discovering importers...';
      const importers = await discoverImporters();

      if (importers.length === 0) {
        spinner.fail('No importers found. Please install an importer package.');
        process.exit(1);
      }

      // Find appropriate importer
      const importer = await findImporter(inputPath, options.type, importers);
      if (!importer) {
        spinner.fail('No suitable importer found for this file.');
        process.exit(1);
      }

      spinner.text = `Using importer: ${importer.name}`;

      // Initial file processing
      let currentScene: any = null;
      try {
        currentScene = await processFile(inputPath, importer);
        spinner.succeed(`Initial processing complete - Using ${importer.name}`);
      } catch (error) {
        spinner.fail('Failed to process initial file');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }

      // Create Vite server
      const server = await createViteServer(port, currentScene);

      // Set up file watching
      const watcher = chokidar.watch(inputPath, {
        persistent: true,
        ignoreInitial: true
      });

      console.log(chalk.green(`🚀 Development server running at http://localhost:${port}`));
      console.log(chalk.gray(`📁 Watching: ${inputPath}`));
      console.log(chalk.gray(`⚡ Using: ${importer.name}`));
      console.log(chalk.gray('\n📝 Press Ctrl+C to stop\n'));

      // Handle file changes
      watcher.on('change', async () => {
        const updateSpinner = ora('File changed, reprocessing...').start();
        
        try {
          currentScene = await processFile(inputPath, importer);
          
          // Notify browser clients via Vite's HMR
          server.ws.send({
            type: 'custom',
            event: 'starfleet-update',
            data: { scene: currentScene }
          });
          
          updateSpinner.succeed('Scene updated');
        } catch (error) {
          updateSpinner.fail('Processing failed');
          console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        }
      });

      watcher.on('error', (error) => {
        console.error(chalk.red('Watcher error:'), error);
      });

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n🛑 Shutting down...'));
        await watcher.close();
        await server.close();
        process.exit(0);
      });

      // Open browser if requested
      if (options.open) {
        const { default: open } = await import('open');
        await open(`http://localhost:${port}`);
      }

    } catch (error) {
      spinner.fail('Failed to start development server');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

async function findImporter(inputPath: string, forceType: string | undefined, importers: any[]) {
  if (forceType) {
    return importers.find(imp => imp.id === forceType);
  }

  // Auto-detect by file extension
  const ext = inputPath.split('.').pop()?.toLowerCase();
  return importers.find(imp =>
    imp.supportedFormats.includes(`.${ext}`) ||
    imp.supportedFormats.includes('*')
  );
}

async function processFile(inputPath: string, importer: any) {
  const content = await readFile(inputPath, 'utf-8');
  
  // Validate if possible
  if (importer.validate) {
    const isValid = await importer.validate(content);
    if (!isValid) {
      throw new Error('File validation failed');
    }
  }

  // Import
  const result = await importer.import(content, {});

  if (result.errors && result.errors.length > 0) {
    throw new Error(`Import errors: ${result.errors.join(', ')}`);
  }

  if (result.warnings && result.warnings.length > 0) {
    console.warn(chalk.yellow('Warnings:'));
    result.warnings.forEach((warning: string) => 
      console.warn(chalk.yellow(`  - ${warning}`))
    );
  }

  return result.scene;
}

async function createViteServer(port: number, initialScene: any) {
  const config: InlineConfig = {
    server: {
      port,
      open: false,
      cors: true
    },
    configFile: false,
    root: process.cwd(),
    plugins: [
      {
        name: 'starfleet-dev',
        configureServer(server) {
          // Serve the viewer app
          server.middlewares.use('/api/scene', (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify(initialScene));
          });

          // Serve a simple HTML page with the viewer
          server.middlewares.use('/', (req, res, next) => {
            if (req.url === '/' || req.url === '/index.html') {
              res.setHeader('Content-Type', 'text/html');
              res.end(getViewerHTML());
            } else {
              next();
            }
          });
        }
      }
    ]
  };

  const server = await createServer(config);
  await server.listen();
  return server;
}

function getViewerHTML(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Starfleet Dev Server</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #ffffff;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .header {
      border-bottom: 1px solid #333;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .viewer {
      border: 1px solid #333;
      border-radius: 8px;
      background: #2a2a2a;
      padding: 20px;
      min-height: 400px;
    }
    .placeholder {
      text-align: center;
      padding: 60px 20px;
      color: #888;
    }
    .scene-info {
      background: #333;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 20px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Starfleet Development Server</h1>
      <p>Live preview of your Starfleet scene</p>
    </div>
    
    <div id="scene-info" class="scene-info">
      Loading scene...
    </div>
    
    <div class="viewer">
      <div id="viewer-content" class="placeholder">
        <h3>Starfleet 2D Viewer</h3>
        <p>The 2D viewer will render here once implemented.</p>
        <p>For now, check the scene data above.</p>
      </div>
    </div>
  </div>

  <script>
    let currentScene = null;
    
    async function loadScene() {
      try {
        const response = await fetch('/api/scene');
        currentScene = await response.json();
        updateSceneInfo();
      } catch (error) {
        console.error('Failed to load scene:', error);
        document.getElementById('scene-info').textContent = 'Failed to load scene: ' + error.message;
      }
    }
    
    function updateSceneInfo() {
      const sceneInfo = document.getElementById('scene-info');
      if (currentScene) {
        const nodeCount = currentScene.scene?.nodes?.length || 0;
        const edgeCount = currentScene.scene?.edges?.length || 0;
        sceneInfo.innerHTML = \`
          <strong>Scene:</strong> \${currentScene.metadata?.name || 'Untitled'}<br>
          <strong>Nodes:</strong> \${nodeCount}<br>
          <strong>Edges:</strong> \${edgeCount}<br>
          <strong>Last Updated:</strong> \${new Date().toLocaleTimeString()}
        \`;
      }
    }
    
    // Set up WebSocket for live updates
    if (window.location.protocol === 'http:') {
      const ws = new WebSocket('ws://localhost:' + window.location.port);
      
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'custom' && message.event === 'starfleet-update') {
          currentScene = message.data.scene;
          updateSceneInfo();
          console.log('Scene updated via HMR');
        }
      };
    }
    
    // Initial load
    loadScene();
  </script>
</body>
</html>
`;
}