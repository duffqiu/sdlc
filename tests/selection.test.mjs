import test from 'node:test';
import assert from 'node:assert/strict';

const storeUrl = new URL('../selection-store.mjs', import.meta.url);
let SelectionStore;
try {
  ({ SelectionStore } = await import(storeUrl));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const stageIds = ['solution-designer', 'implementation-engineer', 'independent-reviewer', 'acceptance-verifier', 'harness-optimizer', 'release-operations'];
const labels = ['方案设计', '开发实现', '独立评审', '独立验收', 'AI Harness 优化', '交付运维'];
const start = 1_800_000_000_000;
const ttl = 3_600_000;
const fixture = () => ({
  taskId: 'task-1', taskSummary: '实现 登录及测试', targetLabel: '当前工作区', catalogFetchedAt: start,
  models: [
    { modelKey: 'model-a', displayName: '模型 A', enabled: true, priceFactor: 0, maxInputTokens: 128000 },
    { modelKey: 'model-b', displayName: '模型 B', enabled: true, priceFactor: null, maxInputTokens: null },
  ],
  stages: stageIds.map((id, index) => ({ id, reason: '按任务需要 推荐该环节', enabled: index < 3, required: index === 1, recommendedModelKey: 'model-a' })),
});
const choicesFor = selection => selection.stages.map(({ id: stageId, enabled, modelKey }) => ({ stageId, enabled, modelKey }));
function harness(options = {}) {
  assert.equal(typeof SelectionStore, 'function', 'SelectionStore class must be implemented');
  let clock = start;
  let sequence = 0;
  const store = new SelectionStore({ now: () => clock, id: () => `selection-${++sequence}`, ...options });
  return { store, advance: milliseconds => { clock += milliseconds; } };
}

test('create returns exact pending snapshot with six labels and recommended defaults', () => {
  const { store } = harness();
  const input = fixture();
  const selection = store.create(input);
  assert.deepEqual(selection, {
    selectionId: 'selection-1', ...input,
    stages: input.stages.map((stage, index) => ({ ...stage, label: labels[index], modelKey: 'model-a' })),
    status: 'pending', createdAt: start, expiresAt: start + ttl, decidedAt: null,
  });
  assert.deepEqual(store.get(selection.selectionId), selection);
});

test('default ID is a crypto UUID and defaults need no constructor options', () => {
  assert.equal(typeof SelectionStore, 'function', 'SelectionStore must exist');
  const selection = new SelectionStore().create(fixture());
  assert.match(selection.selectionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(selection.expiresAt - selection.createdAt, ttl);
});

test('input and every snapshot are deep clones, including decide results', () => {
  const { store } = harness();
  const input = fixture();
  const selection = store.create(input);
  input.models[0].displayName = 'mutated';
  input.stages[0].reason = 'mutated';
  selection.models[0].modelKey = 'mutated';
  selection.stages[0].modelKey = 'mutated';
  const read = store.get(selection.selectionId);
  assert.equal(read.models[0].modelKey, 'model-a');
  assert.equal(read.models[0].displayName, '模型 A');
  assert.equal(read.stages[0].reason, '按任务需要 推荐该环节');
  read.models.length = 0;
  const result = store.decide({ selectionId: selection.selectionId, decision: 'confirmed', choices: choicesFor(store.get(selection.selectionId)) });
  result.stages[0].enabled = false;
  assert.equal(store.get(selection.selectionId).stages[0].enabled, true);
  assert.equal(store.get(selection.selectionId).models.length, 2);
});

test('confirmation changes only choices and terminal fields, never the recommendations', () => {
  const { store, advance } = harness();
  const pending = store.create(fixture());
  const choices = choicesFor(pending);
  choices[0] = { ...choices[0], enabled: false, modelKey: 'model-b' };
  advance(20);
  const confirmed = store.decide({ selectionId: pending.selectionId, decision: 'confirmed', choices });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.decidedAt, start + 20);
  assert.equal(confirmed.stages[0].modelKey, 'model-b');
  assert.equal(confirmed.stages[0].recommendedModelKey, 'model-a');
  assert.equal(confirmed.stages[0].enabled, false);
  assert.deepEqual(store.get(pending.selectionId), confirmed);
});

test('cancel can disable required stages and stores submitted model choices', () => {
  const { store } = harness();
  const pending = store.create(fixture());
  const choices = choicesFor(pending).map(choice => ({ ...choice, enabled: false, modelKey: 'model-b' }));
  const cancelled = store.decide({ selectionId: pending.selectionId, decision: 'cancelled', choices });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.decidedAt, start);
  assert.ok(cancelled.stages.every(stage => !stage.enabled && stage.modelKey === 'model-b'));
});

