const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ window: {} });
for (const file of ['indicators.js', 'rules.js']) vm.runInContext(fs.readFileSync(path.join(root, 'public', file), 'utf8'), context);
const IND = context.window.ChartDeskIndicators;
const RULES = context.window.ChartDeskRules;
const plain = value => JSON.parse(JSON.stringify(value));
const signal = (type, id = 'up', params = {}) => RULES.cleanCond({ kind: 'signal', type, params, signal: id });
const UP = '#31bd65', DOWN = '#eb4b6d';
const colors = { utbot: 'stop', chandelier: 'stop', hullsuite: 'hull', rangefilter: 'filter', halftrend: 'trend', trendmagic: 'magic', coral: 'coral', nwe: 'estimate', alphatrend: 'alpha', ott: 'ott', cmultma: 'ma', ppst: 'trail', t3: 't3', most: 'most', mavilim: 'mavw', vvidya: 'trend', stai: 'ts', dtr: 'r0' };
function bars(n) {
	return Array.from({ length: n }, (_, i) => {
		const close = 100 + 13 * Math.sin(i * 0.19) + 6 * Math.sin(i * 0.043) + 0.005 * i;
		const open = close + 1.4 * Math.sin(i * 1.31);
		return { time: 1600000000 + i * 3600, open, close, high: Math.max(open, close) + 0.8, low: Math.min(open, close) - 0.8, volume: 1000 + 900 * Math.sin(i * 0.37) };
	});
}
function calc(id, data, params = {}) {
	const def = IND.byId.get(id), p = RULES.cleanParams(def, params), s = IND.source(data);
	return { def, p, s, out: def.calc(s, p, {}) };
}
function hits(id, kind, out, n, params = {}) {
	return plain(IND.byId.get(id).signals.find(([key]) => key === kind)[2](out, { n }, params));
}

test('신호 목록·정리·설명·AI 카탈로그', () => {
	assert.equal(RULES.signalDefs().length, 32);
	for (const type of [...Object.keys(colors), 'bbrsi', 'tma', 'srbreaks', 'tlbreaks', 'twinrf', 'slingshot', 'cipherb', 'cmmacd', 'squeeze', 'sqzpro', 'wae', 'fvg', 'divs', 'impulse']) {
		assert.ok(RULES.signalDefs().some(def => def.id === type), type);
	}
	assert.equal(RULES.cleanCond({ kind: 'signal', type: 'rsi', signal: 'up' }), null);
	assert.equal(signal('utbot', 'invalid'), null);
	assert.equal(signal('missing'), null);
	assert.equal(signal('utbot', 'up', { atr: -10 }).params.atr, 1);
	assert.equal(RULES.describe(signal('utbot')), 'UT Bot 상승 전환');
	assert.match(RULES.catalogText(), /srbreaks:.*signals: up/);
	assert.match(RULES.catalogText(), /divs:.*hiddenUp/);
});

test('모든 신호는 boolean 배열이며 잘라 계산해도 과거 결과가 바뀌지 않는다', () => {
	const data = bars(640);
	for (const def of RULES.signalDefs()) {
		const full = calc(def.id, data);
		for (const [id, , fn] of def.signals) {
			const expected = plain(fn(full.out, full.s, full.p));
			assert.equal(expected.length, data.length, `${ def.id }/${ id } 길이`);
			assert.ok(expected.every(hit => typeof hit === 'boolean'), `${ def.id }/${ id } 형식`);
			assert.deepEqual(plain(RULES.evaluator(data).truth(signal(def.id, id))), expected);
			for (const n of [0, 1, 19, 54, 133, 280, 510]) {
				const prefix = calc(def.id, data.slice(0, n));
				assert.deepEqual(plain(fn(prefix.out, prefix.s, prefix.p)), expected.slice(0, n), `${ def.id }/${ id } ${ n }봉 미래 참조`);
			}
		}
	}
});

test('뒤늦게 거래량이 생겨도 AlphaTrend 과거 신호를 바꾸지 않는다', () => {
	const data = bars(300).map((bar, i) => ({ ...bar, volume: i < 200 ? 0 : bar.volume }));
	const full = RULES.evaluator(data).truth(signal('alphatrend'));
	assert.deepEqual(plain(RULES.evaluator(data.slice(0, 180)).truth(signal('alphatrend'))), plain(full.slice(0, 180)));
});

test('추세 신호는 차트 선의 양방향 색 전환과 일치한다', () => {
	for (const [id, key] of Object.entries(colors)) {
		const { out } = calc(id, bars(640));
		for (const [dir, from, to] of [['up', DOWN, UP], ['down', UP, DOWN]]) {
			assert.deepEqual(hits(id, dir, out, 640), Array.from({ length: 640 }, (_, i) => i > 0 && out.$colors[key][i - 1] === from && out.$colors[key][i] === to), id);
		}
	}
});

