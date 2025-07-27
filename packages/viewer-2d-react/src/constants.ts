/**
 * Constants for the 2D React viewer
 */

// Node type constants
export const NODE_TYPES = {
  // Infrastructure nodes
  SERVER: 'server',
  DATABASE: 'database',
  NETWORK: 'network',
  STORAGE: 'storage',
  LOAD_BALANCER: 'load-balancer',
  CONTAINER: 'container',
  SERVICE: 'service',
  FUNCTION: 'function',
  QUEUE: 'queue',
  CACHE: 'cache',

  // Cloud provider nodes
  AWS_EC2: 'aws-ec2',
  AWS_RDS: 'aws-rds',
  AWS_S3: 'aws-s3',
  AWS_LAMBDA: 'aws-lambda',
  AWS_ELB: 'aws-elb',
  AWS_VPC: 'aws-vpc',
  AWS_SQS: 'aws-sqs',
  AWS_SNS: 'aws-sns',

  // Generic nodes
  GENERIC: 'generic',
  GROUP: 'group',
  ANNOTATION: 'annotation',
} as const;

// Edge type constants
export const EDGE_TYPES = {
  // Connection types
  NETWORK: 'network',
  DATA_FLOW: 'data-flow',
  DEPENDENCY: 'dependency',
  API_CALL: 'api-call',
  MESSAGE: 'message',
  SYNC: 'sync',
  ASYNC: 'async',

  // Generic edges
  GENERIC: 'generic',
  STRAIGHT: 'straight',
  SMOOTH: 'smooth',
  STEP: 'step',
} as const;

// Layout constants
export const LAYOUT_TYPES = {
  DAGRE: 'dagre',
  FORCE: 'force',
  MANUAL: 'manual',
} as const;

// Default layout configurations
export const DEFAULT_LAYOUT_CONFIG = {
  nodeSpacing: 100,
  rankSpacing: 150,
  direction: 'TB' as const,
  align: 'UL' as const,
  forceConfig: {
    strength: -800,
    distance: 200,
    iterations: 300,
  },
};

// Node size constants
export const NODE_SIZES = {
  SMALL: { width: 60, height: 60 },
  MEDIUM: { width: 120, height: 80 },
  LARGE: { width: 180, height: 120 },
  EXTRA_LARGE: { width: 240, height: 160 },
} as const;

// Color constants
export const NODE_COLORS = {
  // Status colors
  HEALTHY: '#22c55e',
  WARNING: '#f59e0b',
  CRITICAL: '#ef4444',
  UNKNOWN: '#6b7280',

  // Type colors
  SERVER: '#3b82f6',
  DATABASE: '#8b5cf6',
  NETWORK: '#10b981',
  STORAGE: '#f59e0b',
  FUNCTION: '#ec4899',
  QUEUE: '#06b6d4',

  // AWS colors
  AWS_ORANGE: '#ff9900',
  AWS_BLUE: '#232f3e',
  AWS_GREEN: '#146eb4',

  // Default colors
  DEFAULT: '#6b7280',
  SELECTED: '#2563eb',
  HOVER: '#3b82f6',
} as const;

// Viewport constants
export const VIEWPORT_DEFAULTS = {
  x: 0,
  y: 0,
  zoom: 1,
  minZoom: 0.1,
  maxZoom: 4,
} as const;

// Animation constants
export const ANIMATION_DURATION = {
  FAST: 150,
  NORMAL: 300,
  SLOW: 600,
} as const;
