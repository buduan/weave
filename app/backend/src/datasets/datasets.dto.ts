/* eslint-disable max-classes-per-file -- Nest DTOs are colocated by the Dataset HTTP boundary. */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DatasetFieldKind,
  DatasetSubjectMode,
  DatasetType,
  RelationCardinality,
} from '@prisma/client';

const FILTER_OPERATORS = [
  'contains',
  'equals',
  'not_equals',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_empty',
  'is_not_empty',
  'contains_any',
  'contains_all',
  'not_contains',
] as const;

const AGGREGATE_OPERATIONS = ['sum', 'avg', 'min', 'max', 'count_non_empty'] as const;

function normalizeQueryArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

export class CreateDatasetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(64)
  public slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public description?: string;

  @IsIn([DatasetType.standard, DatasetType.join_requests])
  public type!: Extract<DatasetType, 'join_requests' | 'standard'>;

  @IsOptional()
  @IsEnum(DatasetSubjectMode)
  public subjectMode: DatasetSubjectMode = DatasetSubjectMode.none;
}

export class UpdateDatasetDto {
  @IsInt()
  @Min(1)
  public expectedRevision!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(64)
  public slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public description?: string;
}

export class DatasetRevisionDto {
  @IsInt()
  @Min(1)
  public expectedRevision!: number;
}

export class CreateDatasetFieldDto {
  @IsInt()
  @Min(1)
  public expectedDatasetRevision!: number;

  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(64)
  public key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public description?: string;

  @IsEnum(DatasetFieldKind)
  public kind!: DatasetFieldKind;

  @IsOptional()
  public valueSchema?: unknown;

  @IsOptional()
  @IsObject()
  public config: Record<string, unknown> = {};

  @IsOptional()
  @IsBoolean()
  public required = false;

  @IsOptional()
  @IsString()
  public relationTargetDatasetId?: string;

  @IsOptional()
  @IsEnum(RelationCardinality)
  public relationCardinality?: RelationCardinality;

  @IsOptional()
  @IsInt()
  @Min(0)
  public position?: number;
}

/** Form 编辑器旧 action 路由的兼容请求；revision 由 Controller 读取当前详情后补入。 */
export class CreateDatasetPanelFieldDto {
  @IsString()
  @MinLength(1)
  public datasetId!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(64)
  public key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public description?: string;

  @IsEnum(DatasetFieldKind)
  public kind!: DatasetFieldKind;

  @IsOptional()
  public valueSchema?: unknown;

  @IsObject()
  public config!: Record<string, unknown>;

  @IsBoolean()
  public required!: boolean;

  @IsOptional()
  @IsString()
  public relationTargetDatasetId?: string;

  @IsOptional()
  @IsEnum(RelationCardinality)
  public relationCardinality?: RelationCardinality;

  @IsOptional()
  @IsInt()
  @Min(0)
  public position?: number;
}

export class UpdateDatasetFieldDto {
  @IsInt()
  @Min(1)
  public expectedDatasetRevision!: number;

  @IsInt()
  @Min(1)
  public expectedFieldRevision!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public description?: string;

  @IsOptional()
  @IsEnum(DatasetFieldKind)
  public kind?: DatasetFieldKind;

  @IsOptional()
  @IsDefined()
  public valueSchema?: unknown;

  @IsOptional()
  @IsObject()
  public config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  public required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  public position?: number;
}

export class ArchiveDatasetFieldDto {
  @IsInt()
  @Min(1)
  public expectedDatasetRevision!: number;

  @IsInt()
  @Min(1)
  public expectedFieldRevision!: number;
}

export class DatasetRowValuesDto {
  @IsOptional()
  @IsObject()
  public values: Record<string, unknown> = {};

  @IsOptional()
  @IsObject()
  public relations: Record<string, unknown> = {};
}

export class UpdateDatasetRowDto extends DatasetRowValuesDto {
  @IsInt()
  @Min(1)
  public expectedRevision!: number;
}

export class DatasetFilterRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  public id!: string;

  @IsString()
  @MinLength(1)
  public fieldId!: string;

  @IsIn(FILTER_OPERATORS)
  public operator!: (typeof FILTER_OPERATORS)[number];

  @IsOptional()
  public value?: unknown;
}

export class DatasetSortRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  public id!: string;

  @IsString()
  @MinLength(1)
  public fieldId!: string;

  @IsIn(['asc', 'desc'])
  public direction!: 'asc' | 'desc';
}

export class DatasetAggregateRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  public id!: string;

  @IsString()
  @MinLength(1)
  public fieldId!: string;

  @IsIn(AGGREGATE_OPERATIONS)
  public operation!: (typeof AGGREGATE_OPERATIONS)[number];
}

export class DatasetGroupRuleDto {
  @IsString()
  @MinLength(1)
  public fieldId!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DatasetAggregateRuleDto)
  public aggregates: DatasetAggregateRuleDto[] = [];
}

export class DatasetTableQueryDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DatasetFilterRuleDto)
  public filters: DatasetFilterRuleDto[] = [];

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DatasetSortRuleDto)
  public sorts: DatasetSortRuleDto[] = [];

  @IsOptional()
  @ValidateNested()
  @Type(() => DatasetGroupRuleDto)
  public group: DatasetGroupRuleDto | null = null;
}

export class DatasetWindowDto {
  @IsInt()
  @Min(0)
  public offset!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  public limit!: number;
}

export class DatasetWindowQueryDto {
  @ValidateNested()
  @Type(() => DatasetTableQueryDto)
  public query!: DatasetTableQueryDto;

  @ValidateNested()
  @Type(() => DatasetWindowDto)
  public window!: DatasetWindowDto;

  @IsOptional()
  @IsBoolean()
  public includeGroupDirectory?: boolean;
}

export class DatasetRelationOptionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  public search?: string;

  @IsOptional()
  @IsString()
  public cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public limit = 50;

  @IsOptional()
  @Transform(({ value }) => normalizeQueryArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  public selectedIds: string[] = [];
}
