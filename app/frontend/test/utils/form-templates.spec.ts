import { describe, expect, it } from 'vitest';

import { getFormItemTemplate } from '~/utils/form-templates/registry';

describe('email form item template', () => {
  it('keeps email settings and format without inheriting from input', () => {
    const email = getFormItemTemplate('email');
    const input = getFormItemTemplate('input');

    expect(email.widget).toBe('email');
    expect(email.label).toBe('邮箱');
    expect(email.compatibleDataTypes).toEqual(['string']);
    expect(email.settings).toEqual({
      availableIf: true,
      default: true,
      fromAuthenticatedEmail: true,
      numeric: false,
      placeholder: true,
      string: true,
    });
    expect(email.placeholderDefault).toBe('请输入邮箱');
    expect(input.settings.numeric).toBe(true);
    expect(input.settings.fromAuthenticatedEmail).toBeUndefined();

    const property = email.createProperty({
      datasetFieldId: 'field-email',
      locale: 'zh-CN',
      position: 0,
      title: '邮箱',
    });
    expect(property.format).toBe('email');
    expect(property['x-form']).toMatchObject({
      ui: { widget: 'email' },
      i18n: { placeholder: { 'zh-CN': '请输入邮箱' } },
    });
  });
});
