# Form JSON Schema 开发指南

本文说明本平台 Form 定义所使用的 JSON Schema 约定：根结构、标准关键字落点、`x-form` 扩展、条件可用表达式 `availableIf`、校验链路与共享工具。内容以当前分支实现为准。

类型定义见 `packages/types/src/forms.ts`。扩展校验与读路径 helper 见 `packages/utils/src/form-schema.ts` 与 `packages/utils/src/visible-if.ts`。服务端完整校验见 `app/backend/src/forms/form-definition-validator.service.ts`。

## 设计约定

Form Schema 复用 JSON Schema 的约束能力（`type`、`format`、`minLength`、`oneOf`、`required`、`default` 等），并在 `x-form` 命名空间中承载平台语义（字段映射、多语言、条件可用、关联选项、设备采集）。

平台约定如下：

| 约定 | 说明 |
| --- | --- |
| 不要求 `$schema` | Form 文档**不必**声明 `https://json-schema.org/draft/2020-12/schema`。服务端用 `Ajv2020` 按 Draft 2020-12 **方言**编译校验，不以 `$schema` 字段作为契约。 |
| `properties` 即顺序源 | 字段展示顺序以 `properties` 对象的键序为准。编辑器与渲染层应按 `Object.keys(properties)` / 对象枚举顺序遍历。平台不提供单独的 `layout` 扩展。 |
| 约束与选项在标准位置 | 长度、格式、枚举、默认值、必填等放在标准 JSON Schema 关键字中，不塞进 `x-form`。 |
| 平台语义只在 `x-form` | Dataset 映射、i18n、widget、`availableIf` 与采集配置只允许出现在受控的 `x-form` 键中。`x-` 表示 JSON Schema 自定义扩展；`form` 标明这是 Form 元数据，而非标准校验关键字。 |

JSON Schema 规范本身不保证 `properties` 有序；本平台在契约层明确采用对象键序作为展示顺序。持久化与传输时必须保留键序（例如不要对 `properties` 做无序 map 重排）。

历史上条件字段名为 `visibleIf`。当前契约统一为 **`availableIf`**（字段是否可用/是否展示）。旧名已废弃，校验器只接受 `availableIf`。

## 根文档结构

Form Schema 根对象必须满足：

1. `type` 为 `"object"`。
2. `additionalProperties` 为 `false`（拒绝未声明字段）。
3. `properties` 为对象，键为 Form item ID；**键序即展示顺序**。
4. 存在根级 `x-form`（见下文）。
5. 可选：`title`、`description`、`required`。

不要依赖 `$schema`。本地预览可省略部分根扩展，但创建/更新草稿与发布时必须通过服务端完整校验。

```json
{
  "title": "成员资料",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "q_11111111-1111-4111-8111-111111111111": { "...": "见 Form item" },
    "q_22222222-2222-4222-8222-222222222222": { "...": "第二个字段" }
  },
  "required": ["q_11111111-1111-4111-8111-111111111111"],
  "x-form": {
    "version": 1,
    "datasetId": "ds_...",
    "i18n": { "title": { "zh-CN": "成员资料" } },
    "capture": {}
  }
}
```

调整字段顺序时，应重排 `properties` 中的键，而不是引入额外布局结构。

## Form item ID

每个 `properties` 键必须是稳定的不透明 ID，格式为：

```text
q_<UUID v4>
```

使用 `@weave/utils` 的 `createFormItemId()` 生成。ID 一经发布应保持稳定，供 `availableIf`、关联筛选 `valueFrom` 与提交答案键名引用。

## Form item：标准 JSON Schema 落点

每个 property 是一个 JSON Schema 对象，并**必须**包含 `x-form`。

推荐把下列信息放在标准关键字中：

| 需求 | 关键字 |
| --- | --- |
| 值类型 | `type`（如 `string`、`array`、`number`、`boolean`） |
| 字符串约束 | `minLength`、`maxLength`、`format`、`pattern` |
| 数值约束 | `minimum`、`maximum` 等 |
| 单选/多选选项 | `oneOf` + 子项 `const`；`type: "array"` 与 `items`；单选再加 `maxItems: 1` |
| 默认值 | `default` |
| 必填 | 根级 `required` 数组（不要依赖 property 内的 required 语义替代根级列表） |

