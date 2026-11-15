const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { Node, el, all } = require('./dom-helper.cjs');
const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const ctx = vm.createContext({ window: {} });
vm.runInContext(read('indicators.js'), ctx);
vm.runInContext(read('rules.js'), ctx);
const IND = ctx.window.ChartDeskIndicators, RULES = ctx.window.ChartDeskRules;
const plain = value => JSON.parse(JSON.stringify(value));
const bar = (close, i, extra = {}) => ({ time: 1600000000 + i * 3600, open: close - 0.05, close, high: close + 0.1, low: close - 0.1, volume: 100, ...extra });
const trend = () => Array.from({ length: 260 }, (_, i) => bar(100 + i * 0.2, i));
const wave = n => Array.from({ length: n }, (_, i) => bar(100 + 13 * Math.sin(i * 0.19) + 6 * Math.sin(i * 0.043), i, { volume: 1000 + 900 * Math.sin(i * 0.37) }));
function calc(data, params = {}, type = 'bulldan', context = {}) {
	const def = IND.byId.get(type), p = RULES.cleanParams(def, params), s = IND.source(data);
	return { out: def.calc(s, p, context), def, p, s };
}
const marks = result => plain(result.out.$signalMarks);
function trapBars() {
	const data = Array.from({ length: 61 }, (_, i) => bar(150 - i, i));
	for (let i = 61; i < 69; i++) data.push(bar(93 + (i - 61) * 1.5, i));
	data.push(bar(95, 69, { open: 94, low: 88, high: 97 }), bar(96, 70, { open: 95, low: 88, high: 98 }));
	return data;
}
function pistolBars() {
	const data = trend();
	data.push(bar(152, 260, { high: 250, low: 149 }));
	for (let i = 261; i < 290; i++) data.push(bar(150 + (i - 261) * 0.02, i, { low: 149 + (i - 261) * 0.03, high: 150.2 + (i - 261) * 0.02 }));
	return data;
}
function pullbackBars() {
	const data = trend();
	for (let i = 260; i < 284; i++) {
		const close = 100 + i * 0.2;
		data.push(bar(close, i, { low: i % 3 === 0 ? close - 6 : close - 0.1, volume: i % 3 === 0 ? 50 : 100 }));
	}
	return data;
}

test('S1은 전저 이탈·회복과 RSI 상승이 겹친 봉에서 같은 피벗당 한 번 확정된다', () => {
	const data = trapBars(), result = calc(data);
	assert.deepEqual(marks(result).filter(m => m.text.startsWith('트랩')).map(m => m.i), [69]);
	assert.equal(marks(calc(data.slice(0, 69))).filter(m => m.text.startsWith('트랩')).length, 0);
	const failed = data.map(b => ({ ...b })); failed[69].close = 88;
	assert.equal(marks(calc(failed)).some(m => m.i === 69 && m.text.startsWith('트랩')), false);
	assert.equal(marks(calc(data, { right: 10 })).some(m => m.i === 69 && m.text.startsWith('트랩')), false);
	assert.ok(marks(calc(data, { os2: 100, os1: 100 })).some(m => m.i === 69 && m.text === '트랩★'));
});

test('S2 급등 뒤 저점 상승 수렴·50선 터치는 한 번이고 50선 아래 마감은 제외한다', () => {
	const data = pistolBars(), result = calc(data), hit = marks(result).filter(m => m.text === '권총');
	assert.deepEqual(hit.map(m => m.i), [274]);
	assert.ok(data[274].low <= result.out.ma50[274] * 1.003);
	assert.ok(data[274].close > result.out.ma50[274]);
	const failed = data.slice(0, 275).map(b => ({ ...b }));
	failed[274].close = result.out.ma50[274] - 0.1;
	assert.equal(marks(calc(failed)).some(m => m.text === '권총' && m.i === 274), false);
});