test('explicitly confirming all optional stages off is allowed', () => {
  const { store } = harness();
  const input = fixture();
  input.stages.forEach(stage => { stage.required = false; });
  const pending = store.create(input);
  const confirmed = store.decide({ selectionId: pending.selectionId, decision: 'confirmed', choices: choicesFor(pending).map(choice => ({ ...choice, enabled: false })) });
  assert.equal(confirmed.status, 'confirmed');
  assert.ok(confirmed.stages.every(stage => !stage.enabled));
});

test('confirmation cannot disable required stages and failure is atomic', () => {
  const { store } = harness();
  const pending = store.create(fixture());
  const choices = choicesFor(pending);
  choices[1].enabled = false;
  assert.throws(() => store.decide({ selectionId: pending.selectionId, decision: 'confirmed', choices }), /required|必选/);
  assert.deepEqual(store.get(pending.selectionId), pending);
});

for (const decision of ['confirmed', 'cancelled']) {
  test(`${decision} retries are idempotent; changed terminal decision or choices are rejected`, () => {
    const { store, advance } = harness();
    const pending = store.create(fixture());
    const args = { selectionId: pending.selectionId, decision, choices: choicesFor(pending) };
    const terminal = store.decide(args);
    advance(42);
    assert.deepEqual(store.decide(structuredClone(args)), terminal);
    assert.deepEqual(store.decide({ ...args, choices: [...args.choices].reverse() }), terminal);
    assert.throws(() => store.decide({ ...args, decision: decision === 'confirmed' ? 'cancelled' : 'confirmed' }), /终态|已决定|已确认|已取消/);
    const changed = structuredClone(args);
    changed.choices[0].modelKey = 'model-b';
    assert.throws(() => store.decide(changed), /终态|已决定|已确认|已取消/);
    assert.deepEqual(store.get(pending.selectionId), terminal);
  });
}

test('multiple drafts of even the same task are isolated', () => {
  const { store } = harness();
  const a = store.create(fixture());
  const b = store.create(fixture());
  assert.notEqual(a.selectionId, b.selectionId);
  store.decide({ selectionId: a.selectionId, decision: 'cancelled', choices: choicesFor(a) });
  assert.deepEqual(store.get(b.selectionId), b);
});

for (const operation of ['get', 'decide', 'create']) {
  test(`TTL expires at exactly one hour with lazy cleanup on ${operation}`, () => {
    const { store, advance } = harness();
    const pending = store.create(fixture());
    advance(ttl - 1);
    assert.equal(store.get(pending.selectionId).status, 'pending');
    advance(1);
    if (operation === 'get') assert.throws(() => store.get(pending.selectionId), /过期|不存在/);
    if (operation === 'decide') assert.throws(() => store.decide({ selectionId: pending.selectionId, decision: 'confirmed', choices: choicesFor(pending) }), /过期|不存在/);
    if (operation === 'create') assert.notEqual(store.create(fixture()).selectionId, pending.selectionId);
    assert.throws(() => store.get(pending.selectionId), /过期|不存在/);
  });
}

test('terminal records expire too; missing or expired records never resurrect', () => {
  const { store, advance } = harness();
  const pending = store.create(fixture());
  const args = { selectionId: pending.selectionId, decision: 'confirmed', choices: choicesFor(pending) };
  store.decide(args);
  advance(ttl);
  assert.throws(() => store.decide(args), /过期|不存在/);
  assert.throws(() => store.get('unknown'), /过期|不存在/);
  assert.throws(() => store.get(pending.selectionId), /过期|不存在/);
});

