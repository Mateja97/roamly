import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ArrowRight, MapPin } from 'lucide-react-native';
import { ScopeTicket } from './ScopeTicket';
import { Spinner } from './Spinner';
import { colors } from '../theme/tokens';

const baseProps = {
  icon: MapPin,
  title: 'Nearby',
  hint: 'Within reach',
  accessibilityLabel: 'Explore activities nearby',
  onPress: jest.fn(),
};

describe('ScopeTicket', () => {
  it('selected: 2px primary border and a filled (primary-bg) go-circle', () => {
    render(<ScopeTicket {...baseProps} selected />);
    const button = screen.getByRole('button', { name: baseProps.accessibilityLabel });
    const style = StyleSheet.flatten(button.props.style);
    expect(style.borderWidth).toBe(2);
    expect(style.borderColor).toBe(colors.primary);
    const goCircle = StyleSheet.flatten(screen.getByTestId('scope-ticket-go-circle', { includeHiddenElements: true }).props.style);
    expect(goCircle.backgroundColor).toBe(colors.primary);
  });

  it('unselected: 1px border, no selected emphasis, outlined (unfilled) go-circle', () => {
    render(<ScopeTicket {...baseProps} selected={false} />);
    const button = screen.getByRole('button', { name: baseProps.accessibilityLabel });
    const style = StyleSheet.flatten(button.props.style);
    expect(style.borderWidth).toBe(1);
    expect(style.borderColor).toBe(colors.border);
    const goCircle = StyleSheet.flatten(screen.getByTestId('scope-ticket-go-circle', { includeHiddenElements: true }).props.style);
    expect(goCircle.backgroundColor).toBeUndefined();
    expect(goCircle.borderColor).toBe(colors.primary);
  });

  it('unselected + focused: gains the 2px focus border', () => {
    render(<ScopeTicket {...baseProps} selected={false} />);
    const button = screen.getByRole('button', { name: baseProps.accessibilityLabel });
    fireEvent(button, 'focus');
    expect(StyleSheet.flatten(screen.getByRole('button', { name: baseProps.accessibilityLabel }).props.style).borderWidth).toBe(2);
    fireEvent(button, 'blur');
    expect(StyleSheet.flatten(screen.getByRole('button', { name: baseProps.accessibilityLabel }).props.style).borderWidth).toBe(1);
  });

  it('selected + focused: no extra focus border (selected border already carries it)', () => {
    render(<ScopeTicket {...baseProps} selected />);
    const button = screen.getByRole('button', { name: baseProps.accessibilityLabel });
    fireEvent(button, 'focus');
    expect(StyleSheet.flatten(screen.getByRole('button', { name: baseProps.accessibilityLabel }).props.style).borderWidth).toBe(2);
  });

  it('idle: shows the go arrow, no spinner, not disabled', () => {
    render(<ScopeTicket {...baseProps} selected={false} busy={false} />);
    expect(screen.UNSAFE_queryByType(Spinner)).toBeNull();
    expect(screen.UNSAFE_getByType(ArrowRight)).toBeTruthy();
    expect(screen.getByRole('button', { name: baseProps.accessibilityLabel }).props.accessibilityState.disabled).toBeFalsy();
  });

  it('busy: swaps the arrow for the spinner, marks busy, and disables the press target', () => {
    render(<ScopeTicket {...baseProps} selected busy />);
    const button = screen.getByRole('button', { name: baseProps.accessibilityLabel });
    expect(screen.UNSAFE_queryByType(ArrowRight)).toBeNull();
    expect(screen.UNSAFE_getByType(Spinner)).toBeTruthy();
    expect(button.props.accessibilityState.busy).toBe(true);
    expect(button.props.accessibilityState.disabled).toBe(true);
  });

  it('busy + reduceMotion: keeps the static arrow instead of an animated spinner', () => {
    render(<ScopeTicket {...baseProps} selected busy reduceMotion />);
    expect(screen.UNSAFE_queryByType(Spinner)).toBeNull();
    expect(screen.UNSAFE_getByType(ArrowRight)).toBeTruthy();
  });
});
