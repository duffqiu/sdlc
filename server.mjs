import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SelectionError, SelectionStore, selectionSchemas, validateSchema } from './selection-store.mjs';
import { DashboardError, DashboardStore } from './dashboard-store.mjs';

const resourceUri = 'ui://sdlc-selector/main.html';
const dashboardUri = 'ui://sdlc-selector/dashboard.html';
const mimeType = 'text/html;profile=mcp-app';
const maxLineBytes = 256 * 1024;
const supportedVersions = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const resourceMeta = {
  'qoder/ui': { availableDisplayModes: ['inline'], preferredDisplayMode: 'inline' },
  csp: { connectDomains: [], resourceDomains: [] },
};
const dashboardInputSchema = {
  type: 'object',
  required: ['taskId', 'planVersion', 'currentStageIndex', 'stages'],
  additionalProperties: false,
  properties: {
    taskId: { type: 'string', minLength: 1, maxLength: 200, description: '主会话当前任务 ID；仅用于仪表盘标识。' },
    planVersion: { type: 'string', minLength: 1, maxLength: 100, description: '当前拆解计划版本；用于标识产物快照。' },
    currentStageIndex: { type: 'integer', minimum: 0, description: '当前推进环节在 stages 中的下标，从 0 开始。' },
    stages: { type: 'array', minItems: 1, maxItems: 10, description: '按流程顺序排列的环节数据；服务会校验每项结构。' },
  },
};

const tools = [
  {
    name: 'open_stage_selector', title: '选择任务环节与模型',
    description: '用主会话从实时 Qoder 目录筛选的 models 和任务环节创建待确认草稿并展示 inline 选择器。默认勾选和推荐模型不表示批准；本服务不访问目录、不验证外部资格、不启动任务。',
    inputSchema: selectionSchemas.open,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri, visibility: ['model', 'app'] } },
  },
  {
    name: 'open_stage_dashboard', title: '打开环节产物仪表盘',
    description: '用主会话传入的当前环节数据生成 inline 仪表盘，与 Markdown 模板互为补充。本服务不启动任务，仅渲染可视化视图；渲染失败时主会话回退到 Markdown 模板。',
    inputSchema: dashboardInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'get_stage_selection', title: '读取任务环节选择',
    description: '按 selectionId 读取草稿或已确认、已取消的选择结果。读取不会确认、延长有效期或启动任务；记录缺失或过期时返回错误，不恢复草稿。',
    inputSchema: selectionSchemas.read,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
  {
    name: 'confirm_stage_selection', title: '提交确认或取消',
    description: '仅供 App 在用户明确点击确认或取消后提交全部环节选择。相同决定和选择重试幂等；终态不可改写。只记录选择，不启动任务；App 可随后将结果回传主会话。',
    inputSchema: selectionSchemas.decide,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // Visibility is enforced by the host. Stdio does not attest the caller's role.
    _meta: { ui: { visibility: ['app'] } },
  },
];

export function renderAppHtml(html, script) {
  if (html.split('/* APP_SCRIPT */').length !== 2) throw new SelectionError('页面必须包含一个 APP_SCRIPT 占位符。');
  const safeScript = script.replace(/<\/script/gi, match => '<\\/' + match.slice(2));
  // A function replacement preserves $&, $` and $' in the complete script.
  return html.replace('/* APP_SCRIPT */', () => safeScript);
}

export function renderDashboardHtml(html, script, data) {
  if (html.split('/* DASHBOARD_DATA */').length !== 2) throw new SelectionError('仪表盘页面必须包含一个 DASHBOARD_DATA 占位符。');
  if (html.split('/* APP_SCRIPT */').length !== 2) throw new SelectionError('仪表盘页面必须包含一个 APP_SCRIPT 占位符。');
  const safeData = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const safeScript = script.replace(/<\/script/gi, match => '<\\/' + match.slice(2));
  return html
    .replace('/* DASHBOARD_DATA */', () => `<script>window.__SDLC_DASHBOARD__ = ${safeData};</script>`)
    .replace('/* APP_SCRIPT */', () => safeScript);
}

function selectionResult(selection) {
  const statusText = {
    pending: '待确认：推荐值不是批准，尚未启动任何任务。',
    confirmed: '已确认选择；本服务未启动任何任务。',
    cancelled: '已取消选择；本服务未启动任何任务。',
  };
  return { content: [{ type: 'text', text: statusText[selection.status] }], structuredContent: { selection } };
}
const failureResult = error => ({
  isError: true,
  content: [{ type: 'text', text: (error instanceof SelectionError || error instanceof DashboardError) ? error.message : '操作失败，请核对输入后重试；本服务未启动任务。' }],
});
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
function rejectUnsafeKeys(value) {
  // Iterative traversal is bounded by the 256KiB frame, not the JS call stack.
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (item === null || typeof item !== 'object') continue;
    for (const key of Object.keys(item)) {
      if (unsafeKeys.has(key)) throw new SelectionError('参数含不允许的原型键。');
      const child = item[key];
      if (child !== null && typeof child === 'object') stack.push(child);
    }
  }
}

