import { BadRequestException, Injectable } from '@nestjs/common';
import type { DatasetField, Prisma } from '@prisma/client';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import type { DatasetChoiceOption, JsonSchema } from '@weave/types';
import {
  isCompleteChoicePath,
  normalizeDatasetChoiceConfig,
  stripChoiceMembershipSchema,
} from '@weave/utils';

interface RowInput {
  relations: Record<string, unknown>;
  values: Record<string, unknown>;
}

export interface ValidatedRowInput {
  relations: Map<string, string[]>;
  values: Prisma.InputJsonObject;
}

/**
 * 基于 AJV Draft 2020-12 的 Dataset 字段 Schema 校验服务。
 * 负责字段值 Schema 的编译验证，以及整行数据的字段级校验。
 */
@Injectable()
export class DatasetSchemaService {
  private readonly ajv: Ajv2020;

  public constructor() {
    this.ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(this.ajv);
  }

  /**
   * 校验并编译字段的 valueSchema。
   * 输入必须是合法的 JSON Schema 对象或布尔值，否则在编译阶段抛出异常。
   */
  public assertFieldSchema(valueSchema: unknown): Prisma.InputJsonValue {
    this.assertJsonValue(valueSchema, 'valueSchema');
    if (typeof valueSchema !== 'boolean'
      && (valueSchema === null || typeof valueSchema !== 'object' || Array.isArray(valueSchema))) {
      throw new BadRequestException('valueSchema must be a JSON Schema object or boolean');
    }
    try {
      this.ajv.compile(valueSchema as object | boolean);
    } catch (error) {
      throw new BadRequestException(`Invalid field valueSchema: ${this.errorMessage(error)}`);
    }
    return valueSchema;
  }

  /**
   * 校验整行输入数据。
   * - 仅接受活跃字段的 ID
   * - 普通值按字段的 valueSchema 逐字段验证
   * - 关联值按字段声明的基数校验
   * - 系统管理字段禁止写入
   * - partial=true 时以现有值为基础进行部分更新
   */
  public validateRow(
    fields: DatasetField[],
    input: RowInput,
    existingValues: Prisma.JsonObject = {},
    partial = false,
  ): ValidatedRowInput {
    const activeFields = new Map(
      fields.filter((field) => !field.archivedAt).map((field) => [field.id, field]),
    );
    // 检查是否包含未知或已归档的字段 ID。
    const submittedIds = [...Object.keys(input.values), ...Object.keys(input.relations)];
    const unknownId = submittedIds.find((fieldId) => !activeFields.has(fieldId));
    if (unknownId) throw new BadRequestException(`Unknown or archived Dataset field: ${unknownId}`);

    // 同一个字段不能同时出现在 values 和 relations 中。
    const duplicateId = Object.keys(input.values).find(
      (fieldId) => Object.hasOwn(input.relations, fieldId),
    );
    if (duplicateId) throw new BadRequestException(`Dataset field supplied twice: ${duplicateId}`);

    // 部分更新时以现有值为基础；全量写入时从空开始。
    const resultingValues: Record<string, Prisma.InputJsonValue> = partial
      ? { ...existingValues } as Record<string, Prisma.InputJsonValue>
      : {};
    const relations = new Map<string, string[]>();

    // ---- 校验普通字段值 ----
    Object.entries(input.values).forEach(([fieldId, value]) => {
      const field = activeFields.get(fieldId)!;
      if (field.isSystemManaged) throw new BadRequestException(`System-managed field is not writable: ${fieldId}`);
      if (field.kind === 'relation') {
        throw new BadRequestException(`Relation field must be supplied under relations: ${fieldId}`);
      }
      this.assertJsonValue(value, `values.${fieldId}`);
      const choiceConfig = field.kind === 'single_select' || field.kind === 'multi_select'
        ? this.parseChoiceConfig(field.kind, field.config, fieldId)
        : null;
      const valueSchema = choiceConfig?.hasOptions
        ? stripChoiceMembershipSchema(field.valueSchema as JsonSchema)
        : field.valueSchema;
      const validate = this.ajv.compile(valueSchema as object);
      if (!validate(value)) {
        throw new BadRequestException({
          message: `Invalid value for Dataset field: ${fieldId}`,
          errors: validate.errors,
        });
      }
      if (choiceConfig?.hasOptions) {
        this.validateChoiceValue(
          fieldId,
          field.kind as 'multi_select' | 'single_select',
          choiceConfig.optionMode,
          choiceConfig.options,
          value,
        );
      }
      resultingValues[fieldId] = value;
    });

    // ---- 校验关联字段值 ----
    Object.entries(input.relations).forEach(([fieldId, value]) => {
      const field = activeFields.get(fieldId)!;
      if (field.isSystemManaged) throw new BadRequestException(`System-managed field is not writable: ${fieldId}`);
      if (field.kind !== 'relation' || !field.relationTargetDatasetId || !field.relationCardinality) {
        throw new BadRequestException(`Field is not a configured relation: ${fieldId}`);
      }
      let targets: string[] = [];
      // 一对一：接受单个字符串；一对多：接受字符串数组。
      if (field.relationCardinality === 'one' && typeof value === 'string') targets = [value];
      if (field.relationCardinality === 'many'
        && Array.isArray(value)
        && value.every((item) => typeof item === 'string')) {
        targets = value;
      }
      if ((field.relationCardinality === 'one' && targets.length !== 1)
        || (field.relationCardinality === 'many' && !Array.isArray(value))) {
        throw new BadRequestException(`Invalid relation cardinality for field: ${fieldId}`);
      }
      // 禁止重复的关联目标。
      if (new Set(targets).size !== targets.length) {
        throw new BadRequestException(`Duplicate relation target for field: ${fieldId}`);
      }
      relations.set(fieldId, targets);
    });

    // 全量写入模式下检查必填字段是否缺失。
    if (!partial) {
      const missing = fields.find((field) => !field.archivedAt
        && field.required
        && !field.isSystemManaged
        && (field.kind === 'relation'
          ? !relations.has(field.id)
          : !Object.hasOwn(resultingValues, field.id)));
      if (missing) throw new BadRequestException(`Required Dataset field is missing: ${missing.id}`);
    }

    return { relations, values: resultingValues };
  }

