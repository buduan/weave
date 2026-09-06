# 数据表与表单字段类型

本文是 Dataset 列存储、列外显（`kind`）与 Form 控件（`widget`）的绑定契约。三层必须拆开，禁止再用单一枚举同时表示存储、表格展示和表单控件。

实现已按本文拆分：`dataType` 管存储，`kind` 管表格外显，Form `widget` 只按 `dataType` 绑定。历史数据的 deploy 迁移对照见文末。

Form Schema 的 `x-form` 结构见 [`form-schema.md`](form-schema.md)。

## 三层

```text
Dataset 列
  dataType    值怎么存          创建后不可改
  kind        表格怎么展示      同 dataType 内可改

Form Item
  绑定        对着 Dataset 列   兼容只看 dataType
  widget      表单用什么控件    与 kind 无关，可独立改
```

规则：

1. **Dataset `dataType` 只控制存储。** 单元格 JSON 形态、`valueSchema` 基座、过滤/聚合的值形状都由它决定。
2. **Dataset `kind` 只控制外显。** 表格单元格编辑器、选项目录形态、数字格式（百分数/货币）由它决定。
3. **Form `widget` 只控制表单控件。** 绑定是否合法只看目标列的 `dataType`，不看 `kind`。
4. **Form item 的 JSON Schema `type` 跟随 Dataset `dataType`，不跟随 `widget` 或 `kind`。** 例如 Radio 写入 `string[]`（0 或 1 项），不是字符串。

`valueSchema` 由 `dataType` 加上当前 `kind` 的附加约束推导（如单选 `maxItems: 1`），不要让客户端提交一套与存储类型无关的 schema。

## Dataset `dataType`

单元格值都是 JSON。`relation` 例外：值在 `DatasetRelation` 表，不进 `DatasetRow.values`。

| dataType | JSON 形态 | 用途 |
| --- | --- | --- |
| `string` | 字符串 | 文本、日期、邮箱等 |
| `number` | 数字 | 数字、百分数、货币 |
| `boolean` | 布尔 | 复选框 |
| `string[]` | 字符串数组 | 选项、标签、级联路径 |
| `json` | 不约束 | 自由 JSON |
| `relation` | 不在 `values` 里 | 关联行；一对一为单个 ID，一对多为 ID 数组 |

`string[]` 是带 schema 的 JSON 数组，与不约束的 `json` 分开：选项校验、去重、过滤运算符不同。

约束：

- 单选：`string[]`，`maxItems: 1`；空为 `[]`。
- 多选 / 标签：`string[]`，可多项。
- 级联：`string[]`，存一条完整路径（从根到叶）。
- 百分数：存 `0.15` 表示 15%（与常见表格一致，不是 `15`）。
- `dataType` 创建后不可改。改存储类型等于换列。

## Dataset `kind`（外显）

`kind` 是用户建列时选的列类型，也是表格单元格的展示方式。本轮只覆盖现有能力加上百分数 / 货币。不做人员、附件、公式、查找引用。

| kind | 中文 | dataType | 表格单元格 | 选项目录 |
| --- | --- | --- | --- | --- |
| `text` | 文本 | `string` | 单行 | 无 |
| `long_text` | 长文本 | `string` | 多行 | 无 |
| `date` | 日期 | `string` | 日期 | 无 |
| `time` | 时间 | `string` | 时间 | 无 |
| `datetime` | 日期时间 | `string` | 日期时间 | 无 |
| `email` | 邮箱 | `string` | email | 无 |
| `url` | 网址 | `string` | url | 无 |
| `number` | 数字 | `number` | 数字 | 无 |
| `percent` | 百分数 | `number` | 百分数 | 无 |
| `currency` | 货币 | `number` | 货币 + 币种 | 无 |
| `checkbox` | 复选框 | `boolean` | 复选框 | 无 |
| `single_select` | 单选 | `string[]` | 单选下拉 | Dataset `config.options`（扁平） |
| `multi_select` | 多选 | `string[]` | 多选下拉 | Dataset `config.options`（扁平） |
| `cascader` | 级联 | `string[]` | 级联 | Dataset 选项树 |
| `tags` | 标签 | `string[]` | 自由标签 | 无预设选项 |
| `json` | JSON | `json` | JSON 编辑 | 无 |
| `relation` | 关联 | `relation` | 关联选择 | 目标表 + 基数 |

选项树、币种、关联标签列存在 Dataset `config`（及关联字段上的目标 / 基数），不存在 Form item 上。

关联基数（`one` / `many`）不是 `kind`，创建后不可按「同存储转换」改。

## 同 `dataType` 转换 `kind`

`dataType` 相同即可申请改 `kind`。例如单选 → 多选。

提交转换前校验全部现有行（含新 `kind` 的选项/格式约束）。**任一行不合法则整次拒绝**，返回不合法行，不截断、不丢数据、不自动改值。

| 转换 | 何时拒绝 |
| --- | --- |
| `single_select` → `multi_select` | 一般不拒绝（已是长度 0 或 1 的数组） |
| `multi_select` → `single_select` | 任一行 `length > 1` |
| `tags` → `single_select` / `multi_select` | 值不在新的选项里 |
| `cascader` → 平铺选项 | 路径对不上新选项 |
| `text` → `date` / `email` / `url` 等 | 有值不满足新格式 |
| `number` → `percent` | 有值不在百分数允许范围 |

