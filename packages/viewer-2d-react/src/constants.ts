/**
 * Constants for the 2D React viewer
 */

// Default node types mapping
export const NODE_TYPES = {
  'aws:ec2:instance': 'server',
  'aws:s3:bucket': 'storage',
  'aws:rds:instance': 'database',
  'aws:elb:loadbalancer': 'loadBalancer',
  'aws:vpc:vpc': 'network',
  'aws:iam:role': 'security',
  'aws:lambda:function': 'function',
  'aws:apigateway:restapi': 'api',
  'aws:cloudformation:stack': 'stack',
  'aws:route53:hostedzone': 'dns',
  'aws:cloudfront:distribution': 'cdn',
  'aws:eks:cluster': 'container',
  'aws:ecs:cluster': 'container',
  'aws:ecr:repository': 'registry',
  'aws:sns:topic': 'messaging',
  'aws:sqs:queue': 'queue',
  'aws:kinesis:stream': 'stream',
  'aws:dynamodb:table': 'database',
  'aws:elasticache:cluster': 'cache',
  'aws:elasticsearch:domain': 'search',
  // Generic fallbacks
  'server': 'server',
  'database': 'database',
  'storage': 'storage',
  'network': 'network',
  'security': 'security',
  'function': 'function',
  'api': 'api',
  'container': 'container',
  'messaging': 'messaging',
  'default': 'default'
} as const;

// Default edge types mapping
export const EDGE_TYPES = {
  'connection': 'default',
  'dependency': 'dependency',
  'network': 'network',
  'data': 'data',
  'security': 'security',
  'default': 'default'
} as const;

// Color schemes for different node types
export const NODE_COLORS = {
  server: '#FF9900',     // AWS Orange
  database: '#3F48CC',   // Blue
  storage: '#7AA116',    // Green
  network: '#232F3E',    // Dark Blue
  security: '#FF9900',   // Orange
  function: '#FF9900',   // Orange
  api: '#3F48CC',       // Blue
  container: '#FF9900',  // Orange
  messaging: '#3F48CC',  // Blue
  cache: '#7AA116',     // Green
  search: '#232F3E',    // Dark Blue
  loadBalancer: '#FF9900', // Orange
  cdn: '#7AA116',       // Green
  dns: '#3F48CC',       // Blue
  stack: '#232F3E',     // Dark Blue
  registry: '#FF9900',  // Orange
  queue: '#3F48CC',     // Blue
  stream: '#7AA116',    // Green
  default: '#8B949E'    // Gray
} as const;

// Node size configurations
export const NODE_SIZES = {
  small: { width: 80, height: 60 },
  medium: { width: 120, height: 80 },
  large: { width: 160, height: 100 }
} as const;

// Layout configurations
export const LAYOUT_CONFIGS = {
  dagre: {
    rankdir: 'TB',
    ranksep: 100,
    nodesep: 80,
    align: 'UL'
  },
  force: {
    strength: -1000,
    distance: 150,
    iterations: 300
  }
} as const;

// View configurations
export const VIEW_CONFIG = {
  defaultZoom: 1,
  minZoom: 0.1,
  maxZoom: 3,
  fitViewPadding: 0.1,
  panOnDrag: true,
  zoomOnScroll: true,
  zoomOnPinch: true,
  zoomOnDoubleClick: true
} as const;
