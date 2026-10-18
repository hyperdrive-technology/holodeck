import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LiveValues } from './LiveValues';

it('exposes live canvas readings as named text outputs and updates without announcements', () => {
  const { rerender } = render(<LiveValues metrics={{ requests: { text: 'Requests 100 req/s', missing: null } }} />);
  expect(screen.getByLabelText('requests.text')).toHaveTextContent('Requests 100 req/s');
  expect(screen.getByLabelText('requests.missing')).toHaveTextContent('No reading');
  rerender(<LiveValues metrics={{ requests: { text: 'Requests 200 req/s' } }} />);
  expect(screen.getByLabelText('requests.text')).toHaveTextContent('Requests 200 req/s');
  expect(screen.queryByLabelText('requests.missing')).toBeNull();
  expect(screen.getByLabelText('requests.text')).toHaveAttribute('aria-live', 'off');
});