test('S5 같은 상승 구간은 첫 두 눌림만, 이평 아래 마감 뒤 새 구간은 다시 센다', () => {
	const data = pullbackBars();
	assert.deepEqual(marks(calc(data)).filter(m => m.text === '눌림').map(m => m.i), [261, 264]);
	assert.deepEqual(marks(calc(data, { pullbackMax: 1 })).filter(m => m.text === '눌림').map(m => m.i), [261]);
	data.push(bar(145, 284));
	for (let i = 285; i < 295; i++) data.push(bar(157 + (i - 285) * 0.2, i, { low: i % 3 === 0 ? 151 : 156.9 + (i - 285) * 0.2, volume: i % 3 === 0 ? 50 : 100 }));
	assert.ok(marks(calc(data)).some(m => m.text === '눌림' && m.i > 284));
});

test('S6 꼬리는 하락 구간에서 한 번만 나오고 종가가 MA25 위로 회복하면 초기화된다', () => {
	const data = Array.from({ length: 30 }, (_, i) => bar(100, i));
	for (let i = 30; i < 33; i++) data.push(bar(120 - i, i, { open: 121 - i, high: 122 - i, low: 105 - i, volume: 1000 * 2 ** (i - 30) }));
	data.push(bar(110, 33));
	data.push(bar(85, 34, { open: 86, high: 87, low: 70, volume: 5000 }), bar(84, 35, { open: 85, high: 86, low: 69, volume: 10000 }));
	const full = calc(data), hits = result => marks(result).filter(m => m.text === '꼬리').map(m => m.i);
	assert.deepEqual(hits(full), [30, 34]);
	assert.ok(data[33].close > full.out.ma25[33]);
	for (const i of [30, 31, 32, 34, 35]) {
		assert.ok(data[i].close < full.out.ma25[i]);
		const volAvg = data.slice(i - 19, i + 1).reduce((sum, b) => sum + b.volume, 0) / 20;
		assert.ok(data[i].volume >= volAvg * 3);
		assert.ok((Math.min(data[i].open, data[i].close) - data[i].low) / (data[i].high - data[i].low) >= 0.5);
	}
	const signal = full.def.signals.find(([id]) => id === 'wick')[2];
	assert.deepEqual(plain(signal(full.out, full.s, full.p)).flatMap((hit, i) => hit ? [i] : []), [30, 34]);
	for (const n of [31, 33, 34, 35]) assert.deepEqual(hits(calc(data.slice(0, n))), hits(full).filter(i => i < n));
	assert.deepEqual(hits(calc(data, { wick: 0 })), []);
});

test('예전 선 표시 파라미터는 무시하고 타점·경고 표시 설정만 계산에 적용한다', () => {
	const data = pullbackBars(), params = Object.fromEntries(['showMa7', 'showMa25', 'showMa50', 'showMa100', 'showMa200', 'showVwma'].map(k => [k, 0]));
	const result = calc(data, params);
	assert.deepEqual(plain(result.out), plain(calc(data).out));
	assert.ok(result.def.plots.every(plot => !plot.fixedColor));
	for (const k of Object.keys(params)) assert.equal(result.def.params.some(param => param.k === k), false);
	for (const [key, fixture, text] of [['trap', trapBars(), '트랩'], ['pistol', pistolBars(), '권총'], ['pullback', data, '눌림']]) {
		assert.equal(marks(calc(fixture, { [key]: 0 })).some(m => m.text.startsWith(text)), false);
	}
	assert.equal(marks(calc(wave(700), { warnings: 0 })).some(m => m.dir < 0), false);
});

test('마지막 봉을 자르거나 이어 붙여도 과거 타점·경고·조건 신호는 바뀌지 않는다', () => {
	for (const data of [trapBars(), pistolBars(), pullbackBars(), wave(700)]) {
		const full = calc(data, { breakout: 1 });
		for (const n of [...new Set([1, 30, 61, 69, 70, 200, 274, 280, data.length - 1].filter(n => n < data.length))]) {
			const prefix = calc(data.slice(0, n), { breakout: 1 });
			assert.deepEqual(marks(prefix), marks(full).filter(m => m.i < n));
			for (const [id, , fn] of full.def.signals) assert.deepEqual(plain(fn(prefix.out, prefix.s, prefix.p)), plain(fn(full.out, full.s, full.p).slice(0, n)), id);
		}
	}
});

