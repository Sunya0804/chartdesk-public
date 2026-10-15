// 조건 엔진. 조건 알림, 백테스트, 스크리너가 같은 조건 모양을 쓴다.
//
// 피연산자(operand)
//   { kind: 'ind', type: 'rsi', params: { length: 14 }, plot: 'rsi' }   지표 선 하나
//   { kind: 'price', field: 'close' }                                    봉 값 (open, high, low, close, volume)
//   { kind: 'value', value: 30 }                                          고정 값
// 조건(cond)
//   { kind: 'compare', left, op, right }   op: crossUp(상향 돌파), crossDown(하향 돌파), gt(보다 큼), lt(보다 작음)
//   { kind: 'gosu', signal: 'any' }        GOSU 지표의 타점 신호 (any, dip 눌림 롱, roll 꺾임 숏, trend 추세 롱)
// 조건은 봉이 마감된 값으로 판단한다. i번째 봉의 조건은 i번째 봉까지의 값만 쓴다.
window.ChartDeskRules = (() => {
	'use strict';

	const IND = window.ChartDeskIndicators;
	const OPS = [['crossUp', '상향 돌파'], ['crossDown', '하향 돌파'], ['gt', '보다 큼'], ['lt', '보다 작음']];
	const PRICE_FIELDS = [['close', '종가'], ['open', '시가'], ['high', '고가'], ['low', '저가'], ['volume', '거래량']];
	const GOSU_SIGNALS = [['any', '아무 타점'], ['dip', '▲눌림 (롱)'], ['roll', '▼꺾임 (숏)'], ['trend', '▲추세 (롱)']];
	const FIELD_KEYS = { close: 'c', open: 'o', high: 'h', low: 'l', volume: 'v' };

	/** 조건에 쓸 수 있는 선. 미래 값을 끌어오는 선(일목 후행 스팬처럼 왼쪽으로 민 선)은 뺀다. */
	function usablePlots(def) {
		return def.plots.filter(plot => typeof plot.shift !== 'function' || plot.shift(defaultParams(def)) >= 0);
	}

	/** 다른 주기의 봉이 필요한 지표(매물대·지지저항)는 조건에 쓰지 않는다. */
	const usable = def => !def.basis && usablePlots(def).length > 0;
	const usableDefs = () => IND.defs.filter(usable);

	function defaultParams(def) {
		return Object.fromEntries(def.params.map(param => [param.k, param.def]));
	}

	/** 저장되거나 AI가 만든 입력값을 지표가 받는 값으로 정리한다. */
	function cleanParams(def, params = {}) {
		const out = {};
		for (const param of def.params) {
			const value = Number(params?.[param.k]);
			out[param.k] = Number.isFinite(value) ? Math.max(param.min ?? -Infinity, value) : param.def;
		}
		return out;
	}

	// ---------- 확인과 정리 ----------

	/** 피연산자를 정리한다. 쓸 수 없으면 null. */
	function cleanOperand(operand) {
		if (!operand || typeof operand !== 'object') return null;
		if (operand.kind === 'value') return Number.isFinite(Number(operand.value)) ? { kind: 'value', value: Number(operand.value) } : null;
		if (operand.kind === 'price') return FIELD_KEYS[operand.field] ? { kind: 'price', field: operand.field } : null;
		if (operand.kind === 'ind') {
			const def = IND.byId.get(operand.type);
			if (!def || !usable(def)) return null;
			const plots = usablePlots(def);
			const plot = plots.find(item => item.k === operand.plot) ?? plots[0];
			return { kind: 'ind', type: def.id, params: cleanParams(def, operand.params), plot: plot.k };
		}
		return null;
	}

	/** 조건을 정리한다. 쓸 수 없으면 null. */
	function cleanCond(cond) {
		if (!cond || typeof cond !== 'object') return null;
		if (cond.kind === 'gosu') return { kind: 'gosu', signal: GOSU_SIGNALS.some(([id]) => id === cond.signal) ? cond.signal : 'any' };
		const left = cleanOperand(cond.left);
		const right = cleanOperand(cond.right);
		if (!left || !right || !OPS.some(([id]) => id === cond.op)) return null;
		return { kind: 'compare', left, op: cond.op, right };
	}

	// ---------- 글로 설명 ----------

	function operandText(operand) {
		if (operand.kind === 'value') return String(operand.value);
		if (operand.kind === 'price') return PRICE_FIELDS.find(([id]) => id === operand.field)[1];
		const def = IND.byId.get(operand.type);
		const args = def.params.map(param => operand.params[param.k]).join(',');
		const plot = def.plots.find(item => item.k === operand.plot);
		const name = args ? `${ def.short }(${ args })` : def.short;
		return def.plots.length > 1 ? `${ name } ${ plot.label }` : name;
	}

	function describe(cond) {
		if (cond.kind === 'gosu') return `GOSU ${ GOSU_SIGNALS.find(([id]) => id === cond.signal)[1] } 신호`;
		const [left, right] = [operandText(cond.left), operandText(cond.right)];
		if (cond.op === 'gt') return `${ left } > ${ right }`;
		if (cond.op === 'lt') return `${ left } < ${ right }`;
		return `${ left } ↗ ${ right } ${ cond.op === 'crossUp' ? '상향 돌파' : '하향 돌파' }`.replace('↗', cond.op === 'crossUp' ? '↗' : '↘');
	}

	// ---------- 계산 ----------

	/**
	 * 봉 묶음 하나에 대한 계산기. 같은 지표·입력값은 한 번만 계산한다.
	 * context: 지표 계산에 넘기는 값 { tzOffset, symbol, interval, info }
	 */
	function evaluator(bars, context = {}) {
		const source = IND.source(bars);
		const outputs = new Map();
		const n = bars.length;

		const output = (type, params) => {
			const key = `${ type }|${ JSON.stringify(params) }`;
			if (!outputs.has(key)) {
				const def = IND.byId.get(type);
				let out = null;
				try {
					out = def.calc(source, params, context);
				}
				catch {
					// 계산할 수 없는 지표는 값이 없는 것으로 본다.
				}
				outputs.set(key, out);
			}
			return outputs.get(key);
		};

		/** 피연산자의 봉마다 값. 값이 없으면 null. */
		const values = (operand) => {
			if (operand.kind === 'value') return new Array(n).fill(operand.value);
			if (operand.kind === 'price') return source[FIELD_KEYS[operand.field]];
			const def = IND.byId.get(operand.type);
			const out = output(operand.type, operand.params);
			const raw = out?.[operand.plot];
			if (!raw) return new Array(n).fill(null);
			const plot = def.plots.find(item => item.k === operand.plot);
			const shift = typeof plot.shift === 'function' ? plot.shift(operand.params) : 0;
			// 오른쪽으로 민 선(선행 스팬)은 i번째 봉에 i - shift번째 값이 그려진다.
			return Array.from({ length: n }, (_, i) => {
				const value = raw[i - shift];
				return value === null || value === undefined || !Number.isFinite(value) ? null : value;
			});
		};

		/** 조건이 봉마다 맞는지. */
		const truth = (cond) => {
			const hits = new Array(n).fill(false);
			if (cond.kind === 'gosu') {
				const out = output('wonyo', defaultParams(IND.byId.get('wonyo')));
				for (const signal of out?.$signals ?? []) {
					if (cond.signal === 'any' || cond.signal === signal.kind) hits[signal.index] = true;
				}
				return hits;
			}
			const left = values(cond.left);
			const right = values(cond.right);
			for (let i = 0; i < n; i++) {
				const [a, b] = [left[i], right[i]];
				if (a === null || b === null) continue;
				if (cond.op === 'gt') hits[i] = a > b;
				else if (cond.op === 'lt') hits[i] = a < b;
				else if (i > 0 && left[i - 1] !== null && right[i - 1] !== null) {
					hits[i] = cond.op === 'crossUp' ? left[i - 1] <= right[i - 1] && a > b : left[i - 1] >= right[i - 1] && a < b;
				}
			}
			return hits;
		};

		/** 조건 목록이 모두(all) 또는 하나라도(any) 맞는 봉. */
		const combine = (conds, mode = 'all') => {
			const result = new Array(n).fill(conds.length > 0 && mode === 'all');
			for (const cond of conds) {
				const hits = truth(cond);
				for (let i = 0; i < n; i++) result[i] = mode === 'all' ? result[i] && hits[i] : result[i] || hits[i];
			}
			return result;
		};

		return { values, truth, combine };
	}

	// ---------- 백테스트 ----------

	/**
	 * strategy: { side: 'long'|'short', entry: [cond], exit: [cond], stopLoss: %, takeProfit: %, fee: % (한 번 거래할 때) }
	 * 진입 조건이 모두 맞은 봉이 마감되면 다음 봉 시가에 들어가고, 청산 조건 중 하나가 맞으면 다음 봉 시가에 나온다.
	 * 손절·익절은 봉 안에서 그 가격에 닿으면 그 가격에 나온다(한 봉에서 둘 다 닿으면 손절로 본다).
	 * 수익은 매번 자산 전체로 들어간다고 보고 복리로 쌓는다.
	 */
	function backtest(bars, strategy, context = {}) {
		const n = bars.length;
		const run = evaluator(bars, context);
		const entry = run.combine(strategy.entry, 'all');
		const exit = strategy.exit.length ? run.combine(strategy.exit, 'any') : new Array(n).fill(false);
		const dir = strategy.side === 'short' ? -1 : 1;
		const fee = (strategy.fee ?? 0) / 100;
		const trades = [];
		const equity = new Array(n).fill(1);
		let cash = 1;
		let position = null;

		const close = (i, price, reason) => {
			const change = dir * (price - position.price) / position.price;
			const ret = (1 + change) * (1 - fee) * (1 - fee) - 1;
			cash *= 1 + ret;
			trades.push({ ...position, exitIndex: i, exitTime: bars[i].time, exitPrice: price, reason, ret });
			position = null;
		};

		for (let i = 0; i < n; i++) {
			const bar = bars[i];
			// 앞 봉에서 나온 신호를 이 봉의 시가에 실행한다.
			if (i > 0) {
				if (position && exit[i - 1] && position.index < i) close(i, bar.open, '청산 조건');
				if (!position && entry[i - 1]) position = { index: i, time: bar.time, price: bar.open };
			}
			if (position) {
				const stop = strategy.stopLoss > 0 ? position.price * (1 - dir * strategy.stopLoss / 100) : null;
				const target = strategy.takeProfit > 0 ? position.price * (1 + dir * strategy.takeProfit / 100) : null;
				const hitStop = stop !== null && (dir > 0 ? bar.low <= stop : bar.high >= stop);
				const hitTarget = target !== null && (dir > 0 ? bar.high >= target : bar.low <= target);
				// 시가부터 이미 넘어 있으면 시가에 나온다.
				if (hitStop) close(i, dir > 0 ? Math.min(bar.open, stop) : Math.max(bar.open, stop), '손절');
				else if (hitTarget) close(i, dir > 0 ? Math.max(bar.open, target) : Math.min(bar.open, target), '익절');
			}
			equity[i] = position ? cash * (1 + dir * (bar.close - position.price) / position.price) * (1 - fee) : cash;
		}
		const open = position ? { ...position, mark: bars[n - 1].close, ret: dir * (bars[n - 1].close - position.price) / position.price } : null;

		let peak = 1;
		let drawdown = 0;
		for (const value of equity) {
			peak = Math.max(peak, value);
			drawdown = Math.min(drawdown, value / peak - 1);
		}
		const wins = trades.filter(trade => trade.ret > 0);
		const losses = trades.filter(trade => trade.ret <= 0);
		const gain = wins.reduce((sum, trade) => sum + trade.ret, 0);
		const loss = -losses.reduce((sum, trade) => sum + trade.ret, 0);
		const held = trades.reduce((sum, trade) => sum + trade.exitIndex - trade.index, 0);
		return {
			trades,
			open,
			equity,
			total: equity[n - 1] - 1,
			buyHold: n > 1 ? dir * (bars[n - 1].close - bars[0].open) / bars[0].open : 0,
			winRate: trades.length ? wins.length / trades.length : 0,
			profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : 0,
			maxDrawdown: drawdown,
			avgWin: wins.length ? gain / wins.length : 0,
			avgLoss: losses.length ? -loss / losses.length : 0,
			avgBars: trades.length ? held / trades.length : 0,
			exposure: equity.length ? trades.reduce((sum, trade) => sum + trade.exitIndex - trade.index, 0) / n : 0,
		};
	}

	/** 전략을 정리한다. 진입 조건이 하나도 없으면 null. */
	function cleanStrategy(strategy) {
		if (!strategy || typeof strategy !== 'object') return null;
		const entry = (Array.isArray(strategy.entry) ? strategy.entry : []).map(cleanCond).filter(Boolean);
		if (entry.length === 0) return null;
		const percent = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);
		return {
			name: typeof strategy.name === 'string' ? strategy.name.slice(0, 80) : '',
			side: strategy.side === 'short' ? 'short' : 'long',
			entry,
			exit: (Array.isArray(strategy.exit) ? strategy.exit : []).map(cleanCond).filter(Boolean),
			stopLoss: percent(strategy.stopLoss),
			takeProfit: percent(strategy.takeProfit),
			fee: Number.isFinite(Number(strategy.fee)) && Number(strategy.fee) >= 0 ? Number(strategy.fee) : 0.1,
		};
	}

	/** AI에게 보낼, 쓸 수 있는 지표 목록. */
	function catalogText() {
		return usableDefs().map((def) => {
			const params = def.params.map(param => `${ param.k}=${ param.def }`).join(', ');
			const plots = usablePlots(def).map(plot => `${ plot.k }(${ plot.label })`).join(', ');
			return `- ${ def.id }: ${ def.short } ${ def.ko } | params: ${ params || '없음' } | plots: ${ plots }`;
		}).join('\n');
	}

	return {
		OPS, PRICE_FIELDS, GOSU_SIGNALS,
		usable, usableDefs, usablePlots, defaultParams, cleanParams, cleanOperand, cleanCond, cleanStrategy,
		operandText, describe, evaluator, backtest, catalogText,
	};
})();