  private parseChoiceConfig(
    kind: 'multi_select' | 'single_select',
    config: Prisma.JsonValue,
    fieldId: string,
  ): ReturnType<typeof normalizeDatasetChoiceConfig> {
    try {
      return normalizeDatasetChoiceConfig(kind, config);
    } catch (error) {
      throw new BadRequestException(
        `Invalid choice config for Dataset field ${fieldId}: ${this.errorMessage(error)}`,
      );
    }
  }

  private validateChoiceValue(
    fieldId: string,
    kind: 'multi_select' | 'single_select',
    optionMode: 'cascader' | 'flat',
    options: readonly DatasetChoiceOption[],
    value: unknown,
  ): void {
    if (options.length === 0) {
      throw new BadRequestException(`Dataset field has no current choices: ${fieldId}`);
    }
    const acceptedValues = new Set(options.map((option) => option.value));
    if (kind === 'single_select') {
      if (typeof value !== 'string' || !acceptedValues.has(value)) {
        throw new BadRequestException(`Unknown choice for Dataset field: ${fieldId}`);
      }
      return;
    }
    if (optionMode === 'cascader') {
      if (!isCompleteChoicePath(options, value)) {
        throw new BadRequestException(`Incomplete or unknown choice path for Dataset field: ${fieldId}`);
      }
      return;
    }
    if (!Array.isArray(value)
      || !value.every((item) => typeof item === 'string' && acceptedValues.has(item))
      || new Set(value).size !== value.length) {
      throw new BadRequestException(`Invalid choices for Dataset field: ${fieldId}`);
    }
  }

  /**
   * 递归断言值可安全存入 JSONB 列（无 undefined、BigInt、Symbol、function、Infinity/NaN）。
   */
  private assertJsonValue(value: unknown, path: string): asserts value is Prisma.InputJsonValue {
    if (value === undefined || typeof value === 'bigint' || typeof value === 'function'
      || typeof value === 'symbol') {
      throw new BadRequestException(`${path} must be a JSON value`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new BadRequestException(`${path} must contain finite numbers`);
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.assertJsonValue(item, `${path}[${index}]`));
    } else if (value !== null && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => this.assertJsonValue(item, `${path}.${key}`));
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
