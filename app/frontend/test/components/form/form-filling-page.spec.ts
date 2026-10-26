import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('public Form filling page', () => {
  it('keeps page metadata and surface layout outside FormFilling', () => {
    const page = source('../../../pages/form/[id].vue');
    const filling = source('../../../components/form/FormFilling.vue');

    expect(page).toContain('{{ pageTitle }}');
    expect(page).toContain('{{ pageDescription }}');
    expect(page).toContain('<FormFilling');
    expect(filling).not.toContain('nameI18n');
    expect(filling).not.toContain('descriptionI18n');
    expect(filling).not.toContain('<article');
    expect(filling).toContain(':disabled="submitDisabled || pending"');
  });

  it('embeds account access and represents the authenticated identity state', () => {
    const page = source('../../../pages/form/[id].vue');
    const authentication = source('../../../components/form/FormAuthentication.vue');

    expect(page).toContain('<FormAuthentication');
    expect(page).toContain('将会以');
    expect(page).toContain('更换账号');
    expect(page).toContain(':submit-disabled="needsAuthentication"');
    expect(authentication).toContain('<AuthLoginMethodStep');
    expect(authentication).toContain('<AuthRegistrationFlow');
  });
});
