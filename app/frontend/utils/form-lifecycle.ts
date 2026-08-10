import type {
  ChangeFormStatusRequest,
  FormStatus,
  FormSummary,
  PublishedFormDefinition,
} from '@weave/types';

export type FormLifecycleAction = 'archive' | 'close' | 'reopen' | 'restore';

export interface FormLifecycleActionItem {
  action: FormLifecycleAction;
  endpoint: 'archiveForm' | 'closeForm' | 'reopenForm' | 'unarchiveForm';
  icon: string;
  label: string;
}

const actions: Record<FormLifecycleAction, FormLifecycleActionItem> = {
  archive: {
    action: 'archive',
    endpoint: 'archiveForm',
    icon: 'i-solar-archive-bold-duotone',
    label: '归档',
  },
  close: {
    action: 'close',
    endpoint: 'closeForm',
    icon: 'i-solar-lock-keyhole-bold-duotone',
    label: '关闭',
  },
  reopen: {
    action: 'reopen',
    endpoint: 'reopenForm',
    icon: 'i-solar-play-circle-bold-duotone',
    label: '重新开放',
  },
  restore: {
    action: 'restore',
    endpoint: 'unarchiveForm',
    icon: 'i-solar-restart-bold-duotone',
    label: '恢复',
  },
};

export function formLifecycleActions(status: FormStatus): FormLifecycleActionItem[] {
  if (status === 'active') return [actions.close, actions.archive];
  if (status === 'closed') return [actions.reopen, actions.archive];
  return [actions.restore];
}

export function buildFormLifecycleMutation(
  form: Pick<FormSummary, 'id' | 'revision' | 'status'>,
  actionName: FormLifecycleAction,
): { endpoint: FormLifecycleActionItem['endpoint']; payload: ChangeFormStatusRequest } {
  const action = formLifecycleActions(form.status)
    .find((candidate) => candidate.action === actionName);
  if (!action) throw new TypeError(`Invalid ${form.status} lifecycle action: ${actionName}`);
  return {
    endpoint: action.endpoint,
    payload: { formId: form.id, expectedRevision: form.revision },
  };
}

export function mergeFormLifecycleSummary<T extends object>(
  current: T,
  updated: FormSummary,
): T & FormSummary {
  return { ...current, ...updated };
}

export function formStatusPresentation(status: FormStatus): {
  color: 'error' | 'neutral' | 'success';
  label: string;
} {
  if (status === 'active') return { color: 'success', label: '开放中' };
  if (status === 'closed') return { color: 'error', label: '已关闭' };
  return { color: 'neutral', label: '已归档' };
}

export function canSubmitPublishedForm(
  form: Pick<PublishedFormDefinition, 'acceptingSubmissions'> | null | undefined,
): boolean {
  return form?.acceptingSubmissions === true;
}
