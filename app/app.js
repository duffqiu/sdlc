'use strict';
const elements = Object.fromEntries(['status', 'badge', 'task-title', 'catalog', 'stage-body', 'empty', 'summary', 'confirm', 'cancel', 'refresh', 'selection-form'].map(id => [id, document.querySelector(`#${id}`)]));
const pending = new Map();
let sequence = 0;
let ready = false;
let closed = false;
let busy = false;
let uncertain = false;
let dirty = false;
let initiallyRefreshed = false;
let selection = null;
let rows = [];
let host = {};
let context = {};
let expiryTimer;
const canRead = () => ready && Boolean(host.serverTools);
const canSubmit = () => canRead() && Boolean(host.message?.text);
const expired = () => selection && Date.now() >= selection.expiresAt;
const locked = () => closed || busy || uncertain || !canSubmit() || !selection || expired() || selection.status !== 'pending';
const send = message => window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');
function report(text, error = false) {
  elements.status.textContent = text;
  elements.status.dataset.error = String(error);
  resize();
}
function request(method, params) {
  if (closed || pending.size >= 8) return Promise.reject(new Error('卡片已关闭或繁忙，请返回主会话。'));
  const id = `sdlc-ui-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('结果尚未确认，请在主会话检查。不要重复提交。'));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    try { send({ id, method, params }); }
    catch { clearTimeout(timer); pending.delete(id); reject(new Error('无法确认发送结果，请在主会话检查。')); }
  });
}
function resize() {
  if (!closed && context.displayMode === 'inline') {
    const height = Math.ceil(document.querySelector('main').getBoundingClientRect().height);
    if (height > 0) send({ method: 'ui/notifications/size-changed', params: { height } });
  }
}
function applyContext(value) {
  context = { ...context, ...value };
  if (['light', 'dark'].includes(context.theme)) document.documentElement.dataset.theme = context.theme;
  resize();
}
function controls() {
  const disabled = Boolean(locked());
  elements.confirm.disabled = disabled;
  elements.cancel.disabled = disabled;
  elements.confirm.hidden = ready && !canSubmit();
  elements.cancel.hidden = ready && !canSubmit();
  elements.refresh.disabled = closed || busy || !canRead() || !selection;
  for (const item of rows) {
    item.checkbox.disabled = disabled || item.stage.required;
    item.select.disabled = disabled || !item.stage.enabled;
    item.row.dataset.enabled = String(item.stage.enabled);
  }
  const count = selection?.stages.filter(stage => stage.enabled).length ?? 0;
  elements.summary.textContent = selection ? `已选 ${count} / ${selection.stages.length} 个环节` : '尚未执行任何任务';
  elements.confirm.textContent = count ? '确认并继续' : '确认不执行任何环节';
  if (selection) elements.badge.textContent = expired() ? '已过期' : ({ pending: '等待确认', confirmed: '已确认', cancelled: '已取消' }[selection.status]);
}
function validate(value) {
  if (!value || typeof value.selectionId !== 'string' || typeof value.taskSummary !== 'string' ||
      !['pending', 'confirmed', 'cancelled'].includes(value.status) || !Number.isSafeInteger(value.expiresAt) ||
      !Array.isArray(value.models) || !value.models.length || value.models.length > 100 ||
      !Array.isArray(value.stages) || !value.stages.length || value.stages.length > 6) throw new Error('选择数据不完整，请让主会话重新生成卡片。');
  const keys = new Set();
  for (const model of value.models) {
    if (typeof model.modelKey !== 'string' || typeof model.displayName !== 'string' || model.enabled !== true || keys.has(model.modelKey)) throw new Error('模型列表无效，请返回主会话刷新目录。');
    keys.add(model.modelKey);
  }
  const ids = new Set();
  for (const stage of value.stages) {
    if (typeof stage.id !== 'string' || typeof stage.label !== 'string' || typeof stage.reason !== 'string' ||
        typeof stage.enabled !== 'boolean' || typeof stage.required !== 'boolean' ||
        !keys.has(stage.modelKey) || !keys.has(stage.recommendedModelKey) || ids.has(stage.id)) throw new Error('环节或推荐模型无效，请让主会话重新生成卡片。');
    ids.add(stage.id);
  }
}
function node(tag, text, className) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}
function modelDetail(stage) {
  const model = selection.models.find(item => item.modelKey === stage.modelKey);
  const cost = typeof model.priceFactor === 'number' ? `费用系数 ${model.priceFactor}×` : '费用未提供';
  const windowSize = Number.isSafeInteger(model.maxInputTokens) ? ` · 输入上限 ${model.maxInputTokens.toLocaleString()} tokens` : '';
  return `${cost}${windowSize}`;
}
function render(result) {
  if (result?.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text || '无法读取选择状态。');
  const value = result?.structuredContent?.selection;
  validate(value);
  if (selection && selection.selectionId !== value.selectionId) throw new Error('该结果不属于当前卡片，请返回主会话确认。');
  const edits = dirty && selection?.status === 'pending' && value.status === 'pending' ? new Map(selection.stages.map(stage => [stage.id, { enabled: stage.enabled, modelKey: stage.modelKey }])) : null;
  selection = JSON.parse(JSON.stringify(value));
  if (edits) for (const stage of selection.stages) Object.assign(stage, edits.get(stage.id));
  if (selection.status !== 'pending') dirty = false;
  elements['task-title'].textContent = selection.taskSummary;
  const time = Number.isSafeInteger(selection.catalogFetchedAt) ? new Date(selection.catalogFetchedAt).toLocaleString('zh-CN') : '时间未知';
  elements.catalog.textContent = `${selection.targetLabel} · 目录获取于 ${time}`;
  elements.empty.hidden = true;
  rows = [];
  elements['stage-body'].replaceChildren();
  for (const stage of selection.stages) {
    const row = node('tr');
    const checkCell = node('td');
    const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = stage.enabled;
    checkbox.setAttribute('aria-label', `执行${stage.label}`);
    checkCell.append(checkbox);
    const stageCell = node('td');
    const label = node('span', stage.label, 'stage-name');
    stageCell.append(label);
    if (stage.required) stageCell.append(node('span', '必需', 'required'));
    stageCell.append(node('div', stage.reason, 'reason'));
    const modelCell = node('td');
    const select = node('select'); select.setAttribute('aria-label', `${stage.label}模型`);
    for (const model of selection.models) {
      const option = node('option', model.displayName + (model.modelKey === stage.recommendedModelKey ? '（推荐）' : ''));
      option.value = model.modelKey; select.append(option);
    }
    select.value = stage.modelKey;
    const detail = node('p', modelDetail(stage), 'model-detail');
    checkbox.addEventListener('change', () => {
      if (locked() || stage.required) { checkbox.checked = stage.enabled; return; }
      stage.enabled = checkbox.checked; dirty = true; controls();
    });
    select.addEventListener('change', () => {
      if (locked() || !stage.enabled) return;
      if (!selection.models.some(model => model.modelKey === select.value)) { select.value = stage.modelKey; return; }
      stage.modelKey = select.value; dirty = true; detail.textContent = modelDetail(stage); controls(); resize();
    });
    modelCell.append(select, detail); row.append(checkCell, stageCell, modelCell);
    elements['stage-body'].append(row); rows.push({ row, checkbox, select, stage });
  }
  clearTimeout(expiryTimer);
  if (!expired()) expiryTimer = setTimeout(() => { controls(); report('这张选择卡片已过期，请让主会话重新生成。', true); }, selection.expiresAt - Date.now());
  controls(); resize();
}
function describeState() {
  if (!canSubmit()) return '当前宿主不支持向主会话回传确认，此卡片仅供查看；请回到本地主会话处理。';
  if (expired()) return '这张选择卡片已过期，请让主会话重新生成。';
  if (selection?.status === 'confirmed') return '这张卡片已确认。请在主会话查看后续处理，不要重复提交。';
  if (selection?.status === 'cancelled') return '这张卡片已取消，不会授权执行任务。';
  return '推荐模型已预选。调整后点击“确认并继续”，当前尚未授权执行。';
}
async function refresh() {
  if (!canRead() || closed || busy || !selection) return;
  busy = true; controls();
  try {
    const result = await request('tools/call', { name: 'get_stage_selection', arguments: { selectionId: selection.selectionId } });
    if (closed) return;
    render(result); uncertain = false; report(describeState(), Boolean(expired()));
  } catch (error) {
    if (!closed) { uncertain = true; report(`无法确认选择状态：${error.message} 请在主会话检查。`, true); }
  } finally { busy = false; controls(); }
}
function initialRefresh() {
  if (!initiallyRefreshed && canRead() && selection) { initiallyRefreshed = true; void refresh(); }
}
async function decide(decision) {
  if (locked()) return;
  busy = true; controls(); report('正在记录你的选择…');
  const choices = selection.stages.map(stage => ({ stageId: stage.id, enabled: stage.enabled, modelKey: stage.modelKey }));
  try {
    const result = await request('tools/call', { name: 'confirm_stage_selection', arguments: { selectionId: selection.selectionId, decision, choices } });
    if (closed) return;
    render(result);
    if (selection.status !== decision) throw new Error('决定状态不匹配。');
    report('选择已记录，正在交回主会话…');
    const receipt = { selectionId: selection.selectionId, taskId: selection.taskId, decision: selection.status,
      choices: selection.stages.map(stage => ({ stageId: stage.id, enabled: stage.enabled, modelKey: stage.modelKey })) };
    const text = `SDLC_SELECTION_RESULT\n${JSON.stringify(receipt)}\n这是我在开发环节选择卡片中提交的决定。请读取对应选择记录核对状态；只有确认且启用的环节才可在条件具备后派发，取消不得启动任务。`;
    const outcome = await request('ui/message', { role: 'user', content: [{ type: 'text', text }], _meta: { 'qoder/message': { target: 'active', send: true } } });
    if (outcome?.isError) throw new Error('宿主未确认消息处理结果。');
    if (!closed) report(decision === 'confirmed' ? '选择已交回主会话，等待主会话核对和调度。' : '取消决定已交回主会话。');
  } catch (error) {
    if (!closed) { uncertain = true; report(`提交结果尚未确认：${error.message} 请在主会话检查，不要重复提交。`, true); }
  } finally { busy = false; controls(); resize(); }
}
function receive(event) {
  if (closed || event.source !== window.parent) return;
  const message = event.data;
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return;
  if (!message.method && pending.has(message.id)) {
    if (!('result' in message) && !('error' in message)) return;
    const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error('宿主返回未完成或未知结果。'));
    else item.resolve(message.result);
    return;
  }
  if (message.method === 'ui/notifications/tool-result') {
    try { render(message.params); report(describeState(), Boolean(expired())); initialRefresh(); }
    catch (error) { uncertain = true; controls(); report(error.message, true); }
  } else if (message.method === 'ui/notifications/host-context-changed') {
    applyContext(message.params ?? {});
  } else if (message.method === 'ui/notifications/tool-cancelled') {
    uncertain = true; controls(); report('操作已取消，请回到主会话检查状态。', true);
  } else if (message.id !== undefined) {
    if (message.method === 'ping') send({ id: message.id, result: {} });
    else if (message.method === 'ui/resource-teardown') { send({ id: message.id, result: {} }); dispose(); }
    else send({ id: message.id, error: { code: -32601, message: 'Method not supported' } });
  }
}
const onSubmit = event => { event.preventDefault(); };
const onConfirm = () => { void decide('confirmed'); };
const onCancel = () => { void decide('cancelled'); };
const onRefresh = () => { void refresh(); };
function dispose() {
  if (closed) return;
  closed = true; clearTimeout(expiryTimer);
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('卡片已关闭。')); }
  pending.clear();
  window.removeEventListener('message', receive);
  window.removeEventListener('resize', resize);
  window.removeEventListener('pagehide', dispose);
  elements['selection-form'].removeEventListener('submit', onSubmit);
  elements.confirm.removeEventListener('click', onConfirm);
  elements.cancel.removeEventListener('click', onCancel);
  elements.refresh.removeEventListener('click', onRefresh);
  controls(); report('卡片已关闭。');
}
window.addEventListener('message', receive);
window.addEventListener('resize', resize);
window.addEventListener('pagehide', dispose);
elements['selection-form'].addEventListener('submit', onSubmit);
elements.confirm.addEventListener('click', onConfirm);
elements.cancel.addEventListener('click', onCancel);
elements.refresh.addEventListener('click', onRefresh);
controls();
if (window.parent === window) {
  report('请在 Qoder 中调用开发环节选择工具打开卡片，直接打开文件不会连接主会话。', true);
} else {
  request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'sdlc-selector', version: '0.6.2' }, appCapabilities: { availableDisplayModes: ['inline'] } }).then(result => {
    if (closed) return;
    if (result?.protocolVersion !== '2026-01-26') throw new Error('宿主不支持当前卡片协议。');
    host = result.hostCapabilities ?? {}; ready = true;
    applyContext(result.hostContext ?? {});
    send({ method: 'ui/notifications/initialized', params: {} });
    controls(); report(canSubmit() ? '已连接，等待本次任务的环节与模型…' : describeState());
    initialRefresh();
  }).catch(error => { if (!closed) report(error.message, true); });
}
