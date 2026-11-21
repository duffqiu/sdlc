const colors = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", pending: "var(--pending)" };

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render() {
  const payload = window.__SDLC_DASHBOARD__ || {};
  const { taskId = '-', planVersion = '-', currentStageIndex = 0, stages = [] } = payload;
  let viewingIndex = currentStageIndex;
  if (typeof window.__SDLC_VIEW_INDEX__ === 'number') viewingIndex = window.__SDLC_VIEW_INDEX__;

  const app = document.getElementById('app');
  if (!stages.length) {
    app.innerHTML = `<div class="empty">暂无环节数据</div>`;
    return;
  }

  const s = stages[viewingIndex];
  const isCurrent = viewingIndex === currentStageIndex;

  const timeline = stages.map((stage, i) => {
    const state = i < currentStageIndex ? 'done' : i === currentStageIndex ? 'current' : 'upcoming';
    const tick = state === 'done' ? '✓' : '';
    return `
      <div class="timeline-step ${state}" data-idx="${i}">
        <div class="dot">${tick}</div>
        <div class="step-label">${esc(stage.title)}</div>
        <div class="step-status">${i === currentStageIndex ? '当前' : state === 'done' ? '已完成' : '待开始'}</div>
      </div>
    `;
  }).join('');

  app.innerHTML = `
    <header>
      <h1>SDLC 环节产物仪表盘</h1>
      <div class="meta">TASK ${esc(taskId)} · planVersion ${esc(planVersion)} · 当前环节：${esc(stages[currentStageIndex]?.title || '-')}</div>
    </header>

    <nav class="timeline">${timeline}</nav>

    <main class="detail">
      <div class="detail-grid">
        <section class="card ${esc(s.color)}">
          <h2>${isCurrent ? '当前环节' : '回看'}：${esc(s.title)} <span class="badge" style="color:${colors[s.color]}">${esc(s.status)}</span></h2>
          <p class="summary">${esc(s.summary)}</p>
          <div class="kicker">产物位置 / Artifacts</div>
          <ul class="artifact-list">
            ${s.artifacts.length ? s.artifacts.map(([p, d]) => `
              <li><span style="color:${colors[s.color]}">●</span> <a href="#">${esc(p)}</a> <span style="color:var(--muted)">— ${esc(d)}</span></li>
            `).join('') : `<li style="color:var(--muted)">本环节暂无文件产物</li>`}
          </ul>
          ${s.decisions.length ? `
            <div class="kicker">关键决策 / Key Decisions</div>
            <ul class="risk-list">${s.decisions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
          ` : ''}
        </section>

        <section class="card ${esc(s.color)}">
          <div class="kicker">AC / DoD 核验摘要</div>
          <table class="matrix">
            <thead><tr><th>编号</th><th>条目</th><th>结果</th></tr></thead>
            <tbody>
              ${s.matrix.map(([id, name, c, res]) => `
                <tr><td>${esc(id)}</td><td>${esc(name)}</td><td class="result" style="color:${colors[c]}">${esc(res)}</td></tr>
              `).join('')}
            </tbody>
          </table>
          ${s.risks.length ? `
            <div class="kicker" style="margin-top:18px">风险与待确认 / Risks & Open</div>
            <ul class="risk-list">${s.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
          ` : ''}
          <div class="action"><strong>下一步 / Next</strong><span>${esc(s.next)}</span></div>
        </section>
      </div>
    </main>

    <footer>
      <span>上游产物未展示不得继续 · 主会话统一调度</span>
      <span>SDLCI 0.6.2</span>
    </footer>
  `;

  app.querySelectorAll('.timeline-step').forEach(el => {
    el.addEventListener('click', () => {
      window.__SDLC_VIEW_INDEX__ = +el.dataset.idx;
      render();
    });
  });
}

function setupMessaging() {
  let initialized = false;
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.method === 'ui/initialize' && msg.id !== undefined) {
      initialized = true;
      event.source.postMessage({ jsonrpc: '2.0', id: msg.id, result: { initialized: true } }, event.origin);
      render();
      return;
    }
    if (msg.method === 'host-context-changed' && initialized) {
      if (msg.params && msg.params.dashboard) {
        window.__SDLC_DASHBOARD__ = msg.params.dashboard;
        window.__SDLC_VIEW_INDEX__ = msg.params.dashboard.currentStageIndex;
        render();
      }
    }
  });
}

setupMessaging();
render();
