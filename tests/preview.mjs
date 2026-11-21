import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const port = 47832;
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let sequence = 0;
lines.on('line', line => {
  const response = JSON.parse(line);
  const item = pending.get(response.id);
  if (item) { pending.delete(response.id); clearTimeout(item.timer); item.resolve(response); }
});
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Test RPC timed out')); }, 5000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-preview', version: '1' } });
const models = [
  { modelKey: 'test-reason', displayName: 'A · 推荐推理模型（测试）', enabled: true, priceFactor: 0.5, maxInputTokens: 200000 },
  { modelKey: 'test-fast', displayName: 'B · 快速执行模型（测试）', enabled: true, priceFactor: 0.2, maxInputTokens: 128000 },
  { modelKey: 'test-review', displayName: 'C · 通用核验模型（测试）', enabled: true, priceFactor: null },
];
const stages = [
  { id: 'solution-designer', reason: '梳理退款规则与接口边界', enabled: true, required: false, recommendedModelKey: 'test-reason' },
  { id: 'implementation-engineer', reason: '实现订单退款及失败重试', enabled: true, required: false, recommendedModelKey: 'test-fast' },
  { id: 'acceptance-verifier', reason: '验证退款路径与权限隔离', enabled: true, required: false, recommendedModelKey: 'test-review' },
];
const resource = await rpc('resources/read', { uri: 'ui://sdlc-selector/main.html' });
const actualHtml = resource.result?.contents?.[0]?.text;
if (!actualHtml) throw new Error('The plugin did not return its UI resource');
const server = createServer(async (req, res) => {
  const reply = (status, type, body) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) return reply(403, 'text/plain', 'Forbidden');
  const url = new URL(req.url, origin);
  try {
    if (req.method === 'GET' && url.pathname === '/app') return reply(200, 'text/html; charset=utf-8', actualHtml);
    if (req.method === 'GET' && url.pathname === '/') {
      const mode = url.searchParams.get('mode') || 'normal';
      const requestModels = structuredClone(models);
      if (mode === 'hostile') requestModels[0].displayName = '<img src=x onerror=alert(1)>';
      const response = await rpc('tools/call', { name: 'open_stage_selector', arguments: {
        taskId: `preview-${sequence}`, taskSummary: '订单退款功能 · 执行前确认', targetLabel: '本地模拟目录（非真实模型）',
        catalogFetchedAt: Date.now(), models: requestModels, stages,
      } });
      const data = JSON.stringify({ initial: response.result, mode }).replaceAll('<', '\\u003c');
      return reply(200, 'text/html; charset=utf-8', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SDLC 卡片本地验证</title><style>body{margin:0;background:#edf0ed;font:12px system-ui;padding:18px}.shell{max-width:820px;margin:auto}p{color:#52615d}iframe{display:block;width:100%;height:680px;border:1px solid #cbd5cf;border-radius:10px;background:#fbfcfa}</style><div class="shell"><p>本地测试宿主 · 测试模型 · 不会创建 Qoder 会话</p><iframe title="开发环节模型选择" src="/app"></iframe></div><script>
      const {initial,mode}=${data};
      const frame=document.querySelector('iframe');window.messages=[];window.writes=[];window.rpcCalls=[];
      function deliver(message){frame.contentWindow.postMessage({jsonrpc:'2.0',...message},location.origin)}
      window.setTheme=theme=>deliver({method:'ui/notifications/host-context-changed',params:{theme}});
      window.addEventListener('message',async event=>{
        if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
        const {id,method,params}=event.data;
        if(method==='ui/initialize'){deliver({id,result:{protocolVersion:'2026-01-26',hostCapabilities:{serverTools:{},...(mode==='remote'?{}:{message:{text:{}}})},hostContext:{theme:'light',displayMode:'inline'}}});}
        else if(method==='ui/notifications/initialized')deliver({method:'ui/notifications/tool-result',params:initial});
        else if(method==='ui/notifications/size-changed')frame.style.height=Math.max(200,params.height)+'px';
        else if(method==='tools/call'){
          window.rpcCalls.push(params);if(params.name==='confirm_stage_selection')window.writes.push(params.arguments);
          const response=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});
          const result=await response.json();
          if(mode==='write-unknown'&&params.name==='confirm_stage_selection')deliver({id,error:{code:-32000,message:'simulated unknown write'}});
          else deliver({id,...(result.error?{error:result.error}:{result:result.result})});
        }
        else if(method==='ui/message'){
          window.messages.push(params);
          deliver(mode==='message-unknown'?{id,error:{code:-32000,message:'simulated unknown delivery'}}:{id,result:{}});
        }
      });
      </script></html>`);
    }
    if (req.method === 'POST' && url.pathname === '/rpc' && req.headers['content-type'] === 'application/json') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 262144) return reply(413, 'text/plain', 'Too large'); }
      const data = JSON.parse(body);
      if (data.method !== 'tools/call' || !['get_stage_selection', 'confirm_stage_selection'].includes(data.params?.name)) return reply(400, 'text/plain', 'Unsupported test call');
      return reply(200, 'application/json', JSON.stringify(await rpc(data.method, data.params)));
    }
    if (url.pathname === '/favicon.ico') return reply(204, 'text/plain', '');
    reply(404, 'text/plain', 'Not found');
  } catch (error) { reply(500, 'text/plain', error.message); }
});
server.listen(port, '127.0.0.1', () => console.log(`Preview: ${origin}`));
function close() { for (const item of pending.values()) clearTimeout(item.timer); lines.close(); child.stdin.end(); child.kill(); server.close(); }
process.on('SIGINT', close); process.on('SIGTERM', close);
