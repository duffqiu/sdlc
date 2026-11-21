import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../skills/sdlc-agent-orchestrator/', import.meta.url);
const skill = await readFile(new URL('SKILL.md', root), 'utf8');
const coordinator = await readFile(new URL('references/sdlc-orchestrator.md', root), 'utf8');
const runtime = await readFile(new URL('references/qoder-runtime.md', root), 'utf8');
const implementation = await readFile(new URL('references/implementation-engineer.md', root), 'utf8');
const selector = await readFile(new URL('references/selector-card.md', root), 'utf8');

for (const [name, text] of [['Skill', skill], ['主控', coordinator], ['运行接口', runtime]]) {
  test(`${name}: dispatch releases main turn and uses callbacks rather than waiting`, () => {
    assert.ok(text.includes('结束当前轮次'), '必须明确派发后结束当前轮次');
    assert.ok(text.includes('create_chat_session') && text.includes('send_message_to_chat_session'));
    assert.ok(text.includes('supervise'));
    assert.ok(text.includes('wait_chat_sessions') && text.includes('轮询'));
  });
}

test('new inputs and callback results retain separate task and session identities', () => {
  for (const field of ['taskId', 'selectionId', 'sessionId', 'sessionRef', '派发轮次']) assert.ok(skill.includes(field), field);
  for (const rule of ['新输入', '取消', '乱序', '重复', '不是用户输入或授权', '写入冲突']) assert.ok(skill.includes(rule), rule);
  assert.ok(skill.includes('不能用当前最新任务覆盖'));
});

test('callback continuation preserves host limits and does not manufacture background work', () => {
  for (const rule of ['宿主', '输入队列', '不修改', '回调能力', '后台轮询']) assert.ok(runtime.includes(rule), rule);
  assert.ok(runtime.includes('timeoutMs: 0'));
  assert.ok(runtime.includes('同轮创建'));
});

test('implementation decomposition is conditional, reuses design, and does not force another stage', () => {
  for (const rule of ['## 3.1 开发实现：拆解、并行与集成', '小任务不强制拆分', '已有方案', 'TASKS_READY', '只读拆解']) assert.ok(skill.includes(rule), rule);
  for (const field of ['subtaskId', 'planVersion', 'dependsOn', 'readScope', 'writeScope', 'operation']) assert.ok(skill.includes(field), field);
  assert.ok(implementation.includes('拆解、实现、集成'));
  assert.ok(implementation.includes('不得创建、复制、调度其他会话'));
  assert.ok(implementation.includes('只读拆解'));
});

test('one selected implementation stage can dispatch multiple sibling tasks on its confirmed model', () => {
  assert.ok(skill.includes('一个开发环节可以对应多个子任务会话'));
  assert.ok(skill.includes('沿用开发实现环节已确认的 modelKey'));
  assert.ok(selector.includes('开发实现仍只占一行'));
  assert.ok(selector.includes('不把子任务加入 stages'));
  assert.ok(selector.includes('subtaskId'));
  assert.ok(!selector.includes('同一选择ID只能处理一次派发'));
});

test('decomposed tasks are visualized to the user before the first implement session, including reused plans', () => {
  for (const rule of ['任务关系图', 'planVersion', 'dependsOn', '并行批次', 'Mermaid', '纯文本', '集成节点', '不是派发或预算授权', '共享文件']) assert.ok(skill.includes(rule), rule);
  for (const rule of ['用户可见', '独立的任务关系图消息', '不得只存在于', '复用已有有效拆解', '第一个 implement', '单任务串行']) assert.ok(skill.includes(rule), `可见性/触发: ${rule}`);
  assert.ok(skill.includes('无论拆解是新产出（TASKS_READY）还是复用'), '复用拆解也必须出图');
  assert.ok(skill.includes('在创建第一个 implement 子任务会话前'), '图必须出现在首个实现会话之前');
  for (const rule of ['任务关系图', '依赖图', 'Mermaid', '纯文本', 'planVersion', '用户可见', '不得只写进', '复用', '首个 implement', '单任务串行']) assert.ok(coordinator.includes(rule), `主控: ${rule}`);
  assert.ok(coordinator.includes('未向用户展示当前 planVersion 的图不得派发 implement'));
  assert.ok(implementation.includes('依赖图'));
  assert.ok(implementation.includes('用户可见回复中重绘'));
  assert.ok(implementation.includes('不得让图只存在于'));
});

