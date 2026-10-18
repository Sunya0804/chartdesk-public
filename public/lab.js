// 전략 백테스트와 스크리너. 조건은 rules.js의 모양을 쓰고, 조건을 고르는 편집기는 조건 알림도 함께 쓴다.
window.ChartDeskLab = (() => {
	'use strict';

	const APP = window.ChartDeskApp;
	const IND = window.ChartDeskIndicators;
	const RULES = window.ChartDeskRules;
	const { el } = APP;
	const STORAGE_KEY = 'chartdesk.lab.v1';

	function loadSettings() {
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
			return {
				strategy: RULES.cleanStrategy(saved.strategy),
				period: typeof saved.period === 'string' ? saved.period : '1y',
				screen: saved.screen && typeof saved.screen === 'object' ? saved.screen : {},
			};
		}
		catch {
			return { strategy: null, period: '1y', screen: {} };
		}
	}

	const settings = loadSettings();
	const saveSettings = () => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		}
		catch {
			// 저장하지 못해도 이번에는 쓸 수 있다.
		}
	};

	// ---------- 입력 요소 ----------

	function select(value, options, onChange, props = {}) {
		const node = el('select', props, ...options.map(([id, label]) => el('option', { value: String(id), text: label })));
		node.value = String(value);
		node.addEventListener('change', () => onChange(node.value));
		return node;
	}

	function number(value, onChange, props = {}) {
		const node = el('input', { type: 'number', step: 'any', value: String(value), ...props });
		node.addEventListener('change', () => {
			const parsed = Number(node.value);
			if (Number.isFinite(parsed)) onChange(parsed);
		});
		return node;
	}

	const GROUP_NAMES = { personal: '개인 지표', custom: '커스텀 지표' };

	/** 지표 고르기. 기술적 지표는 분류별로, 개인·커스텀 지표는 따로 묶는다. */
	function indicatorSelect(value, onChange, definitions = RULES.usableDefs()) {
		const node = el('select', { class: 'ind-pick' });
		const groups = new Map();
		for (const def of definitions) {
			const group = GROUP_NAMES[def.group] ?? def.cat;
			if (!groups.has(group)) groups.set(group, []);
			groups.get(group).push(def);
		}
		for (const [label, defs] of groups) {
			const optgroup = el('optgroup');
			optgroup.label = label;
			for (const def of defs) optgroup.append(el('option', { value: def.id, text: `${ def.short } · ${ def.ko }` }));
			node.append(optgroup);
		}
		node.value = value;
		node.addEventListener('change', () => onChange(node.value));
		return node;
	}

	/** 피연산자 하나: 지표 선, 봉 값, 고정 값. onChange(새 피연산자). */
	function operandEditor(initial, onChange) {
		let operand = initial;
		const box = el('span', { class: 'operand' });
		const set = (next) => {
			operand = next;
			onChange(operand);
			render();
		};
		const render = () => {
			const parts = [select(operand.kind, [['ind', '지표'], ['price', '가격'], ['value', '값']], (kind) => {
				if (kind === 'ind') set(RULES.cleanOperand({ kind: 'ind', type: 'rsi' }));
				else if (kind === 'price') set({ kind: 'price', field: 'close' });
				else set({ kind: 'value', value: 0 });
			}, { class: 'operand-kind' })];
			if (operand.kind === 'ind') {
				const def = IND.byId.get(operand.type);
				parts.push(indicatorSelect(operand.type, type => set(RULES.cleanOperand({ kind: 'ind', type }))));
				for (const param of def.params) {
					parts.push(number(operand.params[param.k], (value) => {
						operand.params[param.k] = value;
						onChange(operand);
					}, { class: 'param', title: param.label, 'aria-label': param.label }));
				}
				const plots = RULES.usablePlots(def);
				if (plots.length > 1) {
					parts.push(select(operand.plot, plots.map(plot => [plot.k, plot.label]), (plot) => {
						operand.plot = plot;
						onChange(operand);
					}));
				}
			}
			else if (operand.kind === 'price') {
				parts.push(select(operand.field, RULES.PRICE_FIELDS, (field) => {
					operand.field = field;
					onChange(operand);
				}));
			}
			else {
				parts.push(number(operand.value, (value) => {
					operand.value = value;
					onChange(operand);
				}, { class: 'value' }));
			}
			box.replaceChildren(...parts);
		};
		render();
		return box;
	}

	const defaultCond = () => RULES.cleanCond({ kind: 'compare', left: { kind: 'ind', type: 'rsi' }, op: 'lt', right: { kind: 'value', value: 30 } });

	/** 조건 하나를 고치는 편집기. value()로 지금 조건을 읽는다. */
	function condEditor(initial) {
		let cond = structuredClone(initial ?? defaultCond());
		const node = el('div', { class: 'cond' });
		const render = () => {
			const kind = select(cond.kind, [['compare', '비교'], ['gosu', 'GOSU 타점 신호'], ['signal', '지표 신호']], (value) => {
				const def = RULES.signalDefs()[0];
				cond = value === 'signal' ? RULES.cleanCond({ kind: 'signal', type: def.id, signal: def.signals[0][0] })
					: value === 'gosu' ? { kind: 'gosu', signal: 'any' } : defaultCond();
				render();
			}, { class: 'cond-kind' });
			if (cond.kind === 'signal') {
				const def = IND.byId.get(cond.type);
				const parts = [kind, indicatorSelect(cond.type, (type) => {
					const next = IND.byId.get(type);
					cond = RULES.cleanCond({ kind: 'signal', type, signal: next.signals[0][0] });
					render();
				}, RULES.signalDefs()), select(cond.signal, def.signals.map(([id, label]) => [id, label]), (signal) => {
					cond.signal = signal;
				})];
				for (const param of def.params) {
					parts.push(number(cond.params[param.k], (value) => {
						cond.params = RULES.cleanParams(def, { ...cond.params, [param.k]: value });
					}, { class: 'param', title: param.label, 'aria-label': param.label, min: param.min, step: param.step ?? 'any' }));
				}
				node.replaceChildren(...parts);
				return;
			}
			if (cond.kind === 'gosu') {
				node.replaceChildren(kind, select(cond.signal, RULES.GOSU_SIGNALS, (signal) => {
					cond.signal = signal;
				}));
				return;
			}
			node.replaceChildren(
				kind,
				operandEditor(cond.left, (operand) => {
					cond.left = operand;
				}),
				select(cond.op, RULES.OPS, (op) => {
					cond.op = op;
				}, { class: 'cond-op' }),
				operandEditor(cond.right, (operand) => {
					cond.right = operand;
				}));
		};
		render();
		return { node, value: () => cond };
	}

	/** 조건 여러 개. 줄마다 지우기 버튼이 있고, 아래에 추가 버튼이 있다. */
	function condList(conds, addLabel = '+ 조건 추가') {
		const list = el('div', { class: 'cond-list' });
		let editors = [];
		const add = (cond) => {
			const editor = condEditor(cond);
			const row = el('div', { class: 'cond-row' }, editor.node, el('button', {
				class: 'icon-btn',
				title: '조건 지우기',
				text: '×',
				onclick: () => {
					editors = editors.filter(item => item !== editor);
					row.remove();
				},
			}));
			editors.push(editor);
			list.append(row);
		};
		conds.forEach(add);
		const node = el('div', {}, list, el('button', { class: 'text-btn small', text: addLabel, onclick: () => add(null) }));
		return {
			node,
			value: () => editors.map(editor => RULES.cleanCond(editor.value())).filter(Boolean),
			reset: (next) => {
				editors = [];
				list.replaceChildren();
				next.forEach(add);
			},
		};
	}

	// ---------- 창 ----------

	let modal = null;

	function openModal(title, ...content) {
		closeModal();
		APP.closePopover();
		const close = el('button', { class: 'icon-btn', title: '닫기 (Esc)', text: '×', onclick: closeModal });
		const box = el('div', { class: 'lab' }, el('div', { class: 'lab-head' }, el('b', { text: title }), el('span', { class: 'spacer' }), close), el('div', { class: 'lab-body' }, ...content));
		modal = el('div', { class: 'lab-backdrop' }, box);
		modal.addEventListener('mousedown', (event) => {
			if (event.target === modal) closeModal();
		});
		document.body.append(modal);
	}

	function closeModal() {
		modal?.remove();
		modal = null;
	}

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && modal) {
			event.stopPropagation();
			closeModal();
		}
	}, true);

	const section = (title, ...content) => el('section', { class: 'lab-section' }, el('h3', { text: title }), ...content);
	const percent = (value, digits = 2) => `${ value >= 0 ? '+' : '' }${ (value * 100).toFixed(digits) }%`;
	const when = time => new Date((time - APP.tzOffset) * 1000).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

	// ---------- 백테스트 ----------

	const PERIODS = [['loaded', '차트에 불러온 봉'], ['3m', '최근 3개월'], ['6m', '최근 6개월'], ['1y', '최근 1년'], ['2y', '최근 2년'], ['3y', '최근 3년']];
	const PERIOD_DAYS = { '3m': 91, '6m': 182, '1y': 365, '2y': 730, '3y': 1095 };

	const EXAMPLE = RULES.cleanStrategy({
		name: 'RSI 반등',
		side: 'long',
		entry: [{ kind: 'compare', left: { kind: 'ind', type: 'rsi' }, op: 'crossUp', right: { kind: 'value', value: 30 } }],
		exit: [{ kind: 'compare', left: { kind: 'ind', type: 'rsi' }, op: 'crossDown', right: { kind: 'value', value: 70 } }],
		stopLoss: 3,
		takeProfit: 0,
		fee: 0.1,
	});

	/** 기간만큼 과거 봉을 이어 받는다. 공급원이 과거 이어 받기를 못 하면 차트의 봉을 그대로 쓴다. */
	async function history(pane, period, progress) {
		let bars = pane.bars.slice();
		if (period === 'loaded' || pane.noPaging || bars.length === 0) return bars;
		const seconds = APP.INTERVAL_SECONDS[pane.interval];
		const need = Math.ceil(PERIOD_DAYS[period] * 86400 / seconds);
		for (let page = 0; bars.length < need && page < 80; page++) {
			progress(`과거 봉 받는 중… ${ bars.length.toLocaleString() } / ${ need.toLocaleString() }`);
			const first = bars[0].time;
			let older;
			try {
				older = (await APP.loadBars(pane.symbol, pane.interval, (first - APP.tzOffset) * 1000 - 1)).bars.filter(bar => bar.time < first);
			}
			catch {
				break;
			}
			if (older.length === 0) break;
			bars = older.concat(bars);
		}
		return bars.slice(-need);
	}

	function openBacktest() {
		const pane = APP.pane();
		if (!pane) return;
		const start = settings.strategy ?? EXAMPLE;
		const side = select(start.side, [['long', '롱 (매수)'], ['short', '숏 (매도)']], () => {});
		const entry = condList(start.entry);
		const exit = condList(start.exit);
		const stopLoss = number(start.stopLoss, () => {}, { min: '0' });
		const takeProfit = number(start.takeProfit, () => {}, { min: '0' });
		const fee = number(start.fee, () => {}, { min: '0' });
		const period = select(settings.period, PERIODS, () => {});
		const runButton = el('button', { class: 'primary', text: '백테스트 실행' });
		const status = el('p', { class: 'hint' });
		const results = el('div', { class: 'bt-results' });
		let name = start.name;

		const read = () => RULES.cleanStrategy({
			name,
			side: side.value,
			entry: entry.value(),
			exit: exit.value(),
			stopLoss: Number(stopLoss.value),
			takeProfit: Number(takeProfit.value),
			fee: Number(fee.value),
		});
		const fill = (strategy) => {
			name = strategy.name;
			side.value = strategy.side;
			entry.reset(strategy.entry);
			exit.reset(strategy.exit);
			stopLoss.value = String(strategy.stopLoss);
			takeProfit.value = String(strategy.takeProfit);
			fee.value = String(strategy.fee);
		};

		// AI로 만들기
		const idea = el('textarea', { rows: '2', placeholder: '예: 20일 이평이 50일 이평을 상향 돌파하면 사고, RSI가 70을 넘었다가 내려오면 판다. 손절 3%, 1년' });
		const aiButton = el('button', { class: 'text-btn', text: 'AI로 전략 만들기' });
		const aiNote = el('p', { class: 'hint', text: window.ChartDeskAI ? `AI 분석 창에서 고른 ${ window.ChartDeskAI.label() }로 문장을 조건으로 바꿉니다.` : '' });
		aiButton.addEventListener('click', async () => {
			if (!idea.value.trim()) return;
			aiButton.disabled = true;
			aiNote.textContent = 'AI가 전략을 만드는 중…';
			try {
				const made = await strategyFromText(idea.value, pane);
				fill(made.strategy);
				if (made.period) period.value = made.period;
				aiNote.textContent = `만든 전략: ${ made.strategy.name || '이름 없음' }${ made.note ? ` · AI 메모: ${ made.note }` : '' }`;
				await run();
			}
			catch (error) {
				aiNote.textContent = error.message;
			}
			aiButton.disabled = false;
		});

		const run = async () => {
			const strategy = read();
			if (!strategy) {
				status.textContent = '진입 조건을 하나 이상 넣으세요.';
				return;
			}
			const target = APP.pane();
			if (!target) return;
			settings.strategy = strategy;
			settings.period = period.value;
			saveSettings();
			runButton.disabled = true;
			results.replaceChildren();
			try {
				const bars = await history(target, period.value, (text) => {
					status.textContent = text;
				});
				if (bars.length < 30) throw new Error('봉이 너무 적습니다. 기간을 늘리거나 차트를 왼쪽으로 끌어 과거 봉을 더 불러오세요.');
				status.textContent = '계산 중…';
				await new Promise(resolve => setTimeout(resolve));
				const context = { tzOffset: APP.tzOffset, symbol: target.symbol, interval: target.interval, info: APP.symbolInfo(target.symbol) };
				const result = RULES.backtest(bars, strategy, context);
				status.textContent = `${ APP.symbolTitle(target.symbol) } · ${ APP.intervalLabel(target.interval) }봉 ${ bars.length.toLocaleString() }개 (${ when(bars[0].time) } ~ ${ when(bars[bars.length - 1].time) })${ target.noPaging && period.value !== 'loaded' ? ' · 이 종목은 과거 봉을 더 받을 수 없어 차트의 봉만 썼습니다' : '' }`;
				showResults(results, result, bars, strategy, target);
			}
			catch (error) {
				status.textContent = error.message;
			}
			runButton.disabled = false;
		};
		runButton.addEventListener('click', run);

		openModal(`전략 백테스트 · ${ APP.symbolTitle(pane.symbol) } ${ APP.intervalLabel(pane.interval) }봉`,
			section('AI로 만들기', idea, el('div', { class: 'lab-row' }, aiButton), aiNote),
			section('전략',
				el('div', { class: 'lab-grid' },
					el('label', {}, el('span', { text: '방향' }), side),
					el('label', {}, el('span', { text: '손절 %' }), stopLoss),
					el('label', {}, el('span', { text: '익절 %' }), takeProfit),
					el('label', {}, el('span', { text: '수수료 % (한 번)' }), fee),
					el('label', {}, el('span', { text: '기간' }), period)),
				el('h4', { text: '진입: 아래 조건이 모두 맞으면' }), entry.node,
				el('h4', { text: '청산: 아래 조건 중 하나라도 맞으면 (손절·익절과 함께)' }), exit.node,
				el('p', { class: 'hint', text: '조건은 봉이 마감된 값으로 보고, 다음 봉 시가에 사고팝니다. 손절·익절은 봉 안에서 그 가격에 닿으면 그 가격에 나옵니다. 매번 자산 전체를 넣는다고 보고 수익을 복리로 쌓습니다. 미끄러짐(슬리피지)과 자금 조달 수수료는 빠져 있습니다.' }),
				el('div', { class: 'lab-row' }, runButton)),
			status,
			results);
	}

	/** AI에게 문장을 전략 JSON으로 바꿔 달라고 한다. */
	async function strategyFromText(text, pane) {
		if (!window.ChartDeskAI) throw new Error('AI 창을 불러오지 못했습니다.');
		const system = '너는 매매 전략 설명을 ChartDesk 백테스트용 JSON으로 바꾸는 변환기다. 설명이나 다른 글 없이 JSON 객체 하나만 출력한다.';
		const prompt = [
			`차트: ${ APP.symbolTitle(pane.symbol) } ${ APP.intervalLabel(pane.interval) }봉 (주기는 바꿀 수 없다)`,
			'',
			'출력 형식:',
			'{"name": "짧은 이름", "side": "long" 또는 "short", "entry": [조건...], "exit": [조건...], "stopLoss": 손절 %(없으면 0), "takeProfit": 익절 %(없으면 0), "fee": 한 번 거래 수수료 %(모르면 0.1), "period": "3m"|"6m"|"1y"|"2y"|"3y"(말하지 않으면 "1y"), "note": "바꾸거나 뺀 부분이 있으면 한국어로 짧게, 없으면 빈 글"}',
			'- entry는 모두 맞을 때 진입한다. exit는 하나라도 맞으면 청산한다. 청산 조건이 없으면 [].',
			'- 조건: {"kind": "compare", "left": 피연산자, "op": "crossUp"(상향 돌파) | "crossDown"(하향 돌파) | "gt"(크다) | "lt"(작다), "right": 피연산자} 또는 {"kind": "gosu", "signal": "any" | "dip" | "roll" | "trend"} (GOSU 지표의 타점 신호)',
			'- 지표 신호 조건: {"kind":"signal","type":"지표 id","params":{},"signal":"신호 id"}. 아래 signals 목록에 있는 id만 쓴다. 예: {"kind":"signal","type":"utbot","params":{},"signal":"up"}. params는 지표 입력값이며 생략한 값은 기본값을 쓴다.',
			'- 피연산자: {"kind": "ind", "type": 지표 id, "params": {입력값}, "plot": 선 키} | {"kind": "price", "field": "close" | "open" | "high" | "low" | "volume"} | {"kind": "value", "value": 숫자}',
			'- 조건은 봉이 마감된 값으로 본다. 아래 목록에 없는 지표 id나 선 키를 지어내지 마라. 표현할 수 없는 부분은 가장 가까운 조건으로 바꾸고 note에 적어라.',
			'',
			'쓸 수 있는 지표 (id: 이름 | params: 기본값 | plots: 선 키(이름)):',
			RULES.catalogText(),
			'',
			'전략 설명:',
			text.trim(),
		].join('\n');
		const reply = await window.ChartDeskAI.ask(system, prompt);
		const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
		const body = fenced ? fenced[1] : reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
		let parsed;
		try {
			parsed = JSON.parse(body);
		}
		catch {
			throw new Error(`AI 답을 전략으로 읽지 못했습니다: ${ reply.slice(0, 200) }`);
		}
		const strategy = RULES.cleanStrategy(parsed);
		if (!strategy) throw new Error('AI가 만든 전략에 쓸 수 있는 진입 조건이 없습니다. 조금 더 구체적으로 적어 보세요.');
		const period = PERIOD_DAYS[parsed.period] ? parsed.period : null;
		return { strategy, period, note: typeof parsed.note === 'string' ? parsed.note : '' };
	}

	function showResults(box, result, bars, strategy, pane) {
		const stat = (label, value, tone = '') => el('div', { class: 'bt-stat' }, el('small', { text: label }), el('b', { class: tone, text: value }));
		const tone = value => (value > 0 ? 'up' : value < 0 ? 'down' : '');
		const stats = el('div', { class: 'bt-stats' },
			stat('총 수익률', percent(result.total), tone(result.total)),
			stat('단순 보유', percent(result.buyHold), tone(result.buyHold)),
			stat('거래 수', `${ result.trades.length }${ result.open ? ' (+진행 중 1)' : '' }`),
			stat('승률', result.trades.length ? `${ (result.winRate * 100).toFixed(1) }%` : '–'),
			stat('손익비 (PF)', result.trades.length ? (Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : '∞') : '–'),
			stat('최대 낙폭', percent(result.maxDrawdown), 'down'),
			stat('평균 수익', result.avgWin ? percent(result.avgWin) : '–', 'up'),
			stat('평균 손실', result.avgLoss ? percent(result.avgLoss) : '–', 'down'),
			stat('평균 보유', result.trades.length ? `${ result.avgBars.toFixed(1) }봉` : '–'));

		const canvas = el('canvas', { class: 'bt-equity' });
		requestAnimationFrame(() => drawEquity(canvas, result.equity, bars));

		// 차트에 거래 표시
		const markers = [];
		for (const trade of result.trades.concat(result.open ? [result.open] : [])) {
			const long = strategy.side === 'long';
			markers.push({ time: trade.time, position: long ? 'belowBar' : 'aboveBar', color: long ? '#22c55e' : '#ef4444', shape: long ? 'arrowUp' : 'arrowDown', text: long ? '매수' : '매도' });
			if (trade.exitTime !== undefined) {
				markers.push({ time: trade.exitTime, position: long ? 'aboveBar' : 'belowBar', color: trade.ret > 0 ? '#22c55e' : '#ef4444', shape: 'circle', text: `${ trade.reason === '청산 조건' ? '' : `${ trade.reason } ` }${ percent(trade.ret, 1) }` });
			}
		}
		markers.sort((a, b) => a.time - b.time);
		const show = el('input', { type: 'checkbox' });
		show.checked = true;
		const apply = () => {
			const target = APP.pane();
			if (!target || target.symbol !== pane.symbol || target.interval !== pane.interval) return;
			if (show.checked) {
				target.prependBars(bars);
				target.showTrades(markers);
			}
			else target.clearTrades();
		};
		show.addEventListener('change', apply);
		apply();

		const rows = result.trades.slice().reverse().map((trade, i) => el('tr', { class: 'clickable', title: '차트에서 보기', onclick: () => APP.pane()?.scrollToTime(trade.time) },
			el('td', { text: String(result.trades.length - i) }),
			el('td', { text: `${ when(trade.time) } · ${ APP.formatPrice(trade.price, pane.precision) }` }),
			el('td', { text: `${ when(trade.exitTime) } · ${ APP.formatPrice(trade.exitPrice, pane.precision) }` }),
			el('td', { class: tone(trade.ret), text: percent(trade.ret) }),
			el('td', { text: trade.reason })));
		if (result.open) {
			rows.unshift(el('tr', { class: 'clickable', onclick: () => APP.pane()?.scrollToTime(result.open.time) },
				el('td', { text: '진행' }),
				el('td', { text: `${ when(result.open.time) } · ${ APP.formatPrice(result.open.price, pane.precision) }` }),
				el('td', { text: '아직 보유 중' }),
				el('td', { class: tone(result.open.ret), text: percent(result.open.ret) }),
				el('td', { text: '평가 손익' })));
		}
		const table = el('div', { class: 'bt-table' }, el('table', {},
			el('thead', {}, el('tr', {}, ...['#', '진입', '청산', '수익률', '사유'].map(text => el('th', { text })))),
			el('tbody', {}, ...rows)));

		// AI 해설
		const explain = el('button', { class: 'text-btn', text: 'AI에게 결과 해설 받기' });
		const explanation = el('div', { class: 'bt-ai hint' });
		explain.addEventListener('click', async () => {
			explain.disabled = true;
			explanation.textContent = 'AI가 결과를 읽는 중…';
			try {
				const summary = [
					`종목: ${ APP.symbolTitle(pane.symbol) } ${ APP.intervalLabel(pane.interval) }봉, 기간 ${ when(bars[0].time) } ~ ${ when(bars[bars.length - 1].time) } (${ bars.length }봉)`,
					`방향: ${ strategy.side === 'long' ? '롱' : '숏' }`,
					`진입(모두): ${ strategy.entry.map(RULES.describe).join(' 그리고 ') }`,
					`청산(하나라도): ${ strategy.exit.map(RULES.describe).join(' 또는 ') || '없음' }, 손절 ${ strategy.stopLoss || '없음' }%, 익절 ${ strategy.takeProfit || '없음' }%, 수수료 ${ strategy.fee }%`,
					`결과: 총 수익 ${ percent(result.total) }, 단순 보유 ${ percent(result.buyHold) }, 거래 ${ result.trades.length }회, 승률 ${ (result.winRate * 100).toFixed(1) }%, 손익비 ${ Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : '∞' }, 최대 낙폭 ${ percent(result.maxDrawdown) }, 평균 수익 ${ percent(result.avgWin) }, 평균 손실 ${ percent(result.avgLoss) }, 평균 보유 ${ result.avgBars.toFixed(1) }봉`,
				].join('\n');
				explanation.textContent = await window.ChartDeskAI.ask(
					'너는 신중한 퀀트 분석가다. 한국어로 짧고 쉽게 답한다. 과최적화와 표본 부족을 꼭 짚고, 수익을 장담하지 않는다.',
					`아래 백테스트 결과를 5줄 안팎으로 해설해 줘. 1) 이 결과를 믿을 만한지(거래 수, 기간, 단순 보유와 비교) 2) 약점 3) 다음에 바꿔 볼 것 하나.\n\n${ summary }`);
			}
			catch (error) {
				explanation.textContent = error.message;
			}
			explain.disabled = false;
		});

		box.replaceChildren(
			stats,
			canvas,
			el('div', { class: 'lab-row' }, el('label', { class: 'check' }, show, el('span', { text: '차트에 거래 표시' })), el('span', { class: 'spacer' }), explain),
			explanation,
			result.trades.length || result.open ? table : el('p', { class: 'hint', text: '이 기간에는 조건이 맞은 봉이 없었습니다.' }));
	}

	/** 자산 곡선(전략)과 단순 보유 곡선. */
	function drawEquity(canvas, equity, bars) {
		const ratio = window.devicePixelRatio || 1;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (!width || !height) return;
		canvas.width = width * ratio;
		canvas.height = height * ratio;
		const context = canvas.getContext('2d');
		context.scale(ratio, ratio);
		const style = getComputedStyle(document.documentElement);
		const hold = bars.map(bar => bar.close / bars[0].open);
		const values = equity.concat(hold);
		const [low, high] = [Math.min(...values), Math.max(...values)];
		const x = i => (i / Math.max(1, equity.length - 1)) * (width - 8) + 4;
		const y = value => height - 6 - ((value - low) / (high - low || 1)) * (height - 12);
		const line = (series, color, widthPx) => {
			context.strokeStyle = color;
			context.lineWidth = widthPx;
			context.beginPath();
			series.forEach((value, i) => (i ? context.lineTo(x(i), y(value)) : context.moveTo(x(i), y(value))));
			context.stroke();
		};
		context.strokeStyle = style.getPropertyValue('--border').trim();
		context.setLineDash([3, 3]);
		context.beginPath();
		context.moveTo(0, y(1));
		context.lineTo(width, y(1));
		context.stroke();
		context.setLineDash([]);
		line(hold, style.getPropertyValue('--muted').trim(), 1);
		line(equity, style.getPropertyValue('--accent').trim(), 2);
		context.font = '11px sans-serif';
		context.fillStyle = style.getPropertyValue('--accent').trim();
		context.fillText('전략', 8, 14);
		context.fillStyle = style.getPropertyValue('--muted').trim();
		context.fillText('단순 보유', 40, 14);
	}

	// ---------- 스크리너 ----------

	const UNIVERSES = [
		['watchlist', '관심종목'],
		['binance', 'Binance 현물 USDT 거래대금 상위 30'],
		['binancef', 'Binance 선물 거래대금 상위 30'],
		['upbit', 'Upbit 원화 거래대금 상위 30'],
		['bybitf', 'Bybit 선물 거래대금 상위 30'],
	];

	const cmp = (left, op, right) => ({ kind: 'compare', left, op, right });
	const ind = (type, params, plot) => ({ kind: 'ind', type, params, plot });
	const value = number => ({ kind: 'value', value: number });
	const close = { kind: 'price', field: 'close' };
	const PRESETS = [
		['', '빠른 조건 고르기…', null],
		['oversold', 'RSI 과매도 (RSI < 30)', [cmp(ind('rsi'), 'lt', value(30))]],
		['overbought', 'RSI 과매수 (RSI > 70)', [cmp(ind('rsi'), 'gt', value(70))]],
		['golden', 'EMA 20/50 골든크로스', [cmp(ind('ema', { length: 20 }), 'crossUp', ind('ema', { length: 50 }))]],
		['dead', 'EMA 20/50 데드크로스', [cmp(ind('ema', { length: 20 }), 'crossDown', ind('ema', { length: 50 }))]],
		['bblow', '볼린저 하단 아래 (종가 < 하단)', [cmp(close, 'lt', ind('bb', {}, 'lower'))]],
		['bbhigh', '볼린저 상단 위 (종가 > 상단)', [cmp(close, 'gt', ind('bb', {}, 'upper'))]],
		['macd', 'MACD 시그널 상향 돌파', [cmp(ind('macd', {}, 'macd'), 'crossUp', ind('macd', {}, 'signal'))]],
		['supertrend', '슈퍼트렌드 위 (상승 추세)', [cmp(close, 'gt', ind('supertrend'))]],
		['trend200', '200 EMA 위에서 RSI 50 상향 돌파', [cmp(close, 'gt', ind('ema', { length: 200 })), cmp(ind('rsi'), 'crossUp', value(50))]],
		['gosu', 'GOSU 타점 신호', [{ kind: 'gosu', signal: 'any' }]],
		['utbot-up', 'UT 봇 상승 전환', [{ kind: 'signal', type: 'utbot', signal: 'up' }]],
		['cipherb-buy', 'Cipher B 매수 점', [{ kind: 'signal', type: 'cipherb', signal: 'up' }]],
		['squeeze-up', '스퀴즈 해제 (위쪽)', [{ kind: 'signal', type: 'squeeze', signal: 'fireUp' }]],
		['stai-up', '슈퍼트렌드 AI 상승 전환', [{ kind: 'signal', type: 'stai', signal: 'up' }]],
	];

	async function universe(kind) {
		const json = async (url) => {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${ response.status }`);
			return response.json();
		};
		// 스테이블코인과 법정화폐 짝은 조건 검색에 의미가 없어 뺀다.
		const stable = /^(USDC|FDUSD|TUSD|BUSD|DAI|USDP|EUR|AEUR|USDE|USD1|XUSD|BFUSD|U|RLUSD|PYUSD|USDS|EURI|GBP|TRY|BRL)USDT$/;
		if (kind === 'watchlist') return APP.watchlist().map(id => ({ id, change: APP.quote(id)?.change ?? null }));
		if (kind === 'binance') {
			const rows = await json('https://data-api.binance.vision/api/v3/ticker/24hr');
			return rows.filter(row => row.symbol.endsWith('USDT') && !stable.test(row.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(row.symbol))
				.sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume)).slice(0, 30)
				.map(row => ({ id: `BINANCE:${ row.symbol }`, change: Number(row.priceChangePercent) }));
		}
		if (kind === 'binancef') {
			const rows = await json('https://fapi.binance.com/fapi/v1/ticker/24hr');
			return rows.filter(row => row.symbol.endsWith('USDT') && !stable.test(row.symbol))
				.sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume)).slice(0, 30)
				.map(row => ({ id: `BINANCEF:${ row.symbol }`, change: Number(row.priceChangePercent) }));
		}
		if (kind === 'upbit') {
			const markets = (await json('https://api.upbit.com/v1/market/all')).filter(row => row.market.startsWith('KRW-')).map(row => row.market);
			const rows = await json(`https://api.upbit.com/v1/ticker?markets=${ markets.join(',') }`);
			return rows.sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h).slice(0, 30)
				.map(row => ({ id: `UPBIT:${ row.market }`, change: row.signed_change_rate * 100 }));
		}
		if (kind === 'bybitf') {
			const rows = (await json('https://api.bybit.com/v5/market/tickers?category=linear')).result.list;
			return rows.filter(row => row.symbol.endsWith('USDT'))
				.sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h)).slice(0, 30)
				.map(row => ({ id: `BYBITF:${ row.symbol }`, change: Number(row.price24hPcnt) * 100 }));
		}
		return [];
	}

	/** 한 번에 limit개씩 돌린다(거래소 요청 제한). */
	async function pool(items, limit, work) {
		let next = 0;
		const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				await work(items[i], i);
			}
		});
		await Promise.all(runners);
	}

	function openScreener() {
		const pane = APP.pane();
		const saved = settings.screen;
		const conds = (Array.isArray(saved.conds) ? saved.conds : PRESETS[1][2]).map(RULES.cleanCond).filter(Boolean);
		const target = select(UNIVERSES.some(([id]) => id === saved.universe) ? saved.universe : 'binance', UNIVERSES, () => {});
		const interval = select(APP.INTERVAL_SECONDS[saved.interval] ? saved.interval : pane?.interval ?? '1h', APP.INTERVALS, () => {});
		const list = condList(conds.length ? conds : [defaultCond()]);
		const preset = select('', PRESETS.map(([id, label]) => [id, label]), (id) => {
			const found = PRESETS.find(([key]) => key === id);
			if (found?.[2]) list.reset(found[2].map(RULES.cleanCond));
			preset.value = '';
		});
		const lookback = select(saved.lookback ?? 1, [[1, '마지막 마감 봉'], [3, '최근 3봉 안'], [5, '최근 5봉 안'], [10, '최근 10봉 안']], () => {});
		const live = el('input', { type: 'checkbox' });
		live.checked = saved.live === true;
		const runButton = el('button', { class: 'primary', text: '검색' });
		const status = el('p', { class: 'hint' });
		const results = el('div', { class: 'bt-table' });
		let running = false;

		const run = async () => {
			if (running) return;
			const chosen = list.value();
			if (chosen.length === 0) {
				status.textContent = '조건을 하나 이상 넣으세요.';
				return;
			}
			settings.screen = { universe: target.value, interval: interval.value, conds: chosen, lookback: Number(lookback.value), live: live.checked };
			saveSettings();
			running = true;
			runButton.disabled = true;
			results.replaceChildren();
			const frame = interval.value;
			const seconds = APP.INTERVAL_SECONDS[frame];
			const back = Number(lookback.value);
			const shown = chosen.filter(cond => cond.kind === 'compare');
			let symbols;
			try {
				status.textContent = '종목 목록 받는 중…';
				symbols = await universe(target.value);
			}
			catch (error) {
				status.textContent = `종목 목록을 받지 못했습니다: ${ error.message }`;
				running = false;
				runButton.disabled = false;
				return;
			}
			if (symbols.length === 0) {
				status.textContent = '대상 종목이 없습니다. 관심종목을 추가하세요.';
				running = false;
				runButton.disabled = false;
				return;
			}
			const found = [];
			let done = 0;
			let failed = 0;
			await pool(symbols, 4, async (item) => {
				try {
					const { bars, precision } = await APP.loadBars(item.id, frame);
					const now = Date.now() / 1000 + APP.tzOffset;
					const last = bars[bars.length - 1];
					const use = !live.checked && last && last.time + seconds > now ? bars.slice(0, -1) : bars;
					if (use.length < 20) throw new Error('봉 부족');
					const run = RULES.evaluator(use, { tzOffset: APP.tzOffset, symbol: item.id, interval: frame, info: APP.symbolInfo(item.id) });
					const hits = run.combine(chosen, 'all');
					let ago = -1;
					for (let k = 0; k < back; k++) {
						if (hits[use.length - 1 - k]) {
							ago = k;
							break;
						}
					}
					if (ago >= 0) {
						found.push({
							...item,
							ago,
							price: bars[bars.length - 1].close,
							precision,
							values: shown.map((cond) => {
								const series = run.values(cond.left);
								return series[use.length - 1];
							}),
						});
					}
				}
				catch {
					failed++;
				}
				done++;
				status.textContent = `검색 중… ${ done } / ${ symbols.length } · 찾음 ${ found.length }`;
			});
			found.sort((a, b) => a.ago - b.ago || (b.change ?? 0) - (a.change ?? 0));
			status.textContent = `${ symbols.length }개 중 ${ found.length }개가 맞습니다 (${ APP.intervalLabel(frame) }봉${ live.checked ? ', 진행 중인 봉 포함' : ', 마감된 봉 기준' })${ failed ? ` · ${ failed }개는 봉을 받지 못했습니다` : '' }.`;
			const format = (number, cond) => {
				if (number === null || number === undefined || !Number.isFinite(number)) return '–';
				const def = cond.left.kind === 'ind' ? IND.byId.get(cond.left.type) : null;
				if (def?.fmt === 'osc') return number.toFixed(2);
				if (def?.fmt === 'vol' || cond.left.field === 'volume') return APP.formatVolume(number);
				return APP.formatPrice(number);
			};
			results.replaceChildren(found.length === 0 ? el('p', { class: 'hint', text: '맞는 종목이 없습니다.' }) : el('table', {},
				el('thead', {}, el('tr', {}, el('th', { text: '종목' }), el('th', { text: '가격' }), el('th', { text: '24시간' }), el('th', { text: '맞은 봉' }), ...shown.map(cond => el('th', { text: RULES.operandText(cond.left) })))),
				el('tbody', {}, ...found.map(row => el('tr', { class: 'clickable', title: '차트에서 열기', onclick: () => APP.show(row.id, frame) },
					el('td', {}, el('span', { class: 'sym' }, APP.logo(row.id), APP.symbolTitle(row.id))),
					el('td', { text: APP.formatPrice(row.price, row.precision) }),
					el('td', { class: row.change >= 0 ? 'up' : 'down', text: row.change === null ? '–' : APP.formatPercent(row.change) }),
					el('td', { text: row.ago === 0 ? '방금' : `${ row.ago }봉 전` }),
					...row.values.map((number, i) => el('td', { text: format(number, shown[i]) })))))));
			running = false;
			runButton.disabled = false;
		};
		runButton.addEventListener('click', run);

		openModal('스크리너',
			section('대상과 조건',
				el('div', { class: 'lab-grid' },
					el('label', {}, el('span', { text: '대상' }), target),
					el('label', {}, el('span', { text: '주기' }), interval),
					el('label', {}, el('span', { text: '언제' }), lookback),
					el('label', {}, el('span', { text: '빠른 조건' }), preset)),
				el('h4', { text: '아래 조건이 모두 맞는 종목' }), list.node,
				el('div', { class: 'lab-row' }, el('label', { class: 'check' }, live, el('span', { text: '진행 중인 봉도 포함 (값이 계속 바뀜)' })), el('span', { class: 'spacer' }), runButton)),
			status,
			results);
	}

	document.getElementById('screener-btn')?.addEventListener('click', openScreener);

	// ---------- 업데이트 내용 ----------

	const CHANGELOG = window.ChartDeskChangelog ?? [];
	const SEEN_KEY = 'chartdesk-seen-version';

	/** a가 b보다 높은 버전인가. 1.0.10 > 1.0.9 */
	function newer(a, b) {
		const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
		for (let i = 0; i < Math.max(x.length, y.length); i++) {
			if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
		}
		return false;
	}

	const currentVersion = () => window.chartdeskApp?.version ?? CHANGELOG[0]?.version ?? '';

	/** 업데이트 내용 창. from이 있으면 그 버전보다 높은 버전만 보여 준다. */
	function openChangelog(from = null) {
		const current = currentVersion();
		const entries = CHANGELOG.filter(entry => !newer(entry.version, current) && (!from || newer(entry.version, from)));
		const list = el('div', { class: 'changelog' });
		const render = (items) => {
			list.replaceChildren(...items.map(entry => el('section', { class: 'lab-section' },
				el('h3', {}, `${ entry.version }`, el('small', { text: ` ${ entry.date }` })),
				el('ul', {}, ...entry.notes.map(note => el('li', { text: note }))))));
		};
		render(entries);
		const all = el('button', { class: 'text-btn', text: '이전 버전 내역도 보기' });
		all.addEventListener('click', () => {
			render(CHANGELOG.filter(entry => !newer(entry.version, current)));
			all.remove();
		});
		openModal(from ? `업데이트 내용 · ${ from } → ${ current }` : `업데이트 내역 · 지금 ${ current }`,
			from ? el('p', { class: 'hint', text: `${ from }에서 ${ current }로 올라오면서 바뀐 내용입니다. 톱니바퀴 → 업데이트 내역에서 다시 볼 수 있습니다.` }) : '',
			list,
			from && entries.length < CHANGELOG.length ? el('div', { class: 'lab-row' }, all) : '');
	}

	/** 새 버전으로 처음 켰으면 전에 쓰던 버전 이후의 내용을 보여 준다. */
	function showWhatsNew() {
		const current = currentVersion();
		if (!current) return;
		let seen = null;
		let existing = false;
		try {
			seen = localStorage.getItem(SEEN_KEY);
			existing = localStorage.getItem('chartdesk.workspace.v1') !== null;
			localStorage.setItem(SEEN_KEY, current);
		}
		catch {
			return;
		}
		// 이 기능이 생기기 전 버전에서 올라온 경우는 이전 버전을 알 수 없어 이번 버전 내용만 보여 준다.
		if (!seen && existing) {
			const index = CHANGELOG.findIndex(entry => entry.version === current);
			seen = CHANGELOG[index + 1]?.version ?? null;
		}
		if (seen && newer(current, seen)) openChangelog(seen);
	}
	setTimeout(showWhatsNew, 800);

	return { condEditor, condList, openBacktest, openScreener, openChangelog, close: () => (modal ? (closeModal(), true) : false) };
})();
