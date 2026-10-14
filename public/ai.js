// AI 분석 창. 대화는 로컬 서버(/api/ai)를 거쳐 Claude, GPT, Gemini의 API로 보낸다. API 키는 서버 쪽 파일에만 둔다.
// 이 컴퓨터의 공식 CLI(Claude Code, Codex, Gemini CLI)에 로그인한 계정으로도 쓸 수 있다(서버가 CLI를 불러 답을 받는다).
(() => {
	'use strict';

	const APP = window.ChartDeskApp;
	const IND = window.ChartDeskIndicators;
	const PROV = window.ChartDeskProviders;
	const { el } = APP;
	const STORAGE_KEY = 'chartdesk.ai.v1';
	const PROVIDERS = [
		{ id: 'anthropic', label: 'Claude', company: 'Anthropic', where: 'console.anthropic.com → API Keys', fallback: 'claude-opus-5-5', prefer: /^claude-opus/, web: 'https://claude.ai/new', site: 'claude.ai',
			account: { cli: 'Claude Code', plan: 'Claude Pro·Max', install: 'https://claude.com/claude-code', fallback: 'sonnet',
				login: '터미널 창이 열렸습니다. 브라우저에서 로그인을 마친 뒤 "다시 확인"을 누르세요.' } },
		{ id: 'openai', label: 'GPT', company: 'OpenAI', where: 'platform.openai.com → API keys', fallback: '', prefer: /^gpt-\d/, web: 'https://chatgpt.com/', site: 'chatgpt.com',
			account: { cli: 'Codex', plan: 'ChatGPT Plus·Pro', install: 'https://developers.openai.com/codex/cli', fallback: 'default',
				login: '터미널 창이 열렸습니다. "Sign in with ChatGPT"로 로그인을 마친 뒤 "다시 확인"을 누르세요.',
				note: 'Codex 앱이나 Codex CLI 중 하나만 있으면 됩니다. Codex는 답을 다 만든 뒤 한 번에 보여 줍니다.' } },
		{ id: 'gemini', label: 'Gemini', company: 'Google', where: 'aistudio.google.com → Get API key', fallback: '', prefer: /^gemini-.*pro/, web: 'https://gemini.google.com/app', site: 'gemini.google.com',
			account: { cli: 'Gemini CLI', plan: 'Google', install: 'https://github.com/google-gemini/gemini-cli', fallback: 'auto',
				login: '터미널 창에서 "Sign in with Google"을 고르고 브라우저에서 로그인한 뒤, 터미널에 /quit를 입력하고 "다시 확인"을 누르세요.',
				note: '설치: 터미널에서 npm install -g @google/gemini-cli' } },
	];
	const byId = new Map(PROVIDERS.map(provider => [provider.id, provider]));

	// ---------- 저장과 상태 ----------

	function loadSettings() {
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
			return {
				open: saved.open === true,
				provider: byId.has(saved.provider) ? saved.provider : 'anthropic',
				models: saved.models && typeof saved.models === 'object' ? saved.models : {},
				// 서비스마다 'key'(API 키) 또는 'account'(구독 계정). 정하지 않았으면 연결된 쪽을 쓴다.
				via: saved.via && typeof saved.via === 'object' ? saved.via : {},
			};
		}
		catch {
			return { open: false, provider: 'anthropic', models: {}, via: {} };
		}
	}

	const settings = loadSettings();
	const saveSettings = () => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		}
		catch {
			// 저장하지 못해도 창은 계속 쓸 수 있다.
		}
	};

	let status = {};
	const modelLists = new Map();
	// { role, content, label?, error? }. label이 있으면 화면에는 label만 보이고 content는 펼쳐 볼 수 있다.
	let messages = [];
	let streaming = null;
	let showingKeys = false;

	async function api(path, body) {
		const response = await fetch(path, body === undefined ? undefined : {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(data.error ?? `HTTP ${ response.status }`);
		return data;
	}

	// ---------- 차트 분석 자료 ----------

	const last = values => values[values.length - 1];
	const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
	const stamp = time => new Date(time * 1000).toISOString().slice(0, 16).replace('T', ' ');
	const percent = (value, base) => `${ value >= base ? '+' : '' }${ ((value - base) / base * 100).toFixed(2) }%`;

	function lastValue(series) {
		for (let i = series.length - 1; i >= 0; i--) {
			if (series[i] !== null && Number.isFinite(series[i])) return series[i];
		}
		return null;
	}

	function movingAverages(bars, lengths, price) {
		const source = IND.source(bars);
		const out = [];
		for (const length of lengths) {
			if (bars.length < length) continue;
			const series = IND.byId.get('sma').calc(source, { length }).ma;
			const value = lastValue(series);
			const before = series[series.length - 6];
			if (value === null) continue;
			const slope = Number.isFinite(before) ? (value > before ? '상승' : value < before ? '하락' : '횡보') : '알 수 없음';
			out.push(`MA${ length }: ${ price(value) } (현재가 대비 ${ percent(last(bars).close, value) }, 최근 5봉 기울기 ${ slope })`);
		}
		return out;
	}

	function trueRange(bars, length = 14) {
		if (bars.length <= length) return null;
		const ranges = [];
		for (let i = bars.length - length; i < bars.length; i++) {
			const previous = bars[i - 1].close;
			ranges.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - previous), Math.abs(bars[i].low - previous)));
		}
		return average(ranges);
	}

	/** 앞뒤 3봉보다 높거나 낮은 봉을 전환점으로 보고, 가까운 것끼리 묶어 지지·저항 후보를 만든다. */
	function levels(bars, tolerance) {
		const recent = bars.slice(-300);
		const span = 3;
		const pivots = [];
		for (let i = span; i < recent.length - span; i++) {
			const window = recent.slice(i - span, i + span + 1);
			if (recent[i].high === Math.max(...window.map(bar => bar.high))) pivots.push({ price: recent[i].high, time: recent[i].time });
			if (recent[i].low === Math.min(...window.map(bar => bar.low))) pivots.push({ price: recent[i].low, time: recent[i].time });
		}
		pivots.sort((a, b) => a.price - b.price);
		const groups = [];
		for (const pivot of pivots) {
			const group = last(groups);
			if (group && pivot.price - group.max <= tolerance) {
				group.prices.push(pivot.price);
				group.max = pivot.price;
				group.time = Math.max(group.time, pivot.time);
			}
			else groups.push({ prices: [pivot.price], max: pivot.price, time: pivot.time });
		}
		return groups.map(group => ({ price: average(group.prices), touches: group.prices.length, time: group.time }));
	}

	function volumeNotes(bars) {
		if (bars.length < 25) return [];
		// 마지막 봉은 아직 만들어지는 중일 수 있어 바로 앞 봉까지를 기준으로 삼는다.
		const done = bars.slice(0, -1);
		const base = average(done.slice(-20).map(bar => bar.volume));
		if (!(base > 0)) return ['거래량 데이터 없음 (지수·환율 등)'];
		const recent = done.slice(-20);
		const up = recent.filter(bar => bar.close >= bar.open).reduce((sum, bar) => sum + bar.volume, 0);
		const down = recent.filter(bar => bar.close < bar.open).reduce((sum, bar) => sum + bar.volume, 0);
		const peak = recent.reduce((best, bar) => (bar.volume > best.volume ? bar : best));
		return [
			`직전 완성 봉 거래량: 20봉 평균의 ${ (last(done).volume / base).toFixed(2) }배`,
			`최근 5봉 거래량(20봉 평균 대비 배수): ${ done.slice(-5).map(bar => (bar.volume / base).toFixed(2)).join(', ') }`,
			`최근 20봉 중 양봉 거래량 비중: ${ (up / (up + down) * 100).toFixed(0) }%`,
			`최근 20봉 최대 거래량 봉: ${ stamp(peak.time) } (평균의 ${ (peak.volume / base).toFixed(2) }배, ${ peak.close >= peak.open ? '양봉' : '음봉' })`,
		];
	}

	const table = (bars, price) => ['시각,시가,고가,저가,종가,거래량',
		...bars.map(bar => `${ stamp(bar.time) },${ price(bar.open) },${ price(bar.high) },${ price(bar.low) },${ price(bar.close) },${ Math.round(bar.volume * 100) / 100 }`)].join('\n');

	/** 지금 보고 있는 차트를 글로 정리한다. full이면 일봉과 뉴스까지 받아 붙인다. */
	async function chartContext(full) {
		const shot = APP.snapshot();
		if (!shot || shot.bars.length === 0) return null;
		const { bars, info, quote } = shot;
		const price = value => APP.formatPrice(value, shot.precision).replace(/,/g, '');
		const current = last(bars).close;
		const lines = [
			`종목: ${ shot.title } (${ info.display }, ${ info.exch }, 분류: ${ info.type })`,
			`차트 주기: ${ shot.intervalLabel } · 불러온 봉 ${ bars.length }개 (${ stamp(bars[0].time) } ~ ${ stamp(last(bars).time) }, 사용자 현지 시각)`,
			`현재가: ${ price(current) }${ quote ? ` · 24시간(또는 전일 대비) 등락 ${ quote.change.toFixed(2) }%` : '' }`,
			`지금 시각: ${ stamp(Date.now() / 1000 + APP.tzOffset) }`,
		];
		if (!PROV.resolve(shot.id).provider.realtime) lines.push('주의: 이 종목 시세는 주기적으로 갱신되며 지연될 수 있다.');
		if (shot.extended) lines.push('확장 거래 시간(장전·장후) 봉이 포함되어 있을 수 있다.');

		const high = bars.reduce((best, bar) => (bar.high > best.high ? bar : best));
		const low = bars.reduce((best, bar) => (bar.low < best.low ? bar : best));
		lines.push('', `[${ shot.intervalLabel } 봉 기준]`,
			`불러온 구간 고점: ${ price(high.high) } (${ stamp(high.time) }, 현재가 대비 ${ percent(current, high.high) })`,
			`불러온 구간 저점: ${ price(low.low) } (${ stamp(low.time) }, 현재가 대비 ${ percent(current, low.low) })`,
			...movingAverages(bars, [5, 20, 60, 120, 200], price));
		const rsi = lastValue(IND.byId.get('rsi').calc(IND.source(bars), { length: 14 }).rsi);
		if (rsi !== null) lines.push(`RSI(14): ${ rsi.toFixed(1) }`);
		const range = trueRange(bars);
		if (range !== null) lines.push(`ATR(14): ${ price(range) } (현재가의 ${ (range / current * 100).toFixed(2) }%)`);

		const found = levels(bars, (range ?? current * 0.005) * 0.6);
		const describe = level => `${ price(level.price) } (전환점 ${ level.touches }회, 마지막 ${ stamp(level.time) }, 현재가 대비 ${ percent(level.price, current) })`;
		const above = found.filter(level => level.price > current).slice(0, 5);
		const below = found.filter(level => level.price <= current).slice(-5).reverse();
		lines.push('', '[전환점으로 계산한 가격대 — 기계적으로 뽑은 후보이므로 직접 판단할 것]',
			`위쪽(저항 후보, 가까운 순): ${ above.length ? above.map(describe).join(' / ') : '없음' }`,
			`아래쪽(지지 후보, 가까운 순): ${ below.length ? below.map(describe).join(' / ') : '없음' }`);
		if (shot.lines.length) lines.push(`사용자가 직접 그은 수평선: ${ shot.lines.map(price).join(', ') }`);
		lines.push('', '[거래량]', ...volumeNotes(bars));
		if (shot.indicators.length) lines.push('', '[사용자가 차트에 올린 지표의 현재 값]', ...shot.indicators.flatMap(item => [`${ item.name }: ${ item.values.join(', ') }`, ...item.notes.map(note => `  · ${ note }`)]));
		if (!full) return { shot, text: lines.join('\n') };

		lines.push('', `[최근 ${ shot.intervalLabel } 봉 40개]`, table(bars.slice(-40), price));
		if (shot.interval !== '1d') {
			try {
				const daily = (await shot.daily()).bars;
				const year = daily.slice(-252);
				lines.push('', '[일봉 기준]', ...movingAverages(daily, [20, 60, 120, 200], price),
					`최근 ${ year.length }거래일 고점 ${ price(Math.max(...year.map(bar => bar.high))) } / 저점 ${ price(Math.min(...year.map(bar => bar.low))) }`,
					...volumeNotes(daily), '', '[최근 일봉 30개]', table(daily.slice(-30), price));
			}
			catch {
				lines.push('', '[일봉 기준] 받아 오지 못함');
			}
		}
		try {
			const news = await PROV.news(shot.id, info.base);
			lines.push('', '[최근 뉴스 제목 — Yahoo Finance 검색 결과, 본문은 없음]',
				...(news.length ? news.map(item => `- ${ stamp(item.time + APP.tzOffset) } · ${ item.publisher } · ${ item.title }`) : ['검색된 뉴스 없음']));
		}
		catch {
			lines.push('', '[최근 뉴스] 받아 오지 못함');
		}
		return { shot, text: lines.join('\n') };
	}

	const SYSTEM = [
		'너는 차트 프로그램 ChartDesk 안에서 일하는 시장 분석 도우미다. 한국어로 답한다.',
		'사용자가 지금 화면에 띄워 둔 차트의 요약이 아래에 붙는다. 질문이 차트와 관련되면 이 자료를 근거로 답하고, 자료에 없는 수치는 지어내지 않는다.',
		'가격 수준을 말할 때는 반드시 숫자를 적는다. 불확실한 것은 불확실하다고 말한다.',
		'매매 결정은 사용자가 한다. 사용자가 의견을 요청하면(총정리, 포지션 점검 등) 추천 여부와 가격 계획을 분명히 제시하되, 근거와 틀렸을 때의 기준을 함께 준다. 요청하지 않았으면 근거, 시나리오, 무효화 조건 위주로 답한다.',
	].join('\n');

	const SUMMARY = [
		'지금 차트에 띄워 둔 종목을 총정리해 줘. 아래 [차트 자료]만 근거로 삼고, 자료에 없는 사실은 지어내지 마.',
		'제목, 서론, 면책 문구 없이 아래 형식의 줄만 써.',
		'',
		'첫 줄: 판단 하나와 이유 한 구절. 판단은 "매수 고려 / 관망 / 매도·비중 축소 고려" 중 하나. 예: "관망 — 81,860 저항 아래에서 거래량 없이 횡보 중"',
		'그 아래 3~5줄, 각 줄은 "항목: 가격 (근거)" 형식으로:',
		'- 진입: 들어가기 좋은 가격(또는 가격대)과 조건. 예: 지지 확인 후, 종가 돌파 시',
		'- 손절: 종가로 이탈하면 판단이 틀린 것으로 보는 가격과 진입가 대비 %',
		'- 추가매수: 계획된 분할로 더 담을 가격과 조건. 손실을 메우려는 물타기가 되는 자리면 넣지 말고 "없음"',
		'- 목표: 1차·2차 목표 가격과 진입가 대비 %',
		'- 주의: 이 계획을 흔들 변수 하나(큰 저항, 뉴스, 변동성 등)',
		'',
		'규칙:',
		'- 판단이 관망이면 진입 줄에 "어디까지 오면 다시 볼지"를 적어. 매도·비중 축소 고려면 같은 형식을 숏 또는 비중 축소 기준으로 써.',
		'- 손익비(목표 1차까지 거리 ÷ 손절까지 거리)가 1.5보다 작으면 판단을 관망으로 낮추고 그 이유를 첫 줄에 적어.',
		'- 손절은 가까운 지지·저항 바깥, ATR의 0.5~1배 여유를 두고 잡아.',
		'- 모든 가격은 숫자로. 확률 숫자는 지어내지 마. 마지막 줄 끝에 괄호로 자료 기준 시각을 적어.',
	].join('\n');

	const NEWS = [
		'아래 [차트 자료]의 최근 뉴스를 정리해 줘. 뉴스는 제목만 있고 본문은 없으니, 제목에서 읽을 수 있는 것만 말하고 없는 내용은 지어내지 마.',
		'',
		'## 한 줄 요약',
		'지금 뉴스 흐름이 이 종목에 호재 쪽인지, 악재 쪽인지, 섞여 있는지.',
		'',
		'## 주요 뉴스',
		'영향이 큰 순서로 최대 7개. 같은 사건을 다룬 기사는 하나로 묶어. 각 줄: "날짜 · 내용 요약 — 호재/악재/중립 — 이유 한 줄".',
		'',
		'## 가격과 맞춰 보기',
		'뉴스가 나온 날짜 전후로 봉 표(일봉, 현재 주기)에서 가격과 거래량이 실제로 반응했는지. 이미 가격에 반영된 것으로 보이는 뉴스와 아직 반응이 없는 뉴스를 나눠.',
		'',
		'## 확인할 것',
		'제목만으로는 판단하기 어려워 원문·공시·일정으로 확인해야 할 것 2~4개.',
		'',
		'뉴스가 없거나 이 종목과 관련이 적으면 그렇다고 짧게 말하고 끝내.',
	].join('\n');

	const POSITION = [
		'내가 들고 있는(또는 들어가려는) 포지션을 지금 차트 기준으로 점검해 줘. 포지션 정보는 아래 [내 메모]에 적었어(평단, 수량이나 비중, 롱/숏, 레버리지 등).',
		'[내 메모]가 없거나 평단·방향을 알 수 없으면 점검하지 말고, 무엇을 알려 줘야 하는지 한 줄로만 물어봐.',
		'',
		'## 지금 상태',
		'평단 대비 현재 손익 %(레버리지가 있으면 반영한 값도), 가까운 지지·저항 사이에서 지금 가격의 위치.',
		'',
		'## 손절과 익절',
		'손절 가격과 그 근거, 1차·2차 익절 가격과 근거. 각각 평단 대비 %.',
		'',
		'## 추가매수 또는 비중 축소',
		'계획된 분할 매수를 할 가격과 조건, 또는 일부 정리할 가격. 손실 중인 포지션의 물타기가 되는 경우에는 그 위험을 먼저 적어.',
		'',
		'## 한 줄 결론',
		'"유지 / 일부 정리 / 정리" 중 어디에 가까운지와 이유. 모든 가격은 숫자로.',
	].join('\n');

	const EASY = [
		'차트를 처음 보는 사람도 이해할 수 있게 지금 차트를 설명해 줘. 전문 용어는 처음 나올 때 괄호로 쉽게 풀어 줘. 아래 [차트 자료]의 숫자를 그대로 써서 설명해.',
		'',
		'## 지금 어떤 상황인가',
		'세 줄 이내로. 오르는 중인지, 내리는 중인지, 옆으로 가는 중인지.',
		'',
		'## 화면에서 볼 곳',
		'이동평균선, 지지·저항, 거래량, RSI를 하나씩, 지금 값과 그 값이 뜻하는 것을 두세 줄로.',
		'',
		'## 다음에 볼 신호',
		'앞으로 이런 일이 생기면 상황이 바뀐다는 신호 2~3개를 가격과 함께.',
		'',
		'사고팔라는 권유는 하지 마.',
	].join('\n');

	const BRIEFING = [
		'지금 차트에 띄워 둔 종목을 브리핑해 줘. 아래 [차트 자료]만 근거로 삼고, 자료에 없는 사실(실적 수치, 일정, 뉴스 본문 등)은 추측해서 채우지 마. 모르는 것은 "자료에 없음"이라고 적어.',
		'',
		'아래 순서와 제목을 그대로 지켜서 써 줘.',
		'',
		'## 1. 한 줄 요약',
		'현재 추세와 지금 가격의 위치를 두 문장 이내로.',
		'',
		'## 2. 추세와 이동평균선',
		'- 보고 있는 주기와 일봉 각각에서 가격이 주요 이동평균선(20·60·120·200) 위인지 아래인지, 이평선의 배열(정배열/역배열/혼조)과 기울기.',
		'- 가격과 가장 가까운 이평선이 지지로 작용하는지 저항으로 작용하는지, 이격이 과도한지.',
		'- 최근 골든크로스·데드크로스가 임박했거나 방금 일어났다면 언급.',
		'',
		'## 3. 주요 지지와 저항',
		'- 저항 2~3개, 지지 2~3개를 가격 숫자로 제시하고, 각각 왜 중요한지(전환점 횟수, 이평선과 겹침, 구간 고·저점, 사용자가 그은 수평선, 라운드 넘버 등)를 한 줄씩.',
		'- 기계적으로 뽑힌 후보를 그대로 옮기지 말고, 최근 봉 흐름과 맞는 것만 골라. 서로 가까운 가격은 하나의 구간으로 묶어.',
		'- 각 수준까지 현재가 대비 몇 %인지 함께 적어.',
		'',
		'## 4. 거래량',
		'- 최근 거래량이 평균 대비 어떤지, 상승 봉과 하락 봉 중 어디에 거래량이 실렸는지.',
		'- 거래량이 급증한 봉이 있다면 그 봉의 가격대와 의미(돌파 확인, 투매, 매집 가능성 등). 거래량 자료가 없는 종목이면 그렇다고 밝혀.',
		'',
		'## 5. 모멘텀과 변동성',
		'RSI 수준(과매수·과매도·중립, 다이버전스 가능성)과 ATR로 본 하루(또는 한 봉) 예상 변동 폭. 사용자가 올린 지표 값이 있으면 함께 해석.',
		'',
		'## 6. 최근 뉴스와 가격에 영향을 줄 요인',
		'- 뉴스 제목 중 가격에 영향을 줄 만한 것을 골라 호재/악재/중립으로 나누고, 왜 그런지 한 줄씩. 제목만으로 판단하기 어려우면 그렇게 적어.',
		'- 종목 분류(코인·주식·ETF·지수·환율·선물)에 맞는 일반적 변수도 짚어 줘. 예: 레버리지 ETF면 기초지수와 일일 복리 효과, 코인이면 비트코인 흐름과 펀딩·청산, 주식이면 실적·금리·환율, 환율이면 금리 차와 중앙은행.',
		'- 뉴스가 없거나 관련성이 낮으면 억지로 채우지 말고 "확인할 것" 목록으로 대신해.',
		'',
		'## 7. 시나리오',
		'- 상승 시나리오: 어떤 가격을 어떤 조건(종가 기준, 거래량 동반 등)으로 넘어야 하는지, 다음 목표 구간, 이 시나리오가 틀렸다고 볼 가격.',
		'- 하락 시나리오: 같은 형식으로.',
		'- 지금 자료에서 어느 쪽 근거가 더 많은지 한 줄로. 확률 숫자는 지어내지 마.',
		'',
		'## 8. 지켜볼 것',
		'앞으로 며칠 동안 확인할 가격·거래량·일정 3~5개를 체크리스트로.',
		'',
		'작성 규칙: 모든 가격은 숫자로 적고, 근거가 된 자료(예: "MA60 = 83,150")를 괄호로 붙여. 장황한 서론과 면책 문구 반복은 빼. 매수·매도를 지시하지 말고 판단 근거를 줘. 마지막 줄에 "자료 기준 시각"과 시세가 지연될 수 있는 종목인지 한 번만 적어.',
	].join('\n');

	const WONYO = [
		'지금 차트에 띄워 둔 종목을, 워뇨띠가 공개한 비트멕스 체결 기록(2018.3~2021.12)의 통계에 비춰 점검해 줘. 아래 [점검 기준]은 그 기록에서 포지션 3,184개를 복원해 계산한 수치이고, 그가 직접 말한 규칙이 아니야. 체결 기록에는 진입 이유가 없으니 "워뇨띠라면 여기서 산다/판다"는 식으로 단정하지 마. 근거는 [차트 자료]에서만 가져오고, 없는 것은 "자료에 없음"이라고 적어.',
		'',
		'[점검 기준] (환경별 수치는 2019년 이후 비트코인·이더리움 포지션 914개 기준)',
		'- 주문: 주문 23,417건의 97%가 지정가. 2019년 이후 시장가 주문은 3년간 5건, 스탑 주문 7건. 체결 금액의 71%가 메이커. 포지션의 58%가 진입 주문 3개 이상이고, 진입 가격의 폭은 중앙값 1.3%(상위 25%는 3.4% 이상). 2021년에는 진입 5개·청산 5개가 보통.',
		'- 승률과 손익: 승률 76%, 평균 수익 +3.4 BTC 대 평균 손실 -5.9 BTC. 이긴 포지션은 가격 이동 중앙값 +0.39%(시간봉 ATR의 0.6배)에 보유 23분, 진 포지션은 -0.27%(ATR 0.4배)에 49분. 진 포지션의 하위 5%는 -4% 이상.',
		'- 추가 진입: 유리한 쪽으로 더 실은 불타기 165개는 승률 84%, 합계 +2,318 BTC. 불리한 쪽으로 더 실은 물타기 387개는 승률 63%, 합계 -862 BTC. 가장 크게 잃은 8개 포지션은 모두 물타기가 섞였음.',
		'- 크기(잔고 대비 포지션 최대 크기): 중앙값 약 1배. 0.5배 미만 손익비 3.0, 0.5~1배 1.7, 1~2배 1.5, 2~4배 2.0, 4배 초과는 24개에 합계 -176 BTC(승률 50%).',
		'- 변동성: 직전 7일 고가~저가 변동폭 15% 이상에서 558개, 합계 +2,172 BTC(수익의 약 84%). 7~15%에서는 324개가 손익비 1.18로 거의 본전. 7% 미만에서는 거의 매매하지 않음(32개).',
		'- 과열에서의 받아치기: 20시간 평균보다 시간봉 ATR 3배 이상 위에서 잡은 숏 101개는 승률 57%, 합계 -633 BTC. 3배 이상 아래에서 잡은 롱 104개는 합계 -148 BTC. 직전 24시간 고점 위에서 잡은 숏 109개는 -426 BTC, 저점 아래에서 잡은 롱 98개는 -101 BTC.',
		'- 성과가 좋았던 자리: 평균보다 ATR 1.5~3배 아래에서의 롱 76개(손익비 4.6). 24시간 범위의 아래쪽 40% 안에서 잡은 숏 126개(+1,101 BTC), 즉 이미 꺾인 뒤의 숏. 24시간에 10% 넘게 빠진 직후 시작한 포지션 67개(손익비 2.5).',
		'- 방향 없는 자리: 3일 등락이 ±2% 안쪽일 때 잡은 숏 98개는 합계 -167 BTC.',
		'- 보유 기간: 1~7일 보유 213개가 합계 +1,560 BTC로 가장 큼. 7일 초과 39개는 승률 56%에 합계 +16 BTC로 본전. 가장 크게 잃은 8개 중 6개가 3일 넘게, 4개가 15일 넘게 보유.',
		'- 방향: 2019년 이후 비트코인 숏 415개 +1,161 BTC, 롱 419개 +667 BTC. 20일 평균 기준 추세 방향이든 역추세든 합계는 모두 이익이라, 추세 방향만으로는 손실을 가려낼 수 없었음.',
		'- 주의: 위 자리(평균 아래 1.5~3배 롱, 범위 아래쪽 40% 숏, 평균 위 롱)에 들어선 봉의 마감가로 기계적으로 진입해 같은 목표와 무효화를 적용하면, 2019~2021년 비트코인·이더리움에서 승률 약 60%에 평균 손익이 ATR의 -0.05~+0.1배로 본전 수준이었음. 자리만으로는 우위가 없고, 그는 같은 자리에서 롱과 숏 양쪽으로 수익을 냈음.',
		'- 기타: 하루 단위 승률 66%. 수익 상위 20일이 전체의 62%이고, 상위 50일을 빼면 나머지 1,329일의 합계는 -245 BTC. 2018년에는 잔고 대비 중앙값 3.8배로 청산을 17번 당했고, 2019년부터 1배 안팎으로 내림.',
		'',
		'아래 순서와 제목을 그대로 지켜서 써 줘.',
		'',
		'## 1. 지금 환경',
		'7일 변동폭과 3일 등락률을 숫자로 적고, 고변동/보통/저변동 중 어디인지, 급등 뒤인지 급락 뒤인지 판정해. 그 환경이 위 통계에서 수익이 몰린 쪽인지 손실이 몰린 쪽인지 한 줄로.',
		'',
		'## 2. 추세와 역추세',
		'일봉과 현재 주기의 이동평균 배열로 큰 추세를 판정하고, 지금 롱과 숏 중 어느 쪽이 역추세인지 밝혀. 역추세 쪽이라면 위 "큰 손실의 공통점"에 해당하는지 따져.',
		'',
		'## 3. 지정가 사다리 예시',
		'롱 쪽과 숏 쪽 각각, 지지·저항과 ATR을 근거로 진입 가격 3~5개와 청산 가격 3~5개를 표로 제시해. 각 가격 옆에 근거(예: 지지 구간 하단, MA60, ATR 0.5배)를 적어. 이것은 조건이 맞을 때의 예시이지 주문 지시가 아니라고 표 위에 한 줄 적어.',
		'',
		'## 4. 크기',
		'잔고 대비 몇 배까지가 위 통계의 수익 구간인지 적고, 이 종목의 ATR로 볼 때 1배 크기에서 평소 하루 변동이 잔고의 몇 %인지 계산해. 사용자가 잔고와 현재 포지션을 알려 주지 않았으면 추측하지 말고 맨 끝에서 물어봐.',
		'',
		'## 5. 틀렸을 때',
		'- 가격 기준: 어느 가격을 종가로 넘으면 계획을 접는지.',
		'- 시간 기준: 역추세 포지션을 며칠 넘게 들고 가지 않도록 기한을 제시해 (통계상 7일 넘게 든 매매는 합계 손실).',
		'- 급변 대비: 지정가 손절이 체결되지 않는 급락·급등에 대비해 무엇을 미리 해 둘지.',
		'',
		'## 6. 하지 말아야 할 것',
		'지금 차트에 해당하는 항목만 골라 체크리스트로: 시장가 추격, 물타기, 2배 초과 크기, 역추세 장기 보유, 손실 직후 크기 확대, 저변동 구간의 잦은 매매.',
		'',
		'## 7. 한 줄 정리',
		'지금은 "기다릴 자리 / 짧게 볼 자리 / 쉬어야 할 자리" 중 어디에 가까운지와 그 이유를 한 문장으로. 확률 숫자는 지어내지 마.',
		'',
		'작성 규칙: 모든 가격은 숫자로 적고 근거 자료를 괄호로 붙여. 매수·매도를 지시하지 마. 위 통계는 2018~2021년 비트코인·이더리움 선물의 것이므로, 지금 종목이 다르면 그대로 적용하기 어렵다는 점을 맨 앞에 한 줄로 밝혀. 마지막 줄에 자료 기준 시각을 적어.',
	].join('\n');

	// memo가 있는 요청은 입력창에 적은 글을 [내 메모]로 붙여 보낸다.
	const PROMPTS = {
		summary: { name: '총정리', button: '총정리 요청', web: '총정리를 웹에서', text: SUMMARY },
		brief: { name: '종목 브리핑', button: '종목 브리핑', web: '브리핑을 웹에서', text: BRIEFING },
		news: { name: '뉴스 정리', button: '뉴스 정리', web: '뉴스 정리를 웹에서', text: NEWS },
		position: { name: '내 포지션 점검', button: '포지션 점검', web: '점검을 웹에서', text: POSITION,
			memo: '평단, 수량(또는 비중), 롱/숏, 레버리지를 적고 "포지션 점검"을 누르세요. 예: 롱 평단 80,500, 0.2 BTC, 3배' },
		easy: { name: '차트 쉽게 설명', button: '쉽게 설명', web: '설명을 웹에서', text: EASY },
		wonyo: { name: 'GOSU식 매매 점검', button: '점검 요청', web: '점검을 웹에서', text: WONYO },
	};

	/** 고른 요청의 본문. 입력창에 글이 있으면 [내 메모]로 붙인다. */
	function promptText(prompt, memo) {
		return memo.trim() ? `${ prompt.text }\n\n[내 메모]\n${ memo.trim() }` : prompt.text;
	}

	// ---------- 응답 읽기 ----------

	const extract = {
		anthropic(event) {
			if (event.type === 'error') throw new Error(event.error?.message ?? '응답 오류');
			return event.type === 'content_block_delta' && event.delta?.type === 'text_delta' ? event.delta.text : '';
		},
		openai(event) {
			if (event.error) throw new Error(event.error.message ?? '응답 오류');
			return event.choices?.[0]?.delta?.content ?? '';
		},
		gemini(event) {
			if (event.error) throw new Error(event.error.message ?? '응답 오류');
			return (event.candidates?.[0]?.content?.parts ?? []).map(part => part.text ?? '').join('');
		},
	};

	async function stream(provider, model, system, history, onText, signal) {
		const response = await fetch('/api/ai/chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider, via: via(provider), model, system, messages: history }),
			signal,
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error ?? `HTTP ${ response.status }`);
		}
		// 계정(CLI)으로 받은 답은 서버가 어느 서비스든 Anthropic 이벤트 모양으로 바꿔 보낸다.
		const read = via(provider) === 'account' ? extract.anthropic : extract[provider];
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const rows = buffer.split('\n');
			buffer = rows.pop();
			for (const row of rows) {
				if (!row.startsWith('data:')) continue;
				const payload = row.slice(5).trim();
				if (!payload || payload === '[DONE]') continue;
				let event;
				try {
					event = JSON.parse(payload);
				}
				catch {
					continue;
				}
				const text = read(event);
				if (text) onText(text);
			}
		}
	}

	// ---------- 글 꾸미기 (마크다운의 일부) ----------

	/** **굵게**와 `코드`만 바꾼다. 글자는 모두 textContent로 넣어 태그가 실행되지 않는다. */
	function inline(text) {
		const nodes = [];
		for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
			if (part.startsWith('**') && part.endsWith('**') && part.length > 4) nodes.push(el('b', { text: part.slice(2, -2) }));
			else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) nodes.push(el('code', { text: part.slice(1, -1) }));
			else if (part) nodes.push(part);
		}
		return nodes;
	}

	function render(text) {
		const out = [];
		let list = null;
		let rows = null;
		const flush = () => {
			if (rows) {
				out.push(el('table', {}, ...rows.map((cells, i) => el('tr', {}, ...cells.map(cell => el(i === 0 ? 'th' : 'td', {}, ...inline(cell)))))));
				rows = null;
			}
			list = null;
		};
		for (const raw of text.split('\n')) {
			const line = raw.trimEnd();
			const heading = /^(#{1,4})\s+(.*)$/.exec(line);
			const bullet = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
			if (/^\s*\|.*\|\s*$/.test(line)) {
				const cells = line.trim().slice(1, -1).split('|').map(cell => cell.trim());
				// 머리글 아래의 구분선(|---|---|)은 건너뛴다.
				if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue;
				list = null;
				(rows ??= []).push(cells);
			}
			else if (heading) {
				flush();
				out.push(el(heading[1].length <= 2 ? 'h3' : 'h4', {}, ...inline(heading[2])));
			}
			else if (bullet) {
				if (rows) flush();
				const ordered = /\d/.test(bullet[1]);
				if (!list || (list.tagName === 'OL') !== ordered) {
					list = el(ordered ? 'ol' : 'ul');
					out.push(list);
				}
				list.append(el('li', {}, ...inline(bullet[2])));
			}
			else if (line.trim() === '' || /^-{3,}$/.test(line.trim())) flush();
			else {
				flush();
				out.push(el('p', {}, ...inline(line)));
			}
		}
		flush();
		return out;
	}

	// ---------- 화면 ----------

	const panel = document.getElementById('ai-panel');
	const button = document.getElementById('ai-btn');
	const providerBar = el('div', { class: 'seg ai-providers' });
	const modelSelect = el('select', { class: 'ai-model', title: '모델' });
	const body = el('div', { class: 'ai-body' });
	const input = el('textarea', { rows: '2', placeholder: '차트에 대해 물어보세요. Enter로 보내고 Shift+Enter로 줄을 바꿉니다.', spellcheck: 'false' });
	const sendButton = el('button', { class: 'primary', text: '보내기' });
	const briefButton = el('button', { class: 'text-btn' });
	const webButton = el('button', { class: 'text-btn', text: '브리핑을 웹에서', title: 'API 키 없이 쓰는 방법: 고른 요청의 프롬프트를 복사하고 고른 서비스의 웹 창을 엽니다. 그 창에 붙여 넣어(Ctrl+V) 직접 보내면 본인 계정으로 답을 받습니다.' });
	const kindSelect = el('select', { class: 'ai-kind', title: '정해 둔 요청 고르기' }, ...Object.entries(PROMPTS).map(([id, prompt]) => el('option', { value: id, text: prompt.name })));
	const clearButton = el('button', { class: 'text-btn', text: '새 대화' });
	const keysButton = el('button', { class: 'text-btn', text: '계정 연결' });
	const closeButton = el('button', { class: 'icon-btn', title: '닫기', text: '×' });
	const target = el('span', { class: 'ai-target' });

	const accountReady = id => status[id]?.account?.loggedIn === true;
	/** 이 서비스를 API 키로 쓸지('key') 구독 계정으로 쓸지('account'). */
	function via(id) {
		const chosen = settings.via[id];
		if (chosen === 'account' && byId.get(id).account) return 'account';
		if (chosen === 'key') return 'key';
		return status[id]?.connected !== true && accountReady(id) ? 'account' : 'key';
	}
	const connected = id => (via(id) === 'account' ? accountReady(id) : status[id]?.connected === true);
	const listKey = id => `${ id }:${ via(id) }`;
	const modelsUrl = id => `/api/ai/models?provider=${ id }${ via(id) === 'account' ? '&via=account' : '' }`;
	const fallbackModel = (id) => {
		const provider = byId.get(id);
		return via(id) === 'account' ? provider.account.fallback : provider.fallback;
	};
	const currentModel = () => settings.models[listKey(settings.provider)] || fallbackModel(settings.provider);

	function renderProviders() {
		providerBar.replaceChildren(...PROVIDERS.map(provider => el('button', {
			class: `${ provider.id === settings.provider ? 'on' : '' }${ connected(provider.id) ? ' linked' : '' }`,
			text: provider.label,
			title: connected(provider.id) ? `${ provider.company } 연결됨 (${ via(provider.id) === 'account' ? '구독 계정' : 'API 키' })` : `${ provider.company } 연결 안 됨`,
			onclick: () => {
				settings.provider = provider.id;
				saveSettings();
				renderAll();
				loadModels();
			},
		})));
	}

	// 계정(CLI)으로 쓸 때 별칭은 무엇을 뜻하는지 붙여 보여 준다.
	const MODEL_NOTES = {
		opus: '최신 Opus', sonnet: '최신 Sonnet', haiku: '최신 Haiku', default: 'Codex 기본 모델', auto: '자동 선택',
		'claude-fable-5-1': '사용 크레딧 필요', 'claude-fable-5': '사용 크레딧 필요',
	};
	const modelLabel = id => (via(settings.provider) === 'account' && MODEL_NOTES[id] ? `${ id } (${ MODEL_NOTES[id] })` : id);

	function renderModels() {
		const list = modelLists.get(listKey(settings.provider)) ?? [];
		const model = currentModel();
		const ids = model && !list.includes(model) ? [model, ...list] : list;
		modelSelect.replaceChildren(...(ids.length ? ids : ['']).map(id => el('option', { value: id, text: id ? modelLabel(id) : '모델 목록 없음' })));
		modelSelect.value = model;
		modelSelect.disabled = ids.length === 0;
	}

	/** 연결된 계정에서 쓸 수 있는 모델 목록을 받는다. 키가 맞는지도 이때 확인된다. */
	async function loadModels(force = false) {
		const id = settings.provider;
		const key = listKey(id);
		if (!connected(id)) return renderModels();
		try {
			if (!modelLists.has(key) || force) modelLists.set(key, (await api(modelsUrl(id))).models);
			const models = modelLists.get(key);
			if (!settings.models[key] || !models.includes(settings.models[key])) {
				const fallback = fallbackModel(id);
				settings.models[key] = models.includes(fallback) ? fallback : models.find(model => byId.get(id).prefer.test(model)) ?? models[0] ?? '';
				saveSettings();
			}
		}
		catch (error) {
			modelLists.delete(key);
			if (id === settings.provider) note(`${ byId.get(id).label } 모델 목록을 받지 못했습니다: ${ error.message }`);
		}
		if (id === settings.provider) renderModels();
	}

	function note(text) {
		messages.push({ role: 'note', content: text });
		renderBody();
	}

	function keysView() {
		const rows = [el('p', { class: 'hint', text: '세 서비스 모두 이 컴퓨터의 공식 CLI(Claude Code, Codex, Gemini CLI)에 로그인한 본인 계정으로 쓰거나, API 키로 연결할 수 있습니다. 계정으로 쓰면 API 요금 없이 구독(또는 무료) 한도에서 빠집니다. 키는 이 컴퓨터의 ChartDesk 폴더(ai-keys.json)에만 저장되고, 해당 회사의 API 주소로만 보냅니다. 키 없이 쓰는 또 다른 방법은 아래의 "브리핑을 웹에서"입니다. 프롬프트를 복사해 드리고, 본인 계정으로 로그인한 웹 창에 붙여 넣어 보내는 방식입니다.' })];
		for (const provider of PROVIDERS) {
			const account = provider.account && status[provider.id]?.account;
			const using = via(provider.id);
			const accountRows = [];
			if (provider.account) {
				const state = !account?.installed ? `${ provider.account.cli } 설치 안 됨`
					: account.loggedIn ? `로그인됨${ account.plan ? ` (${ account.plan })` : '' }` : '로그인 필요';
				const use = (mode) => {
					settings.via[provider.id] = mode;
					settings.provider = provider.id;
					saveSettings();
					showingKeys = false;
					renderAll();
					loadModels();
				};
				const actions = [];
				if (!account?.installed) actions.push(el('a', { class: 'primary', href: provider.account.install, target: '_blank', rel: 'noopener', text: `${ provider.account.cli } 설치 안내` }));
				else if (!account.loggedIn) {
					actions.push(el('button', {
						class: 'primary',
						text: '로그인',
						onclick: async() => {
							try {
								await api('/api/ai/login', { provider: provider.id });
								APP.toast(provider.account.login);
							}
							catch (error) {
								APP.toast(error.message);
							}
						},
					}));
				}
				else if (using !== 'account') actions.push(el('button', { class: 'primary', text: '구독 계정으로 쓰기', onclick: () => use('account') }));
				actions.push(el('button', {
					class: 'text-btn',
					text: '다시 확인',
					onclick: async() => {
						await refreshStatus();
						renderAll();
						loadModels();
					},
				}));
				accountRows.push(
					el('div', { class: 'ai-key-head' }, el('span', { text: `구독 계정 · ${ provider.account.cli }` }),
						el('span', { class: account?.loggedIn ? 'up' : 'muted', text: using === 'account' && account?.loggedIn ? `${ state } · 사용 중` : state })),
					el('small', { text: `이 컴퓨터의 ${ provider.account.cli }에 로그인한 ${ provider.account.plan } 계정으로 답을 받습니다. API 요금은 들지 않습니다. 로그인 정보는 ${ provider.account.cli }가 보관하며 ChartDesk는 보지 않습니다.${ provider.account.note ? ` ${ provider.account.note }` : '' }` }),
					el('div', { class: 'ai-key-row' }, ...actions),
					el('span', { class: 'ai-key-head' }, el('span', { text: 'API 키' }),
						el('span', { class: status[provider.id]?.connected ? 'up' : 'muted', text: status[provider.id]?.connected ? `연결됨${ using === 'key' ? ' · 사용 중' : '' }` : '연결 안 됨' })));
				if (status[provider.id]?.connected && using !== 'key') accountRows.push(el('div', { class: 'ai-key-row' }, el('button', { class: 'text-btn', text: 'API 키로 쓰기', onclick: () => use('key') })));
			}
			const field = el('input', { type: 'password', placeholder: status[provider.id]?.connected ? `연결됨 (${ status[provider.id].hint }) · 바꾸려면 새 키 입력` : 'API 키 붙여넣기', autocomplete: 'off' });
			const set = async(key) => {
				try {
					await api('/api/ai/key', { provider: provider.id, key });
					modelLists.delete(`${ provider.id }:key`);
					if (key) {
						// 모델 목록을 받아 키가 맞는지 확인한다. 틀린 키는 남겨 두지 않는다.
						try {
							modelLists.set(`${ provider.id }:key`, (await api(`/api/ai/models?provider=${ provider.id }`)).models);
						}
						catch (error) {
							await api('/api/ai/key', { provider: provider.id, key: '' });
							await refreshStatus();
							renderAll();
							APP.toast(`${ provider.label } 연결에 실패했습니다: ${ error.message }`);
							return;
						}
						settings.provider = provider.id;
						settings.via[provider.id] = 'key';
						delete settings.models[`${ provider.id }:key`];
						saveSettings();
						showingKeys = false;
					}
					await refreshStatus();
					await loadModels();
					renderAll();
				}
				catch (error) {
					APP.toast(`저장하지 못했습니다: ${ error.message }`);
				}
			};
			field.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && field.value.trim()) set(field.value);
			});
			rows.push(el('div', { class: 'ai-key' },
				el('div', { class: 'ai-key-head' }, el('b', { text: `${ provider.label } (${ provider.company })` }),
					el('span', { class: connected(provider.id) ? 'up' : 'muted', text: connected(provider.id) ? '연결됨' : '연결 안 됨' })),
				...accountRows,
				el('small', { text: `키 발급: ${ provider.where }` }),
				el('div', { class: 'ai-key-row' }, field,
					el('button', { class: 'primary', text: '연결', onclick: () => field.value.trim() && set(field.value) }),
					el('button', { class: 'text-btn', text: '해제', onclick: () => set('') }))));
		}
		rows.push(el('div', { class: 'actions' }, el('button', {
			class: 'text-btn',
			text: '대화로 돌아가기',
			onclick: () => {
				showingKeys = false;
				renderAll();
			},
		})));
		return rows;
	}

	function bubble(message) {
		if (message.role === 'note') return el('div', { class: 'ai-note', text: message.content });
		if (message.role === 'web') return webBubble(message);
		const node = el('div', { class: `ai-msg ${ message.role }${ message.error ? ' failed' : '' }` });
		if (message.label) {
			node.append(el('p', { text: message.label }), el('details', {}, el('summary', { text: '보낸 내용 보기' }), el('pre', { text: message.content })));
		}
		else if (message.role === 'assistant') node.append(...(message.content ? render(message.content) : [el('p', { class: 'muted', text: '응답을 기다리는 중…' })]));
		else node.append(el('p', { text: message.content }));
		return node;
	}

	/** 웹 창에 붙여 넣을 프롬프트를 안내하는 말풍선. 전송은 사용자가 그 창에서 직접 한다. */
	function webBubble(message) {
		const provider = byId.get(message.provider);
		const state = el('p', { text: message.copied
			? `요청 내용을 복사했습니다. ${ provider.label } 창에서 붙여 넣고(Ctrl+V) Enter를 누르세요.`
			: '자동으로 복사하지 못했습니다. "다시 복사"를 누른 뒤 붙여 넣으세요.' });
		const copy = el('button', {
			class: 'text-btn',
			text: '다시 복사',
			onclick: async() => {
				message.copied = await copyText(message.content);
				renderBody();
			},
		});
		return el('div', { class: 'ai-msg assistant web' },
			el('p', {}, el('b', { text: message.label })),
			state,
			el('div', { class: 'ai-web-actions' },
				el('a', { class: 'primary', href: provider.web, target: '_blank', rel: 'noopener', text: `${ provider.label } 웹 열기 (${ provider.site })` }),
				copy),
			el('details', {}, el('summary', { text: '복사한 내용 보기' }), el('pre', { text: message.content })));
	}

	async function copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		}
		catch {
			return false;
		}
	}

	/** 브리핑 프롬프트와 차트 자료를 복사하고, 고른 서비스의 웹 창을 연다. API 키가 필요 없다. */
	async function briefOnWeb() {
		const provider = byId.get(settings.provider);
		webButton.disabled = true;
		try {
			const context = await chartContext(true);
			if (!context) {
				note('차트 데이터가 아직 없습니다.');
				return;
			}
			const prompt = PROMPTS[kindSelect.value];
			const content = `${ promptText(prompt, input.value) }\n\n[차트 자료]\n${ context.text }`;
			const copied = await copyText(content);
			messages.push({ role: 'web', provider: provider.id, content, copied, label: `웹으로 ${ prompt.name } · ${ context.shot.title } (${ context.shot.intervalLabel })` });
			showingKeys = false;
			renderAll();
			body.scrollTop = body.scrollHeight;
			// 자료를 받느라 시간이 걸리면 브라우저가 새 창을 막는다. 그때는 말풍선의 링크로 연다.
			if (copied) window.open(provider.web, '_blank', 'noopener');
		}
		finally {
			webButton.disabled = false;
		}
	}

	function renderBody() {
		if (showingKeys || (!connected(settings.provider) && messages.length === 0)) {
			body.replaceChildren(...keysView());
			return;
		}
		const pinned = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
		body.replaceChildren(...(messages.length ? messages.map(bubble) : [el('p', { class: 'hint', text: '아래 목록에서 요청(총정리, 종목 브리핑, 뉴스 정리, 내 포지션 점검, 차트 쉽게 설명, GOSU식 매매 점검)을 고르고 옆 버튼을 누르면 지금 차트 자료를 붙여 보냅니다. 입력창에 적은 글은 [내 메모]로 함께 갑니다. 자유롭게 질문해도 됩니다. 보내는 질문마다 현재 차트 요약이 함께 전달됩니다.' })]));
		if (pinned) body.scrollTop = body.scrollHeight;
	}

	function renderAll() {
		renderProviders();
		renderModels();
		renderBody();
		const ready = connected(settings.provider) && !showingKeys;
		const shot = APP.snapshot();
		target.textContent = shot ? `${ shot.title } · ${ shot.intervalLabel }` : '';
		sendButton.textContent = streaming ? '중지' : '보내기';
		briefButton.disabled = !ready || streaming !== null;
		input.disabled = !ready;
		sendButton.disabled = !ready;
	}

	async function refreshStatus() {
		try {
			status = await api('/api/ai/status');
		}
		catch {
			status = {};
		}
	}

	/** content를 보내고 답을 받아 적는다. label이 있으면 화면에는 label만 보인다. */
	async function send(content, label, full) {
		if (streaming || !content.trim()) return;
		const model = currentModel();
		if (!model) {
			note('모델을 고를 수 없습니다. 계정 연결을 확인하세요.');
			return;
		}
		const context = await chartContext(full);
		const provider = settings.provider;
		const user = { role: 'user', content: full && context ? `${ content }\n\n[차트 자료]\n${ context.text }` : content, label };
		const reply = { role: 'assistant', content: '' };
		messages.push(user, reply);
		streaming = new AbortController();
		renderAll();
		body.scrollTop = body.scrollHeight;
		const history = messages.filter(message => message !== reply && !message.error && (message.role === 'user' || (message.role === 'assistant' && message.content)))
			.map(message => ({ role: message.role, content: message.content }));
		// 브리핑은 자료를 질문에 붙였으므로 요약을 다시 붙이지 않는다.
		const system = context && !full ? `${ SYSTEM }\n\n[현재 차트 요약]\n${ context.text }` : SYSTEM;
		let pending = false;
		try {
			await stream(provider, model, system, history, (text) => {
				reply.content += text;
				if (pending) return;
				pending = true;
				requestAnimationFrame(() => {
					pending = false;
					renderBody();
				});
			}, streaming.signal);
			if (!reply.content) reply.content = '(빈 응답)';
		}
		catch (error) {
			if (error.name === 'AbortError') reply.content += reply.content ? '\n\n(중지됨)' : '(중지됨)';
			else {
				reply.error = true;
				reply.content = `요청이 실패했습니다: ${ error.message }`;
				user.error = true;
			}
		}
		streaming = null;
		renderAll();
	}

	function submit() {
		if (streaming) {
			streaming.abort();
			return;
		}
		const text = input.value;
		if (!text.trim()) return;
		input.value = '';
		send(text, undefined, false);
	}

	function setOpen(open) {
		settings.open = open;
		saveSettings();
		panel.hidden = !open;
		button.classList.toggle('on', open);
		if (open) {
			renderAll();
			loadModels();
		}
	}

	panel.append(
		el('div', { class: 'ai-head' }, el('b', { text: 'AI 분석' }), target, el('span', { class: 'spacer' }), keysButton, closeButton),
		el('div', { class: 'ai-pick' }, providerBar, modelSelect),
		body,
		el('div', { class: 'ai-quick' }, kindSelect, briefButton, webButton, el('span', { class: 'spacer' }), clearButton),
		el('div', { class: 'ai-input' }, input, sendButton));

	button.addEventListener('click', () => setOpen(panel.hidden));
	closeButton.addEventListener('click', () => setOpen(false));
	keysButton.addEventListener('click', () => {
		showingKeys = !showingKeys;
		renderAll();
	});
	modelSelect.addEventListener('change', () => {
		settings.models[listKey(settings.provider)] = modelSelect.value;
		saveSettings();
	});
	const askPlaceholder = input.placeholder;
	const showKind = () => {
		const prompt = PROMPTS[kindSelect.value];
		briefButton.textContent = prompt.button;
		briefButton.title = `${ prompt.name }: 지금 차트 자료를 붙여 요청합니다. 입력창에 글을 적어 두면 [내 메모]로 함께 보냅니다.`;
		webButton.textContent = prompt.web;
		input.placeholder = prompt.memo ?? askPlaceholder;
	};
	showKind();
	kindSelect.addEventListener('change', showKind);
	sendButton.addEventListener('click', submit);
	briefButton.addEventListener('click', () => {
		const shot = APP.snapshot();
		const prompt = PROMPTS[kindSelect.value];
		if (!shot) return;
		const memo = input.value;
		input.value = '';
		send(promptText(prompt, memo), `${ prompt.name } 요청 · ${ shot.title } (${ shot.intervalLabel })${ memo.trim() ? ` · 메모: ${ memo.trim() }` : '' }`, true);
	});
	webButton.addEventListener('click', briefOnWeb);
	clearButton.addEventListener('click', () => {
		streaming?.abort();
		messages = [];
		renderAll();
	});
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			submit();
		}
	});
	// 종목이나 주기가 바뀌면 머리글의 대상 표시를 맞춘다.
	APP.onChange(() => {
		if (!panel.hidden) renderAll();
	});

	refreshStatus().then(() => setOpen(settings.open));
})();
