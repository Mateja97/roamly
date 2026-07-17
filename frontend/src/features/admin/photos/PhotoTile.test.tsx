import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoTile, type PhotoTileProps } from './PhotoTile';

function baseProps(overrides: Partial<PhotoTileProps> = {}): PhotoTileProps {
  return {
    index: 0,
    isCover: false,
    src: 'https://x/1.jpg',
    caption: '',
    status: 'idle',
    pickedUp: false,
    isDropTarget: false,
    disabled: false,
    onRemove: vi.fn(),
    onSetCover: vi.fn(),
    onCaptionChange: vi.fn(),
    onRetry: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    onHandleKeyDown: vi.fn(),
    ...overrides,
  };
}

describe('PhotoTile', () => {
  it('cover tile: shows the Cover pill and Cover check, no Set-as-cover button', () => {
    render(<PhotoTile {...baseProps({ index: 0, isCover: true })} />);
    // Both the top-left pill and the footer check render the word "Cover".
    expect(screen.getAllByText('Cover')).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: 'Set as cover' }),
    ).toBeNull();
  });

  it('non-cover tile: shows "Set as cover" and calls onSetCover on click', async () => {
    const user = userEvent.setup();
    const onSetCover = vi.fn();
    render(
      <PhotoTile {...baseProps({ index: 1, isCover: false, onSetCover })} />,
    );
    await user.click(screen.getByRole('button', { name: 'Set as cover' }));
    expect(onSetCover).toHaveBeenCalled();
  });

  it('Remove has an aria-label naming the photo and calls onRemove', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<PhotoTile {...baseProps({ index: 2, onRemove })} />);
    await user.click(screen.getByRole('button', { name: 'Remove photo 3' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('caption input has the per-photo accessible name and reports changes', async () => {
    const user = userEvent.setup();
    const onCaptionChange = vi.fn();
    render(<PhotoTile {...baseProps({ index: 0, onCaptionChange })} />);
    const input = screen.getByLabelText('Caption for photo 1');
    await user.type(input, 'x');
    expect(onCaptionChange).toHaveBeenCalledWith('x');
  });

  it('uploading: shows the spinner/label and disables Remove', () => {
    render(<PhotoTile {...baseProps({ status: 'uploading', disabled: true })} />);
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeDisabled();
  });

  it('error: shows the message and a Retry button that calls onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <PhotoTile
        {...baseProps({ status: 'error', errorMessage: 'file exceeds 8MB', onRetry })}
      />,
    );
    expect(screen.getByText('file exceeds 8MB')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('drag handle: forwards keydown to onHandleKeyDown (keyboard reorder path)', async () => {
    const user = userEvent.setup();
    const onHandleKeyDown = vi.fn();
    render(<PhotoTile {...baseProps({ index: 0, onHandleKeyDown })} />);
    screen.getByRole('button', { name: 'Reorder photo 1' }).focus();
    await user.keyboard(' ');
    expect(onHandleKeyDown).toHaveBeenCalled();
  });

  it('picked-up: applies the picked-up affordance class', () => {
    const { container } = render(
      <PhotoTile {...baseProps({ pickedUp: true })} />,
    );
    expect(container.firstChild).toHaveClass('admin-photo-tile-picked-up');
  });

  it('drop-target: applies the drop-target tint class while a drag hovers it', () => {
    const { container } = render(
      <PhotoTile {...baseProps({ isDropTarget: true })} />,
    );
    expect(container.firstChild).toHaveClass('admin-photo-tile-drop-target');
  });

  it('drag source: dragstart/dragend/dragover/drop on the tile forward to the parent', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const onDragOver = vi.fn();
    const onDrop = vi.fn();
    const { container } = render(
      <PhotoTile
        {...baseProps({ onDragStart, onDragEnd, onDragOver, onDrop })}
      />,
    );
    const handle = screen.getByRole('button', { name: 'Reorder photo 1' });
    fireEvent.dragStart(handle);
    expect(onDragStart).toHaveBeenCalled();
    fireEvent.dragEnd(handle);
    expect(onDragEnd).toHaveBeenCalled();

    const tile = container.firstChild as HTMLElement;
    fireEvent.dragOver(tile);
    expect(onDragOver).toHaveBeenCalled();
    fireEvent.drop(tile);
    expect(onDrop).toHaveBeenCalled();
  });
});
