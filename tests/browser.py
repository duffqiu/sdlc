import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = 'http://127.0.0.1:47832'
output = Path(__file__).resolve().parents[2] / 'sdlc-ui-evidence'
output.mkdir(exist_ok=True)
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 950, 'height': 850})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)

    def load(mode='normal'):
        page.goto(f'{base}/?mode={mode}')
        page.wait_for_load_state('networkidle')
        frame = page.frame_locator('iframe')
        expect(frame.get_by_role('heading', name='订单退款功能 · 执行前确认')).to_be_visible()
        return frame

    frame = load()
    confirm = frame.get_by_role('button', name='确认并继续', exact=True)
    expect(confirm).to_be_enabled()
    expect(frame.get_by_role('combobox', name='方案设计模型')).to_have_value('test-reason')
    expect(frame.get_by_role('combobox', name='开发实现模型')).to_have_value('test-fast')
    expect(frame.get_by_role('combobox', name='独立验收模型')).to_have_value('test-review')
    assert page.evaluate('messages.length') == 0
    page.screenshot(path=str(output / 'card-light.png'), full_page=True)

    frame.get_by_role('combobox', name='开发实现模型').select_option('test-reason')
    frame.get_by_role('checkbox', name='执行独立验收').uncheck()
    expect(frame.get_by_role('combobox', name='独立验收模型')).to_be_disabled()
    expect(frame.locator('#summary')).to_have_text('已选 2 / 3 个环节')
    assert page.evaluate('messages.length') == 0
    page.evaluate("setTheme('dark')")
    expect(frame.locator('html')).to_have_attribute('data-theme', 'dark')
    assert frame.get_by_role('combobox', name='方案设计模型').evaluate('el => getComputedStyle(el).backgroundColor') == 'rgb(34, 44, 40)'
    expect(frame.get_by_role('combobox', name='开发实现模型')).to_have_value('test-reason')
    page.screenshot(path=str(output / 'card-dark.png'), full_page=True)
    confirm.click()
    expect(frame.locator('#status')).to_have_text('选择已交回主会话，等待主会话核对和调度。')
    assert page.evaluate('messages.length') == 1
    assert page.evaluate('writes.length') == 1
    receipt = json.loads(page.evaluate('messages[0].content[0].text').split('\n')[1])
    assert receipt['decision'] == 'confirmed'
    assert receipt['choices'][1]['modelKey'] == 'test-reason'
    assert receipt['choices'][2]['enabled'] is False
    expect(confirm).to_be_disabled()

    frame = load()
    frame.get_by_role('button', name='取消', exact=True).click()
    expect(frame.locator('#status')).to_have_text('取消决定已交回主会话。')
    assert page.evaluate('writes[0].decision') == 'cancelled'
    assert page.evaluate('messages.length') == 1

    frame = load()
    for checkbox in frame.get_by_role('checkbox').all():
        checkbox.uncheck()
    frame.get_by_role('button', name='确认不执行任何环节', exact=True).click()
    expect(frame.locator('#status')).to_have_text('选择已交回主会话，等待主会话核对和调度。')
    assert all(not choice['enabled'] for choice in page.evaluate('writes[0].choices'))

    frame = load('message-unknown')
    frame.get_by_role('button', name='确认并继续', exact=True).click()
    expect(frame.locator('#status')).to_contain_text('请在主会话检查')
    expect(frame.get_by_role('button', name='确认并继续', exact=True)).to_be_disabled()
    frame.get_by_role('button', name='刷新选择状态').click()
    expect(frame.locator('#status')).to_contain_text('这张卡片已确认')
    assert page.evaluate('messages.length') == 1

    frame = load('write-unknown')
    frame.get_by_role('button', name='确认并继续', exact=True).click()
    expect(frame.locator('#status')).to_contain_text('请在主会话检查')
    frame.get_by_role('button', name='刷新选择状态').click()
    expect(frame.locator('#status')).to_contain_text('这张卡片已确认')
    assert page.evaluate('writes.length') == 1
    assert page.evaluate('messages.length') == 0

    frame = load('remote')
    expect(frame.locator('#confirm')).to_be_hidden()
    expect(frame.locator('#cancel')).to_be_hidden()
    expect(frame.locator('#status')).to_contain_text('仅供查看')
    assert page.evaluate('messages.length') == 0

    frame = load('hostile')
    assert frame.locator('img').count() == 0
    expect(frame.get_by_role('combobox', name='方案设计模型')).to_contain_text('<img src=x onerror=alert(1)>')

    frame = load()
    page.set_viewport_size({'width': 390, 'height': 850})
    expect(frame.get_by_role('button', name='确认并继续', exact=True)).to_be_visible()
    inner = page.frames[1]
    assert inner.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path=str(output / 'card-narrow.png'), full_page=True)
    model = frame.get_by_role('combobox', name='方案设计模型')
    model.focus()
    expect(model).to_be_focused()
    model.press('Enter')
    assert page.evaluate('writes.length') == 0
    model.press('b')
    expect(model).to_have_value('test-fast')
    assert page.evaluate('writes.length') == 0
    page.set_viewport_size({'width': 1440, 'height': 900})
    assert inner.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path=str(output / 'card-wide.png'), full_page=True)
    assert not errors, errors
    browser.close()

print('PASS: real-browser defaults, dropdown, checkboxes, confirmation, cancel, zero stages, unknown outcomes without resends, capability gate, inert hostile text, keyboard, light/dark and responsive layouts; no console/page errors.')
print(f'Screenshots: {output}')