test('parallel dispatch requires evidence-ready dependencies and nonconflicting reads and writes', () => {
  for (const rule of ['依赖已完成且证据有效', '读写冲突', '循环依赖', '默认最多同时运行 5 个', '总预算', '共享文件']) assert.ok(skill.includes(rule), rule);
  assert.ok(coordinator.includes('默认最多同时运行 5 个'));
  assert.ok(!skill.includes('默认最多同时运行 2 个'), '旧默认并发必须移除');
  assert.ok(!coordinator.includes('默认最多同时运行 2 个'), '主控旧默认并发必须移除');
  assert.ok(runtime.includes('subtaskId'));
  assert.ok(runtime.includes('不是 create_chat_session 的顶层参数'));
});

test('integration waits for all required subtasks and produces a single verified candidate', () => {
  for (const rule of ['全部必需子任务', '停止对集成候选的并发写入', '整体验证', '同一集成候选', '最后一个回调']) assert.ok(skill.includes(rule), rule);
  assert.ok(implementation.includes('集成模式'));
  assert.ok(implementation.includes('不能拼接局部 PASS'));
  assert.ok(skill.includes('subtaskId、operation、派发轮次'));
});

test('child sessions use only the title field with stage-task naming and keep prompt for work', () => {
  for (const rule of ['顶层 `title` 字段', '不放任何命名指令', '报告命名能力限制', '实际标题以可观察状态为准']) assert.ok(skill.includes(rule), `Skill: ${rule}`);
  for (const rule of ['title` 字段', 'prompt` 直接从业务任务', '报告命名能力限制']) assert.ok(coordinator.includes(rule), `主控: ${rule}`);
  for (const rule of ['title` |', '报告命名能力限制']) assert.ok(runtime.includes(rule), `运行接口: ${rule}`);
  assert.ok(!skill.includes('本会话命名为'), '不得再用 prompt 前置命名指令');
  assert.ok(!coordinator.includes('本会话命名为'), '主控不得再用 prompt 前置命名指令');
  assert.ok(!runtime.includes('本会话命名为'), '运行接口不得再用 prompt 前置命名指令');
});

test('main orchestrator prompt is packaged as plugin rules for session-level injection', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../.qoder-plugin/plugin.json', root), 'utf8'));
  assert.equal(manifest.rules, './rules/');
  const rule = await readFile(new URL('../../rules/sdlc-orchestrator.md', root), 'utf8');
  assert.equal(rule, coordinator, '插件规则必须与主控规范保持一致');
  for (const marker of ['主会话产物展示格式', '每次收到新用户输入', '子会话意外停止', 'open_stage_dashboard']) assert.ok(rule.includes(marker), marker);
  assert.ok(skill.includes('每轮用户输入先做任务对账'));
  assert.ok(skill.includes('rules/sdlc-orchestrator.md'));
  assert.ok(skill.includes('规则注入不等于修改宿主 system prompt'));
});

test('every new user input reconciles active tasks before handling new work', () => {
  for (const rule of ['每轮用户输入先做任务对账', '不能因为持续输入而跳过', '不能用最新输入覆盖或遗忘未完成任务', '只在本次输入处理中做一次状态核实']) assert.ok(skill.includes(rule), `Skill: ${rule}`);
  for (const rule of ['每次收到新用户输入', '任务对账', '不能因为持续输入而跳过', '新输入不能覆盖、遗忘或静默终止未完成任务']) assert.ok(coordinator.includes(rule), `主控: ${rule}`);
  for (const rule of ['每次处理新输入前', '活动任务映射和状态', '不能因为连续输入而跳过']) assert.ok(runtime.includes(rule), `运行接口: ${rule}`);
});

