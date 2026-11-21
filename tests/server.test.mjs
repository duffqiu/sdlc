import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const serverUrl = new URL('../server.mjs', import.meta.url);
const serverPath = fileURLToPath(serverUrl);
const resourceUri = 'ui://sdlc-selector/main.html';
const mimeType = 'text/html;profile=mcp-app';
const limit = 256 * 1024;
const request = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params });
const fixture = () => ({
  taskId: 'task-1', taskSummary: '实现 登录及测试', targetLabel: '当前工作区', catalogFetchedAt: 1_800_000_000_000,
  models: [{ modelKey: 'model-a', displayName: '模型 A', enabled: true }, { modelKey: 'model-b', displayName: '模型 B', enabled: true, priceFactor: null, maxInputTokens: null }],
  stages: [
    { id: 'solution-designer', reason: '澄清方案', enabled: true, required: false, recommendedModelKey: 'model-a' },
    { id: 'implementation-engineer', reason: '实现需求', enabled: true, required: true, recommendedModelKey: 'model-a' },
  ],
});
function transcript(messages, { raw = false } = {}) {
  const input = raw ? messages : messages.map(message => JSON.stringify(message)).join('\n') + '\n';
  const child = spawnSync(process.execPath, [serverPath], { input, encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, `server must exit cleanly on stdin end: ${child.stderr}`);
  assert.equal(child.stderr, '', 'no stderr errors on normal protocol input');
  return child.stdout.trim() ? child.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
}
function selectionOf(response) {
  assert.equal(response.error, undefined);
  const result = response.result;
  assert.deepEqual(Object.keys(result).sort(), ['content', 'structuredContent']);
  assert.deepEqual(Object.keys(result.structuredContent), ['selection']);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  assert.match(result.content[0].text, /[\u4e00-\u9fff]/);
  return result.structuredContent.selection;
}
function toolError(response) {
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent, undefined);
  assert.equal(response.result.content[0].type, 'text');
  assert.match(response.result.content[0].text, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(response.result.content[0].text, /\n\s+at |file:\/\/|Error:.*\n/);
}
function session(t) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0;
  let stderr = '';
  let closed = false;
  let lineError;
  const lines = createInterface({ input: child.stdout });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  lines.on('line', line => {
    try {
      const response = JSON.parse(line);
      const waiter = pending.get(response.id);
      assert.ok(waiter, `unexpected stdout response: ${line}`);
      pending.delete(response.id);
      clearTimeout(waiter.timer);
      waiter.resolve(response);
    } catch (error) { lineError = error; }
  });
  const exited = new Promise(resolve => child.on('close', (code, signal) => {
    closed = true;
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(`server exited before reply: ${stderr}`)); }
    pending.clear();
    resolve({ code, signal });
  }));
  t.after(async () => {
    if (!closed) child.kill();
    await exited;
    lines.close();
  });
  return {
    call(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, 3000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify(request(id, method, params)) + '\n');
      });
    },
    async close() {
      child.stdin.end();
      assert.deepEqual(await exited, { code: 0, signal: null });
      assert.equal(stderr, '');
      if (lineError) throw lineError;
    },
  };
}

test('initializes common protocol versions and negotiates unsupported versions', () => {
  for (const version of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', 'unknown']) {
    const [response] = transcript([request(1, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'node-test', version: '1.0.0' } })]);
    assert.equal(response.result.protocolVersion, version === 'unknown' ? '2025-11-25' : version);
    assert.deepEqual(response.result.capabilities, { tools: {}, resources: {} });
    assert.equal(response.result.serverInfo.name, 'sdlc-agent-orchestrator');
  }
});

