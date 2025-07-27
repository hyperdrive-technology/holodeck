/**
 * StarfleetEdge component for rendering edges in ReactFlow
 */

import React from 'react';
import {
  EdgeProps,
  getStraightPath,
  EdgeLabelRenderer,
  BaseEdge
} from 'reactflow';
import type { ReactFlowEdgeData } from '../types';

export function StarfleetEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected
}: EdgeProps<ReactFlowEdgeData>) {
  const { sceneEdge, type = 'default', label, status = 'active' } = data;

  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Get edge styling based on type
  const getEdgeStyle = (edgeType: string, isSelected: boolean, edgeStatus: string) => {
    const baseStyle = {
      strokeWidth: isSelected ? 3 : 2,
      opacity: edgeStatus === 'inactive' ? 0.5 : 1,
    };

    switch (edgeType) {
      case 'dependency':
        return {
          ...baseStyle,
          stroke: '#f59e0b',
          strokeDasharray: '5,5',
        };
      case 'network':
        return {
          ...baseStyle,
          stroke: '#3b82f6',
        };
      case 'data':
        return {
          ...baseStyle,
          stroke: '#10b981',
          strokeDasharray: '3,3',
        };
      case 'security':
        return {
          ...baseStyle,
          stroke: '#ef4444',
          strokeWidth: (isSelected ? 3 : 2) + 1,
        };
      default:
        return {
          ...baseStyle,
          stroke: '#6b7280',
        };
    }
  };

  const edgeStyle = getEdgeStyle(type, !!selected, status);

  // Arrow marker style
  const getMarkerColor = (edgeType: string) => {
    switch (edgeType) {
      case 'dependency': return '#f59e0b';
      case 'network': return '#3b82f6';
      case 'data': return '#10b981';
      case 'security': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const markerColor = getMarkerColor(type);

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, ...edgeStyle }}
      />
      
      {/* Custom arrow marker */}
      <defs>
        <marker
          id={`arrow-${id}`}
          markerWidth="12"
          markerHeight="12"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M0,0 L0,6 L9,3 z"
            fill={markerColor}
          />
        </marker>
      </defs>

      {/* Edge label */}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: '10px',
              fontWeight: '500',
              color: '#374151',
              backgroundColor: 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid #e5e7eb',
              pointerEvents: 'all',
              boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}