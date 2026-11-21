import { randomUUID } from 'node:crypto';

const TTL_MS = 60 * 60 * 1000;
const MAX_RECORDS = 100;
const stageLabels = Object.freeze({
  'solution-designer': '方案设计',
  'implementation-engineer': '开发实现',
  'independent-reviewer': '独立评审',
  'acceptance-verifier': '独立验收',
  'harness-optimizer': 'AI Harness 优化',
  'release-operations': '交付运维',
});
const stageIds = Object.keys(stageLabels);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
// C0/C1 controls and Unicode line/paragraph separators are never accepted.
const textPattern = '^[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+$';
const text = (maxLength, description) => ({
  type: 'string', minLength: 1, ...(maxLength === undefined ? {} : { maxLength }), pattern: textPattern, description,
});
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const stageId = description => ({ type: 'string', enum: stageIds, description });
const positiveInteger = description => ({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description });
const selectionIdSchema = text(undefined, 'open_stage_selector 返回的 selectionId；不存在或过期时必须重新打开选择器。');

const modelSchema = object({
  modelKey: text(512, '主会话提供的模型目录键；同一目录内必须唯一。'),
  displayName: text(200, '主会话提供的模型显示名称。'),
  enabled: { type: 'boolean', const: true, description: '主会话已筛选目录，只接受 true；服务不验证外部资格。' },
  priceFactor: { type: ['number', 'null'], minimum: 0, description: '可选非负价格倍率；未知时省略或传 null。' },
  maxInputTokens: { ...positiveInteger('可选最大输入 token 数；未知时省略或传 null。'), type: ['integer', 'null'] },
}, ['modelKey', 'displayName', 'enabled']);
const stageSchema = {
  ...object({
    id: stageId('环节标识，同一草稿内必须唯一。'),
    reason: text(500, '推荐该环节的理由；允许普通空格，不接受换行。'),
    enabled: { type: 'boolean', description: '初始勾选状态，仅为建议，不表示用户批准。' },
    required: { type: 'boolean', description: '是否必选；为 true 时初始 enabled 必须为 true。' },
    recommendedModelKey: text(512, '必须引用本次 models 目录中的 modelKey，作为初始推荐值。'),
  }),
  allOf: [{ if: { properties: { required: { const: true } } }, then: { properties: { enabled: { const: true } } } }],
};

function freezeDeep(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freezeDeep(child);
  return Object.freeze(value);
}

// The published JSON Schemas also drive runtime structural validation. Relational
// constraints (unique keys, catalog membership and complete stage coverage) are
// documented in descriptions and enforced below; JSON Schema cannot join arrays.
export const selectionSchemas = freezeDeep({
  open: object({
    taskId: text(200, '主会话任务标识；同一任务可创建多个相互隔离的草稿。'),
    taskSummary: text(500, '主会话任务摘要；允许普通空格，不接受换行。'),
    targetLabel: text(300, '任务执行目标的显示文本，仅保存，不解析为路径或命令。'),
    catalogFetchedAt: positiveInteger('主会话获取实时 Qoder 目录的毫秒时间戳；本服务未访问或验证目录。'),
    models: { type: 'array', minItems: 1, maxItems: 100, items: modelSchema, description: '主会话筛选的模型目录，modelKey 唯一且 enabled 全为 true。' },
    stages: { type: 'array', minItems: 1, maxItems: 6, items: stageSchema, description: '本任务推荐环节，id 唯一；推荐模型必须属于 models；required 环节初始必须启用。' },
  }),
  read: object({ selectionId: selectionIdSchema }),
  decide: object({
    selectionId: selectionIdSchema,
    decision: { type: 'string', enum: ['confirmed', 'cancelled'], description: '用户在 App 明确点击确认或取消后的决定；取消允许关闭必选环节。' },
    choices: {
      type: 'array', minItems: 1, maxItems: 6,
      description: '必须恰好覆盖该草稿全部环节且无重复；模型均来自该草稿目录；确认不能关闭必选环节，可明确确认全部可选环节关闭。',
      items: object({
        stageId: stageId('该草稿中的环节标识，必须恰好出现一次。'),
        enabled: { type: 'boolean', description: '用户提交的勾选状态，confirmed 时不能关闭 required 环节。' },
        modelKey: text(512, '用户提交的模型键，关闭或取消的环节也必须使用本草稿目录中的键。'),
      }),
    },
  }),
});

export class SelectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SelectionError';
  }
}
const invalid = message => { throw new SelectionError(message); };

function plainDataObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${path} 必须是对象。`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(`${path} 不接受自定义原型。`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || unsafeKeys.has(key)) invalid(`${path} 含不允许的原型键或符号键。`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid(`${path} 只接受普通可枚举数据字段。`);
  }
}

/** Validate only the JSON Schema vocabulary used by the fixed schemas above. */
export function validateSchema(schema, value, path = '参数') {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = types.some(type => {
      switch (type) {
        case 'null': return value === null;
        case 'array': return Array.isArray(value);
        case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
        case 'integer': return Number.isSafeInteger(value);
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        default: return typeof value === type;
      }
    });
    if (!matches) invalid(`${path} 类型不正确。`);
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) invalid(`${path} 必须为 ${JSON.stringify(schema.const)}。`);
  if (schema.enum && !schema.enum.includes(value)) invalid(`${path} 不在允许的枚举中。`);
  if (typeof value === 'string') {
    const length = [...value].length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) invalid(`${path} 字符长度不符合限制。`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) invalid(`${path} 不接受控制字符或换行。`);
  }
  if (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) invalid(`${path} 数值超出限制。`);
  if (schema.properties) {
    plainDataObject(value, path);
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) invalid(`${path}.${required} 为必填字段。`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) {
        if (schema.additionalProperties === false) invalid(`${path} 含不允许的额外字段。`);
      } else validateSchema(schema.properties[key], value[key], `${path}.${key}`);
    }
  }
  if (schema.items) {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalid(`${path} 不接受自定义数组原型。`);
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) invalid(`${path} 数组长度不符合限制。`);
    if (Reflect.ownKeys(value).length !== value.length + 1) invalid(`${path} 数组不能含额外字段或空洞。`);
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid(`${path} 数组只接受普通数据项。`);
      validateSchema(schema.items, descriptor.value, `${path}[${index}]`);
    }
  }
  for (const clause of schema.allOf ?? []) {
    if (clause.if) {
      let matches = true;
      try { validateSchema(clause.if, value, path); }
      catch (error) { if (!(error instanceof SelectionError)) throw error; matches = false; }
      if (matches) validateSchema(clause.then, value, path);
    } else validateSchema(clause, value, path);
  }
}

/** Process-local drafts only. No persistence, timers, external catalog or task execution. */
export class SelectionStore {
  #records = new Map();
  #now;
  #id;

  constructor({ now = Date.now, id = randomUUID } = {}) {
    if (typeof now !== 'function' || typeof id !== 'function') invalid('now 和 id 必须是函数。');
    this.#now = now;
    this.#id = id;
  }

  #cleanup() {
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - TTL_MS) invalid('时钟必须提供有效的安全整数毫秒时间戳。');
    for (const [id, selection] of this.#records) if (selection.expiresAt <= now) this.#records.delete(id);
    return now;
  }

  #lookup(selectionId) {
    validateSchema(selectionIdSchema, selectionId, 'selectionId');
    const selection = this.#records.get(selectionId);
    if (!selection) invalid('选择记录不存在或已过期，请重新打开选择器并明确确认；不会自动恢复或执行任务。');
    return selection;
  }

  create(input) {
    const now = this.#cleanup();
    validateSchema(selectionSchemas.open, input);
    const modelKeys = new Set(input.models.map(model => model.modelKey));
    if (modelKeys.size !== input.models.length) invalid('models.modelKey 不得重复。');
    const ids = new Set(input.stages.map(stage => stage.id));
    if (ids.size !== input.stages.length) invalid('stages.id 不得重复。');
    for (const stage of input.stages) if (!modelKeys.has(stage.recommendedModelKey)) invalid('推荐模型必须属于本次 models 目录。');
    if (this.#records.size >= MAX_RECORDS) invalid('选择记录已达 100 条上限，请等待记录过期后再创建；不会替换有效草稿。');
    const selectionId = this.#id();
    validateSchema(selectionIdSchema, selectionId, 'selectionId');
    if (this.#records.has(selectionId)) invalid('生成的 selectionId 重复，请重新创建草稿。');
    const data = structuredClone(input);
    const selection = {
      selectionId,
      taskId: data.taskId, taskSummary: data.taskSummary, targetLabel: data.targetLabel,
      catalogFetchedAt: data.catalogFetchedAt, models: data.models,
      stages: data.stages.map(stage => ({ ...stage, label: stageLabels[stage.id], modelKey: stage.recommendedModelKey })),
      status: 'pending', createdAt: now, expiresAt: now + TTL_MS, decidedAt: null,
    };
    this.#records.set(selectionId, selection);
    return structuredClone(selection);
  }

  get(selectionId) {
    this.#cleanup();
    return structuredClone(this.#lookup(selectionId));
  }

  decide(input) {
    const now = this.#cleanup();
    validateSchema(selectionSchemas.decide, input);
    const selection = this.#lookup(input.selectionId);
    const choices = new Map(input.choices.map(choice => [choice.stageId, choice]));
    if (choices.size !== input.choices.length || choices.size !== selection.stages.length) invalid('choices 必须无重复地覆盖全部环节。');
    const models = new Set(selection.models.map(model => model.modelKey));
    for (const stage of selection.stages) {
      const choice = choices.get(stage.id);
      if (!choice) invalid('choices 含未知环节或缺少本草稿环节。');
      if (!models.has(choice.modelKey)) invalid('选择模型必须属于本草稿 models 目录。');
      if (input.decision === 'confirmed' && stage.required && !choice.enabled) invalid('确认时不能关闭必选 required 环节。');
    }
    if (selection.status !== 'pending') {
      const same = selection.status === input.decision && selection.stages.every(stage => {
        const choice = choices.get(stage.id);
        return choice.enabled === stage.enabled && choice.modelKey === stage.modelKey;
      });
      if (!same) invalid('记录已处于终态，不接受不同决定或选择；请读取现有结果。');
      return structuredClone(selection);
    }
    // Validate everything before committing a single state transition.
    selection.stages = selection.stages.map(stage => {
      const choice = choices.get(stage.id);
      return { ...stage, enabled: choice.enabled, modelKey: choice.modelKey };
    });
    selection.status = input.decision;
    selection.decidedAt = now;
    return structuredClone(selection);
  }
}