test('RSI 네 단계 색·기준 진입·일반 다이버전스는 기존 RSI와 확정 피벗을 쓴다', () => {
	const data = wave(700), result = calc(data, {}, 'bulldanRsi');
	const rsiDef = IND.byId.get('rsi');
	assert.deepEqual(plain(result.out.rsi), plain(rsiDef.calc(result.s, { length: 14 }).rsi));
	for (const [v, color] of [[10, '#1d4ed8'], [25, '#3b82f6'], [50, '#9ca3af'], [75, '#ef4444'], [90, '#b91c1c']]) {
		const i = result.out.rsi.findIndex(x => x !== null && (v === 10 ? x <= 20 : v === 25 ? x > 20 && x <= 30 : v === 50 ? x > 30 && x < 70 : v === 75 ? x >= 70 && x < 80 : x >= 80));
		assert.ok(i >= 0); assert.equal(result.out.$colors.rsi[i], color);
	}
	assert.ok(result.out.$signalSegs.length > 0);
	assert.ok(result.out.$signalSegs.every(seg => !seg.dash.length));
	assert.equal(calc(data, { divergence: 0 }, 'bulldanRsi').out.$signalSegs.length, 0);
	for (const [id, , fn] of result.def.signals) {
		const full = plain(fn(result.out, result.s, result.p));
		for (const n of [19, 100, 330, data.length - 1]) {
			const prefix = calc(data.slice(0, n), {}, 'bulldanRsi');
			assert.deepEqual(plain(fn(prefix.out, prefix.s, prefix.p)), full.slice(0, n), id);
		}
	}
	for (const seg of result.out.$signalSegs) {
		const prefix = calc(data.slice(0, seg.b + result.p.prd), {}, 'bulldanRsi');
		assert.equal(prefix.out.$signalSegs.some(x => x.a === seg.a && x.b === seg.b), false);
	}
});

test('진행 중인 봉에는 타점과 RSI 단계 신호를 확정하지 않는다', () => {
	const data = trapBars().slice(0, 70);
	assert.equal(marks(calc(data, {}, 'bulldan', { closedBefore: data[69].time })).some(m => m.i === 69), false);
	const fixture = wave(300), full = calc(fixture, {}, 'bulldanRsi'), signal = full.def.signals[0];
	const at = signal[2](full.out, full.s, full.p).findIndex(Boolean); assert.ok(at > 0);
	const pending = calc(fixture.slice(0, at + 1), {}, 'bulldanRsi', { closedBefore: fixture[at].time });
	assert.equal(signal[2](pending.out, pending.s, pending.p)[at], false);
});

test('몸통 박스 격자는 꼬리를 제외하고 같은 높이로 확장한다', () => {
	const data = [bar(100, 0, { open: 90, low: 1, high: 200 }), bar(110, 1, { open: 105, low: 2, high: 300 })];
	assert.equal(calc(data).out.$draw.segs.length, 0);
	const segs = calc(data, { showBoxes: 1 }).out.$draw.segs;
	assert.deepEqual(plain(segs.map(seg => seg.pa)), [30, 50, 70, 90, 100, 110, 130, 150, 170]);
	assert.ok(segs.every(seg => seg.pa === seg.pb && seg.dash.length > 0 && !seg.text));
});

function ui() {
	const source = read('app.js'), c = vm.createContext({ IND, window: {}, el, state: { indicators: [], paneSizes: {} }, panes: [], uid: (() => { let id = 0; return () => `id${ ++id }`; })(), INTERVAL_SECONDS: { '1h': 3600, '4h': 14400 }, save() {}, PALETTE: ['red'] });
	vm.runInContext(source.slice(source.indexOf('\tconst normalizeId'), source.indexOf('\tconst state = loadState()')), c);
	vm.runInContext(source.slice(source.indexOf('\tfunction indicatorsChanged'), source.indexOf('\tfunction openIndicatorSettings')), c);
	vm.runInContext(`globalThis.Pane = class {
		${ source.slice(source.indexOf('\t\taddIndicator(type)'), source.indexOf('\t\tpriceFormat(')) }
		${ source.slice(source.indexOf('\t\trestyleIndicators() {'), source.indexOf('\t\tbuildLegendRow(')) }
		${ source.slice(source.indexOf('\t\tpointAt('), source.indexOf('\t\tcomputeIndicators() {')) }
	}`, c);
	return { c, source, pane: new c.Pane() };
}

