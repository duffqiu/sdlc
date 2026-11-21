import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scriptUrl = new URL('../app/app.js', import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));

function selection() {
  return {
    selectionId: 'selection-test', taskId: 'task-test', taskSummary: '检查退款处理',
    targetLabel: '测试工作区', catalogFetchedAt: Date.now(), createdAt: Date.now(),
    expiresAt: Date.now() + 3600000, decidedAt: null, status: 'pending',
    models: [{ modelKey: 'model-a', displayName: '模型 A', enabled: true, priceFactor: 0.5 },
      { modelKey: 'model-b', displayName: '模型 B', enabled: true }],
    stages: [{ id: 'implementation-engineer', label: '开发实现', reason: '实现退款逻辑',
      enabled: true, required: false, recommendedModelKey: 'model-a', modelKey: 'model-a' },
    { id: 'acceptance-verifier', label: '独立验收', reason: '验证退款',
      enabled: true, required: false, recommendedModelKey: 'model-b', modelKey: 'model-b' }],
  };
}

async function harness(capabilities = { serverTools: {}, message: { text: {} } }) {
  const nodes = new Map();
  const events = new Map();
  const sent = [];
  const timers = new Map();
  let nextTimer = 0;
  function element(tag = 'div') {
    return {
      tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, handlers: new Map(),
      textContent: '', value: '', checked: false, disabled: false, hidden: false,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      addEventListener(name, callback) { this.handlers.set(name, callback); },
      removeEventListener(name) { this.handlers.delete(name); },
      getBoundingClientRect() { return { height: 480 }; },
    };
  }
  const node = name => {
    if (!nodes.has(name)) nodes.set(name, element());
    return nodes.get(name);
  };
  const parent = { postMessage(message) { sent.push(message); } };
  const window = { parent, addEventListener(name, fn) { events.set(name, fn); },
    removeEventListener(name) { events.delete(name); } };
  const document = { querySelector: node, createElement: element,
    documentElement: { dataset: {} } };
  const env = { window, document, Date, Intl, console,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const script = await readFile(scriptUrl, 'utf8');
  vm.runInNewContext(script, env);
  function deliver(data, source = parent) {
    events.get('message')?.({ source, data: { jsonrpc: '2.0', ...data } });
  }
  function calls(method) { return sent.filter(message => message.method === method); }
  const init = calls('ui/initialize')[0];
  assert.ok(init);
  deliver({ id: init.id, result: { protocolVersion: '2026-01-26', hostCapabilities: capabilities,
    hostContext: { theme: 'light', displayMode: 'inline' } } });
  await flush();
  async function load(value = selection()) {
    deliver({ method: 'ui/notifications/tool-result', params: { structuredContent: { selection: value } } });
    await flush();
    const read = calls('tools/call').findLast(message => message.params.name === 'get_stage_selection');
    if (read) deliver({ id: read.id, result: { structuredContent: { selection: value } } });
    await flush();
  }
  function descendants(root, tag) {
    return root.children.flatMap(child => typeof child === 'object' ?
      [...(child.tagName === tag.toUpperCase() ? [child] : []), ...descendants(child, tag)] : []);
  }
  function inputs(tag) { return descendants(node('#stage-body'), tag); }
  function click(name) { node(name).handlers.get('click')?.({ preventDefault() {} }); }
  function submit() { click('#confirm'); }
  return { nodes, node, document, sent, events, timers, calls, deliver, load, inputs, click, submit };
}

test('preselects recommended models and never sends a confirmation on load or edit', async () => {
  const h = await harness();
  await h.load();
  assert.deepEqual(h.inputs('select').map(input => input.value), ['model-a', 'model-b']);
  assert.equal(h.node('#confirm').disabled, false);
  assert.equal(h.calls('ui/message').length, 0);
  assert.equal(h.calls('tools/call').filter(call => call.params.name === 'confirm_stage_selection').length, 0);
  h.inputs('select')[0].value = 'model-b';
  h.inputs('select')[0].handlers.get('change')();
  assert.equal(h.calls('ui/message').length, 0);
});

test('sends changed model and unchecked stage only after confirmation, then notifies main once', async () => {
  const h = await harness();
  await h.load();
  const [model] = h.inputs('select');
  model.value = 'model-b'; model.handlers.get('change')();
  const check = h.inputs('input')[1];
  check.checked = false; check.handlers.get('change')();
  assert.equal(h.inputs('select')[1].disabled, true);
  h.submit(); h.submit();
  const writes = h.calls('tools/call').filter(call => call.params.name === 'confirm_stage_selection');
  assert.equal(writes.length, 1);
  const args = JSON.parse(JSON.stringify(writes[0].params.arguments));
  assert.equal(args.decision, 'confirmed');
  assert.deepEqual(args.choices, [{ stageId: 'implementation-engineer', enabled: true, modelKey: 'model-b' },
    { stageId: 'acceptance-verifier', enabled: false, modelKey: 'model-b' }]);
  const value = selection();
  value.status = 'confirmed'; value.decidedAt = Date.now();
  value.stages[0].modelKey = 'model-b'; value.stages[1].enabled = false;
  h.deliver({ id: writes[0].id, result: { structuredContent: { selection: value } } });
  await flush();
  const message = h.calls('ui/message')[0];
  assert.equal(message.params.role, 'user');
  assert.equal(message.params._meta['qoder/message'].target, 'active');
  assert.match(message.params.content[0].text, /selection-test/);
  h.deliver({ id: message.id, result: {} }); await flush();
  h.submit();
  assert.equal(h.calls('ui/message').length, 1);
  assert.equal(h.node('#confirm').disabled, true);
  assert.match(h.node('#status').textContent, /主会话/);
});

test('cancel is a separate recorded decision and unsupported messaging disables actions', async () => {
  const h = await harness(); await h.load(); h.click('#cancel');
  assert.equal(h.calls('tools/call').at(-1).params.arguments.decision, 'cancelled');
  const remote = await harness({ serverTools: {} }); await remote.load();
  assert.equal(remote.node('#confirm').hidden, true);
  assert.equal(remote.node('#cancel').hidden, true);
  remote.submit();
  assert.equal(remote.calls('ui/message').length, 0);
});

test('host changes preserve edits, foreign-window messages are ignored, and unknown send never retries', async () => {
  const h = await harness(); await h.load();
  h.inputs('select')[0].value = 'model-b'; h.inputs('select')[0].handlers.get('change')();
  h.deliver({ method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } });
  assert.equal(h.document.documentElement.dataset.theme, 'dark');
  assert.equal(h.inputs('select')[0].value, 'model-b');
  const hostile = selection(); hostile.taskSummary = 'UNTRUSTED';
  h.deliver({ method: 'ui/notifications/tool-result', params: { structuredContent: { selection: hostile } } }, {});
  assert.notEqual(h.node('#task-title').textContent, 'UNTRUSTED');
  h.submit();
  const write = h.calls('tools/call').at(-1);
  const confirmed = selection(); confirmed.status = 'confirmed'; confirmed.decidedAt = Date.now();
  h.deliver({ id: write.id, result: { structuredContent: { selection: confirmed } } }); await flush();
  const message = h.calls('ui/message')[0];
  h.deliver({ id: message.id, error: { code: -32000, message: 'unknown outcome' } }); await flush();
  h.submit(); h.click('#cancel');
  assert.equal(h.calls('ui/message').length, 1);
  assert.match(h.node('#status').textContent, /主会话.*检查|检查.*主会话/);
});

test('required stages cannot be deselected; expired and malformed snapshots cannot submit', async () => {
  const h = await harness(); const value = selection(); value.stages[0].required = true;
  await h.load(value); assert.equal(h.inputs('input')[0].disabled, true);
  const expired = await harness(); const stale = selection(); stale.expiresAt = Date.now() - 1;
  await expired.load(stale); assert.equal(expired.node('#confirm').disabled, true);
  const invalid = await harness(); await invalid.load({ selectionId: 'invalid' });
  assert.equal(invalid.node('#confirm').disabled, true);
});

test('implicit form submission never records a decision', async () => {
  const h = await harness(); await h.load();
  h.node('#selection-form').handlers.get('submit')?.({ preventDefault() {} });
  assert.equal(h.calls('tools/call').filter(call => call.params.name === 'confirm_stage_selection').length, 0);
});

test('teardown clears pending requests and listeners', async () => {
  const h = await harness(); await h.load(); h.submit();
  h.deliver({ id: 'teardown', method: 'ui/resource-teardown' }); await flush();
  assert.equal(h.timers.size, 0);
  assert.equal(h.events.size, 0);
  assert.equal(h.node('#confirm').disabled, true);
});
