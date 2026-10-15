// 지표 정의와 계산. 모든 계산 결과는 봉 배열과 같은 길이의 배열이며, 값이 없는 자리는 null이다.
window.ChartDeskIndicators = (() => {
	'use strict';

	const UP = '#31bd65';
	const DOWN = '#eb4b6d';
	const UP_SOFT = 'rgba(49, 189, 101, 0.45)';
	const DOWN_SOFT = 'rgba(235, 75, 109, 0.45)';

	// ---------- 공통 계산 ----------

	const blank = length => new Array(length).fill(null);

	function firstValid(x) {
		let i = 0;
		while (i < x.length && x[i] === null) i++;
		return i;
	}

	function sma(x, n) {
		const out = blank(x.length);
		const start = firstValid(x);
		let sum = 0;
		for (let i = start; i < x.length; i++) {
			sum += x[i];
			if (i - start >= n) sum -= x[i - n];
			if (i - start >= n - 1) out[i] = sum / n;
		}
		return out;
	}

	/** 첫 값을 단순평균으로 잡는 지수 평활. k는 평활 계수. */
	function smooth(x, n, k) {
		const out = blank(x.length);
		const start = firstValid(x);
		if (x.length - start < n) return out;
		let value = 0;
		for (let i = start; i < start + n; i++) value += x[i];
		value /= n;
		out[start + n - 1] = value;
		for (let i = start + n; i < x.length; i++) {
			value = x[i] * k + value * (1 - k);
			out[i] = value;
		}
		return out;
	}

	const ema = (x, n) => smooth(x, n, 2 / (n + 1));
	/** 와일더 평활 (RSI, ATR, ADX에서 사용). */
	const rma = (x, n) => smooth(x, n, 1 / n);

	function wma(x, n) {
		const out = blank(x.length);
		const start = firstValid(x);
		const weight = n * (n + 1) / 2;
		for (let i = start + n - 1; i < x.length; i++) {
			let sum = 0;
			for (let j = 0; j < n; j++) sum += x[i - j] * (n - j);
			out[i] = sum / weight;
		}
		return out;
	}

	function stdev(x, n) {
		const out = blank(x.length);
		const start = firstValid(x);
		let sum = 0;
		let squares = 0;
		for (let i = start; i < x.length; i++) {
			sum += x[i];
			squares += x[i] * x[i];
			if (i - start >= n) {
				sum -= x[i - n];
				squares -= x[i - n] * x[i - n];
			}
			if (i - start >= n - 1) {
				const mean = sum / n;
				out[i] = Math.sqrt(Math.max(0, squares / n - mean * mean));
			}
		}
		return out;
	}

	function extreme(x, n, pick) {
		const out = blank(x.length);
		const start = firstValid(x);
		for (let i = start + n - 1; i < x.length; i++) {
			let value = x[i];
			for (let j = 1; j < n; j++) value = pick(value, x[i - j]);
			out[i] = value;
		}
		return out;
	}

	const highest = (x, n) => extreme(x, n, Math.max);
	const lowest = (x, n) => extreme(x, n, Math.min);

	/** 두 배열을 자리별로 합친다. 한쪽이라도 null이면 null. */
	function zip(a, b, fn) {
		return a.map((value, i) => (value === null || b[i] === null ? null : fn(value, b[i], i)));
	}

	const map = (a, fn) => a.map((value, i) => (value === null ? null : fn(value, i)));

	function trueRange(s) {
		return s.h.map((high, i) => (i === 0
			? high - s.l[0]
			: Math.max(high - s.l[i], Math.abs(high - s.c[i - 1]), Math.abs(s.l[i] - s.c[i - 1]))));
	}

	const atr = (s, n) => rma(trueRange(s), n);

	function rsi(x, n) {
		const gains = blank(x.length);
		const losses = blank(x.length);
		for (let i = firstValid(x) + 1; i < x.length; i++) {
			const change = x[i] - x[i - 1];
			gains[i] = Math.max(change, 0);
			losses[i] = Math.max(-change, 0);
		}
		return zip(rma(gains, n), rma(losses, n), (gain, loss) => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)));
	}

	/** 구간 내 위치를 0~100으로 환산한다. */
	function stochastic(value, high, low, n) {
		const top = highest(high, n);
		const bottom = lowest(low, n);
		return value.map((v, i) => {
			if (v === null || top[i] === null || bottom[i] === null) return null;
			return top[i] === bottom[i] ? 50 : (v - bottom[i]) / (top[i] - bottom[i]) * 100;
		});
	}

	const midpoint = (s, n) => zip(highest(s.h, n), lowest(s.l, n), (high, low) => (high + low) / 2);

	function parabolicSar(s, start, step, max) {
		const out = blank(s.n);
		if (s.n < 2) return out;
		let rising = true;
		let factor = start;
		let extremePoint = s.h[0];
		let sar = s.l[0];
		for (let i = 1; i < s.n; i++) {
			sar += factor * (extremePoint - sar);
			const before = i > 1 ? i - 2 : i - 1;
			if (rising) {
				sar = Math.min(sar, s.l[i - 1], s.l[before]);
				if (s.l[i] < sar) {
					rising = false;
					sar = extremePoint;
					extremePoint = s.l[i];
					factor = start;
				}
				else if (s.h[i] > extremePoint) {
					extremePoint = s.h[i];
					factor = Math.min(max, factor + step);
				}
			}
			else {
				sar = Math.max(sar, s.h[i - 1], s.h[before]);
				if (s.h[i] > sar) {
					rising = true;
					sar = extremePoint;
					extremePoint = s.h[i];
					factor = start;
				}
				else if (s.l[i] < extremePoint) {
					extremePoint = s.l[i];
					factor = Math.min(max, factor + step);
				}
			}
			out[i] = sar;
		}
		return out;
	}

	function supertrend(s, n, factor) {
		const range = atr(s, n);
		const line = blank(s.n);
		const colors = blank(s.n);
		let upper = null;
		let lower = null;
		let rising = true;
		for (let i = 0; i < s.n; i++) {
			if (range[i] === null) continue;
			const rawUpper = s.hl2[i] + factor * range[i];
			const rawLower = s.hl2[i] - factor * range[i];
			if (upper === null) {
				upper = rawUpper;
				lower = rawLower;
				rising = s.c[i] >= s.hl2[i];
			}
			else {
				upper = rawUpper < upper || s.c[i - 1] > upper ? rawUpper : upper;
				lower = rawLower > lower || s.c[i - 1] < lower ? rawLower : lower;
				if (rising && s.c[i] < lower) rising = false;
				else if (!rising && s.c[i] > upper) rising = true;
			}
			line[i] = rising ? lower : upper;
			colors[i] = rising ? UP : DOWN;
		}
		return { line, $colors: { line: colors } };
	}

	function directional(s, n) {
		const plus = [0];
		const minus = [0];
		for (let i = 1; i < s.n; i++) {
			const up = s.h[i] - s.h[i - 1];
			const down = s.l[i - 1] - s.l[i];
			plus.push(up > down && up > 0 ? up : 0);
			minus.push(down > up && down > 0 ? down : 0);
		}
		const range = atr(s, n);
		const plusDi = zip(rma(plus, n), range, (value, r) => (r === 0 ? 0 : 100 * value / r));
		const minusDi = zip(rma(minus, n), range, (value, r) => (r === 0 ? 0 : 100 * value / r));
		const dx = zip(plusDi, minusDi, (p, m) => (p + m === 0 ? 0 : 100 * Math.abs(p - m) / (p + m)));
		return { adx: rma(dx, n), plus: plusDi, minus: minusDi };
	}

	function moneyFlow(s, n) {
		const positive = blank(s.n);
		const negative = blank(s.n);
		for (let i = 1; i < s.n; i++) {
			const flow = s.hlc3[i] * s.v[i];
			positive[i] = s.hlc3[i] > s.hlc3[i - 1] ? flow : 0;
			negative[i] = s.hlc3[i] < s.hlc3[i - 1] ? flow : 0;
		}
		return zip(sma(positive, n), sma(negative, n), (pos, neg) => (neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)));
	}

	function sessionVwap(s) {
		const out = blank(s.n);
		let day = null;
		let money = 0;
		let volume = 0;
		for (let i = 0; i < s.n; i++) {
			const today = Math.floor(s.t[i] / 86400);
			if (today !== day) {
				day = today;
				money = 0;
				volume = 0;
			}
			money += s.hlc3[i] * s.v[i];
			volume += s.v[i];
			out[i] = volume === 0 ? s.hlc3[i] : money / volume;
		}
		return out;
	}

	function cci(s, n) {
		const mean = sma(s.hlc3, n);
		return mean.map((average, i) => {
			if (average === null) return null;
			let deviation = 0;
			for (let j = 0; j < n; j++) deviation += Math.abs(s.hlc3[i - j] - average);
			deviation /= n;
			return deviation === 0 ? 0 : (s.hlc3[i] - average) / (0.015 * deviation);
		});
	}

	function obv(s) {
		let total = 0;
		return s.c.map((close, i) => {
			if (i > 0) total += close > s.c[i - 1] ? s.v[i] : close < s.c[i - 1] ? -s.v[i] : 0;
			return total;
		});
	}

	const shifted = (x, n, fn) => x.map((value, i) => (i < n ? null : fn(value, x[i - n])));

	// ---------- 지표 정의 ----------

	const length = (def, label = '기간') => ({ k: 'length', label, def, min: 1, step: 1 });
	const line = (k, label, color, extra) => ({ k, label, type: 'line', color, ...extra });
	const movingAverage = (id, short, name, ko, tags, def, calc) => ({
		id, short, name, ko, tags, cat: '추세', overlay: true, fmt: 'price',
		// 마지막 값을 오른쪽 가격 축에 선 색으로 표시한다.
		axisLabel: true,
		params: [length(def)],
		plots: [line('ma', short, '#f5a623')],
		calc: (s, p) => ({ ma: calc(s, p.length) }),
	});

	const defs = [
		movingAverage('sma', 'MA', 'Moving Average (Simple)', '단순 이동평균', 'sma 이평 이동평균선', 20, (s, n) => sma(s.c, n)),
		movingAverage('ema', 'EMA', 'Exponential Moving Average', '지수 이동평균', '이평 지수이평', 50, (s, n) => ema(s.c, n)),
		movingAverage('wma', 'WMA', 'Weighted Moving Average', '가중 이동평균', '이평 가중이평', 20, (s, n) => wma(s.c, n)),
		movingAverage('vwma', 'VWMA', 'Volume Weighted Moving Average', '거래량 가중 이동평균', '이평 거래량', 20,
			(s, n) => zip(sma(s.c.map((close, i) => close * s.v[i]), n), sma(s.v, n), (money, volume) => (volume === 0 ? null : money / volume))),
		movingAverage('hma', 'HMA', 'Hull Moving Average', '헐 이동평균', '이평 hull', 20, (s, n) => {
			const half = wma(s.c, Math.max(1, Math.floor(n / 2)));
			return wma(zip(half, wma(s.c, n), (fast, slow) => 2 * fast - slow), Math.max(1, Math.round(Math.sqrt(n))));
		}),
		{
			id: 'bb', short: 'BB', name: 'Bollinger Bands', ko: '볼린저 밴드', tags: 'bollinger 볼밴 밴드', cat: '변동성', overlay: true, fmt: 'price',
			params: [length(20), { k: 'mult', label: '승수', def: 2, min: 0.1, step: 0.1 }],
			plots: [line('upper', '상단', '#14b8a6'), line('basis', '중심', '#f5a623'), line('lower', '하단', '#14b8a6')],
			calc(s, p) {
				const basis = sma(s.c, p.length);
				const width = stdev(s.c, p.length);
				return {
					upper: zip(basis, width, (mean, sd) => mean + p.mult * sd),
					basis,
					lower: zip(basis, width, (mean, sd) => mean - p.mult * sd),
				};
			},
		},
		{
			id: 'vwap', short: 'VWAP', name: 'Volume Weighted Average Price', ko: '거래량 가중 평균가', tags: '브이왑 평균단가', cat: '거래량', overlay: true, fmt: 'price',
			params: [],
			plots: [line('vwap', 'VWAP', '#ec4899')],
			calc: s => ({ vwap: sessionVwap(s) }),
		},
		{
			id: 'ichimoku', short: '일목', name: 'Ichimoku Cloud', ko: '일목균형표', tags: 'ichimoku 구름 전환선 기준선 선행스팬 후행스팬', cat: '추세', overlay: true, fmt: 'price',
			params: [
				{ k: 'conversion', label: '전환선', def: 9, min: 1, step: 1 },
				{ k: 'base', label: '기준선', def: 26, min: 1, step: 1 },
				{ k: 'span', label: '선행스팬 B', def: 52, min: 1, step: 1 },
			],
			plots: [
				line('conversion', '전환', '#3b82f6'),
				line('base', '기준', '#ef4444'),
				line('spanA', '선행A', '#22c55e', { shift: p => p.base }),
				line('spanB', '선행B', '#f97316', { shift: p => p.base }),
				line('lagging', '후행', '#a855f7', { shift: p => -p.base }),
			],
			calc(s, p) {
				const conversion = midpoint(s, p.conversion);
				const base = midpoint(s, p.base);
				return {
					conversion,
					base,
					spanA: zip(conversion, base, (a, b) => (a + b) / 2),
					spanB: midpoint(s, p.span),
					lagging: s.c,
				};
			},
		},
		{
			id: 'psar', short: 'SAR', name: 'Parabolic SAR', ko: '파라볼릭 SAR', tags: 'parabolic 추세전환', cat: '추세', overlay: true, fmt: 'price',
			params: [
				{ k: 'start', label: '시작', def: 0.02, min: 0.001, step: 0.01 },
				{ k: 'step', label: '증가', def: 0.02, min: 0.001, step: 0.01 },
				{ k: 'max', label: '최대', def: 0.2, min: 0.01, step: 0.01 },
			],
			plots: [{ k: 'sar', label: 'SAR', type: 'dots', color: '#eab308' }],
			calc: (s, p) => ({ sar: parabolicSar(s, p.start, p.step, p.max) }),
		},
		{
			id: 'supertrend', short: '슈퍼트렌드', name: 'Supertrend', ko: '슈퍼트렌드', tags: 'super trend 추세', cat: '추세', overlay: true, fmt: 'price',
			params: [length(10, 'ATR 기간'), { k: 'factor', label: '승수', def: 3, min: 0.1, step: 0.1 }],
			plots: [line('line', '슈퍼트렌드', UP, { width: 2, fixedColor: true })],
			calc: (s, p) => supertrend(s, p.length, p.factor),
		},
		{
			id: 'donchian', short: 'DC', name: 'Donchian Channels', ko: '돈치안 채널', tags: 'donchian 채널 고가 저가', cat: '변동성', overlay: true, fmt: 'price',
			params: [length(20)],
			plots: [line('upper', '상단', '#06b6d4'), line('middle', '중심', '#f5a623'), line('lower', '하단', '#06b6d4')],
			calc(s, p) {
				const upper = highest(s.h, p.length);
				const lower = lowest(s.l, p.length);
				return { upper, middle: zip(upper, lower, (a, b) => (a + b) / 2), lower };
			},
		},
		{
			id: 'keltner', short: 'KC', name: 'Keltner Channels', ko: '켈트너 채널', tags: 'keltner 채널', cat: '변동성', overlay: true, fmt: 'price',
			params: [length(20), { k: 'mult', label: '승수', def: 2, min: 0.1, step: 0.1 }],
			plots: [line('upper', '상단', '#8b5cf6'), line('basis', '중심', '#f5a623'), line('lower', '하단', '#8b5cf6')],
			calc(s, p) {
				const basis = ema(s.c, p.length);
				const range = atr(s, p.length);
				return {
					upper: zip(basis, range, (mean, r) => mean + p.mult * r),
					basis,
					lower: zip(basis, range, (mean, r) => mean - p.mult * r),
				};
			},
		},
		{
			id: 'envelope', short: 'ENV', name: 'Envelope', ko: '엔벨로프', tags: 'envelope 이격', cat: '변동성', overlay: true, fmt: 'price',
			params: [length(20), { k: 'percent', label: '폭(%)', def: 5, min: 0.1, step: 0.1 }],
			plots: [line('upper', '상단', '#10b981'), line('basis', '중심', '#f5a623'), line('lower', '하단', '#10b981')],
			calc(s, p) {
				const basis = sma(s.c, p.length);
				return {
					upper: map(basis, mean => mean * (1 + p.percent / 100)),
					basis,
					lower: map(basis, mean => mean * (1 - p.percent / 100)),
				};
			},
		},
		{
			id: 'volume', short: '거래량', name: 'Volume', ko: '거래량', tags: 'vol 볼륨', cat: '거래량', overlay: true, scale: 'bottom', fmt: 'vol',
			params: [],
			plots: [{ k: 'vol', label: '거래량', type: 'hist', color: UP_SOFT }],
			calc: s => ({ vol: s.v, $colors: { vol: s.c.map((close, i) => (close >= s.o[i] ? UP_SOFT : DOWN_SOFT)) } }),
		},
		{
			id: 'rsi', short: 'RSI', name: 'Relative Strength Index', ko: '상대강도지수', tags: '과매수 과매도 알에스아이', cat: '모멘텀', overlay: false, fmt: 'osc',
			params: [length(14)],
			plots: [line('rsi', 'RSI', '#a855f7')],
			levels: [70, 30],
			calc: (s, p) => ({ rsi: rsi(s.c, p.length) }),
		},
		{
			id: 'macd', short: 'MACD', name: 'Moving Average Convergence Divergence', ko: '이동평균 수렴확산', tags: '맥디 시그널 오실레이터', cat: '모멘텀', overlay: false, fmt: 'price',
			params: [
				{ k: 'fast', label: '단기', def: 12, min: 1, step: 1 },
				{ k: 'slow', label: '장기', def: 26, min: 1, step: 1 },
				{ k: 'signal', label: '시그널', def: 9, min: 1, step: 1 },
			],
			plots: [
				{ k: 'hist', label: '히스토그램', type: 'hist', color: UP_SOFT },
				line('macd', 'MACD', '#3b82f6'),
				line('signal', '시그널', '#f97316'),
			],
			levels: [0],
			calc(s, p) {
				const macd = zip(ema(s.c, p.fast), ema(s.c, p.slow), (fast, slow) => fast - slow);
				const signal = ema(macd, p.signal);
				const hist = zip(macd, signal, (a, b) => a - b);
				return { hist, macd, signal, $colors: { hist: hist.map(value => (value >= 0 ? UP_SOFT : DOWN_SOFT)) } };
			},
		},
		{
			id: 'stoch', short: 'Stoch', name: 'Stochastic', ko: '스토캐스틱', tags: '스토캐스틱 슬로우 과매수 과매도', cat: '모멘텀', overlay: false, fmt: 'osc',
			params: [length(14, '%K 기간'), { k: 'smooth', label: '%K 평활', def: 3, min: 1, step: 1 }, { k: 'd', label: '%D 기간', def: 3, min: 1, step: 1 }],
			plots: [line('k', '%K', '#3b82f6'), line('d', '%D', '#f97316')],
			levels: [80, 20],
			calc(s, p) {
				const k = sma(stochastic(s.c, s.h, s.l, p.length), p.smooth);
				return { k, d: sma(k, p.d) };
			},
		},
		{
			id: 'stochrsi', short: 'Stoch RSI', name: 'Stochastic RSI', ko: '스토캐스틱 RSI', tags: '스토캐스틱 알에스아이', cat: '모멘텀', overlay: false, fmt: 'osc',
			params: [length(14, 'RSI 기간'), { k: 'stoch', label: '스토캐스틱 기간', def: 14, min: 1, step: 1 }, { k: 'smooth', label: '%K 평활', def: 3, min: 1, step: 1 }, { k: 'd', label: '%D 기간', def: 3, min: 1, step: 1 }],
			plots: [line('k', '%K', '#3b82f6'), line('d', '%D', '#f97316')],
			levels: [80, 20],
			calc(s, p) {
				const strength = rsi(s.c, p.length);
				const k = sma(stochastic(strength, strength, strength, p.stoch), p.smooth);
				return { k, d: sma(k, p.d) };
			},
		},
		{
			id: 'cci', short: 'CCI', name: 'Commodity Channel Index', ko: '상품채널지수', tags: '씨씨아이 과매수 과매도', cat: '모멘텀', overlay: false, fmt: 'osc',
			params: [length(20)],
			plots: [line('cci', 'CCI', '#06b6d4')],
			levels: [100, -100],
			calc: (s, p) => ({ cci: cci(s, p.length) }),
		},
		{
			id: 'willr', short: '%R', name: 'Williams %R', ko: '윌리엄스 %R', tags: 'williams 윌리엄스', cat: '모멘텀', overlay: false, fmt: 'osc',
			params: [length(14)],
			plots: [line('r', '%R', '#ec4899')],
			levels: [-20, -80],
			calc: (s, p) => ({ r: map(stochastic(s.c, s.h, s.l, p.length), value => value - 100) }),
		},
		{
			id: 'mfi', short: 'MFI', name: 'Money Flow Index', ko: '자금흐름지수', tags: 'money flow 자금', cat: '거래량', overlay: false, fmt: 'osc',
			params: [length(14)],
			plots: [line('mfi', 'MFI', '#22c55e')],
			levels: [80, 20],
			calc: (s, p) => ({ mfi: moneyFlow(s, p.length) }),
		},
		{
			id: 'adx', short: 'ADX', name: 'Average Directional Index (DMI)', ko: '평균방향성지수', tags: 'dmi di 방향성 추세강도', cat: '추세', overlay: false, fmt: 'osc',
			params: [length(14)],
			plots: [line('adx', 'ADX', '#f5a623', { width: 2 }), line('plus', '+DI', UP), line('minus', '-DI', DOWN)],
			levels: [25],
			calc: (s, p) => directional(s, p.length),
		},
		{
			id: 'atr', short: 'ATR', name: 'Average True Range', ko: '평균 실질 변동폭', tags: 'true range 변동성', cat: '변동성', overlay: false, fmt: 'price',
			params: [length(14)],
			plots: [line('atr', 'ATR', '#ef4444')],
			calc: (s, p) => ({ atr: atr(s, p.length) }),
		},
		{
			id: 'obv', short: 'OBV', name: 'On Balance Volume', ko: '누적 거래량', tags: 'on balance 거래량', cat: '거래량', overlay: false, fmt: 'vol',
			params: [],
			plots: [line('obv', 'OBV', '#3b82f6')],
			calc: s => ({ obv: obv(s) }),
		},
		{
			id: 'roc', short: 'ROC', name: 'Rate of Change', ko: '변화율', tags: 'rate of change 등락률', cat: '모멘텀', overlay: false, fmt: 'osc',
			params: [length(9)],
			plots: [line('roc', 'ROC', '#14b8a6')],
			levels: [0],
			calc: (s, p) => ({ roc: shifted(s.c, p.length, (now, before) => (before === 0 ? null : (now - before) / before * 100)) }),
		},
		{
			id: 'mom', short: 'MOM', name: 'Momentum', ko: '모멘텀', tags: 'momentum 탄력', cat: '모멘텀', overlay: false, fmt: 'price',
			params: [length(10)],
			plots: [line('mom', 'MOM', '#8b5cf6')],
			levels: [0],
			calc: (s, p) => ({ mom: shifted(s.c, p.length, (now, before) => now - before) }),
		},
	];

	// ---------- 추가 계산 ----------

	const num = (k, label, def, min = 1, step = 1) => ({ k, label, def, min, step });
	const hist = (k, label) => ({ k, label, type: 'hist', color: UP_SOFT });
	const colored = (k, label, width = 2) => line(k, label, UP, { width, fixedColor: true });
	const total = (x, n) => map(sma(x, n), value => value * n);
	const change = (x, n = 1) => x.map((value, i) => (i < n || value === null || x[i - n] === null ? null : value - x[i - n]));
	const lag = (x, n) => x.map((value, i) => (i < n ? null : x[i - n]));
	const rising = x => x.map((value, i) => (i > 0 && value !== null && x[i - 1] !== null && value < x[i - 1] ? DOWN : UP));
	const softRising = x => x.map((value, i) => (i > 0 && value !== null && x[i - 1] !== null && value < x[i - 1] ? DOWN_SOFT : UP_SOFT));
	const signed = x => x.map(value => (value !== null && value < 0 ? DOWN_SOFT : UP_SOFT));

	function cumulative(x) {
		let sum = 0;
		return x.map((value) => {
			sum += value ?? 0;
			return sum;
		});
	}

	/** n봉에 대한 최소제곱 직선의 끝값. offset만큼 과거 쪽 값을 준다. */
	function linreg(x, n, offset = 0) {
		const out = blank(x.length);
		const start = firstValid(x);
		const meanX = (n - 1) / 2;
		let spread = 0;
		for (let j = 0; j < n; j++) spread += (j - meanX) ** 2;
		for (let i = start + n - 1; i < x.length; i++) {
			let meanY = 0;
			for (let j = 0; j < n; j++) meanY += x[i - n + 1 + j];
			meanY /= n;
			let cross = 0;
			for (let j = 0; j < n; j++) cross += (j - meanX) * (x[i - n + 1 + j] - meanY);
			const slope = spread === 0 ? 0 : cross / spread;
			out[i] = meanY + slope * (n - 1 - offset - meanX);
		}
		return out;
	}

	function alma(x, n, offset, sigma) {
		const out = blank(x.length);
		const start = firstValid(x);
		const center = offset * (n - 1);
		const width = n / sigma;
		const weights = Array.from({ length: n }, (unused, j) => Math.exp(-((j - center) ** 2) / (2 * width * width)));
		const norm = weights.reduce((sum, weight) => sum + weight, 0);
		for (let i = start + n - 1; i < x.length; i++) {
			let sum = 0;
			for (let j = 0; j < n; j++) sum += x[i - n + 1 + j] * weights[j];
			out[i] = sum / norm;
		}
		return out;
	}

	/** 이전 값에 기대어 한 봉씩 나아가는 계산. step(값, 이전 결과, i)가 null을 주면 건너뛴다. */
	function recursive(x, step) {
		const out = blank(x.length);
		let previous = null;
		for (let i = 0; i < x.length; i++) {
			if (x[i] === null) continue;
			previous = step(x[i], previous, i);
			out[i] = previous;
		}
		return out;
	}

	function kama(x, n, fast, slow) {
		const fastest = 2 / (fast + 1);
		const slowest = 2 / (slow + 1);
		return recursive(x, (value, previous, i) => {
			if (i < n || x[i - n] === null) return previous ?? value;
			let noise = 0;
			for (let j = 0; j < n; j++) noise += Math.abs(x[i - j] - x[i - j - 1]);
			const ratio = noise === 0 ? 0 : Math.abs(value - x[i - n]) / noise;
			const smoothing = (ratio * (fastest - slowest) + slowest) ** 2;
			return previous + smoothing * (value - previous);
		});
	}

	/** 변동이 클수록 빨리 따라가는 평균 (VIDYA). OTT가 쓴다. */
	function vidya(x, n, window = 9) {
		const alpha = 2 / (n + 1);
		return recursive(x, (value, previous, i) => {
			if (previous === null || i < window) return value;
			let up = 0;
			let down = 0;
			for (let j = 0; j < window; j++) {
				const move = x[i - j] - x[i - j - 1];
				if (move > 0) up += move;
				else down -= move;
			}
			const strength = up + down === 0 ? 0 : Math.abs((up - down) / (up + down));
			return alpha * strength * value + (1 - alpha * strength) * previous;
		});
	}

	/** 구간에서 가장 높은(낮은) 값이 몇 봉 전에 나왔는지. */
	function barsSince(x, n, better) {
		const out = blank(x.length);
		for (let i = n - 1; i < x.length; i++) {
			let best = 0;
			for (let j = 1; j < n; j++) {
				if (better(x[i - j], x[i - best])) best = j;
			}
			out[i] = best;
		}
		return out;
	}

	function percentRank(x, n) {
		return x.map((value, i) => {
			if (value === null || i < n || x[i - n] === null) return null;
			let below = 0;
			for (let j = 1; j <= n; j++) {
				if (x[i - j] <= value) below++;
			}
			return below / n * 100;
		});
	}

	/** 가격이 선을 넘으면 방향이 바뀌는 추적 손절선. width[i]는 가격에서 띄울 거리. */
	function trailing(price, width) {
		const stop = blank(price.length);
		const colors = blank(price.length);
		let previous = null;
		for (let i = 0; i < price.length; i++) {
			if (price[i] === null || width[i] === null) continue;
			const value = price[i];
			const before = price[i - 1] ?? value;
			if (previous === null) previous = value - width[i];
			else if (value > previous && before > previous) previous = Math.max(previous, value - width[i]);
			else if (value < previous && before < previous) previous = Math.min(previous, value + width[i]);
			else previous = value > previous ? value - width[i] : value + width[i];
			stop[i] = previous;
			colors[i] = value >= previous ? UP : DOWN;
		}
		return { stop, colors };
	}

	const moneyFlowVolume = s => s.c.map((close, i) => (s.h[i] === s.l[i] ? 0 : ((close - s.l[i]) - (s.h[i] - close)) / (s.h[i] - s.l[i]) * s.v[i]));
	const dema = (x, n) => zip(ema(x, n), ema(ema(x, n), n), (one, two) => 2 * one - two);
	const average = (s, n) => sma(trueRange(s), n);

	function stochasticOf(x, n) {
		return stochastic(x, x, x, n);
	}

	// ---------- 추가 기술적 지표 ----------

	const tech = (id, short, name, ko, tags, cat, overlay, fmt, params, plots, calc, extra = {}) =>
		({ id, short, name, ko, tags, cat, overlay, fmt, params, plots, calc, ...extra });

	const moreDefs = [
		movingAverage('dema', 'DEMA', 'Double Exponential Moving Average', '이중 지수 이동평균', '이평 dema', 20, (s, n) => dema(s.c, n)),
		movingAverage('tema', 'TEMA', 'Triple Exponential Moving Average', '삼중 지수 이동평균', '이평 tema', 20, (s, n) => {
			const one = ema(s.c, n);
			const two = ema(one, n);
			const three = ema(two, n);
			return one.map((value, i) => (three[i] === null ? null : 3 * value - 3 * two[i] + three[i]));
		}),
		movingAverage('smma', 'SMMA', 'Smoothed Moving Average (RMA)', '평활 이동평균', '이평 rma 와일더', 7, (s, n) => rma(s.c, n)),
		movingAverage('lsma', 'LSMA', 'Least Squares Moving Average', '최소제곱 이동평균', '이평 선형회귀 linreg', 25, (s, n) => linreg(s.c, n)),
		movingAverage('alma', 'ALMA', 'Arnaud Legoux Moving Average', '아르노 르구 이동평균', '이평 alma', 9, (s, n) => alma(s.c, n, 0.85, 6)),
		movingAverage('kama', 'KAMA', 'Kaufman Adaptive Moving Average', '카우프만 적응 이동평균', '이평 적응 kama', 10, (s, n) => kama(s.c, n, 2, 30)),
		movingAverage('zlema', 'ZLEMA', 'Zero Lag Exponential Moving Average', '제로 랙 지수 이동평균', '이평 zero lag', 20, (s, n) => {
			const back = Math.floor((n - 1) / 2);
			return ema(s.c.map((close, i) => (i < back ? null : close + (close - s.c[i - back]))), n);
		}),
		movingAverage('mcginley', 'MGD', 'McGinley Dynamic', '맥긴리 다이내믹', '이평 mcginley', 14, (s, n) =>
			recursive(s.c, (close, previous) => (previous === null ? close : previous + (close - previous) / (n * (close / previous) ** 4)))),
		tech('alligator', '앨리게이터', 'Williams Alligator', '윌리엄스 앨리게이터', 'alligator 악어 턱 이빨 입술', '추세', true, 'price',
			[num('jaw', '턱 기간', 13), num('teeth', '이빨 기간', 8), num('lips', '입술 기간', 5)],
			[line('jaw', '턱', '#3b82f6', { shift: () => 8 }), line('teeth', '이빨', '#ef4444', { shift: () => 5 }), line('lips', '입술', '#22c55e', { shift: () => 3 })],
			(s, p) => ({ jaw: rma(s.hl2, p.jaw), teeth: rma(s.hl2, p.teeth), lips: rma(s.hl2, p.lips) })),
		tech('vstop', 'VStop', 'Volatility Stop', '변동성 스톱', 'volatility stop 추적 손절', '추세', true, 'price',
			[length(20), num('mult', '승수', 2, 0.1, 0.1)], [colored('stop', '스톱')],
			(s, p) => {
				const result = trailing(s.c, map(atr(s, p.length), value => value * p.mult));
				return { stop: result.stop, $colors: { stop: result.colors } };
			}),
		tech('aroon', 'Aroon', 'Aroon', '아룬', 'aroon 추세 강도', '추세', false, 'osc', [length(14)],
			[line('up', '상승', '#f59e0b'), line('down', '하락', '#3b82f6')],
			(s, p) => ({
				up: map(barsSince(s.h, p.length + 1, (a, b) => a > b), value => 100 * (p.length - value) / p.length),
				down: map(barsSince(s.l, p.length + 1, (a, b) => a < b), value => 100 * (p.length - value) / p.length),
			}), { levels: [70, 30] }),
		tech('vortex', 'VI', 'Vortex Indicator', '보텍스', 'vortex 추세', '추세', false, 'osc', [length(14)],
			[line('plus', 'VI+', '#22c55e'), line('minus', 'VI-', '#ef4444')],
			(s, p) => {
				const range = total(trueRange(s), p.length);
				const up = s.h.map((high, i) => (i === 0 ? null : Math.abs(high - s.l[i - 1])));
				const down = s.l.map((low, i) => (i === 0 ? null : Math.abs(low - s.h[i - 1])));
				return { plus: zip(total(up, p.length), range, (a, b) => (b === 0 ? 0 : a / b)), minus: zip(total(down, p.length), range, (a, b) => (b === 0 ? 0 : a / b)) };
			}),
		tech('chop', 'CHOP', 'Choppiness Index', '초피니스 지수', 'choppiness 횡보', '변동성', false, 'osc', [length(14)], [line('chop', 'CHOP', '#06b6d4')],
			(s, p) => {
				const span = zip(highest(s.h, p.length), lowest(s.l, p.length), (high, low) => high - low);
				return { chop: zip(total(trueRange(s), p.length), span, (sum, width) => (width === 0 ? null : 100 * Math.log10(sum / width) / Math.log10(p.length))) };
			}, { levels: [61.8, 38.2] }),
		tech('bbpct', '%B', 'Bollinger Bands %B', '볼린저 %B', 'bollinger percent b', '변동성', false, 'osc', [length(20), num('mult', '승수', 2, 0.1, 0.1)], [line('b', '%B', '#14b8a6')],
			(s, p) => {
				const basis = sma(s.c, p.length);
				const dev = stdev(s.c, p.length);
				return { b: basis.map((mid, i) => (mid === null || dev[i] === 0 ? null : (s.c[i] - (mid - p.mult * dev[i])) / (2 * p.mult * dev[i]))) };
			}, { levels: [1, 0.5, 0] }),
		tech('bbw', 'BBW', 'Bollinger Bands Width', '볼린저 밴드 폭', 'bollinger width 밴드폭 수축', '변동성', false, 'osc', [length(20), num('mult', '승수', 2, 0.1, 0.1)], [line('width', '폭', '#14b8a6')],
			(s, p) => ({ width: zip(sma(s.c, p.length), stdev(s.c, p.length), (mid, dev) => (mid === 0 ? null : 2 * p.mult * dev / mid)) })),
		tech('stddev', 'StdDev', 'Standard Deviation', '표준편차', 'standard deviation 변동성', '변동성', false, 'price', [length(20)], [line('dev', '표준편차', '#8b5cf6')],
			(s, p) => ({ dev: stdev(s.c, p.length) })),
		tech('mass', 'MI', 'Mass Index', '매스 인덱스', 'mass index 반전', '변동성', false, 'osc', [length(10)], [line('mass', 'MI', '#f97316')],
			(s, p) => {
				const span = s.h.map((high, i) => high - s.l[i]);
				const once = ema(span, 9);
				return { mass: total(zip(once, ema(once, 9), (a, b) => (b === 0 ? null : a / b)), p.length) };
			}),
		tech('ao', 'AO', 'Awesome Oscillator', '어썸 오실레이터', 'awesome 빌 윌리엄스', '모멘텀', false, 'price', [], [hist('ao', 'AO')],
			(s) => {
				const ao = zip(sma(s.hl2, 5), sma(s.hl2, 34), (fast, slow) => fast - slow);
				return { ao, $colors: { ao: softRising(ao) } };
			}),
		tech('cmo', 'CMO', 'Chande Momentum Oscillator', '챈드 모멘텀', 'chande momentum', '모멘텀', false, 'osc', [length(9)], [line('cmo', 'CMO', '#3b82f6')],
			(s, p) => {
				const move = change(s.c);
				const up = total(map(move, value => Math.max(value, 0)), p.length);
				const down = total(map(move, value => Math.max(-value, 0)), p.length);
				return { cmo: zip(up, down, (a, b) => (a + b === 0 ? 0 : 100 * (a - b) / (a + b))) };
			}, { levels: [50, 0, -50] }),
		tech('coppock', 'Coppock', 'Coppock Curve', '코폭 곡선', 'coppock 장기', '모멘텀', false, 'osc', [num('wma', 'WMA 기간', 10), num('long', '장기 ROC', 14), num('short', '단기 ROC', 11)], [line('curve', 'Coppock', '#3b82f6')],
			(s, p) => {
				const rate = n => shifted(s.c, n, (now, before) => (before === 0 ? null : (now - before) / before * 100));
				return { curve: wma(zip(rate(p.long), rate(p.short), (a, b) => a + b), p.wma) };
			}, { levels: [0] }),
		tech('dpo', 'DPO', 'Detrended Price Oscillator', '추세 제거 오실레이터', 'detrended 사이클', '모멘텀', false, 'price', [length(21)], [line('dpo', 'DPO', '#22c55e')],
			(s, p) => ({ dpo: zip(s.c, lag(sma(s.c, p.length), Math.floor(p.length / 2) + 1), (close, mean) => close - mean) }), { levels: [0] }),
		tech('fisher', 'Fisher', 'Fisher Transform', '피셔 변환', 'fisher ehlers', '모멘텀', false, 'osc', [length(9)], [line('fisher', 'Fisher', '#3b82f6'), line('trigger', '트리거', '#f97316')],
			(s, p) => {
				const top = highest(s.hl2, p.length);
				const bottom = lowest(s.hl2, p.length);
				let value = 0;
				let fish = 0;
				const fisher = s.hl2.map((price, i) => {
					if (top[i] === null) return null;
					const span = top[i] - bottom[i];
					value = 0.66 * ((span === 0 ? 0.5 : (price - bottom[i]) / span) - 0.5) + 0.67 * value;
					value = Math.max(-0.999, Math.min(0.999, value));
					fish = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * fish;
					return fish;
				});
				return { fisher, trigger: lag(fisher, 1) };
			}, { levels: [1.5, 0, -1.5] }),
		tech('trix', 'TRIX', 'TRIX', '트릭스', 'trix 삼중 지수', '모멘텀', false, 'osc', [length(18)], [line('trix', 'TRIX', '#ef4444')],
			(s, p) => ({ trix: map(change(ema(ema(ema(s.c.map(Math.log), p.length), p.length), p.length)), value => value * 10000) }), { levels: [0] }),
		tech('tsi', 'TSI', 'True Strength Index', '진정 강도 지수', 'true strength', '모멘텀', false, 'osc', [num('long', '장기', 25), num('short', '단기', 13), num('signal', '시그널', 13)],
			[line('tsi', 'TSI', '#3b82f6'), line('signal', '시그널', '#f97316')],
			(s, p) => {
				const move = change(s.c);
				const tsi = zip(ema(ema(move, p.long), p.short), ema(ema(map(move, Math.abs), p.long), p.short), (a, b) => (b === 0 ? 0 : 100 * a / b));
				return { tsi, signal: ema(tsi, p.signal) };
			}, { levels: [0] }),
		tech('uo', 'UO', 'Ultimate Oscillator', '얼티밋 오실레이터', 'ultimate', '모멘텀', false, 'osc', [num('fast', '단기', 7), num('middle', '중기', 14), num('slow', '장기', 28)], [line('uo', 'UO', '#ef4444')],
			(s, p) => {
				const buying = s.c.map((close, i) => (i === 0 ? null : close - Math.min(s.l[i], s.c[i - 1])));
				const range = trueRange(s).map((value, i) => (i === 0 ? null : value));
				const part = n => zip(total(buying, n), total(range, n), (a, b) => (b === 0 ? 0 : a / b));
				const [fast, middle, slow] = [part(p.fast), part(p.middle), part(p.slow)];
				return { uo: slow.map((value, i) => (value === null ? null : 100 * (4 * fast[i] + 2 * middle[i] + value) / 7)) };
			}, { levels: [70, 50, 30] }),
		tech('ppo', 'PPO', 'Percentage Price Oscillator', '가격 백분율 오실레이터', 'ppo macd 백분율', '모멘텀', false, 'osc', [num('fast', '단기', 12), num('slow', '장기', 26), num('signal', '시그널', 9)],
			[hist('hist', '히스토그램'), line('ppo', 'PPO', '#3b82f6'), line('signal', '시그널', '#f97316')],
			(s, p) => {
				const ppo = zip(ema(s.c, p.fast), ema(s.c, p.slow), (fast, slow) => (slow === 0 ? null : 100 * (fast - slow) / slow));
				const signal = ema(ppo, p.signal);
				const bars = zip(ppo, signal, (a, b) => a - b);
				return { hist: bars, ppo, signal, $colors: { hist: signed(bars) } };
			}, { levels: [0] }),
		tech('kst', 'KST', 'Know Sure Thing', 'KST', 'know sure thing 프링', '모멘텀', false, 'osc', [num('signal', '시그널', 9)], [line('kst', 'KST', '#22c55e'), line('signal', '시그널', '#ef4444')],
			(s, p) => {
				const rate = (n, smoothing) => sma(shifted(s.c, n, (now, before) => (before === 0 ? null : (now - before) / before * 100)), smoothing);
				const parts = [rate(10, 10), rate(15, 10), rate(20, 10), rate(30, 15)];
				const kst = parts[3].map((value, i) => (value === null ? null : parts[0][i] + 2 * parts[1][i] + 3 * parts[2][i] + 4 * value));
				return { kst, signal: sma(kst, p.signal) };
			}, { levels: [0] }),
		tech('crsi', 'CRSI', 'Connors RSI', '코너스 RSI', 'connors rsi 연속', '모멘텀', false, 'osc', [num('rsi', 'RSI 기간', 3), num('streak', '연속 기간', 2), num('rank', '순위 기간', 100)], [line('crsi', 'CRSI', '#a855f7')],
			(s, p) => {
				let run = 0;
				const streak = s.c.map((close, i) => {
					if (i === 0) return 0;
					run = close > s.c[i - 1] ? Math.max(run, 0) + 1 : close < s.c[i - 1] ? Math.min(run, 0) - 1 : 0;
					return run;
				});
				const rank = percentRank(shifted(s.c, 1, (now, before) => (before === 0 ? 0 : (now - before) / before)), p.rank);
				const [price, runs] = [rsi(s.c, p.rsi), rsi(streak, p.streak)];
				return { crsi: rank.map((value, i) => (value === null || price[i] === null || runs[i] === null ? null : (price[i] + runs[i] + value) / 3)) };
			}, { levels: [90, 10] }),
		tech('smi', 'SMI', 'Stochastic Momentum Index', '스토캐스틱 모멘텀 지수', 'stochastic momentum smi', '모멘텀', false, 'osc', [length(10, '%K 기간'), num('smooth', '평활', 3), num('signal', '시그널', 3)],
			[line('smi', 'SMI', '#3b82f6'), line('signal', '시그널', '#f97316')],
			(s, p) => {
				const top = highest(s.h, p.length);
				const bottom = lowest(s.l, p.length);
				const twice = x => ema(ema(x, p.smooth), p.smooth);
				const smi = zip(twice(top.map((high, i) => (high === null ? null : s.c[i] - (high + bottom[i]) / 2))), twice(zip(top, bottom, (high, low) => high - low)),
					(distance, span) => (span === 0 ? 0 : distance / (span / 2) * 100));
				return { smi, signal: ema(smi, p.signal) };
			}, { levels: [40, -40] }),
		tech('bbp', 'BBP', 'Bull Bear Power', '불 베어 파워', 'elder ray 엘더', '모멘텀', false, 'price', [length(13)], [hist('power', 'BBP')],
			(s, p) => {
				const power = ema(s.c, p.length).map((mean, i) => (mean === null ? null : s.h[i] + s.l[i] - 2 * mean));
				return { power, $colors: { power: signed(power) } };
			}),
		tech('adl', 'A/D', 'Accumulation/Distribution', '매집/분산', 'accumulation distribution', '거래량', false, 'vol', [], [line('adl', 'A/D', '#22c55e')],
			s => ({ adl: cumulative(moneyFlowVolume(s)) })),
		tech('cmf', 'CMF', 'Chaikin Money Flow', '차이킨 자금 흐름', 'chaikin money flow', '거래량', false, 'osc', [length(20)], [line('cmf', 'CMF', '#22c55e')],
			(s, p) => ({ cmf: zip(total(moneyFlowVolume(s), p.length), total(s.v, p.length), (flow, volume) => (volume === 0 ? 0 : flow / volume)) }), { levels: [0] }),
		tech('chaikin', 'CO', 'Chaikin Oscillator', '차이킨 오실레이터', 'chaikin oscillator', '거래량', false, 'vol', [num('fast', '단기', 3), num('slow', '장기', 10)], [line('osc', 'CO', '#f97316')],
			(s, p) => {
				const adl = cumulative(moneyFlowVolume(s));
				return { osc: zip(ema(adl, p.fast), ema(adl, p.slow), (fast, slow) => fast - slow) };
			}, { levels: [0] }),
		tech('efi', 'EFI', "Elder's Force Index", '엘더 포스 인덱스', 'force index elder', '거래량', false, 'vol', [length(13)], [line('efi', 'EFI', '#ef4444')],
			(s, p) => ({ efi: ema(s.c.map((close, i) => (i === 0 ? null : (close - s.c[i - 1]) * s.v[i])), p.length) }), { levels: [0] }),
		tech('eom', 'EOM', 'Ease of Movement', '이동 용이성', 'ease of movement', '거래량', false, 'osc', [length(14)], [line('eom', 'EOM', '#14b8a6')],
			(s, p) => ({ eom: sma(s.hl2.map((mid, i) => (i === 0 || s.v[i] === 0 ? (i === 0 ? null : 0) : 10000 * (mid - s.hl2[i - 1]) * (s.h[i] - s.l[i]) / s.v[i])), p.length) }), { levels: [0] }),
		tech('pvt', 'PVT', 'Price Volume Trend', '가격 거래량 추세', 'price volume trend', '거래량', false, 'vol', [], [line('pvt', 'PVT', '#3b82f6')],
			s => ({ pvt: cumulative(s.c.map((close, i) => (i === 0 || s.c[i - 1] === 0 ? 0 : s.v[i] * (close - s.c[i - 1]) / s.c[i - 1]))) })),
		tech('pvo', 'PVO', 'Percentage Volume Oscillator', '거래량 백분율 오실레이터', 'pvo volume oscillator', '거래량', false, 'osc', [num('fast', '단기', 12), num('slow', '장기', 26), num('signal', '시그널', 9)],
			[hist('hist', '히스토그램'), line('pvo', 'PVO', '#3b82f6'), line('signal', '시그널', '#f97316')],
			(s, p) => {
				const pvo = zip(ema(s.v, p.fast), ema(s.v, p.slow), (fast, slow) => (slow === 0 ? null : 100 * (fast - slow) / slow));
				const signal = ema(pvo, p.signal);
				const bars = zip(pvo, signal, (a, b) => a - b);
				return { hist: bars, pvo, signal, $colors: { hist: signed(bars) } };
			}, { levels: [0] }),
		tech('netvol', '순거래량', 'Net Volume', '순거래량', 'net volume', '거래량', false, 'vol', [], [hist('net', '순거래량')],
			(s) => {
				const net = s.c.map((close, i) => (i === 0 ? 0 : close > s.c[i - 1] ? s.v[i] : close < s.c[i - 1] ? -s.v[i] : 0));
				return { net, $colors: { net: signed(net) } };
			}),
	];

	// ---------- 커스텀 지표 ----------
	// TradingView 커뮤니티에서 널리 쓰이는 공개 지표의 계산식을 이 프로그램에 맞게 다시 구현한 것이다.
	// 원본 스크립트의 코드를 옮긴 것이 아니며, by에는 그 지표를 알린 사람을 적는다. 값이 원본과 조금 다를 수 있다.

	const custom = (id, short, name, ko, tags, by, overlay, fmt, params, plots, calc, extra = {}) =>
		({ id, short, name, ko, tags, by, group: 'custom', cat: overlay ? '추세' : '모멘텀', overlay, fmt, params, plots, calc, ...extra });

	const customDefs = [
		custom('squeeze', 'SQZMOM', 'Squeeze Momentum Indicator', '스퀴즈 모멘텀', 'squeeze momentum ttm 볼린저 켈트너 수축', 'LazyBear', false, 'price',
			[length(20, 'BB 기간'), num('bbMult', 'BB 승수', 2, 0.1, 0.1), num('kc', 'KC 기간', 20), num('kcMult', 'KC 승수', 1.5, 0.1, 0.1)],
			[hist('momentum', '모멘텀'), { k: 'state', label: '수축', type: 'dots', color: '#6b7280', fixedColor: true }],
			(s, p) => {
				const basis = sma(s.c, p.length);
				const dev = stdev(s.c, p.length);
				const mean = sma(s.c, p.kc);
				const range = average(s, p.kc);
				const middle = zip(zip(highest(s.h, p.kc), lowest(s.l, p.kc), (high, low) => (high + low) / 2), mean, (a, b) => (a + b) / 2);
				const momentum = linreg(s.c.map((close, i) => (middle[i] === null ? null : close - middle[i])), p.kc);
				const colors = momentum.map((value, i) => {
					if (value === null) return null;
					const up = value >= (momentum[i - 1] ?? value);
					return value >= 0 ? (up ? UP : UP_SOFT) : (up ? DOWN_SOFT : DOWN);
				});
				// 볼린저 밴드가 켈트너 채널 안으로 들어오면 수축 상태다.
				const state = basis.map((mid, i) => (mid === null || range[i] === null || mean[i] === null ? null : 0));
				const stateColors = basis.map((mid, i) => (mid === null || range[i] === null || mean[i] === null ? null
					: mid - p.bbMult * dev[i] > mean[i] - p.kcMult * range[i] && mid + p.bbMult * dev[i] < mean[i] + p.kcMult * range[i] ? '#f59e0b' : '#6b7280'));
				return { momentum, state, $colors: { momentum: colors, state: stateColors } };
			}),
		custom('wavetrend', 'WT', 'WaveTrend Oscillator', '웨이브트렌드', 'wavetrend wt 과매수 과매도', 'LazyBear', false, 'osc',
			[num('channel', '채널 기간', 10), num('average', '평균 기간', 21)],
			[hist('diff', '차이'), line('wt1', 'WT1', '#22c55e'), line('wt2', 'WT2', '#ef4444')],
			(s, p) => {
				const mean = ema(s.hlc3, p.channel);
				const spread = ema(s.hlc3.map((price, i) => (mean[i] === null ? null : Math.abs(price - mean[i]))), p.channel);
				const wt1 = ema(s.hlc3.map((price, i) => (spread[i] === null ? null : spread[i] === 0 ? 0 : (price - mean[i]) / (0.015 * spread[i]))), p.average);
				const wt2 = sma(wt1, 4);
				const diff = zip(wt1, wt2, (a, b) => a - b);
				return { diff, wt1, wt2, $colors: { diff: signed(diff) } };
			}, { levels: [60, 53, -53, -60] }),
		custom('utbot', 'UT Bot', 'UT Bot Alerts', 'UT 봇', 'ut bot atr 추적 손절 매수 매도', 'HPotter · QuantNomad', true, 'price',
			[num('key', '민감도', 1, 0.1, 0.1), num('atr', 'ATR 기간', 10)], [colored('stop', 'UT 스톱')],
			(s, p) => {
				const result = trailing(s.c, map(atr(s, p.atr), value => value * p.key));
				return { stop: result.stop, $colors: { stop: result.colors } };
			}),
		custom('chandelier', 'CE', 'Chandelier Exit', '샹들리에 엑시트', 'chandelier exit 추적 손절', 'Chuck LeBeau · Everget', true, 'price',
			[length(22, 'ATR 기간'), num('mult', '승수', 3, 0.1, 0.1)], [colored('stop', '엑시트')],
			(s, p) => {
				const range = atr(s, p.length);
				const top = highest(s.c, p.length);
				const bottom = lowest(s.c, p.length);
				const stop = blank(s.n);
				const colors = blank(s.n);
				let long = null;
				let short = null;
				let direction = 1;
				for (let i = 0; i < s.n; i++) {
					if (range[i] === null) continue;
					const nextLong = top[i] - range[i] * p.mult;
					const nextShort = bottom[i] + range[i] * p.mult;
					const previousLong = long ?? nextLong;
					const previousShort = short ?? nextShort;
					long = s.c[i - 1] > previousLong ? Math.max(nextLong, previousLong) : nextLong;
					short = s.c[i - 1] < previousShort ? Math.min(nextShort, previousShort) : nextShort;
					if (s.c[i] > previousShort) direction = 1;
					else if (s.c[i] < previousLong) direction = -1;
					stop[i] = direction === 1 ? long : short;
					colors[i] = direction === 1 ? UP : DOWN;
				}
				return { stop, $colors: { stop: colors } };
			}),
		custom('ssl', 'SSL', 'SSL Channel', 'SSL 채널', 'ssl channel 추세', 'ErwinBeckers', true, 'price', [length(10)],
			[line('up', 'SSL 상승', '#22c55e', { width: 2 }), line('down', 'SSL 하락', '#ef4444', { width: 2 })],
			(s, p) => {
				const high = sma(s.h, p.length);
				const low = sma(s.l, p.length);
				let side = 1;
				const up = blank(s.n);
				const down = blank(s.n);
				for (let i = 0; i < s.n; i++) {
					if (high[i] === null) continue;
					if (s.c[i] > high[i]) side = 1;
					else if (s.c[i] < low[i]) side = -1;
					up[i] = side < 0 ? low[i] : high[i];
					down[i] = side < 0 ? high[i] : low[i];
				}
				return { up, down };
			}),
		custom('hullsuite', 'Hull', 'Hull Suite', '헐 스위트', 'hull suite hma 추세 색', 'InSilico', true, 'price', [length(55)], [colored('hull', 'Hull')],
			(s, p) => {
				const half = wma(s.c, Math.max(1, Math.floor(p.length / 2)));
				const hull = wma(zip(half, wma(s.c, p.length), (fast, slow) => 2 * fast - slow), Math.max(1, Math.round(Math.sqrt(p.length))));
				return { hull, $colors: { hull: hull.map((value, i) => (value !== null && hull[i - 2] !== null && i >= 2 && value < hull[i - 2] ? DOWN : UP)) } };
			}, { axisLabel: true }),
		custom('qqe', 'QQE', 'Quantitative Qualitative Estimation', 'QQE', 'qqe rsi 추적', 'Glaz', false, 'osc',
			[length(14, 'RSI 기간'), num('smooth', 'RSI 평활', 5), num('factor', '승수', 4.236, 0.1, 0.001)],
			[line('rsi', 'RSI 평활', '#3b82f6', { width: 2 }), line('trail', '추적선', '#f59e0b')],
			(s, p) => {
				const smoothed = ema(rsi(s.c, p.length), p.smooth);
				const wilder = p.length * 2 - 1;
				const delta = map(ema(ema(map(change(smoothed), Math.abs), wilder), wilder), value => value * p.factor);
				const trail = blank(s.n);
				let long = null;
				let short = null;
				let trend = 1;
				for (let i = 1; i < s.n; i++) {
					if (delta[i] === null) continue;
					const value = smoothed[i];
					const before = smoothed[i - 1];
					const previousLong = long ?? value - delta[i];
					const previousShort = short ?? value + delta[i];
					long = before > previousLong && value > previousLong ? Math.max(previousLong, value - delta[i]) : value - delta[i];
					short = before < previousShort && value < previousShort ? Math.min(previousShort, value + delta[i]) : value + delta[i];
					if (value > previousShort) trend = 1;
					else if (value < previousLong) trend = -1;
					trail[i] = trend === 1 ? long : short;
				}
				return { rsi: smoothed, trail };
			}, { levels: [50] }),
		custom('rangefilter', 'RF', 'Range Filter', '레인지 필터', 'range filter 노이즈 추세', 'DonovanWall · guikroth', true, 'price',
			[length(100, '기간'), num('mult', '승수', 3, 0.1, 0.1)], [colored('filter', '필터')],
			(s, p) => {
				const range = map(ema(ema(map(change(s.c), Math.abs), p.length), p.length * 2 - 1), value => value * p.mult);
				const filter = blank(s.n);
				let previous = null;
				for (let i = 0; i < s.n; i++) {
					if (range[i] === null) continue;
					const price = s.c[i];
					if (previous === null) previous = price;
					else if (price > previous) previous = Math.max(previous, price - range[i]);
					else previous = Math.min(previous, price + range[i]);
					filter[i] = previous;
				}
				let color = UP;
				return { filter, $colors: { filter: filter.map((value, i) => {
					if (value === null) return null;
					if (filter[i - 1] !== null && i > 0 && value !== filter[i - 1]) color = value > filter[i - 1] ? UP : DOWN;
					return color;
				}) } };
			}),
		custom('halftrend', 'HalfTrend', 'HalfTrend', '하프트렌드', 'halftrend half trend 추세', 'Everget', true, 'price', [num('amplitude', '진폭', 2)], [colored('trend', 'HalfTrend')],
			(s, p) => {
				const highs = highest(s.h, p.amplitude);
				const lows = lowest(s.l, p.amplitude);
				const highMean = sma(s.h, p.amplitude);
				const lowMean = sma(s.l, p.amplitude);
				const line1 = blank(s.n);
				const colors = blank(s.n);
				let trend = 0;
				let next = 0;
				let maxLow = null;
				let minHigh = null;
				let up = null;
				let down = null;
				for (let i = 1; i < s.n; i++) {
					if (highMean[i] === null) continue;
					maxLow ??= s.l[i - 1];
					minHigh ??= s.h[i - 1];
					const before = trend;
					if (next === 1) {
						maxLow = Math.max(lows[i], maxLow);
						if (highMean[i] < maxLow && s.c[i] < s.l[i - 1]) {
							trend = 1;
							next = 0;
							minHigh = highs[i];
						}
					}
					else {
						minHigh = Math.min(highs[i], minHigh);
						if (lowMean[i] > minHigh && s.c[i] > s.h[i - 1]) {
							trend = 0;
							next = 1;
							maxLow = lows[i];
						}
					}
					if (trend === 0) up = before !== 0 ? (down ?? maxLow) : Math.max(maxLow, up ?? maxLow);
					else down = before !== 1 ? (up ?? minHigh) : Math.min(minHigh, down ?? minHigh);
					line1[i] = trend === 0 ? up : down;
					colors[i] = trend === 0 ? UP : DOWN;
				}
				return { trend: line1, $colors: { trend: colors } };
			}),
		custom('trendmagic', 'Magic', 'Trend Magic', '트렌드 매직', 'trend magic cci atr', 'KivancOzbilgic', true, 'price',
			[length(20, 'CCI 기간'), num('atr', 'ATR 기간', 5), num('mult', '승수', 1, 0.1, 0.1)], [colored('magic', 'Trend Magic')],
			(s, p) => {
				const strength = cci(s, p.length);
				const range = average(s, p.atr);
				const magic = blank(s.n);
				const colors = blank(s.n);
				let previous = null;
				for (let i = 0; i < s.n; i++) {
					if (strength[i] === null || range[i] === null) continue;
					const rising1 = strength[i] >= 0;
					const next = rising1 ? s.l[i] - range[i] * p.mult : s.h[i] + range[i] * p.mult;
					previous = previous === null ? next : rising1 ? Math.max(next, previous) : Math.min(next, previous);
					magic[i] = previous;
					colors[i] = rising1 ? UP : DOWN;
				}
				return { magic, $colors: { magic: colors } };
			}),
		custom('vixfix', 'WVF', 'Williams Vix Fix', '윌리엄스 빅스 픽스', 'vix fix 바닥 공포', 'Larry Williams · ChrisMoody', false, 'osc',
			[length(22, '기간'), num('band', '밴드 기간', 20), num('mult', '밴드 승수', 2, 0.1, 0.1), num('look', '백분위 기간', 50)],
			[hist('wvf', 'WVF'), line('upper', '상단 밴드', '#3b82f6')],
			(s, p) => {
				const top = highest(s.c, p.length);
				const wvf = top.map((high, i) => (high === null || high === 0 ? null : (high - s.l[i]) / high * 100));
				const upper = zip(sma(wvf, p.band), stdev(wvf, p.band), (mid, dev) => mid + p.mult * dev);
				const ceiling = map(highest(wvf, p.look), value => value * 0.85);
				// 밴드나 최근 고점 근처를 넘으면 공포가 큰 구간으로 본다.
				return { wvf, upper, $colors: { wvf: wvf.map((value, i) => (value === null ? null : (upper[i] !== null && value >= upper[i]) || (ceiling[i] !== null && value >= ceiling[i]) ? UP : 'rgba(125, 133, 150, 0.5)')) } };
			}),
		custom('coral', 'Coral', 'Coral Trend Indicator', '코랄 트렌드', 'coral trend 평활', 'LazyBear', true, 'price',
			[length(21, '평활 기간'), num('factor', '계수', 0.4, 0.05, 0.05)], [colored('coral', 'Coral', 3)],
			(s, p) => {
				const alpha = 2 / ((p.length - 1) / 2 + 2);
				const f = p.factor;
				const stages = [];
				let input = s.c;
				for (let stage = 0; stage < 6; stage++) {
					input = recursive(input, (value, previous) => (previous === null ? value : alpha * value + (1 - alpha) * previous));
					stages.push(input);
				}
				const coral = s.c.map((unused, i) => -f * f * f * stages[5][i] + 3 * (f * f + f * f * f) * stages[4][i] - 3 * (2 * f * f + f + f * f * f) * stages[3][i] + (3 * f + 1 + f * f * f + 3 * f * f) * stages[2][i]);
				return { coral, $colors: { coral: rising(coral) } };
			}),
		custom('stc', 'STC', 'Schaff Trend Cycle', '샤프 트렌드 사이클', 'schaff trend cycle', 'Doug Schaff', false, 'osc',
			[num('cycle', '사이클', 10), num('fast', '단기', 23), num('slow', '장기', 50)], [line('stc', 'STC', '#ef4444', { width: 2 })],
			(s, p) => {
				const smoothHalf = x => recursive(x, (value, previous) => (previous === null ? value : previous + 0.5 * (value - previous)));
				const macd = zip(ema(s.c, p.fast), ema(s.c, p.slow), (fast, slow) => fast - slow);
				const first = smoothHalf(stochasticOf(macd, p.cycle));
				return { stc: smoothHalf(stochasticOf(first, p.cycle)) };
			}, { levels: [75, 25] }),
		custom('nwe', 'NW', 'Nadaraya-Watson Kernel Regression', '나다라야-왓슨 회귀', 'nadaraya watson kernel 회귀 추정', '커널 회귀 (jdehorty 방식의 끝점 추정)', true, 'price',
			[num('h', '창 크기', 8, 1, 1), num('r', '가중 형태', 8, 0.25, 0.25), num('window', '사용할 봉 수', 60, 10, 5)], [colored('estimate', '추정선')],
			(s, p) => {
				// 지난 봉만 써서 추정하므로, 새 봉이 생겨도 과거 값이 바뀌지 않는다.
				const weights = Array.from({ length: p.window }, (unused, j) => (1 + j * j / (2 * p.r * p.h * p.h)) ** -p.r);
				const estimate = s.c.map((unused, i) => {
					if (i < 25) return null;
					let sum = 0;
					let norm = 0;
					for (let j = 0; j < p.window && j <= i; j++) {
						sum += s.c[i - j] * weights[j];
						norm += weights[j];
					}
					return sum / norm;
				});
				return { estimate, $colors: { estimate: rising(estimate) } };
			}),
		custom('impulsemacd', 'IMACD', 'Impulse MACD', '임펄스 MACD', 'impulse macd 횡보 제거', 'LazyBear', false, 'price',
			[length(34, 'MA 기간'), num('signal', '시그널', 9)], [hist('impulse', '임펄스'), line('signal', '시그널', '#f97316')],
			(s, p) => {
				const middle = dema(s.hlc3, p.length);
				const high = rma(s.h, p.length);
				const low = rma(s.l, p.length);
				// 평균이 고가·저가 평균 사이에 있으면 0으로 눌러 횡보 구간의 잔신호를 없앤다.
				const impulse = middle.map((value, i) => (value === null || high[i] === null ? null : value > high[i] ? value - high[i] : value < low[i] ? value - low[i] : 0));
				return { impulse, signal: sma(impulse, p.signal), $colors: { impulse: signed(impulse) } };
			}, { levels: [0] }),
		custom('laguerre', 'LaRSI', 'Laguerre RSI', '라게르 RSI', 'laguerre rsi ehlers', 'John Ehlers', false, 'osc', [num('gamma', '감마', 0.5, 0.05, 0.05)], [line('rsi', 'Laguerre RSI', '#a855f7', { width: 2 })],
			(s, p) => {
				const g = Math.min(0.99, p.gamma);
				let l = [0, 0, 0, 0];
				let started = false;
				return { rsi: s.c.map((close) => {
					if (!started) {
						l = [close, close, close, close];
						started = true;
					}
					const l0 = (1 - g) * close + g * l[0];
					const l1 = -g * l0 + l[0] + g * l[1];
					const l2 = -g * l1 + l[1] + g * l[2];
					const l3 = -g * l2 + l[2] + g * l[3];
					l = [l0, l1, l2, l3];
					const up = Math.max(l0 - l1, 0) + Math.max(l1 - l2, 0) + Math.max(l2 - l3, 0);
					const down = Math.max(l1 - l0, 0) + Math.max(l2 - l1, 0) + Math.max(l3 - l2, 0);
					return up + down === 0 ? 50 : 100 * up / (up + down);
				}) };
			}, { levels: [80, 20] }),
		custom('alphatrend', 'AlphaTrend', 'AlphaTrend', '알파트렌드', 'alphatrend alpha trend mfi atr', 'KivancOzbilgic', true, 'price',
			[length(14, '기간'), num('mult', '승수', 1, 0.1, 0.1)], [colored('alpha', 'AlphaTrend'), line('lagged', '2봉 전', '#787b86')],
			(s, p) => {
				const range = average(s, p.length);
				const hasVolume = s.v.some(volume => volume > 0);
				// 거래량이 없는 종목은 자금 흐름 대신 RSI로 방향을 본다.
				const strength = hasVolume ? moneyFlow(s, p.length) : rsi(s.c, p.length);
				const alpha = blank(s.n);
				let previous = null;
				for (let i = 0; i < s.n; i++) {
					if (range[i] === null || strength[i] === null) continue;
					const rising1 = strength[i] >= 50;
					const next = rising1 ? s.l[i] - range[i] * p.mult : s.h[i] + range[i] * p.mult;
					previous = previous === null ? next : rising1 ? Math.max(next, previous) : Math.min(next, previous);
					alpha[i] = previous;
				}
				const lagged = lag(alpha, 2);
				return { alpha, lagged, $colors: { alpha: alpha.map((value, i) => (value !== null && lagged[i] !== null && value < lagged[i] ? DOWN : UP)) } };
			}),
		custom('ott', 'OTT', 'Optimized Trend Tracker', '옵티마이즈드 트렌드 트래커', 'ott optimized trend tracker', 'Anıl Özekşi · KivancOzbilgic', true, 'price',
			[length(2, '기간'), num('percent', '퍼센트', 1.4, 0.1, 0.1)], [line('ott', 'OTT', '#a855f7', { width: 2 }), line('support', '지지선', '#3b82f6')],
			(s, p) => {
				const support = vidya(s.c, p.length);
				const ott = blank(s.n);
				let long = null;
				let short = null;
				let direction = 1;
				for (let i = 0; i < s.n; i++) {
					const value = support[i];
					if (value === null) continue;
					const offset = value * p.percent * 0.01;
					const previousLong = long ?? value - offset;
					const previousShort = short ?? value + offset;
					long = value > previousLong ? Math.max(value - offset, previousLong) : value - offset;
					short = value < previousShort ? Math.min(value + offset, previousShort) : value + offset;
					if (direction === -1 && value > previousShort) direction = 1;
					else if (direction === 1 && value < previousLong) direction = -1;
					const stop = direction === 1 ? long : short;
					ott[i] = value > stop ? stop * (200 + p.percent) / 200 : stop * (200 - p.percent) / 200;
				}
				return { ott: lag(ott, 2), support };
			}),
		custom('ribbon', 'Ribbon', 'EMA Ribbon', 'EMA 리본', 'ema ribbon 리본 이평 다발', '여러 사람이 쓰는 방식', true, 'price', [length(20, '시작 기간'), num('step', '간격', 5)],
			['#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4'].map((color, i) => line(`e${ i }`, `EMA ${ i + 1 }`, color)),
			(s, p) => Object.fromEntries(Array.from({ length: 8 }, (unused, i) => [`e${ i }`, ema(s.c, p.length + p.step * i)]))),
		custom('smiergodic', 'SMIE', 'SMI Ergodic Indicator', 'SMI 에르고딕', 'smi ergodic tsi', 'William Blau', false, 'osc', [num('long', '장기', 20), num('short', '단기', 5), num('signal', '시그널', 5)],
			[hist('osc', '오실레이터'), line('smi', 'SMI', '#3b82f6'), line('signal', '시그널', '#f97316')],
			(s, p) => {
				const move = change(s.c);
				const smi = zip(ema(ema(move, p.short), p.long), ema(ema(map(move, Math.abs), p.short), p.long), (a, b) => (b === 0 ? 0 : a / b));
				const signal = ema(smi, p.signal);
				const osc = zip(smi, signal, (a, b) => a - b);
				return { osc, smi, signal, $colors: { osc: signed(osc) } };
			}, { levels: [0] }),
	];

	// ---------- 매물대와 지지·저항 ----------
	// 선으로 그릴 수 없는 부분(가로 막대, 구간 띠)은 draw가 가격 차트 위에 직접 그린다.

	const tint = (hex, alpha) => `rgba(${ parseInt(hex.slice(1, 3), 16) }, ${ parseInt(hex.slice(3, 5), 16) }, ${ parseInt(hex.slice(5, 7), 16) }, ${ alpha })`;
	const clamp = value => Math.max(0, Math.min(1, value));
	const ZONE_CELLS = 8;

	// 코인 거래소에 무기한 선물로 올라오는 미국 주식·ETF. 기초 시장이 쉬는 주말에는 가격 움직임의 의미가 작다.
	const STOCK_TOKENS = new Set([
		...(window.ChartDeskProviders?.curated ?? [])
			.filter(item => (item.type === 'stock' || item.type === 'fund') && item.exch === '미국')
			.map(item => item.code.replace('-', '')),
		'GOOG', 'HOOD', 'CRCL', 'BABA', 'GME', 'AMC', 'MARA', 'RIOT', 'SMCI', 'SHOP', 'PYPL', 'COST',
	].filter(code => code.length >= 3));

	function isStockToken(info) {
		if (!info || info.type !== 'perp') return false;
		const base = String(info.base ?? info.display ?? '').toUpperCase().replace('.P', '').replace(/(USDT|USDC|USD|PERP)$/, '');
		return STOCK_TOKENS.has(base) || (base.endsWith('X') && STOCK_TOKENS.has(base.slice(0, -1)));
	}

	// 짧은 주기의 전환점은 잡음이 많아 구간이 화면을 덮는다. 지지·저항은 한 단계 위 주기의 봉으로 찾는다.
	const ZONE_BASIS_AUTO = { '1m': '1h', '3m': '1h', '5m': '1h', '15m': '4h', '30m': '4h', '1h': '1d', '2h': '1d' };
	const ZONE_BASIS_CHOICES = [null, null, '1h', '4h', '1d'];
	const ZONE_BASIS_ORDER = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1M'];
	const ZONE_BASIS_NAMES = { '1h': '1시간봉', '4h': '4시간봉', '1d': '일봉' };

	/** 지지·저항을 찾을 주기. 차트 주기와 같거나 짧으면 null(차트 봉을 그대로 쓴다). */
	function zoneBasis(p, interval) {
		const choice = Math.round(p.basis ?? 0);
		const wanted = choice === 0 ? ZONE_BASIS_AUTO[interval] : ZONE_BASIS_CHOICES[choice];
		if (!wanted || ZONE_BASIS_ORDER.indexOf(wanted) <= ZONE_BASIS_ORDER.indexOf(interval)) return null;
		return wanted;
	}

	/** 전환점을 모아 지지·저항 구간을 만든다. 구간의 from·last는 봉 시간이다. */
	function findZones(s, p, context) {
		const from = p.bars > 0 ? Math.max(0, s.n - p.bars) : 0;
		const result = { zones: [], skipWeekend: false, skipped: 0 };
		if (s.n - from < 10) return result;
		let low = Infinity;
		let high = -Infinity;
		let sum = 0;
		const hasVolume = s.v.slice(from).some(volume => volume > 0);
		const weight = i => (hasVolume ? s.v[i] : 1);
		for (let i = from; i < s.n; i++) {
			low = Math.min(low, s.l[i]);
			high = Math.max(high, s.h[i]);
			sum += weight(i);
		}
		if (!(high > low)) return result;

		// 지지·저항: 앞뒤 봉보다 높거나 낮은 전환점을 모아, 가까운 가격끼리 한 구간으로 묶는다.
		const span = Math.max(2, Math.round(p.pivot));
		const ranges = atr(s, 14);
		const moves = trueRange(s);
		const usual = sma(s.v, 20);
		const tolerance = (ranges[s.n - 1] ?? (high - low) * 0.01) * 0.6;
		// 주식 선물 토큰은 주말 전환점을 뺀다. 평소의 두 배가 넘는 움직임이나 거래량이 나온 봉만 남긴다.
		const skipWeekend = p.weekend === 1 || (p.weekend === 0 && isStockToken(context.info));
		result.skipWeekend = skipWeekend;
		const quietWeekend = (i) => {
			if (!skipWeekend) return false;
			const day = new Date((s.t[i] - (context.tzOffset ?? 0)) * 1000).getUTCDay();
			if (day !== 6 && day !== 0) return false;
			const bigMove = ranges[i] !== null && moves[i] >= 2 * ranges[i];
			const bigVolume = hasVolume && usual[i] !== null && usual[i] > 0 && s.v[i] >= 2 * usual[i];
			return !bigMove && !bigVolume;
		};
		const pivots = [];
		for (let i = Math.max(from, span); i < s.n - span; i++) {
			let isHigh = true;
			let isLow = true;
			for (let j = i - span; j <= i + span; j++) {
				if (s.h[j] > s.h[i]) isHigh = false;
				if (s.l[j] < s.l[i]) isLow = false;
			}
			if (!isHigh && !isLow) continue;
			if (quietWeekend(i)) {
				result.skipped++;
				continue;
			}
			// 그 봉의 거래량이 평소의 몇 배였는지. 거래가 터지며 돌아선 자리일수록 무겁게 본다.
			const burst = hasVolume && usual[i] !== null && usual[i] > 0 ? s.v[i] / usual[i] : 1;
			if (isHigh) pivots.push({ price: s.h[i], index: i, burst });
			if (isLow) pivots.push({ price: s.l[i], index: i, burst });
		}
		pivots.sort((a, b) => a.price - b.price);
		const groups = [];
		for (const pivot of pivots) {
			const group = groups[groups.length - 1];
			// 가까운 값이 줄줄이 이어져 구간이 한없이 넓어지지 않도록 폭에 한도를 둔다.
			if (group && pivot.price - group.high <= tolerance && pivot.price - group.low <= tolerance * 2.5) {
				group.high = pivot.price;
				group.touches++;
				group.burst += pivot.burst;
				group.from = Math.min(group.from, pivot.index);
				group.last = Math.max(group.last, pivot.index);
			}
			else groups.push({ low: pivot.price, high: pivot.price, touches: 1, burst: pivot.burst, from: pivot.index, last: pivot.index });
		}
		const close = context.close ?? s.c[s.n - 1];
		const unit = ranges[s.n - 1] ?? (high - low) * 0.01;
		// 같은 가격대가 여러 묶음으로 쪼개져 있으면 하나씩은 약해 보이지만 함께 보면 단단한 자리다.
		// 구간 가장자리에서 ATR 하나 안쪽의 전환점까지 닿은 횟수로 센다.
		const nearby = group => groups.reduce((count, other) => (other.high >= group.low - unit && other.low <= group.high + unit ? count + other.touches : count), 0);
		const zones = groups
			.filter(group => group.touches >= 2)
			.map((group) => {
				const pad = tolerance * 0.15;
				const zone = { low: group.low - pad, high: group.high + pad, touches: nearby(group), from: s.t[group.from], last: s.t[group.last] };
				// 구간 안을 잘게 나눠 어느 가격에 거래가 몰렸는지 본다.
				const cellStep = (zone.high - zone.low) / ZONE_CELLS;
				const cells = new Array(ZONE_CELLS).fill(0);
				for (let i = from; i < s.n; i++) {
					if (s.h[i] < zone.low || s.l[i] > zone.high) continue;
					const barSpan = s.h[i] - s.l[i];
					for (let cell = 0; cell < ZONE_CELLS; cell++) {
						const cellLow = zone.low + cell * cellStep;
						const overlap = Math.min(s.h[i], cellLow + cellStep) - Math.max(s.l[i], cellLow);
						if (barSpan === 0 ? s.c[i] >= cellLow && s.c[i] < cellLow + cellStep : overlap > 0) cells[cell] += barSpan === 0 ? weight(i) : weight(i) * overlap / barSpan;
					}
				}
				const traded = cells.reduce((a, b) => a + b, 0);
				const peak = Math.max(...cells);
				zone.cells = cells.map(value => (peak > 0 ? value / peak : 0));
				zone.core = zone.low + (cells.indexOf(peak) + 0.5) * cellStep;
				zone.share = sum > 0 ? traded / sum : 0;
				zone.burst = group.burst / group.touches;
				// 신뢰도: 닿은 횟수, 구간에 쌓인 거래의 밀도(가격 폭에 비해 얼마나 많이 거래됐나),
				// 전환점에서 터진 거래량, 최근에 닿았는지를 0~1로 맞춰 더한다.
				const density = zone.share / ((zone.high - zone.low) / (high - low));
				const parts = {
					touches: clamp(zone.touches / 8),
					volume: clamp(density / 2.5),
					burst: clamp((zone.burst - 0.5) / 2.5),
					recent: clamp((group.last - from) / (s.n - from)),
				};
				zone.reliability = hasVolume
					? 0.3 * parts.touches + 0.35 * parts.volume + 0.2 * parts.burst + 0.15 * parts.recent
					: 0.55 * parts.touches + 0.25 * parts.volume + 0.2 * parts.recent;
				zone.kind = close > zone.high ? 'support' : close < zone.low ? 'resistance' : 'inside';
				return zone;
			})
			.sort((a, b) => b.reliability - a.reliability);
		// 최소 신뢰도에 못 미치거나 닿은 횟수가 3번이 안 되는 구간은 그리지 않는다.
		// 신뢰도 순으로 보며, 이미 남긴 구간과 ATR 2.5배 안으로 붙은 구간은 같은 자리로 보고 버린다(겹쳐 쌓이지 않게).
		const floor = (p.minrel ?? 50) / 100;
		const gap = unit * 2.5;
		const apart = [];
		for (const zone of zones) {
			if (zone.reliability < floor) break;
			if (zone.touches < 3) continue;
			if (apart.some(other => zone.low - other.high < gap && other.low - zone.high < gap)) continue;
			apart.push(zone);
		}
		// 현재가 위(저항)와 아래(지지)에서 각각 절반까지, 현재가에 가까운 구간부터 둔다.
		// 신뢰도만 보면 멀리 떨어진 오래된 구간이 자리를 차지해 짧은 차트 화면에는 하나도 안 보인다.
		const limit = Math.max(1, Math.round(p.zones));
		const perSide = Math.ceil(limit / 2);
		const distance = zone => Math.max(zone.low - close, close - zone.high, 0);
		const taken = { support: 0, resistance: 0, inside: 0 };
		for (const zone of apart.sort((a, b) => distance(a) - distance(b))) {
			if (result.zones.length >= limit) break;
			if (zone.kind === 'inside' ? taken.inside >= 1 : taken[zone.kind] >= perSide) continue;
			taken[zone.kind]++;
			result.zones.push(zone);
		}
		return result;
	}

	function volumeZones(s, p, context = {}) {
		const from = p.bars > 0 ? Math.max(0, s.n - p.bars) : 0;
		const out = { poc: blank(s.n), vah: blank(s.n), val: blank(s.n) };
		if (s.n - from < 10) return out;
		let low = Infinity;
		let high = -Infinity;
		for (let i = from; i < s.n; i++) {
			low = Math.min(low, s.l[i]);
			high = Math.max(high, s.h[i]);
		}
		if (!(high > low)) return out;

		// 매물대: 봉마다 거래량을 그 봉의 저가~고가에 고르게 나눠 가격 칸에 쌓는다. 차트에 보이는 봉으로 만든다.
		const rows = Math.max(10, Math.min(200, Math.round(p.rows)));
		const step = (high - low) / rows;
		// 거래량이 없는 종목(지수·환율)은 봉 하나를 1로 쳐서 머문 시간을 대신 쌓는다.
		const hasVolume = s.v.slice(from).some(volume => volume > 0);
		const weight = i => (hasVolume ? s.v[i] : 1);
		const up = new Array(rows).fill(0);
		const down = new Array(rows).fill(0);
		for (let i = from; i < s.n; i++) {
			const first = Math.min(rows - 1, Math.floor((s.l[i] - low) / step));
			const last = Math.min(rows - 1, Math.floor((s.h[i] - low) / step));
			const share = weight(i) / (last - first + 1);
			const side = s.c[i] >= s.o[i] ? up : down;
			for (let row = first; row <= last; row++) side[row] += share;
		}
		const totals = up.map((value, row) => value + down[row]);
		const sum = totals.reduce((a, b) => a + b, 0);
		let pocRow = 0;
		for (let row = 1; row < rows; row++) {
			if (totals[row] > totals[pocRow]) pocRow = row;
		}
		// 가장 많이 거래된 칸에서 위아래로 넓혀 가며 전체의 일정 비율이 담기는 범위(밸류 에어리어)를 구한다.
		let bottom = pocRow;
		let top = pocRow;
		let inside = totals[pocRow];
		while (inside < sum * p.area / 100 && (bottom > 0 || top < rows - 1)) {
			const below = bottom > 0 ? totals[bottom - 1] : -1;
			const above = top < rows - 1 ? totals[top + 1] : -1;
			if (above >= below) inside += totals[++top];
			else inside += totals[--bottom];
		}

		// 지지·저항은 위 주기의 봉이 있으면 그것으로, 아직 받지 못했거나 필요 없으면 차트 봉으로 찾는다.
		const basis = context.basis;
		const close = s.c[s.n - 1];
		const useBasis = basis?.source && basis.source.n >= 10;
		const found = basis?.loading
			? { zones: [], skipWeekend: false, skipped: 0 }
			: findZones(useBasis ? basis.source : s, p, { ...context, close });
		// 구간의 시작 시간을 차트의 봉 번호로 바꾼다. 차트보다 앞선 구간은 왼쪽 끝부터 그린다.
		const indexAt = (time) => {
			let lo = 0;
			let hi = s.n - 1;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (s.t[mid] < time) lo = mid + 1;
				else hi = mid;
			}
			return lo;
		};
		// 위 주기의 구간은 그 주기의 봉 폭만큼 두꺼워 짧은 차트에서는 화면을 덮는다.
		// 구간 안에서 거래가 몰린 부분(가장 진한 칸의 60% 이상인 이웃 칸)만 남기고, 폭은 차트 봉 평균 변동폭(ATR)의 2배까지로 줄인다.
		const chartRange = useBasis ? atr(s, 14)[s.n - 1] : null;
		const narrow = (zone) => {
			if (!useBasis || !chartRange) return zone;
			const peak = zone.cells.indexOf(1);
			let first = peak;
			let last = peak;
			while (first > 0 && zone.cells[first - 1] >= 0.6) first--;
			while (last < zone.cells.length - 1 && zone.cells[last + 1] >= 0.6) last++;
			const cellStep = (zone.high - zone.low) / zone.cells.length;
			let low = zone.low + first * cellStep;
			let high = zone.low + (last + 1) * cellStep;
			let cells = zone.cells.slice(first, last + 1);
			const cap = chartRange * 2;
			if (high - low > cap) {
				low = Math.max(low, zone.core - cap / 2);
				high = Math.min(high, zone.core + cap / 2);
				cells = [1];
			}
			const kind = close > high ? 'support' : close < low ? 'resistance' : 'inside';
			return { ...zone, low, high, cells, kind, fullLow: zone.low, fullHigh: zone.high };
		};
		const zones = found.zones.map(zone => narrow({ ...zone, from: indexAt(zone.from), last: indexAt(zone.last) }));

		const level = value => s.c.map((unused, i) => (i >= from ? value : null));
		return {
			poc: level(low + step * (pocRow + 0.5)),
			vah: level(low + step * (top + 1)),
			val: level(low + step * bottom),
			$draw: { from, low, step, up, down, peak: totals[pocRow], pocRow, bottom, top, zones, hasVolume, skipWeekend: found.skipWeekend, skipped: found.skipped,
				basis: useBasis ? ZONE_BASIS_NAMES[basis.interval] ?? basis.interval : null, loading: basis?.loading === true },
		};
	}

	/** view = { width, height, priceY(가격), barX(봉 번호), formatPrice, font, text, up, down } */
	function drawVolumeZones(context, view, data, p) {
		const right = view.width;
		const widest = right * Math.min(60, Math.max(3, p.size)) / 100;
		context.save();
		context.font = `11px ${ view.font }`;
		context.textBaseline = 'middle';
		for (const zone of data.zones) {
			const top = view.priceY(zone.high);
			const bottom = view.priceY(zone.low);
			if (top === null || bottom === null) continue;
			const color = zone.kind === 'support' ? view.up : zone.kind === 'resistance' ? view.down : '#f5a623';
			const left = Math.max(0, view.barX(zone.from) ?? 0);
			// 신뢰도가 높을수록 진하게, 구간 안에서는 거래가 몰린 가격일수록 진하게 칠한다.
			const strength = 0.05 + 0.32 * zone.reliability;
			zone.cells.forEach((cell, i) => {
				const cellTop = view.priceY(zone.low + (zone.high - zone.low) * (i + 1) / zone.cells.length);
				const cellBottom = view.priceY(zone.low + (zone.high - zone.low) * i / zone.cells.length);
				if (cellTop === null || cellBottom === null) return;
				context.fillStyle = tint(color, strength * (0.35 + 0.65 * cell));
				context.fillRect(left, cellTop, right - left, Math.max(1, cellBottom - cellTop));
			});
			context.strokeStyle = tint(color, 0.25 + 0.6 * zone.reliability);
			context.lineWidth = 1;
			context.setLineDash([4, 3]);
			context.beginPath();
			context.moveTo(left, top);
			context.lineTo(right, top);
			context.moveTo(left, bottom);
			context.lineTo(right, bottom);
			context.stroke();
			context.setLineDash([]);
			// 구간 안에서 거래가 가장 많이 몰린 가격.
			const core = view.priceY(zone.core);
			if (core !== null) {
				context.strokeStyle = tint(color, 0.45 + 0.55 * zone.reliability);
				context.lineWidth = 1.5;
				context.beginPath();
				context.moveTo(left, core);
				context.lineTo(right, core);
				context.stroke();
			}
			const name = `${ zone.kind === 'support' ? '지지' : zone.kind === 'resistance' ? '저항' : '현재가 구간' }${ data.basis ? ` (${ data.basis })` : '' }`;
			context.fillStyle = tint(color, 0.6 + 0.4 * zone.reliability);
			context.textAlign = 'right';
			context.fillText(`${ name } ${ view.formatPrice(zone.low) } ~ ${ view.formatPrice(zone.high) } · 신뢰도 ${ Math.round(zone.reliability * 100) }% · ${ zone.touches }회 · 거래 ${ (zone.share * 100).toFixed(0) }% · 핵심 ${ view.formatPrice(zone.core) }`,
				right - widest - 10, top - 8);
			context.textAlign = 'left';
		}
		for (let row = 0; row < data.up.length; row++) {
			const amount = data.up[row] + data.down[row];
			if (amount <= 0) continue;
			const top = view.priceY(data.low + data.step * (row + 1));
			const bottom = view.priceY(data.low + data.step * row);
			if (top === null || bottom === null) continue;
			const height = Math.max(1, bottom - top - 1);
			const width = amount / data.peak * widest;
			const upWidth = width * data.up[row] / amount;
			// 밸류 에어리어 안쪽은 진하게, 바깥은 옅게.
			const alpha = row >= data.bottom && row <= data.top ? 0.55 : 0.25;
			context.fillStyle = tint(view.up, alpha);
			context.fillRect(right - upWidth, top + 0.5, upWidth, height);
			context.fillStyle = tint(view.down, alpha);
			context.fillRect(right - width, top + 0.5, width - upWidth, height);
			if (row === data.pocRow) {
				context.strokeStyle = '#f5a623';
				context.lineWidth = 1;
				context.strokeRect(right - width + 0.5, top + 0.5, width - 1, height);
			}
		}
		context.restore();
	}

	// 개인 지표: 이 프로그램에서 직접 만든 지표.
	customDefs.unshift(custom('vpsr', '매물대·지지저항', 'Volume Profile & Support/Resistance Zones', '매물대와 지지·저항 구간', 'volume profile 매물대 지지 저항 poc vah val 밸류 에어리어 구간 신뢰도', 'ChartDesk', true, 'price',
		[
			num('bars', '분석할 최근 봉 수 (0 = 전부)', 800, 0, 50),
			num('rows', '매물대 칸 수', 40, 10, 1),
			num('area', '밸류 에어리어 %', 70, 10, 1),
			num('size', '매물대 폭 (차트의 %)', 10, 3, 1),
			num('pivot', '전환점 좌우 봉 수', 5, 2, 1),
			num('zones', '지지·저항 구간 수 (위·아래 절반씩)', 6, 1, 1),
			num('minrel', '지지·저항 최소 신뢰도 % (낮추면 약한 구간도 보임)', 50, 0, 5),
			num('basis', '지지·저항 기준 주기 (0 자동 · 1 차트 주기 · 2 1시간 · 3 4시간 · 4 일봉)', 0, 0, 1),
			num('weekend', '주말 전환점 제외 (0 주식 토큰만 · 1 항상 · 2 안 함)', 0, 0, 1),
		],
		[line('poc', 'POC', '#f5a623', { width: 2 }), line('vah', 'VAH', '#a855f7'), line('val', 'VAL', '#a855f7')],
		volumeZones, { draw: drawVolumeZones, axisLabel: true, group: 'personal', basis: zoneBasis }));

	// ---------- ICT (시장 구조, 오더블록, FVG, 유동성, 프리미엄·디스카운트) ----------
	// ICT에서 쓰는 개념을 봉 데이터만으로 기계적으로 찾는다. 재량 판단을 대신하지는 못한다.

	function ictStructure(s, p) {
		const from = p.bars > 0 ? Math.max(0, s.n - p.bars) : 0;
		const out = { eq: blank(s.n), high: blank(s.n), low: blank(s.n) };
		const span = Math.max(2, Math.round(p.swing));
		const wide = span * 4;
		if (s.n - from < wide * 2 + 5) return out;
		const ranges = atr(s, 14);
		const usual = sma(s.v, 20);
		const isPivot = (index, width, side) => {
			if (index - width < from || index + width >= s.n) return false;
			for (let j = index - width; j <= index + width; j++) {
				if (side > 0 ? s.h[j] > s.h[index] : s.l[j] < s.l[index]) return false;
			}
			return true;
		};
		const breaks = [];
		const blocks = [];
		const gaps = [];
		const pools = [];
		const sweeps = [];
		const major = { high: null, low: null };
		let trend = 0;
		let lastHigh = null;
		let lastLow = null;

		// 스윙 고점 위에는 매수 스톱이, 저점 아래에는 매도 스톱이 쌓인다고 본다. 비슷한 높이의 고점(저점)은 하나로 묶는다.
		const addPool = (dir, price, index) => {
			const tolerance = (ranges[index] ?? 0) * 0.1;
			const same = pools.find(pool => !pool.done && pool.dir === dir && Math.abs(pool.price - price) <= tolerance);
			if (same) {
				same.count++;
				same.price = dir > 0 ? Math.max(same.price, price) : Math.min(same.price, price);
			}
			else pools.push({ dir, price, index, count: 1 });
		};
		// 구조를 깬 움직임이 시작된 봉. 상승 돌파면 그 구간에서 저가가 가장 낮은 봉, 하락 돌파면 고가가 가장 높은 봉.
		const addBlock = (dir, start, end) => {
			let origin = start;
			for (let j = start; j < end; j++) {
				if (dir > 0 ? s.l[j] < s.l[origin] : s.h[j] > s.h[origin]) origin = j;
			}
			blocks.push({ dir, top: s.h[origin], bottom: s.l[origin], index: origin, to: end, strength: usual[origin] > 0 ? s.v[origin] / usual[origin] : 1 });
		};

		for (let i = from; i < s.n; i++) {
			// 이미 찾은 구간이 이번 봉에서 소화됐는지 본다.
			for (const block of blocks) {
				if (!block.done && i > block.to && (block.dir > 0 ? s.l[i] < block.bottom : s.h[i] > block.top)) block.done = i;
			}
			for (const gap of gaps) {
				if (gap.done || i <= gap.index + 1) continue;
				if (gap.dir > 0) {
					if (s.l[i] <= gap.bottom) gap.done = i;
					else gap.top = Math.min(gap.top, s.l[i]);
				}
				else if (s.h[i] >= gap.top) gap.done = i;
				else gap.bottom = Math.max(gap.bottom, s.h[i]);
			}
			for (const pool of pools) {
				if (pool.done || !(pool.dir > 0 ? s.h[i] > pool.price : s.l[i] < pool.price)) continue;
				pool.done = i;
				// 넘겼다가 종가가 다시 안쪽으로 돌아오면 유동성만 걷어 간 것으로 본다.
				if (pool.dir > 0 ? s.c[i] < pool.price : s.c[i] > pool.price) sweeps.push({ index: i, price: pool.price, dir: pool.dir });
			}

			// 전환점은 좌우 봉이 다 지난 뒤에야 확정된다.
			const confirmed = i - span;
			if (isPivot(confirmed, span, 1)) {
				lastHigh = { price: s.h[confirmed], index: confirmed, broken: false };
				addPool(1, s.h[confirmed], confirmed);
			}
			if (isPivot(confirmed, span, -1)) {
				lastLow = { price: s.l[confirmed], index: confirmed, broken: false };
				addPool(-1, s.l[confirmed], confirmed);
			}
			if (isPivot(i - wide, wide, 1)) major.high = i - wide;
			if (isPivot(i - wide, wide, -1)) major.low = i - wide;

			// FVG: 세 봉 중 가운데 봉이 급하게 움직여 첫 봉과 셋째 봉 사이에 거래되지 않은 틈이 남은 곳.
			if (i - 2 >= from && ranges[i] !== null) {
				const smallest = ranges[i] * 0.15;
				if (s.l[i] - s.h[i - 2] > smallest && s.c[i - 1] > s.o[i - 1]) gaps.push({ dir: 1, top: s.l[i], bottom: s.h[i - 2], index: i - 1 });
				else if (s.l[i - 2] - s.h[i] > smallest && s.c[i - 1] < s.o[i - 1]) gaps.push({ dir: -1, top: s.l[i - 2], bottom: s.h[i], index: i - 1 });
			}

			// 종가가 직전 스윙을 넘으면 구조 돌파. 추세와 같은 방향이면 BOS, 반대 방향이면 CHoCH.
			if (lastHigh && !lastHigh.broken && s.c[i] > lastHigh.price) {
				lastHigh.broken = true;
				breaks.push({ kind: trend < 0 ? 'CHoCH' : 'BOS', dir: 1, from: lastHigh.index, to: i, price: lastHigh.price });
				trend = 1;
				addBlock(1, lastHigh.index, i);
			}
			if (lastLow && !lastLow.broken && s.c[i] < lastLow.price) {
				lastLow.broken = true;
				breaks.push({ kind: trend > 0 ? 'CHoCH' : 'BOS', dir: -1, from: lastLow.index, to: i, price: lastLow.price });
				trend = -1;
				addBlock(-1, lastLow.index, i);
			}
		}

		// 딜링 레인지: 가장 최근의 큰 스윙 고점·저점 중 먼저 나온 것부터 지금까지의 고가와 저가.
		const start = Math.min(major.high ?? from, major.low ?? from);
		let top = -Infinity;
		let bottom = Infinity;
		for (let i = start; i < s.n; i++) {
			top = Math.max(top, s.h[i]);
			bottom = Math.min(bottom, s.l[i]);
		}
		const latest = (items, dir, count) => (Math.round(count) > 0 ? items.filter(item => !item.done && item.dir === dir).slice(-Math.round(count)) : []);
		const level = value => s.c.map((unused, i) => (i >= start ? value : null));
		const close = s.c[s.n - 1];
		return {
			eq: level((top + bottom) / 2),
			high: level(top),
			low: level(bottom),
			$draw: {
				start,
				top,
				bottom,
				trend,
				place: close > (top + bottom) / 2 ? 'premium' : 'discount',
				breaks: breaks.slice(-Math.max(1, Math.round(p.breaks))),
				blocks: [...latest(blocks, 1, p.blocks), ...latest(blocks, -1, p.blocks)],
				gaps: [...latest(gaps, 1, p.gaps), ...latest(gaps, -1, p.gaps)],
				pools: [...latest(pools, 1, p.pools), ...latest(pools, -1, p.pools)],
				sweeps: sweeps.slice(-4),
				counts: { blocks: blocks.length, gaps: gaps.length, breaks: breaks.length, sweeps: sweeps.length },
			},
		};
	}

	function drawIct(context, view, data) {
		const right = view.width;
		const x = index => Math.max(0, view.barX(index) ?? 0);
		const label = (text, at, y, color, align = 'right') => {
			context.fillStyle = color;
			context.textAlign = align;
			context.fillText(text, at, y);
		};
		context.save();
		context.font = `10px ${ view.font }`;
		context.textBaseline = 'middle';

		// 프리미엄(평형 위)과 디스카운트(평형 아래).
		const [top, middle, bottom] = [view.priceY(data.top), view.priceY((data.top + data.bottom) / 2), view.priceY(data.bottom)];
		if (top !== null && middle !== null && bottom !== null) {
			const left = x(data.start);
			context.fillStyle = tint(view.down, 0.045);
			context.fillRect(left, top, right - left, middle - top);
			context.fillStyle = tint(view.up, 0.045);
			context.fillRect(left, middle, right - left, bottom - middle);
			label('프리미엄 (비싼 구간)', left + 6, top + 10, tint(view.down, 0.8), 'left');
			label('디스카운트 (싼 구간)', left + 6, bottom - 10, tint(view.up, 0.8), 'left');
		}

		// FVG: 점선 테두리의 옅은 상자.
		for (const gap of data.gaps) {
			const [high, low] = [view.priceY(gap.top), view.priceY(gap.bottom)];
			if (high === null || low === null) continue;
			const color = gap.dir > 0 ? view.up : view.down;
			const left = x(gap.index);
			context.fillStyle = tint(color, 0.1);
			context.fillRect(left, high, right - left, Math.max(1, low - high));
			context.strokeStyle = tint(color, 0.55);
			context.lineWidth = 1;
			context.setLineDash([2, 3]);
			context.strokeRect(left + 0.5, high + 0.5, right - left - 1, Math.max(1, low - high));
			context.setLineDash([]);
			label(`${ gap.dir > 0 ? '상승' : '하락' } FVG ${ view.formatPrice(gap.bottom) } ~ ${ view.formatPrice(gap.top) }`, right - 6, (high + low) / 2, tint(color, 0.9));
		}

		// 오더블록: 실선 테두리의 상자. 그 봉에 거래가 많이 실렸을수록 진하게.
		for (const block of data.blocks) {
			const [high, low] = [view.priceY(block.top), view.priceY(block.bottom)];
			if (high === null || low === null) continue;
			const color = block.dir > 0 ? view.up : view.down;
			const left = x(block.index);
			const weight = clamp((block.strength - 0.5) / 2.5);
			context.fillStyle = tint(color, 0.12 + 0.28 * weight);
			context.fillRect(left, high, right - left, Math.max(2, low - high));
			context.strokeStyle = tint(color, 0.6 + 0.4 * weight);
			context.lineWidth = 1;
			context.strokeRect(left + 0.5, high + 0.5, right - left - 1, Math.max(2, low - high));
			label(`${ block.dir > 0 ? '매수' : '매도' } 오더블록 ${ view.formatPrice(block.bottom) } ~ ${ view.formatPrice(block.top) } · 거래량 ${ block.strength.toFixed(1) }배`,
				left + 6, high - 7, color, 'left');
		}

		// 유동성: 아직 건드리지 않은 스윙 고점·저점.
		for (const pool of data.pools) {
			const y = view.priceY(pool.price);
			if (y === null) continue;
			const left = x(pool.index);
			context.strokeStyle = '#38bdf8';
			context.lineWidth = pool.count > 1 ? 1.5 : 1;
			context.setLineDash([1, 4]);
			context.beginPath();
			context.moveTo(left, y);
			context.lineTo(right, y);
			context.stroke();
			context.setLineDash([]);
			const name = pool.dir > 0 ? '매수측 유동성' : '매도측 유동성';
			label(`${ name }${ pool.count > 1 ? ` · 같은 ${ pool.dir > 0 ? '고점' : '저점' } ${ pool.count }개` : '' } ${ view.formatPrice(pool.price) }`, right - 6, y + (pool.dir > 0 ? -7 : 7), '#38bdf8');
		}

		// 구조 돌파: 깨진 스윙에서 돌파 봉까지의 선.
		for (const item of data.breaks) {
			const y = view.priceY(item.price);
			if (y === null) continue;
			const color = item.dir > 0 ? view.up : view.down;
			const [left, end] = [x(item.from), x(item.to)];
			context.strokeStyle = color;
			context.lineWidth = 1;
			context.setLineDash(item.kind === 'CHoCH' ? [5, 3] : []);
			context.beginPath();
			context.moveTo(left, y);
			context.lineTo(end, y);
			context.stroke();
			context.setLineDash([]);
			label(item.kind, (left + end) / 2, y + (item.dir > 0 ? -7 : 7), color, 'center');
		}

		// 유동성 스윕.
		for (const sweep of data.sweeps) {
			const y = view.priceY(sweep.price);
			if (y === null) continue;
			label('스윕', x(sweep.index), y + (sweep.dir > 0 ? -9 : 9), '#38bdf8', 'center');
		}
		context.restore();
	}

	customDefs.splice(1, 0, custom('ict', 'ICT', 'ICT Structure, Order Blocks, FVG & Liquidity', 'ICT 시장 구조·오더블록·FVG·유동성', 'ict smc 오더블록 order block fvg fair value gap 유동성 bos choch 프리미엄 디스카운트 스마트머니', 'ChartDesk', true, 'price',
		[
			num('bars', '분석할 최근 봉 수 (0 = 전부)', 800, 0, 50),
			num('swing', '스윙 좌우 봉 수', 5, 2, 1),
			num('blocks', '오더블록 수 (방향별)', 3, 0, 1),
			num('gaps', 'FVG 수 (방향별)', 3, 0, 1),
			num('pools', '유동성 선 수 (방향별)', 3, 0, 1),
			num('breaks', '구조 돌파 표시 수', 6, 1, 1),
		],
		[line('eq', '평형 50%', '#9ca3af'), line('high', '레인지 상단', '#6b7280'), line('low', '레인지 하단', '#6b7280')],
		ictStructure, { draw: drawIct, group: 'personal' }));

	// ---------- 워뇨띠 환경 점검 ----------
	// 워뇨띠가 공개한 비트멕스 체결 기록(2018.3~2021.12, 144만 행)에서 포지션 3,184개를 복원하고,
	// 2019년 이후 비트코인·이더리움 포지션 914개의 진입 시점을 시간봉에 대조해 얻은 통계를 옮긴 것이다.
	// 진입 신호가 아니다. 지금 자리가 그의 수익이 몰렸던 환경인지, 손실이 몰렸던 환경인지를 보여 준다.

	// 그의 포지션이 좋은 성과를 냈던 세 가지 자리. 수치는 2019년 이후 비트코인·이더리움 포지션 통계이고,
	// 목표 거리는 그 자리에서 이긴 포지션들이 실제로 잡은 가격 이동(시간봉 ATR 배수)의 중앙값·상위 25%·상위 10%다.
	const WONYO_PLANS = {
		dip: { name: '눌림 롱', dir: 1, ladder: [0, 0.35, 0.7], targets: [0.6, 1.6, 2.3], stat: '평균 아래 ATR 1.5~3배에서의 롱 76개: 승률 79%, 손익비 4.6', size: '잔고의 0.6배(상위 25%도 1배)' },
		roll: { name: '꺾인 숏', dir: -1, ladder: [0, 0.3, 0.56], targets: [0.6, 1.2, 3.0], stat: '24시간 범위 아래쪽 40%에서의 숏 126개: 승률 79%, 손익비 6.0', size: '잔고의 0.9배(상위 25%도 1.3배)' },
		trend: { name: '추세 롱', dir: 1, ladder: [0, 0.45, 0.89], targets: [0.6, 1.3, 2.4], stat: '평균 위에서의 롱 149개: 승률 73%, 손익비 4.3', size: '잔고의 0.8배(상위 25%도 1.2배)' },
	};

	function wonyoRegime(s, p) {
		const day = 86400;
		const hour = 3600;
		const move = blank(s.n);
		const three = blank(s.n);
		const stretch = blank(s.n);
		const upper = blank(s.n);
		const lower = blank(s.n);
		const top = blank(s.n);
		const bottom = blank(s.n);
		const highs = [];
		const lows = [];
		const dayHighs = [];
		const dayLows = [];
		const marks = [];
		const spans = [];
		let week = 0;
		let third = 0;
		let yesterday = 0;
		let hot = null;
		// 봉을 아직 받지 못했으면 그릴 것이 없다.
		if (s.n === 0) return { move, three, $colors: { three: [] }, $draw: { spans: [], marks: [], lines: [], tones: [], upper, lower, top, bottom, events: [], plan: null } };
		let was = { chaseShort: false, chaseLong: false, crash: false };
		let plan = null;
		let before = { stretch: null, place: null };
		const events = [];

		// 봉 주기와 상관없이 같은 기준을 쓰도록 시간봉으로 묶어 20시간 평균과 시간봉 ATR을 구한다.
		const step = s.n > 1 ? s.t[s.n - 1] - s.t[s.n - 2] : 0;
		const hourly = step > 0 && step <= hour;
		const hours = [];
		let mean = null;
		let range = null;

		for (let i = 0; i < s.n; i++) {
			while (highs.length && s.h[highs[highs.length - 1]] <= s.h[i]) highs.pop();
			highs.push(i);
			while (lows.length && s.l[lows[lows.length - 1]] >= s.l[i]) lows.pop();
			lows.push(i);
			while (s.t[week] < s.t[i] - 7 * day) week++;
			while (highs[0] < week) highs.shift();
			while (lows[0] < week) lows.shift();
			while (s.t[third] < s.t[i] - 3 * day) third++;
			while (s.t[yesterday] < s.t[i] - day) yesterday++;
			// 직전 24시간의 고가와 저가 (지금 봉은 빼고).
			while (dayHighs.length && dayHighs[0] < yesterday) dayHighs.shift();
			while (dayLows.length && dayLows[0] < yesterday) dayLows.shift();
			const covered = s.t[i] - s.t[0];
			if (covered >= day && dayHighs.length && step <= day / 2) {
				top[i] = s.h[dayHighs[0]];
				bottom[i] = s.l[dayLows[0]];
			}
			while (dayHighs.length && s.h[dayHighs[dayHighs.length - 1]] <= s.h[i]) dayHighs.pop();
			dayHighs.push(i);
			while (dayLows.length && s.l[dayLows[dayLows.length - 1]] >= s.l[i]) dayLows.pop();
			dayLows.push(i);

			if (covered >= 6.5 * day && s.l[lows[0]] > 0) move[i] = (s.h[highs[0]] - s.l[lows[0]]) / s.l[lows[0]] * 100;
			if (covered >= 3 * day) three[i] = (s.c[i] / s.c[third] - 1) * 100;
			const drop = covered >= day ? (s.c[i] / s.c[yesterday] - 1) * 100 : null;

			if (hourly) {
				const stamp = Math.floor(s.t[i] / hour);
				const current = hours[hours.length - 1];
				if (current && current.stamp === stamp) {
					current.high = Math.max(current.high, s.h[i]);
					current.low = Math.min(current.low, s.l[i]);
					current.close = s.c[i];
				}
				else {
					// 시간이 넘어가면 방금 끝난 시간봉까지로 평균과 ATR을 다시 잡는다.
					if (hours.length >= 21) {
						mean = 0;
						range = 0;
						for (let j = hours.length - 20; j < hours.length; j++) mean += hours[j].close / 20;
						for (let j = hours.length - 14; j < hours.length; j++) {
							const before = hours[j - 1].close;
							range += Math.max(hours[j].high - hours[j].low, Math.abs(hours[j].high - before), Math.abs(hours[j].low - before)) / 14;
						}
					}
					hours.push({ stamp, high: s.h[i], low: s.l[i], close: s.c[i] });
				}
				if (mean !== null && range > 0) {
					stretch[i] = (s.c[i] - mean) / range;
					upper[i] = mean + p.stretch * range;
					lower[i] = mean - p.stretch * range;
				}
			}

			// 진행 중인 계획이 끝났는지 본다: 무효화 가격에 닿았거나, 마지막 목표에 닿았거나, 하루가 지났거나.
			if (plan && i > plan.index) {
				const hitStop = plan.dir > 0 ? s.l[i] <= plan.stop : s.h[i] >= plan.stop;
				const reached = plan.targets.filter(price => (plan.dir > 0 ? s.h[i] >= price : s.l[i] <= price)).length;
				plan.reached = Math.max(plan.reached, reached);
				if (hitStop) plan = null;
				else if (plan.reached === plan.targets.length || s.t[i] - plan.time > day) plan = null;
			}
			// 새로 그 자리에 들어선 봉에서 계획을 세운다. 평균과 ATR은 그 봉의 값으로 고정한다.
			const place = top[i] !== null && top[i] > bottom[i] ? (s.c[i] - bottom[i]) / (top[i] - bottom[i]) : null;
			if (stretch[i] !== null && before.stretch !== null) {
				let kind = null;
				if (before.stretch > -1.5 && stretch[i] <= -1.5 && stretch[i] > -p.stretch) kind = 'dip';
				else if (place !== null && before.place !== null && before.place > 0.4 && place <= 0.4 && stretch[i] < -0.5 && stretch[i] > -p.stretch) kind = 'roll';
				else if (place !== null && before.place !== null && before.place < 0.6 && place >= 0.6 && stretch[i] >= 0.5 && stretch[i] < p.stretch) kind = 'trend';
				if (kind) {
					const rule = WONYO_PLANS[kind];
					const entry = s.c[i];
					// 눌림 롱은 과열 경계(평균 - ATR 3배)를 넘어가면 접고, 나머지 둘은 20시간 평균을 되넘으면 접는다.
					const stop = kind === 'dip' ? mean - p.stretch * range : mean;
					const entries = rule.ladder.map(offset => entry - rule.dir * offset * range).filter(price => (rule.dir > 0 ? price > stop : price < stop));
					plan = { kind, dir: rule.dir, index: i, time: s.t[i], entries, targets: rule.targets.map(distance => entry + rule.dir * distance * range), stop, reached: 0, hot: move[i] !== null && move[i] >= p.vol };
					events.push({ index: i, kind, price: rule.dir > 0 ? s.l[i] : s.h[i] });
				}
			}
			before = { stretch: stretch[i], place };

			const isHot = move[i] !== null && move[i] >= p.vol;
			if (isHot && hot === null) hot = i;
			if (!isHot && hot !== null) {
				spans.push([hot, i - 1]);
				hot = null;
			}
			const now = {
				chaseShort: stretch[i] !== null && stretch[i] >= p.stretch,
				chaseLong: stretch[i] !== null && stretch[i] <= -p.stretch,
				crash: drop !== null && drop <= -p.crash,
			};
			if (now.chaseShort && !was.chaseShort) marks.push({ index: i, kind: 'chaseShort', price: s.h[i] });
			if (now.chaseLong && !was.chaseLong) marks.push({ index: i, kind: 'chaseLong', price: s.l[i] });
			if (now.crash && !was.crash) marks.push({ index: i, kind: 'crash', price: s.l[i] });
			was = now;
		}
		if (hot !== null) spans.push([hot, s.n - 1]);

		// 왼쪽 아래 글 상자: 지금 장 상태와, 롱·숏을 볼 가격대와 피할 가격대. tones는 줄마다의 색(up, down, warn, 없으면 기본).
		const last = s.n - 1;
		const close = s.c[last];
		const digits = close >= 1000 ? 1 : close >= 10 ? 2 : close >= 1 ? 4 : 6;
		const price = value => value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
		const lines = [];
		const tones = [];
		const say = (text, tone = null) => {
			lines.push(text);
			tones.push(tone);
		};
		if (move[last] === null) say('7일치 봉이 부족합니다. 주기를 올리거나 과거 봉을 더 불러오면 계산됩니다.');
		else {
			const value = move[last].toFixed(1);
			if (move[last] >= p.vol) say(`장 상태: 매매할 장 (7일 변동폭 ${ value }%) · 수익의 84%가 이런 장에서 나왔습니다.`, 'up');
			else if (move[last] >= p.quiet) say(`장 상태: 애매한 장 (7일 변동폭 ${ value }%) · 이런 장에서는 거의 본전이었습니다. 크기를 줄이세요.`, 'warn');
			else say(`장 상태: 쉬는 장 (7일 변동폭 ${ value }%) · 이런 장에서는 거의 매매하지 않았습니다.`, 'warn');
		}
		// 지금 자리에서 하지 말 것.
		if (stretch[last] !== null && stretch[last] >= p.stretch) say(`지금 숏 금지 · 급등 중(평균보다 ATR ${ stretch[last].toFixed(1) }배 위). 급등을 받아치는 숏이 가장 큰 손실원이었습니다.`, 'down');
		else if (stretch[last] !== null && stretch[last] <= -p.stretch) say(`지금 롱 금지 · 급락 중(평균보다 ATR ${ Math.abs(stretch[last]).toFixed(1) }배 아래). 떨어지는 칼날을 받는 롱은 손실 구간이었습니다.`, 'down');
		else if (top[last] !== null && close > top[last]) say('지금 숏 금지 · 24시간 고점을 넘은 자리입니다. 여기서 잡은 숏은 합계 손실이었습니다.', 'down');
		else if (top[last] !== null && close < bottom[last]) say('지금 롱 금지 · 24시간 저점을 깬 자리입니다. 여기서 잡은 롱은 합계 손실이었습니다.', 'down');
		if (three[last] !== null && Math.abs(three[last]) <= 2) say(`숏 자제 · 3일 등락 ${ three[last] >= 0 ? '+' : '' }${ three[last].toFixed(1) }%로 방향이 없습니다.`, 'warn');
		// 볼 만한 가격대: 성과가 좋았던 세 자리를 지금 가격으로 옮긴다.
		if (mean !== null && range > 0 && stretch[last] !== null) {
			const dipHigh = mean - 1.5 * range;
			const dipLow = mean - p.stretch * range;
			const inDip = close <= dipHigh && close > dipLow;
			say(`롱 타점(눌림): ${ price(dipLow) } ~ ${ price(dipHigh) }${ inDip ? ' · 지금 이 구간' : '' } · 승률 79%, 손익비 4.6`, inDip ? 'up' : null);
			if (top[last] !== null && top[last] > bottom[last]) {
				const width = top[last] - bottom[last];
				const rollLine = bottom[last] + 0.4 * width;
				const trendLine = bottom[last] + 0.6 * width;
				const inRoll = close <= rollLine && close >= bottom[last] && stretch[last] < -0.5;
				const inTrend = close >= trendLine && close <= top[last] && stretch[last] >= 0.5;
				say(`숏 타점(꺾임): ${ price(bottom[last]) } ~ ${ price(rollLine) }, 평균(${ price(mean) }) 아래일 때${ inRoll ? ' · 지금 이 구간' : '' } · 승률 79%, 손익비 6.0`, inRoll ? 'down' : null);
				say(`롱 타점(추세): ${ price(trendLine) } ~ ${ price(top[last]) }, 평균(${ price(mean) }) 위일 때${ inTrend ? ' · 지금 이 구간' : '' } · 승률 73%, 손익비 4.3`, inTrend ? 'up' : null);
			}
			say(`금지선: ${ price(upper[last]) } 위에서 숏 ✕ · ${ price(lower[last]) } 아래에서 롱 ✕`);
		}
		else if (!hourly) say('타점 가격대는 1시간 이하 주기에서 계산됩니다.');
		if (plan && p.plan >= 1) {
			const rule = WONYO_PLANS[plan.kind];
			const done = plan.reached ? ` (목표 ${ plan.reached }까지 도달)` : '';
			say(`진행 중: ${ rule.name } · 진입 ${ plan.entries.map(price).join(' / ') } · 목표 ${ plan.targets.map(price).join(' / ') }${ done } · 무효화 ${ price(plan.stop) } · 크기 ${ rule.size }`, rule.dir > 0 ? 'up' : 'down');
		}
		say('지킬 것: 이길 때만 추가(물타기 ✕) · 잔고 4배 이하 · 통계일 뿐, 기계적으로 따라 하면 본전 수준이었습니다.', 'muted');
		return {
			move,
			three,
			$colors: { three: signed(three) },
			// 조건 알림·백테스트·스크리너가 쓰는 타점 신호 전체(봉 번호와 종류).
			$signals: events.map(({ index, kind }) => ({ index, kind })),
			$draw: { spans: spans.slice(-40), marks: marks.slice(-60), lines, tones, upper, lower, top, bottom, events: p.plan >= 1 ? events.slice(-80) : [], plan: p.plan >= 1 && plan ? { ...plan, name: WONYO_PLANS[plan.kind].name } : null },
		};
	}

	function drawWonyo(context, view, data) {
		context.save();
		context.font = `11px ${ view.font }`;
		context.textBaseline = 'middle';
		const x = index => view.barX(index);
		// 고변동 구간은 바탕을 옅게 칠한다.
		for (const [from, to] of data.spans) {
			const [left, right] = [x(from), x(to)];
			if (left === null || right === null || right < 0 || left > view.width) continue;
			context.fillStyle = 'rgba(245, 166, 35, 0.07)';
			context.fillRect(Math.max(0, left), 0, Math.min(view.width, right) - Math.max(0, left) + 1, view.height);
		}
		// 과열 경계: 20시간 평균에서 ATR 배수만큼 떨어진 선. 이 밖에서 반대로 받아친 매매가 손실이었다.
		const trace = (values, color, dash) => {
			context.strokeStyle = color;
			context.lineWidth = 1;
			context.setLineDash(dash);
			context.beginPath();
			let drawing = false;
			let end = null;
			for (let i = 0; i < values.length; i++) {
				const at = x(i);
				const y = values[i] === null ? null : view.priceY(values[i]);
				if (at === null || y === null || at < -20 || at > view.width + 20) {
					drawing = false;
					continue;
				}
				if (drawing) context.lineTo(at, y);
				else context.moveTo(at, y);
				drawing = true;
				end = { at, y };
			}
			context.stroke();
			context.setLineDash([]);
			return end;
		};
		const labelAt = (end, text, color, offset) => {
			if (!end) return;
			context.fillStyle = color;
			context.textAlign = 'right';
			context.fillText(text, Math.min(view.width - 6, end.at - 6), end.y + offset);
		};
		labelAt(trace(data.upper, view.down, [5, 4]), '이 위에서의 숏: 합계 손실', view.down, -8);
		labelAt(trace(data.lower, view.up, [5, 4]), '이 아래에서의 롱: 합계 손실', view.up, 8);
		trace(data.top, 'rgba(160, 160, 160, 0.6)', [1, 4]);
		trace(data.bottom, 'rgba(160, 160, 160, 0.6)', [1, 4]);

		context.textAlign = 'center';
		for (const mark of data.marks) {
			const [at, y] = [x(mark.index), view.priceY(mark.price)];
			if (at === null || y === null || at < 0 || at > view.width) continue;
			if (mark.kind === 'chaseShort') {
				context.fillStyle = view.down;
				context.fillText('✕ 추격 숏 주의', at, y - 12);
			}
			else {
				context.fillStyle = mark.kind === 'crash' ? '#f5a623' : view.up;
				context.fillText(mark.kind === 'crash' ? '▲ 하루 급락' : '✕ 추격 롱 주의', at, y + 12);
			}
		}
		// 그 자리에 들어선 봉.
		for (const event of data.events) {
			const [at, y] = [x(event.index), view.priceY(event.price)];
			if (at === null || y === null || at < 0 || at > view.width) continue;
			const long = event.kind !== 'roll';
			context.fillStyle = long ? view.up : view.down;
			context.fillText(event.kind === 'dip' ? '▲눌림' : event.kind === 'trend' ? '▲추세' : '▼꺾임', at, y + (long ? 12 : -12));
		}
		// 진행 중인 계획: 진입 사다리(실선), 목표(파선), 무효화(점선).
		if (data.plan) {
			const plan = data.plan;
			const left = Math.max(0, x(plan.index) ?? 0);
			const color = plan.dir > 0 ? view.up : view.down;
			const against = plan.dir > 0 ? view.down : view.up;
			const level = (price, stroke, dash, text, width = 1) => {
				const y = view.priceY(price);
				if (y === null) return;
				context.strokeStyle = stroke;
				context.lineWidth = width;
				context.setLineDash(dash);
				context.beginPath();
				context.moveTo(left, y);
				context.lineTo(view.width, y);
				context.stroke();
				context.setLineDash([]);
				context.textAlign = 'right';
				const label = `${ text } ${ view.formatPrice(price) }`;
				const size = context.measureText(label).width;
				context.fillStyle = 'rgba(0, 0, 0, 0.65)';
				context.fillRect(view.width - size - 12, y - 8, size + 8, 16);
				context.fillStyle = stroke;
				context.fillText(label, view.width - 8, y);
			};
			plan.entries.forEach((price, i) => level(price, view.text, [], `${ plan.name } 진입 ${ i + 1 }`, i === 0 ? 1.5 : 1));
			const notes = ['절반이 여기까지', '상위 25%', '상위 10%'];
			plan.targets.forEach((price, i) => level(price, color, [6, 4], `목표 ${ i + 1 }${ i < plan.reached ? ' ✓' : '' } (${ notes[i] })`));
			level(plan.stop, against, [2, 3], '무효화');
		}
		// 지금 상태 요약.
		if (data.lines.length === 0) {
			context.restore();
			return;
		}
		context.textAlign = 'left';
		// 좁은 화면(휴대폰)에서는 글자를 줄이지 않고 줄을 바꾼다.
		const room = Math.min(view.width - 40, 760);
		const colors = { up: view.up, down: view.down, warn: '#f5a623', muted: 'rgba(200, 200, 200, 0.75)' };
		const rows = [];
		data.lines.forEach((text, i) => {
			const color = colors[data.tones?.[i]] ?? view.text;
			let row = '';
			for (const word of text.split(' ')) {
				const next = row ? `${ row } ${ word }` : word;
				if (row && context.measureText(next).width > room) {
					rows.push({ text: row, color });
					row = `  ${ word }`;
				}
				else row = next;
			}
			rows.push({ text: row, color });
		});
		const width = Math.max(...rows.map(row => context.measureText(row.text).width)) + 16;
		const top = view.height - rows.length * 16 - 14;
		context.fillStyle = 'rgba(0, 0, 0, 0.6)';
		context.fillRect(8, top, width, rows.length * 16 + 8);
		rows.forEach((row, i) => {
			context.fillStyle = row.color;
			context.fillText(row.text, 16, top + 12 + i * 16);
		});
		context.restore();
	}

	customDefs.splice(2, 0, custom('wonyo', 'GOSU 지표', 'GOSU Indicator', 'GOSU 지표', 'gosu 고수 워뇨띠 변동성 역추세 급등 급락 환경 레짐 추격', '공개 거래내역(비트멕스 2018~2021) 직접 분석', false, 'osc',
		[
			num('vol', '고변동 기준 (7일 변동폭 %)', 15, 1, 1),
			num('quiet', '저변동 기준 (7일 변동폭 %)', 7, 1, 1),
			num('stretch', '과열 기준 (20시간 평균에서 ATR 배수)', 3, 0.5, 0.5),
			num('crash', '하루 급락 기준 (%)', 10, 1, 1),
			num('plan', '진입·목표선 표시 (1 켬 · 0 끔)', 1, 0, 1),
		],
		[line('move', '7일 변동폭 %', '#f5a623', { width: 2 }), hist('three', '3일 등락 %')],
		wonyoRegime, { draw: drawWonyo, group: 'personal', levels: [15, 7] }));

	function source(bars) {
		const s = { n: bars.length, t: [], o: [], h: [], l: [], c: [], v: [], hl2: [], hlc3: [] };
		for (const bar of bars) {
			s.t.push(bar.time);
			s.o.push(bar.open);
			s.h.push(bar.high);
			s.l.push(bar.low);
			s.c.push(bar.close);
			s.v.push(bar.volume);
			s.hl2.push((bar.high + bar.low) / 2);
			s.hlc3.push((bar.high + bar.low + bar.close) / 3);
		}
		return s;
	}

	const all = [...defs, ...moreDefs, ...customDefs];
	for (const def of all) def.group ??= 'tech';

	return { defs: all, byId: new Map(all.map(def => [def.id, def])), source };
})();
