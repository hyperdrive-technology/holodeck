import {
  calculateSceneStats,
  createMaterial,
  createTransform,
  generateId,
  Importer,
  ImportResult,
  MetricsQuery,
  MetricsResult,
  Provider,
  SceneFile,
  validateScene,
} from '@starfleet/sdk';

// Example 1: Creating a Simple Scene
function createBasicScene(): SceneFile {
  // Create a scene with some basic infrastructure nodes
  const scene: SceneFile = {
    version: '0.1.0',
    metadata: {
      name: 'Basic Infrastructure Scene',
      description: 'A simple example showing servers and database connections',
      author: 'Starfleet SDK Example',
      created: new Date().toISOString(),
      tags: ['infrastructure', 'example'],
    },
    scene: {
      nodes: [
        {
          id: generateId(),
          type: 'server',
          name: 'Web Server',
          transform: createTransform(
            { x: 0, y: 0, z: 0 }, // position
            { x: 0, y: 0, z: 0 }, // rotation
            { x: 1, y: 1, z: 1 } // scale
          ),
          geometry: {
            type: 'box',
            parameters: { width: 2, height: 1, depth: 1 },
          },
          material: createMaterial({
            color: { r: 0.2, g: 0.8, b: 0.2, a: 1 }, // Green server
          }),
          status: 'healthy',
          metadata: {
            cpu: '85%',
            memory: '12GB',
            uptime: '15 days',
          },
        },
        {
          id: generateId(),
          type: 'database',
          name: 'Primary Database',
          transform: createTransform(
            { x: 5, y: 0, z: 0 } // position to the right
          ),
          geometry: {
            type: 'cylinder',
            parameters: { radius: 1, height: 2 },
          },
          material: createMaterial({
            color: { r: 0.2, g: 0.2, b: 0.8, a: 1 }, // Blue database
          }),
          status: 'healthy',
          metadata: {
            size: '500GB',
            connections: 25,
            queries_per_second: 150,
          },
        },
      ],
      edges: [
        {
          id: generateId(),
          source: 'web-server',
          target: 'database',
          type: 'data-connection',
          color: { r: 0.5, g: 0.5, b: 0.5, a: 0.8 },
          width: 0.1,
          style: 'solid',
          metadata: {
            protocol: 'TCP',
            port: 5432,
            latency: '2ms',
          },
        },
      ],
    },
  };

  return scene;
}

// Example 2: Scene Validation
function validateExampleScene() {
  const scene = createBasicScene();
  const validation = validateScene(scene);

  console.log('Scene validation results:');
  console.log('Valid:', validation.valid);

  if (validation.errors.length > 0) {
    console.log('Errors:');
    validation.errors.forEach((error) => console.log('  -', error));
  }

  if (validation.warnings.length > 0) {
    console.log('Warnings:');
    validation.warnings.forEach((warning) => console.log('  -', warning));
  }
}

// Example 3: Scene Statistics
function getSceneStatistics() {
  const scene = createBasicScene();
  const stats = calculateSceneStats(scene);

  console.log('\nScene Statistics:');
  console.log('Nodes:', stats.nodeCount);
  console.log('Edges:', stats.edgeCount);

  if (stats.bounds) {
    console.log('Bounds:');
    console.log('  Min:', stats.bounds.min);
    console.log('  Max:', stats.bounds.max);
    console.log('  Size:', stats.bounds.size);
  }
}

// Example 4: Simple Importer Implementation
class JSONImporter implements Importer {
  id = 'json-importer';
  name = 'JSON Infrastructure Importer';
  description = 'Imports infrastructure data from JSON files';
  supportedFormats = ['.json'];