选项文案挂在每个 `oneOf` 分支的 `x-form.i18n` 上，例如：

```json
{
  "type": "array",
  "items": { "type": "string" },
  "maxItems": 1,
  "oneOf": [
    {
      "const": "engineering",
      "x-form": {
        "i18n": { "title": { "zh-CN": "产品研发部" } }
      }
    }
  ],
  "x-form": {
    "datasetFieldId": "fld_dept",
    "i18n": { "title": { "zh-CN": "所属部门" } },
    "ui": { "widget": "radio" }
  }
}
```

`getChoiceOptions(property, locale)` 会从 `oneOf[].const` 与选项 `i18n.title` 投影出 `{ label, value }` 列表。

## 根扩展 `x-form`

根扩展只允许下列键：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | `1` | 扩展协议版本，当前固定为 `1`。 |
| `datasetId` | string | 绑定的 Dataset ID，必须与 Form 所属 Dataset 一致。 |
| `capture` | object | 设备信息采集；可为空对象。 |
| `i18n` | object（可选） | 表单级 `title` / `description` / `placeholder` 多语言文案；编辑器会同步表单标题至 `i18n.title`。 |

根扩展**不包含** `layout`。未知键（含历史 `layout`）会被 `validateFormSchemaExtensions` 拒绝。

### `capture`

仅允许以下键：`browser`、`operatingSystem`、`userAgent`。每个已声明键必须提供非空 `datasetFieldId`，且服务端会校验其指向对应系统托管字段（`device_browser`、`device_operating_system`、`device_user_agent`）。

## Form item 扩展 `x-form`

Item 扩展允许的键：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `datasetFieldId` | 是 | 映射到 Dataset 字段；同一 Schema 内一对一，不可映射系统托管可写字段。 |
| `i18n` | 否 | `title` / `description` / `placeholder` 的多语言 map。 |
| `ui` | 否 | `widget`（必填若存在 `ui`）与可选 `options`。 |
| `availableIf` | 否 | 条件可用表达式；缺省表示始终可用。 |

### `i18n` 与 locale

多语言 map 的 key 为 BCP 47 locale（如 `zh-CN`、`en`），value 为字符串，且 map 不能为空。

`resolveLocalizedText(map, locale, defaultLocale)` 的解析顺序：当前 locale → Form 的
`defaultLocale` → 第一条非空字符串。编辑器把 `defaultLocale` 作为稳定的第一语言；切换语言只
改变当前编辑语言，不会重排或修改默认语言。

新增语言使用 BCP 47 标识（例如 `en`、`en-US`），经
`Intl.getCanonicalLocales` 规范化后写入表单标题 map。字段和选项翻译在用户实际编辑时惰性写入
当前语言 key；缺失翻译仅在渲染时回退，不会覆盖其他语言。

### `ui`

| 字段 | 说明 |
| --- | --- |
| `widget` | 渲染组件提示（如 `input`、`textarea`、`radio`、`checkbox`、`selector`、`tags-input`）。 |
| `options.labelFieldId` | 关联字段选项的展示标签字段。 |
| `options.filter` | 关联选项筛选（见下节）。 |

前端组件映射见 `app/frontend/components/form/component-map.ts`。`widget` 只影响展示；值的 JSON `type` 跟随所绑 Dataset 列的存储类型，不跟随 `widget` 或列的 `kind`。绑定矩阵见 [`dataset-form-field-types.md`](dataset-form-field-types.md)。值校验仍以标准 JSON Schema 为准。

## `availableIf` 条件表达式

`availableIf` 描述「当前表单 state 下该 item 是否可用」。解析入口为 `parseAvailableIf`，求值为 `evaluateAvailableIf`；渲染层可通过 `isItemVisible(extension, state)` 使用同一语义。

### 表达式形态