function settingsUi(stored = new Map()) {
	const result = ui(), { c, source, pane } = result, rows = new Node('div');
	Object.assign(c, { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
		STORAGE_KEY: 'chartdesk.workspace.v1', setTimeout: () => 1, clearTimeout() {},
		PROV: { resolve: () => true }, LAYOUTS: [1], THEMES: [['black']], CHART_TYPES: [['candles']], INTERVALS: [['1h', '1시간'], ['4h', '4시간']],
		popover: {}, openPopover: (_, ...children) => rows.replaceChildren(...children), pane, anchor: {} });
	vm.runInContext(source.slice(source.indexOf('\tlet saveTimer'), source.indexOf('\t// 앱을 숨길 때')), c);
	vm.runInContext(source.slice(source.indexOf('\tconst field ='), source.indexOf('\tconst DASH_OPTIONS')), c);
	vm.runInContext(source.slice(source.indexOf('\tfunction openIndicatorSettings'), source.indexOf('\t// ---------- 작도 ----------')), c);
	c.state = stored.size ? c.loadState() : { ...c.defaultState(), indicators: [] };
	pane.bars = wave(320);
	pane.buildIndicators = () => {
		pane.inds = c.state.indicators.map(cfg => {
			const def = IND.byId.get(cfg.type);
			return { cfg, def, out: def.calc(IND.source(pane.bars), cfg.params, {}),
				series: Object.fromEntries(def.plots.map(plot => [plot.k, { options: { color: plot.color }, applyOptions(options) { Object.assign(this.options, options); } }])),
				values: Object.fromEntries(def.plots.map(plot => [plot.k, { style: {} }])), row: { classList: { toggle() {} } } };
		});
		pane.restyleIndicators();
	};
	c.panes.push(pane); pane.buildIndicators();
	const open = id => { c.settingsId = id; vm.runInContext('openIndicatorSettings(anchor,pane,settingsId)', c); };
	const control = label => all(rows, n => n['aria-label'] === label)[0];
	return { ...result, rows, stored, open, control };
}

test('세트 추가·삭제·숨기기·복수 인스턴스·재로딩은 소유한 RSI·매물대에만 적용한다', () => {
	const { c, pane } = ui();
	pane.addIndicator('vpsr'); const separate = c.state.indicators[0].id;
	pane.addIndicator('bulldan'); const a = c.state.indicators.find(x => x.type === 'bulldan');
	const child = () => c.state.indicators.find(x => x.companionOf === a.id && x.type === 'bulldanRsi');
	assert.ok(child()); assert.equal(c.state.indicators.filter(x => x.type === 'vpsr').length, 1);
	pane.updateIndicator(a.id, { ...a.params, rsiLen: 9, os1: 35, os2: 15, ob1: 65, ob2: 85, showProfile: 1 }); a.tf = '4h'; c.indicatorsChanged();
	assert.equal(child().params.rsiLen, 9); assert.deepEqual(plain(IND.byId.get('bulldanRsi').levels(child().params)), [15, 35, 65, 85]); assert.equal(child().tf, '4h');
	assert.equal(c.state.indicators.filter(x => x.type === 'vpsr').length, 2);
	pane.toggleIndicator(a.id); assert.ok(child().hidden);
	pane.toggleIndicator(a.id); assert.equal(child().hidden, false);
	c.state.indicators = c.sanitizeIndicators(plain(c.state.indicators));
	assert.equal(child().companionOf, a.id); assert.equal(child().params.rsiLen, 9);
	const restored = c.state.indicators.find(x => x.id === a.id);
	pane.updateIndicator(a.id, { ...restored.params, showRsi: 0 }); assert.equal(child(), undefined);
	pane.updateIndicator(a.id, { ...restored.params, showRsi: 1 }); assert.ok(child());
	pane.removeIndicator(child().id); assert.equal(child(), undefined); assert.equal(restored.params.showRsi, 0);
	pane.addIndicator('bulldan'); const other = c.state.indicators.find(x => x.type === 'bulldan' && x.id !== a.id);
	pane.removeIndicator(a.id); assert.ok(c.state.indicators.some(x => x.id === separate));
	assert.ok(c.state.indicators.some(x => x.companionOf === other.id));
	assert.equal(c.state.indicators.some(x => x.id === a.id || x.companionOf === a.id), false);
});

