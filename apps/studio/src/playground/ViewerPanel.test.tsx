import type { ConnectionState } from '@holodeck/sdk';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatLiveValue, LiveValues } from '../features/LiveValues';
import { connectionProblems, ViewerPanel } from './ViewerPanel';

const state = (s: ConnectionState['status']['state'], message?: string): ConnectionState =>
  ({ provider: 'x', status: { state: s, since: 0, ...(message ? { message } : {}) } }) as ConnectionState;

describe('connectionProblems', () => {
  it('lists only connections in error, with their label and message', () => {
    const connections = [
      { id: 'sim', provider: 'holodeck.sim', label: 'Sim' },
      { id: 'api', provider: 'holodeck.http', label: 'Plant API' },
      { id: 'bare', provider: 'holodeck.http' },
      { id: 'idle', provider: 'holodeck.http' },
    ];
    const statuses = { sim: state('live'), api: state('error', 'fetch failed'), bare: state('error') };
    expect(connectionProblems(connections, statuses)).toEqual([
      { id: 'api', label: 'Plant API', message: 'fetch failed' },
      { id: 'bare', label: 'bare', message: 'the provider reported an error' },
    ]);
    expect(connectionProblems([], statuses)).toEqual([]);
  });
});

describe('ViewerPanel', () => {
  it('shows a badge per connection, the error message, and the values table; Pause toggles', () => {
    const onPausedChange = vi.fn();
    render(
      <ViewerPanel
        connections={[
          { id: 'sim', provider: 'holodeck.sim', label: 'Sim' },
          { id: 'api', provider: 'holodeck.http' },
        ]}
        statuses={{ sim: state('live'), api: state('error', 'HTTP 404') }}
        metrics={{ 'tank-1': { level: 0.123456789, alarm: true }, label: { text: null } }}
        paused={false}
        onPausedChange={onPausedChange}
      />,
    );
    expect(screen.getByTestId('viewer-status-sim')).toHaveAttribute('data-state', 'live');
    expect(screen.getByTestId('viewer-status-api')).toHaveAttribute('data-state', 'error');
    expect(screen.getByTestId('viewer-message-api')).toHaveTextContent('HTTP 404');
    expect(screen.queryByTestId('viewer-message-sim')).toBeNull();
    const values = screen.getByTestId('live-values');
    expect(within(values).getByLabelText('tank-1.level')).toHaveTextContent('0.1235');
    expect(within(values).getByLabelText('tank-1.alarm')).toHaveTextContent('true');
    expect(within(values).getByLabelText('label.text')).toHaveTextContent('No reading');
    fireEvent.click(screen.getByTestId('viewer-pause'));
    expect(onPausedChange).toHaveBeenCalledWith(true);
  });

  it('says what to do with no connections or no values; shows paused', () => {
    render(<ViewerPanel connections={[]} statuses={{}} metrics={{}} paused onPausedChange={() => undefined} />);
    expect(screen.getByText(/No connections/)).toBeInTheDocument();
    expect(screen.getByText(/No live values yet/)).toBeInTheDocument();
    expect(screen.getByText('(paused)')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-pause')).toHaveTextContent('Resume');
  });
});

describe('LiveValues', () => {
  it('stays screen-reader-only by default (the studio canvas), with the raw value', () => {
    render(<LiveValues metrics={{ t: { level: 0.123456789 } }} />);
    const list = screen.getByLabelText('Live values');
    expect(list).toHaveClass('sr-only');
    expect(screen.getByLabelText('t.level')).toHaveTextContent('0.123456789');
    expect(screen.queryByTestId('live-values')).toBeNull();
  });

  it('formats values for the visible table', () => {
    expect(formatLiveValue(null)).toBe('No reading');
    expect(formatLiveValue(undefined)).toBe('No reading');
    expect(formatLiveValue(1 / 3)).toBe('0.3333');
    expect(formatLiveValue(42)).toBe('42');
    expect(formatLiveValue(false)).toBe('false');
    expect(formatLiveValue('#fee2e2')).toBe('#fee2e2');
  });
});