| 形态 | 结构 | 语义 |
| --- | --- | --- |
| 比较 | `{ fieldId, operator, value }` | `equals` / `not_equals` / `contains` |
| 成员 | `{ fieldId, operator, values }` | `in` / `not_in` |
| 空值 | `{ fieldId, operator }` | `is_empty` / `is_not_empty` |
| 组合 | `{ operator: "and" \| "or", conditions }` | 非空子表达式数组 |
| 取反 | `{ operator: "not", condition }` | 对子表达式取反 |

叶子操作符集合：`equals`、`not_equals`、`in`、`not_in`、`contains`、`is_empty`、`is_not_empty`。

解析器拒绝未知属性、未知操作符、空条件组、空 `fieldId` 和非 JSON 值。`validateFormSchemaExtensions` 还会检查表达式引用的 `fieldId` 必须存在于当前 Schema。

### 求值语义

- 比较使用规范 JSON 相等（与 `canonicalizeJson` 一致，对象键序不影响结果）。
- `contains`：字符串做子串匹配；数组做元素级 JSON 相等匹配。
- 空值：`undefined`、`null`、`""`、`[]` 视为空。
- 字段缺失时，除 `is_empty` / `is_not_empty` 外，叶子判断返回 `false`（含 `not_equals`、`not_in`），避免初始化阶段误显示依赖项。

```json
{
  "availableIf": {
    "operator": "and",
    "conditions": [
      {
        "fieldId": "q_33333333-3333-4333-8333-333333333333",
        "operator": "equals",
        "value": "engineering"
      },
      {
        "fieldId": "q_11111111-1111-4111-8111-111111111111",
        "operator": "is_not_empty"
      }
    ]
  }
}
```

## 关联字段筛选

当 Dataset 字段为 `relation` 时，item 的 `ui.options` 通常需要：

- `labelFieldId`：目标 Dataset 上可公开投影的标签字段。
- 可选 `filter`：`{ all: [...] }` 或 `{ any: [...] }`，二者只能有一个，且条件数组非空。

单个筛选条件：

| 字段 | 说明 |
| --- | --- |
| `fieldId` | 目标 Dataset 字段 ID。 |
| `operator` | `equals`、`not_equals`、`in`、`contains`、`is_empty`、`is_not_empty`。 |
| `value` | 固定 JSON 值（与 `valueFrom` 互斥）。 |
| `valueFrom` | 引用当前 Form 另一 item 的值，用于级联筛选（与 `value` 互斥）。 |

服务端还会校验：关联目标不能是 `members` / `join_requests` 等不安全 Dataset；`labelFieldId` 与 filter 字段必须属于目标 Dataset、未归档、非系统托管。

公开填写页只会为带 `options.labelFieldId` 的 relation item 请求动态选项。请求使用
`GET /forms/getRelationOptions/:formId/:itemId`，其中 `formId` 是全局唯一的 `Form.id`；`values`
query 是当前 `valueFrom` 依赖答案的 JSON 对象，`take` 范围为 1–100。响应只包含目标行的不透明
ID 与字符串标签。前端仅监听 `getRelationFilterDependencies(filter)` 返回的依赖，忽略过期响应并
清除不再存在的选项。

## 公开填写与提交

`/form/:id` 中的 `id` 是 `Form.id`，不是 slug。页面通过以下 API 复用当前已发布 Schema：

| API | 认证 | 说明 |
| --- | --- | --- |
| `GET /forms/getPublishedForm/:formId` | 可选 Bearer | 返回最小 published 定义、开放状态及可选主体行上下文；不返回 draft、编辑锁、checksum 或管理 revision。 |
| `GET /forms/getRelationOptions/:formId/:itemId` | 公开 | 按 published relation 配置返回安全选项。 |
| `POST /forms/submitForm` | 可选 Bearer | 提交 `{ formId, answers, expectedRevision? }`，支持最长 128 字符的 `Idempotency-Key`。 |

“可选 Bearer”表示不携带 header 时按匿名处理，携带 header 时必须完成完整 Session 校验；坏 token
不会降级为匿名。`authentication_required` 和 `update_subject_row` 表单仍要求有效 actor。

