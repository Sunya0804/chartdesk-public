const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { el, all } = require('./dom-helper.cjs');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const code = source.slice(source.indexOf('\t// ---------- 메시지 알림'), source.indexOf('\t// ---------- GitHub Gist 동기화'));
function setup(platform, saved) {
	const calls = [], stored = new Map(saved === undefined ? [] : [['chartdesk-notify-device', saved]]);
	let status = { telegram: { connected: true, token: true, hint: '…1234', chatId: '42', chatName: '내 대화' }, discord: { connected: false, hint: '' } };
	let failure = null;
	const ctx = vm.createContext({ window: { chartdeskApp: { platform } }, el, toast() {},
		localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
		fetch: async (url, options) => {
			const body = options.body ? JSON.parse(options.body) : undefined;
			calls.push({ url, options, body });
			if (failure) return { ok: false, status: 400, json: async () => ({ error: failure }) };
			if (url.endsWith('/config')) {
				if (body.telegram?.token !== undefined) { status.telegram.token = Boolean(body.telegram.token); status.telegram.hint = body.telegram.token ? '…9999' : ''; }
				if (body.telegram?.chatId !== undefined) status.telegram.chatId = body.telegram.chatId;
				status.telegram.connected = Boolean(status.telegram.token && status.telegram.chatId);
				if (body.discord?.webhook !== undefined) status.discord = { connected: Boolean(body.discord.webhook), hint: body.discord.webhook ? '…abcd' : '' };
			}
			if (url.endsWith('/find-chat')) status.telegram = { ...status.telegram, chatId: '99', chatName: '찾은 대화', connected: status.telegram.token };
			const result = /\/(test|send)$/.test(url) ? { telegram: 'ok', discord: 'off' } : structuredClone(status);
			return { ok: true, json: async () => result };
		} });
	vm.runInContext(code, ctx);
	vm.runInContext(source.slice(source.indexOf('\tfunction announceAlert('), source.indexOf('\n\tfunction renderAlerts')), ctx);
	return { ctx, calls, stored, run: s => vm.runInContext(s, ctx), fail: error => { failure = error; } };
}
const button = (node, text) => all(node, n => n.tag === 'button' && n.textContent === text)[0];
const input = (node, label) => all(node, n => n['aria-label'] === label)[0];

test('PC 기본 켬·안드로이드 기본 끔, 기기 선택은 동기화 범위 밖에 저장', async () => {
	for (const [platform, expected] of [[undefined, true], ['android', false]]) {
		const app = setup(platform); await app.run('notifyReady');
		assert.equal(app.run('notifyEnabled'), expected);
		const box = app.run('notifySection()'), checkbox = all(box, n => n.type === 'checkbox')[0];
		checkbox.checked = !expected; await checkbox.emit('change');
		assert.equal(app.stored.get('chartdesk-notify-device'), String(!expected));
		assert.equal([...app.stored.keys()].some(key => key.startsWith('chartdesk.')), false);
	}
	assert.equal(setup('android', 'true').run('notifyEnabled'), true);
	assert.equal(setup(undefined, 'false').run('notifyEnabled'), false);
});

test('저장된 비밀값을 표시하지 않고 빈 입력은 보존, 명시적 지우기는 삭제한다', async () => {
	const app = setup(); await app.run('notifyReady');
	const box = app.run('notifySection()'), token = input(box, '텔레그램 봇 토큰');
	assert.equal(token.value, ''); assert.equal(token.placeholder, '저장됨 …1234');
	await button(box, '토큰 저장').emit('click');
	assert.deepEqual(app.calls.at(-1).body, { telegram: {} });
	assert.equal(app.run('notifyStatus.telegram.connected'), true);
	token.value = '새 토큰'; await button(box, '토큰 저장').emit('click');
	assert.deepEqual(app.calls.at(-1).body, { telegram: { token: '새 토큰' } }); assert.equal(token.value, '');
	await button(box, '토큰 지우기').emit('click');
	assert.equal(app.calls.at(-1).body.telegram.token, ''); assert.equal(app.run('notifyStatus.telegram.connected'), false);
	const webhook = input(box, '디스코드 웹후크 주소');
	webhook.value = 'https://discord.com/api/webhooks/test'; await button(box, '웹후크 저장').emit('click');
	assert.equal(webhook.value, ''); assert.equal(app.run('notifyStatus.discord.connected'), true);
	await button(box, '웹후크 지우기').emit('click'); assert.equal(app.calls.at(-1).body.discord.webhook, '');
});

test('채팅 찾기·ID 저장·테스트 결과·오류를 표시하고 상태는 재조회하지 않는다', async () => {
	const app = setup(); await app.run('notifyReady');
	const box = app.run('notifySection()'), chat = input(box, '텔레그램 채팅 ID');
	await button(box, '채팅 찾기').emit('click'); assert.equal(chat.value, '99');
	assert.ok(all(box, n => n.textContent === '찾은 대화: 찾은 대화').length);
	chat.value = '-123'; await chat.emit('input'); await button(box, '채팅 ID 저장').emit('click');
	assert.deepEqual(app.calls.at(-1).body, { telegram: { chatId: '-123' } });
	await button(box, '테스트 보내기').emit('click'); assert.ok(all(box, n => n.textContent === '텔레그램: ok · 디스코드: off').length);
	app.fail('봇이 받은 메시지가 없습니다.'); await button(box, '채팅 찾기').emit('click');
	assert.ok(all(box, n => n.textContent === '봇이 받은 메시지가 없습니다.').length);
	assert.equal(button(box, '채팅 찾기').disabled, false);
	assert.equal(app.calls.filter(call => call.url.endsWith('/status')).length, 1);
	assert.equal(app.calls.every(call => call.options.credentials === 'same-origin'), true);
});

test('알림은 연결·기기 설정에 따라 비동기 전송하고 실패를 삼킨다', async () => {
	const app = setup(); await app.run('notifyReady');
	app.run("announceAlert('목표 가격 도달')");
	assert.deepEqual(app.calls.at(-1).body, { title: '🔔 ChartDesk 알림', body: '목표 가격 도달' });
	assert.equal(app.calls.at(-1).options.keepalive, true);
	const count = app.calls.length;
	app.run("notifyEnabled=false;announceAlert('중복 방지')"); assert.equal(app.calls.length, count);
	app.run("notifyEnabled=true;notifyStatus={telegram:{connected:false},discord:{connected:false}};announceAlert('미연결')"); assert.equal(app.calls.length, count);
	app.fail('전송 제한'); app.run("notifyStatus.discord.connected=true;announceAlert('실패 무시')");
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(app.calls.filter(call => call.url.endsWith('/status')).length, 1);
});
