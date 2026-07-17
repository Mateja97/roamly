import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusSection } from './StatusSection';

describe('StatusSection', () => {
  it('marks exactly the current status radio checked', () => {
    render(
      <StatusSection
        status="draft"
        onStatusChange={vi.fn()}
        createdAt="2026-07-16T14:20:00Z"
      />,
    );
    expect(screen.getByRole('radio', { name: 'Draft' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Published' })).not.toBeChecked();
  });

  it('selecting a different option calls onStatusChange', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    render(<StatusSection status="draft" onStatusChange={onStatusChange} />);
    await user.click(screen.getByRole('radio', { name: 'Pending review' }));
    expect(onStatusChange).toHaveBeenCalledWith('pending');
  });

  it('renders the honest "Created <date>" line when createdAt is given', () => {
    render(
      <StatusSection
        status="published"
        onStatusChange={vi.fn()}
        createdAt="2026-07-16T14:20:00Z"
      />,
    );
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('omits the Created line entirely when createdAt is absent (create mode)', () => {
    render(<StatusSection status="draft" onStatusChange={vi.fn()} />);
    expect(screen.queryByText('Created')).toBeNull();
  });

  it('never renders a fabricated editor name', () => {
    render(
      <StatusSection
        status="published"
        onStatusChange={vi.fn()}
        createdAt="2026-07-16T14:20:00Z"
      />,
    );
    expect(screen.queryByText(/Mila/)).toBeNull();
    expect(screen.queryByText(/edited by/i)).toBeNull();
  });
});