客户端先用 Ajv Draft 2020-12 校验当前可用答案，并把可定位错误映射到 item。服务端随后重新校验
published/open 状态、`availableIf`、JSON Schema、Dataset 映射、relation 目标、特殊 Dataset 规则与
CAS revision。客户端用 `filterVisibleAnswers` 排除隐藏值；服务端用
`findUnavailableSubmittedItemIds` 拒绝主动注入的隐藏答案。

`update_subject_row` 的预填值与 `expectedRevision` 只通过当前 actor 的 `DatasetRowSubject` 解析，
客户端不能选择 row ID。成功响应仅包含 `submissionId`、`operation` 和 `submittedAt`；Dataset 行 ID
不会暴露。相同幂等 key 与相同答案/版本返回已提交结果，key 复用于不同 payload 时返回冲突。

## 校验链路

写入 Form 定义时，服务端按下列顺序校验：

1. **根约束**：`type === "object"` 且 `additionalProperties === false`。
2. **AJV Draft 2020-12 方言编译**：注册 `x-form` 关键字为透传对象，避免未知关键字报错。
3. **平台扩展校验**：`validateFormSchemaExtensions(schema)`（item ID、`x-form` 结构、`availableIf`、capture、选项 i18n）。
4. **业务校验**：Dataset 绑定、字段一对一映射、系统字段不可写、关联安全策略、特殊 Dataset 的登录/写入模式约束、capture 系统字段、`create_row` 下必填字段覆盖等。

提交答案时，服务端再次用 AJV 按已发布 Schema 校验 payload，并完成可用性检查、规范化、Redis
限频、幂等与事务写入。已成功提交的幂等重试会在消耗新写入限额之前恢复结果。

## 面板编辑与源码保存

`/panel/form/:id` 将 `draft ?? release` 克隆为当前编辑会话唯一的 Schema/元数据状态。Palette、
画布、Settings 和 Header 保存都修改或提交这一份状态，不存在另一份客户端 Form document。

Header 的「源码」在 Nuxt UI Modal 中按需加载 Monaco。源码先经过 JSON 解析、根约束和共享
`x-form` 校验，再通过 `saveFormDraft` 把完整 Schema 与版本元数据发送至后端；AJV、Dataset
映射和业务校验仍以后端为准。解析、校验、revision 或编辑锁冲突都会保留 Modal 和源码文本，
成功后才刷新本地 revision/checksum 并关闭。

编辑页进入时通过 Redis 获取 90 秒独占锁，每 30 秒续租；保存与发布还必须同时携带匹配的锁
token 和 `expectedRevision`。锁丢失后页面保留未保存内容但禁用所有 mutation，避免静默覆盖。

共享包职责边界：

| 层级 | 职责 |
| --- | --- |
| `@weave/types` | 类型与常量契约 |
| `@weave/utils` | 扩展结构校验、条件解析/求值、软读 helper |
| `FormDefinitionValidatorService` | AJV + 扩展校验 + Dataset/权限类业务不变量 |

`validateFormSchemaExtensions` 不能替代 AJV。外部输入应先标准 Schema 编译，再跑平台扩展校验。

## 读路径 helper

下列方法用于渲染与映射，结构不符时返回 `null` 或空集合，不抛异常：

| 方法 | 作用 |
| --- | --- |
| `getRootExtension` / `getItemExtension` | 软读取 `x-form` |
| `getSchemaProperties` / `getRequiredItemIds` | 读取 properties（保留键序）与 required |
| `resolveLocalizedText` | 解析多语言文案 |
| `getChoiceOptions` | 从 `oneOf` 投影选项 |
| `createInitialFormState` | 按 `default` 初始化 state |
| `isItemVisible` | 基于 `availableIf` 判断是否可用 |
| `filterVisibleAnswers` / `findUnavailableSubmittedItemIds` | 过滤当前可用答案 / 识别隐藏字段注入 |
| `getRelationFilterDependencies` | 提取 relation filter 的 `valueFrom` item |
| `parseAvailableIf` / `evaluateAvailableIf` | 严格解析与求值（非法结构抛 `TypeError`） |