转换只改列的 `kind`、`config` 与由 `kind` 推导的附加 schema（如去掉 `maxItems: 1`）。**已经绑在该列上的 Form item 的绑定和 `widget` 都不改。**

## Form `widget`

现有控件全部保留；`email` 与 `input` 共用单行输入框组件：

| widget | 中文 |
| --- | --- |
| `input` | 单行输入 |
| `email` | 邮箱 |
| `textarea` | 多行文本 |
| `checkbox` | 复选框 |
| `radio` | 单选项 |
| `selector` | 选择器 |
| `cascader` | 级联选择 |
| `tags-input` | 标签输入 |

兼容只看目标列的 **`dataType`**：

| widget | 可绑定的 dataType |
| --- | --- |
| `input` | `string`、`number` |
| `email` | `string` |
| `textarea` | `string` |
| `checkbox` | `boolean` |
| `radio` | `string[]` |
| `selector` | `string[]`、`relation` |
| `cascader` | `string[]` |
| `tags-input` | `string[]` |

因此：

- 同一 `string[]` 列，表单可以是 Radio、Selector、Cascader 或标签输入，与当前 `kind` 是单选还是多选无关。
- 列从单选改成多选后，已绑定的 Radio **保持绑定、保持控件**，继续往 `string[]` 里写 0 或 1 项。要改成多选控件，由作者改 `widget`。
- `input` 的 date / number 等外观由表单项自己的 JSON Schema（如 `format`）决定。绑定时可以抄列上的初值，之后不随 `kind` 转换自动变。
- `email` 固定 `format: 'email'`，只绑 `string`。
- `json` 本轮不进表单。
- `textarea` 可绑定任意 `string` 列（含文本、长文本、日期等）；推荐用在长文本，但不靠 `kind` 做硬限制。

从调色板**新建列**时的默认值（仍可立刻改成同 `dataType` 的其它 `kind`）：

| 拖入 widget | dataType | 默认 kind |
| --- | --- | --- |
| `input` | `string` | `text` |
| `email` | `string` | `email` |
| `textarea` | `string` | `long_text` |
| `checkbox` | `boolean` | `checkbox` |
| `radio` | `string[]` | `single_select` |
| `selector` | `string[]` | `single_select` |
| `cascader` | `string[]` | `cascader` |
| `tags-input` | `string[]` | `tags` |

绑已有列时，下拉只列出 `dataType` 与当前 widget 兼容、且未被其它 item 占用的字段。

`email` 与 `input` 共用输入框组件，固定 `format: 'email'`，只绑 `string`。

不要用 Form `widget` 去写 Dataset 的选项形态（例如用 Cascader 控件把列改成级联）。级联是列的 `kind`。

## 所有权

| 内容 | 归属 |
| --- | --- |
| 存什么、`kind`、选项树、币种、关联目标 / 基数 | Dataset |
| `widget`、文案、placeholder、`availableIf`、关联筛选项 | Form Item |
| 提交时的选项合法性 | 以 Dataset 当前定义为准（现有字段投影保留） |

Form 可以比 Dataset 更严（Radio 在 `string[]` 上仍限制 0–1 项），不能比 Dataset 存储类型更宽。

## 现状 `DatasetFieldKind` 对照

实现拆分时按此迁移。旧枚举不再作为表单绑定轴。

| 旧 kind | dataType | 新 kind | 值迁移 |
| --- | --- | --- | --- |
| `text` | `string` | `text` | 无 |
| `long_text` | `string` | `long_text` | 无 |
| `date` / `time` / `datetime` / `email` / `url` | `string` | 同名 | 无 |
| `number` | `number` | `number` | 无 |
| `boolean` | `boolean` | `checkbox` | 无 |
| `single_select` | `string[]` | `single_select` | `"a"` → `["a"]`；空 → `[]` |
| `multi_select` 且 `optionMode = cascader` | `string[]` | `cascader` | 无（已是路径数组） |
| `multi_select` 且有 `options` | `string[]` | `multi_select` | 无 |
| `multi_select` 且无 `options` | `string[]` | `tags` | 无 |
| `json` | `json` | `json` | 无 |
| `relation` | `relation` | `relation` | 无 |
| **其它 / 无法识别的旧 kind** | **`string`** | **`text`** | **不改单元格值和 `valueSchema`** |

Deploy 迁移必须带这条 ELSE：`dataType` 回填后立刻 `NOT NULL`，未知或脏 `kind` 不能让 migrate 失败。已知映射仍按上表；兜底只用于对不上表的值。不要在运行时对线上 `DatasetField` 再推断 `dataType`。

历史 `DatasetVersion.fieldsSnapshot` 若缺 `dataType`，读取快照时用同一张对照表（含 ELSE），不要改已落盘的快照 JSON，除非同一次迁移里一并回写。

单选改为数组后，过滤按数组语义（空 / 等于 / 包含），不再当标量字符串。