test('설정 창은 체크박스와 선택 목록을 지원하고 RSI 설정은 부모에게 연결된다', async () => {
	const { c, pane, rows, open, control } = settingsUi();
	pane.addIndicator('bulldan'); const a = c.state.indicators[0], child = c.state.indicators[1];
	open(child.id);
	assert.match(rows.children[0].textContent, /불장단타왕 ·/);
	const checkbox = control('200선 표시'); assert.equal(checkbox.type, 'checkbox'); checkbox.checked = false; await checkbox.emit('change');
	assert.equal(a.style.ma200.hidden, true);
	assert.equal('showMa200' in a.params, false);
	assert.equal(all(rows, n => n.tag === 'label' && n.children[0]?.textContent === '200선 표시').length, 0);
	const select = all(rows, n => n.tag === 'label' && n.children[0]?.textContent === '기준 이평')[0].children[1];
	assert.ok(select.children.some(n => n.textContent === 'VWMA'));
	assert.equal(IND.byId.get('bulldanRsi').setOnly, true);
});

test('이평선 6개는 표시·색·굵기 한 줄로 편집되고 저장 후 새 앱 상태에서도 유지된다', async () => {
	const app = settingsUi(), { c, pane, rows, open, control, stored } = app;
	pane.addIndicator('bulldan'); const a = c.state.indicators[0], expected = {}, original = calc(pane.bars);
	open(a.id);
	for (const [i, plot] of IND.byId.get('bulldan').plots.entries()) {
		const row = all(rows, n => n.className === 'field style-row' && n.children[0]?.textContent === plot.label);
		assert.equal(row.length, 1);
		assert.deepEqual(row[0].children.map(n => n.tag), ['span', 'input', 'input', 'select']);
		const show = control(`${ plot.label } 표시`), color = control(`${ plot.label } 색`), width = control(`${ plot.label } 굵기`);
		assert.equal(show.checked, true); assert.equal(color.type, 'color'); assert.equal(color.value, plot.color);
		assert.equal(Number(width.value), i === 2 || i === 4 ? 2 : 1);
		assert.deepEqual(width.children.map(n => n.value), ['1', '2', '3', '4', '5']);
		expected[plot.k] = { hidden: i % 2 === 0, color: `#12345${ i }`, width: i % 5 + 1 };
		show.checked = !expected[plot.k].hidden; await show.emit('change');
		color.value = expected[plot.k].color; await color.emit('input');
		width.value = String(expected[plot.k].width); await width.emit('change');
		const ind = pane.inds.find(ind => ind.cfg.id === a.id);
		assert.deepEqual(ind.series[plot.k].options, { color: expected[plot.k].color, lineWidth: expected[plot.k].width, visible: !expected[plot.k].hidden });
	}
	assert.deepEqual(plain(pane.inds.find(ind => ind.cfg.id === a.id).out), plain(original.out));
	c.flushSave(); assert.ok(stored.has('chartdesk.workspace.v1'));
	const reopened = settingsUi(stored), restored = reopened.c.state.indicators.find(x => x.id === a.id);
	reopened.open(a.id);
	for (const plot of IND.byId.get('bulldan').plots) {
		assert.deepEqual({ ...plain(restored.style[plot.k]), hidden: Boolean(restored.style[plot.k].hidden) }, expected[plot.k]);
		assert.equal(reopened.control(`${ plot.label } 표시`).checked, !expected[plot.k].hidden);
		assert.equal(reopened.control(`${ plot.label } 색`).value, expected[plot.k].color);
		assert.equal(Number(reopened.control(`${ plot.label } 굵기`).value), expected[plot.k].width);
		const series = reopened.pane.inds.find(ind => ind.cfg.id === a.id).series[plot.k];
		assert.deepEqual(series.options, { color: expected[plot.k].color, lineWidth: expected[plot.k].width, visible: !expected[plot.k].hidden });
	}
});

