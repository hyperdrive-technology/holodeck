/**
 * StarfleetNode component for rendering nodes in ReactFlow
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import { getNodeColor } from '../utils';
import type { NodeProps } from 'reactflow';
import type { ReactFlowNodeData } from '../types';

export function StarfleetNode({ data, selected }: NodeProps<ReactFlowNodeData>) {
  const { sceneNode, label, status = 'active' } = data;
  
  const nodeColor = getNodeColor(sceneNode.type);
  const isSelected = selected;
  
  // Get appropriate icon based on node type
  const getNodeIcon = (type: string): string => {
    const iconMap: Record<string, string> = {
      'server': '🖥️',
      'database': '🗄️',
      'storage': '💾',
      'network': '🌐',
      'security': '🔐',
      'function': 'λ',
      'api': '📡',
      'container': '📦',
      'messaging': '📨',
      'cache': '⚡',
      'search': '🔍',
      'loadBalancer': '⚖️',
      'cdn': '🌍',
      'dns': '🌐',
      'stack': '📚',
      'registry': '📋',
      'queue': '📬',
      'stream': '🌊',
      'default': '⭕'
    };
    
    // Try exact match first, then fallback patterns
    if (iconMap[type]) return iconMap[type];
    
    if (type.includes('server') || type.includes('ec2')) return '🖥️';
    if (type.includes('database') || type.includes('rds') || type.includes('dynamodb')) return '🗄️';
    if (type.includes('storage') || type.includes('s3')) return '💾';
    if (type.includes('network') || type.includes('vpc')) return '🌐';
    if (type.includes('function') || type.includes('lambda')) return 'λ';
    if (type.includes('container') || type.includes('ecs') || type.includes('eks')) return '📦';
    if (type.includes('cache') || type.includes('elasticache')) return '⚡';
    if (type.includes('queue') || type.includes('sqs')) return '📬';
    if (type.includes('topic') || type.includes('sns')) return '📨';
    if (type.includes('stream') || type.includes('kinesis')) return '🌊';
    
    return iconMap.default;
  };

  const icon = getNodeIcon(sceneNode.type);
  
  // Status-based styling
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'healthy':
        return { borderColor: '#22c55e', backgroundColor: '#f0fdf4' };
      case 'warning':
        return { borderColor: '#f59e0b', backgroundColor: '#fffbeb' };
      case 'critical':
        return { borderColor: '#ef4444', backgroundColor: '#fef2f2' };
      case 'inactive':
        return { borderColor: '#6b7280', backgroundColor: '#f9fafb', opacity: 0.7 };
      default:
        return { borderColor: nodeColor, backgroundColor: '#ffffff' };
    }
  };

  const statusStyle = getStatusStyle(status);
  
  const nodeStyle = {
    width: '120px',
    height: '80px',
    borderRadius: '8px',
    border: `2px solid ${statusStyle.borderColor}`,
    backgroundColor: statusStyle.backgroundColor,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px',
    position: 'relative' as const,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: isSelected 
      ? `0 0 0 2px ${nodeColor}40, 0 4px 8px rgba(0,0,0,0.15)` 
      : '0 2px 4px rgba(0,0,0,0.1)',
    transform: isSelected ? 'scale(1.05)' : 'scale(1)',
    ...statusStyle
  };

  const iconStyle = {
    fontSize: '24px',
    marginBottom: '4px',
    display: 'block',
    lineHeight: '1'
  };

  const labelStyle = {
    fontSize: '11px',
    fontWeight: '500' as const,
    color: '#374151',
    textAlign: 'center' as const,
    lineHeight: '1.2',
    wordBreak: 'break-word' as const,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    maxWidth: '100%'
  };

  const typeStyle = {
    fontSize: '9px',
    color: '#6b7280',
    textAlign: 'center' as const,
    marginTop: '2px',
    lineHeight: '1'
  };

  // Status indicator
  const statusIndicatorStyle = {
    position: 'absolute' as const,
    top: '4px',
    right: '4px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: statusStyle.borderColor
  };

  return (
    <div style={nodeStyle}>
      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ 
          background: nodeColor, 
          width: '8px', 
          height: '8px',
          border: '2px solid white'
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ 
          background: nodeColor, 
          width: '8px', 
          height: '8px',
          border: '2px solid white'
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{ 
          background: nodeColor, 
          width: '8px', 
          height: '8px',
          border: '2px solid white'
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ 
          background: nodeColor, 
          width: '8px', 
          height: '8px',
          border: '2px solid white'
        }}
      />

      {/* Status indicator */}
      <div style={statusIndicatorStyle} />

      {/* Node content */}
      <div style={iconStyle}>{icon}</div>
      <div style={labelStyle}>{label}</div>
      <div style={typeStyle}>{sceneNode.type}</div>
    </div>
  );
}