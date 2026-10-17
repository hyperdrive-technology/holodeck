import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FrameGuard, isFramed } from './FrameGuard';

describe('FrameGuard (holodeck#152)', () => {
  it('renders the studio when not framed', () => {
    render(<FrameGuard framed={false}><p>studio</p></FrameGuard>);
    expect(screen.getByText('studio')).toBeInTheDocument();
  });

  it('refuses to render inside a frame', () => {
    render(<FrameGuard framed><p>studio</p></FrameGuard>);
    expect(screen.queryByText('studio')).toBeNull();
    expect(screen.getByTestId('frame-refused')).toHaveTextContent('cannot be shown inside another page');
  });

  it('detects framing', () => {
    const self = {} as Window;
    expect(isFramed({ top: self, self })).toBe(false);
    expect(isFramed({ top: {} as Window, self })).toBe(true);
    expect(isFramed(window)).toBe(false);
    const throwing = { self, get top(): Window { throw new Error('blocked'); } };
    expect(isFramed(throwing)).toBe(true);
  });
});