test('capacity is 100 active records, without evicting live selections; expiration frees capacity', () => {
  const { store, advance } = harness();
  const first = store.create(fixture());
  for (let index = 1; index < 100; index++) store.create(fixture());
  assert.throws(() => store.create(fixture()), /100|容量|上限/);
  assert.deepEqual(store.get(first.selectionId), first);
  advance(ttl);
  assert.equal(store.create(fixture()).status, 'pending');
  assert.throws(() => store.get(first.selectionId), /过期|不存在/);
});

test('injected duplicate IDs cannot overwrite active drafts', () => {
  const { store } = harness({ id: () => 'same-id' });
  const first = store.create(fixture());
  assert.throws(() => store.create(fixture()), /重复|冲突/);
  assert.deepEqual(store.get('same-id'), first);
});

const invalidInputs = [
  ['extra root field', x => { x.extra = true; }],
  ['extra model field', x => { x.models[0].extra = true; }],
  ['extra stage field', x => { x.stages[0].label = 'fake'; }],
  ['disabled catalog model', x => { x.models[0].enabled = false; }],
  ['duplicate model key', x => { x.models[1].modelKey = x.models[0].modelKey; }],
  ['duplicate stage ID', x => { x.stages[1].id = x.stages[0].id; }],
  ['unknown stage ID', x => { x.stages[0].id = 'unknown'; }],
  ['unknown recommendation', x => { x.stages[0].recommendedModelKey = 'missing'; }],
  ['required but disabled', x => { x.stages[1].enabled = false; }],
  ['boolean coercion', x => { x.stages[0].enabled = 1; }],
  ['missing required flag', x => { delete x.stages[0].required; }],
  ['zero timestamp', x => { x.catalogFetchedAt = 0; }],
  ['fraction timestamp', x => { x.catalogFetchedAt = 1.5; }],
  ['unsafe timestamp', x => { x.catalogFetchedAt = Number.MAX_SAFE_INTEGER + 1; }],
  ['NaN timestamp', x => { x.catalogFetchedAt = NaN; }],
  ['negative price', x => { x.models[0].priceFactor = -1; }],
  ['infinite price', x => { x.models[0].priceFactor = Infinity; }],
  ['string price', x => { x.models[0].priceFactor = '1'; }],
  ['zero token limit', x => { x.models[0].maxInputTokens = 0; }],
  ['fraction token limit', x => { x.models[0].maxInputTokens = 1.5; }],
  ['empty models', x => { x.models = []; }],
  ['too many models', x => { x.models = Array.from({ length: 101 }, (_, i) => ({ modelKey: `m${i}`, displayName: 'm', enabled: true })); }],
  ['empty stages', x => { x.stages = []; }],
  ['too many stages', x => { x.stages.push({ ...x.stages[0] }); }],
  ['prototype root', x => { Object.setPrototypeOf(x, { injected: true }); }],
  ['prototype nested', x => { Object.setPrototypeOf(x.models[0], { injected: true }); }],
  ['__proto__ key', x => { Object.defineProperty(x.models[0], '__proto__', { value: {}, enumerable: true }); }],
  ['constructor key', x => { x.stages[0].constructor = {}; }],
  ['prototype key', x => { x.prototype = {}; }],
];
for (const [name, mutate] of invalidInputs) {
  test(`create rejects ${name}`, () => {
    const { store } = harness();
    const input = fixture();
    mutate(input);
    assert.throws(() => store.create(input));
  });
}