async function handle(request, store, dashboards) {
  const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!isObject(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return error(null, -32600, '无效 JSON-RPC 请求。');
  // No replies or mutations for notifications, including accidental tools/call notifications.
  if (!Object.hasOwn(request, 'id')) return undefined;
  const { id, method } = request;
  if (typeof id !== 'string' && !(typeof id === 'number' && Number.isFinite(id))) return error(null, -32600, '无效请求 ID。');
  if (Object.keys(request).some(key => unsafeKeys.has(key))) return error(id, -32600, '请求含不允许的原型键。');
  const params = Object.hasOwn(request, 'params') ? request.params : {};
  if (!isObject(params)) return error(id, -32602, 'params 必须是对象。');
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => error(id, code, message);
  try { rejectUnsafeKeys(params); }
  catch (validationError) {
    return method === 'tools/call' ? ok(failureResult(validationError)) : fail(-32602, validationError.message);
  }
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: supportedVersions.includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'sdlc-agent-orchestrator', version: '0.6.3' },
      });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools });
    case 'resources/list':
      return ok({ resources: [
        { uri: resourceUri, name: '任务环节与模型选择器', mimeType, _meta: resourceMeta },
        { uri: dashboardUri, name: '环节产物仪表盘', mimeType, _meta: resourceMeta },
      ] });
    case 'resources/read': {
      const allowedKeys = Object.keys(params).every(key => key === 'uri' || key === '_meta');
      if (!allowedKeys) return fail(-32602, 'resources/read 只允许传入 uri 和 _meta。');
      if (params.uri === resourceUri) {
        try {
          const [html, script] = await Promise.all([
            readFile(new URL('./app/index.html', import.meta.url), 'utf8'),
            readFile(new URL('./app/app.js', import.meta.url), 'utf8'),
          ]);
          return ok({ contents: [{ uri: resourceUri, mimeType, text: renderAppHtml(html, script), _meta: resourceMeta }] });
        } catch {
          return fail(-32603, '选择器资源不可用，请检查插件 app/index.html、app/app.js 及 APP_SCRIPT 占位符。');
        }
      }
      if (typeof params.uri === 'string' && params.uri.startsWith(dashboardUri)) {
        try {
          const url = new URL(params.uri, 'http://localhost');
          const ref = url.searchParams.get('ref');
          if (!ref) return fail(-32602, '仪表盘资源缺少 ref 参数。');
          const data = dashboards.get(ref);
          const [html, script] = await Promise.all([
            readFile(new URL('./app/dashboard.html', import.meta.url), 'utf8'),
            readFile(new URL('./app/dashboard.js', import.meta.url), 'utf8'),
          ]);
          return ok({ contents: [{ uri: params.uri, mimeType, text: renderDashboardHtml(html, script, data), _meta: resourceMeta }] });
        } catch (error) {
          return fail(-32603, error instanceof DashboardError ? error.message : '仪表盘资源不可用，请检查插件 app/dashboard.html、app/dashboard.js 及占位符。');
        }
      }
      return fail(-32602, '只允许读取本插件固定的选择器或仪表盘资源。');
    }
    case 'tools/call': {
      try {
        if (Object.keys(params).some(key => !['name', 'arguments', '_meta'].includes(key))) throw new SelectionError('工具调用含不允许的额外字段。');
        const args = Object.hasOwn(params, 'arguments') ? params.arguments : {};
        switch (params.name) {
          case 'open_stage_selector': return ok(selectionResult(store.create(args)));
          case 'open_stage_dashboard': {
            const { ref } = dashboards.put(args);
            const uri = `${dashboardUri}?ref=${encodeURIComponent(ref)}`;
            return ok({ content: [{ type: 'text', text: '仪表盘已生成；inline 资源将展示当前环节产物。' }], _meta: { ui: { resourceUri: uri } } });
          }
          case 'get_stage_selection':
            validateSchema(selectionSchemas.read, args);
            return ok(selectionResult(store.get(args.selectionId)));
          case 'confirm_stage_selection': return ok(selectionResult(store.decide(args)));
          default: throw new SelectionError('未知工具；只支持打开选择器、打开产物仪表盘、读取选择、App 提交确认或取消。');
        }
      } catch (toolError) { return ok(failureResult(toolError)); }
    }
    default: return fail(-32601, '不支持此方法。');
  }
}

async function serveStdio() {
  const store = new SelectionStore();
  const dashboards = new DashboardStore();
  // Await writes and requests in arrival order: bounded output queue and atomic
  // decisions even when multiple frames arrive together or stdin ends during I/O.
  const reply = message => new Promise((resolve, reject) => {
    process.stdout.write(JSON.stringify(message) + '\n', error => error ? reject(error) : resolve());
  });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const processLine = async line => {
    let request;
    try {
      const text = decoder.decode(line);
      if (!text.trim()) return;
      request = JSON.parse(text);
    } catch {
      await reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '无效 JSON 或 UTF-8 输入。' } });
      return;
    }
    let response;
    try { response = await handle(request, store, dashboards); }
    catch {
      if (isObject(request) && !Object.hasOwn(request, 'id')) return;
      response = { jsonrpc: '2.0', id: typeof request?.id === 'string' || typeof request?.id === 'number' ? request.id : null, error: { code: -32603, message: '请求处理失败，请核对输入后重试。' } };
    }
    if (response !== undefined) await reply(response);
  };
  let fragments = [];
  let length = 0;
  let discarding = false;
  for await (const chunk of process.stdin) {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline === -1 ? chunk.length : newline;
      const part = chunk.subarray(offset, end);
      if (!discarding) {
        if (length + part.length > maxLineBytes) {
          fragments = [];
          length = 0;
          discarding = true;
          await reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: '单行输入超过 256KiB 限制，已丢弃。' } });
        } else if (part.length) {
          fragments.push(part);
          length += part.length;
        }
      }
      if (newline !== -1) {
        if (!discarding) await processLine(Buffer.concat(fragments, length));
        fragments = [];
        length = 0;
        discarding = false;
      }
      offset = newline === -1 ? chunk.length : newline + 1;
    }
  }
  if (!discarding && length > 0) await processLine(Buffer.concat(fragments, length));
  // No timers or persistent handles: EOF naturally exits after pending replies.
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // A closed client pipe must not emit an unhandled error or a stack trace.
  process.stdout.on('error', () => { process.stdin.destroy(); });
  try { await serveStdio(); }
  catch { process.exitCode = 1; }
}
