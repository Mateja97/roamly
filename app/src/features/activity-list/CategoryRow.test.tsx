import { fireEvent, render, screen } from '@testing-library/react-native';
import { CategoryRow } from './CategoryRow';
import { CATEGORY_OPTIONS } from './filters';
import type { Category } from './types';

const ALL_CATEGORIES = CATEGORY_OPTIONS.map((o) => o.value);

describe('CategoryRow', () => {
  it('renders "All" plus every category in the given order', () => {
    render(<CategoryRow order={ALL_CATEGORIES} selected={[]} onToggle={jest.fn()} onClearAll={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'All categories, selected' })).toBeTruthy();
    for (const { label } of CATEGORY_OPTIONS) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('renders in a floated order — Cafés first when passed a morning-floated order', () => {
    const order: Category[] = ['cafes', ...ALL_CATEGORIES.filter((c) => c !== 'cafes')];
    render(<CategoryRow order={order} selected={[]} onToggle={jest.fn()} onClearAll={jest.fn()} />);
    // Order in the rendered tree: "All" then Cafés first among categories.
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].props.accessibilityLabel).toBe('All categories, selected');
    expect(buttons[1]).toBe(screen.getByRole('button', { name: 'Cafés' }));
  });

  it('tapping a category calls onToggle with that category', () => {
    const onToggle = jest.fn();
    render(<CategoryRow order={ALL_CATEGORIES} selected={[]} onToggle={onToggle} onClearAll={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
    expect(onToggle).toHaveBeenCalledWith('sport');
  });

  it('tapping All clears selection when something is selected', () => {
    const onClearAll = jest.fn();
    render(<CategoryRow order={ALL_CATEGORIES} selected={['sport']} onToggle={jest.fn()} onClearAll={onClearAll} />);
    fireEvent.press(screen.getByRole('button', { name: 'All categories' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('tapping an already-active All is a no-op', () => {
    const onClearAll = jest.fn();
    render(<CategoryRow order={ALL_CATEGORIES} selected={[]} onToggle={jest.fn()} onClearAll={onClearAll} />);
    fireEvent.press(screen.getByRole('button', { name: 'All categories, selected' }));
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it('marks every selected category active, independent of pill order', () => {
    render(<CategoryRow order={ALL_CATEGORIES} selected={['sport', 'culture']} onToggle={jest.fn()} onClearAll={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Sport, selected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Culture, selected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All categories' })).toBeTruthy();
  });
});