test('unexpected child stop and resume must re-establish supervise callbacks', () => {
  for (const rule of ['意外停止', '恢复', '重新建立回调', '不能把静默当完成', 'send_message_to_chat_session', '原 taskId', '原会话不可恢复', '报告限制', '不静默换会话', '恢复成功不代表任务完成', '轮询保活']) assert.ok(skill.includes(rule), `Skill: ${rule}`);
  for (const rule of ['意外停止', '恢复', '不能把静默当完成', 'send_message_to_chat_session', 'callbackMode=supervise', '重新派发', '保留 subtaskId', '不静默替换会话']) assert.ok(coordinator.includes(rule), `主控: ${rule}`);
  for (const rule of ['read_chat_session', '核实实际状态', 'send_message_to_chat_session', 'callbackMode', '报告限制', '不创建替代会话', '不以轮询冒充回调']) assert.ok(runtime.includes(rule), `运行接口: ${rule}`);
});

test('clarification uses the actual built-in AskMe tool only in the main session', () => {
  for (const [name, text] of [['Skill', skill], ['主控', coordinator], ['运行接口', runtime]]) {
    for (const rule of ['AskMe', 'AskUserQuestion', '主会话', 'NEEDS_INPUT']) assert.ok(text.includes(rule), `${name}: ${rule}`);
  }
  for (const rule of ['确实需要用户决定', '不重复提问', '空答案', '不可用', '问题编号', 'multiSelect']) assert.ok(skill.includes(rule), rule);
  assert.ok(runtime.includes('不是工具调用名'));
});

test('AskMe does not replace the model card or native permission decisions', () => {
  assert.ok(skill.includes('环节／模型选择继续使用交互卡片'));
  assert.ok(skill.includes('AskMe 不能替代宿主原生权限审批'));
  assert.ok(runtime.includes('indexedAnswers'));
  assert.ok(runtime.includes('真实 interactionRef'));
});

test('every stage output must be summarized and shown to the user in the main session reply', async () => {
  for (const rule of ['用户可见回复', '产物摘要', '关键结论', '产物位置/版本', 'AC/DoD 覆盖', '不能只报告完成状态', '上游产物未展示不得继续', '单步推进视图', '时间线', '已完成、当前与待开始', 'open_stage_dashboard', 'inline HTML', '不替代 Markdown', '必须调用它', '工具未提供']) assert.ok(skill.includes(rule), `Skill: ${rule}`);
  for (const rule of ['用户可见回复', '产物摘要', '关键结论', '产物位置/版本', '不能只报告完成状态', '上游产物未展示不得继续', '单步推进视图', '时间线', '已完成、当前与待开始', '主会话产物展示格式', '只读时间线', '[● 状态]', '[✓ 状态]', '[○ 状态]', '当前环节产物卡', '产物位置', '下一步', 'open_stage_dashboard', 'inline HTML', '不替代 Markdown', '必须调用它', '工具未提供']) assert.ok(coordinator.includes(rule), `主控: ${rule}`);
  assert.ok(coordinator.includes('禁止用“已完成”“子会话已返回”等一句话代替上述模板'), '必须有禁止一句话状态的硬约束');
  for (const name of ['solution-designer', 'implementation-engineer', 'independent-reviewer', 'acceptance-verifier', 'harness-optimizer', 'release-operations']) {
    const text = await readFile(new URL(`references/${name}.md`, root), 'utf8');
    assert.ok(text.includes('主会话可直接向用户展示'), `${name}: 缺少展示摘要要求`);
    assert.ok(text.includes('不要假设用户会进入子会话查看'), `${name}: 未明确用户不进入子会话`);
  }
});

