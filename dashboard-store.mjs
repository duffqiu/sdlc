const DASHBOARD_TTL_MS = 60 * 60 * 1000;
const MAX_DASHBOARDS = 100;
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

export class DashboardError extends Error {}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnsafeKeys(value) {
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (item === null || typeof item !== 'object') continue;
    for (const key of Object.keys(item)) {
      if (unsafeKeys.has(key)) throw new DashboardError('参数含不允许的原型键。');
      const child = item[key];
      if (child !== null && typeof child === 'object') stack.push(child);
    }
  }
}

function assertString(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new DashboardError(`${field} 必须是 1–200 字符的非空字符串。`);
  if (value.length > 200) throw new DashboardError(`${field} 超过 200 字符。`);
}

function assertArray(value, field) {
  if (!Array.isArray(value)) throw new DashboardError(`${field} 必须是数组。`);
}

function assertColor(value, field) {
  if (!['ok', 'warn', 'danger', 'pending'].includes(value)) throw new DashboardError(`${field} 必须是 ok/warn/danger/pending 之一。`);
}

function validateStage(stage, index) {
  const prefix = `stages[${index}]`;
  if (!isObject(stage)) throw new DashboardError(`${prefix} 必须是对象。`);
  assertString(stage.id, `${prefix}.id`);
  assertString(stage.title, `${prefix}.title`);
  assertString(stage.status, `${prefix}.status`);
  assertColor(stage.color, `${prefix}.color`);
  assertString(stage.summary, `${prefix}.summary`);
  assertArray(stage.artifacts, `${prefix}.artifacts`);
  stage.artifacts.forEach((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
      throw new DashboardError(`${prefix}.artifacts[${i}] 必须是 [path, description] 字符串对。`);
    }
  });
  assertArray(stage.decisions, `${prefix}.decisions`);
  stage.decisions.forEach((d, i) => { if (typeof d !== 'string') throw new DashboardError(`${prefix}.decisions[${i}] 必须是字符串。`); });
  assertArray(stage.matrix, `${prefix}.matrix`);
  stage.matrix.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== 4 || typeof row[0] !== 'string' || typeof row[1] !== 'string' || typeof row[3] !== 'string') {
      throw new DashboardError(`${prefix}.matrix[${i}] 必须是 [id, name, color, result] 格式。`);
    }
    assertColor(row[2], `${prefix}.matrix[${i}].color`);
  });
  assertArray(stage.risks, `${prefix}.risks`);
  stage.risks.forEach((r, i) => { if (typeof r !== 'string') throw new DashboardError(`${prefix}.risks[${i}] 必须是字符串。`); });
  assertString(stage.next, `${prefix}.next`);
}

function validateDashboard(data) {
  rejectUnsafeKeys(data);
  if (!isObject(data)) throw new DashboardError('仪表盘数据必须是对象。');
  assertString(data.taskId, 'taskId');
  assertString(data.planVersion, 'planVersion');
  if (typeof data.currentStageIndex !== 'number' || !Number.isInteger(data.currentStageIndex) || data.currentStageIndex < 0) {
    throw new DashboardError('currentStageIndex 必须是非负整数。');
  }
  assertArray(data.stages, 'stages');
  if (data.currentStageIndex >= data.stages.length) throw new DashboardError('currentStageIndex 超出 stages 范围。');
  data.stages.forEach((stage, i) => validateStage(stage, i));
}

export class DashboardStore {
  constructor({ ttlMs = DASHBOARD_TTL_MS, maxItems = MAX_DASHBOARDS } = {}) {
    this.ttlMs = ttlMs;
    this.maxItems = maxItems;
    this.items = new Map();
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, item] of this.items) {
      if (now - item.createdAt > this.ttlMs) this.items.delete(key);
    }
  }

  _makeRef(taskId) {
    const version = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return `${encodeURIComponent(taskId)}:${version}`;
  }

  put(data) {
    validateDashboard(data);
    this._cleanup();
    if (this.items.size >= this.maxItems) {
      const oldest = this.items.keys().next().value;
      this.items.delete(oldest);
    }
    const ref = this._makeRef(data.taskId);
    this.items.set(ref, { data, createdAt: Date.now() });
    return { ref };
  }

  get(ref) {
    if (typeof ref !== 'string' || ref.length === 0) throw new DashboardError('ref 必须是非空字符串。');
    this._cleanup();
    const item = this.items.get(ref);
    if (!item) throw new DashboardError('仪表盘记录不存在或已过期。');
    return item.data;
  }
}
