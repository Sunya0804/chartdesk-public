// 시세 공급원. 종목은 "공급원:코드" 형식의 id로 가리킨다 (예: BINANCE:BTCUSDT, UPBIT:KRW-BTC, YAHOO:005930.KS).
// 모든 공급원은 같은 모양의 봉 { time(UTC 초), open, high, low, close, volume }을 돌려준다.
window.ChartDeskProviders = (() => {
	'use strict';

	async function json(url) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP ${ response.status }`);
		return response.json();
	}

	/** 브라우저에서 직접 부를 수 없는 공급원은 로컬 서버를 거친다. */
	const proxied = url => json(`/api/proxy?url=${ encodeURIComponent(url) }`);

	async function firstOk(bases, path) {
		let lastError = new Error('요청 실패');
		for (const base of bases) {
			try {
				return await json(base + path);
			}
			catch (error) {
				lastError = error;
				// 잘못된 심볼 같은 요청 오류는 다른 주소에서도 같다.
				if (error.message === 'HTTP 400') break;
			}
		}
		throw lastError;
	}

	/** 끊기면 간격을 늘려 가며 다시 붙는 웹소켓. */
	function openSocket(bases, path, onMessage, onState) {
		let socket = null;
		let closed = false;
		let attempt = 0;
		let timer = 0;

		const connect = () => {
			if (closed) return;
			socket = new WebSocket(bases[attempt % bases.length] + path);
			socket.onopen = () => {
				attempt = 0;
				onState?.(true);
			};
			socket.onmessage = (event) => {
				let data;
				try {
					data = JSON.parse(event.data);
				}
				catch {
					return;
				}
				onMessage(data);
			};
			socket.onerror = () => socket.close();
			socket.onclose = () => {
				onState?.(false);
				if (closed) return;
				attempt++;
				timer = setTimeout(connect, Math.min(15000, 500 * 2 ** attempt));
			};
		};
		connect();

		return {
			send(message) {
				if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
			},
			close() {
				closed = true;
				clearTimeout(timer);
				if (socket) {
					socket.onclose = null;
					socket.close();
				}
			},
		};
	}

	/**
	 * 짧은 봉을 seconds 길이로 묶는다(UTC 기준 경계). 거래소가 그 주기를 주지 않을 때 쓴다.
	 * 맨 앞 묶음은 앞부분 봉이 빠져 있을 수 있어 버린다.
	 */
	function aggregate(bars, seconds) {
		const out = [];
		for (const bar of bars) {
			const time = Math.floor(bar.time / seconds) * seconds;
			const last = out[out.length - 1];
			if (last && last.time === time) {
				last.high = Math.max(last.high, bar.high);
				last.low = Math.min(last.low, bar.low);
				last.close = bar.close;
				last.volume += bar.volume;
			}
			else {
				out.push({ ...bar, time, partial: bar.time !== time });
			}
		}
		if (out[0]?.partial) out.shift();
		return out.map(({ partial, ...bar }) => bar);
	}

	function decimalsOf(text) {
		const dot = text.indexOf('.');
		return dot < 0 ? 0 : text.slice(dot + 1).replace(/0+$/, '').length;
	}

	const entry = (provider, code, fields) => ({
		id: `${ provider.id }:${ code }`,
		provider: provider.id,
		group: provider.group,
		exch: provider.label,
		code,
		name: '',
		...fields,
	});

	// ---------- Binance (현물, USDT 무기한 선물): 웹소켓 실시간 ----------

	function binance({ id, label, type, restBases, klinePath, infoPath, wsBases, suffix, accept }) {
		const provider = {
			id,
			label,
			group: 'Binance',
			realtime: true,
			describe: code => ({ display: code + suffix, type }),

			async klines(code, interval, endMs, limit = 1000) {
				const query = new URLSearchParams({ symbol: code, interval, limit: String(limit) });
				if (endMs !== undefined) query.set('endTime', String(endMs));
				const rows = await firstOk(restBases, `${ klinePath }?${ query }`);
				let precision = 0;
				for (const row of rows.slice(-60)) {
					for (let i = 1; i <= 4; i++) precision = Math.max(precision, decimalsOf(row[i]));
				}
				return {
					precision: Math.min(8, Math.max(2, precision)),
					bars: rows.map(row => ({
						time: Math.floor(row[0] / 1000),
						open: Number(row[1]),
						high: Number(row[2]),
						low: Number(row[3]),
						close: Number(row[4]),
						volume: Number(row[5]),
					})),
				};
			},

			async symbols() {
				const info = await firstOk(restBases, infoPath);
				return info.symbols.filter(accept).map(row => entry(provider, row.symbol, {
					display: row.symbol + suffix,
					base: row.baseAsset,
					quote: row.quoteAsset,
					type,
				}));
			},

			streamBars(code, interval, onBar, onReconnect) {
				let connectedBefore = false;
				return openSocket(wsBases, `/ws/${ code.toLowerCase() }@kline_${ interval }`, (data) => {
					if (data.e !== 'kline') return;
					const k = data.k;
					onBar({
						time: Math.floor(k.t / 1000),
						open: Number(k.o),
						high: Number(k.h),
						low: Number(k.l),
						close: Number(k.c),
						volume: Number(k.v),
					});
				}, (up) => {
					if (!up) return;
					if (connectedBefore) onReconnect();
					connectedBefore = true;
				});
			},

			quoteStream(onQuote, onState) {
				let wanted = new Set();
				let subscribed = new Set();
				let open = false;
				let nextId = 1;
				const stream = code => `${ code.toLowerCase() }@miniTicker`;
				const flush = () => {
					if (!open) return;
					const added = [...wanted].filter(code => !subscribed.has(code));
					const removed = [...subscribed].filter(code => !wanted.has(code));
					if (added.length) socket.send({ method: 'SUBSCRIBE', params: added.map(stream), id: nextId++ });
					if (removed.length) socket.send({ method: 'UNSUBSCRIBE', params: removed.map(stream), id: nextId++ });
					subscribed = new Set(wanted);
				};
				const socket = openSocket(wsBases, '/ws', (data) => {
					if (data.e !== '24hrMiniTicker') return;
					const price = Number(data.c);
					const open24 = Number(data.o);
					onQuote(data.s, {
						price,
						change: open24 ? (price - open24) / open24 * 100 : 0,
						high: Number(data.h),
						low: Number(data.l),
						turnover: Number(data.q),
					});
				}, (up) => {
					open = up;
					onState(up);
					if (up) {
						subscribed = new Set();
						flush();
					}
				});
				return {
					set(codes) {
						wanted = new Set(codes);
						flush();
					},
				};
			},
		};
		return provider;
	}

	// ---------- Upbit, Bithumb: 같은 형식의 공개 API ----------

	const UPBIT_PATHS = {
		'1m': 'minutes/1', '3m': 'minutes/3', '5m': 'minutes/5', '15m': 'minutes/15', '30m': 'minutes/30', '1h': 'minutes/60', '4h': 'minutes/240',
		'1d': 'days', '1w': 'weeks', '1M': 'months',
	};
	// Upbit·Bithumb에 없는 주기는 1시간봉을 묶어 만든다.
	const UPBIT_GROUPED = { '2h': 7200, '6h': 21600, '12h': 43200 };

	// toOffsetHours: to 값을 해석하는 시간대. Upbit은 UTC, Bithumb은 한국 시간으로 읽는다.
	function upbitLike({ id, label, base, toOffsetHours }) {
		const provider = {
			id,
			label,
			group: label,
			pollMs: 3000,
			quoteMs: 4000,
			describe(code) {
				const [quote, coin] = code.split('-');
				return { display: `${ coin }${ quote }`, type: 'crypto' };
			},

			async klines(code, interval, endMs, limit = 200) {
				const seconds = UPBIT_GROUPED[interval];
				if (seconds) {
					// 1시간봉을 최대 4번(800개)까지 이어 받아 묶는다.
					let hours = [];
					let before = endMs;
					const need = Math.min(800, limit * seconds / 3600 + seconds / 3600);
					while (hours.length < need) {
						const page = (await this.klines(code, '1h', before, 200)).bars;
						if (page.length === 0) break;
						hours = page.concat(hours);
						before = page[0].time * 1000;
						if (page.length < 200) break;
					}
					return { bars: aggregate(hours, seconds) };
				}
				const query = new URLSearchParams({ market: code, count: String(Math.min(limit, 200)) });
				// to는 그 시각보다 앞선 봉만 돌려준다.
				if (endMs !== undefined) query.set('to', new Date(endMs + toOffsetHours * 3600000).toISOString().slice(0, 19));
				const rows = await json(`${ base }/v1/candles/${ UPBIT_PATHS[interval] }?${ query }`);
				return {
					bars: rows.reverse().map(row => ({
						time: Date.parse(`${ row.candle_date_time_utc }Z`) / 1000,
						open: row.opening_price,
						high: row.high_price,
						low: row.low_price,
						close: row.trade_price,
						volume: row.candle_acc_trade_volume,
					})),
				};
			},

			async symbols() {
				const rows = await json(`${ base }/v1/market/all`);
				return rows.map((row) => {
					const [quote, coin] = row.market.split('-');
					return entry(provider, row.market, { display: `${ coin }${ quote }`, base: coin, quote, name: row.korean_name, type: 'crypto' });
				});
			},

			async quotes(codes) {
				const rows = await json(`${ base }/v1/ticker?markets=${ codes.join(',') }`);
				return rows.map(row => [row.market, {
					price: row.trade_price,
					change: row.signed_change_rate * 100,
					high: row.high_price,
					low: row.low_price,
					turnover: row.acc_trade_price_24h,
				}]);
			},
		};
		return provider;
	}

	// ---------- Bybit (현물, USDT 무기한 선물) ----------

	const BYBIT_INTERVALS = {
		'1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
		'1d': 'D', '1w': 'W', '1M': 'M',
	};

	function bybit({ id, label, category, type, suffix }) {
		const base = 'https://api.bybit.com/v5/market';
		const unwrap = (body) => {
			if (body.retCode !== 0) throw new Error(body.retMsg);
			return body.result;
		};
		const provider = {
			id,
			label,
			group: 'Bybit',
			pollMs: 3000,
			quoteMs: 5000,
			describe: code => ({ display: code + suffix, type }),

			async klines(code, interval, endMs, limit = 1000) {
				const query = new URLSearchParams({ category, symbol: code, interval: BYBIT_INTERVALS[interval], limit: String(limit) });
				if (endMs !== undefined) query.set('end', String(endMs));
				const rows = unwrap(await json(`${ base }/kline?${ query }`)).list;
				return {
					bars: rows.reverse().map(row => ({
						time: Math.floor(Number(row[0]) / 1000),
						open: Number(row[1]),
						high: Number(row[2]),
						low: Number(row[3]),
						close: Number(row[4]),
						volume: Number(row[5]),
					})),
				};
			},

			async symbols() {
				const out = [];
				let cursor = '';
				do {
					const result = unwrap(await json(`${ base }/instruments-info?category=${ category }&limit=1000${ cursor ? `&cursor=${ encodeURIComponent(cursor) }` : '' }`));
					for (const row of result.list) {
						if (row.status !== 'Trading') continue;
						if (category === 'linear' && row.contractType !== 'LinearPerpetual') continue;
						out.push(entry(provider, row.symbol, { display: row.symbol + suffix, base: row.baseCoin, quote: row.quoteCoin, type }));
					}
					cursor = result.nextPageCursor ?? '';
				} while (cursor);
				return out;
			},

			async quotes(codes) {
				const wanted = new Set(codes);
				const rows = unwrap(await json(`${ base }/tickers?category=${ category }`)).list;
				return rows.filter(row => wanted.has(row.symbol)).map(row => [row.symbol, {
					price: Number(row.lastPrice),
					change: Number(row.price24hPcnt) * 100,
					high: Number(row.highPrice24h),
					low: Number(row.lowPrice24h),
					turnover: Number(row.turnover24h),
				}]);
			},
		};
		return provider;
	}

	// ---------- OKX (현물, USDT 무기한 선물) ----------

	const OKX_BARS = {
		'1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6Hutc', '12h': '12Hutc',
		'1d': '1Dutc', '1w': '1Wutc', '1M': '1Mutc',
	};

	function okx({ id, label, instType, type, suffix }) {
		const base = 'https://www.okx.com/api/v5';
		const unwrap = (body) => {
			if (body.code !== '0') throw new Error(body.msg);
			return body.data;
		};
		const display = code => code.replace('-SWAP', '').replace('-', '') + suffix;
		const provider = {
			id,
			label,
			group: 'OKX',
			pollMs: 3000,
			quoteMs: 5000,
			describe: code => ({ display: display(code), type }),

			async klines(code, interval, endMs) {
				// 최근 봉과 과거 봉의 주소가 다르다.
				const path = endMs === undefined
					? `market/candles?instId=${ code }&bar=${ OKX_BARS[interval] }&limit=300`
					: `market/history-candles?instId=${ code }&bar=${ OKX_BARS[interval] }&limit=100&after=${ endMs + 1 }`;
				const rows = unwrap(await json(`${ base }/${ path }`));
				return {
					bars: rows.reverse().map(row => ({
						time: Math.floor(Number(row[0]) / 1000),
						open: Number(row[1]),
						high: Number(row[2]),
						low: Number(row[3]),
						close: Number(row[4]),
						volume: Number(row[5]),
					})),
				};
			},

			async symbols() {
				const rows = unwrap(await json(`${ base }/public/instruments?instType=${ instType }`));
				return rows
					.filter(row => row.state === 'live' && (instType === 'SPOT' || row.ctType === 'linear'))
					.map((row) => {
						const [coin, quote] = row.instId.split('-');
						return entry(provider, row.instId, { display: display(row.instId), base: coin, quote, type });
					});
			},

			async quotes(codes) {
				const wanted = new Set(codes);
				const rows = unwrap(await json(`${ base }/market/tickers?instType=${ instType }`));
				return rows.filter(row => wanted.has(row.instId)).map((row) => {
					const price = Number(row.last);
					const open24 = Number(row.open24h);
					return [row.instId, {
						price,
						change: open24 ? (price - open24) / open24 * 100 : 0,
						high: Number(row.high24h),
						low: Number(row.low24h),
						turnover: instType === 'SPOT' ? Number(row.volCcy24h) : null,
					}];
				});
			},
		};
		return provider;
	}

	// ---------- Yahoo Finance: 주식, 지수, 환율, 원자재·지수 선물 (지연 시세, 주기적 갱신) ----------

	// 주기별로 한 번에 받을 수 있는 기간이 정해져 있어 과거 이어 받기는 하지 않는다.
	const YAHOO_FRAMES = {
		'1m': { interval: '1m', range: '5d', tail: '1d', seconds: 60 },
		'3m': { interval: '1m', range: '5d', tail: '1d', seconds: 60, bucket: 180 },
		'5m': { interval: '5m', range: '1mo', tail: '1d', seconds: 300 },
		'15m': { interval: '15m', range: '1mo', tail: '1d', seconds: 900 },
		'30m': { interval: '30m', range: '1mo', tail: '1d', seconds: 1800 },
		'1h': { interval: '60m', range: '6mo', tail: '5d', seconds: 3600 },
		'2h': { interval: '60m', range: '1y', tail: '5d', seconds: 3600, group: 2 },
		'4h': { interval: '60m', range: '2y', tail: '5d', seconds: 3600, group: 4 },
		'6h': { interval: '60m', range: '2y', tail: '5d', seconds: 3600, group: 6 },
		'12h': { interval: '60m', range: '2y', tail: '5d', seconds: 3600, group: 12 },
		'1d': { interval: '1d', range: '5y', tail: '5d', daily: 1 },
		'1w': { interval: '1wk', range: 'max', tail: '1mo', daily: 7 },
		// range=max로 받으면 3개월 간격으로 줄여서 준다.
		'1M': { interval: '1mo', range: '20y', tail: '1y', daily: 30 },
	};
	const YAHOO_TYPES = { EQUITY: 'stock', ETF: 'fund', MUTUALFUND: 'fund', INDEX: 'index', CURRENCY: 'fx', FUTURE: 'futures' };

	// extended: 장전·장후 거래(미국 주식 기준 04:00~20:00)를 분·시간 봉에 포함한다.
	const options = { extended: false };

	const yahooChart = (code, interval, range, extended = false) => proxied(
		`https://query1.finance.yahoo.com/v8/finance/chart/${ encodeURIComponent(code) }?interval=${ interval }&range=${ range }&includePrePost=${ extended }`)
		.then((body) => {
			const result = body.chart?.result?.[0];
			if (!result) throw new Error(body.chart?.error?.description ?? '데이터 없음');
			return result;
		});

	/** 장중의 마지막 점은 봉 시작이 아니라 현재 시각으로 오므로, 봉 경계에 맞춰 정리한다. */
	// Yahoo의 거래소 이름을 TradingView의 거래소 접두어로 바꾼다. 미국 상장 종목만 해당한다.
	const TV_EXCHANGES = { PCX: 'AMEX', ASE: 'AMEX', BTS: 'AMEX', NYQ: 'NYSE', NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ' };

	/**
	 * 장외 시간의 거래량을 TradingView에서 받아 온다. Yahoo는 이 구간의 거래량을 주지 않는다.
	 * 돌려주는 함수는 [from, to) 구간의 장외 거래량 합을 구한다. 받지 못하면 null.
	 */
	async function extendedVolume(code, meta, frame, count) {
		const exchange = TV_EXCHANGES[meta.exchangeName];
		if (!exchange || !/^[A-Z0-9.-]+$/.test(code)) return null;
		// 30분보다 긴 봉은 30분 봉을 받아서 합친다.
		const resolution = Math.min(30, frame.seconds / 60);
		try {
			const { bars } = await json(`/api/tv/bars?symbol=${ exchange }:${ code.replace('-', '.') }&res=${ resolution }&count=${ count }`);
			return (from, to) => {
				let sum = 0;
				let low = 0;
				let high = bars.length;
				while (low < high) {
					const mid = (low + high) >> 1;
					if (bars[mid][0] < from) low = mid + 1;
					else high = mid;
				}
				for (let i = low; i < bars.length && bars[i][0] < to; i++) sum += bars[i][5] ?? 0;
				return sum;
			};
		}
		catch {
			return null;
		}
	}

	function yahooBars(result, frame, volumeOf = null) {
		const quote = result.indicators.quote[0];
		const offset = result.meta.gmtoffset ?? 0;
		const bars = [];
		const stamps = result.timestamp ?? [];
		// 정규장 시작과 끝(거래소 현지 시각, 자정부터의 초). 그 밖의 봉은 장외 거래로 표시한다.
		const regular = result.meta.currentTradingPeriod?.regular;
		const dayPart = seconds => (((seconds + offset) % 86400) + 86400) % 86400;
		const session = regular && !frame.daily && options.extended ? [dayPart(regular.start), dayPart(regular.end)] : null;
		stamps.forEach((stamp, i) => {
			if (quote.close[i] === null || quote.open[i] === null) return;
			let time = stamp;
			const previous = bars[bars.length - 1];
			if (frame.daily) {
				const day = Math.floor((stamp + offset) / 86400);
				// 1970-01-01은 목요일. 주봉은 그 주 월요일로, 월봉은 그 달 1일로 맞춘다.
				const date = new Date(day * 86400000);
				const start = frame.daily === 7 ? day - ((day + 3) % 7)
					: frame.daily === 30 ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 86400000
						: day;
				time = start * 86400 - offset;
			}
			else if (i === stamps.length - 1 && previous && (stamp - previous.time) % frame.seconds !== 0) {
				time = previous.time + Math.floor((stamp - previous.time) / frame.seconds) * frame.seconds;
			}
			const bar = { time, open: quote.open[i], high: quote.high[i], low: quote.low[i], close: quote.close[i], volume: quote.volume[i] ?? 0 };
			if (session && (dayPart(time) < session[0] || dayPart(time) >= session[1])) bar.ext = true;
			if (previous && previous.time === time) {
				previous.high = Math.max(previous.high, bar.high);
				previous.low = Math.min(previous.low, bar.low);
				previous.close = bar.close;
				previous.volume = Math.max(previous.volume, bar.volume);
			}
			else if (!previous || time > previous.time) {
				bars.push(bar);
			}
		});
		if (volumeOf) {
			// 장외 봉만 채운다. 정규장 봉은 Yahoo의 거래량을 그대로 둔다.
			bars.forEach((bar, i) => {
				if (!bar.ext) return;
				const end = Math.min(bar.time + frame.seconds, bars[i + 1]?.time ?? Infinity);
				bar.volume = Math.max(bar.volume, volumeOf(bar.time, end));
			});
		}
		// 3분봉은 1분봉을 시각 기준으로 묶는다(거래가 없는 분이 있어 개수로 묶으면 어긋난다).
		if (frame.bucket) {
			const out = [];
			for (const bar of bars) {
				const time = Math.floor(bar.time / frame.bucket) * frame.bucket;
				const target = out[out.length - 1];
				if (target && target.time === time) {
					target.high = Math.max(target.high, bar.high);
					target.low = Math.min(target.low, bar.low);
					target.close = bar.close;
					target.volume += bar.volume;
				}
				else out.push({ ...bar, time });
			}
			return out;
		}
		if (!frame.group) return bars;

		// 2·4·6·12시간봉은 1시간봉을, 3분봉은 1분봉을 거래일 안에서 묶는다.
		const grouped = [];
		let day = null;
		let count = 0;
		for (const bar of bars) {
			const today = Math.floor((bar.time + offset) / 86400);
			if (today !== day) {
				day = today;
				count = 0;
			}
			if (count % frame.group === 0) {
				grouped.push({ ...bar });
			}
			else {
				const target = grouped[grouped.length - 1];
				target.high = Math.max(target.high, bar.high);
				target.low = Math.min(target.low, bar.low);
				target.close = bar.close;
				target.volume += bar.volume;
			}
			count++;
		}
		return grouped;
	}

	const yahoo = {
		id: 'YAHOO',
		label: 'Yahoo',
		group: 'Yahoo',
		pollMs: 10000,
		quoteMs: 15000,
		noPaging: true,
		// 주식·펀드의 분·시간 봉은 장외 거래를 포함해 받을 수 있다.
		sessions: true,
		describe: (code) => {
			const known = CURATED_BY_CODE.get(code);
			const type = code.endsWith('=F') ? 'futures' : code.endsWith('=X') ? 'fx' : code.startsWith('^') ? 'index' : 'stock';
			return { display: code, name: known?.name ?? '', type: known?.type ?? type, exch: known?.exch };
		},

		async klines(code, interval, endMs) {
			if (endMs !== undefined) return { bars: [] };
			const frame = YAHOO_FRAMES[interval];
			const extended = options.extended && !frame.daily;
			const result = await yahooChart(code, frame.interval, frame.range, extended);
			const volumeOf = extended ? await extendedVolume(code, result.meta, frame, 5000) : null;
			return { bars: yahooBars(result, frame, volumeOf), precision: Math.min(8, result.meta.priceHint ?? 2) };
		},

		async tail(code, interval) {
			const frame = YAHOO_FRAMES[interval];
			const extended = options.extended && !frame.daily;
			const result = await yahooChart(code, frame.interval, frame.tail, extended);
			// 같은 연결을 계속 쓰도록 처음과 같은 개수로 요청한다.
			const volumeOf = extended ? await extendedVolume(code, result.meta, frame, 5000) : null;
			return yahooBars(result, frame, volumeOf).slice(-3);
		},

		async quotes(codes) {
			const results = await Promise.allSettled(codes.map(code => yahooChart(code, '1d', '1d')));
			const out = [];
			results.forEach((result, i) => {
				if (result.status !== 'fulfilled') return;
				const meta = result.value.meta;
				const price = meta.regularMarketPrice;
				const previous = meta.chartPreviousClose ?? meta.previousClose;
				if (!Number.isFinite(price)) return;
				out.push([codes[i], {
					price,
					change: previous ? (price - previous) / previous * 100 : 0,
					high: meta.regularMarketDayHigh ?? null,
					low: meta.regularMarketDayLow ?? null,
					turnover: null,
				}]);
			});
			return out;
		},

		/** 영문 이름, 티커, 종목 코드로 찾는다. 한글 검색은 지원하지 않는다. */
		async search(query) {
			const body = await proxied(`https://query2.finance.yahoo.com/v1/finance/search?q=${ encodeURIComponent(query) }&quotesCount=20&newsCount=0`);
			return (body.quotes ?? [])
				.filter(row => YAHOO_TYPES[row.quoteType])
				.map(row => CURATED_BY_CODE.get(row.symbol) ?? entry(yahoo, row.symbol, {
					display: row.symbol,
					name: row.longname ?? row.shortname ?? '',
					type: YAHOO_TYPES[row.quoteType],
					exch: row.exchDisp ?? 'Yahoo',
				}));
		},
	};

	// 한글 이름으로 찾을 수 있도록 미리 넣어 둔 주요 종목.
	const curated = (type, exch, rows) => rows.map(([code, name]) => entry(yahoo, code, { display: code, name, type, exch }));
	const CURATED = [
		...curated('stock', 'KOSPI', [
			['005930.KS', '삼성전자'], ['000660.KS', 'SK하이닉스'], ['373220.KS', 'LG에너지솔루션'], ['207940.KS', '삼성바이오로직스'],
			['005380.KS', '현대차'], ['000270.KS', '기아'], ['068270.KS', '셀트리온'], ['105560.KS', 'KB금융'], ['035420.KS', 'NAVER'],
			['035720.KS', '카카오'], ['055550.KS', '신한지주'], ['005490.KS', 'POSCO홀딩스'], ['006400.KS', '삼성SDI'], ['051910.KS', 'LG화학'],
			['012330.KS', '현대모비스'], ['028260.KS', '삼성물산'], ['012450.KS', '한화에어로스페이스'], ['329180.KS', 'HD현대중공업'],
			['032830.KS', '삼성생명'], ['086790.KS', '하나금융지주'], ['034020.KS', '두산에너빌리티'], ['015760.KS', '한국전력'],
			['096770.KS', 'SK이노베이션'], ['066570.KS', 'LG전자'], ['009150.KS', '삼성전기'], ['259960.KS', '크래프톤'], ['011200.KS', 'HMM'],
			['138040.KS', '메리츠금융지주'], ['010130.KS', '고려아연'], ['017670.KS', 'SK텔레콤'], ['030200.KS', 'KT'], ['003490.KS', '대한항공'],
			['323410.KS', '카카오뱅크'], ['036570.KS', '엔씨소프트'], ['352820.KS', '하이브'], ['042660.KS', '한화오션'], ['000810.KS', '삼성화재'],
			['316140.KS', '우리금융지주'], ['034730.KS', 'SK'], ['003550.KS', 'LG'], ['003670.KS', '포스코퓨처엠'], ['090430.KS', '아모레퍼시픽'],
		]),
		...curated('fund', 'KOSPI', [
			['069500.KS', 'KODEX 200'], ['122630.KS', 'KODEX 레버리지'], ['114800.KS', 'KODEX 인버스'], ['252670.KS', 'KODEX 200선물인버스2X'],
			['229200.KS', 'KODEX 코스닥150'], ['360750.KS', 'TIGER 미국S&P500'], ['133690.KS', 'TIGER 미국나스닥100'],
		]),
		...curated('stock', 'KOSDAQ', [
			['247540.KQ', '에코프로비엠'], ['086520.KQ', '에코프로'], ['196170.KQ', '알테오젠'], ['028300.KQ', 'HLB'], ['068760.KQ', '셀트리온제약'],
			['277810.KQ', '레인보우로보틱스'], ['141080.KQ', '리가켐바이오'], ['263750.KQ', '펄어비스'], ['035900.KQ', 'JYP Ent.'], ['293490.KQ', '카카오게임즈'],
		]),
		...curated('stock', '미국', [
			['AAPL', '애플'], ['MSFT', '마이크로소프트'], ['NVDA', '엔비디아'], ['GOOGL', '알파벳 (구글)'], ['AMZN', '아마존'], ['META', '메타'],
			['TSLA', '테슬라'], ['AVGO', '브로드컴'], ['TSM', 'TSMC'], ['NFLX', '넷플릭스'], ['AMD', 'AMD'], ['INTC', '인텔'], ['PLTR', '팔란티어'],
			['COIN', '코인베이스'], ['MSTR', '스트래티지'], ['JPM', 'JP모건'], ['BRK-B', '버크셔 해서웨이'], ['V', '비자'], ['WMT', '월마트'],
			['KO', '코카콜라'], ['DIS', '디즈니'], ['BA', '보잉'], ['NKE', '나이키'], ['SBUX', '스타벅스'], ['UBER', '우버'], ['CRM', '세일즈포스'],
			['ORCL', '오라클'], ['ADBE', '어도비'], ['QCOM', '퀄컴'], ['MU', '마이크론'], ['ASML', 'ASML'],
		]),
		...curated('fund', '미국', [
			['SPY', 'SPDR S&P 500 ETF'], ['QQQ', '인베스코 QQQ ETF'], ['VOO', '뱅가드 S&P 500 ETF'], ['IWM', '러셀 2000 ETF'], ['TQQQ', '나스닥 100 3배 ETF'],
			['SOXL', '반도체 3배 ETF'], ['SCHD', '슈왑 배당 ETF'], ['TLT', '미국 장기 국채 ETF'], ['GLD', '금 ETF'], ['IBIT', '비트코인 현물 ETF'],
		]),
		...curated('index', '지수', [
			['^KS11', '코스피'], ['^KQ11', '코스닥'], ['^KS200', '코스피 200'], ['^GSPC', 'S&P 500'], ['^IXIC', '나스닥 종합'], ['^NDX', '나스닥 100'],
			['^DJI', '다우존스'], ['^RUT', '러셀 2000'], ['^VIX', 'VIX 변동성 지수'], ['^N225', '닛케이 225'], ['^HSI', '항셍'], ['000001.SS', '상하이 종합'],
			['^GDAXI', '독일 DAX'], ['^FTSE', '영국 FTSE 100'], ['^STOXX50E', '유로스톡스 50'], ['DX-Y.NYB', '달러 인덱스'], ['^TNX', '미국 10년물 국채 금리'],
		]),
		...curated('fx', '환율', [
			['KRW=X', '달러/원 USDKRW'], ['JPYKRW=X', '엔/원 JPYKRW'], ['EURKRW=X', '유로/원 EURKRW'], ['CNYKRW=X', '위안/원 CNYKRW'],
			['EURUSD=X', '유로/달러 EURUSD'], ['JPY=X', '달러/엔 USDJPY'], ['GBPUSD=X', '파운드/달러 GBPUSD'], ['AUDUSD=X', '호주달러/달러 AUDUSD'], ['CNY=X', '달러/위안 USDCNY'],
		]),
		...curated('futures', '선물', [
			['ES=F', 'S&P 500 선물'], ['NQ=F', '나스닥 100 선물'], ['YM=F', '다우 선물'], ['RTY=F', '러셀 2000 선물'], ['GC=F', '금 선물'],
			['SI=F', '은 선물'], ['HG=F', '구리 선물'], ['CL=F', 'WTI 원유 선물'], ['BZ=F', '브렌트유 선물'], ['NG=F', '천연가스 선물'],
			['ZB=F', '미국 국채 선물'], ['ZC=F', '옥수수 선물'], ['ZS=F', '대두 선물'], ['BTC=F', '비트코인 CME 선물'],
		]),
	];
	const CURATED_BY_CODE = new Map(CURATED.map(item => [item.code, item]));

	// ---------- 등록 ----------

	const list = [
		binance({
			id: 'BINANCE',
			label: 'Binance',
			type: 'crypto',
			suffix: '',
			restBases: ['https://data-api.binance.vision', 'https://api.binance.com'],
			klinePath: '/api/v3/klines',
			infoPath: '/api/v3/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false',
			wsBases: ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443'],
			accept: () => true,
		}),
		binance({
			id: 'BINANCEF',
			label: 'Binance 선물',
			type: 'perp',
			suffix: '.P',
			restBases: ['https://fapi.binance.com'],
			klinePath: '/fapi/v1/klines',
			infoPath: '/fapi/v1/exchangeInfo',
			// 선물 시세 스트림은 /market 경로에서만 흐른다. 예전 경로는 연결은 되지만 데이터가 오지 않는다.
			wsBases: ['wss://fstream.binance.com/market'],
			accept: row => row.status === 'TRADING' && row.contractType.endsWith('PERPETUAL'),
		}),
		upbitLike({ id: 'UPBIT', label: 'Upbit', base: 'https://api.upbit.com', toOffsetHours: 0 }),
		upbitLike({ id: 'BITHUMB', label: 'Bithumb', base: 'https://api.bithumb.com', toOffsetHours: 9 }),
		bybit({ id: 'BYBIT', label: 'Bybit', category: 'spot', type: 'crypto', suffix: '' }),
		bybit({ id: 'BYBITF', label: 'Bybit 선물', category: 'linear', type: 'perp', suffix: '.P' }),
		okx({ id: 'OKX', label: 'OKX', instType: 'SPOT', type: 'crypto', suffix: '' }),
		okx({ id: 'OKXF', label: 'OKX 선물', instType: 'SWAP', type: 'perp', suffix: '.P' }),
		yahoo,
	];
	const byId = new Map(list.map(provider => [provider.id, provider]));

	/** id를 공급원과 코드로 나눈다. 공급원을 모르면 null. */
	function resolve(id) {
		const cut = id.indexOf(':');
		const provider = byId.get(id.slice(0, cut));
		return provider ? { provider, code: id.slice(cut + 1) } : null;
	}

	/** 저장된 정보가 없을 때 쓰는 기본 표시 정보. */
	function describe(id) {
		const target = resolve(id);
		if (!target) return { display: id, name: '', type: 'crypto', exch: '' };
		return { name: '', exch: target.provider.label, ...target.provider.describe(target.code) };
	}

	// ---------- 로고 ----------
	// 브라우저가 아래 공개 주소에서 이미지를 직접 받는다. 없는 종목은 호출한 쪽에서 글자 아이콘으로 대신한다.

	const QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'USDE', 'USD1', 'PERP', 'USD', 'EUR', 'TRY', 'BRL', 'JPY', 'KRW', 'BTC', 'ETH', 'BNB', 'DAI'];
	const CURRENCY_FLAGS = { USD: 'us', KRW: 'kr', JPY: 'jp', EUR: 'eu', CNY: 'cn', GBP: 'gb', AUD: 'au', CAD: 'ca', CHF: 'ch', HKD: 'hk', SGD: 'sg', NZD: 'nz', INR: 'in', MXN: 'mx', TWD: 'tw' };
	const INDEX_FLAGS = {
		'^KS11': 'kr', '^KQ11': 'kr', '^KS200': 'kr', '^GSPC': 'us', '^IXIC': 'us', '^NDX': 'us', '^DJI': 'us', '^RUT': 'us', '^VIX': 'us',
		'DX-Y.NYB': 'us', '^TNX': 'us', '^N225': 'jp', '^HSI': 'hk', '000001.SS': 'cn', '^GDAXI': 'de', '^FTSE': 'gb', '^STOXX50E': 'eu',
	};
	const flag = country => `https://flagcdn.com/w80/${ country }.png`;

	/** 코인 종목 코드에서 코인 이름만 떼어 낸다 (KRW-BTC, BTC-USDT-SWAP, 1000PEPEUSDT → BTC, BTC, PEPE). */
	function coinOf(code, quoteFirst) {
		const parts = code.split('-');
		let coin = parts.length > 1 ? parts[quoteFirst ? 1 : 0] : code;
		if (parts.length === 1) {
			const quote = QUOTES.find(candidate => coin.endsWith(candidate) && coin.length > candidate.length);
			if (quote) coin = coin.slice(0, -quote.length);
		}
		return coin.replace(/^1(0{3,})/, '') || coin;
	}

	/** 종목 로고 후보 주소. 앞에서부터 시도한다. */
	function logos(id, base) {
		const target = resolve(id);
		if (!target) return [];
		const { provider, code } = target;
		if (provider !== yahoo) {
			// 거래소가 알려 준 코인 이름이 있으면 그것을 쓴다. Upbit과 Bithumb은 KRW-BTC처럼 기준 통화가 앞에 온다.
			const coin = (base ?? coinOf(code, provider.group === 'Upbit' || provider.group === 'Bithumb')).replace(/^1(0{3,})/, '');
			return [
				`https://static.okx.com/cdn/oksupport/asset/currency/icon/${ coin.toLowerCase() }.png`,
				`https://static.upbit.com/logos/${ coin }.png`,
				`https://assets.coincap.io/assets/icons/${ coin.toLowerCase() }@2x.png`,
			];
		}
		if (code.endsWith('=X')) {
			// KRW=X는 달러 기준 환율이다.
			const pair = code.slice(0, -2);
			const country = CURRENCY_FLAGS[pair.length === 3 ? 'USD' : pair.slice(0, 3)];
			return country ? [flag(country)] : [];
		}
		if (INDEX_FLAGS[code]) return [flag(INDEX_FLAGS[code])];
		if (code.startsWith('^') || code.endsWith('=F')) return [];
		return [`https://financialmodelingprep.com/image-stock/${ encodeURIComponent(code) }.png`];
	}

	// 거래소별 종목 목록은 처음 필요할 때 한 번만 받는다.
	const catalogs = new Map();

	function catalog(provider) {
		if (!provider.symbols) return Promise.resolve([]);
		if (!catalogs.has(provider.id)) {
			catalogs.set(provider.id, provider.symbols().catch(() => {
				catalogs.delete(provider.id);
				return [];
			}));
		}
		return catalogs.get(provider.id);
	}

	/** 종목과 관련된 최근 뉴스 제목. Yahoo Finance 검색을 쓴다. 코인은 달러 기준 종목으로 찾는다. */
	async function news(id, base) {
		const target = resolve(id);
		if (!target) return [];
		const { provider, code } = target;
		const query = provider === yahoo
			? code
			: `${ (base ?? coinOf(code, provider.group === 'Upbit' || provider.group === 'Bithumb')).replace(/^1(0{3,})/, '') }-USD`;
		const search = text => proxied(`https://query2.finance.yahoo.com/v1/finance/search?q=${ encodeURIComponent(text) }&quotesCount=1&newsCount=12`);
		let body = await search(query);
		// 코인과 미국 밖 주식은 코드로 찾으면 뉴스가 비어 있다. 검색이 알려 준 영문 이름으로 한 번 더 찾는다.
		const name = (body.quotes?.[0]?.longname ?? body.quotes?.[0]?.shortname ?? '')
			.replace(/\s+USD$/, '')
			.replace(/,?\s+(Co\.,?\s*Ltd\.?|Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|PLC|N\.V\.|S\.A\.)$/i, '');
		if (!body.news?.length && name) body = await search(name);
		// 검색 결과에는 관련 없는 기사도 섞인다. 기사의 관련 종목에 이 종목이 있거나 제목에 코드·이름이 나오면 related로 표시한다.
		const coin = provider === yahoo ? '' : query.replace(/-USD$/, '');
		const words = [code.replace(/\.(KS|KQ|T|HK|SS|SZ)$/, ''), coin, name.split(/\s+/)[0]]
			.filter(word => word && word.length >= 2 && !/^\d+$/.test(word))
			.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
		const pattern = words.length ? new RegExp(`\\b(${ words.join('|') })\\b`, 'i') : null;
		return (body.news ?? [])
			.filter(item => item.title && Number.isFinite(item.providerPublishTime))
			.sort((a, b) => b.providerPublishTime - a.providerPublishTime)
			.map(item => ({
				title: item.title,
				publisher: item.publisher ?? '',
				time: item.providerPublishTime,
				link: item.link ?? '',
				related: (item.relatedTickers ?? []).includes(query) || (pattern !== null && pattern.test(item.title)),
			}));
	}

	/**
	 * 한국어 관련 뉴스. Google 뉴스 RSS에서 최근 7일 기사를 찾는다(개인용 피드 읽기).
	 * 검색어는 종목의 한국어 이름을 쓴다. 코인은 Upbit에 등록된 한국어 이름(비트코인, 이더리움)을 찾아 쓴다.
	 */
	async function koreanNews(id, name, base) {
		const target = resolve(id);
		if (!target) return [];
		const { provider, code } = target;
		let term = name;
		if (provider !== yahoo) {
			const coin = (base ?? coinOf(code, provider.group === 'Upbit' || provider.group === 'Bithumb')).replace(/^1(0{3,})/, '');
			if (!term || /^[A-Z0-9]+$/.test(term)) {
				const upbit = (await catalog(byId.get('UPBIT'))).find(item => item.base === coin && item.quote === 'KRW');
				term = upbit?.name || `${ coin } 코인`;
			}
		}
		term ||= code.replace(/\.(KS|KQ)$/, '');
		const feed = `https://news.google.com/rss/search?q=${ encodeURIComponent(`${ term } when:7d`) }&hl=ko&gl=KR&ceid=KR:ko`;
		const response = await fetch(`/api/proxy?url=${ encodeURIComponent(feed) }`);
		if (!response.ok) throw new Error(`HTTP ${ response.status }`);
		const doc = new DOMParser().parseFromString(await response.text(), 'text/xml');
		return [...doc.querySelectorAll('item')]
			.map((item) => {
				const publisher = item.querySelector('source')?.textContent ?? '';
				let title = item.querySelector('title')?.textContent ?? '';
				// 제목 끝의 " - 언론사"를 뗀다.
				if (publisher && title.endsWith(` - ${ publisher }`)) title = title.slice(0, -(publisher.length + 3));
				return { title, publisher, time: Date.parse(item.querySelector('pubDate')?.textContent ?? '') / 1000, link: item.querySelector('link')?.textContent ?? '', related: true, term };
			})
			.filter(item => item.title && Number.isFinite(item.time))
			.sort((a, b) => b.time - a.time);
	}

	return { list, byId, resolve, describe, catalog, logos, news, koreanNews, options, curated: CURATED, searchRemote: query => yahoo.search(query) };
})();