test('frontend design skills are bundled and referenced by the relevant stages', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../.qoder-plugin/plugin.json', root), 'utf8'));
  assert.equal(manifest.skills, './skills/');
  const names = ['frontend-design-direction', 'frontend-design-variants', 'frontend-design-implementation', 'frontend-design-review'];
  for (const name of names) {
    const text = await readFile(new URL(`../../skills/${name}/SKILL.md`, root), 'utf8');
    assert.ok(text.includes(`name: ${name}`), `${name}: frontmatter name`);
    assert.ok(text.includes('description:'), `${name}: description`);
    assert.ok(text.includes('user-invocable: false'), `${name}: internal skill`);
  }
  const direction = await readFile(new URL('../../skills/frontend-design-direction/SKILL.md', root), 'utf8');
  assert.ok(direction.includes('design-styles/index.json') && direction.includes('AskMe') && direction.includes('NEEDS_INPUT'));
  const variants = await readFile(new URL('../../skills/frontend-design-variants/SKILL.md', root), 'utf8');
  assert.ok(variants.includes('design-styles/index.json'));
  const solution = await readFile(new URL('references/solution-designer.md', root), 'utf8');
  const implementation = await readFile(new URL('references/implementation-engineer.md', root), 'utf8');
  const reviewer = await readFile(new URL('references/independent-reviewer.md', root), 'utf8');
  const acceptance = await readFile(new URL('references/acceptance-verifier.md', root), 'utf8');
  assert.ok(solution.includes('frontend-design-direction') && solution.includes('frontend-design-variants'));
  assert.ok(implementation.includes('frontend-design-implementation'));
  assert.ok(reviewer.includes('frontend-design-review'));
  assert.ok(acceptance.includes('frontend-design-review'));
});

test('design style catalog is bundled with 84 entries, four groups, and 16 local DESIGN.md files', async () => {
  const index = JSON.parse(await readFile(new URL('../../design-styles/index.json', root), 'utf8'));
  assert.equal(index.styles.length, 84);
  assert.equal(new Set(index.styles.map(style => style.slug)).size, 84);
  assert.deepEqual(index.groups.map(group => group.id), ['tech', 'minimal', 'creative', 'expressive']);
  const bundled = index.styles.filter(style => style.bundled);
  assert.equal(bundled.length, 16);
  for (const style of index.styles) {
    for (const field of ['slug', 'name', 'group', 'description', 'preview', 'bundled']) assert.ok(Object.hasOwn(style, field), `${style.slug}: ${field}`);
  }
  for (const style of bundled) {
    const text = await readFile(new URL(`../../design-styles/${style.slug}/DESIGN.md`, root), 'utf8');
    assert.ok(text.length > 100, `${style.slug}: DESIGN.md content`);
  }
  assert.ok((await readFile(new URL('../../design-styles/LICENSE', root), 'utf8')).includes('MIT License'));
  assert.ok(skill.includes('design-styles/index.json'));
  assert.ok(coordinator.includes('design-styles/index.json') && coordinator.includes('最多两层'));
});

test('AI harness optimization is surfaced only for explicit or repeated harness signals', async () => {
  for (const rule of ['强信号', '弱信号', '不展示', '重复 ≥2 次', '只读诊断', 'required=true']) assert.ok(skill.includes(rule), `Skill: ${rule}`);
  for (const rule of ['AI Harness 优化只在命中信号时加入环节选择表', '强信号', '弱信号', '不展示', '只读诊断']) assert.ok(coordinator.includes(rule), `主控: ${rule}`);
  const harness = await readFile(new URL('references/harness-optimizer.md', root), 'utf8');
  assert.ok(harness.includes('普通应用功能开发') && harness.includes('只读诊断'));
  assert.ok(!skill.includes('AI Harness 优化是强制环节'));
});

test('AI harness optimization is an optional selectable stage with a bounded prompt', async () => {
  assert.ok(skill.includes('AI Harness 优化'));
  assert.ok(skill.includes('references/harness-optimizer.md'));
  const text = await readFile(new URL('references/harness-optimizer.md', root), 'utf8');
  for (const rule of ['不直接调用 AskMe', 'NEEDS_INPUT', '不创建、复制或调度其他会话', '默认不修改应用代码', 'HARNESS_READY', '不删除、绕过或降低权限、安全门禁、测试和检查标准']) assert.ok(text.includes(rule), rule);
});

test('all worker prompts return clarification needs instead of opening AskMe', async () => {
  for (const name of ['solution-designer', 'implementation-engineer', 'independent-reviewer', 'acceptance-verifier', 'harness-optimizer', 'release-operations']) {
    const text = await readFile(new URL(`references/${name}.md`, root), 'utf8');
    assert.ok(text.includes('不直接调用 AskMe'), name);
    assert.ok(text.includes('NEEDS_INPUT') && text.includes('主会话'), name);
  }
});
