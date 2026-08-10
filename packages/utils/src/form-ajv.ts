import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/** Create the AJV instance used for platform Form Schemas. */
export function createFormAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    useDefaults: false,
  });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'x-form', schemaType: 'object', valid: true });
  return ajv;
}
