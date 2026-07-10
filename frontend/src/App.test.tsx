import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import * as health from './api/health';

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows healthy once proxy-service responds ok', async () => {
    vi.spyOn(health, 'fetchHealth').mockResolvedValue();
    render(<App />);
    expect(await screen.findByText(/proxy-service: healthy/i)).toBeInTheDocument();
  });

  it('shows unreachable if proxy-service errors', async () => {
    vi.spyOn(health, 'fetchHealth').mockRejectedValue(new Error('boom'));
    render(<App />);
    expect(await screen.findByText(/proxy-service: unreachable/i)).toBeInTheDocument();
  });
});
