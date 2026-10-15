(() => {
	'use strict';

	const LC = window.LightweightCharts;
	const IND = window.ChartDeskIndicators;
	const DRAW = window.ChartDeskDrawings;
	const PROV = window.ChartDeskProviders;
	const RULES = window.ChartDeskRules;
	const STORAGE_KEY = 'chartdesk.workspace.v1';
	const INTERVALS = [
		['1m', '1분'], ['3m', '3분'], ['5m', '5분'], ['15m', '15분'], ['30m', '30분'],
		['1h', '1시간'], ['2h', '2시간'], ['4h', '4시간'], ['6h', '6시간'], ['12h', '12시간'],
		['1d', '일'], ['1w', '주'], ['1M', '월'],
	];
	// 차트 머리에 늘 보이는 주기. 나머지는 ▾ 메뉴에서 고른다.
	const MAIN_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
	const intervalLabel = id => INTERVALS.find(([key]) => key === id)?.[1] ?? id;
	// 기간 버튼: 이름, 주기, 보여 줄 봉 수(0은 전체).
	const RANGES = [['1일', '5m', 288], ['5일', '30m', 240], ['1개월', '1h', 720], ['3개월', '4h', 540], ['1년', '1d', 365], ['전체', '1w', 0]];
	const CHART_TYPES = [['candles', '캔들'], ['heikin', '하이킨 아시'], ['bars', '바'], ['line', '라인'], ['area', '영역']];
	const INDICATOR_CATEGORIES = ['추세', '모멘텀', '변동성', '거래량'];
	// 선 하나짜리 지표를 여러 개 올려도 구분되도록 돌려 쓰는 색.
	const PALETTE = ['#f5a623', '#a855f7', '#22c55e', '#ec4899', '#06b6d4', '#eab308', '#f97316'];
	// 월봉은 길이가 달마다 달라 30일로 어림한다(봉 경계는 countdown에서 따로 계산).
	const INTERVAL_SECONDS = {
		'1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
		'1d': 86400, '1w': 604800, '1M': 2592000,
	};
	const LAYOUTS = [1, 2, 4];
	// [id, 이름, 미리 보기 색(바탕, 패널, 강조, 상승, 하락)]
	const THEMES = [
		['black', '블랙', ['#000000', '#161616', '#3d7eff', '#31bd65', '#eb4b6d']],
		['charcoal', '차콜', ['#0b0e13', '#1c2130', '#3d7eff', '#31bd65', '#eb4b6d']],
		['navy', '네이비', ['#060a16', '#141e38', '#4c8dff', '#31bd65', '#eb4b6d']],
		['graphite', '그라파이트', ['#18191c', '#2c2e33', '#5b9cff', '#31bd65', '#eb4b6d']],
		['nord', '노드', ['#242933', '#3b4252', '#88c0d0', '#a3be8c', '#bf616a']],
		['dracula', '드라큘라', ['#1e1f29', '#343746', '#bd93f9', '#50fa7b', '#ff5555']],
		['solarized', '솔라라이즈드', ['#00212b', '#073642', '#268bd2', '#859900', '#dc322f']],
		['light', '라이트', ['#e9ecf1', '#ffffff', '#2563eb', '#25a750', '#ca3f64']],
		['sepia', '세피아', ['#e6dcc8', '#f6f0e2', '#b0621f', '#25a750', '#ca3f64']],
	];
	// 차트 라이브러리는 시간을 UTC로 표시하므로, 현지 시각으로 보이도록 오프셋을 더한다.
	const TZ_OFFSET = -new Date().getTimezoneOffset() * 60;

	const ICONS = {
		cursor: '<path d="M5 3l10 6.2-4.6 1.1L13 15.5l-1.9.9-2.5-5L5 14z"/>',
		trend: '<path d="M5 14.5L15 5.5"/><circle cx="4" cy="15.5" r="1.6"/><circle cx="16" cy="4.5" r="1.6"/>',
		ray: '<path d="M5.2 13.8L18 6"/><circle cx="4" cy="14.5" r="1.6"/>',
		extended: '<path d="M2 15L18 5"/><circle cx="7" cy="11.9" r="1.6"/><circle cx="13" cy="8.1" r="1.6"/>',
		hline: '<path d="M2 10h6.4M11.6 10H18"/><circle cx="10" cy="10" r="1.6"/>',
		hray: '<path d="M7.6 10H18"/><circle cx="6" cy="10" r="1.6"/>',
		vline: '<path d="M10 2v6.4M10 11.6V18"/><circle cx="10" cy="10" r="1.6"/>',
		channel: '<path d="M3 12L14 4M6 17L17 9"/><path d="M4.5 14.5L15.5 6.5" stroke-dasharray="2 2"/>',
		rect: '<rect x="3.5" y="5" width="13" height="10" rx="1"/>',
		fib: '<path d="M3 4h14M3 8h14M3 12h14M3 16h14"/>',
		info: '<path d="M3 15L13 6"/><path d="M15.5 12v4.5M15.5 9.4v.2"/>',
		angle: '<path d="M4 16h12M4 16L14 5"/><path d="M9.5 16a5.5 5.5 0 00-1.7-4"/>',
		cross: '<path d="M10 2v16M2 10h16"/>',
		regression: '<path d="M3 12L17 4M3 17L17 9"/><path d="M3 14.5L17 6.5" stroke-dasharray="2 2"/>',
		flat: '<path d="M3 12L17 4M3 16h14"/>',
		disjoint: '<path d="M3 5l14 4M3 15l14-4"/>',
		pitchfork: '<path d="M3 15l6-5 8-6M6 6l6 8M6 6l8-4M12 14l6-4"/>',
		fibext: '<path d="M3 16l5-9 3 5"/><path d="M12 5h5M12 9h5M13 13h4"/>',
		fibchannel: '<path d="M3 9l11-6M3 13l13-7M3 17l14-8"/>',
		fibtime: '<path d="M4 3v14M7 3v14M11 3v14M17 3v14"/>',
		fibfan: '<path d="M3 16L17 4M3 16l14-6M3 16l8-12M3 16h14"/>',
		fibcircle: '<circle cx="10" cy="10" r="2.5"/><circle cx="10" cy="10" r="5"/><circle cx="10" cy="10" r="7.5"/>',
		fibarc: '<path d="M3 14a7 7 0 0114 0M6 14a4 4 0 018 0M2 14h16"/>',
		gannbox: '<rect x="3" y="3" width="14" height="14"/><path d="M3 10h14M10 3v14"/>',
		gannfan: '<path d="M3 17V3M3 17h14M3 17L16 4M3 17l14-6M3 17l6-13"/>',
		pattern: '<path d="M2 14l4-8 4 5 4-7 4 9"/>',
		wave: '<path d="M2 15l3-7 3 4 4-8 3 5 3-4"/>',
		cyclelines: '<path d="M4 3v14M10 3v14M16 3v14"/>',
		timecycles: '<path d="M2 14a4 4 0 018 0 4 4 0 018 0"/>',
		sine: '<path d="M2 10c2-7 6-7 8 0s6 7 8 0"/>',
		long: '<rect x="3" y="3" width="14" height="8"/><path d="M3 11v6h14v-6" stroke-dasharray="2 2"/><path d="M8 8.5l2-3 2 3"/>',
		short: '<rect x="3" y="9" width="14" height="8"/><path d="M3 9V3h14v6" stroke-dasharray="2 2"/><path d="M8 11.5l2 3 2-3"/>',
		avwap: '<path d="M3 15c3-1 4-8 7-8s4 4 7 2"/><circle cx="3.5" cy="15" r="1.4"/>',
		pricerange: '<path d="M10 3v14M7 6l3-3 3 3M7 14l3 3 3-3"/>',
		daterange: '<path d="M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3"/>',
		measure: '<rect x="3" y="3" width="14" height="14" stroke-dasharray="2 2"/><path d="M6 14l8-8M10 6h4v4"/>',
		highlighter: '<path d="M4 16.5h5M7 13l7-8 3 3-7 8z"/>',
		arrow: '<path d="M4 16L16 4M10 4h6v6"/>',
		arrowup: '<path d="M10 17V4M5 9l5-5 5 5"/>',
		arrowdown: '<path d="M10 3v13M5 11l5 5 5-5"/>',
		rotrect: '<path d="M9 2l9 7-7 9-9-7z"/>',
		path: '<path d="M3 15l4-8 5 5 4-7"/><path d="M13 4.5h3.5V8"/>',
		circle: '<circle cx="10" cy="10" r="6.5"/>',
		ellipse: '<ellipse cx="10" cy="10" rx="7.5" ry="4.5"/>',
		polyline: '<path d="M4 15l2-9 7-2 4 7-6 6z"/>',
		triangle: '<path d="M10 4l7 12H3z"/>',
		arc: '<path d="M3 15a8 8 0 0114 0"/>',
		curve: '<path d="M3 15c2-10 8-12 14-10"/>',
		callout: '<path d="M3 4h14v9H9l-4 4v-4H3z"/>',
		pricelabel: '<path d="M3 6h9l4 4-4 4H3z"/>',
		flag: '<path d="M5 17V3M5 4h10l-3 3 3 3H5"/>',
		ruler: '<path d="M3 13L13 3l4 4L7 17z"/><path d="M6.5 10.5l1.5 1.5M9 8l1.5 1.5M11.5 5.5L13 7"/>',
		zoom: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4M9 6.5v5M6.5 9h5"/>',
		zoomout: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4M6.5 9h5"/>',
		inside: '<path d="M3 15l6-5 8-6M6 6l6 8M9 10l7-5M9 10l8-2"/>',
		fibspiral: '<path d="M10 10a1 1 0 011-1 2 2 0 012 2 3 3 0 01-3 3 5 5 0 01-5-5 7 7 0 017-7"/>',
		fibwedge: '<path d="M3 16L16 5M3 16h14"/><path d="M9 16a6 6 0 00-1.5-4M14 16a11 11 0 00-2.6-7"/>',
		pitchfan: '<path d="M3 15L17 4M3 15l14-5M3 15l14 1M17 4v12"/>',
		gannsquare: '<rect x="3" y="3" width="14" height="14"/><path d="M3 17L17 3M3 17l14-7M3 17l7-14"/>',
		forecast: '<path d="M3 15c3-1 5-3 6-6" /><path d="M9 9c2-3 4-4 8-5" stroke-dasharray="2 2"/><path d="M13.5 3.5H17V7"/>',
		barspattern: '<path d="M5 4v10M10 7v9M15 3v9"/><path d="M3.5 6h3v6h-3zM8.500 9h3v5h-3zM13.5 5h3v4h-3z"/>',
		ghost: '<path d="M4 9v8M9 6v8M14 4v7"/><path d="M2.500 11h3v4h-3zM7.500 8h3v4h-3zM12.5 5h3v4h-3z" stroke-dasharray="1.5 1.5"/>',
		sector: '<path d="M4 16L15 5a11 11 0 012 11z"/>',
		profile: '<path d="M4 3v14M4 5h6M4 8h11M4 11h8M4 14h4"/>',
		arrowmarker: '<path d="M3 13l8-8-2-2h8v8l-2-2-8 8z"/>',
		doublecurve: '<path d="M3 14c3-12 6-12 7-4s4 8 7-4"/>',
		note: '<path d="M4 3h9l3 3v11H4z"/><path d="M7 8h6M7 11h6M7 14h3"/>',
		pricenote: '<path d="M3 15L9 8"/><path d="M9 5h8v6H9z"/><circle cx="3" cy="15" r="1.3"/>',
		pin: '<path d="M10 17s5-5.200 5-8.500a5 5 0 00-10 0C5 11.800 10 17 10 17z"/><circle cx="10" cy="8.500" r="1.800"/>',
		table: '<rect x="3" y="4" width="14" height="12"/><path d="M3 8h14M3 12h14M8 4v12"/>',
		comment: '<path d="M3 4h14v9H8l-4 4z"/>',
		signpost: '<path d="M10 17V9"/><rect x="4" y="3" width="12" height="6" rx="1"/>',
		image: '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M3 14l4-4 3 3 3-4 4 5"/><circle cx="7" cy="7.500" r="1.200"/>',
		help: '<circle cx="10" cy="10" r="7"/><path d="M8 8.2a2.1 2.1 0 113.4 1.7c-.8.6-1.4 1.1-1.4 2.1M10 14.3v.2"/>',
		search: '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>',
		star: '<path d="M10 3l2.1 4.5 4.9.6-3.6 3.4.9 4.9L10 14l-4.3 2.4.9-4.9L3 8.1l4.9-.6z"/>',
		more: '<path d="M8 6l4 4-4 4"/>',
		text: '<path d="M5 5h10M10 5v11"/>',
		brush: '<path d="M3 15c2 0 2-3 4-3s2 3 4 0 3-7 6-8"/>',
		magnet: '<path d="M5 4v6a5 5 0 0010 0V4h-3v6a2 2 0 01-4 0V4z"/>',
		eye: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.4"/>',
		eyeOff: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><path d="M4 16L16 4"/>',
		undo: '<path d="M7 5L3 9l4 4M3 9h9a4 4 0 010 8h-2"/>',
		redo: '<path d="M13 5l4 4-4 4M17 9H8a4 4 0 000 8h2"/>',
		trash: '<path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/>',
		camera: '<path d="M3 7h3l1.5-2h5L14 7h3v9H3z"/><circle cx="10" cy="11.2" r="2.8"/>',
		theme: '<path d="M15.5 12A6 6 0 018 4.5a6 6 0 107.5 7.5z"/>',
		sync: '<path d="M10 2v16M2 10h16"/><circle cx="10" cy="10" r="3"/>',
		link: '<path d="M8 12l4-4M7 9l-2 2a2.8 2.8 0 004 4l2-2M13 11l2-2a2.8 2.8 0 00-4-4L9 7"/>',
		candles: '<path d="M6 3v14M14 3v14"/><rect x="4" y="6" width="4" height="7"/><rect x="12" y="8" width="4" height="6"/>',
		indicator: '<path d="M3 15c3 0 3-9 6-9s2 6 4 6 2-4 4-4"/>',
		bell: '<path d="M5 14V9a5 5 0 0110 0v5l1.5 1.5h-13zM8.5 17.5h3"/>',
		gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
		close: '<path d="M5 5l10 10M15 5L5 15"/>',
		plus: '<path d="M10 4v12M4 10h12"/>',
		live: '<path d="M5 5l5 5-5 5M11 5l5 5-5 5"/>',
	};

	const $ = id => document.getElementById(id);
	const uid = () => Math.random().toString(36).slice(2, 10);

	function el(tag, props, ...children) {
		const node = document.createElement(tag);
		for (const [key, value] of Object.entries(props ?? {})) {
			if (key === 'class') node.className = value;
			else if (key === 'text') node.textContent = value;
			else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
			else node.setAttribute(key, value);
		}
		node.append(...children);
		return node;
	}

	/** ICONS의 고정된 SVG 조각으로 아이콘을 만든다. */
	function icon(name) {
		const node = el('span', { class: 'ico' });
		node.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ ICONS[name] }</svg>`;
		return node;
	}

	const iconButton = (name, title, props = {}) => el('button', { class: 'icon-btn', title, ...props }, icon(name));

	// ---------- 상태와 저장 ----------

	/** 공급원이 붙지 않은 예전 심볼은 Binance 현물로 본다. */
	const normalizeId = symbol => (symbol.includes(':') ? symbol : `BINANCE:${ symbol.toUpperCase() }`);

	function sanitizeParams(def, params) {
		const merged = {};
		for (const param of def.params) {
			const value = Number(params?.[param.k]);
			merged[param.k] = Number.isFinite(value) && value >= param.min ? value : param.def;
		}
		return merged;
	}

	function newIndicator(type, saved = {}) {
		const def = IND.byId.get(type);
		const style = {};
		for (const plot of def.plots) {
			const source = saved.style?.[plot.k];
			if (!source) continue;
			style[plot.k] = {};
			if (typeof source.color === 'string') style[plot.k].color = source.color;
			if (Number.isFinite(source.width)) style[plot.k].width = source.width;
			if (source.hidden === true) style[plot.k].hidden = true;
		}
		// 이전 버전은 선 색 하나만 저장했다.
		if (typeof saved.color === 'string') style[def.plots[0].k] = { ...style[def.plots[0].k], color: saved.color };
		const item = { id: uid(), type, params: sanitizeParams(def, saved.params), style };
		if (saved.hidden === true) item.hidden = true;
		if (typeof saved.axisLabel === 'boolean') item.axisLabel = saved.axisLabel;
		if (Array.isArray(saved.levels)) item.levels = saved.levels.filter(Number.isFinite);
		if (typeof saved.tf === 'string' && INTERVAL_SECONDS[saved.tf] && frameable(def)) item.tf = saved.tf;
		return item;
	}

	/** 다른 주기의 봉으로 계산해 얹을 수 있는 지표. 화면에 직접 그리는 지표와 선을 옆으로 미는 지표는 뺀다. */
	const frameable = def => !def.draw && !def.basis && !def.plots.some(plot => typeof plot.shift === 'function');

	function defaultPane(symbol = 'BINANCE:BTCUSDT') {
		return {
			symbol,
			interval: '1h',
			chartType: 'candles',
			log: false,
			compare: [],
		};
	}

	const defaultIndicators = () => [newIndicator('volume'), newIndicator('sma', { color: PALETTE[0] })];

	function sanitizeIndicators(saved) {
		if (Array.isArray(saved)) {
			// 저장된 id를 그대로 둔다. 불러올 때마다 바뀌면 설정이 바뀐 것으로 보여 Gist 동기화가 매번 올린다.
			const ids = new Set();
			return saved.filter(item => item && IND.byId.has(item.type)).map((item) => {
				const indicator = newIndicator(item.type, item);
				if (typeof item.id === 'string' && item.id && !ids.has(item.id)) indicator.id = item.id;
				ids.add(indicator.id);
				return indicator;
			});
		}
		// 처음 버전은 켜고 끄는 네 가지 지표만 저장했다.
		const legacy = saved ?? {};
		const list = [];
		if (legacy.vol !== false) list.push(newIndicator('volume'));
		if (legacy.ma !== false) list.push(newIndicator('sma', { color: PALETTE[0] }));
		if (legacy.ema) list.push(newIndicator('ema', { color: PALETTE[1] }));
		if (legacy.bb) list.push(newIndicator('bb'));
		return list;
	}

	function sanitizePane(pane) {
		const base = defaultPane();
		if (!pane || typeof pane.symbol !== 'string') return base;
		const symbol = normalizeId(pane.symbol);
		return {
			symbol: PROV.resolve(symbol) ? symbol : base.symbol,
			interval: INTERVALS.some(([id]) => id === pane.interval) ? pane.interval : base.interval,
			chartType: CHART_TYPES.some(([id]) => id === pane.chartType) ? pane.chartType : 'candles',
			log: pane.log === true,
			compare: (Array.isArray(pane.compare) ? pane.compare : [])
				.filter(item => item && typeof item.symbol === 'string' && PROV.resolve(normalizeId(item.symbol)))
				.slice(0, 5)
				.map((item, i) => ({ symbol: normalizeId(item.symbol), color: typeof item.color === 'string' ? item.color : PALETTE[(i + 1) % PALETTE.length] })),
		};
	}

	/**
	 * 알림 세 가지: 가격(price), 지표 조건(cond: 봉이 마감될 때 확인), 작도 돌파(drawing: 수평선·추세선을 가격이 넘을 때).
	 * 예전 알림은 kind가 없고 가격 알림이다.
	 */
	function sanitizeAlert(alert) {
		if (!alert || typeof alert.symbol !== 'string') return null;
		const base = {
			id: typeof alert.id === 'string' ? alert.id : uid(),
			symbol: normalizeId(alert.symbol),
			active: alert.active !== false,
			triggeredAt: Number.isFinite(alert.triggeredAt) ? alert.triggeredAt : null,
			createdAt: Number.isFinite(alert.createdAt) ? alert.createdAt : 0,
		};
		if (alert.kind === 'cond') {
			const cond = RULES.cleanCond(alert.cond);
			if (!cond || !INTERVAL_SECONDS[alert.interval]) return null;
			return { ...base, kind: 'cond', interval: alert.interval, cond, repeat: alert.repeat === true, checked: Number.isFinite(alert.checked) ? alert.checked : null };
		}
		if (alert.kind === 'drawing') {
			if (typeof alert.drawingId !== 'string') return null;
			return { ...base, kind: 'drawing', drawingId: alert.drawingId, op: ['crossUp', 'crossDown', 'cross'].includes(alert.op) ? alert.op : 'cross' };
		}
		if (!Number.isFinite(alert.price)) return null;
		return { ...base, kind: 'price', price: alert.price, direction: alert.direction === 'below' ? 'below' : 'above' };
	}

	// 바 리플레이 모의 매매의 기본값. 시드는 원화 종목과 그 밖의 종목을 따로 기억한다.
	const PAPER_DEFAULTS = {
		seedKrw: 10000000, seedUsd: 10000, fee: 0.05, leverage: 10, stop: 0, target: 0,
		// 주문 방식(market, limit)과 주문 크기 방식(percent: size %, amount: 금액, qty: 개수)
		orderType: 'market', sizeMode: 'percent', size: 25, amount: 1000, qty: 1,
	};

	function sanitizePaper(saved) {
		const out = { ...PAPER_DEFAULTS };
		for (const key of Object.keys(PAPER_DEFAULTS)) {
			if (typeof PAPER_DEFAULTS[key] !== 'number') continue;
			const value = Number(saved?.[key]);
			if (Number.isFinite(value) && value >= 0) out[key] = value;
		}
		if (['market', 'limit'].includes(saved?.orderType)) out.orderType = saved.orderType;
		if (['percent', 'amount', 'qty'].includes(saved?.sizeMode)) out.sizeMode = saved.sizeMode;
		out.leverage = Math.min(125, Math.max(1, out.leverage));
		return out;
	}

	function sanitizeDrawings(saved) {
		const out = {};
		if (!saved || typeof saved !== 'object') return out;
		for (const [symbol, list] of Object.entries(saved)) {
			if (!Array.isArray(list)) continue;
			const valid = list.filter(item => item && DRAW.byId.has(item.tool) && DRAW.byId.get(item.tool).type === item.type && !DRAW.byId.get(item.tool).transient &&
				Array.isArray(item.points) && item.points.length > 0 &&
				item.points.every(point => point && Number.isFinite(point.t) && Number.isFinite(point.p)) &&
				item.style && typeof item.style === 'object');
			for (const item of valid) item.style = DRAW.defaultStyle(item.tool, item.style);
			if (valid.length) out[normalizeId(symbol)] = valid;
		}
		return out;
	}

	function defaultState() {
		const tab = { id: uid(), layout: 1, active: 0, panes: [defaultPane()] };
		return {
			theme: 'black',
			crosshairSync: true,
			linkSymbols: false,
			magnet: false,
			hideDrawings: false,
			extended: false,
			indicators: defaultIndicators(),
			favoriteIndicators: [],
			tabs: [tab],
			activeTab: tab.id,
			watchlist: [
				'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'UPBIT:KRW-BTC', 'BINANCEF:BTCUSDT',
				'YAHOO:^KS11', 'YAHOO:005930.KS', 'YAHOO:^GSPC', 'YAHOO:NVDA', 'YAHOO:KRW=X', 'YAHOO:GC=F',
			],
			alerts: [],
			drawings: {},
			drawingDefaults: {},
			toolPicks: {},
			symbolMeta: {},
			paneSizes: {},
			paper: { ...PAPER_DEFAULTS },
			replayPos: null,
		};
	}

	function loadState() {
		const base = defaultState();
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
			if (!saved || !Array.isArray(saved.tabs) || saved.tabs.length === 0) return base;
			// 예전에는 지표를 차트마다 따로 저장했다. 보고 있던 차트의 지표를 전체 설정으로 옮긴다.
			const legacyTab = saved.tabs.find(tab => tab.id === saved.activeTab) ?? saved.tabs[0];
			const legacyPane = legacyTab?.panes?.[legacyTab.active] ?? legacyTab?.panes?.[0];
			const indicators = Array.isArray(saved.indicators) ? sanitizeIndicators(saved.indicators) : sanitizeIndicators(legacyPane?.indicators);
			const tabs = saved.tabs.map((tab) => {
				const panes = (Array.isArray(tab.panes) ? tab.panes : []).map(sanitizePane);
				const layout = LAYOUTS.includes(tab.layout) ? tab.layout : 1;
				return {
					id: typeof tab.id === 'string' ? tab.id : uid(),
					layout,
					active: Number.isInteger(tab.active) && tab.active >= 0 && tab.active < layout ? tab.active : 0,
					panes: panes.length ? panes : [defaultPane()],
				};
			});
			return {
				theme: THEMES.some(([id]) => id === saved.theme) ? saved.theme : 'black',
				crosshairSync: saved.crosshairSync !== false,
				linkSymbols: saved.linkSymbols === true,
				magnet: saved.magnet === true,
				hideDrawings: saved.hideDrawings === true,
				extended: saved.extended === true,
				indicators,
				favoriteIndicators: Array.isArray(saved.favoriteIndicators) ? saved.favoriteIndicators.filter(id => IND.byId.has(id)) : [],
				tabs,
				activeTab: tabs.some(tab => tab.id === saved.activeTab) ? saved.activeTab : tabs[0].id,
				watchlist: Array.isArray(saved.watchlist)
					? saved.watchlist.filter(s => typeof s === 'string').map(normalizeId).filter(id => PROV.resolve(id))
					: base.watchlist,
				alerts: Array.isArray(saved.alerts) ? saved.alerts.map(sanitizeAlert).filter(Boolean) : [],
				drawings: sanitizeDrawings(saved.drawings),
				drawingDefaults: saved.drawingDefaults && typeof saved.drawingDefaults === 'object' ? saved.drawingDefaults : {},
				toolPicks: saved.toolPicks && typeof saved.toolPicks === 'object' ? saved.toolPicks : {},
				symbolMeta: saved.symbolMeta && typeof saved.symbolMeta === 'object' ? saved.symbolMeta : {},
				// 가격 패널(main)과 하단 지표 패널(지표 id)의 높이 비율. 모든 종목·차트가 함께 쓴다.
				paper: sanitizePaper(saved.paper),
				// 리플레이 막대를 옮겨 둔 자리(차트 폭·높이에 대한 비율). null이면 아래 가운데.
				replayPos: saved.replayPos && Number.isFinite(saved.replayPos.x) && Number.isFinite(saved.replayPos.y)
					? { x: Math.min(1, Math.max(0, saved.replayPos.x)), y: Math.min(1, Math.max(0, saved.replayPos.y)) }
					: null,
				paneSizes: Object.fromEntries(Object.entries(saved.paneSizes && typeof saved.paneSizes === 'object' ? saved.paneSizes : {})
					.filter(([, size]) => Number.isFinite(size) && size > 0)),
			};
		}
		catch {
			return base;
		}
	}

	const state = loadState();
	PROV.options.extended = state.extended;
	let saveTimer = 0;
	// 설정을 가져온 뒤 다시 불러오기 전까지는 지금 상태를 저장하지 않는다.
	let savingFrozen = false;
	// 저장할 때마다 부른다(Gist 자동 동기화).
	let onSave = null;

	function save() {
		clearTimeout(saveTimer);
		if (savingFrozen) return;
		onSave?.();
		saveTimer = setTimeout(() => {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			}
			catch {
				// 저장소를 쓸 수 없어도 화면은 계속 동작한다.
			}
		}, 200);
	}

	const activeTab = () => state.tabs.find(tab => tab.id === state.activeTab);

	// 보고 있는 종목이나 주기가 바뀌면 알린다.
	const changeListeners = [];
	const notifyChange = () => changeListeners.forEach(listener => listener());

	// ---------- 종목 표시와 시세 데이터 ----------

	/** 종목의 표시 정보. 검색에서 고른 종목은 저장해 둔 이름을 쓴다. */
	function symbolInfo(id) {
		return { ...PROV.describe(id), ...(state.symbolMeta[id] ?? {}) };
	}

	/** 화면에 보일 이름. 주식·지수처럼 이름이 있는 종목은 이름을, 코인은 심볼을 쓴다. */
	function symbolTitle(id) {
		const info = symbolInfo(id);
		return info.type === 'crypto' || info.type === 'perp' || !info.name ? info.display : info.name;
	}

	const brokenLogos = new Set();

	/** 종목 로고. 받아 올 이미지가 없거나 받지 못하면 이름 첫 글자로 대신한다. */
	function logo(id, info = symbolInfo(id)) {
		const title = info.type === 'crypto' || info.type === 'perp' || !info.name ? info.display : info.name;
		const node = el('span', { class: 'logo', text: title.replace(/^\^/, '').slice(0, 1).toUpperCase() });
		let hue = 0;
		for (const char of id) hue = (hue * 31 + char.charCodeAt(0)) % 360;
		node.style.background = `hsl(${ hue } 45% 42%)`;
		const candidates = PROV.logos(id, info.base).filter(url => !brokenLogos.has(url));
		const next = () => {
			const url = candidates.shift();
			if (!url) return;
			const image = el('img', { alt: '', referrerpolicy: 'no-referrer' });
			image.addEventListener('load', () => {
				// 투명한 바탕의 어두운 로고도 보이도록 흰 바탕을 깐다.
				node.style.background = '#ffffff';
				node.replaceChildren(image);
			});
			image.addEventListener('error', () => {
				brokenLogos.add(url);
				next();
			});
			image.src = url;
		};
		next();
		return node;
	}

	function decimalsOfNumber(value) {
		const text = Math.abs(value).toFixed(8);
		return text.slice(text.indexOf('.') + 1).replace(/0+$/, '').length;
	}

	function precisionOf(bars) {
		let decimals = 0;
		let top = 0;
		for (const bar of bars.slice(-60)) {
			top = Math.max(top, bar.high);
			for (const value of [bar.open, bar.high, bar.low, bar.close]) decimals = Math.max(decimals, decimalsOfNumber(value));
		}
		// 원화처럼 큰 정수 가격은 소수 자리를 붙이지 않는다.
		return decimals < 2 && top < 1000 ? 2 : decimals;
	}

	// 지표가 위 주기의 봉을 필요로 할 때(매물대·지지저항의 지지·저항) 받아 두는 곳. 종목·주기마다 하나, 5분이 지나면 다시 받는다.
	const basisBars = new Map();
	const BASIS_FRESH_MS = 5 * 60 * 1000;

	/** 위 주기의 봉. 받는 중이면 loading, 받지 못했으면 source가 null이다. 다 받으면 onReady를 부른다. */
	function basisFor(symbol, interval, onReady) {
		const key = `${ symbol }|${ interval }`;
		let entry = basisBars.get(key);
		if (!entry || (!entry.loading && Date.now() - entry.at > BASIS_FRESH_MS)) {
			entry = { at: Date.now(), loading: true, source: entry?.source ?? null, bars: entry?.bars ?? null, waiting: new Set() };
			const current = entry;
			basisBars.set(key, current);
			loadBars(symbol, interval)
				.then(({ bars }) => {
					current.source = IND.source(bars);
					current.bars = bars;
				})
				.catch(() => {})
				.finally(() => {
					current.loading = false;
					current.at = Date.now();
					const waiting = [...current.waiting];
					current.waiting.clear();
					waiting.forEach(callback => callback());
				});
		}
		if (entry.loading) entry.waiting.add(onReady);
		return { interval, source: entry.source, bars: entry.bars, loading: entry.loading && !entry.source };
	}

	/**
	 * 위 주기의 봉에 차트의 최근 봉을 이어 붙인다. 위 주기 봉은 5분마다 다시 받으므로, 그 사이의 실시간 움직임은
	 * 차트 봉으로 마지막 봉을 고치고 새 봉을 만든다.
	 */
	function mergeFrame(frameBars, chartBars, interval) {
		const seconds = INTERVAL_SECONDS[interval];
		const out = frameBars.slice();
		let last = out[out.length - 1];
		if (!last) return out;
		const startIndex = barIndexAt(chartBars, last.time);
		for (let i = Math.max(0, startIndex); i < chartBars.length; i++) {
			const bar = chartBars[i];
			if (bar.time < last.time) continue;
			if (bar.time >= last.time + seconds) {
				const time = last.time + Math.floor((bar.time - last.time) / seconds) * seconds;
				last = { time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
				out.push(last);
				continue;
			}
			if (last === frameBars[frameBars.length - 1]) {
				last = { ...last };
				out[out.length - 1] = last;
			}
			last.high = Math.max(last.high, bar.high);
			last.low = Math.min(last.low, bar.low);
			last.close = bar.close;
		}
		return out;
	}

	/** 공급원에서 최근 봉 몇 개를 받는다(비교 종목 갱신). */
	async function loadTail(id, interval) {
		const { provider, code } = PROV.resolve(id);
		const bars = provider.tail ? await provider.tail(code, interval) : (await provider.klines(code, interval, undefined, 3)).bars;
		return bars.map(bar => ({ ...bar, time: bar.time + TZ_OFFSET }));
	}

	/** 봉을 받아 차트 시간(현지 시각 기준)으로 바꾼다. */
	async function loadBars(id, interval, endMs, limit) {
		const { provider, code } = PROV.resolve(id);
		const result = await provider.klines(code, interval, endMs, limit);
		const bars = result.bars.map(bar => ({ ...bar, time: bar.time + TZ_OFFSET }));
		return { bars, precision: result.precision ?? precisionOf(bars) };
	}

	function heikinAshi(bars) {
		const out = [];
		for (const bar of bars) {
			const previous = out[out.length - 1];
			const close = (bar.open + bar.high + bar.low + bar.close) / 4;
			const open = previous ? (previous.open + previous.close) / 2 : (bar.open + bar.close) / 2;
			out.push({ time: bar.time, open, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close), close });
		}
		return out;
	}

	/** time 이하인 마지막 봉의 인덱스. 없으면 -1. */
	function barIndexAt(bars, time) {
		let low = 0;
		let high = bars.length - 1;
		let found = -1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (bars[mid].time <= time) {
				found = mid;
				low = mid + 1;
			}
			else {
				high = mid - 1;
			}
		}
		return found;
	}

	// ---------- 표시 형식 ----------

	function formatPrice(price, precision) {
		const size = Math.abs(price);
		const digits = precision ?? (size >= 100 ? 2 : size >= 1 ? 4 : size >= 0.01 ? 5 : 8);
		// 자릿수를 모르는 정수 가격(원화 등)에는 소수 자리를 붙이지 않는다.
		const minimum = precision === undefined && Number.isInteger(price) ? 0 : Math.min(2, digits);
		return price.toLocaleString('ko-KR', { minimumFractionDigits: minimum, maximumFractionDigits: digits });
	}

	function formatVolume(volume) {
		if (volume >= 1e9) return `${ (volume / 1e9).toFixed(2) }B`;
		if (volume >= 1e6) return `${ (volume / 1e6).toFixed(2) }M`;
		if (volume >= 1e3) return `${ (volume / 1e3).toFixed(2) }K`;
		return volume.toFixed(2);
	}

	const formatPercent = value => `${ value >= 0 ? '+' : '' }${ value.toFixed(2) }%`;

	function cssColors() {
		const style = getComputedStyle(document.documentElement);
		const read = name => style.getPropertyValue(name).trim();
		return {
			panel: read('--panel'),
			muted: read('--muted'),
			grid: read('--grid'),
			border: read('--border'),
			accent: read('--accent'),
			up: read('--up'),
			down: read('--down'),
			warn: read('--warn'),
			text: read('--text'),
			font: style.fontFamily,
		};
	}

	// ---------- 토스트와 팝오버 ----------

	function toast(message) {
		const node = el('div', { class: 'toast', text: message });
		$('toasts').append(node);
		setTimeout(() => node.remove(), 8000);
	}

	const popover = $('popover');

	function closePopover() {
		popover.hidden = true;
		popover.className = 'popover';
		popover.replaceChildren();
	}

	function openPopover(anchor, ...content) {
		// 모든 창의 오른쪽 위에 닫기 버튼을 둔다. 제목이 있으면 제목 줄에, 검색창으로 시작하면 그 옆에 붙인다.
		const close = el('button', { class: 'pop-close', title: '닫기 (Esc)', 'aria-label': '닫기', text: '×', onclick: closePopover });
		const [first] = content;
		if (first instanceof HTMLElement && first.classList.contains('title')) {
			first.classList.add('with-close');
			first.append(close);
		}
		else if (first instanceof HTMLInputElement) content[0] = el('div', { class: 'pop-head' }, first, close);
		else content.unshift(el('div', { class: 'pop-head' }, close));
		popover.replaceChildren(...content);
		popover.hidden = false;
		const rect = anchor.getBoundingClientRect();
		// 왼쪽 도구 막대의 메뉴는 옆으로, 나머지는 아래로 편다.
		if (popover.classList.contains('indicators')) {
			popover.style.left = `${ Math.max(8, (window.innerWidth - popover.offsetWidth) / 2) }px`;
			popover.style.top = `${ Math.max(8, (window.innerHeight - popover.offsetHeight) / 2) }px`;
			return;
		}
		const beside = popover.classList.contains('toolmenu');
		const left = Math.max(8, Math.min(beside ? rect.right + 6 : rect.left, window.innerWidth - popover.offsetWidth - 8));
		const top = Math.min(beside ? rect.top : rect.bottom + 6, window.innerHeight - popover.offsetHeight - 8);
		popover.style.left = `${ left }px`;
		popover.style.top = `${ Math.max(8, top) }px`;
	}

	// 차트 위의 클릭은 작도 도구가 전파를 막으므로 캡처 단계에서 듣는다.
	document.addEventListener('mousedown', (event) => {
		if (!popover.hidden && !popover.contains(event.target)) closePopover();
	}, true);

	// ----- 설정 창에서 쓰는 입력 요소. onChange(값, 확정 여부) -----

	const field = (label, ...controls) => el('label', { class: 'field' }, el('span', { text: label }), ...controls);

	function listen(input, read, onChange) {
		input.addEventListener('input', () => onChange(read(), false));
		input.addEventListener('change', () => onChange(read(), true));
		return input;
	}

	function colorInput(value, onChange) {
		const input = el('input', { type: 'color', value });
		return listen(input, () => input.value, onChange);
	}

	function numberInput(value, limits, onChange) {
		const input = el('input', { type: 'number', value: String(value), step: String(limits.step ?? 1) });
		if (limits.min !== undefined) input.min = String(limits.min);
		if (limits.max !== undefined) input.max = String(limits.max);
		return listen(input, () => Number(input.value), onChange);
	}

	function selectInput(value, options, onChange) {
		const input = el('select', {}, ...options.map(([id, label]) => el('option', { value: String(id), text: label })));
		input.value = String(value);
		input.addEventListener('change', () => onChange(input.value, true));
		return input;
	}

	function checkInput(value, onChange) {
		const input = el('input', { type: 'checkbox' });
		input.checked = value;
		input.addEventListener('change', () => onChange(input.checked, true));
		return input;
	}

	const WIDTH_OPTIONS = [1, 2, 3, 4, 5].map(width => [width, `${ width }px`]);
	const DASH_OPTIONS = [['solid', '실선'], ['dashed', '파선'], ['dotted', '점선']];

	// ---------- 종목 검색 ----------

	const SEARCH_TABS = [['all', '전체'], ['crypto', '코인'], ['derivs', '선물'], ['stock', '주식'], ['fund', '펀드'], ['index', '지수'], ['fx', '환율']];
	const TYPE_LABELS = { crypto: '코인 현물', perp: '코인 선물', stock: '주식', fund: '펀드', index: '지수', fx: '환율', futures: '선물' };
	const COIN_KINDS = [['all', '현물+선물'], ['crypto', '현물'], ['perp', '무기한 선물']];
	const EXCHANGE_GROUPS = ['Binance', 'Upbit', 'Bithumb', 'Bybit', 'OKX'];
	const QUOTE_RANK = { USDT: 0, KRW: 0, USD: 1, USDC: 2, BTC: 3 };
	const POPULAR_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'SUI', 'DOT', 'LTC', 'BCH', 'SHIB', 'PEPE'];
	// 검색어 없이 열었을 때 보여 주는 종목.
	const DEFAULT_PICKS = [
		'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'UPBIT:KRW-BTC', 'UPBIT:KRW-ETH', 'BINANCEF:BTCUSDT',
		'YAHOO:005930.KS', 'YAHOO:000660.KS', 'YAHOO:AAPL', 'YAHOO:NVDA', 'YAHOO:TSLA',
		'YAHOO:^KS11', 'YAHOO:^KQ11', 'YAHOO:^GSPC', 'YAHOO:^IXIC', 'YAHOO:KRW=X', 'YAHOO:JPYKRW=X',
		'YAHOO:GC=F', 'YAHOO:CL=F', 'YAHOO:ES=F', 'YAHOO:NQ=F',
	];
	const SEARCH_PAGE = 100;

	/** 코인 탭은 현물과 무기한 선물을 함께 보여 주고 kind로 거른다. 무기한 선물은 선물 탭에도 나온다. */
	function inSearchTab(item, tab, kind) {
		if (tab === 'all') return true;
		if (tab === 'crypto') return kind === 'all' ? item.type === 'crypto' || item.type === 'perp' : item.type === kind;
		if (tab === 'derivs') return item.type === 'perp' || item.type === 'futures';
		return item.type === tab;
	}

	function toggleWatch(symbol) {
		if (state.watchlist.includes(symbol)) state.watchlist = state.watchlist.filter(id => id !== symbol);
		else state.watchlist.push(symbol);
		save();
		renderWatchlist();
		ticker.sync();
	}

	/** 종목 검색 창. 줄을 누르면 onPick으로 넘기고, 별을 누르면 창을 닫지 않고 관심종목에 넣거나 뺀다. */
	function openSymbolPicker(anchor, onPick, initial = '') {
		const input = el('input', { type: 'text', placeholder: '종목 검색 (예: BTC, 비트코인, 삼성전자, AAPL, 코스피, 달러)', spellcheck: 'false' });
		const tabs = el('div', { class: 'chips' });
		const exchanges = el('div', { class: 'chips' });
		const options = el('div', { class: 'options' });
		const providerOrder = new Map(PROV.list.map((provider, i) => [provider.id, i]));
		let tab = 'all';
		let kind = 'all';
		let group = 'all';
		let items = [...PROV.curated];
		let remote = [];
		let matches = [];
		let timer = 0;
		let shownKey = '';
		let pending = PROV.list.length;
		const total = el('p', { class: 'hint total' });

		const remember = (item) => {
			state.symbolMeta[item.id] = { display: item.display, name: item.name, type: item.type, exch: item.exch };
			if (item.base) state.symbolMeta[item.id].base = item.base;
		};
		const pick = (item) => {
			remember(item);
			save();
			closePopover();
			onPick(item.id);
		};
		const option = (item) => {
			const star = el('button', {
				class: `star${ state.watchlist.includes(item.id) ? ' on' : '' }`,
				title: '관심종목에 추가 / 제거',
				onclick: (event) => {
					event.stopPropagation();
					remember(item);
					toggleWatch(item.id);
					star.classList.toggle('on', state.watchlist.includes(item.id));
				},
			}, icon('star'));
			return el('div', { class: 'option sym-option', role: 'button', onclick: () => pick(item) },
				logo(item.id, item),
				el('b', { text: item.display }),
				el('span', { class: 'ind-desc', text: item.name }),
				el('span', { class: 'tag', text: TYPE_LABELS[item.type] ?? '' }),
				el('span', { class: 'badge', text: item.exch }),
				star);
		};

		/** 검색어와 얼마나 잘 맞는지. 맞지 않으면 null. */
		const score = (item, upper, lower) => {
			const display = item.display.toUpperCase().replace('.P', '');
			const base = (item.base ?? display).toUpperCase();
			const name = item.name.toLowerCase();
			let match;
			if (!upper) match = 0;
			else if (base === upper || display === upper || name === lower) match = 0;
			else if (base.startsWith(upper) || display.startsWith(upper) || name.startsWith(lower)) match = 1;
			else if (display.includes(upper) || name.includes(lower)) match = 2;
			else return null;
			const popular = item.base ? POPULAR_COINS.indexOf(base) : -1;
			return [
				match,
				popular < 0 ? POPULAR_COINS.length : popular,
				// 같은 이름이면 현물·주식을 무기한 선물보다 먼저 보여 준다.
				item.type === 'perp' ? 1 : 0,
				item.quote ? QUOTE_RANK[item.quote] ?? 4 : 0,
				providerOrder.get(item.provider) ?? 99,
				// 검색어가 없으면 목록에 넣어 둔 순서를 그대로 쓴다.
				upper ? item.display.length : 0,
			];
		};

		const renderChips = () => {
			tabs.replaceChildren(...SEARCH_TABS.map(([id, label]) => el('button', {
				class: `chip-btn${ id === tab ? ' on' : '' }`,
				text: label,
				onclick: () => {
					tab = id;
					if (!['all', 'crypto', 'derivs'].includes(tab)) group = 'all';
					render();
				},
			})));
			exchanges.hidden = !['all', 'crypto', 'derivs'].includes(tab);
			const chip = (label, on, onclick) => el('button', { class: `chip-btn small${ on ? ' on' : '' }`, text: label, onclick });
			exchanges.replaceChildren(
				...(tab === 'crypto' ? [...COIN_KINDS.map(([id, label]) => chip(label, id === kind, () => {
					kind = id;
					render();
				})), el('span', { class: 'chip-gap' })] : []),
				...[['all', '모든 거래소'], ...EXCHANGE_GROUPS.map(name => [name, name])].map(([id, label]) => chip(label, id === group, () => {
					group = id;
					render();
				})));
		};

		const render = () => {
			renderChips();
			const raw = input.value.trim();
			const upper = raw.toUpperCase().replace(/[\s/-]/g, '');
			const lower = raw.toLowerCase();
			// 검색어 없이 전체를 볼 때는 자주 찾는 종목을 맨 위에 둔다.
			const picks = !raw && tab === 'all' && group === 'all' ? DEFAULT_PICKS.map(id => ({ id, ...symbolInfo(id) })) : [];
			const seen = new Set(picks.map(item => item.id));
			const scored = [];
			for (const item of [...items, ...remote]) {
				if (seen.has(item.id) || !inSearchTab(item, tab, kind) || (group !== 'all' && item.group !== group)) continue;
				seen.add(item.id);
				const rank = score(item, upper, lower);
				if (rank) scored.push([rank, item]);
			}
			scored.sort(([a], [b]) => {
				for (let i = 0; i < a.length; i++) {
					if (a[i] !== b[i]) return a[i] - b[i];
				}
				return 0;
			});
			matches = picks.concat(scored.map(([, item]) => item));

			// 목록은 전부 담되, 화면에는 스크롤하는 만큼만 그린다. 조건이 그대로면 보던 위치를 지킨다.
			const key = `${ raw }|${ tab }|${ kind }|${ group }`;
			const keep = key === shownKey ? Math.max(SEARCH_PAGE, options.querySelectorAll('.sym-option').length) : SEARCH_PAGE;
			const top = key === shownKey ? options.scrollTop : 0;
			shownKey = key;
			options.replaceChildren();
			if (matches.length === 0) options.append(el('p', { class: 'hint', text: '일치하는 종목이 없습니다. 해외 주식은 영문 이름이나 티커로 찾아 보세요.' }));
			showMore(keep);
			options.scrollTop = top;
			const loading = pending > 0 ? ' · 거래소 목록을 받는 중…' : '';
			const limited = ['stock', 'fund', 'index', 'fx'].includes(tab) || tab === 'all' ? ' · 주식·펀드는 주요 종목만 목록에 있고, 나머지는 영문 이름이나 티커로 검색합니다.' : '';
			total.textContent = `${ matches.length.toLocaleString('ko-KR') }개${ loading }${ limited }`;
		};

		/** 아직 그리지 않은 결과를 count개 더 그린다. */
		const showMore = (count) => {
			const from = options.querySelectorAll('.sym-option').length;
			options.append(...matches.slice(from, from + count).map(option));
		};
		options.addEventListener('scroll', () => {
			if (options.scrollTop + options.clientHeight >= options.scrollHeight - 200) showMore(SEARCH_PAGE);
		});

		input.addEventListener('input', () => {
			render();
			clearTimeout(timer);
			const query = input.value.trim();
			// 주식·지수·환율은 미리 넣어 둔 목록 밖의 종목도 원격 검색으로 찾는다 (영문·숫자만).
			if (!query || !/^[\x20-\x7e]+$/.test(query)) return;
			timer = setTimeout(async() => {
				try {
					const found = await PROV.searchRemote(query);
					if (input.value.trim() !== query || !popover.contains(input)) return;
					remote = found;
					render();
				}
				catch {
					// 원격 검색이 실패해도 목록 검색은 계속 쓸 수 있다.
				}
			}, 300);
		});
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && matches[0]) pick(matches[0]);
		});

		popover.className = 'popover search';
		input.value = initial;
		render();
		openPopover(anchor, input, tabs, exchanges, total, options,
			el('p', { class: 'hint', text: '줄을 누르면 차트에 바로 띄웁니다. ☆는 관심종목에 넣거나 뺍니다. 차트 화면에서 글자를 치거나 / 를 눌러도 이 창이 열립니다.' }));
		input.focus();
		if (initial) input.dispatchEvent(new Event('input'));
		for (const provider of PROV.list) {
			PROV.catalog(provider).finally(() => {
				pending--;
				if (popover.contains(input)) render();
			});
			PROV.catalog(provider).then((list) => {
				if (list.length === 0 || !popover.contains(input)) return;
				items = items.concat(list);
				render();
			});
		}
	}

	// ---------- 실시간 시세 (관심종목, 종목 정보, 알림) ----------

	const ticker = {
		prices: new Map(),
		streams: new Map(),
		polls: new Map(),

		wanted() {
			const wanted = new Set(state.watchlist);
			for (const alert of state.alerts) {
				if (alert.active) wanted.add(alert.symbol);
			}
			const tab = activeTab();
			for (const pane of tab.panes.slice(0, tab.layout)) wanted.add(pane.symbol);
			return wanted;
		},

		/** 필요한 종목을 공급원별로 나눠, 스트림이 있으면 구독하고 없으면 주기적으로 받는다. */
		sync() {
			const byProvider = new Map();
			for (const id of this.wanted()) {
				const target = PROV.resolve(id);
				if (!target) continue;
				if (!byProvider.has(target.provider)) byProvider.set(target.provider, []);
				byProvider.get(target.provider).push(target.code);
			}
			for (const provider of PROV.list) {
				const codes = byProvider.get(provider) ?? [];
				if (provider.quoteStream) this.syncStream(provider, codes);
				else this.syncPoll(provider, codes);
			}
			refreshConnection();
		},

		syncStream(provider, codes) {
			let stream = this.streams.get(provider.id);
			if (!stream) {
				if (codes.length === 0) return;
				stream = { up: null, feed: null };
				this.streams.set(provider.id, stream);
				stream.feed = provider.quoteStream(
					(code, quote) => this.onQuote(`${ provider.id }:${ code }`, quote),
					(up) => {
						stream.up = up;
						refreshConnection();
					});
			}
			stream.feed.set(codes);
		},

		syncPoll(provider, codes) {
			let poll = this.polls.get(provider.id);
			if (!poll) {
				if (codes.length === 0) return;
				poll = { codes: [], busy: false };
				this.polls.set(provider.id, poll);
				setInterval(() => this.poll(provider, poll), provider.quoteMs);
			}
			const fresh = codes.some(code => !poll.codes.includes(code));
			poll.codes = codes;
			if (fresh) this.poll(provider, poll);
		},

		async poll(provider, poll) {
			if (poll.busy || poll.codes.length === 0 || document.hidden) return;
			poll.busy = true;
			try {
				for (const [code, quote] of await provider.quotes(poll.codes)) this.onQuote(`${ provider.id }:${ code }`, quote);
			}
			catch {
				// 다음 주기에 다시 시도한다.
			}
			finally {
				poll.busy = false;
			}
		},

		onQuote(id, quote) {
			this.prices.set(id, quote);
			updateWatchRow(id);
			if (id === activePane()?.cfg.symbol) renderDetail();
			checkAlerts(id, quote.price);
		},
	};

	function refreshConnection() {
		const down = [...ticker.streams.values()].some(stream => stream.up === false);
		const node = $('conn');
		node.className = `conn ${ down ? 'down' : 'up' }`;
		node.textContent = down ? '연결 끊김' : '실시간';
	}

	function renderDetail() {
		const symbol = activePane()?.cfg.symbol;
		const quote = symbol ? ticker.prices.get(symbol) : undefined;
		const info = symbol ? symbolInfo(symbol) : null;
		const head = $('detail-symbol');
		if (head.dataset.symbol !== symbol) {
			head.dataset.symbol = symbol ?? '';
			head.replaceChildren(...(symbol ? [logo(symbol), symbolTitle(symbol)] : []));
		}
		$('detail-sub').textContent = info ? `${ info.display } · ${ info.exch }${ PROV.resolve(symbol).provider.realtime ? '' : ' · 주기적 갱신' }` : '';
		$('detail-price').textContent = quote ? formatPrice(quote.price) : '–';
		$('detail-change').textContent = quote ? formatPercent(quote.change) : '';
		$('detail-change').className = `change ${ quote && quote.change < 0 ? 'down' : 'up' }`;
		$('detail-price').className = `price ${ quote && quote.change < 0 ? 'down' : 'up' }`;
		const optional = (value, format) => (quote && Number.isFinite(value) ? format(value) : '–');
		$('detail-high').textContent = optional(quote?.high, formatPrice);
		$('detail-low').textContent = optional(quote?.low, formatPrice);
		$('detail-turnover').textContent = optional(quote?.turnover, formatVolume);
	}

	// ---------- 관심종목 ----------

	const watchRows = new Map();

	function updateWatchRow(symbol) {
		const row = watchRows.get(symbol);
		const quote = ticker.prices.get(symbol);
		if (!row || !quote) return;
		row.price.textContent = formatPrice(quote.price);
		row.change.textContent = formatPercent(quote.change);
		row.change.className = quote.change >= 0 ? 'up' : 'down';
	}

	function renderWatchlist() {
		const list = $('watchlist');
		watchRows.clear();
		if (state.watchlist.length === 0) {
			list.replaceChildren(el('li', { class: 'empty', text: '＋ 버튼으로 종목을 추가하세요.' }));
			return;
		}
		list.replaceChildren(...state.watchlist.map((symbol) => {
			const price = el('span', { text: '–' });
			const change = el('span', { text: '' });
			const remove = el('button', {
				class: 'x',
				title: '삭제',
				text: '×',
				onclick: (event) => {
					event.stopPropagation();
					state.watchlist = state.watchlist.filter(s => s !== symbol);
					save();
					renderWatchlist();
					ticker.sync();
				},
			});
			watchRows.set(symbol, { price, change });
			return el('li', { class: 'row clickable', onclick: () => setSymbol(activePane(), symbol) },
				el('span', { class: 'sym' }, logo(symbol), symbolTitle(symbol), el('small', { text: symbolInfo(symbol).exch })), price, change, remove);
		}));
		state.watchlist.forEach(updateWatchRow);
	}

	// ---------- 알림 ----------

	function addAlert(symbol, price, lastPrice) {
		state.alerts.push({
			id: uid(),
			kind: 'price',
			symbol,
			price,
			direction: price >= lastPrice ? 'above' : 'below',
			active: true,
			triggeredAt: null,
			createdAt: Date.now(),
		});
		alertsChanged();
	}

	function addCondAlert(symbol, interval, cond, repeat) {
		state.alerts.push({ id: uid(), kind: 'cond', symbol, interval, cond, repeat, active: true, triggeredAt: null, createdAt: Date.now(), checked: null });
		alertsChanged();
		checkCondAlerts();
	}

	function addDrawingAlert(symbol, drawingId, op) {
		state.alerts.push({ id: uid(), kind: 'drawing', symbol, drawingId, op, active: true, triggeredAt: null, createdAt: Date.now() });
		alertsChanged();
	}

	// 가격이 닿는지 볼 수 있는 작도: 수평선, 수평 레이, 추세선 종류.
	const ALERTABLE_DRAWINGS = new Set(['hline', 'hray', 'line']);
	const findDrawing = (symbol, id) => drawingsFor(symbol).find(drawing => drawing.id === id);

	/** 작도의 그 시각(차트 시간) 가격. 선이 그 시각에 닿지 않으면 null. */
	function drawingLevel(drawing, time) {
		const [a, b] = drawing.points;
		if (drawing.type === 'hline') return a.p;
		if (drawing.type === 'hray') return drawing.style.direction === 'left' ? (time <= a.t ? a.p : null) : (time >= a.t ? a.p : null);
		if (drawing.type !== 'line' || !b || a.t === b.t) return null;
		const [left, right] = a.t < b.t ? [a, b] : [b, a];
		const extend = drawing.style.extend ?? 'none';
		if (time < left.t && extend !== 'both' && extend !== 'left') return null;
		if (time > right.t && extend === 'none') return null;
		return left.p + (right.p - left.p) * (time - left.t) / (right.t - left.t);
	}

	function drawingAlertText(alert) {
		const drawing = findDrawing(alert.symbol, alert.drawingId);
		const name = drawing ? DRAW.byId.get(drawing.tool).name : '지워진 작도';
		return `${ name } ${ { cross: '돌파', crossUp: '상향 돌파', crossDown: '하향 돌파' }[alert.op] }`;
	}

	function alertText(alert) {
		if (alert.kind === 'cond') return `${ intervalLabel(alert.interval) }봉 · ${ RULES.describe(alert.cond) }`;
		if (alert.kind === 'drawing') return drawingAlertText(alert);
		return `${ formatPrice(alert.price) } ${ alert.direction === 'above' ? '이상' : '이하' }`;
	}

	function alertsChanged() {
		save();
		renderAlerts();
		ticker.sync();
		panes.forEach(pane => pane.syncPriceLines());
	}

	// 작도 돌파는 직전 시세와 지금 시세 사이에 선이 있는지로 본다.
	const previousPrices = new Map();

	function checkAlerts(symbol, price) {
		let fired = false;
		const previous = previousPrices.get(symbol);
		previousPrices.set(symbol, price);
		const now = Date.now() / 1000 + TZ_OFFSET;
		for (const alert of state.alerts) {
			if (!alert.active || alert.symbol !== symbol) continue;
			if (alert.kind === 'price' && (alert.direction === 'above' ? price >= alert.price : price <= alert.price)) {
				fire(alert, `${ formatPrice(alert.price) } ${ alert.direction === 'above' ? '이상' : '이하' } 도달 (현재 ${ formatPrice(price) })`);
				fired = true;
			}
			if (alert.kind === 'drawing' && previous !== undefined) {
				const drawing = findDrawing(symbol, alert.drawingId);
				const level = drawing ? drawingLevel(drawing, now) : null;
				if (level === null) continue;
				const up = previous < level && price >= level;
				const down = previous > level && price <= level;
				if ((alert.op !== 'crossDown' && up) || (alert.op !== 'crossUp' && down)) {
					fire(alert, `${ drawingAlertText(alert) } · ${ up ? '위로' : '아래로' } ${ formatPrice(level) } (현재 ${ formatPrice(price) })`);
					fired = true;
				}
			}
		}
		if (fired) alertsChanged();
	}

	function fire(alert, detail) {
		alert.triggeredAt = Date.now();
		if (!alert.repeat) alert.active = false;
		announceAlert(`${ symbolTitle(alert.symbol) } ${ detail }`);
	}

	// 지표 조건 알림: 봉이 마감된 뒤 그 주기의 봉을 받아 조건을 계산한다. 다음 봉이 마감될 때까지는 다시 받지 않는다.
	const nextCondCheck = new Map();
	let checkingConds = false;

	async function checkCondAlerts() {
		if (checkingConds) return;
		checkingConds = true;
		let changed = false;
		try {
			const groups = new Map();
			for (const alert of state.alerts) {
				if (!alert.active || alert.kind !== 'cond') continue;
				const key = `${ alert.symbol }|${ alert.interval }`;
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push(alert);
			}
			for (const [key, alerts] of groups) {
				const now = Date.now() / 1000 + TZ_OFFSET;
				if ((nextCondCheck.get(key) ?? 0) > now) continue;
				const { symbol, interval } = alerts[0];
				const seconds = INTERVAL_SECONDS[interval];
				let bars;
				try {
					bars = (await loadBars(symbol, interval)).bars;
				}
				catch {
					nextCondCheck.set(key, now + 60);
					continue;
				}
				if (bars.length < 3) continue;
				const last = bars[bars.length - 1];
				// 아직 진행 중인 봉은 빼고, 마감된 봉으로만 판단한다.
				const closed = last.time + seconds > now ? bars.slice(0, -1) : bars;
				nextCondCheck.set(key, (last.time + seconds > now ? last.time + seconds : now + seconds) + 3);
				const run = RULES.evaluator(closed, { tzOffset: TZ_OFFSET, symbol, interval, info: symbolInfo(symbol) });
				const index = closed.length - 1;
				const barTime = closed[index].time;
				for (const alert of alerts) {
					if (alert.checked === barTime) continue;
					alert.checked = barTime;
					changed = true;
					// 알림을 만들기 전에 마감된 봉에서는 울리지 않는다.
					const closedAt = (barTime + seconds - TZ_OFFSET) * 1000;
					if (closedAt <= alert.createdAt) continue;
					if (run.truth(alert.cond)[index]) fire(alert, `${ intervalLabel(interval) }봉 · ${ RULES.describe(alert.cond) } (종가 ${ formatPrice(closed[index].close) })`);
				}
			}
		}
		finally {
			checkingConds = false;
		}
		if (changed) alertsChanged();
	}

	function announceAlert(message) {
		toast(`🔔 ${ message }`);
		if ('Notification' in window && Notification.permission === 'granted') {
			new Notification('ChartDesk 알림', { body: message });
		}
		try {
			const audio = new AudioContext();
			const oscillator = audio.createOscillator();
			const gain = audio.createGain();
			oscillator.frequency.value = 880;
			gain.gain.setValueAtTime(0.15, audio.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.4);
			oscillator.connect(gain).connect(audio.destination);
			oscillator.start();
			oscillator.stop(audio.currentTime + 0.4);
			oscillator.onended = () => audio.close();
		}
		catch {
			// 소리는 부가 기능이다.
		}
	}

	function renderAlerts() {
		const list = $('alerts');
		if (state.alerts.length === 0) {
			list.replaceChildren(el('li', { class: 'empty', text: '차트 상단의 알림 버튼으로 가격, 지표 조건, 작도 돌파 알림을 만드세요.' }));
			return;
		}
		const ordered = [...state.alerts].sort((a, b) => Number(b.active) - Number(a.active));
		list.replaceChildren(...ordered.map((alert) => {
			const waiting = alert.kind === 'price' ? (alert.direction === 'above' ? '이상 대기' : '이하 대기') : '대기';
			const status = alert.active
				? `${ waiting }${ alert.repeat && alert.triggeredAt ? ` · 최근 ${ new Date(alert.triggeredAt).toLocaleTimeString('ko-KR') }` : '' }`
				: `도달 ${ new Date(alert.triggeredAt).toLocaleTimeString('ko-KR') }`;
			const remove = el('button', {
				class: 'x',
				title: '삭제',
				text: '×',
				onclick: () => {
					state.alerts = state.alerts.filter(a => a.id !== alert.id);
					alertsChanged();
				},
			});
			return el('li', { class: `row${ alert.active ? '' : ' done' }` },
				el('span', { class: 'sym', text: symbolTitle(alert.symbol) }),
				el('span', { class: 'alert-what', text: alertText(alert), title: alertText(alert) }),
				el('span', { class: 'sub', text: status }),
				remove);
		}));
	}

	/** 알림 만들기: 가격, 지표 조건, 작도 돌파. tab과 drawingId로 처음 열 쪽을 정한다. */
	function openAlertEditor(anchor, pane, tab = 'price', drawingId = null) {
		const last = pane.lastPrice();
		if (last === undefined) return;
		const symbol = pane.cfg.symbol;
		const tabs = [['price', '가격'], ['cond', '지표 조건'], ['drawing', '작도 돌파']];
		const nav = el('div', { class: 'seg alert-tabs' });
		const body = el('div', { class: 'alert-body' });
		const note = el('p', { class: 'hint', text: '앱(브라우저 탭)이 켜져 있는 동안 확인합니다.' });

		const priceView = () => {
			const input = el('input', { type: 'number', step: 'any', min: '0', value: String(last) });
			const submit = () => {
				const price = Number(input.value);
				if (!Number.isFinite(price) || price <= 0) return;
				closePopover();
				addAlert(symbol, price, last);
			};
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') submit();
			});
			body.replaceChildren(input,
				el('p', { class: 'hint', text: `${ symbolTitle(symbol) } 가격이 이 값에 닿으면 알립니다.` }),
				el('div', { class: 'actions' }, el('button', { class: 'primary', text: '알림 추가', onclick: submit })));
			input.focus();
			input.select();
		};

		const condView = () => {
			const LAB = window.ChartDeskLab;
			// 차트에 올린 지표가 있으면 그 지표로 시작한다.
			const onChart = state.indicators.map(item => IND.byId.get(item.type)).find(def => RULES.usable(def) && def.id !== 'volume');
			const start = onChart
				? { kind: 'compare', left: { kind: 'ind', type: onChart.id, params: state.indicators.find(item => item.type === onChart.id).params }, op: 'crossUp', right: { kind: 'value', value: onChart.id === 'rsi' ? 30 : 0 } }
				: { kind: 'compare', left: { kind: 'ind', type: 'rsi' }, op: 'crossUp', right: { kind: 'value', value: 30 } };
			if (onChart && onChart.overlay && onChart.fmt !== 'osc') start.right = { kind: 'price', field: 'close' };
			const editor = LAB.condEditor(RULES.cleanCond(start));
			const repeat = checkInput(false, () => {});
			body.replaceChildren(
				editor.node,
				field(`${ intervalLabel(pane.cfg.interval) }봉 마감 때마다 반복`, repeat),
				el('p', { class: 'hint', text: `${ symbolTitle(symbol) } ${ intervalLabel(pane.cfg.interval) }봉이 마감될 때 조건을 확인합니다. 반복을 끄면 한 번 울리고 꺼집니다.` }),
				el('div', { class: 'actions' }, el('button', {
					class: 'primary',
					text: '알림 추가',
					onclick: () => {
						const cond = RULES.cleanCond(editor.value());
						if (!cond) return;
						closePopover();
						addCondAlert(symbol, pane.cfg.interval, cond, repeat.checked);
						toast(`알림을 만들었습니다: ${ RULES.describe(cond) }`);
					},
				})));
		};

		const drawingView = () => {
			const lines = drawingsFor(symbol).filter(drawing => ALERTABLE_DRAWINGS.has(drawing.type));
			if (lines.length === 0) {
				body.replaceChildren(el('p', { class: 'hint', text: '수평선, 수평 레이, 추세선(레이·연장선 포함)을 먼저 그리세요. 가격이 그 선을 넘으면 알립니다.' }));
				return;
			}
			const now = Date.now() / 1000 + TZ_OFFSET;
			const options = lines.map((drawing, i) => {
				const level = drawingLevel(drawing, now);
				return [drawing.id, `${ i + 1 }. ${ DRAW.byId.get(drawing.tool).name }${ level === null ? ' (지금 시각에 닿지 않음)' : ` · 지금 ${ formatPrice(level, pane.precision) }` }`];
			});
			const picked = lines.some(drawing => drawing.id === drawingId) ? drawingId : pane.layer.selectedId && lines.some(drawing => drawing.id === pane.layer.selectedId) ? pane.layer.selectedId : lines[lines.length - 1].id;
			const which = selectInput(picked, options, () => {});
			const op = selectInput('cross', [['cross', '돌파 (위·아래 모두)'], ['crossUp', '상향 돌파'], ['crossDown', '하향 돌파']], () => {});
			body.replaceChildren(
				field('선', which),
				field('조건', op),
				el('p', { class: 'hint', text: '추세선은 지금 시각의 선 위치를 따라갑니다. 선을 옮기면 알림도 옮긴 위치로 확인합니다.' }),
				el('div', { class: 'actions' }, el('button', {
					class: 'primary',
					text: '알림 추가',
					onclick: () => {
						closePopover();
						addDrawingAlert(symbol, which.value, op.value);
					},
				})));
		};

		const show = (id) => {
			tab = id;
			nav.replaceChildren(...tabs.map(([key, label]) => el('button', { class: key === id ? 'on' : '', text: label, onclick: () => show(key) })));
			({ price: priceView, cond: condView, drawing: drawingView })[id]();
		};
		popover.className = 'popover alert-editor';
		openPopover(anchor, el('p', { class: 'title', text: `${ symbolTitle(symbol) } 알림` }), nav, body, note);
		show(tab);
	}

	// ---------- 지표 검색과 설정 ----------

	const INDICATOR_SECTIONS = [['favorite', '즐겨찾기'], ['personal', '개인 지표'], ['tech', '기술적 지표'], ['custom', '커스텀 지표']];

	/** 지표 창. 왼쪽에서 즐겨찾기·기술적 지표·커스텀 지표를 고르고, 오른쪽 목록에서 눌러 추가한다. */
	/** 지표의 설명과 사용법. */
	function indicatorHelp(def) {
		const box = el('div', { class: 'ind-help' });
		if (!def.help) {
			box.append(el('p', { text: '설명이 아직 없습니다.' }));
			return box;
		}
		box.append(
			el('p', { class: 'ind-help-what', text: def.help.what }),
			el('div', { class: 'category', text: '보는 방법' }),
			el('ul', {}, ...def.help.use.map(text => el('li', { text }))));
		if (def.params.length) box.append(el('p', { class: 'hint', text: `입력값(기본): ${ def.params.map(param => `${ param.label } ${ param.def }`).join(' · ') }` }));
		if (def.group === 'custom') box.append(el('p', { class: 'hint', text: `알린 사람: ${ def.by }. 공개된 계산식을 다시 구현한 것이라 원본과 값이 조금 다를 수 있습니다.` }));
		box.append(el('p', { class: 'hint', text: '지표는 판단을 돕는 참고 자료입니다. 하나만 보고 매매하지 말고 추세, 거래량, 다른 지표와 함께 확인하세요.' }));
		return box;
	}

	function openIndicatorHelp(anchor, def) {
		popover.className = 'popover help';
		openPopover(anchor, el('p', { class: 'title', text: `${ def.short } · ${ def.ko }` }), indicatorHelp(def));
	}

	function openIndicatorPicker(anchor, pane) {
		const input = el('input', { type: 'text', placeholder: '지표 검색 (예: RSI, 볼린저, 이동평균, squeeze)', spellcheck: 'false' });
		const nav = el('div', { class: 'ind-nav' });
		const options = el('div', { class: 'options' });
		const normalize = text => text.toLowerCase().replace(/\s+/g, '');
		const searchText = new Map(IND.defs.map(def =>
			[def.id, normalize(`${ def.short } ${ def.name } ${ def.ko } ${ def.tags } ${ def.id } ${ def.by ?? '' }`)]));
		let section = state.favoriteIndicators.length ? 'favorite' : 'tech';
		let matches = [];
		let explained = null;

		const add = (def) => {
			pane.addIndicator(def.id);
			render();
		};
		const option = (def) => {
			const count = state.indicators.filter(item => item.type === def.id).length;
			const star = el('button', {
				class: `star${ state.favoriteIndicators.includes(def.id) ? ' on' : '' }`,
				title: '즐겨찾기에 추가 / 제거',
				onclick: (event) => {
					event.stopPropagation();
					state.favoriteIndicators = state.favoriteIndicators.includes(def.id)
						? state.favoriteIndicators.filter(id => id !== def.id)
						: [...state.favoriteIndicators, def.id];
					save();
					render();
				},
			}, icon('star'));
			const about = el('button', {
				class: `ind-btn about${ explained === def.id ? ' on' : '' }`,
				title: '설명과 사용법',
				onclick: (event) => {
					event.stopPropagation();
					explained = explained === def.id ? null : def.id;
					render();
				},
			}, icon('help'));
			const row = el('div', { class: 'option ind-option', role: 'button', 'data-indicator': def.id, onclick: () => add(def) },
				star,
				el('b', { text: def.short }),
				el('span', { class: 'ind-desc', text: `${ def.ko } · ${ def.name }${ def.by ? ` · ${ def.by }` : '' }` }),
				el('span', { class: 'ind-count', text: count ? `사용 중 ${ count }` : '' }),
				about);
			return explained === def.id ? [row, indicatorHelp(def)] : [row];
		};
		const inSection = def => (section === 'favorite' ? state.favoriteIndicators.includes(def.id) : def.group === section);
		const render = () => {
			nav.replaceChildren(...INDICATOR_SECTIONS.map(([id, label]) => {
				const size = id === 'favorite' ? state.favoriteIndicators.length : IND.defs.filter(def => def.group === id).length;
				return el('button', {
					class: `ind-nav-btn${ id === section ? ' on' : '' }`,
					'data-section': id,
					onclick: () => {
						section = id;
						render();
					},
				}, el('span', { text: label }), el('small', { text: String(size) }));
			}));
			const query = normalize(input.value);
			// 검색어가 있으면 고른 구역과 상관없이 전체에서 찾는다.
			matches = IND.defs.filter(def => (query ? searchText.get(def.id).includes(query) : inSection(def)));
			if (matches.length === 0) {
				options.replaceChildren(el('p', { class: 'hint', text: query ? '일치하는 지표가 없습니다.'
					: section === 'favorite' ? '아직 즐겨찾기가 없습니다. 지표 이름 앞의 ☆를 누르면 여기에 모입니다.' : '지표가 없습니다.' }));
				return;
			}
			if (query) {
				// 약칭이 검색어로 시작하는 지표를 먼저 보여 준다.
				const leads = def => Number(normalize(def.short).startsWith(query) || def.id.startsWith(query));
				matches.sort((a, b) => leads(b) - leads(a));
				options.replaceChildren(...matches.flatMap(option));
				return;
			}
			if (section === 'personal') {
				options.replaceChildren(el('p', { class: 'hint', text: '이 프로그램에서 직접 만든 지표입니다.' }), ...matches.flatMap(option));
				return;
			}
			if (section === 'custom') {
				options.replaceChildren(
					el('p', { class: 'hint', text: 'TradingView 커뮤니티에서 널리 쓰이는 공개 지표의 계산식을 다시 구현한 것입니다. 이름 뒤에 그 지표를 알린 사람을 적었습니다. 원본과 값이 조금 다를 수 있습니다.' }),
					...matches.flatMap(option));
				return;
			}
			options.replaceChildren(...INDICATOR_CATEGORIES.flatMap((category) => {
				const rows = matches.filter(def => def.cat === category);
				return rows.length ? [el('div', { class: 'category', text: category }), ...rows.flatMap(option)] : [];
			}));
		};

		input.addEventListener('input', render);
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && input.value.trim() && matches[0]) add(matches[0]);
		});
		popover.className = 'popover indicators';
		render();
		openPopover(anchor, el('p', { class: 'title', text: '지표' }), input, el('div', { class: 'ind-layout' }, nav, options));
		input.focus();
	}

	/** 지표는 모든 차트가 함께 쓴다. 바뀌면 저장하고 열려 있는 차트를 모두 다시 그린다. */
	function indicatorsChanged() {
		save();
		panes.forEach(pane => pane.buildIndicators());
	}

	function openIndicatorSettings(anchor, pane, id) {
		const item = state.indicators.find(candidate => candidate.id === id);
		if (!item) return;
		const def = IND.byId.get(item.type);
		const rows = [el('p', { class: 'title', text: `${ def.short } · ${ def.ko }` })];

		if (def.params.length) rows.push(el('div', { class: 'category', text: '입력값' }));
		for (const param of def.params) {
			rows.push(field(param.label, numberInput(item.params[param.k], param, (value, commit) => {
				if (commit) pane.updateIndicator(id, { ...item.params, [param.k]: value });
			})));
		}

		if (frameable(def)) {
			rows.push(el('div', { class: 'category', text: '기준 주기' }),
				field('계산할 봉', selectInput(item.tf ?? '', [['', '차트와 같은 주기'], ...INTERVALS], (value) => {
					if (value) item.tf = value;
					else delete item.tf;
					indicatorsChanged();
				})),
				el('p', { class: 'hint', text: '차트보다 긴 주기를 고르면 그 주기의 봉으로 계산해 얹습니다(예: 1시간 차트에 4시간 RSI). 차트 주기가 같거나 더 길면 차트 봉으로 계산합니다.' }));
		}

		const styled = def.plots.filter(plot => plot.type !== 'hist');
		if (styled.length) rows.push(el('div', { class: 'category', text: '스타일' }));
		for (const plot of styled) {
			const current = pane.styleOf(item, plot);
			const set = key => (value) => {
				item.style[plot.k] = { ...item.style[plot.k], [key]: value };
				save();
				panes.forEach(each => each.restyleIndicators());
			};
			const controls = [checkInput(!item.style[plot.k]?.hidden, visible => set('hidden')(!visible))];
			if (!plot.fixedColor) controls.push(colorInput(current.color, set('color')));
			if (plot.type === 'line') controls.push(selectInput(current.width, WIDTH_OPTIONS, value => set('width')(Number(value))));
			rows.push(el('div', { class: 'field style-row' }, el('span', { text: plot.label }), ...controls));
		}

		if (def.overlay && def.scale !== 'bottom') {
			rows.push(field('가격 축에 값 표시', checkInput(item.axisLabel ?? def.axisLabel === true, (on) => {
				item.axisLabel = on;
				indicatorsChanged();
			})));
		}

		if (def.levels) {
			const input = el('input', { type: 'text', value: (item.levels ?? def.levels).join(', ') });
			input.addEventListener('change', () => {
				item.levels = input.value.split(',').map(part => Number(part.trim())).filter(Number.isFinite);
				indicatorsChanged();
			});
			rows.push(el('div', { class: 'category', text: '기준선' }), field('값 (쉼표로 구분)', input));
		}

		rows.push(el('div', { class: 'actions' }, el('button', {
			class: 'text-btn',
			text: '설명과 사용법',
			onclick: () => openIndicatorHelp(anchor.isConnected ? anchor : pane.body, def),
		}), el('button', {
			class: 'text-btn',
			text: '기본값으로',
			onclick: () => {
				item.params = sanitizeParams(def, {});
				item.style = {};
				delete item.levels;
				delete item.tf;
				delete item.axisLabel;
				indicatorsChanged();
				// 지표 줄을 다시 만들었으므로 설정 창은 차트에 붙여 다시 연다.
				openIndicatorSettings(anchor.isConnected ? anchor : pane.body, pane, id);
			},
		})));
		popover.className = 'popover settings';
		openPopover(anchor, ...rows);
	}

	// ---------- 작도 ----------

	let activeTool = null;
	const history = { past: [], future: [], current: JSON.stringify(state.drawings) };

	const drawingsFor = symbol => (state.drawings[symbol] ??= []);

	/** commit이 참이면 저장하고 되돌리기 기록에 남긴다. 끌어 옮기는 도중에는 거짓으로 부른다. */
	function drawingsChanged(commit) {
		if (commit) {
			const next = JSON.stringify(state.drawings);
			if (next !== history.current) {
				history.past.push(history.current);
				if (history.past.length > 100) history.past.shift();
				history.future = [];
				history.current = next;
			}
			save();
			refreshTools();
		}
		panes.forEach(pane => pane.layer.redraw());
	}

	function travel(from, to) {
		if (from.length === 0) return;
		to.push(history.current);
		history.current = from.pop();
		state.drawings = JSON.parse(history.current);
		closePopover();
		panes.forEach(pane => pane.layer.select(null));
		save();
		refreshTools();
		panes.forEach(pane => pane.layer.redraw());
	}

	function setTool(id) {
		activeTool = id;
		if (groupOfTool.has(id) && state.toolPicks[groupOfTool.get(id)] !== id) {
			state.toolPicks[groupOfTool.get(id)] = id;
			save();
		}
		panes.forEach((pane) => {
			pane.layer.cancel();
			pane.body.classList.toggle('drawing', id !== null);
		});
		refreshTools();
	}

	function removeSelectedDrawing() {
		for (const pane of panes) {
			const drawing = pane.layer.selected();
			if (!drawing) continue;
			const list = drawingsFor(pane.cfg.symbol);
			list.splice(list.indexOf(drawing), 1);
			closePopover();
			pane.layer.select(null);
			drawingsChanged(true);
			return true;
		}
		return false;
	}

	function rememberDrawingStyle(drawing) {
		// 글, 이미지, 담아 둔 봉 모양은 그 작도만의 내용이라 기본값으로 남기지 않는다.
		const { text, image, ratio, pattern, ...style } = drawing.style;
		state.drawingDefaults[drawing.tool] = structuredClone(style);
	}

	/** 고른 이미지 파일을 작게 줄여 작도에 담는다. 저장 공간이 작아서 긴 변을 480px로 제한한다. */
	function imageField(style, apply) {
		const input = el('input', { type: 'file', accept: 'image/*' });
		input.addEventListener('change', async() => {
			const file = input.files?.[0];
			if (!file) return;
			try {
				const bitmap = await createImageBitmap(file);
				const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
				const canvas = el('canvas', { width: String(Math.round(bitmap.width * scale)), height: String(Math.round(bitmap.height * scale)) });
				canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
				style.image = canvas.toDataURL('image/webp', 0.85);
				style.ratio = canvas.height / canvas.width;
				apply(true);
			}
			catch {
				toast('이미지를 읽지 못했습니다.');
			}
		});
		return [
			field('이미지 파일', input),
			field('너비 (px)', numberInput(style.imageWidth, { min: 20, max: 1200, step: 10 }, (value, commit) => {
				if (!(value >= 20 && value <= 1200)) return;
				style.imageWidth = value;
				apply(commit);
			})),
		];
	}

	function levelsEditor(style, apply, toolId) {
		const box = el('div', { class: 'levels' });
		const render = () => {
			box.replaceChildren(
				el('div', { class: 'category', text: '레벨' }),
				...style.levels.map((level, i) => el('div', { class: 'level-row' },
					checkInput(level.on, (on) => {
						level.on = on;
						apply(true);
					}),
					numberInput(level.value, { step: 0.001 }, (value, commit) => {
						if (!Number.isFinite(value)) return;
						level.value = value;
						apply(commit);
					}),
					colorInput(level.color, (color, commit) => {
						level.color = color;
						apply(commit);
					}),
					el('button', {
						class: 'ind-btn',
						title: '레벨 삭제',
						text: '×',
						onclick: () => {
							style.levels.splice(i, 1);
							apply(true);
							render();
						},
					}))),
				el('div', { class: 'actions' },
					el('button', {
						class: 'text-btn',
						text: '기본 레벨',
						onclick: () => {
							style.levels = DRAW.levelsFor(toolId);
							apply(true);
							render();
						},
					}),
					el('button', {
						class: 'text-btn',
						text: '＋ 레벨 추가',
						onclick: () => {
							style.levels.push({ value: 2.618, color: '#787b86', on: true });
							apply(true);
							render();
						},
					})));
		};
		render();
		return box;
	}

	function openDrawingSettings(pane, drawing) {
		const tool = DRAW.byId.get(drawing.tool);
		const style = drawing.style;
		const apply = (commit) => {
			rememberDrawingStyle(drawing);
			drawingsChanged(commit);
			if (commit) pane.showDrawingBar(drawing);
		};
		const set = (key, convert = value => value) => (value, commit) => {
			style[key] = convert(value);
			apply(commit);
		};
		const rows = [el('p', { class: 'title', text: tool.name })];
		for (const key of DRAW.fieldsOf(drawing)) {
			if (key === 'color') rows.push(field('색', colorInput(style.color, set('color'))));
			else if (key === 'width') rows.push(field('굵기', selectInput(style.width, WIDTH_OPTIONS, set('width', Number))));
			else if (key === 'dash') rows.push(field('선 종류', selectInput(style.dash, DASH_OPTIONS, set('dash'))));
			else if (key === 'extend') rows.push(field('연장', selectInput(style.extend, [['none', '없음'], ['left', '왼쪽'], ['right', '오른쪽'], ['both', '양쪽']], set('extend'))));
			else if (key === 'direction') rows.push(field('방향', selectInput(style.direction, [['right', '오른쪽'], ['left', '왼쪽']], set('direction'))));
			else if (key === 'extendLeft') rows.push(field('왼쪽으로 연장', checkInput(style.extendLeft, set('extendLeft'))));
			else if (key === 'fill') {
				const input = el('input', { type: 'range', min: '0', max: '0.5', step: '0.01', value: String(style.fill) });
				rows.push(field('채우기 농도', listen(input, () => Number(input.value), set('fill'))));
			}
			else if (key === 'extendRight') rows.push(field('오른쪽으로 연장', checkInput(style.extendRight, set('extendRight'))));
			else if (key === 'showPrices') rows.push(field('가격 표시', checkInput(style.showPrices, set('showPrices'))));
			else if (key === 'size') {
				rows.push(field('글자 크기', numberInput(style.size, { min: 8, max: 72 }, (value, commit) => {
					if (value >= 8 && value <= 72) set('size')(value, commit);
				})));
			}
			else if (key === 'text') {
				const input = el('textarea', { rows: '3', spellcheck: 'false' });
				input.value = style.text;
				rows.push(listen(input, () => input.value, set('text')));
			}
			else if (key === 'levels') rows.push(levelsEditor(style, apply, drawing.tool));
			else if (key === 'image') rows.push(...imageField(style, apply));
			else if (key === 'dev') {
				rows.push(field('표준편차 배수', numberInput(style.dev, { min: 0.5, max: 5, step: 0.5 }, (value, commit) => {
					if (value >= 0.5 && value <= 5) set('dev')(value, commit);
				})));
			}
		}
		if (rows.length === 1) rows.push(el('p', { class: 'hint', text: '이 도구는 바꿀 수 있는 설정이 없습니다.' }));
		popover.className = 'popover settings';
		openPopover(pane.drawBar.hidden ? pane.body : pane.drawBar, ...rows);
		const input = popover.querySelector('textarea');
		if (tool.edit && input) {
			input.focus();
			input.select();
		}
	}

	// ---------- 차트 패널 ----------

	let panes = [];
	const activePane = () => panes[activeTab().active] ?? panes[0];

	class Pane {
		constructor(tab, index, host) {
			this.tab = tab;
			this.index = index;
			this.cfg = tab.panes[index];
			this.bars = [];
			this.inds = [];
			this.precision = 2;
			this.token = 0;
			this.socket = null;
			this.main = null;
			this.priceLines = [];
			this.pendingRange = null;
			this.hovered = false;
			this.dead = false;
			this.loadingMore = false;
			this.noMore = false;
			// 비교 종목: { symbol, color, series, bars, row, value, timer }
			this.compares = [];
			// 바 리플레이: { all, index, timer, speed }
			this.replay = null;
			this.picking = false;
			this.markers = null;

			this.buildDom(host);
			this.chart = LC.createChart(this.chartHost, {
				autoSize: true,
				crosshair: { mode: LC.CrosshairMode.Normal },
				timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 6 },
				localization: { locale: 'ko-KR' },
			});
			this.layer = new DRAW.Layer({
				chart: this.chart,
				body: this.body,
				surface: this.chartHost,
				tzOffset: TZ_OFFSET,
				series: () => this.main,
				bars: () => this.bars,
				list: () => drawingsFor(this.cfg.symbol),
				tool: () => (activeTool ? DRAW.byId.get(activeTool) : null),
				toolDone: () => setTool(null),
				magnet: () => state.magnet,
				hidden: () => state.hideDrawings,
				defaults: id => DRAW.defaultStyle(id, state.drawingDefaults[id]),
				changed: commit => drawingsChanged(commit),
				selected: (drawing) => {
					this.showDrawingBar(drawing);
					if (drawing) panes.forEach(other => other !== this && other.layer.selectedId && other.layer.select(null));
				},
				openSettings: drawing => openDrawingSettings(this, drawing),
				startTool: id => setTool(id),
				zoom: box => this.zoomTo(box),
				activate: () => setActivePane(this.index),
				formatPrice: price => formatPrice(price, this.precision),
				fontFamily: () => cssColors().font,
				textColor: () => cssColors().text,
				countdown: () => this.countdown(),
				palette: () => {
					const colors = cssColors();
					return { text: colors.text, up: colors.up, down: colors.down };
				},
				// 선으로 그릴 수 없는 지표(매물대 등)가 가격 차트 위에 직접 그리는 부분.
				overlays: () => this.inds
					.filter(ind => ind.def.draw && ind.out?.$draw && !ind.cfg.hidden)
					.map(ind => ({ draw: (context, view) => ind.def.draw(context, view, ind.out.$draw, ind.cfg.params) })),
			});
			this.body.classList.toggle('drawing', activeTool !== null);

			this.chart.subscribeCrosshairMove((param) => {
				const index = param.time === undefined ? -1 : barIndexAt(this.bars, param.time);
				this.updateLegend(index >= 0 && this.bars[index].time === param.time ? index : undefined);
				if (this.hovered && state.crosshairSync) broadcastCrosshair(this, param.time);
				this.movePlus(param);
			});
			this.chart.subscribeClick(param => this.onChartClick(param));
			this.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
				if (!range) return;
				if (range.from < 20) this.loadMore();
				this.liveButton.hidden = range.to >= this.bars.length - 1;
			});
			this.chartHost.addEventListener('wheel', event => this.handleAxisWheel(event), { capture: true, passive: false });
			this.resizeObserver = new ResizeObserver(() => {
				this.positionLegends();
				if (!this.replayBar.hidden) this.placeReplayBar();
			});
			// 패널 사이 경계를 끌면 이름표가 따라가고, 놓으면 높이를 저장한다.
			this.chartHost.addEventListener('pointerdown', () => this.followPaneDrag(), true);
			this.resizeObserver.observe(this.body);

			this.applyTheme();
			this.createMain();
			this.renderHead();
			this.buildIndicators();
			this.load();
		}

		buildDom(host) {
			this.symbolButton = el('button', {
				class: 'symbol-btn',
				title: '심볼 변경',
				onclick: () => openSymbolPicker(this.symbolButton, symbol => setSymbol(this, symbol)),
			});
			this.intervalButtons = MAIN_INTERVALS.map(id =>
				el('button', { text: intervalLabel(id), onclick: () => this.setInterval(id) }));
			this.moreIntervals = el('button', { class: 'more-int', title: '다른 주기' });
			this.moreIntervals.addEventListener('click', () => this.openIntervalMenu());
			this.typeButton = el('button', { class: 'chip', title: '차트 종류', 'data-action': 'type' }, icon('candles'), el('span'));
			this.typeButton.addEventListener('click', () => this.openTypeMenu());
			const indicatorButton = el('button', { class: 'chip', title: '지표 검색', 'data-action': 'indicators' }, icon('indicator'), el('span', { text: '지표' }));
			indicatorButton.addEventListener('click', () => openIndicatorPicker(indicatorButton, this));
			const alertButton = el('button', { class: 'chip', title: '알림 추가: 가격, 지표 조건, 작도 돌파', 'data-action': 'alert' }, icon('bell'), el('span', { text: '알림' }));
			alertButton.addEventListener('click', () => openAlertEditor(alertButton, this));
			const compareButton = el('button', { class: 'chip', title: '종목 비교: 다른 종목을 % 기준으로 겹쳐 봅니다', 'data-action': 'compare' }, icon('plus'), el('span', { text: '비교' }));
			compareButton.addEventListener('click', () => openSymbolPicker(compareButton, symbol => this.addCompare(symbol)));
			const strategyButton = el('button', { class: 'chip', title: '전략 백테스트: 조건으로 과거 성과를 계산합니다. AI로 전략을 만들 수도 있습니다', 'data-action': 'backtest' }, icon('indicator'), el('span', { text: '전략' }));
			strategyButton.addEventListener('click', () => window.ChartDeskLab?.openBacktest());

			const ohlc = el('div', { class: 'legend-row' });
			const cell = (label) => {
				const value = el('b');
				ohlc.append(el('span', {}, `${ label } `, value));
				return value;
			};
			this.cells = { open: cell('시'), high: cell('고'), low: cell('저'), close: cell('종'), change: el('b') };
			ohlc.append(this.cells.change);
			this.legend = el('div', { class: 'legend' }, ohlc);
			this.status = el('div', { class: 'status' });
			this.chartHost = el('div', { class: 'chart' });
			this.drawBar = el('div', { class: 'draw-bar', hidden: '' });
			this.liveButton = iconButton('live', '최신 봉으로 이동', { class: 'icon-btn live-btn', hidden: '' });
			this.liveButton.addEventListener('click', () => this.chart.timeScale().scrollToRealTime());
			this.body = el('div', { class: 'pane-body' }, this.chartHost, this.legend, this.status, this.drawBar, this.liveButton);

			this.clock = el('span', { class: 'clock' });
			this.logButton = el('button', { class: 'foot-btn', title: '로그 눈금', text: '로그', onclick: () => this.toggleLog() });
			this.autoButton = el('button', { class: 'foot-btn', title: '가격 눈금 자동 맞춤', text: '자동', onclick: () => this.toggleAuto() });
			this.sessionButton = el('button', {
				class: 'foot-btn',
				title: '확장 거래 시간: 장전·장후 거래를 분·시간 봉에 함께 보여 줍니다. 끄면 정규 거래 시간만 보입니다.',
				text: '확장 시간',
				onclick: () => toggleExtended(),
			});
			this.zoomOutButton = iconButton('zoomout', '확대 이전 화면으로', { class: 'icon-btn zoom-out-btn', hidden: '' });
			this.zoomOutButton.addEventListener('click', () => this.zoomOut());
			this.body.append(this.zoomOutButton);
			this.zoomStack = [];
			this.replayButton = el('button', { class: 'foot-btn', title: '바 리플레이: 고른 봉부터 한 봉씩 다시 보여 줍니다', text: '리플레이', onclick: () => this.toggleReplay() });
			this.replayBar = el('div', { class: 'replay-bar', hidden: '' });
			this.plusButton = el('button', { class: 'price-plus', hidden: '', title: '이 가격에 지정가 주문(리플레이 모의 매매) 또는 알림', text: '+' });
			this.plusButton.addEventListener('click', () => this.openPlusMenu());
			this.body.append(this.replayBar, this.plusButton);
			const foot = el('div', { class: 'pane-foot' },
				...RANGES.map(([label, interval, count]) =>
					el('button', { class: 'foot-btn', text: label, onclick: () => this.setRange(interval, count) })),
				el('span', { class: 'spacer' }),
				this.replayButton,
				this.clock,
				this.sessionButton,
				this.logButton,
				this.autoButton);

			this.root = el('div', { class: 'pane' },
				el('div', { class: 'pane-head' },
					this.symbolButton,
					el('div', { class: 'seg' }, ...this.intervalButtons, this.moreIntervals),
					this.typeButton,
					indicatorButton,
					alertButton,
					compareButton,
					strategyButton),
				this.body,
				foot);
			this.root.addEventListener('mousedown', () => setActivePane(this.index));
			this.body.addEventListener('mouseenter', () => {
				this.hovered = true;
			});
			this.body.addEventListener('mouseleave', () => {
				this.hovered = false;
				this.plusButton.hidden = true;
				this.updateLegend();
				broadcastCrosshair(this, undefined);
			});
			host.append(this.root);
		}

		renderHead() {
			this.symbolButton.replaceChildren(
				logo(this.cfg.symbol),
				el('span', { text: symbolTitle(this.cfg.symbol) }),
				el('small', { text: symbolInfo(this.cfg.symbol).exch }));
			MAIN_INTERVALS.forEach((id, i) => this.intervalButtons[i].classList.toggle('on', id === this.cfg.interval));
			const extra = !MAIN_INTERVALS.includes(this.cfg.interval);
			this.moreIntervals.textContent = extra ? `${ intervalLabel(this.cfg.interval) } ▾` : '▾';
			this.moreIntervals.classList.toggle('on', extra);
			this.typeButton.lastChild.textContent = CHART_TYPES.find(([id]) => id === this.cfg.chartType)[1];
			this.refreshScaleButtons();
		}

		applyTheme() {
			const colors = cssColors();
			this.chart.applyOptions({
				layout: {
					background: { type: LC.ColorType.Solid, color: colors.panel },
					textColor: colors.muted,
					fontFamily: colors.font,
					// 출처는 화면 하단의 문구와 링크로 표시한다.
					attributionLogo: false,
					panes: { separatorColor: colors.border },
				},
				grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
				rightPriceScale: { borderColor: colors.border },
				timeScale: { borderColor: colors.border },
			});
			this.main?.applyOptions(this.mainOptions());
		}

		// ----- 가격 시리즈 -----

		mainOptions() {
			const colors = cssColors();
			const type = this.cfg.chartType;
			if (type === 'line') return { color: colors.accent, lineWidth: 2 };
			if (type === 'area') return { lineColor: colors.accent, topColor: `${ colors.accent }55`, bottomColor: `${ colors.accent }05`, lineWidth: 2 };
			if (type === 'bars') return { upColor: colors.up, downColor: colors.down };
			return { borderVisible: false, upColor: colors.up, downColor: colors.down, wickUpColor: colors.up, wickDownColor: colors.down };
		}

		/** 차트 종류에 맞는 가격 시리즈를 만든다. 가격 패널이 비지 않도록 새 것을 먼저 추가한다. */
		createMain() {
			const definition = {
				line: LC.LineSeries,
				area: LC.AreaSeries,
				bars: LC.BarSeries,
			}[this.cfg.chartType] ?? LC.CandlestickSeries;
			const previous = this.main;
			this.main = this.chart.addSeries(definition, { ...this.mainOptions(), priceFormat: this.mainPriceFormat() }, 0);
			if (previous) {
				previous.detachPrimitive(this.layer);
				this.chart.removeSeries(previous);
			}
			this.main.attachPrimitive(this.layer);
			this.main.setData(this.mainData());
			if (this.markers) this.markers = LC.createSeriesMarkers(this.main, this.markers.markers());
			this.priceLines = [];
			this.syncPriceLines();
			this.applyScale();
		}

		mainPriceFormat() {
			return { type: 'price', precision: this.precision, minMove: 10 ** -this.precision };
		}

		mainData() {
			const type = this.cfg.chartType;
			if (type === 'line' || type === 'area') return this.bars.map(bar => ({ time: bar.time, value: bar.close }));
			if (type === 'heikin') return heikinAshi(this.bars);
			const colors = cssColors();
			// 장외 거래 봉은 흐리게 그려 정규장과 구분한다.
			const faded = (bar) => {
				if (!bar.ext) return null;
				const color = `${ bar.close >= bar.open ? colors.up : colors.down }66`;
				return type === 'bars' ? { color } : { color, wickColor: color, borderColor: color };
			};
			return this.bars.map(bar => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, ...faded(bar) }));
		}

		/** 장전·장후 거래를 따로 받을 수 있는 종목인지. */
		hasSessions() {
			const type = symbolInfo(this.cfg.symbol).type;
			return PROV.resolve(this.cfg.symbol).provider.sessions === true && (type === 'stock' || type === 'fund');
		}

		/** 확대 도구로 고른 영역(봉 번호와 가격 범위)을 화면에 꽉 채운다. */
		zoomTo(box) {
			const timeScale = this.chart.timeScale();
			const scale = this.main.priceScale();
			this.zoomStack.push({ range: timeScale.getVisibleLogicalRange(), auto: scale.options().autoScale, prices: scale.getVisibleRange() });
			timeScale.setVisibleLogicalRange({ from: box.from - 0.5, to: box.to + 0.5 });
			scale.setAutoScale(false);
			scale.setVisibleRange({ from: box.low, to: box.high });
			this.zoomOutButton.hidden = false;
			this.refreshScaleButtons();
		}

		zoomOut() {
			const previous = this.zoomStack.pop();
			this.zoomOutButton.hidden = this.zoomStack.length === 0;
			if (!previous) return;
			const scale = this.main.priceScale();
			if (previous.range) this.chart.timeScale().setVisibleLogicalRange(previous.range);
			if (previous.auto || !previous.prices) scale.setAutoScale(true);
			else scale.setVisibleRange(previous.prices);
			this.refreshScaleButtons();
		}

		applyScale() {
			const overlayAtBottom = state.indicators.some(item => IND.byId.get(item.type).scale === 'bottom');
			this.main.priceScale().applyOptions({
				mode: this.compares.length ? LC.PriceScaleMode.Percentage : this.cfg.log ? LC.PriceScaleMode.Logarithmic : LC.PriceScaleMode.Normal,
				scaleMargins: { top: 0.1, bottom: overlayAtBottom ? 0.22 : 0.08 },
			});
			// 가격 눈금의 % ·로그 방식이 보조 패널 지표의 눈금에 번지지 않게 한다.
			for (let i = 1; i < this.chart.panes().length; i++) this.chart.panes()[i].priceScale('right').applyOptions({ mode: LC.PriceScaleMode.Normal });
			this.refreshScaleButtons();
		}

		openIntervalMenu() {
			const groups = [['분', ['1m', '3m', '5m', '15m', '30m']], ['시간', ['1h', '2h', '4h', '6h', '12h']], ['일 이상', ['1d', '1w', '1M']]];
			popover.className = 'popover';
			openPopover(this.moreIntervals, ...groups.flatMap(([title, ids]) => [
				el('div', { class: 'category', text: title }),
				el('div', { class: 'int-grid' }, ...ids.map(id => el('button', {
					class: `option${ id === this.cfg.interval ? ' on' : '' }`,
					text: intervalLabel(id),
					onclick: () => {
						closePopover();
						this.setInterval(id);
					},
				}))),
			]));
		}

		openTypeMenu() {
			openPopover(this.typeButton, ...CHART_TYPES.map(([id, label]) => el('button', {
				class: `option${ id === this.cfg.chartType ? ' on' : '' }`,
				text: label,
				onclick: () => {
					closePopover();
					if (id === this.cfg.chartType) return;
					this.cfg.chartType = id;
					save();
					this.createMain();
					this.renderHead();
				},
			})));
		}

		toggleLog() {
			this.cfg.log = !this.cfg.log;
			save();
			this.applyScale();
		}

		toggleAuto() {
			const scale = this.main.priceScale();
			scale.setAutoScale(!scale.options().autoScale);
			this.refreshScaleButtons();
		}

		refreshScaleButtons() {
			if (!this.main) return;
			this.logButton.classList.toggle('on', this.cfg.log);
			this.sessionButton.hidden = !this.hasSessions();
			this.sessionButton.classList.toggle('on', state.extended);
			this.autoButton.classList.toggle('on', this.main.priceScale().options().autoScale);
		}

		/** 가격 축 위에서 휠을 굴리면 그 패널의 가격 범위를 늘리거나 줄인다. Shift를 누르면 위아래로 민다. */
		handleAxisWheel(event) {
			const plotWidth = this.chart.timeScale().width();
			const chartPanes = this.chart.panes();
			for (let i = 0; i < chartPanes.length; i++) {
				const node = chartPanes[i].getHTMLElement();
				if (!node) continue;
				const rect = node.getBoundingClientRect();
				if (event.clientY < rect.top || event.clientY > rect.bottom) continue;
				if (event.clientX < rect.left + plotWidth) return;
				const ind = this.inds.find(candidate => candidate.pane === i);
				const series = i === 0 ? this.main : ind && Object.values(ind.series)[0];
				const scale = series?.priceScale();
				const range = scale?.getVisibleRange();
				if (!range) return;
				event.preventDefault();
				event.stopPropagation();
				let { from, to } = range;
				if (event.shiftKey) {
					const shift = (to - from) * event.deltaY * 0.001;
					from += shift;
					to += shift;
				}
				else {
					const pivot = series.coordinateToPrice(event.clientY - rect.top) ?? (from + to) / 2;
					const factor = Math.exp(event.deltaY * 0.0015);
					from = pivot - (pivot - from) * factor;
					to = pivot + (to - pivot) * factor;
				}
				// 자동 맞춤을 끄면 차트를 위아래로도 끌 수 있다.
				scale.setAutoScale(false);
				scale.setVisibleRange({ from, to });
				this.refreshScaleButtons();
				return;
			}
		}

		setInterval(interval) {
			if (interval === this.cfg.interval) return;
			this.cfg.interval = interval;
			save();
			notifyChange();
			this.renderHead();
			this.load();
		}

		setRange(interval, count) {
			this.pendingRange = count;
			if (interval !== this.cfg.interval) this.setInterval(interval);
			else if (this.bars.length) this.applyRange();
			else this.load();
		}

		applyRange() {
			const count = this.pendingRange;
			this.pendingRange = null;
			const total = this.bars.length;
			if (count === 0) this.chart.timeScale().fitContent();
			else this.chart.timeScale().setVisibleLogicalRange({ from: total - count, to: total + 3 });
		}

		changeSymbol(symbol) {
			if (symbol === this.cfg.symbol) return;
			this.layer.cancel();
			this.layer.select(null);
			this.cfg.symbol = symbol;
			this.renderHead();
			this.load();
		}

		lastPrice() {
			return this.bars[this.bars.length - 1]?.close;
		}

		// ----- 지표 -----

		addIndicator(type) {
			const def = IND.byId.get(type);
			const recolor = def.plots.length === 1 && def.plots[0].type === 'line' && !def.plots[0].fixedColor;
			const used = state.indicators.filter(item => Object.values(item.style).some(style => style.color)).length;
			state.indicators.push(newIndicator(type, recolor ? { color: PALETTE[used % PALETTE.length] } : {}));
			indicatorsChanged();
		}

		removeIndicator(id) {
			state.indicators = state.indicators.filter(item => item.id !== id);
			delete state.paneSizes[id];
			indicatorsChanged();
		}

		updateIndicator(id, params) {
			const item = state.indicators.find(candidate => candidate.id === id);
			if (!item) return;
			item.params = sanitizeParams(IND.byId.get(item.type), params);
			indicatorsChanged();
		}

		toggleIndicator(id) {
			const item = state.indicators.find(candidate => candidate.id === id);
			if (!item) return;
			item.hidden = !item.hidden;
			indicatorsChanged();
		}

		styleOf(item, plot) {
			const style = item.style[plot.k] ?? {};
			return {
				color: style.color ?? plot.color,
				width: style.width ?? plot.width ?? 1,
				visible: !item.hidden && !style.hidden,
			};
		}

		priceFormat(def) {
			if (def.fmt === 'vol') return { type: 'volume' };
			const precision = def.fmt === 'osc' ? 2 : this.precision;
			return { type: 'price', precision, minMove: 10 ** -precision };
		}

		formatValue(def, value) {
			if (def.fmt === 'vol') return `${ value < 0 ? '-' : '' }${ formatVolume(Math.abs(value)) }`;
			return def.fmt === 'osc' ? value.toFixed(2) : formatPrice(value, this.precision);
		}

		/** 설정이 바뀔 때마다 지표 시리즈를 모두 다시 만든다. 보조 패널 번호가 항상 연속이 된다. */
		buildIndicators() {
			for (const ind of this.inds) {
				for (const series of Object.values(ind.series)) this.chart.removeSeries(series);
				ind.row.remove();
			}
			this.inds = [];
			const muted = cssColors().muted;
			let nextPane = 1;
			for (const cfg of state.indicators) {
				const def = IND.byId.get(cfg.type);
				const pane = def.overlay ? 0 : nextPane++;
				const onBottom = def.scale === 'bottom';
				const series = {};
				for (const plot of def.plots) {
					const options = {
						color: plot.color,
						priceFormat: this.priceFormat(def),
						priceLineVisible: false,
						lastValueVisible: cfg.axisLabel ?? def.axisLabel ?? !def.overlay,
						crosshairMarkerVisible: false,
					};
					if (onBottom) options.priceScaleId = '';
					if (plot.type === 'hist') {
						series[plot.k] = this.chart.addSeries(LC.HistogramSeries, options, pane);
						continue;
					}
					if (plot.type === 'dots') Object.assign(options, { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 });
					series[plot.k] = this.chart.addSeries(LC.LineSeries, options, pane);
				}
				const first = series[def.plots[0].k];
				if (onBottom) first.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
				for (const price of cfg.levels ?? def.levels ?? []) {
					first.createPriceLine({ price, color: muted, lineWidth: 1, lineStyle: LC.LineStyle.Dotted, axisLabelVisible: false });
				}
				const ind = { cfg, def, pane, series, out: null, values: {}, row: null };
				this.buildLegendRow(ind);
				this.inds.push(ind);
			}
			this.applyScale();
			this.applyPaneSizes();
			this.restyleIndicators();
			this.setIndicatorData();
			this.updateLegend();
			this.layer.redraw();
			requestAnimationFrame(() => this.positionLegends());
		}

		/** 색, 굵기, 표시 여부만 바꾼다. 시리즈를 다시 만들지 않으므로 색 선택기를 끄는 동안에도 가볍다. */
		restyleIndicators() {
			for (const ind of this.inds) {
				ind.row.classList.toggle('off', ind.cfg.hidden === true);
				for (const plot of ind.def.plots) {
					const style = this.styleOf(ind.cfg, plot);
					const options = { visible: plot.type === 'hist' ? !ind.cfg.hidden : style.visible };
					if (plot.type !== 'hist') {
						if (!plot.fixedColor) options.color = style.color;
						options.lineWidth = style.width;
						ind.values[plot.k].style.color = style.color;
						ind.values[plot.k].hidden = !style.visible && !ind.cfg.hidden;
					}
					ind.series[plot.k].applyOptions(options);
				}
			}
		}

		buildLegendRow(ind) {
			const { def, cfg } = ind;
			const args = def.params.map(param => cfg.params[param.k]).join(' ');
			const frame = this.frameOf(ind);
			const name = `${ args ? `${ def.short } ${ args }` : def.short }${ frame ? ` · ${ intervalLabel(frame) }` : '' }`;
			const nodes = [el('span', { class: 'ind-name', text: name })];
			// 값의 글자 폭이 변해도 버튼이 밀리지 않도록 버튼을 값보다 앞에 둔다.
			const eye = el('button', { class: 'ind-btn', title: cfg.hidden ? '보이기' : '숨기기' }, icon(cfg.hidden ? 'eyeOff' : 'eye'));
			eye.addEventListener('click', () => this.toggleIndicator(cfg.id));
			const gear = el('button', { class: 'ind-btn', title: '설정' }, icon('gear'));
			gear.addEventListener('click', () => openIndicatorSettings(gear, this, cfg.id));
			const about = el('button', { class: 'ind-btn', title: '설명과 사용법' }, icon('help'));
			about.addEventListener('click', () => openIndicatorHelp(about, def));
			const remove = el('button', { class: 'ind-btn', title: '삭제' }, icon('close'));
			remove.addEventListener('click', () => this.removeIndicator(cfg.id));
			nodes.push(el('span', { class: 'ind-actions' }, eye, gear, about, remove));
			for (const plot of def.plots) {
				const value = el('b');
				ind.values[plot.k] = value;
				nodes.push(value);
			}
			ind.row = el('div', { class: `legend-row ind-row${ def.overlay ? '' : ' floating' }` }, ...nodes);
			(def.overlay ? this.legend : this.body).append(ind.row);
		}

		/** 저장된 높이 비율로 패널 높이를 맞춘다. 저장된 값이 없으면 가격 3 : 지표 1. */
		applyPaneSizes() {
			const chartPanes = this.chart.panes();
			chartPanes.forEach((pane, i) => {
				const ind = this.inds.find(candidate => candidate.pane === i);
				pane.setStretchFactor(i === 0 ? state.paneSizes.main ?? 3 : state.paneSizes[ind?.cfg.id] ?? 1);
			});
			this.appliedSizes = chartPanes.map(pane => pane.getStretchFactor());
			requestAnimationFrame(() => this.positionLegends());
		}

		/** 누르고 있는 동안 이름표를 패널 위쪽에 맞춰 옮기고, 놓았을 때 높이가 바뀌었으면 저장한다. */
		followPaneDrag() {
			if (this.inds.every(ind => ind.pane === 0)) return;
			let frame = 0;
			const follow = () => {
				this.positionLegends();
				frame = requestAnimationFrame(follow);
			};
			frame = requestAnimationFrame(follow);
			const done = () => {
				cancelAnimationFrame(frame);
				window.removeEventListener('pointerup', done, true);
				window.removeEventListener('pointercancel', done, true);
				this.positionLegends();
				this.savePaneSizes();
			};
			window.addEventListener('pointerup', done, true);
			window.addEventListener('pointercancel', done, true);
		}

		savePaneSizes() {
			if (this.dead) return;
			const sizes = this.chart.panes().map(pane => pane.getStretchFactor());
			if (this.appliedSizes && sizes.length === this.appliedSizes.length && sizes.every((size, i) => Math.abs(size - this.appliedSizes[i]) < 1e-6)) return;
			state.paneSizes.main = sizes[0];
			for (const ind of this.inds) {
				if (ind.pane > 0) state.paneSizes[ind.cfg.id] = sizes[ind.pane];
			}
			this.appliedSizes = sizes;
			save();
			// 배치가 여러 개면 다른 차트도 같은 높이로 맞춘다.
			panes.forEach(pane => pane !== this && pane.applyPaneSizes());
		}

		/** 보조 패널 지표의 이름표를 각 패널의 왼쪽 위에 맞춘다. */
		positionLegends() {
			if (this.dead) return;
			const chartPanes = this.chart.panes();
			const origin = this.body.getBoundingClientRect();
			for (const ind of this.inds) {
				const node = ind.pane === 0 ? null : chartPanes[ind.pane]?.getHTMLElement();
				if (node) ind.row.style.top = `${ node.getBoundingClientRect().top - origin.top + 4 }px`;
			}
		}

		/** 지표 값 하나를 차트 점으로 바꾼다. 값이 없으면 null. */
		pointAt(ind, plot, i) {
			const value = ind.out[plot.k][i];
			if (value === null || !Number.isFinite(value)) return null;
			const count = this.bars.length;
			const shift = typeof plot.shift === 'function' ? plot.shift(ind.cfg.params) : 0;
			const target = i + shift;
			if (target < 0) return null;
			let time;
			if (target < count) {
				time = this.bars[target].time;
			}
			else {
				// 선행 지표는 마지막 봉 뒤의 시간대에 그린다.
				const step = count > 1 ? this.bars[count - 1].time - this.bars[count - 2].time : 0;
				if (step <= 0) return null;
				time = this.bars[count - 1].time + (target - count + 1) * step;
			}
			const color = ind.out.$colors?.[plot.k]?.[i];
			return color ? { time, value, color } : { time, value };
		}

		computeIndicators() {
			const source = IND.source(this.bars);
			const context = { tzOffset: TZ_OFFSET, symbol: this.cfg.symbol, interval: this.cfg.interval, info: symbolInfo(this.cfg.symbol) };
			// 위 주기의 봉이 도착하면 지표를 다시 계산한다.
			this.basisReady ??= () => {
				if (this.dead || this.bars.length === 0) return;
				this.setIndicatorData();
				this.layer.redraw();
			};
			for (const ind of this.inds) {
				const frame = this.frameOf(ind);
				if (frame) {
					ind.out = this.computeOnFrame(ind, frame, context);
					continue;
				}
				const wanted = ind.def.basis?.(ind.cfg.params, this.cfg.interval);
				const own = wanted ? { ...context, basis: basisFor(this.cfg.symbol, wanted, this.basisReady) } : context;
				ind.out = ind.def.calc(source, ind.cfg.params, own);
			}
		}

		/** 지표를 계산할 위 주기. 차트 주기와 같거나 짧으면 null(차트 봉으로 계산). */
		frameOf(ind) {
			const frame = ind.cfg.tf;
			return frame && frameable(ind.def) && INTERVAL_SECONDS[frame] > INTERVAL_SECONDS[this.cfg.interval] ? frame : null;
		}

		/** 위 주기의 봉으로 지표를 계산해, 차트의 봉마다 그 봉이 속한 위 주기 봉의 값을 놓는다. */
		computeOnFrame(ind, frame, context) {
			const count = this.bars.length;
			const empty = () => Object.fromEntries(ind.def.plots.map(plot => [plot.k, new Array(count).fill(null)]));
			const basis = basisFor(this.cfg.symbol, frame, this.basisReady);
			if (!basis.bars?.length) return empty();
			const merged = mergeFrame(basis.bars, this.bars, frame);
			let out;
			try {
				out = ind.def.calc(IND.source(merged), ind.cfg.params, { ...context, interval: frame });
			}
			catch {
				return empty();
			}
			const map = new Array(count);
			let j = 0;
			for (let i = 0; i < count; i++) {
				while (j + 1 < merged.length && merged[j + 1].time <= this.bars[i].time) j++;
				map[i] = merged[j].time <= this.bars[i].time ? j : -1;
			}
			const mapped = {};
			for (const plot of ind.def.plots) mapped[plot.k] = map.map(index => (index >= 0 ? out[plot.k]?.[index] ?? null : null));
			if (out.$colors) {
				mapped.$colors = {};
				for (const [key, colors] of Object.entries(out.$colors)) mapped.$colors[key] = map.map(index => (index >= 0 ? colors?.[index] : undefined));
			}
			return mapped;
		}

		setIndicatorData() {
			this.computeIndicators();
			for (const ind of this.inds) {
				for (const plot of ind.def.plots) {
					const points = [];
					for (let i = 0; i < this.bars.length; i++) {
						const point = this.pointAt(ind, plot, i);
						if (point) points.push(point);
					}
					ind.series[plot.k].setData(points);
				}
			}
		}

		updateIndicatorTail() {
			this.computeIndicators();
			for (const ind of this.inds) {
				for (const plot of ind.def.plots) {
					for (let i = this.bars.length - 1; i >= 0; i--) {
						const point = this.pointAt(ind, plot, i);
						if (point) {
							ind.series[plot.k].update(point);
							break;
						}
					}
				}
			}
		}

		applyPriceFormats() {
			this.main.applyOptions({ priceFormat: this.mainPriceFormat() });
			for (const ind of this.inds) {
				for (const series of Object.values(ind.series)) series.applyOptions({ priceFormat: this.priceFormat(ind.def) });
			}
		}

		// ----- 데이터 -----

		setAllData() {
			this.main.setData(this.mainData());
			this.setIndicatorData();
			this.compares.forEach(compare => this.showCompare(compare));
		}

		async load() {
			const token = ++this.token;
			const { symbol, interval } = this.cfg;
			this.endReplay();
			this.clearTrades();
			this.closeSocket();
			this.noMore = false;
			this.zoomStack = [];
			this.zoomOutButton.hidden = true;
			this.status.textContent = '불러오는 중…';
			try {
				const loaded = await loadBars(symbol, interval);
				if (token !== this.token || this.dead) return;
				if (loaded.bars.length === 0) throw new Error('데이터 없음');
				this.bars = loaded.bars;
				this.precision = loaded.precision;
				// 과거 이어 받기를 지원하지 않는 공급원은 처음 받은 범위가 전부다.
				this.noMore = PROV.resolve(symbol).provider.noPaging === true;
				this.applyPriceFormats();
				this.setAllData();
				if (this.pendingRange === null) this.chart.timeScale().resetTimeScale();
				else this.applyRange();
				this.main.priceScale().setAutoScale(true);
				this.refreshScaleButtons();
				this.status.textContent = '';
				this.updateLegend();
				this.syncPriceLines();
				this.openSocket(token);
				this.buildCompares();
			}
			catch {
				if (token !== this.token || this.dead) return;
				this.bars = [];
				this.pendingRange = null;
				this.setAllData();
				this.updateLegend();
				this.status.textContent = `${ symbolTitle(symbol) } 데이터를 불러오지 못했습니다.`;
			}
		}

		async loadMore() {
			if (this.loadingMore || this.noMore || this.bars.length === 0 || this.replay) return;
			this.loadingMore = true;
			const token = this.token;
			const first = this.bars[0];
			try {
				const loaded = await loadBars(this.cfg.symbol, this.cfg.interval, (first.time - TZ_OFFSET) * 1000 - 1);
				if (token !== this.token || this.dead) return;
				const older = loaded.bars.filter(bar => bar.time < first.time);
				if (older.length === 0) {
					this.noMore = true;
					return;
				}
				const range = this.chart.timeScale().getVisibleLogicalRange();
				this.bars = older.concat(this.bars);
				this.setAllData();
				// 앞에 봉이 붙어도 보고 있던 구간이 그대로 유지되게 한다.
				if (range) {
					this.chart.timeScale().setVisibleLogicalRange({ from: range.from + older.length, to: range.to + older.length });
				}
			}
			catch {
				// 다음 스크롤에서 다시 시도한다.
			}
			finally {
				this.loadingMore = false;
			}
		}

		/** 재연결 사이에 빠진 봉을 메운다. */
		async refreshTail(token) {
			try {
				const fresh = (await loadBars(this.cfg.symbol, this.cfg.interval, undefined, 200)).bars;
				if (token !== this.token || this.dead || this.bars.length === 0 || fresh.length === 0) return;
				const kept = this.bars.filter(bar => bar.time < fresh[0].time);
				this.bars = kept.concat(fresh);
				this.setAllData();
			}
			catch {
				// 실시간 스트림이 이어서 갱신한다.
			}
		}

		/** 실시간 스트림이 있는 공급원은 스트림에 붙고, 없으면 최근 봉을 주기적으로 다시 받는다. */
		openSocket(token) {
			const { provider, code } = PROV.resolve(this.cfg.symbol);
			const interval = this.cfg.interval;
			const onBar = (bar) => {
				if (token === this.token) this.applyTick({ ...bar, time: bar.time + TZ_OFFSET });
			};
			if (provider.streamBars) {
				this.socket = provider.streamBars(code, interval, onBar, () => this.refreshTail(token));
				return;
			}
			let busy = false;
			const timer = setInterval(async() => {
				if (busy || document.hidden) return;
				busy = true;
				try {
					const bars = provider.tail ? await provider.tail(code, interval) : (await provider.klines(code, interval, undefined, 3)).bars;
					bars.forEach(onBar);
				}
				catch {
					// 다음 주기에 다시 시도한다.
				}
				finally {
					busy = false;
				}
			}, provider.pollMs);
			this.socket = { close: () => clearInterval(timer) };
		}

		closeSocket() {
			this.socket?.close();
			this.socket = null;
		}

		applyTick(bar) {
			const last = this.bars[this.bars.length - 1];
			if (!last || bar.time < last.time) return;
			if (bar.time === last.time) this.bars[this.bars.length - 1] = bar;
			else this.bars.push(bar);
			const data = this.mainData();
			this.main.update(data[data.length - 1]);
			this.updateIndicatorTail();
			if (!this.hovered) this.updateLegend();
		}

		// ----- 범례, 십자선, 알림선 -----

		updateLegend(index = this.bars.length - 1) {
			const bar = this.bars[index];
			const direction = bar && bar.close < bar.open ? 'down' : 'up';
			for (const [key, node] of Object.entries(this.cells)) {
				node.className = direction;
				if (!bar) node.textContent = '';
				else if (key === 'change') node.textContent = formatPercent(bar.open ? (bar.close - bar.open) / bar.open * 100 : 0);
				else node.textContent = formatPrice(bar[key], this.precision);
			}
			for (const compare of this.compares) {
				const at = bar ? barIndexAt(compare.bars, bar.time) : -1;
				const point = compare.bars[at];
				const first = compare.bars[Math.max(0, barIndexAt(compare.bars, this.bars[0]?.time ?? 0))];
				compare.value.textContent = point ? `${ formatPrice(point.close) } (${ formatPercent((point.close / first.close - 1) * 100) })` : '–';
			}
			for (const ind of this.inds) {
				for (const plot of ind.def.plots) {
					const value = bar ? ind.out?.[plot.k]?.[index] : null;
					ind.values[plot.k].textContent = value === null || value === undefined || !Number.isFinite(value)
						? '–'
						: this.formatValue(ind.def, value);
				}
			}
			this.positionLegends();
		}

		syncPriceLines() {
			if (!this.main) return;
			for (const line of this.priceLines) this.main.removePriceLine(line);
			const color = cssColors().warn;
			this.priceLines = state.alerts
				.filter(alert => alert.active && alert.kind === 'price' && alert.symbol === this.cfg.symbol)
				.map(alert => this.main.createPriceLine({
					price: alert.price,
					color,
					lineWidth: 1,
					lineStyle: LC.LineStyle.Dashed,
					axisLabelVisible: true,
					title: '알림',
				}));
		}

		showCrosshairAt(time) {
			const index = time === undefined ? -1 : barIndexAt(this.bars, time);
			const bar = this.bars[index];
			// 이 패널의 데이터가 끝난 뒤의 시각이면 마지막 봉에 붙이지 않는다.
			const span = this.bars.length > 1 ? this.bars[1].time - this.bars[0].time : 0;
			if (!bar || time >= bar.time + span) {
				this.chart.clearCrosshairPosition();
				this.updateLegend();
				return;
			}
			this.chart.setCrosshairPosition(bar.close, bar.time, this.main);
			this.updateLegend(index);
		}

		// ----- 작도 -----

		/** 선택한 작도 위에 뜨는 빠른 편집 막대. */
		showDrawingBar(drawing) {
			if (!drawing) {
				this.drawBar.hidden = true;
				this.drawBar.replaceChildren();
				return;
			}
			const fields = DRAW.fieldsOf(drawing);
			const apply = (commit) => {
				rememberDrawingStyle(drawing);
				drawingsChanged(commit);
			};
			const nodes = [el('span', { class: 'draw-name', text: DRAW.byId.get(drawing.tool).name })];
			if (fields.includes('color')) {
				nodes.push(colorInput(drawing.style.color, (color, commit) => {
					drawing.style.color = color;
					apply(commit);
				}));
			}
			if (fields.includes('width')) {
				nodes.push(selectInput(drawing.style.width, WIDTH_OPTIONS, (width) => {
					drawing.style.width = Number(width);
					apply(true);
				}));
			}
			if (fields.length) nodes.push(iconButton('gear', '설정', { onclick: () => openDrawingSettings(this, drawing) }));
			if (ALERTABLE_DRAWINGS.has(drawing.type)) {
				const bell = iconButton('bell', '이 선에 알림: 가격이 넘으면 알립니다');
				bell.addEventListener('click', () => openAlertEditor(bell, this, 'drawing', drawing.id));
				nodes.push(bell);
			}
			nodes.push(iconButton('trash', '삭제 (Delete)', { onclick: () => removeSelectedDrawing() }));
			this.drawBar.replaceChildren(...nodes);
			this.drawBar.hidden = false;
		}

		// ----- 종목 비교 -----

		addCompare(symbol) {
			if (symbol === this.cfg.symbol || this.cfg.compare.some(item => item.symbol === symbol)) return;
			if (this.cfg.compare.length >= 5) {
				toast('비교 종목은 5개까지 넣을 수 있습니다.');
				return;
			}
			const used = new Set(this.cfg.compare.map(item => item.color));
			const color = PALETTE.find(candidate => !used.has(candidate)) ?? PALETTE[0];
			this.cfg.compare.push({ symbol, color });
			save();
			this.buildCompares();
		}

		removeCompare(symbol) {
			this.cfg.compare = this.cfg.compare.filter(item => item.symbol !== symbol);
			save();
			this.buildCompares();
		}

		/** 비교 종목 선을 가격 패널에 얹는다. 비교 중에는 가격 눈금이 %로 바뀌어 화면 왼쪽 끝 봉을 0%로 맞춘다. */
		buildCompares() {
			for (const compare of this.compares) {
				clearInterval(compare.timer);
				this.chart.removeSeries(compare.series);
				compare.row.remove();
			}
			const token = this.token;
			this.compares = this.cfg.compare.map((item) => {
				const series = this.chart.addSeries(LC.LineSeries, {
					color: item.color,
					lineWidth: 2,
					priceLineVisible: false,
					lastValueVisible: true,
					crosshairMarkerVisible: false,
					title: symbolTitle(item.symbol),
				}, 0);
				const value = el('b');
				const remove = el('button', { class: 'ind-btn', title: '비교 끄기' }, icon('close'));
				const swatch = el('i', { class: 'swatch' });
				swatch.style.background = item.color;
				const row = el('div', { class: 'legend-row cmp-row' }, swatch, el('span', { class: 'ind-name', text: symbolTitle(item.symbol) }), el('span', { class: 'ind-actions' }, remove), value);
				remove.addEventListener('click', () => this.removeCompare(item.symbol));
				this.legend.append(row);
				return { ...item, series, bars: [], row, value, timer: 0 };
			});
			this.applyScale();
			for (const compare of this.compares) this.loadCompare(compare, token);
		}

		async loadCompare(compare, token) {
			const interval = this.cfg.interval;
			try {
				const { bars } = await loadBars(compare.symbol, interval);
				if (token !== this.token || this.dead || !this.compares.includes(compare)) return;
				compare.bars = bars;
				const range = this.chart.timeScale().getVisibleLogicalRange();
				this.showCompare(compare);
				if (range) this.chart.timeScale().setVisibleLogicalRange(range);
				this.updateLegend();
			}
			catch {
				compare.value.textContent = '불러오지 못함';
				return;
			}
			compare.timer = setInterval(async() => {
				if (document.hidden || this.replay) return;
				try {
					const fresh = await loadTail(compare.symbol, interval);
					if (token !== this.token || this.dead) return;
					for (const bar of fresh) {
						const last = compare.bars[compare.bars.length - 1];
						if (last && bar.time < last.time) continue;
						if (last && bar.time === last.time) compare.bars[compare.bars.length - 1] = bar;
						else compare.bars.push(bar);
						compare.series.update({ time: bar.time, value: bar.close });
					}
				}
				catch {
					// 다음 주기에 다시 받는다.
				}
			}, 5000);
		}

		/**
		 * 비교 선을 그린다. 차트의 첫 봉보다 앞은 그리지 않는다(앞에 시간이 늘어나면 보던 화면이 과거로 밀린다).
		 * 리플레이 중에는 지금 보이는 봉까지만 그린다.
		 */
		showCompare(compare) {
			const from = this.bars[0]?.time ?? Infinity;
			const until = this.replay ? this.bars[this.bars.length - 1]?.time ?? -Infinity : Infinity;
			compare.series.setData(compare.bars.filter(bar => bar.time >= from && bar.time <= until).map(bar => ({ time: bar.time, value: bar.close })));
		}

		// ----- 바 리플레이 -----

		toggleReplay() {
			if (this.replay || this.picking) {
				this.endReplay(true);
				return;
			}
			if (this.bars.length < 10) return;
			this.picking = true;
			this.body.classList.add('picking');
			this.replayButton.classList.add('on');
			this.replayBar.replaceChildren(
				this.replayGrip('리플레이'),
				el('span', { text: '시작할 봉을 차트에서 누르세요' }),
				el('button', { class: 'text-btn', text: '취소 (Esc)', onclick: () => this.endReplay(true) }));
			this.replayBar.hidden = false;
			this.placeReplayBar();
		}

		onChartClick(param) {
			if (!this.picking || param.time === undefined) return;
			const index = barIndexAt(this.bars, param.time);
			if (index < 1) return;
			this.picking = false;
			this.body.classList.remove('picking');
			this.startReplay(index);
		}

		startReplay(index, all = this.bars) {
			this.closeSocket();
			clearInterval(this.replay?.timer);
			this.replay = { all, index, timer: 0, speed: this.replay?.speed ?? 2, setup: true, account: null };
			this.clearPaperMarks();
			this.bars = all.slice(0, index + 1);
			this.setAllData();
			this.compares.forEach(compare => this.showCompare(compare));
			this.chart.timeScale().scrollToRealTime();
			this.updateLegend();
			this.renderReplayBar();
		}

		/** 리플레이 막대의 손잡이. 끌어서 옮기고, 두 번 누르면 아래 가운데로 돌아간다. */
		replayGrip(label) {
			const grip = el('b', { class: 'replay-grip', title: '끌어서 옮기기 · 두 번 누르면 제자리', text: `⠿ ${ label }` });
			grip.addEventListener('pointerdown', event => this.dragReplayBar(event));
			grip.addEventListener('dblclick', () => {
				state.replayPos = null;
				save();
				panes.forEach(pane => !pane.replayBar.hidden && pane.placeReplayBar());
			});
			return grip;
		}

		/** 저장된 자리에 막대를 놓는다. 좁은 화면(휴대폰)은 폭을 다 쓰고 위아래만 옮긴다. */
		placeReplayBar() {
			const bar = this.replayBar;
			const pos = state.replayPos;
			// 휴대폰 화면 규칙(styles.css의 max-width: 600px)과 같은 기준을 쓴다.
			const narrow = matchMedia('(max-width: 600px)').matches;
			bar.classList.toggle('moved', pos !== null);
			if (!pos) {
				for (const key of ['left', 'top', 'right', 'bottom', 'width', 'transform']) bar.style[key] = '';
				return;
			}
			const width = this.body.clientWidth;
			const height = this.body.clientHeight;
			const top = Math.min(Math.max(0, pos.y * height), Math.max(0, height - bar.offsetHeight));
			bar.style.top = `${ top }px`;
			bar.style.bottom = 'auto';
			bar.style.transform = 'none';
			if (narrow) {
				bar.style.left = '';
				bar.style.right = '';
				bar.style.width = '';
				return;
			}
			bar.style.right = 'auto';
			bar.style.width = 'max-content';
			bar.style.left = `${ Math.min(Math.max(0, pos.x * width), Math.max(0, width - bar.offsetWidth)) }px`;
		}

		dragReplayBar(event) {
			if (event.button !== 0) return;
			event.preventDefault();
			const bar = this.replayBar;
			const box = this.body.getBoundingClientRect();
			const start = bar.getBoundingClientRect();
			const offset = { x: event.clientX - start.left, y: event.clientY - start.top };
			const move = (moveEvent) => {
				state.replayPos = {
					x: Math.min(1, Math.max(0, (moveEvent.clientX - offset.x - box.left) / box.width)),
					y: Math.min(1, Math.max(0, (moveEvent.clientY - offset.y - box.top) / box.height)),
				};
				this.placeReplayBar();
			};
			const done = () => {
				window.removeEventListener('pointermove', move, true);
				window.removeEventListener('pointerup', done, true);
				window.removeEventListener('pointercancel', done, true);
				bar.classList.remove('dragging');
				save();
				panes.forEach(pane => pane !== this && !pane.replayBar.hidden && pane.placeReplayBar());
			};
			bar.classList.add('dragging');
			// 차트의 작도 처리가 이벤트를 막기 전에 받도록 캡처 단계에서 듣는다.
			window.addEventListener('pointermove', move, true);
			window.addEventListener('pointerup', done, true);
			window.addEventListener('pointercancel', done, true);
		}

		/** 모의 매매에서 금액의 단위. */
		paperUnit() {
			const symbol = this.cfg.symbol;
			if (/KRW/.test(symbol) || symbol.endsWith('.KS') || symbol.endsWith('.KQ')) return '원';
			const quote = /(USDT|USDC|FDUSD|BTC|ETH)(\.P)?$/.exec(symbolInfo(symbol).display)?.[1];
			return quote ?? (PROV.resolve(symbol).provider.id === 'YAHOO' ? '달러' : 'USDT');
		}

		isFutures() {
			const type = symbolInfo(this.cfg.symbol).type;
			return type === 'perp' || type === 'futures';
		}

		/** 리플레이를 시작할 때 모의 매매 시드(선물이면 배율도)를 묻는다. */
		renderPaperSetup() {
			const paper = state.paper;
			const krw = this.paperUnit() === '원';
			const futures = this.isFutures();
			const number = (value, label, props = {}) => {
				const input = el('input', { type: 'number', step: 'any', min: '0', value: String(value), 'aria-label': label, ...props });
				return input;
			};
			const seed = number(krw ? paper.seedKrw : paper.seedUsd, '시드', { class: 'paper-seed' });
			const leverage = number(paper.leverage, '배율', { min: '1', max: '125', step: '1', class: 'paper-small' });
			const fee = number(paper.fee, '수수료', { class: 'paper-small' });
			const stop = number(paper.stop, '손절 %', { class: 'paper-small' });
			const target = number(paper.target, '익절 %', { class: 'paper-small' });
			const item = (label, input, unit) => el('label', { class: 'paper-field' }, el('span', { text: label }), input, unit ? el('small', { text: unit }) : '');
			const start = () => {
				const read = input => Math.max(0, Number(input.value) || 0);
				const amount = read(seed);
				if (amount <= 0) {
					seed.focus();
					return;
				}
				if (krw) paper.seedKrw = amount;
				else paper.seedUsd = amount;
				if (futures) paper.leverage = Math.min(125, Math.max(1, Math.round(read(leverage)) || 1));
				paper.fee = read(fee);
				paper.stop = read(stop);
				paper.target = read(target);
				save();
				this.replay.account = new window.ChartDeskPaper.Account({ seed: amount, fee: paper.fee, leverage: paper.leverage, futures, stop: paper.stop, target: paper.target });
				this.replay.setup = false;
				this.renderReplayBar();
			};
			this.replayBar.replaceChildren(
				el('div', { class: 'replay-row' }, this.replayGrip('모의 매매'), el('span', { class: 'muted', text: `${ futures ? '선물 (롱·숏, 배율)' : '현물 (매수·매도)' } · 체결은 지금 봉의 종가` })),
				el('div', { class: 'replay-row' },
					item('시드', seed, this.paperUnit()),
					futures ? item('배율', leverage, '배') : '',
					item('수수료', fee, '%'),
					item('손절', stop, '%'),
					item('익절', target, '%')),
				el('div', { class: 'replay-row' },
					el('button', { class: 'primary', text: '모의 매매로 시작', onclick: start }),
					el('button', { class: 'text-btn', text: '보기만', onclick: () => {
						this.replay.setup = false;
						this.renderReplayBar();
					} }),
					el('button', { class: 'text-btn', text: '✕', title: '리플레이 끝내기', onclick: () => this.endReplay(true) })),
				el('p', { class: 'paper-note', text: '손절·익절은 진입가 대비 가격 변화 %입니다(0이면 쓰지 않음). 선물은 격리 증거금으로 계산하고, 청산가에 닿으면 증거금을 모두 잃습니다.' }));
			this.replayBar.hidden = false;
			this.placeReplayBar();
			// 휴대폰에서는 키보드가 차트를 가리지 않게 바로 입력칸을 잡지 않는다.
			if (!matchMedia('(pointer: coarse)').matches) {
				seed.focus();
				seed.select();
			}
		}

		/** 지금 고른 주문 크기. */
		paperSizing() {
			const paper = state.paper;
			const value = paper.sizeMode === 'amount' ? paper.amount : paper.sizeMode === 'qty' ? paper.qty : paper.size;
			return { mode: paper.sizeMode, value };
		}

		/**
		 * 모의 매매 주문. side: 1 매수(롱), -1 매도(숏). price를 주면 그 가격의 지정가, 없으면 주문 창에서 고른 방식대로.
		 */
		paperOrder(side, price = null) {
			const account = this.replay?.account;
			const bar = this.bars[this.bars.length - 1];
			if (!account || !bar) return;
			const limit = price ?? (state.paper.orderType === 'limit' ? Number(this.replay.limitPrice) : null);
			try {
				toast(limit === null
					? account.market(side, this.paperSizing(), bar.close, bar.time)
					: account.limit(side, this.paperSizing(), limit, bar.close, bar.time));
			}
			catch (error) {
				toast(error.message);
			}
			this.showPaperMarks();
			this.refreshReplayInfo();
		}

		paperClose(fraction) {
			const account = this.replay?.account;
			const bar = this.bars[this.bars.length - 1];
			if (!account || !bar) return;
			try {
				toast(account.close(fraction, bar.close, bar.time, '시장가 청산'));
			}
			catch (error) {
				toast(error.message);
			}
			this.showPaperMarks();
			this.refreshReplayInfo();
		}

		paperCancel(id) {
			this.replay?.account?.cancel(id);
			this.showPaperMarks();
			this.refreshReplayInfo();
		}

		/** 체결 표시와 평단·청산가·손절·익절·대기 지정가 선. */
		showPaperMarks() {
			const account = this.replay?.account;
			this.clearPaperMarks();
			if (!account) return;
			const colors = cssColors();
			const markers = account.fills.map(fill => (fill.kind === 'open'
				? { time: fill.time, position: fill.side > 0 ? 'belowBar' : 'aboveBar', color: fill.side > 0 ? colors.up : colors.down, shape: fill.side > 0 ? 'arrowUp' : 'arrowDown', text: `${ fill.how === '지정가' ? '지정 ' : '' }${ account.sideName(fill.side) }` }
				: { time: fill.time, position: fill.side > 0 ? 'belowBar' : 'aboveBar', color: fill.pnl >= 0 ? colors.up : colors.down, shape: 'circle', text: `${ fill.reason } ${ fill.ret >= 0 ? '+' : '' }${ (fill.ret * 100).toFixed(1) }%` }));
			if (markers.length) this.showTrades(markers.sort((a, b) => a.time - b.time));
			const line = (price, color, title, style = LC.LineStyle.Dashed) => price && this.main.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
			const position = account.position;
			this.paperLines = [
				...account.orders.map(order => line(order.price, order.side > 0 ? colors.up : colors.down, `지정 ${ account.sideName(order.side) } ${ window.ChartDeskPaper.formatQty(order.qty) }`, LC.LineStyle.Dotted)),
				...(position ? [
					line(position.entry, colors.text, `평단 ${ position.side > 0 ? (account.futures ? '롱' : '매수') : '숏' }`, LC.LineStyle.Solid),
					line(account.liquidation(), colors.warn, '청산가'),
					line(position.stopPrice, colors.down, '손절'),
					line(position.targetPrice, colors.up, '익절'),
				] : []),
			].filter(Boolean);
		}

		clearPaperMarks() {
			for (const line of this.paperLines ?? []) this.main.removePriceLine(line);
			this.paperLines = [];
			this.clearTrades();
		}

		paperMoney(value) {
			const unit = this.paperUnit();
			return `${ value.toLocaleString('ko-KR', { maximumFractionDigits: unit === '원' ? 0 : 2 }) } ${ unit }`;
		}

		/** 모의 매매 상태 줄: 자산, 수익률, 포지션. */
		paperStatus() {
			const account = this.replay.account;
			const bar = this.bars[this.bars.length - 1];
			const money = value => this.paperMoney(value);
			const sum = account.summary(bar.close);
			const parts = [`자산 ${ money(sum.equity) } (${ formatPercent(sum.ret * 100) })`];
			const position = account.position;
			if (position) {
				const pnl = account.unrealized(bar.close);
				const name = position.side > 0 ? (account.futures ? '롱' : '보유') : '숏';
				parts.push(`${ name } ${ window.ChartDeskPaper.formatQty(position.qty) } @ ${ formatPrice(position.entry, this.precision) }${ account.futures ? ` ×${ account.leverage }` : '' }`,
					`평가 ${ pnl > 0 ? '+' : pnl < 0 ? '-' : '' }${ money(Math.abs(pnl)) } (${ formatPercent((pnl / position.margin * 100) || 0) })`);
				const liq = account.liquidation();
				if (liq) parts.push(`청산가 ${ formatPrice(liq, this.precision) }`);
			}
			parts.push(`주문 가능 ${ money(account.available()) }`);
			if (sum.trades) parts.push(`거래 ${ sum.trades }회 · 승률 ${ (sum.winRate * 100).toFixed(0) }%`);
			return parts.join(' · ');
		}

		/** 리플레이 막대에서 봉마다 바뀌는 부분(시각, 상태, 대기 주문)만 고친다. 입력 중인 칸은 그대로 둔다. */
		refreshReplayInfo() {
			const replay = this.replay;
			const refs = this.replayRefs;
			if (!replay || !refs) return;
			const time = this.bars[this.bars.length - 1]?.time;
			refs.pos.textContent = `${ time === undefined ? '' : new Date((time - TZ_OFFSET) * 1000).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } · 남은 봉 ${ replay.all.length - 1 - replay.index }`;
			const account = replay.account;
			if (!account || !refs.status) return;
			refs.status.textContent = this.paperStatus();
			refs.orders.replaceChildren(...account.orders.map(order => el('span', { class: `paper-order ${ order.side > 0 ? 'up' : 'down' }` },
				`지정 ${ account.sideName(order.side) } ${ window.ChartDeskPaper.formatQty(order.qty) } @ ${ formatPrice(order.price, this.precision) }`,
				el('button', { class: 'x', title: '주문 취소', text: '×', onclick: () => this.paperCancel(order.id) }))));
			refs.orders.hidden = account.orders.length === 0;
		}

		/** 주문 창: 시장가·지정가, 주문 크기(비율·금액·개수), 매수·매도 버튼. */
		paperControls() {
			const account = this.replay.account;
			const paper = state.paper;
			const futures = account.futures;
			const button = (text, title, onClick, extra = '') => el('button', { class: `text-btn ${ extra }`, text, title, onclick: onClick });
			const types = el('div', { class: 'seg paper-type' }, ...[['market', '시장가'], ['limit', '지정가']].map(([id, label]) => el('button', {
				class: paper.orderType === id ? 'on' : '',
				text: label,
				onclick: () => {
					paper.orderType = id;
					save();
					this.renderReplayBar();
				},
			})));
			const last = this.bars[this.bars.length - 1];
			this.replay.limitPrice ??= last?.close;
			const price = el('input', { type: 'number', step: 'any', min: '0', value: String(this.replay.limitPrice ?? ''), class: 'paper-price', 'aria-label': '지정가', title: '지정가. 차트 오른쪽 가격 축 옆의 + 로도 고를 수 있습니다' });
			price.addEventListener('input', () => {
				this.replay.limitPrice = Number(price.value);
			});
			const now = button('현재가', '지정가에 지금 봉 종가 넣기', () => {
				this.replay.limitPrice = this.bars[this.bars.length - 1]?.close;
				price.value = String(this.replay.limitPrice);
			});
			const unit = this.paperUnit();
			const modes = [['percent', '비율 %'], ['amount', `금액 (${ unit })`], ['qty', '개수']];
			const mode = selectInput(paper.sizeMode, modes, (value) => {
				paper.sizeMode = value;
				save();
				this.renderReplayBar();
			});
			mode.title = '주문 크기 방식. 비율은 주문 가능 현금의 %(반대 방향이면 포지션의 %), 금액은 넣을 증거금, 개수는 코인·주식·계약 수';
			const key = paper.sizeMode === 'amount' ? 'amount' : paper.sizeMode === 'qty' ? 'qty' : 'size';
			const amount = el('input', { type: 'number', step: 'any', min: '0', value: String(paper[key]), class: 'paper-amount', 'aria-label': '주문 크기' });
			amount.addEventListener('input', () => {
				const value = Number(amount.value);
				if (value > 0) {
					paper[key] = value;
					save();
				}
			});
			const quick = paper.sizeMode === 'percent'
				? [10, 25, 50, 100].map(value => button(`${ value }%`, `주문 가능 현금의 ${ value }%`, () => {
					paper.size = value;
					amount.value = String(value);
					save();
				}, 'paper-quick'))
				: [];
			const limit = paper.orderType === 'limit';
			this.replayRefs.status = el('div', { class: 'replay-row paper-status' });
			this.replayRefs.orders = el('div', { class: 'replay-row paper-orders' });
			return [
				el('div', { class: 'replay-row' }, types, ...(limit ? [price, now] : []), mode, amount, ...quick),
				el('div', { class: 'replay-row' },
					el('button', { class: 'paper-buy', text: `${ limit ? '지정가 ' : '' }${ futures ? '롱 ▲' : '매수 ▲' }`, title: limit ? '지정가에 매수 주문을 겁니다' : '지금 봉 종가로 매수', onclick: () => this.paperOrder(1) }),
					el('button', { class: 'paper-sell', text: `${ limit ? '지정가 ' : '' }${ futures ? '숏 ▼' : '매도 ▼' }`, title: limit ? '지정가에 매도 주문을 겁니다' : futures ? '지금 봉 종가로 숏 (롱이 있으면 그만큼 정리)' : '보유분을 지금 봉 종가로 매도', onclick: () => this.paperOrder(-1) }),
					button('½ 청산', '포지션 절반을 시장가로 정리', () => this.paperClose(0.5)),
					button('전체 청산', '포지션을 모두 시장가로 정리', () => this.paperClose(1))),
				this.replayRefs.orders,
				this.replayRefs.status,
			];
		}

		renderReplayBar() {
			const replay = this.replay;
			if (!replay) return;
			if (replay.setup) {
				this.renderPaperSetup();
				return;
			}
			const playing = replay.timer !== 0;
			const speeds = [1, 2, 5, 10, 30];
			const button = (text, title, onClick) => el('button', { class: 'text-btn', text, title, onclick: onClick });
			const speed = selectInput(replay.speed, speeds.map(value => [value, `${ value }봉/초`]), (value) => {
				replay.speed = Number(value);
				if (replay.timer) this.playReplay(true);
			});
			this.replayRefs = { pos: el('span', { class: 'replay-pos' }) };
			const rows = replay.account ? this.paperControls() : [];
			this.replayBar.replaceChildren(el('div', { class: 'replay-row' },
				this.replayGrip('리플레이'),
				button('⟲', '다른 시작 봉 고르기', () => {
					clearInterval(replay.timer);
					replay.timer = 0;
					const all = replay.all;
					this.announcePaper();
					this.clearPaperMarks();
					this.bars = all;
					this.setAllData();
					this.replay = null;
					this.replayBar.hidden = true;
					this.toggleReplay();
				}),
				button(playing ? '⏸' : '▶', playing ? '멈춤' : '재생', () => this.playReplay(!playing)),
				button('⏭', '한 봉 앞으로', () => this.stepReplay()),
				speed,
				this.replayRefs.pos,
				button('✕', '리플레이 끝내기', () => this.endReplay(true))), ...rows);
			this.replayBar.hidden = false;
			this.placeReplayBar();
			this.refreshReplayInfo();
		}

		playReplay(on) {
			const replay = this.replay;
			if (!replay) return;
			clearInterval(replay.timer);
			replay.timer = on ? setInterval(() => this.stepReplay(), 1000 / replay.speed) : 0;
			this.renderReplayBar();
		}

		stepReplay() {
			const replay = this.replay;
			if (!replay) return;
			if (replay.index >= replay.all.length - 1) {
				this.playReplay(false);
				toast('리플레이: 마지막 봉까지 봤습니다.');
				this.announcePaper();
				return;
			}
			replay.index++;
			const bar = replay.all[replay.index];
			this.bars.push(bar);
			if (replay.account) {
				const events = replay.account.onBar(bar);
				for (const event of events) toast(event);
				// 체결·청산이 일어나면 확인할 수 있게 재생을 멈춘다.
				if (events.length && replay.timer) this.playReplay(false);
				this.showPaperMarks();
			}
			const data = this.mainData();
			this.main.update(data[data.length - 1]);
			this.updateIndicatorTail();
			for (const compare of this.compares) {
				const at = barIndexAt(compare.bars, this.bars[this.bars.length - 1].time);
				if (at >= 0) compare.series.update({ time: compare.bars[at].time, value: compare.bars[at].close });
			}
			this.updateLegend();
			this.refreshReplayInfo();
		}

		// ----- 가격 축의 + 버튼 -----

		/** 십자선이 가격 패널 위에 있으면 오른쪽 가격 축 옆에 + 버튼을 그 가격 높이로 띄운다. */
		movePlus(param) {
			if (!this.main || !param.point) return;
			const y = param.point.y;
			const height = this.chart.panes()[0]?.getHeight() ?? 0;
			const price = this.main.coordinateToPrice(y);
			if (y < 0 || y > height || price === null || !Number.isFinite(price)) {
				this.plusButton.hidden = true;
				return;
			}
			this.plusPrice = Number(price.toFixed(this.precision));
			this.plusButton.style.top = `${ y - 10 }px`;
			this.plusButton.style.left = `${ this.chart.timeScale().width() - 24 }px`;
			this.plusButton.hidden = false;
		}

		/** + 버튼: 리플레이 모의 매매 중이면 그 가격의 지정가 주문, 아니면 그 가격의 알림. */
		openPlusMenu() {
			const price = this.plusPrice;
			if (!Number.isFinite(price)) return;
			const account = this.replay?.account;
			const label = formatPrice(price, this.precision);
			const rows = [el('p', { class: 'title', text: label })];
			if (account) {
				const sizing = this.paperSizing();
				const sizeText = sizing.mode === 'percent' ? `${ sizing.value }%` : sizing.mode === 'amount' ? this.paperMoney(sizing.value) : `${ sizing.value }개`;
				rows.push(
					el('button', { class: 'menu-option plus-buy', text: `지정가 ${ account.sideName(1) } @ ${ label }`, onclick: () => {
						closePopover();
						this.paperOrder(1, price);
					} }),
					el('button', { class: 'menu-option plus-sell', text: `지정가 ${ account.sideName(-1) } @ ${ label }`, onclick: () => {
						closePopover();
						this.paperOrder(-1, price);
					} }),
					el('button', { class: 'menu-option', text: '주문 창의 지정가로 넣기', onclick: () => {
						closePopover();
						state.paper.orderType = 'limit';
						this.replay.limitPrice = price;
						this.renderReplayBar();
					} }),
					el('p', { class: 'hint', text: `주문 크기 ${ sizeText } (주문 창에서 바꿉니다). 지금가보다 불리한 쪽이면 바로 체결됩니다.` }));
			}
			else if (!this.replay) {
				rows.push(el('button', { class: 'menu-option', text: `${ label }에 가격 알림 추가`, onclick: () => {
					closePopover();
					const last = this.lastPrice();
					if (last !== undefined) addAlert(this.cfg.symbol, price, last);
					toast(`알림을 만들었습니다: ${ symbolTitle(this.cfg.symbol) } ${ label }`);
				} }));
			}
			else rows.push(el('p', { class: 'hint', text: '모의 매매로 시작한 리플레이에서 이 가격에 지정가 주문을 걸 수 있습니다.' }));
			popover.className = 'popover';
			openPopover(this.plusButton, ...rows);
		}

		/** 모의 매매 결과를 알린다. */
		announcePaper() {
			const account = this.replay?.account;
			const bar = this.bars[this.bars.length - 1];
			if (!account || !bar || (account.trades.length === 0 && !account.position)) return;
			const unit = this.paperUnit();
			const money = value => `${ value.toLocaleString('ko-KR', { maximumFractionDigits: unit === '원' ? 0 : 2 }) } ${ unit }`;
			const sum = account.summary(bar.close);
			toast(`모의 매매 결과: ${ money(account.seed) } → ${ money(sum.equity) } (${ formatPercent(sum.ret * 100) }) · 거래 ${ sum.trades }회 · 승률 ${ (sum.winRate * 100).toFixed(0) }%${ account.position ? ' · 열린 포지션은 마지막 종가로 평가' : '' }`);
		}

		/** 리플레이를 끝낸다. reload면 최신 봉을 다시 받고 실시간으로 돌아간다. */
		endReplay(reload = false) {
			const wasActive = this.replay !== null || this.picking;
			if (this.replay?.account && reload) this.announcePaper();
			if (this.replay) this.clearPaperMarks();
			if (this.replay) clearInterval(this.replay.timer);
			this.replay = null;
			this.picking = false;
			this.body.classList.remove('picking');
			this.replayBar.hidden = true;
			this.replayButton.classList.remove('on');
			if (reload && wasActive) this.load();
		}

		// ----- 백테스트 거래 표시 -----

		showTrades(markers) {
			this.clearTrades();
			this.markers = LC.createSeriesMarkers(this.main, markers);
		}

		clearTrades() {
			this.markers?.detach();
			this.markers = null;
		}

		/** 백테스트가 받아 온 과거 봉을 앞에 붙인다. */
		prependBars(older) {
			if (this.replay || older.length === 0 || this.bars.length === 0) return;
			const first = this.bars[0].time;
			const before = older.filter(bar => bar.time < first);
			if (before.length === 0) return;
			const range = this.chart.timeScale().getVisibleLogicalRange();
			this.bars = before.concat(this.bars);
			this.setAllData();
			if (range) this.chart.timeScale().setVisibleLogicalRange({ from: range.from + before.length, to: range.to + before.length });
		}

		/** 그 시각의 봉이 화면 가운데 오게 옮긴다. */
		scrollToTime(time) {
			const index = barIndexAt(this.bars, time);
			if (index < 0) return;
			const range = this.chart.timeScale().getVisibleLogicalRange();
			const width = range ? range.to - range.from : 100;
			this.chart.timeScale().setVisibleLogicalRange({ from: index - width / 2, to: index + width / 2 });
		}

		/** 지금 봉이 마감될 때까지 남은 시간. 장이 닫혀 봉이 더 만들어지지 않으면 null. */
		countdown() {
			const last = this.bars[this.bars.length - 1];
			let seconds = INTERVAL_SECONDS[this.cfg.interval];
			if (!last || !seconds || this.replay) return null;
			if (this.cfg.interval === '1M') {
				const start = new Date((last.time - TZ_OFFSET) * 1000);
				seconds = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) / 1000 + TZ_OFFSET - last.time;
			}
			// 장이 정해진 종목의 일봉·주봉은 봉의 끝이 자정이 아니라 장 마감이라 표시하지 않는다.
			if (seconds >= 86400 && !PROV.resolve(this.cfg.symbol).provider.realtime && PROV.resolve(this.cfg.symbol).provider.sessions) return null;
			const left = Math.round(last.time + seconds - (Date.now() / 1000 + TZ_OFFSET));
			if (left <= 0 || left > seconds) return null;
			const pad = value => String(value).padStart(2, '0');
			const [days, hours, minutes] = [Math.floor(left / 86400), Math.floor(left % 86400 / 3600), Math.floor(left % 3600 / 60)];
			const text = days > 0 ? `${ days }일 ${ pad(hours) }:${ pad(minutes) }`
				: hours > 0 ? `${ hours }:${ pad(minutes) }:${ pad(left % 60) }`
					: `${ pad(minutes) }:${ pad(left % 60) }`;
			const colors = cssColors();
			return { price: last.close, text, color: last.close >= last.open ? colors.up : colors.down };
		}

		tick() {
			// 가격 축의 남은 시간 표시를 1초마다 새로 그린다.
			this.layer.redraw();
			const offset = TZ_OFFSET / 3600;
			this.clock.textContent = `${ new Date().toLocaleTimeString('en-GB') } (UTC${ offset >= 0 ? '+' : '' }${ offset })`;
			this.refreshScaleButtons();
		}

		destroy() {
			this.dead = true;
			this.endReplay();
			this.closeSocket();
			this.compares.forEach(compare => clearInterval(compare.timer));
			this.resizeObserver.disconnect();
			this.layer.destroy();
			this.chart.remove();
			this.root.remove();
		}
	}

	function broadcastCrosshair(source, time) {
		for (const pane of panes) {
			if (pane !== source) pane.showCrosshairAt(state.crosshairSync ? time : undefined);
		}
	}

	function toggleExtended() {
		state.extended = !state.extended;
		PROV.options.extended = state.extended;
		save();
		for (const pane of panes) {
			pane.refreshScaleButtons();
			if (pane.hasSessions()) pane.load();
		}
	}

	function setSymbol(pane, symbol) {
		if (!pane) return;
		const targets = state.linkSymbols ? panes : [pane];
		targets.forEach(target => target.changeSymbol(symbol));
		notifyChange();
		save();
		renderTabs();
		renderDetail();
		ticker.sync();
	}

	function setActivePane(index) {
		const tab = activeTab();
		if (tab.active !== index) {
			tab.active = index;
			save();
		}
		panes.forEach((pane, i) => pane.root.classList.toggle('active', panes.length > 1 && i === tab.active));
		renderDetail();
		notifyChange();
	}

	// ---------- 탭과 배치 ----------

	function tabTitle(tab) {
		const symbols = [...new Set(tab.panes.slice(0, tab.layout).map(pane => symbolTitle(pane.symbol)))];
		return symbols.length > 2 ? `${ symbols.slice(0, 2).join(' · ') } 외 ${ symbols.length - 2 }` : symbols.join(' · ');
	}

	function renderTabs() {
		const single = state.tabs.length === 1;
		$('tabs').replaceChildren(...state.tabs.map((tab) => {
			const node = el('div', {
				class: `tab${ tab.id === state.activeTab ? ' active' : '' }${ single ? ' only' : '' }`,
				onclick: () => {
					if (tab.id === state.activeTab) return;
					state.activeTab = tab.id;
					save();
					renderWorkspace();
				},
			}, el('span', { text: tabTitle(tab) }));
			if (!single) {
				node.append(el('button', {
					class: 'close',
					title: '탭 닫기',
					text: '×',
					onclick: (event) => {
						event.stopPropagation();
						closeTab(tab.id);
					},
				}));
			}
			return node;
		}));
	}

	function closeTab(id) {
		const index = state.tabs.findIndex(tab => tab.id === id);
		state.tabs.splice(index, 1);
		const wasActive = state.activeTab === id;
		if (wasActive) state.activeTab = state.tabs[Math.max(0, index - 1)].id;
		save();
		if (wasActive) renderWorkspace();
		else renderTabs();
	}

	function renderWorkspace() {
		closePopover();
		panes.forEach(pane => pane.destroy());
		panes = [];
		const tab = activeTab();
		const grid = $('grid');
		grid.className = `grid layout-${ tab.layout }`;
		// 배치를 줄였다가 다시 늘려도 예전 패널 설정이 남아 있도록 배열은 줄이지 않는다.
		while (tab.panes.length < tab.layout) tab.panes.push(sanitizePane(structuredClone(tab.panes[tab.active] ?? tab.panes[0])));
		if (tab.active >= tab.layout) tab.active = 0;
		for (let i = 0; i < tab.layout; i++) panes.push(new Pane(tab, i, grid));
		panes.forEach(pane => pane.tick());
		setActivePane(tab.active);
		for (const button of $('layout-seg').children) {
			button.classList.toggle('on', Number(button.dataset.layout) === tab.layout);
		}
		renderTabs();
		ticker.sync();
	}

	// ---------- 왼쪽 작도 도구 막대 ----------

	const toolButtons = new Map();
	const toolGroups = new Map();
	const groupOfTool = new Map(DRAW.GROUPS.flatMap(group => group.sections.flatMap(([, ids]) => ids.map(id => [id, group.id]))));
	const toolIcon = tool => (ICONS[tool.id] ? tool.id : tool.icon);

	/** 묶음의 대표 도구. 마지막으로 고른 도구를 기억한다. */
	function pickedTool(group) {
		const picked = state.toolPicks[group.id];
		return groupOfTool.get(picked) === group.id ? picked : group.sections[0][1][0];
	}

	function buildTools() {
		const bar = $('tools');
		const add = (key, iconName, title, onClick) => {
			const button = iconButton(iconName, title, { 'data-tool': key, onclick: onClick });
			toolButtons.set(key, button);
			bar.append(button);
		};
		const separator = () => bar.append(el('span', { class: 'sep' }));

		add('cursor', 'cursor', '선택 (Esc)', () => setTool(null));
		separator();
		// 묶음마다 대표 도구 버튼 하나와, 같은 묶음의 다른 도구를 고르는 펼침 버튼을 둔다.
		for (const group of DRAW.GROUPS) {
			const main = el('button', { class: 'icon-btn' });
			main.addEventListener('click', () => setTool(activeTool === main.dataset.tool ? null : main.dataset.tool));
			const more = el('button', { class: 'tool-more', title: `${ group.name } 펼치기`, 'data-group': group.id }, icon('more'));
			const node = el('div', { class: 'tool-group' }, main, more);
			const open = () => openToolMenu(node, group);
			more.addEventListener('click', open);
			node.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				open();
			});
			toolGroups.set(group.id, { group, main });
			bar.append(node);
		}
		separator();
		add('ruler', 'ruler', '재기: 두 점 사이의 가격·기간을 잰다 (Shift+차트 클릭). 다음 클릭에서 사라집니다.', () => setTool(activeTool === 'ruler' ? null : 'ruler'));
		add('zoom', 'zoom', '확대: 차트에서 두 번 눌러 고른 영역을 화면에 채웁니다', () => setTool(activeTool === 'zoom' ? null : 'zoom'));
		separator();
		add('magnet', 'magnet', '자석: 시가·고가·저가·종가에 붙이기', () => {
			state.magnet = !state.magnet;
			save();
			refreshTools();
		});
		add('hide', 'eye', '작도 숨기기', () => {
			state.hideDrawings = !state.hideDrawings;
			if (state.hideDrawings) {
				setTool(null);
				panes.forEach(pane => pane.layer.select(null));
			}
			save();
			refreshTools();
			panes.forEach(pane => pane.layer.redraw());
		});
		separator();
		add('undo', 'undo', '되돌리기 (Ctrl+Z)', () => travel(history.past, history.future));
		add('redo', 'redo', '다시 실행 (Ctrl+Y)', () => travel(history.future, history.past));
		add('clear', 'trash', '이 종목의 작도 모두 지우기', () => {
			const symbol = activePane()?.cfg.symbol;
			if (!symbol || drawingsFor(symbol).length === 0) return;
			state.drawings[symbol] = [];
			panes.forEach(pane => pane.layer.select(null));
			drawingsChanged(true);
			toast(`${ symbolTitle(symbol) } 작도를 모두 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.`);
		});
	}

	function openToolMenu(anchor, group) {
		const rows = [];
		for (const [title, ids] of group.sections) {
			rows.push(el('div', { class: 'category', text: title }));
			for (const id of ids) {
				const tool = DRAW.byId.get(id);
				rows.push(el('button', {
					class: `option tool-option${ id === activeTool ? ' on' : '' }`,
					'data-tool-item': id,
					onclick: () => {
						closePopover();
						setTool(id);
					},
				}, icon(toolIcon(tool)), el('span', { text: tool.name }), el('kbd', { text: tool.key ? `Alt+${ tool.key }` : '' })));
			}
		}
		popover.className = 'popover toolmenu';
		openPopover(anchor, ...rows);
	}

	function refreshTools() {
		for (const { group, main } of toolGroups.values()) {
			const tool = DRAW.byId.get(pickedTool(group));
			if (main.dataset.tool !== tool.id) {
				main.dataset.tool = tool.id;
				main.title = `${ tool.name }${ tool.key ? ` (Alt+${ tool.key })` : '' } · 오른쪽 화살표로 다른 도구 선택`;
				main.replaceChildren(icon(toolIcon(tool)));
			}
			main.classList.toggle('on', tool.id === activeTool);
		}
		for (const [key, button] of toolButtons) {
			const on = key === 'cursor' ? activeTool === null
				: key === 'magnet' ? state.magnet
					: key === 'hide' ? state.hideDrawings
						: key === activeTool;
			if (['cursor', 'magnet', 'hide', 'ruler', 'zoom'].includes(key)) button.classList.toggle('on', on);
		}
		toolButtons.get('undo').disabled = history.past.length === 0;
		toolButtons.get('redo').disabled = history.future.length === 0;
	}

	// ---------- 상단 바와 단축키 ----------

	function applyTheme() {
		document.documentElement.dataset.theme = state.theme;
		panes.forEach((pane) => {
			pane.applyTheme();
			// 기준선과 알림선 색도 테마를 따른다.
			pane.buildIndicators();
			pane.syncPriceLines();
		});
	}

	function toggleButton(id, key, after) {
		const button = $(id);
		button.classList.toggle('on', state[key]);
		button.addEventListener('click', () => {
			state[key] = !state[key];
			button.classList.toggle('on', state[key]);
			save();
			after?.();
		});
	}

	function saveScreenshot() {
		const pane = activePane();
		if (!pane) return;
		pane.chart.takeScreenshot().toBlob((blob) => {
			if (!blob) return;
			const link = el('a', {
				href: URL.createObjectURL(blob),
				download: `${ symbolInfo(pane.cfg.symbol).display.replace(/[^\w.-]/g, '') }_${ pane.cfg.interval }_${ new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') }.png`,
			});
			link.click();
			setTimeout(() => URL.revokeObjectURL(link.href), 1000);
		});
	}

	$('theme-btn').append(icon('theme'));
	$('shot-btn').append(icon('camera'));
	$('opt-sync').append(icon('sync'));
	$('opt-link').append(icon('link'));
	$('tab-add').append(icon('plus'));
	$('wl-add').append(icon('plus'));

	$('tab-add').addEventListener('click', () => {
		const tab = { id: uid(), layout: 1, active: 0, panes: [defaultPane(activePane()?.cfg.symbol)] };
		state.tabs.push(tab);
		state.activeTab = tab.id;
		save();
		renderWorkspace();
	});

	$('layout-seg').addEventListener('click', (event) => {
		const layout = Number(event.target.dataset?.layout);
		const tab = activeTab();
		if (!LAYOUTS.includes(layout) || layout === tab.layout) return;
		tab.layout = layout;
		save();
		renderWorkspace();
	});

	toggleButton('opt-sync', 'crosshairSync', () => {
		if (!state.crosshairSync) panes.forEach(pane => pane.showCrosshairAt(undefined));
	});
	toggleButton('opt-link', 'linkSymbols');

	$('theme-btn').addEventListener('click', () => {
		popover.className = 'popover';
		openPopover($('theme-btn'), el('p', { class: 'title', text: '테마' }), ...THEMES.map(([id, label, colors]) => el('button', {
			class: `theme-option${ id === state.theme ? ' on' : '' }`,
			'data-theme-id': id,
			onclick: () => setTheme(id),
		}, el('span', { class: 'theme-chips' }, ...colors.map((color) => {
			const chip = el('i');
			chip.style.background = color;
			return chip;
		})), el('span', { text: label }))));
	});

	function setTheme(id) {
		closePopover();
		if (id === state.theme) return;
		state.theme = id;
		save();
		applyTheme();
	}

	$('shot-btn').addEventListener('click', saveScreenshot);

	// ---------- 설정 내보내기·가져오기 ----------
	// 지표, 작도, 관심종목, 테마, AI 창 설정처럼 이 브라우저(앱)에 저장된 chartdesk.* 값을 파일 하나로 옮긴다.
	// AI API 키는 서버 쪽 파일에 있어서 들어가지 않는다.
	const SETTINGS_PREFIX = 'chartdesk.';
	const SETTINGS_FORMAT = 'chartdesk-settings';

	/** 지금 설정(chartdesk.* 값)을 모은다. 예약된 저장을 먼저 끝낸다. 읽지 못하면 null. */
	function snapshotSettings() {
		const storage = {};
		try {
			if (!savingFrozen) {
				clearTimeout(saveTimer);
				localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			}
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key.startsWith(SETTINGS_PREFIX)) storage[key] = localStorage.getItem(key);
			}
		}
		catch {
			return null;
		}
		return storage;
	}

	const settingsFile = storage => JSON.stringify({ format: SETTINGS_FORMAT, version: 1, exportedAt: new Date().toISOString(), storage }, null, 2);

	/** 설정 파일의 내용에서 옮길 값만 고른다. ChartDesk 설정이 아니면 null. */
	function settingsEntries(parsed) {
		const entries = parsed?.format === SETTINGS_FORMAT && parsed.storage && typeof parsed.storage === 'object'
			? Object.entries(parsed.storage).filter(([key, value]) => key.startsWith(SETTINGS_PREFIX) && typeof value === 'string')
			: [];
		return entries.some(([key]) => key === STORAGE_KEY) ? entries : null;
	}

	/** 가져온 값을 저장하고 화면을 다시 불러온다. exact면 가져온 값에 없는 설정은 지운다. */
	function applySettings(entries, exact = false) {
		// 가져온 값이 저장 중인 현재 상태에 덮이지 않게, 예약된 저장을 취소하고 다시 읽는다.
		clearTimeout(saveTimer);
		if (exact) {
			const keep = new Set(entries.map(([key]) => key));
			for (let i = localStorage.length - 1; i >= 0; i--) {
				const key = localStorage.key(i);
				if (key.startsWith(SETTINGS_PREFIX) && !keep.has(key)) localStorage.removeItem(key);
			}
		}
		for (const [key, value] of entries) localStorage.setItem(key, value);
		savingFrozen = true;
		location.reload();
	}

	function exportSettings() {
		closePopover();
		const storage = snapshotSettings();
		if (!storage) {
			toast('설정을 읽지 못했습니다.');
			return;
		}
		const body = settingsFile(storage);
		const link = el('a', {
			href: URL.createObjectURL(new Blob([body], { type: 'application/json' })),
			download: `chartdesk-settings_${ new Date().toISOString().slice(0, 10) }.json`,
		});
		link.click();
		setTimeout(() => URL.revokeObjectURL(link.href), 1000);
	}

	function importSettings() {
		closePopover();
		const input = el('input', { type: 'file', accept: '.json,application/json' });
		input.addEventListener('change', async () => {
			const file = input.files?.[0];
			if (!file) return;
			let parsed;
			try {
				parsed = JSON.parse(await file.text());
			}
			catch {
				toast('설정 파일을 읽지 못했습니다. JSON 형식이 아닙니다.');
				return;
			}
			const entries = settingsEntries(parsed);
			if (!entries) {
				toast('ChartDesk 설정 파일이 아닙니다.');
				return;
			}
			try {
				applySettings(entries);
			}
			catch {
				toast('설정을 저장하지 못했습니다.');
			}
		});
		input.click();
	}

	// ---------- GitHub Gist 동기화 ----------
	// 설정 파일과 같은 내용을 사용자의 비공개 Gist 하나(chartdesk-settings.json)에 두고 PC와 휴대폰이 같이 쓴다.
	// 토큰과 동기화 기록은 'chartdesk-sync'에 둔다. 'chartdesk.'로 시작하지 않아 설정 파일과 Gist에는 들어가지 않는다.
	// 마지막으로 맞춘 내용의 해시(base)와 비교해 한쪽만 바뀌었으면 그쪽을 따르고, 둘 다 바뀌었으면 사용자에게 묻는다.
	const SYNC_KEY = 'chartdesk-sync';
	const SYNC_FILE = 'chartdesk-settings.json';
	const SYNC_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=ChartDesk%20sync';

	function loadSync() {
		try {
			const saved = JSON.parse(localStorage.getItem(SYNC_KEY));
			if (saved && typeof saved.token === 'string') return saved;
		}
		catch {
			// 기록이 없거나 깨졌으면 연결하지 않은 것으로 본다.
		}
		return null;
	}

	let sync = loadSync();

	function saveSync() {
		try {
			if (sync) localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
			else localStorage.removeItem(SYNC_KEY);
		}
		catch {
			// 저장하지 못하면 다음 실행에서 다시 연결하면 된다.
		}
	}

	/** 저장한 순서와 상관없이 같은 설정이면 같은 값이 나오는 해시. */
	function settingsHash(storage) {
		const text = JSON.stringify(Object.keys(storage).sort().map(key => [key, storage[key]]));
		let hash = 0x811c9dc5;
		for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
		return `${ (hash >>> 0).toString(16) }-${ text.length }`;
	}

	class SyncError extends Error {
		constructor(message, status = 0) {
			super(message);
			this.status = status;
		}
	}

	async function github(path, options = {}) {
		let response;
		try {
			response = await fetch(`https://api.github.com${ path }`, {
				...options,
				cache: 'no-store',
				headers: {
					Accept: 'application/vnd.github+json',
					Authorization: `Bearer ${ sync.token }`,
					'X-GitHub-Api-Version': '2022-11-28',
					...(options.body ? { 'Content-Type': 'application/json' } : {}),
				},
			});
		}
		catch {
			throw new SyncError('GitHub에 연결하지 못했습니다. 인터넷 연결을 확인하세요.');
		}
		if (response.status === 401) throw new SyncError('GitHub 토큰이 맞지 않거나 만료되었습니다. 연결을 해제하고 새 토큰으로 연결하세요.', 401);
		if (response.status === 403) throw new SyncError('GitHub가 요청을 거부했습니다. 토큰에 gist 권한이 있는지 확인하세요.', 403);
		if (response.status === 404) throw new SyncError('Gist를 찾지 못했습니다.', 404);
		if (!response.ok) throw new SyncError(`GitHub 오류 (${ response.status })`, response.status);
		return response.json();
	}

	/** Gist에 올라간 설정. 아직 없으면 null. */
	async function fetchRemote() {
		let gist = null;
		if (sync.gistId) {
			try {
				gist = await github(`/gists/${ sync.gistId }`);
			}
			catch (error) {
				// 다른 곳에서 Gist를 지웠으면 다시 찾는다.
				if (error.status !== 404) throw error;
			}
		}
		if (!gist?.files?.[SYNC_FILE]) {
			gist = null;
			for (let page = 1; page <= 10 && !gist; page++) {
				const list = await github(`/gists?per_page=100&page=${ page }`);
				const found = list.find(item => item.files?.[SYNC_FILE]);
				if (found) gist = await github(`/gists/${ found.id }`);
				if (list.length < 100) break;
			}
		}
		sync.gistId = gist?.id ?? null;
		if (!gist) return null;
		const file = gist.files[SYNC_FILE];
		let text = file.content;
		// 1MB가 넘으면 API 응답에서 잘리므로 원본 주소에서 받는다.
		if (file.truncated) {
			try {
				text = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
			}
			catch {
				throw new SyncError('Gist의 설정 파일을 받지 못했습니다.');
			}
		}
		let entries = null;
		try {
			entries = settingsEntries(JSON.parse(text));
		}
		catch {
			// 아래에서 알린다.
		}
		if (!entries) throw new SyncError(`Gist의 ${ SYNC_FILE }이 ChartDesk 설정 파일이 아닙니다.`);
		return { entries, hash: settingsHash(Object.fromEntries(entries)) };
	}

	async function pushRemote(storage) {
		const files = { [SYNC_FILE]: { content: settingsFile(storage) } };
		const gist = sync.gistId
			? await github(`/gists/${ sync.gistId }`, { method: 'PATCH', body: JSON.stringify({ files }) })
			: await github('/gists', { method: 'POST', body: JSON.stringify({ description: 'ChartDesk 설정 동기화', public: false, files }) });
		sync.gistId = gist.id;
	}

	function syncDone(hash) {
		sync.base = hash;
		sync.syncedAt = Date.now();
		sync.error = null;
		saveSync();
	}

	let syncing = null;
	let syncPrompt = null;

	/**
	 * mode가 'auto'면 바뀐 쪽을 따른다. 'push'는 이 기기 설정을 올리고 'pull'은 Gist 설정을 받는다.
	 * 결과를 글로 돌려준다. 설정을 받으면 화면을 다시 불러온다.
	 */
	function runSync(mode = 'auto') {
		if (!sync) return Promise.resolve('GitHub에 연결되어 있지 않습니다.');
		if (syncing) return syncing;
		syncing = (async () => {
			try {
				const local = snapshotSettings();
				if (!local) throw new SyncError('설정을 읽지 못했습니다.');
				const localHash = settingsHash(local);
				const remote = await fetchRemote();
				if (mode === 'pull') return remote ? receive(remote) : '아직 올린 설정이 없습니다.';
				if (mode === 'push' || !remote) {
					await pushRemote(local);
					syncDone(localHash);
					return '이 기기의 설정을 올렸습니다.';
				}
				if (remote.hash === localHash) {
					syncDone(localHash);
					return '설정이 같습니다.';
				}
				const localChanged = localHash !== sync.base;
				const remoteChanged = remote.hash !== sync.base;
				if (remoteChanged && !localChanged) return receive(remote);
				if (localChanged && !remoteChanged) {
					await pushRemote(local);
					syncDone(localHash);
					return '이 기기의 설정을 올렸습니다.';
				}
				saveSync();
				// 처음 연결한 기기는 맞춘 적이 없어서 어느 쪽이 새 설정인지 알 수 없다.
				const message = sync.base
					? '이 기기와 다른 기기에서 모두 설정이 바뀌었습니다. 어느 쪽을 쓸까요?'
					: 'Gist에 다른 기기의 설정이 있습니다. 어느 쪽을 쓸까요?';
				askConflict(message);
				return message;
			}
			catch (error) {
				const message = error instanceof SyncError ? error.message : `동기화하지 못했습니다: ${ error.message }`;
				if (sync) {
					sync.error = message;
					saveSync();
				}
				throw new SyncError(message);
			}
			finally {
				syncing = null;
			}
		})();
		return syncing;
	}

	function receive(remote) {
		syncDone(remote.hash);
		try {
			sessionStorage.setItem(SYNC_KEY, '1');
		}
		catch {
			// 다시 불러온 뒤 알림만 못 띄운다.
		}
		applySettings(remote.entries, true);
		return '다른 기기의 설정을 받았습니다.';
	}

	/** 양쪽이 모두 바뀌었을 때 어느 쪽을 쓸지 묻는다. 고를 때까지 자동 동기화를 멈춘다. */
	function askConflict(message) {
		if (syncPrompt) return;
		const choose = mode => async () => {
			syncPrompt?.remove();
			syncPrompt = null;
			try {
				toast(await runSync(mode));
			}
			catch (error) {
				toast(error.message);
			}
		};
		syncPrompt = el('div', { class: 'toast sync-ask' },
			el('div', { text: message }),
			el('div', { class: 'actions' },
				el('button', { class: 'text-btn', text: '이 기기 설정 올리기', onclick: choose('push') }),
				el('button', { class: 'text-btn', text: '다른 기기 설정 받기', onclick: choose('pull') }),
			),
		);
		$('toasts').append(syncPrompt);
	}

	// 자동 동기화: 켤 때, 화면으로 돌아올 때, 5분마다, 설정을 바꾸고 15초 뒤에 맞춘다.
	let autoSyncTimer = 0;
	let lastAutoSync = 0;

	function autoSync(delay = 0) {
		clearTimeout(autoSyncTimer);
		if (!sync || sync.auto === false || savingFrozen) return;
		autoSyncTimer = setTimeout(() => {
			if (!sync || syncPrompt || savingFrozen || document.visibilityState !== 'visible') return;
			lastAutoSync = Date.now();
			runSync('auto').catch(() => {
				// 오류는 설정 창의 동기화 상태에 보인다.
			});
		}, delay);
	}

	onSave = () => autoSync(15000);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && Date.now() - lastAutoSync > 30000) autoSync(500);
	});
	setInterval(() => autoSync(), 5 * 60 * 1000);
	autoSync(1500);
	try {
		if (sessionStorage.getItem(SYNC_KEY)) {
			sessionStorage.removeItem(SYNC_KEY);
			toast('다른 기기의 설정을 받았습니다.');
		}
	}
	catch {
		// sessionStorage를 못 쓰면 알림만 생략한다.
	}

	async function connectSync(token) {
		sync = { token, auto: true, gistId: null, base: null };
		try {
			sync.login = (await github('/user')).login;
		}
		catch (error) {
			sync = null;
			throw error;
		}
		saveSync();
		return runSync('auto');
	}

	/** 설정 창의 'GitHub 동기화' 부분 */
	function syncSection() {
		const status = el('p', { class: 'hint' });
		const box = el('div', { class: 'sync' }, el('p', { class: 'title', text: 'GitHub 동기화' }));
		if (!sync) {
			const input = el('input', { type: 'password', placeholder: 'GitHub 토큰 (ghp_…)', autocomplete: 'off', spellcheck: 'false' });
			const connect = el('button', { class: 'primary', text: '연결' });
			const submit = async () => {
				const token = input.value.trim();
				if (!token) return;
				connect.disabled = true;
				status.textContent = '연결 중…';
				let result;
				try {
					result = await connectSync(token);
				}
				catch (error) {
					// 토큰은 맞았는데 동기화가 실패했으면 연결된 화면에서 오류를 보여 준다.
					if (!sync) {
						status.textContent = error.status === 401 ? 'GitHub 토큰이 맞지 않습니다. 토큰을 다시 확인하세요.' : error.message;
						connect.disabled = false;
						return;
					}
				}
				const next = syncSection();
				if (result) next.querySelector('.sync-status').textContent = result;
				box.replaceWith(next);
			};
			connect.addEventListener('click', submit);
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') submit();
			});
			box.append(
				el('p', { class: 'hint', text: 'PC와 휴대폰에 같은 GitHub 토큰을 넣으면 설정을 비공개 Gist 하나로 맞춥니다. 토큰에는 gist 권한만 주면 되고, 토큰은 이 기기에만 저장됩니다.' }),
				el('a', { class: 'hint sync-link', href: SYNC_TOKEN_URL, target: '_blank', rel: 'noopener', text: '토큰 만들기 (GitHub) ↗' }),
				el('div', { class: 'sync-row' }, input, connect),
				status,
			);
			return box;
		}
		status.classList.add('sync-status');
		const syncedAt = sync.syncedAt ? new Date(sync.syncedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
		status.textContent = sync.error ?? (syncedAt ? `마지막 동기화: ${ syncedAt }` : '아직 동기화하지 않았습니다.');
		const auto = el('input', { type: 'checkbox' });
		auto.checked = sync.auto !== false;
		auto.addEventListener('change', () => {
			sync.auto = auto.checked;
			saveSync();
			autoSync();
		});
		const buttons = [['auto', '지금 동기화'], ['push', '올리기'], ['pull', '받기']].map(([mode, text]) => el('button', { class: 'text-btn', 'data-sync': mode, text }));
		for (const button of buttons) {
			button.addEventListener('click', async () => {
				buttons.forEach(item => item.disabled = true);
				status.textContent = '동기화 중…';
				try {
					status.textContent = await runSync(button.dataset.sync);
				}
				catch (error) {
					status.textContent = error.message;
				}
				buttons.forEach(item => item.disabled = false);
			});
		}
		const disconnect = el('button', { class: 'text-btn', text: '연결 해제', onclick: () => {
			sync = null;
			saveSync();
			clearTimeout(autoSyncTimer);
			syncPrompt?.remove();
			syncPrompt = null;
			box.replaceWith(syncSection());
		} });
		box.append(
			el('p', { class: 'hint', text: `${ sync.login ?? 'GitHub' } 계정의 비공개 Gist와 설정을 맞춥니다. Gist를 지우지 않는 한 연결을 해제해도 올린 설정은 남습니다.` }),
			el('label', { class: 'field' }, el('span', { text: '자동 동기화' }), auto),
			el('div', { class: 'sync-row' }, ...buttons, disconnect),
			status,
		);
		return box;
	}

	$('settings-btn').append(icon('gear'));
	$('settings-btn').addEventListener('click', () => {
		const desktop = window.chartdeskApp;
		const version = el('p', { class: 'version', text: desktop ? `ChartDesk ${ desktop.version }` : '브라우저에서 실행 중' });
		const items = [
			el('p', { class: 'title', text: '설정' }),
			el('button', { class: 'menu-option', 'data-action': 'export-settings', text: '설정 내보내기', onclick: exportSettings }),
			el('button', { class: 'menu-option', 'data-action': 'import-settings', text: '설정 가져오기', onclick: importSettings }),
			el('p', { class: 'hint', text: '지표, 작도, 관심종목, 알림, 테마, AI 창 설정을 파일로 옮깁니다. AI API 키는 들어가지 않습니다. 가져오면 지금 설정을 덮어쓰고 화면을 다시 불러옵니다.' }),
			syncSection(),
			version,
			el('button', { class: 'menu-option', 'data-action': 'changelog', text: '업데이트 내역', onclick: () => window.ChartDeskLab?.openChangelog() }),
		];
		if (desktop) {
			const status = el('p', { class: 'version', text: desktop.updateStatus() });
			items.push(status, el('button', { class: 'menu-option', 'data-action': 'check-update', text: '업데이트 확인', onclick: async () => {
				status.textContent = '업데이트 확인 중…';
				status.textContent = await desktop.checkForUpdates();
			} }));
		}
		popover.className = 'popover app-menu';
		openPopover($('settings-btn'), ...items);
	});

	// 관심종목의 ＋로 고른 종목은 목록에 넣으면서 차트에도 바로 띄운다.
	$('wl-add').addEventListener('click', () => {
		openSymbolPicker($('wl-add'), (symbol) => {
			if (!state.watchlist.includes(symbol)) toggleWatch(symbol);
			setSymbol(activePane(), symbol);
		});
	});

	function openSearch(initial = '') {
		openSymbolPicker($('search-btn'), symbol => setSymbol(activePane(), symbol), initial);
	}
	$('search-btn').prepend(icon('search'));
	$('search-btn').addEventListener('click', () => openSearch());

	if ('Notification' in window && Notification.permission === 'default') {
		const button = $('notify-btn');
		button.hidden = false;
		button.addEventListener('click', async() => {
			await Notification.requestPermission();
			button.hidden = true;
		});
	}

	document.addEventListener('keydown', (event) => {
		const typing = event.target instanceof HTMLElement && event.target.matches('input, textarea, select');
		if (event.key === 'Escape') {
			const picking = panes.find(pane => pane.picking);
			if (picking) picking.endReplay(true);
			else if (!popover.hidden) closePopover();
			else if (activeTool) setTool(null);
			else {
				panes.forEach((pane) => {
					pane.layer.cancel();
					if (pane.layer.selectedId) pane.layer.select(null);
				});
			}
			return;
		}
		if (typing) return;
		const key = event.key.toLowerCase();
		if (event.key === 'Enter' && panes.some(pane => pane.layer.finish())) {
			event.preventDefault();
			return;
		}
		// 차트 화면에서 글자를 치면 그 글자로 종목 검색을 시작한다.
		if (!event.ctrlKey && !event.metaKey && !event.altKey && popover.hidden && (event.key === '/' || /^[a-z0-9]$/i.test(event.key))) {
			event.preventDefault();
			openSearch(event.key === '/' ? '' : event.key);
			return;
		}
		if (event.key === 'Delete' || event.key === 'Backspace') {
			if (removeSelectedDrawing()) event.preventDefault();
		}
		else if ((event.ctrlKey || event.metaKey) && key === 'z') {
			event.preventDefault();
			if (event.shiftKey) travel(history.future, history.past);
			else travel(history.past, history.future);
		}
		else if ((event.ctrlKey || event.metaKey) && key === 'y') {
			event.preventDefault();
			travel(history.future, history.past);
		}
		else if (event.altKey) {
			const tool = DRAW.TOOLS.find(candidate => candidate.key?.toLowerCase() === key);
			if (!tool) return;
			event.preventDefault();
			setTool(tool.id);
		}
	});

	// 휴대폰의 뒤로 가기: 열린 창을 하나씩 닫는다. 닫을 것이 없으면 false(앱이 뒤로 간다).
	window.chartdeskBack = () => {
		if (window.ChartDeskLab?.close()) return true;
		if (!popover.hidden) {
			closePopover();
			return true;
		}
		const busy = panes.find(pane => pane.picking || pane.replay);
		if (busy) {
			busy.endReplay(true);
			return true;
		}
		const ai = $('ai-panel');
		if (!ai.hidden) {
			ai.querySelector('.ai-head .icon-btn[title="닫기"]')?.click();
			return true;
		}
		return false;
	};

	// ---------- AI 창이 쓰는 창구 ----------

	window.ChartDeskApp = {
		el,
		icon,
		toast,
		formatPrice,
		formatPercent,
		formatVolume,
		tzOffset: TZ_OFFSET,
		INTERVALS,
		INTERVAL_SECONDS,
		intervalLabel,
		symbolTitle,
		symbolInfo,
		logo,
		loadBars,
		quote: id => ticker.prices.get(id) ?? null,
		watchlist: () => [...state.watchlist],
		indicators: () => state.indicators.map(item => ({ type: item.type, params: { ...item.params } })),
		closePopover,
		/** 백테스트·스크리너가 쓰는 지금 차트. */
		pane() {
			const pane = activePane();
			if (!pane) return null;
			return {
				symbol: pane.cfg.symbol,
				interval: pane.cfg.interval,
				bars: pane.bars,
				precision: pane.precision,
				noPaging: PROV.resolve(pane.cfg.symbol).provider.noPaging === true,
				replaying: pane.replay !== null,
				showTrades: markers => pane.showTrades(markers),
				clearTrades: () => pane.clearTrades(),
				prependBars: bars => pane.prependBars(bars),
				scrollToTime: time => pane.scrollToTime(time),
			};
		},
		/** 지금 차트의 종목(과 주기)을 바꾼다. */
		show(symbol, interval) {
			const pane = activePane();
			if (!pane) return;
			setSymbol(pane, symbol);
			if (interval) pane.setInterval(interval);
		},
		onChange: listener => changeListeners.push(listener),
		/** 지금 보고 있는 차트의 종목, 봉, 지표 값, 사용자가 그은 수평선. */
		snapshot() {
			const pane = activePane();
			if (!pane) return null;
			const id = pane.cfg.symbol;
			return {
				id,
				info: symbolInfo(id),
				title: symbolTitle(id),
				interval: pane.cfg.interval,
				intervalLabel: `${ intervalLabel(pane.cfg.interval) }봉`,
				bars: pane.bars,
				precision: pane.precision,
				quote: ticker.prices.get(id) ?? null,
				extended: state.extended && pane.hasSessions(),
				indicators: pane.inds.filter(ind => !ind.cfg.hidden).map(ind => ({
					name: ind.row.querySelector('.ind-name').textContent,
					notes: ind.out?.$draw?.lines ?? [],
					values: ind.def.plots.map((plot) => {
						const series = ind.out?.[plot.k] ?? [];
						const value = series[series.length - 1];
						return `${ plot.label } ${ Number.isFinite(value) ? pane.formatValue(ind.def, value) : '없음' }`;
					}),
				})),
				lines: drawingsFor(id).filter(drawing => drawing.type === 'hline' || drawing.type === 'hray').map(drawing => drawing.points[0].p),
				daily: () => loadBars(id, '1d'),
			};
		},
	};

	buildTools();
	applyTheme();
	renderWatchlist();
	renderAlerts();
	renderWorkspace();
	refreshTools();
	setInterval(() => panes.forEach(pane => pane.tick()), 1000);
	setInterval(checkCondAlerts, 15000);
	setTimeout(checkCondAlerts, 3000);
})();