test('publishes selector and dashboard tools with host visibility and safe annotations, without entrypoints', () => {
  const [response] = transcript([request(1, 'tools/list')]);
  const tools = response.result.tools;
  assert.deepEqual(tools.map(tool => tool.name), ['open_stage_selector', 'open_stage_dashboard', 'get_stage_selection', 'confirm_stage_selection']);
  const [open, dashboard, read, confirm] = tools;
  assert.equal(open._meta.ui.resourceUri, resourceUri);
  assert.deepEqual(open._meta.ui.visibility, ['model', 'app']);
  assert.deepEqual(dashboard._meta.ui.visibility, ['model', 'app']);
  assert.deepEqual(read._meta.ui.visibility, ['model', 'app']);
  assert.deepEqual(confirm._meta.ui.visibility, ['app']);
  assert.equal(open.annotations.readOnlyHint, false);
  assert.equal(open.annotations.destructiveHint, false);
  assert.equal(open.annotations.idempotentHint, false);
  assert.equal(read.annotations.readOnlyHint, true);
  assert.equal(confirm.annotations.readOnlyHint, false);
  assert.equal(confirm.annotations.destructiveHint, false);
  assert.equal(confirm.annotations.idempotentHint, true);
  for (const tool of tools) {
    assert.equal(tool._meta['qoder/ui']?.entrypoints, undefined);
    assert.ok(tool.description.length > 20);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.match(open.description, /待确认|草稿/);
  assert.match(open.description, /主会话/);
  assert.match(dashboard.description, /仪表盘/);
  assert.match(confirm.description, /确认|取消/);
});

test('schemas expose strict typed fields, bounds, enums and per-field descriptions', () => {
  const [{ result: { tools } }] = transcript([request(1, 'tools/list')]);
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  const schema = byName.open_stage_selector.inputSchema;
  const rootFields = ['taskId', 'taskSummary', 'targetLabel', 'catalogFetchedAt', 'models', 'stages'];
  assert.deepEqual(Object.keys(schema.properties), rootFields);
  assert.deepEqual(schema.required, rootFields);
  for (const [field, maximum] of [['taskId', 200], ['taskSummary', 500], ['targetLabel', 300]]) {
    assert.equal(schema.properties[field].type, 'string');
    assert.equal(schema.properties[field].minLength, 1);
    assert.equal(schema.properties[field].maxLength, maximum);
    for (const invalid of ['x\ny', 'x\n', 'x\r', 'x\u2028', 'x\u2029']) {
      assert.equal(new RegExp(schema.properties[field].pattern, 'u').test(invalid), false);
    }
  }
  assert.equal(schema.properties.catalogFetchedAt.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(schema.properties.models.maxItems, 100);
  assert.equal(schema.properties.stages.maxItems, 6);
  const model = schema.properties.models.items;
  assert.equal(model.additionalProperties, false);
  assert.equal(model.properties.enabled.const, true);
  assert.deepEqual(model.required, ['modelKey', 'displayName', 'enabled']);
  const stage = schema.properties.stages.items;
  assert.equal(stage.additionalProperties, false);
  assert.deepEqual(stage.properties.id.enum, ['solution-designer', 'implementation-engineer', 'independent-reviewer', 'acceptance-verifier', 'harness-optimizer', 'release-operations']);
  assert.equal(stage.properties.recommendedModelKey.maxLength, 512);
  assert.deepEqual(Object.keys(byName.get_stage_selection.inputSchema.properties), ['selectionId']);
  assert.deepEqual(Object.keys(byName.confirm_stage_selection.inputSchema.properties), ['selectionId', 'decision', 'choices']);
  assert.deepEqual(byName.confirm_stage_selection.inputSchema.properties.decision.enum, ['confirmed', 'cancelled']);
  function walk(node) {
    for (const child of Object.values(node.properties ?? {})) { assert.ok(child.description, 'every property needs a description'); walk(child); }
    if (node.items) walk(node.items);
  }
  tools.forEach(tool => walk(tool.inputSchema));
});

test('real stdio loop keeps reads pending, confirms edited model, and exposes final state', async t => {
  const rpc = session(t);
  await rpc.call('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
  const pending = selectionOf(await rpc.call('tools/call', { name: 'open_stage_selector', arguments: fixture() }));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.decidedAt, null);
  assert.ok(pending.stages.every(stage => stage.modelKey === stage.recommendedModelKey));
  assert.deepEqual(selectionOf(await rpc.call('tools/call', { name: 'get_stage_selection', arguments: { selectionId: pending.selectionId } })), pending);
  const choices = pending.stages.map(stage => ({ stageId: stage.id, enabled: stage.enabled, modelKey: 'model-b' }));
  const args = { selectionId: pending.selectionId, decision: 'confirmed', choices };
  const confirmed = selectionOf(await rpc.call('tools/call', { name: 'confirm_stage_selection', arguments: args }));
  assert.equal(confirmed.status, 'confirmed');
  assert.ok(confirmed.stages.every(stage => stage.modelKey === 'model-b'));
  assert.equal(typeof confirmed.decidedAt, 'number');
  assert.deepEqual(selectionOf(await rpc.call('tools/call', { name: 'get_stage_selection', arguments: { selectionId: pending.selectionId } })), confirmed);
  assert.deepEqual(selectionOf(await rpc.call('tools/call', { name: 'confirm_stage_selection', arguments: args })), confirmed);
  toolError(await rpc.call('tools/call', { name: 'confirm_stage_selection', arguments: { ...args, decision: 'cancelled' } }));
  await rpc.close();
});

test('real stdio cancellation and all-off confirmation remain distinct and isolated', async t => {
  const rpc = session(t);
  const input = fixture();
  input.stages.forEach(stage => { stage.required = false; });
  const first = selectionOf(await rpc.call('tools/call', { name: 'open_stage_selector', arguments: input }));
  const second = selectionOf(await rpc.call('tools/call', { name: 'open_stage_selector', arguments: input }));
  for (const [selection, decision] of [[first, 'cancelled'], [second, 'confirmed']]) {
    const result = selectionOf(await rpc.call('tools/call', { name: 'confirm_stage_selection', arguments: {
      selectionId: selection.selectionId, decision,
      choices: selection.stages.map(stage => ({ stageId: stage.id, enabled: false, modelKey: 'model-b' })),
    } }));
    assert.equal(result.status, decision);
    assert.ok(result.stages.every(stage => !stage.enabled));
  }
  await rpc.close();
});

test('invalid tool inputs return isError, not fake success or stack traces; later calls survive', () => {
  const extra = { ...fixture(), extra: true };
  const prototype = JSON.parse(JSON.stringify(fixture()).replace('"taskId":', '"__proto__":{"polluted":true},"taskId":'));
  const responses = transcript([
    request(1, 'tools/call', { name: 'open_stage_selector', arguments: extra }),
    request(2, 'tools/call', { name: 'open_stage_selector', arguments: prototype }),
    request(3, 'tools/call', { name: 'get_stage_selection', arguments: { selectionId: 'missing' } }),
    request(4, 'tools/call', { name: 'get_stage_selection', arguments: { selectionId: 'missing', decision: 'confirmed' } }),
    request(5, 'tools/call', { name: 'confirm_stage_selection', arguments: { selectionId: 'missing', decision: 'confirmed', choices: [] } }),
    request(6, 'tools/call', { name: 'model_confirm_selection', arguments: {} }),
    request(7, 'tools/call', { name: 'open_stage_selector', arguments: null }),
    request(8, 'tools/call', { name: 'open_stage_selector', arguments: [] }),
    request(9, 'tools/call', { name: 'open_stage_selector', arguments: fixture() }),
  ]);
  responses.slice(0, 8).forEach(toolError);
  assert.equal(selectionOf(responses[8]).status, 'pending');
  assert.equal({}.polluted, undefined);
});

test('resources/list advertises the selector and dashboard inline resources with restrictive CSP', () => {
  const [response] = transcript([request(1, 'resources/list')]);
  const resources = response.result.resources;
  assert.equal(resources.length, 2);
  assert.equal(resources[0].uri, resourceUri);
  assert.equal(resources[0].mimeType, mimeType);
  assert.equal(resources[1].uri, 'ui://sdlc-selector/dashboard.html');
  assert.equal(resources[1].mimeType, mimeType);
});

test('resources/read injects the entire local script verbatim except script-end escaping', async t => {
  let html, script;
  try {
    [html, script] = await Promise.all([
      readFile(new URL('../app/index.html', import.meta.url), 'utf8'),
      readFile(new URL('../app/app.js', import.meta.url), 'utf8'),
    ]);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('主会话尚未提供 app/index.html 和 app/app.js；不创建替代前端文件');
    return;
  }
  assert.ok(html.includes('/* APP_SCRIPT */'), 'frontend must contain script placeholder');
  const [response] = transcript([request(1, 'resources/read', { uri: resourceUri })]);
  assert.equal(response.error, undefined);
  assert.equal(response.result.contents.length, 1);
  const content = response.result.contents[0];
  assert.equal(content.uri, resourceUri);
  assert.equal(content.mimeType, mimeType);
  assert.equal(content.text, html.replace('/* APP_SCRIPT */', () => script.replace(/<\/script/gi, match => '<\\/' + match.slice(2))));
  assert.deepEqual(content._meta['qoder/ui'], { availableDisplayModes: ['inline'], preferredDisplayMode: 'inline' });
  assert.deepEqual(content._meta.csp, { connectDomains: [], resourceDomains: [] });
});

test('open_stage_dashboard stores data in-process and resources/read renders the inline dashboard', async t => {
  const rpc = session(t);
  const dashboard = {
    taskId: 'task-1', planVersion: 'v3', currentStageIndex: 0,
    stages: [{
      id: 'solution-designer', title: '方案设计', status: 'READY_FOR_APPROVAL', color: 'ok',
      summary: '设计摘要', artifacts: [['docs/design.md', '设计文档']], decisions: ['决策一'],
      matrix: [['AC-1', '登录', 'ok', 'PASS']], risks: ['风险一'], next: '派发实现',
    }],
  };
  const call = await rpc.call('tools/call', { name: 'open_stage_dashboard', arguments: dashboard });
  assert.equal(call.error, undefined);
  assert.equal(call.result.isError, undefined);
  const uri = call.result._meta.ui.resourceUri;
  assert.ok(uri.startsWith('ui://sdlc-selector/dashboard.html?ref='));
  const read = await rpc.call('resources/read', { uri });
  assert.equal(read.error, undefined);
  const content = read.result.contents[0];
  assert.equal(content.uri, uri);
  assert.equal(content.mimeType, mimeType);
  assert.match(content.text, /__SDLC_DASHBOARD__/);
  assert.match(content.text, /设计摘要/);
  assert.match(content.text, /docs\/design\.md/);
  await rpc.close();
});

test('open_stage_dashboard rejects invalid data and missing refs', () => {
  const [invalid] = transcript([request(1, 'tools/call', { name: 'open_stage_dashboard', arguments: { taskId: 't', planVersion: 'v', currentStageIndex: 0, stages: [] } })]);
  toolError(invalid);
  const [missing] = transcript([request(1, 'resources/read', { uri: 'ui://sdlc-selector/dashboard.html?ref=nope' })]);
  assert.equal(missing.error.code, -32603);
});

test('rendering escapes case-insensitive script terminators without replacement-token interpolation', async () => {
  let renderAppHtml;
  try { ({ renderAppHtml } = await import(serverUrl)); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  assert.equal(typeof renderAppHtml, 'function', 'renderer must exist without starting stdio on import');
  const script = 'const text = "</script><ScRiPt> </ScRiPt> $& $` $\'";';
  assert.equal(renderAppHtml('<script>/* APP_SCRIPT */</script>', script), '<script>' + script.replace(/<\/script/gi, match => '<\\/' + match.slice(2)) + '</script>');
  assert.throws(() => renderAppHtml('<html>missing</html>', script), /占位|APP_SCRIPT/);
});

test('resources/read rejects arbitrary URIs and extra paths rather than reading files', () => {
  for (const params of [{ uri: 'file:///etc/passwd' }, { uri: 'https://example.com' }, { uri: resourceUri + '?path=../server.mjs' }, { uri: resourceUri, path: '../server.mjs' }]) {
    const [response] = transcript([request(1, 'resources/read', params)]);
    assert.equal(response.error.code, -32602);
  }
});

test('unknown methods, malformed envelopes and invalid JSON produce protocol errors without crashing', () => {
  const input = [
    '{broken json', JSON.stringify(request(1, 'not/a/method')),
    JSON.stringify({ jsonrpc: '1.0', id: 2, method: 'ping' }),
    JSON.stringify({ jsonrpc: '2.0', id: false, method: 'ping' }),
    'null', '[]', JSON.stringify(request(3, 'tools/list', [])), JSON.stringify(request(4, 'ping')),
  ].join('\n') + '\n';
  const responses = transcript(input, { raw: true });
  assert.deepEqual(responses.slice(0, 7).map(response => response.error.code), [-32700, -32601, -32600, -32600, -32600, -32600, -32602]);
  assert.deepEqual(responses[7], { jsonrpc: '2.0', id: 4, result: {} });
});

test('notifications produce neither responses nor mutations; EOF flushes an unterminated final line', () => {
  const notifications = Array.from({ length: 101 }, () => ({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'open_stage_selector', arguments: fixture() } }));
  const input = [{ jsonrpc: '2.0', method: 'notifications/initialized' }, ...notifications,
    request(1, 'tools/call', { name: 'open_stage_selector', arguments: fixture() }), request(2, 'ping'),
  ].map(message => JSON.stringify(message)).join('\n');
  const responses = transcript(input, { raw: true });
  assert.equal(responses.length, 2);
  assert.equal(selectionOf(responses[0]).status, 'pending');
  assert.deepEqual(responses[1].result, {});
});

test('accepts exactly 256KiB and rejects oversized lines with or without newline, then recovers', () => {
  const ping = JSON.stringify(request(1, 'ping'));
  const boundary = ping + ' '.repeat(limit - Buffer.byteLength(ping));
  assert.equal(transcript(boundary + '\n', { raw: true })[0].id, 1);
  for (const suffix of ['', '\n' + JSON.stringify(request(2, 'ping')) + '\n']) {
    const responses = transcript('x'.repeat(limit + 1) + suffix, { raw: true });
    assert.equal(responses[0].error.code, -32600);
    assert.match(responses[0].error.message, /256|输入|限制/);
    assert.equal(responses.length, suffix ? 2 : 1);
    if (suffix) assert.deepEqual(responses[1], { jsonrpc: '2.0', id: 2, result: {} });
  }
  const multibyte = JSON.stringify(request(3, 'ping', { padding: '中'.repeat(100000) }));
  assert.ok(multibyte.length < limit && Buffer.byteLength(multibyte) > limit);
  assert.equal(transcript(multibyte + '\n', { raw: true })[0].error.code, -32600);
});

test('empty stdin exits cleanly without protocol noise', () => {
  assert.deepEqual(transcript('', { raw: true }), []);
});
