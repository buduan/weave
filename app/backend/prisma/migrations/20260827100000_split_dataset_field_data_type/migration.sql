-- Split DatasetField storage (dataType) from display (kind).
-- Unknown/dirty kinds fall back to dataType=string and kind=text so deploy cannot fail.

CREATE TYPE "DatasetFieldDataType" AS ENUM (
  'string',
  'number',
  'boolean',
  'string_array',
  'json',
  'relation'
);

CREATE TYPE "DatasetFieldKind_new" AS ENUM (
  'text',
  'long_text',
  'number',
  'percent',
  'currency',
  'checkbox',
  'date',
  'time',
  'datetime',
  'email',
  'url',
  'single_select',
  'multi_select',
  'cascader',
  'tags',
  'json',
  'relation'
);

CREATE FUNCTION weave_map_field_data_type(old_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_kind
    WHEN 'number' THEN 'number'
    WHEN 'boolean' THEN 'boolean'
    WHEN 'single_select' THEN 'string_array'
    WHEN 'multi_select' THEN 'string_array'
    WHEN 'json' THEN 'json'
    WHEN 'relation' THEN 'relation'
    ELSE 'string'
  END;
$$;

CREATE FUNCTION weave_map_field_kind(old_kind text, config jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN old_kind = 'boolean' THEN 'checkbox'
    WHEN old_kind = 'multi_select'
      AND COALESCE(config->>'optionMode', 'flat') = 'cascader' THEN 'cascader'
    WHEN old_kind = 'multi_select' AND NOT (config ? 'options') THEN 'tags'
    WHEN old_kind IN (
      'text',
      'long_text',
      'number',
      'date',
      'time',
      'datetime',
      'email',
      'url',
      'single_select',
      'multi_select',
      'json',
      'relation'
    ) THEN old_kind
    ELSE 'text'
  END;
$$;

CREATE FUNCTION weave_wrap_single_select_object(vals jsonb, field_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  key text;
  val jsonb;
  text_val text;
BEGIN
  IF vals IS NULL OR jsonb_typeof(vals) <> 'object' THEN
    RETURN COALESCE(vals, '{}'::jsonb);
  END IF;
  FOR key, val IN SELECT * FROM jsonb_each(vals)
  LOOP
    IF key = ANY(field_ids) THEN
      IF val IS NULL OR val = 'null'::jsonb THEN
        result := result || jsonb_build_object(key, '[]'::jsonb);
      ELSIF jsonb_typeof(val) = 'string' THEN
        text_val := val #>> '{}';
        IF text_val = '' THEN
          result := result || jsonb_build_object(key, '[]'::jsonb);
        ELSE
          result := result || jsonb_build_object(key, jsonb_build_array(val));
        END IF;
      ELSE
        result := result || jsonb_build_object(key, val);
      END IF;
    ELSE
      result := result || jsonb_build_object(key, val);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

ALTER TABLE "DatasetField" ADD COLUMN "dataType" "DatasetFieldDataType";

UPDATE "DatasetField"
SET "dataType" = weave_map_field_data_type("kind"::text)::"DatasetFieldDataType";

ALTER TABLE "DatasetField" ALTER COLUMN "dataType" SET NOT NULL;

ALTER TABLE "DatasetField" ADD COLUMN "kind_new" "DatasetFieldKind_new";

UPDATE "DatasetField"
SET "kind_new" = weave_map_field_kind("kind"::text, COALESCE("config", '{}'::jsonb))::"DatasetFieldKind_new";

ALTER TABLE "DatasetField" DROP COLUMN "kind";
ALTER TABLE "DatasetField" RENAME COLUMN "kind_new" TO "kind";

DROP TYPE "DatasetFieldKind";
ALTER TYPE "DatasetFieldKind_new" RENAME TO "DatasetFieldKind";

UPDATE "DatasetField"
SET "valueSchema" = jsonb_build_object(
  'type', 'array',
  'items', jsonb_build_object('type', 'string'),
  'maxItems', 1
)
WHERE "kind" = 'single_select';

DO $$
DECLARE
  single_ids text[];
BEGIN
  SELECT COALESCE(array_agg(id), ARRAY[]::text[])
  INTO single_ids
  FROM "DatasetField"
  WHERE "kind" = 'single_select';

  IF cardinality(single_ids) = 0 THEN
    RETURN;
  END IF;

  UPDATE "DatasetRow"
  SET "values" = weave_wrap_single_select_object("values", single_ids);

  UPDATE "DatasetRowVersion"
  SET "valuesSnapshot" = weave_wrap_single_select_object("valuesSnapshot", single_ids);
END $$;

UPDATE "DatasetVersion" dv
SET "fieldsSnapshot" = COALESCE((
  SELECT jsonb_agg(mapped.elem ORDER BY mapped.ordinality)
  FROM (
    SELECT
      ordinality,
      CASE
        WHEN jsonb_typeof(elem) <> 'object' THEN elem
        ELSE elem
          || jsonb_build_object(
            'dataType', weave_map_field_data_type(elem->>'kind'),
            'kind', weave_map_field_kind(
              elem->>'kind',
              COALESCE(elem->'config', '{}'::jsonb)
            )
          )
          || CASE
            WHEN weave_map_field_kind(
              elem->>'kind',
              COALESCE(elem->'config', '{}'::jsonb)
            ) = 'single_select' THEN jsonb_build_object(
              'valueSchema',
              jsonb_build_object(
                'type', 'array',
                'items', jsonb_build_object('type', 'string'),
                'maxItems', 1
              )
            )
            ELSE '{}'::jsonb
          END
      END AS elem
    FROM jsonb_array_elements(dv."fieldsSnapshot") WITH ORDINALITY AS t(elem, ordinality)
  ) AS mapped
), '[]'::jsonb)
WHERE jsonb_typeof(dv."fieldsSnapshot") = 'array';

DO $$
DECLARE
  rec record;
  props jsonb;
  key text;
  prop jsonb;
  field_id text;
  new_schema jsonb;
  changed boolean;
  default_val jsonb;
BEGIN
  FOR rec IN SELECT id, schema FROM "FormVersion"
  LOOP
    props := rec.schema -> 'properties';
    IF props IS NULL OR jsonb_typeof(props) <> 'object' THEN
      CONTINUE;
    END IF;
    new_schema := rec.schema;
    changed := false;
    FOR key, prop IN SELECT * FROM jsonb_each(props)
    LOOP
      field_id := prop #>> '{x-form,datasetFieldId}';
      IF field_id IS NULL THEN
        CONTINUE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM "DatasetField" df
        WHERE df.id = field_id AND df."dataType" = 'string_array'
      ) AND (prop->>'type') = 'string' THEN
        default_val := prop->'default';
        prop := (prop - 'type' - 'format' - 'minLength' - 'maxLength' - 'pattern' - 'enum')
          || jsonb_build_object(
            'type', 'array',
            'items', jsonb_build_object('type', 'string')
          );
        IF prop #>> '{x-form,ui,widget}' = 'radio' THEN
          prop := prop || jsonb_build_object('maxItems', 1);
        END IF;
        IF default_val IS NOT NULL AND jsonb_typeof(default_val) = 'string' THEN
          IF (default_val #>> '{}') = '' THEN
            prop := jsonb_set(prop, '{default}', '[]'::jsonb);
          ELSE
            prop := jsonb_set(prop, '{default}', jsonb_build_array(default_val));
          END IF;
        END IF;
        new_schema := jsonb_set(new_schema, ARRAY['properties', key], prop);
        changed := true;
      END IF;
    END LOOP;
    IF changed THEN
      UPDATE "FormVersion" SET schema = new_schema WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION weave_wrap_single_select_object(jsonb, text[]);
DROP FUNCTION weave_map_field_kind(text, jsonb);
DROP FUNCTION weave_map_field_data_type(text);