  async import(input: string): Promise<ImportResult> {
    try {
      const data = JSON.parse(input);

      // Transform the input data into a SceneFile
      const scene: SceneFile = {
        version: '0.1.0',
        metadata: {
          name: data.name || 'Imported Scene',
          description: data.description || 'Imported from JSON',
          importedAt: new Date().toISOString(),
          importedBy: this.id,
        },
        scene: {
          nodes:
            data.nodes?.map((node: any) => ({
              id: node.id || generateId(),
              type: node.type || 'unknown',
              name: node.name || 'Unknown Node',
              transform: createTransform(node.position || { x: 0, y: 0, z: 0 }),
              material: createMaterial(node.material || {}),
              metadata: node.metadata || {},
            })) || [],
          edges:
            data.edges?.map((edge: any) => ({
              id: edge.id || generateId(),
              source: edge.source,
              target: edge.target,
              type: edge.type || 'connection',
              metadata: edge.metadata || {},
            })) || [],
        },
      };

      return {
        scene,
        warnings: [],
        errors: [],
      };
    } catch (error) {
      return {
        scene: createBasicScene(), // fallback
        warnings: [],
        errors: [`Failed to parse JSON: ${error}`],
      };
    }
  }

  async validate(input: string): Promise<boolean> {
    try {
      JSON.parse(input);
      return true;
    } catch {
      return false;
    }
  }
}

// Example 5: Simple Provider Implementation
class MockMetricsProvider implements Provider {
  id = 'mock-metrics';
  name = 'Mock Metrics Provider';
  description = 'Provides mock metrics data for testing';

  private connected = false;

  async connect(): Promise<void> {
    // Simulate connection delay
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.connected = true;
    console.log('Mock metrics provider connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log('Mock metrics provider disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  async query(query: MetricsQuery): Promise<MetricsResult[]> {
    if (!this.connected) {
      throw new Error('Provider not connected');
    }

    // Generate mock metrics data
    const results: MetricsResult[] = [];

    for (const nodeId of query.nodeIDs || []) {
      for (const metricName of query.metricNames || ['cpu', 'memory', 'disk']) {
        results.push({
          nodeId,
          metricName,
          dataPoints: [
            {
              timestamp: new Date(),
              value: Math.random() * 100,
              tags: { unit: metricName === 'cpu' ? 'percent' : 'bytes' },
            },
          ],
          unit: metricName === 'cpu' ? 'percent' : 'bytes',
        });
      }
    }

    return results;
  }

  async healthCheck(): Promise<boolean> {
    return this.connected;
  }
}

// Example 6: Using the SDK
async function runExample() {
  console.log('=== Starfleet SDK Example ===\n');

  // Create and validate a scene
  const scene = createBasicScene();
  console.log('Created scene with', scene.scene.nodes.length, 'nodes');

  // Validate the scene
  validateExampleScene();

  // Get statistics
  getSceneStatistics();

  // Test importer
  console.log('\n=== Testing Importer ===');
  const importer = new JSONImporter();
  const sampleData = JSON.stringify({
    name: 'Test Infrastructure',
    nodes: [
      {
        id: 'node1',
        type: 'server',
        name: 'Test Server',
        position: { x: 1, y: 2, z: 3 },
      },
    ],
    edges: [],
  });

  const importResult = await importer.import(sampleData);
  console.log('Import result:', importResult.scene.metadata.name);
  console.log('Imported nodes:', importResult.scene.scene.nodes.length);

  // Test provider
  console.log('\n=== Testing Provider ===');
  const provider = new MockMetricsProvider();
  await provider.connect();

  const metricsQuery: MetricsQuery = {
    nodeIDs: ['node1'],
    metricNames: ['cpu', 'memory'],
  };

  const metrics = await provider.query(metricsQuery);
  console.log('Retrieved metrics:', metrics.length);

  for (const metric of metrics) {
    console.log(
      `${metric.nodeId}.${metric.metricName}:`,
      metric.dataPoints[0].value
    );
  }

  await provider.disconnect();

  console.log('\n=== Example Complete ===');
}

// Run the example
if (require.main === module) {
  runExample().catch(console.error);
}

export {
  createBasicScene,
  getSceneStatistics,
  JSONImporter,
  MockMetricsProvider,
  runExample,
  validateExampleScene,
};
