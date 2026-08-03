import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SubtypeRail } from './SubtypeRail';
import { SUBCATEGORIES } from './filters';

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

async function flush() {
  await act(async () => {});
}

describe('SubtypeRail', () => {
  it('renders a labelled rail with one chip per subtype in taxonomy order', async () => {
    render(<SubtypeRail category="sport" counts={{}} selectedSubtypes={[]} onToggle={jest.fn()} />);
    await flush();
    expect(screen.getByText('Sport subtypes')).toBeTruthy();
    for (const { label } of SUBCATEGORIES.sport) {
      expect(screen.getByText(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(`))).toBeTruthy();
    }
  });

  it('shows the live per-subtype count in the chip label', async () => {
    render(
      <SubtypeRail
        category="sport"
        counts={{ climbing_gym: 5 }}
        selectedSubtypes={[]}
        onToggle={jest.fn()}
      />
    );
    await flush();
    expect(screen.getByText('Climbing Gym (5)')).toBeTruthy();
  });

  it('disables a chip at zero count', async () => {
    render(<SubtypeRail category="sport" counts={{ golf_course: 0 }} selectedSubtypes={[]} onToggle={jest.fn()} />);
    await flush();
    const chip = screen.getByRole('button', { name: /golf course.*0 results.*unavailable/i });
    expect(chip.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('tapping an enabled chip calls onToggle with its slug', async () => {
    const onToggle = jest.fn();
    render(<SubtypeRail category="sport" counts={{ climbing_gym: 3 }} selectedSubtypes={[]} onToggle={onToggle} />);
    await flush();
    fireEvent.press(screen.getByText('Climbing Gym (3)'));
    expect(onToggle).toHaveBeenCalledWith('climbing_gym');
  });

  it('tapping a disabled (zero-count) chip does not call onToggle', async () => {
    const onToggle = jest.fn();
    render(<SubtypeRail category="sport" counts={{ golf_course: 0 }} selectedSubtypes={[]} onToggle={onToggle} />);
    await flush();
    fireEvent.press(screen.getByText('Golf Course (0)'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('marks a selected subtype active', async () => {
    render(
      <SubtypeRail category="sport" counts={{ climbing_gym: 3 }} selectedSubtypes={['climbing_gym']} onToggle={jest.fn()} />
    );
    await flush();
    const chip = screen.getByRole('button', { name: /climbing gym.*3 results/i });
    expect(chip.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('a selected chip stays enabled even when its live count drops to 0 (e.g. mid-refetch) — must stay deselectable', async () => {
    const onToggle = jest.fn();
    render(
      <SubtypeRail category="sport" counts={{ climbing_gym: 0 }} selectedSubtypes={['climbing_gym']} onToggle={onToggle} />
    );
    await flush();
    const chip = screen.getByRole('button', { name: /climbing gym.*0 results/i });
    expect(chip.props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    fireEvent.press(chip);
    expect(onToggle).toHaveBeenCalledWith('climbing_gym');
  });

  it('reduced motion renders chips fully visible immediately (no stagger to wait out)', async () => {
    render(<SubtypeRail category="cafes" counts={{}} selectedSubtypes={[]} onToggle={jest.fn()} />);
    await flush();
    expect(screen.getByText('Coffee Shop (0)')).toBeTruthy();
  });
});