test('RSI 단계 색칠을 끄면 선택한 단색으로 그리고 스타일과 설정이 재실행 뒤에도 남는다', async () => {
	const { c, pane, rows, open, control, stored } = settingsUi();
	pane.addIndicator('bulldan'); const a = c.state.indicators[0], child = c.state.indicators[1];
	open(child.id);
	const stages = all(rows, n => n.tag === 'label' && n.children[0]?.textContent === '단계 색칠')[0].children[1];
	assert.equal(stages.type, 'checkbox'); assert.equal(stages.checked, true);
	const getRsi = () => pane.inds.find(ind => ind.cfg.type === 'bulldanRsi');
	const before = getRsi(), valid = before.out.rsi.findIndex(v => v !== null);
	assert.ok(pane.pointAt(before, before.def.plots[0], valid).color);
	const color = control('RSI 색'), width = control('RSI 굵기');
	assert.ok(color); color.value = '#fedcba'; await color.emit('input');
	width.value = '4'; await width.emit('change');
	stages.checked = false; await stages.emit('change');
	assert.equal(a.params.stageColors, 0); assert.equal(child.params.stageColors, 0);
	const single = getRsi();
	assert.ok(single.out.$colors.rsi.every(v => v === null));
	assert.equal('color' in pane.pointAt(single, single.def.plots[0], valid), false);
	assert.equal(single.series.rsi.options.color, '#fedcba'); assert.equal(single.series.rsi.options.lineWidth, 4);
	assert.deepEqual(plain(single.out.rsi), plain(before.out.rsi));
	assert.deepEqual(plain(single.out.$signalSegs), plain(before.out.$signalSegs));
	for (const [, , fn] of single.def.signals) assert.deepEqual(plain(fn(single.out, { n: pane.bars.length }, single.cfg.params)), plain(fn(before.out, { n: pane.bars.length }, before.cfg.params)));
	c.flushSave();
	const reopened = settingsUi(stored), rsi = reopened.pane.inds.find(ind => ind.cfg.type === 'bulldanRsi');
	assert.equal(rsi.cfg.params.stageColors, 0); assert.equal(rsi.series.rsi.options.color, '#fedcba'); assert.equal(rsi.series.rsi.options.lineWidth, 4);
	assert.ok(rsi.out.$colors.rsi.every(v => v === null));
	reopened.open(rsi.cfg.id); assert.equal(reopened.control('RSI 색').value, '#fedcba');
	const toggle = all(reopened.rows, n => n.tag === 'label' && n.children[0]?.textContent === '단계 색칠')[0].children[1];
	toggle.checked = true; await toggle.emit('change');
	assert.ok(reopened.pane.inds.find(ind => ind.cfg.type === 'bulldanRsi').out.$colors.rsi.some(v => v !== null));
});

test('5,000봉 계산은 모든 선의 길이와 유효값을 유지한다', t => {
	const data = wave(5000), start = performance.now();
	for (const type of ['bulldan', 'bulldanRsi']) {
		const { out, def } = calc(data, { showBoxes: 1, breakout: 1 }, type);
		for (const plot of def.plots) { assert.equal(out[plot.k].length, data.length); assert.ok(out[plot.k].every(v => v === null || Number.isFinite(v))); }
	}
	t.diagnostic(`5,000봉 A+B 계산 ${ (performance.now() - start).toFixed(1) }ms`);
});

function renderUi() {
	const { c, source, pane } = ui();
	Object.assign(c, { cssColors: () => ({ muted: 'gray', font: 'sans-serif', up: 'green', down: 'red' }), LC: { LineSeries: 'line', LineStyle: { Dotted: 1 } }, requestAnimationFrame() {} });
	vm.runInContext(`globalThis.RenderPane = class { ${ source.slice(source.indexOf('\t\tbuildIndicators() {'), source.indexOf('\t\t/** 색, 굵기,')) } }`, c);
	pane.buildIndicators = c.RenderPane.prototype.buildIndicators;
	pane.priceFormat = () => ({});
	const created = [];
	pane.inds = []; pane.layer = { redraw() {} };
	pane.chart = { removeSeries() {}, timeScale: () => ({ logicalToCoordinate: i => i * 3 }), addSeries: (_, options, panel) => {
		const series = { panel, levels: [], attachPrimitive(primitive) { this.primitive = primitive; }, priceToCoordinate: price => price * 2, createPriceLine(level) { this.levels.push(level.price); } };
		created.push(series); return series;
	} };
	pane.buildLegendRow = ind => { ind.row = new Node('div'); };
	for (const key of ['applyScale', 'applyPaneSizes', 'restyleIndicators', 'setIndicatorData', 'updateLegend', 'positionLegends']) pane[key] = () => {};
	return { c, pane, created };
}

