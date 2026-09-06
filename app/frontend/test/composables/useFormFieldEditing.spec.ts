import {
  describe, expect, it, vi,
} from 'vitest';

import {
  useFormFieldEditing,
  useFormFieldEditingState,
} from '~/composables/useFormFieldEditing';

vi.mock('#imports', async () => import('vue'));

describe('Form inline editing transitions', () => {
  it('switches one active item at a time and ignores stale release from the previous item', () => {
    const first = useFormFieldEditing('first');
    const second = useFormFieldEditing('second');
    const state = useFormFieldEditingState();

    state.clearEditing();
    first.editing.value = true;
    expect(state.selectedFieldId.value).toBe('first');
    second.editing.value = true;
    expect(state.selectedFieldId.value).toBe('second');
    first.editing.value = false;
    expect(state.selectedFieldId.value).toBe('second');
    state.clearEditing();
    expect(state.selectedFieldId.value).toBeNull();
  });
});
