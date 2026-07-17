import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditActivityHeader } from './EditActivityHeader';

function renderHeader(
  overrides: Partial<Parameters<typeof EditActivityHeader>[0]> = {},
) {
  const props = {
    isCreate: false,
    activityTitle: 'Kalemegdan Park',
    status: 'draft' as const,
    saving: false,
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <EditActivityHeader {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe('EditActivityHeader', () => {
  it('edit mode: breadcrumb reads Edit, title is the activity name', () => {
    renderHeader();
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Kalemegdan Park')).toBeInTheDocument();
  });

  it('create mode: breadcrumb reads New, title reads "New activity"', () => {
    renderHeader({ isCreate: true });
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('New activity')).toBeInTheDocument();
  });

  it('shows the status pill matching the given status', () => {
    renderHeader({ status: 'published' });
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('Save in-flight: relabels to Saving… and disables both buttons', () => {
    renderHeader({ saving: true });
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('clicking Cancel/Save calls their handlers', async () => {
    const user = userEvent.setup();
    const props = renderHeader();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Save changes/ }));
    expect(props.onSave).toHaveBeenCalled();
  });
});