test('표시 제한 이전의 장악형·매수·매도·B 돌파를 모두 쓴다', () => {
	const data = Array.from({ length: 900 }, (_, i) => ({ time: i, open: i % 2 ? 98 : 102, close: i % 2 ? 102 : 98, high: 103, low: 97, volume: 100 }));
	const { out } = calc('tma', data);
	assert.ok(out.$signalMarks.length > out.$draw.marks.length);
	assert.ok(hits('tma', 'up', out, data.length)[1]);
	for (const id of ['bbrsi', 'tma', 'srbreaks', 'tlbreaks', 'twinrf', 'slingshot']) {
		const marks = [{ i: 1, dir: 1, text: 'B' }, { i: 2, dir: -1, text: 'B' }, { i: 3, dir: 1, text: '꼬리' }];
		const result = hits(id, 'up', { $signalMarks: marks, $draw: { marks: [] } }, 5);
		assert.deepEqual(result, [false, true, false, !['srbreaks', 'tlbreaks'].includes(id), false], id);
	}
});

test('점 값 0도 신호이며 색과 방향을 구별한다', () => {
	assert.deepEqual(hits('cipherb', 'up', { buy: [null, 0, -10], sell: [1, null, null] }, 3), [false, true, true]);
	const out = { cross: [null, 0, -1], $colors: { cross: [UP, UP, DOWN] } };
	assert.deepEqual(hits('cmmacd', 'up', out, 3), [false, true, false]);
	assert.deepEqual(hits('cmmacd', 'down', out, 3), [false, false, true]);
});

test('수축 해제는 유효한 전환만, 폭발은 처음 맞은 봉만 쓴다', () => {
	for (const [id, before, after] of [['squeeze', '#f59e0b', '#6b7280'], ['sqzpro', '#ef4444', '#22c55e']]) {
		const out = { momentum: [null, 1, 3, -3, -3, 0], $colors: { state: [null, after, before, after, before, after] } };
		assert.deepEqual(hits(id, 'fire', out, 6), [false, false, false, true, false, true]);
		assert.deepEqual(hits(id, 'fireDown', out, 6), [false, false, false, true, false, false]);
	}
	const out = { up: [null, 5, 6, 1, 7], down: [0, 0, 0, 0, 0], explosion: [null, 4, 4, 4, 4], dead: [null, 2, 2, 2, 2] };
	assert.deepEqual(hits('wae', 'up', out, 5), [false, true, false, false, true]);
	assert.deepEqual(hits('impulse', 'up', { $colors: { hist: [null, '#3b82f6', UP, UP, DOWN, UP] } }, 6), [false, false, true, false, false, true]);
});

test('FVG는 셋째 봉에, 다이버전스는 피벗 오른쪽 봉 수 뒤에 확정된다', () => {
	const data = [{ open: 10, close: 11, high: 12, low: 9 }, { open: 13, close: 15, high: 16, low: 13 }, { open: 17, close: 18, high: 19, low: 16 }].map((bar, i) => ({ ...bar, time: i, volume: 100 }));
	const { out } = calc('fvg', data, { threshold: 0.1 });
	assert.ok(out.gap[1] !== null);
	assert.deepEqual(hits('fvg', 'up', out, 3), [false, false, true]);
	const segs = [{ b: 2, color: 'up', dash: [] }, { b: 3, color: 'down', dash: [4, 3] }];
	assert.deepEqual(hits('divs', 'up', { $signalSegs: segs }, 7, { prd: 2 }), [false, false, false, false, true, false, false]);
	assert.deepEqual(hits('divs', 'hiddenDown', { $signalSegs: segs }, 7, { prd: 2 }), [false, false, false, false, false, true, false]);
});

test('계산·신호 오류는 모두 false이고 동일 계산은 캐시한다', () => {
	const def = IND.byId.get('utbot'), original = def.calc;
	try {
		let count = 0;
		def.calc = (...args) => { count++; return original(...args); };
		const run = RULES.evaluator(bars(100));
		run.truth(signal('utbot')); run.truth(signal('utbot', 'down')); run.truth(signal('utbot'));
		assert.equal(count, 1);
		def.calc = () => { throw Error('계산 실패'); };
		assert.ok(RULES.evaluator(bars(10)).truth(signal('utbot')).every(hit => hit === false));
		assert.ok(RULES.evaluator(bars(10)).truth({ kind: 'signal', type: 'missing', signal: 'up' }).every(hit => hit === false));
	}
	finally { def.calc = original; }
});