test('RSI 단계 변경은 단독·세트의 실제 기준선과 저장 복원에 반영되고 이전 고정값은 무시한다', async () => {
	const app = settingsUi(), { c, pane, rows } = app;
	pane.addIndicator('bulldan'); const parent = c.state.indicators[0];
	app.open(parent.id);
	for (const [label, value] of [['과매도 1단계', 35], ['과매도 2단계', 15], ['과매수 1단계', 65], ['과매수 2단계', 85]]) {
		const input = all(rows, n => n.tag === 'label' && n.children[0]?.textContent === label)[0].children[1];
		input.value = String(value); await input.emit('change');
	}
	c.state.indicators[1].levels = [20, 30, 70, 80];
	c.flushSave();
	const render = renderUi();
	render.c.state = settingsUi(app.stored).c.state;
	render.pane.buildIndicators();
	const setRsi = render.pane.inds.find(ind => ind.cfg.type === 'bulldanRsi');
	assert.deepEqual(setRsi.series.rsi.levels, [15, 35, 65, 85]);
	assert.equal(setRsi.cfg.levels, undefined);
	render.pane.updateIndicator(parent.id, { ...parent.params, os1: 40, os2: 10, ob1: 60, ob2: 90 }); render.pane.buildIndicators();
	assert.deepEqual(render.pane.inds.find(ind => ind.cfg.type === 'bulldanRsi').series.rsi.levels, [10, 40, 60, 90]);
	render.pane.addIndicator('bulldanRsi');
	const standalone = render.c.state.indicators.find(item => item.type === 'bulldanRsi' && !item.companionOf);
	standalone.levels = [1, 2];
	render.pane.updateIndicator(standalone.id, { ...standalone.params, os1: 32, os2: 18, ob1: 68, ob2: 82 }); render.pane.buildIndicators();
	assert.deepEqual(render.pane.inds.find(ind => ind.cfg.id === standalone.id).series.rsi.levels, [18, 32, 68, 82]);
	const regular = render.c.newIndicator('rsi', { levels: [25, 75] });
	render.c.state.indicators.push(regular); render.pane.buildIndicators();
	assert.deepEqual(render.pane.inds.find(ind => ind.cfg.id === regular.id).series.rsi.levels, [25, 75]);
	const single = settingsUi(); single.pane.addIndicator('bulldanRsi'); single.open(single.c.state.indicators[0].id);
	const levels = all(single.rows, n => n.tag === 'label' && n.children[0]?.textContent === '값 (단계 설정을 따름)')[0].children[1];
	assert.equal(levels.readOnly, true); assert.equal(levels.value, '20, 30, 70, 80');
});

test('가격 칸 6개 선과 RSI 칸을 만들고 다이버전스는 RSI 패널 좌표로 그린다', () => {
	const { c, pane, created } = renderUi();
	pane.addIndicator('bulldan'); pane.buildIndicators();
	assert.equal(created.filter(x => x.panel === 0).length, 6);
	assert.equal(created.filter(x => x.panel === 1).length, 1);
	const rsi = pane.inds.find(x => x.def.id === 'bulldanRsi'), series = rsi.series.rsi;
	assert.deepEqual(series.levels, [20, 30, 70, 80]); assert.ok(series.primitive);
	rsi.out = { $draw: { segs: [{ a: 1, b: 3, pa: 20, pb: 25, color: '#22c55e' }] } };
	const coordinates = [], context = new Proxy({}, { get: (_, key) => (...args) => { if (key === 'moveTo' || key === 'lineTo') coordinates.push(args); } });
	series.primitive.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: fn => fn({ context, mediaSize: { width: 500, height: 200 } }) });
	assert.deepEqual(coordinates, [[3, 40], [9, 50]]);
	pane.toggleIndicator(c.state.indicators[0].id); pane.buildIndicators();
	assert.equal(pane.inds.some(x => x.def.id === 'bulldanRsi'), false);
	pane.removeIndicator(c.state.indicators[0].id); pane.buildIndicators(); assert.equal(pane.inds.length, 0);
});