渲染层应直接按 `getSchemaProperties(schema)` 返回对象的键序渲染字段。

## 最小完整示例

```json
{
  "title": "加入申请",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "q_11111111-1111-4111-8111-111111111111": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "default": "",
      "x-form": {
        "datasetFieldId": "fld_name",
        "i18n": {
          "title": { "zh-CN": "姓名" },
          "placeholder": { "zh-CN": "输入姓名" }
        },
        "ui": { "widget": "input" }
      }
    },
    "q_22222222-2222-4222-8222-222222222222": {
      "type": "string",
      "format": "email",
      "x-form": {
        "datasetFieldId": "fld_email",
        "i18n": { "title": { "zh-CN": "邮箱" } },
        "ui": { "widget": "input" }
      }
    },
    "q_33333333-3333-4333-8333-333333333333": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 1,
      "oneOf": [
        {
          "const": "engineering",
          "x-form": { "i18n": { "title": { "zh-CN": "产品研发部" } } }
        },
        {
          "const": "design",
          "x-form": { "i18n": { "title": { "zh-CN": "设计与体验部" } } }
        }
      ],
      "x-form": {
        "datasetFieldId": "fld_dept",
        "i18n": { "title": { "zh-CN": "所属部门" } },
        "ui": { "widget": "radio" }
      }
    },
    "q_66666666-6666-4666-8666-666666666666": {
      "type": "string",
      "oneOf": [
        { "const": "email", "x-form": { "i18n": { "title": { "zh-CN": "邮件" } } } },
        { "const": "sms", "x-form": { "i18n": { "title": { "zh-CN": "短信" } } } }
      ],
      "x-form": {
        "datasetFieldId": "fld_notify",
        "i18n": { "title": { "zh-CN": "通知偏好" } },
        "ui": { "widget": "selector" },
        "availableIf": {
          "fieldId": "q_33333333-3333-4333-8333-333333333333",
          "operator": "equals",
          "value": "engineering"
        }
      }
    }
  },
  "required": [
    "q_11111111-1111-4111-8111-111111111111",
    "q_22222222-2222-4222-8222-222222222222",
    "q_33333333-3333-4333-8333-333333333333"
  ],
  "x-form": {
    "version": 1,
    "datasetId": "ds_example",
    "capture": {}
  }
}
```

上例中字段顺序为：姓名 → 邮箱 → 所属部门 → 通知偏好。

## 开发检查清单

- [ ] 字段顺序写在 `properties` 键序中；未使用 `layout`。
- [ ] 持久化 / 传输时保留 `properties` 键序。
- [ ] 未要求或依赖根级 `$schema`。
- [ ] Form item ID 由 `createFormItemId()` 生成，格式为 `q_` + UUID v4。
- [ ] 约束、选项、默认值、必填使用标准 JSON Schema 关键字。
- [ ] 每个 property 与根节点都有合法 `x-form`；扩展中无未知键。
- [ ] 条件字段使用 `availableIf`（不是 `visibleIf`），且引用的 item 存在。
- [ ] 关联字段配置了安全的 `labelFieldId` / `filter`。
- [ ] 本地用 AJV + `validateFormSchemaExtensions` 自检；发布路径走 `FormDefinitionValidatorService`。

## 相关代码

| 路径 | 内容 |
| --- | --- |
| `packages/types/src/forms.ts` | Form / `availableIf` / `x-form` 类型 |
| `packages/utils/src/form-schema.ts` | 扩展校验与读路径 helper |
| `packages/utils/src/visible-if.ts` | `parseAvailableIf` / `evaluateAvailableIf` |
| `app/backend/src/forms/form-definition-validator.service.ts` | 服务端完整校验 |
| `app/frontend/components/form/` | 渲染层组件 |
| `app/frontend/pages/form-field-preview.vue` | Schema 驱动预览页 |
| `app/backend/test/form-schema-utils.spec.ts` | 共享工具回归测试 |
