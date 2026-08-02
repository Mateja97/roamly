import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProseBlock } from './ProseBlock';

describe('ProseBlock', () => {
  it('renders the heading and body for a legitimate value', () => {
    render(<ProseBlock heading="About" value="A quiet family-run spot." />);
    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText('A quiet family-run spot.')).toBeTruthy();
  });

  it('omits the heading too when the value is absent (slot-level state rule)', () => {
    const { toJSON } = render(<ProseBlock heading="About" value={undefined} />);
    expect(toJSON()).toBeNull();
    expect(screen.queryByText('About')).toBeNull();
  });

  it('omits when the value is a denylisted placeholder', () => {
    const { toJSON } = render(<ProseBlock heading="About" value="Not specified" />);
    expect(toJSON()).toBeNull();
  });

  it('shows no "Show more" control before layout reports overflow', () => {
    render(<ProseBlock heading="About" value="A short line." />);
    expect(screen.queryByText('Show more')).toBeNull();
  });

  it('shows "Show more" once the measured layout overflows 3 lines, and expands the clamp on press', () => {
    render(<ProseBlock heading="About" value="A very long description." />);
    const measure = screen.getByTestId('prose-block-measure', { includeHiddenElements: true });
    // onLayout, not onTextLayout — see ProseBlock.tsx's ponytail comment:
    // react-native-web never implements onTextLayout at all.
    fireEvent(measure, 'layout', { nativeEvent: { layout: { height: 96 } } }); // > 3 lines' worth

    const showMore = screen.getByText('Show more');
    expect(showMore).toBeTruthy();

    fireEvent.press(showMore);
    expect(screen.queryByText('Show more')).toBeNull();
    expect(screen.getByTestId('prose-block-body').props.numberOfLines).toBeUndefined();
  });

  it('does not show "Show more" when the measured layout fits within 3 lines', () => {
    render(<ProseBlock heading="About" value="Fits in three lines." />);
    const measure = screen.getByTestId('prose-block-measure', { includeHiddenElements: true });
    fireEvent(measure, 'layout', { nativeEvent: { layout: { height: 48 } } }); // within 3 lines
    expect(screen.queryByText('Show more')).toBeNull();
  });
});
