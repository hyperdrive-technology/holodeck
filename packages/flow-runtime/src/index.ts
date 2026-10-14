/**
 * @holodeck/flow-runtime: the flow block contract, the cyclic dataflow
 * runtime and the `holodeck.flow.local` provider (README.md; contract:
 * @holodeck/sdk docs/PACKAGING.md §7). Pure TypeScript, no React.
 */

export {
  FLOW_LIMITS,
  FLOW_PORT_TYPES,
  FLOW_SOURCE_PREFIX,
  FAULT_PORT,
  DEFAULT_SCAN_MS,
  convertTo,
  flowSource,
  isFlowValue,
  matchesType,
  typeDefault,
  typesCompatible,
} from './values';
export type { FlowPortType, FlowValue } from './values';

export {
  DEFAULT_VARIADIC_MAX,
  DEFAULT_VARIADIC_MIN,
  FLOW_BLOCK_KIND,
  FLOW_BLOCK_KIND_NAME,
  flowBlockDefinitionProblems,
  isBlockId,
  isFlowBlockDefinition,
} from './block';
export type {
  FlowBlockDefinition,
  FlowEvalArgs,
  FlowEvalResult,
  FlowInputSpec,
  FlowInputs,
  FlowOutputSpec,
  FlowParamSpec,
  FlowParamType,
  FlowParams,
  FlowPortSpec,
  FlowState,
} from './block';

export {
  BUILTIN_FLOW_BLOCKS,
  FLOW_CONST_BLOCK,
  FLOW_DELAY_BLOCK,
  SIGNAL_IN_BLOCK,
  SIGNAL_OUT_BLOCK,
  flowConstBlock,
  flowDelayBlock,
  signalInBlock,
  signalOutBlock,
} from './builtins';

export { FLOW_GRAPH_FORMAT, flowGraphFormat, isDeployable, validateFlowGraph } from './graph';
export type { FlowGraphBody, FlowGraphNode, FlowGraphPosition, FlowGraphWire, FlowProblem, FlowProblemCode, FlowWireEnd } from './graph';

export { FlowGraphError, compileFlow, tryCompileFlow } from './compile';
export type { FlowPlan, FlowPlanInput, FlowPlanNode, FlowPlanOutput, FlowSignalRef } from './compile';

export { FlowRunError, createFlowRun, snapshotState } from './run';
export type {
  FlowFault,
  FlowReading,
  FlowRun,
  FlowRunErrorCode,
  FlowRunOptions,
  FlowRunSnapshot,
  FlowRunState,
  FlowScan,
  FlowSchedule,
  FlowValueChange,
  FlowWrite,
} from './run';

export { createHubSignalBridge, createMemorySignalBridge } from './bridge';
export type {
  HubSignalBridge,
  HubSignalBridgeOptions,
  MemorySignalBridge,
  MemorySignalBridgeOptions,
  MemorySignalWrite,
  SignalBridge,
} from './bridge';

export { DEFAULT_WRITE_RETRY_MS, LOCAL_FLOW_CONFIG_SCHEMA, LOCAL_FLOW_PROVIDER_ID, createLocalFlowProvider } from './provider';
export type { FlowDeployCode, LocalFlowProviderOptions } from './provider';

export {
  FLOW_ENGINE_API_RANGE,
  FLOW_ENGINE_API_VERSION,
  FLOW_ENGINE_ID,
  collectFlowBindings,
  validateFlowBody,
} from './engine';

export {
  FLOW_RUNTIME_PACKAGE_MANIFEST,
  createFlowRuntimeExtension,
  createFlowRuntimePackage,
  flowRuntimePackage,
} from './holodeck-package';