const stringFields = [
  ['taskId', 200, x => x, 'taskId'], ['taskSummary', 500, x => x, 'taskSummary'],
  ['targetLabel', 300, x => x, 'targetLabel'], ['modelKey', 512, x => x.models[0], 'modelKey'],
  ['displayName', 200, x => x.models[0], 'displayName'], ['reason', 500, x => x.stages[0], 'reason'],
  ['recommendedModelKey', 512, x => x.stages[0], 'recommendedModelKey'],
];
for (const [name, max, select, key] of stringFields) {
  test(`${name} rejects empty, overlong and control-containing strings`, () => {
    const { store } = harness();
    for (const value of ['', 'x'.repeat(max + 1), 'a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u007fb', 'a\u0085b', 'a\u2028b', 'a\u2029b', 'a\n', 'a\r', 'a\u2028', 'a\u2029']) {
      const input = fixture();
      select(input)[key] = value;
      assert.throws(() => store.create(input), `${name}: ${JSON.stringify(value)}`);
    }
  });
}

test('allows exact string/array/numeric boundaries, spaces, Unicode and optional metrics', () => {
  const { store } = harness();
  const input = fixture();
  input.taskId = 'x'.repeat(200);
  input.taskSummary = '中'.repeat(500);
  input.targetLabel = 'x'.repeat(300);
  input.models = Array.from({ length: 100 }, (_, i) => ({ modelKey: `m${i}`, displayName: 'm', enabled: true }));
  input.models[0].modelKey = 'x'.repeat(512);
  input.models[0].displayName = '中'.repeat(200);
  input.models[0].priceFactor = 0;
  input.models[0].maxInputTokens = 1;
  input.catalogFetchedAt = Number.MAX_SAFE_INTEGER;
  input.stages.forEach(stage => { stage.recommendedModelKey = input.models[0].modelKey; stage.reason = '中'.repeat(500); });
  assert.equal(store.create(input).models.length, 100);
  const minimal = fixture();
  minimal.models = [minimal.models[0]];
  minimal.stages = [minimal.stages[0]];
  delete minimal.models[0].priceFactor;
  delete minimal.models[0].maxInputTokens;
  minimal.taskSummary = '正常 空格';
  assert.equal(store.create(minimal).stages.length, 1);
});

const invalidDecisions = [
  ['missing choice', x => { x.choices.pop(); }],
  ['duplicate stage', x => { x.choices[1] = { ...x.choices[0] }; }],
  ['unknown stage', x => { x.choices[0].stageId = 'unknown'; }],
  ['unknown model even when disabled', x => { x.choices[0].enabled = false; x.choices[0].modelKey = 'unknown'; }],
  ['extra choice field', x => { x.choices[0].extra = true; }],
  ['extra argument', x => { x.extra = true; }],
  ['invalid decision', x => { x.decision = 'pending'; }],
  ['missing decision', x => { delete x.decision; }],
  ['non-boolean choice', x => { x.choices[0].enabled = 'true'; }],
  ['control model key', x => { x.choices[0].modelKey = 'model-a\n'; }],
  ['control selection ID', x => { x.selectionId += '\n'; }],
  ['empty choices', x => { x.choices = []; }],
  ['missing choices', x => { delete x.choices; }],
  ['prototype choice', x => { x.choices[0].prototype = {}; }],
];
for (const [name, mutate] of invalidDecisions) {
  test(`decide rejects ${name} without altering pending state`, () => {
    const { store } = harness();
    const pending = store.create(fixture());
    const args = { selectionId: pending.selectionId, decision: 'cancelled', choices: choicesFor(pending) };
    mutate(args);
    assert.throws(() => store.decide(args));
    assert.deepEqual(store.get(pending.selectionId), pending);
  });
}

test('rejects non-object data, accessors and symbol keys without invoking accessors', () => {
  const { store } = harness();
  for (const value of [null, [], true, 'text', 1]) assert.throws(() => store.create(value));
  const input = fixture();
  let invoked = false;
  Object.defineProperty(input, 'taskId', { enumerable: true, get() { invoked = true; return 'task-1'; } });
  assert.throws(() => store.create(input));
  assert.equal(invoked, false);
  const symbolInput = fixture();
  symbolInput[Symbol('hidden')] = true;
  assert.throws(() => store.create(symbolInput));
});
