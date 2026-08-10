import type {
  DatasetFieldDefinition,
  DatasetFieldKind,
  FormWidget,
  JsonSchemaObject,
} from '@weave/types';

export interface FormTemplateSettings {
  array?: boolean;
  availableIf: boolean;
  choices?: boolean;
  default: boolean;
  numeric?: boolean;
  placeholder?: boolean;
  relation?: boolean;
  string?: boolean;
}

export interface FormTemplateCreateContext {
  datasetField?: DatasetFieldDefinition;
  datasetFieldId?: string;
  locale: string;
  position: number;
  title?: string;
}

export interface FormItemTemplate {
  accepts: (field: DatasetFieldDefinition) => boolean;
  compatibleDatasetKinds: readonly DatasetFieldKind[];
  createProperty: (context: FormTemplateCreateContext) => JsonSchemaObject;
  icon: string;
  label: string;
  placeholderDefault?: string;
  settings: FormTemplateSettings;
  widget: FormWidget;
}