test('UT 백테스트 거래는 색 전환 다음 봉 시가에 실행된다', () => {
	const data = bars(640), up = signal('utbot'), down = signal('utbot', 'down');
	const strategy = RULES.cleanStrategy({ entry: [up], exit: [down], fee: 0 });
	const result = RULES.backtest(data, strategy), run = RULES.evaluator(data);
	const buys = run.truth(up), sells = run.truth(down);
	assert.ok(result.trades.length > 5);
	for (const trade of result.trades) {
		assert.equal(buys[trade.index - 1], true);
		assert.equal(sells[trade.exitIndex - 1], true);
		assert.equal(trade.price, data[trade.index].open);
		assert.equal(trade.exitPrice, data[trade.exitIndex].open);
	}
	assert.ok(RULES.evaluator(data).truth(RULES.cleanCond({ kind: 'gosu', signal: 'any' })).every(hit => typeof hit === 'boolean'));
	assert.equal(RULES.evaluator(data).truth(RULES.cleanCond({ kind: 'compare', left: { kind: 'value', value: 2 }, op: 'gt', right: { kind: 'value', value: 1 } }))[0], true);
});

test('공통 편집기로 신호 알림 조건을 만들고 스크리너 프리셋으로 찾는다', async () => {
	const { Node, el, all } = require('./dom-helper.cjs');
	const body = new Node('body');
	const data = bars(640), up = RULES.evaluator(data).truth(signal('utbot'));
	const lastUp = up.findLastIndex(Boolean), selected = data.slice(0, lastUp + 1);
	const stored = new Map();
	const app = { el, pane: () => ({ interval: '1h' }), closePopover() {}, tzOffset: 0,
		INTERVAL_SECONDS: { '1h': 3600 }, INTERVALS: [['1h', '1시간']], watchlist: () => ['TEST:UT'], quote: () => null,
		loadBars: async () => ({ bars: selected, precision: 2 }), symbolInfo: () => ({}), intervalLabel: () => '1시간',
		formatPrice: String, formatPercent: String, logo: () => el('span'), symbolTitle: String };
	const ctx = vm.createContext({ window: { ChartDeskApp: app, ChartDeskIndicators: IND, ChartDeskRules: RULES }, structuredClone,
		document: { body, addEventListener() {}, getElementById: () => null }, setTimeout() {},
		localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } });
	vm.runInContext(fs.readFileSync(path.join(root, 'public/lab.js'), 'utf8'), ctx);
	const lab = ctx.window.ChartDeskLab, editor = lab.condEditor();
	const kind = all(editor.node, n => n.className === 'cond-kind')[0];
	kind.value = 'signal'; await kind.emit('change');
	const picker = all(editor.node, n => n.className === 'ind-pick')[0];
	assert.ok(all(picker, n => n.value === 'srbreaks').length > 0);
	picker.value = 'utbot'; await picker.emit('change');
	const parameter = all(editor.node, n => n.className === 'param')[0];
	parameter.value = '2'; await parameter.emit('change');
	assert.equal(RULES.cleanCond(editor.value()).params.key, 2);
	assert.equal(RULES.describe(editor.value()), 'UT Bot 상승 전환');
	lab.openScreener();
	const presets = all(body, n => n.tag === 'select' && all(n, option => option.value === 'utbot-up').length > 0)[0];
	for (const id of ['utbot-up', 'cipherb-buy', 'squeeze-up', 'stai-up']) assert.ok(all(presets, n => n.value === id).length);
	presets.value = 'utbot-up'; await presets.emit('change');
	const target = all(body, n => n.tag === 'select' && all(n, option => option.value === 'watchlist').length > 0)[0];
	target.value = 'watchlist'; await target.emit('change');
	await all(body, n => n.tag === 'button' && n.textContent === '검색')[0].emit('click');
	assert.ok(all(body, n => n.tag === 'p' && n.textContent.includes('1개 중 1개가 맞습니다')).length > 0);
	assert.equal(JSON.parse(stored.get('chartdesk.lab.v1')).screen.conds[0].kind, 'signal');
});

test('기존 조건 알림 경로가 마감된 UT 신호를 평가하고 중복 발화를 막는다', async () => {
	const data = bars(640), up = RULES.evaluator(data).truth(signal('utbot'));
	const end = up.findLastIndex(Boolean), chosen = data.slice(0, end + 1), fired = [];
	const ctx = vm.createContext({ RULES, state: { alerts: [{ kind: 'cond', active: true, cond: signal('utbot'), symbol: 'TEST:UT', interval: '1h', createdAt: 0 }] },
		TZ_OFFSET: 0, INTERVAL_SECONDS: { '1h': 3600 }, loadBars: async () => ({ bars: chosen }), symbolInfo: () => ({}),
		intervalLabel: () => '1시간', formatPrice: String, alertsChanged() {}, fire: (...args) => fired.push(args) });
	const src = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
	vm.runInContext(src.slice(src.indexOf('\tconst nextCondCheck ='), src.indexOf('\n\tfunction announceAlert')), ctx);
	await vm.runInContext('checkCondAlerts()', ctx);
	await vm.runInContext('checkCondAlerts()', ctx);
	assert.equal(fired.length, 1);
	assert.match(fired[0][1], /UT Bot 상승 전환/);
});
