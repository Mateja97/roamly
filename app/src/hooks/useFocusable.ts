import { useState } from 'react';

// Mobile has no hover — a border-color swap on focus is the whole visible
// keyboard/screen-reader feedback (DESIGN_STANDARDS.md's Touch & interaction
// / Accessibility sections). Small enough to hand-roll per component (see
// ChoiceCard, ScopePickerScreen's ErrorMessage) until now — T4 has six
// buttons needing the identical onFocus/onBlur pair, worth one hook.
export function useFocusable() {
  const [focused, setFocused] = useState(false);
  return { focused, onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
}
