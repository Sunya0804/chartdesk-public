const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Node, el, all } = require('./dom-helper.cjs');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const indicatorSource = fs.readFileSync(path.join(__dirname, '../public/indicators.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function setup(frameBars) {
	const ctx = vm.createContext({ window: {}, INTERVAL_SECONDS: { '1h': 3600, '4h': 14400 }, TZ_OFFSET: 0, symbolInfo: () => ({}), basisFor: () => ({ bars: frameBars }) });
	vm.runInContext(indicatorSource, ctx);
	ctx.IND = ctx.window.ChartDeskIndicators;
	vm.runInContext(source.match(/\tconst frameable =[^\n]+/)[0], ctx);
	vm.runInContext(source.slice(source.indexOf('\tfunction mergeFrame'), source.indexOf('\t/** 공급원에서 최근 봉')), ctx);
	vm.runInContext(source.slice(source.indexOf('\tfunction barIndexAt'), source.indexOf('\t// ---------- 표시 형식')), ctx);
	vm.runInContext(`globalThis.Pane = class { ${ source.slice(source.indexOf('\t\tpointAt('), source.indexOf('\t\tsetIndicatorData() {')) } }`, ctx);
	return { ctx, IND: ctx.IND, pane: new ctx.Pane() };
}
function data(n) {
	return Array.from({ length: n }, (_, i) => {
		const close = 100 + 18 * Math.sin(i * 0.23) + 10 * Math.sin(i * 0.071);
		return { time: 1600000000 + i * 14400, open: close - Math.sin(i), close, high: close + 1.2, low: close - 1.2, volume: 100 + 80 * Math.sin(i * 0.41) };
	});
}
function indicator(def, params = {}) { return { def, cfg: { type: def.id, tf: '4h', params: Object.fromEntries(def.params.map(p => [p.k, params[p.k] ?? p.def])) } }; }

test('도형은 시작 시각의 첫 차트 봉에 놓고 가격·null·원본은 유지한다', () => {
	const frame = data(4), { pane } = setup(frame);
	pane.cfg = { symbol: 'TEST', interval: '1h' };
	pane.bars = Array.from({ length: 10 }, (_, i) => ({ ...frame[Math.floor((i + 3) / 4)], time: frame[0].time + (i + 3) * 3600 }));
	const draw = { marks: [{ i: 1, price: 123 }], boxes: [{ from: 0, to: null, top: 999, bottom: 777 }], segs: [{ a: 1, b: 2, pa: 100, pb: 101 }], start: 0, events: [{ index: 2 }], spans: [[0, 1]], plan: { index: 1, entries: [100, 200] } };
	const before = plain(draw);
	const ind = indicator({ id: 'fake', plots: [], params: [], calc: () => ({ $draw: draw }) });
	const out = pane.computeOnFrame(ind, '4h', {});
	assert.equal(out.$draw.marks[0].i, 1);
	assert.equal(out.$draw.boxes[0].from, -3);
	assert.equal(out.$draw.boxes[0].to, null);
	assert.equal(out.$draw.boxes[0].top, 999);
	assert.equal(out.$draw.segs[0].a, 1); assert.equal(out.$draw.segs[0].b, 5);
	assert.equal(out.$draw.segs[0].pa, 100); assert.equal(out.$draw.segs[0].pb, 101);
	assert.equal(out.$draw.events[0].index, 5);
	assert.deepEqual(plain(out.$draw.spans), [[-3, 1]]);
	assert.deepEqual(plain(out.$draw.plan.entries), [100, 200]);
	assert.deepEqual(draw, before);
});

test('선과 색을 위 주기 단위로 먼저 이동하고 pointAt에서 두 번 옮기지 않는다', () => {
	const frame = data(4), { pane } = setup(frame);
	pane.cfg = { symbol: 'TEST', interval: '1h' };
	pane.bars = Array.from({ length: 16 }, (_, i) => ({ ...frame[Math.floor(i / 4)], time: frame[0].time + i * 3600 }));
	const ind = indicator({ id: 'fake', params: [], plots: [{ k: 'ahead', shift: () => 1 }, { k: 'back', shift: () => -1 }],
		calc: () => ({ ahead: [10, 20, 30, 40], back: [10, 20, 30, 40], $colors: { ahead: ['a', 'b', 'c', 'd'] } }) });
	ind.out = pane.computeOnFrame(ind, '4h', {});
	assert.deepEqual(plain(ind.out.ahead.slice(0, 8)), [null, null, null, null, 10, 10, 10, 10]);
	assert.deepEqual(plain(ind.out.back.slice(0, 8)), [20, 20, 20, 20, 30, 30, 30, 30]);
	assert.equal(ind.out.$colors.ahead[4], 'a');
	assert.equal(pane.pointAt(ind, ind.def.plots[0], 4).time, pane.bars[4].time);
	ind.framed = false;
	assert.equal(pane.pointAt(ind, ind.def.plots[0], 4).time, pane.bars[5].time);
});

test('실제 FVG·채널·B 돌파는 4시간 차트와 같은 시간·가격에 놓인다', () => {
	const frame = data(350), { pane, IND } = setup(frame);
	pane.cfg = { symbol: 'TEST', interval: '1h' };
	pane.bars = frame.flatMap(bar => Array.from({ length: 4 }, (_, i) => ({ ...bar, time: bar.time + i * 3600 }))).slice(201);
	const indexAt = i => i * 4 - 201;
	for (const id of ['fvg', 'srchannel', 'tlbreaks', 'liqswings', 'divs', 'ict', 'wonyo']) {
		const ind = indicator(IND.byId.get(id), id === 'fvg' ? { threshold: 0.1, mitigated: 1, count: 1000 } : {});
		const high = ind.def.calc(IND.source(frame), ind.cfg.params, { interval: '4h', tzOffset: 0, info: {} });
		const low = pane.computeOnFrame(ind, '4h', {}).$draw;
		assert.ok(low, id);
		for (const [name, items] of Object.entries(high.$draw)) {
			if (!Array.isArray(items) || !items.length || items[0] === null || typeof items[0] !== 'object') continue;
			for (let i = 0; i < items.length; i++) {
				for (const [key, value] of Object.entries(items[i])) {
					if (['i', 'index', 'from', 'to', 'a', 'b'].includes(key) && Number.isFinite(value)) assert.equal(low[name][i][key], indexAt(value), `${ id }.${ name }.${ key }`);
					if (['price', 'top', 'bottom', 'pa', 'pb'].includes(key)) assert.equal(low[name][i][key], value, `${ id } 가격`);
				}
			}
		}
		if (id === 'fvg' || id === 'srchannel') assert.ok(high.$draw.boxes.length > 0, `${ id } 상자`);
		if (id === 'tlbreaks') assert.ok(high.$draw.marks.some(mark => mark.text === 'B'));
		if (id === 'wonyo') {
			assert.equal(low.upper.length, pane.bars.length);
			assert.equal(low.upper[0], high.$draw.upper[50]);
			for (let k = 0; k < high.$draw.spans.length; k++) assert.deepEqual(plain(low.spans[k]), plain(high.$draw.spans[k].map(indexAt)));
		}
	}
});

test('주기 선택은 작도·shift 지표에 열리고 매물대만 제외한다', () => {
	const { ctx, pane, IND } = setup(data(50));
	pane.cfg = { symbol: 'TEST', interval: '1h' };
	for (const id of ['fvg', 'srchannel', 'tlbreaks', 'liqswings', 'divs', 'ict', 'wonyo', 'srbreaks', 'ichimoku']) {
		const def = IND.byId.get(id); if (!def) continue;
		assert.equal(pane.frameOf(indicator(def)), '4h', id);
	}
	assert.equal(pane.frameOf(indicator(IND.byId.get('vpsr'))), null);
	const def = IND.byId.get('fvg'), ind = indicator(def);
	pane.bars = data(10); pane.inds = [ind]; pane.dead = false;
	pane.cfg.interval = '4h'; pane.computeIndicators(); assert.equal(ind.framed, false);
	const rows = new Node('div');
	Object.assign(ctx, { state: { indicators: [{ ...ind.cfg, id: 'fvg', style: {} }] }, el, field: (label, control) => el('label', {}, el('span', { text: label }), control),
		numberInput: () => el('input'), checkInput: () => el('input'), colorInput: () => el('input'), WIDTH_OPTIONS: [],
		selectInput: (value, options) => el('select', { value }, ...options.map(([value, text]) => el('option', { value, text }))),
		INTERVALS: [['4h', '4시간']], popover: {}, openPopover: (_, ...children) => rows.replaceChildren(...children) });
	vm.runInContext(source.slice(source.indexOf('\tfunction openIndicatorSettings'), source.indexOf('\t// ---------- 작도 ----------')), ctx);
	ctx.anchor = {}; ctx.pane = { styleOf: () => ({}) };
	vm.runInContext("openIndicatorSettings(anchor,pane,'fvg')", ctx);
	assert.ok(all(rows, node => node.tag === 'option' && node.value === '4h').length);
});
