export type FormSelectionEvent =
  | { fieldId: string; type: 'item_select' }
  | { nextFieldId: string | null; type: 'selected_delete' }
  | { type: 'canvas_blank' }
  | { type: 'inline_edit_close' | 'settings_interaction' };

export function transitionFormSelection(
  selectedFieldId: string | null,
  event: FormSelectionEvent,
): string | null {
  if (event.type === 'item_select') return event.fieldId;
  if (event.type === 'canvas_blank') return null;
  if (event.type === 'selected_delete') return event.nextFieldId;
  return selectedFieldId;
}
