// 작도 도구. 작도는 (시각, 가격) 기준점으로 저장하고, 차트가 다시 그려질 때마다 화면 좌표로 바꿔 그린다.
window.ChartDeskDrawings = (() => {
	'use strict';

	const HANDLE_RADIUS = 5;
	const HIT_DISTANCE = 6;
	const MAGNET_DISTANCE = 14;
	const DASHES = { solid: [], dashed: [6, 4], dotted: [2, 3] };
	const BASE_STYLE = { color: '#2962ff', width: 2, dash: 'solid' };
	const FIB_COLORS = ['#787b86', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#787b86', '#a855f7'];
	const PROFIT = '#14b8a6';
	const LOSS = '#ef4444';
	const levelsOf = values => values.map((value, i) => ({ value, color: FIB_COLORS[i % FIB_COLORS.length], on: true }));

	const RETRACE = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
	const EXTENSION = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618];
	const QUARTERS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
	const FIB_STYLE = { color: '#787b86', width: 1, fill: 0.08 };
	const GANN_RATIOS = [[1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'], [1, '1/1'], [2, '2/1'], [3, '3/1'], [4, '4/1'], [8, '8/1']];
	const LINE_FIELDS = ['color', 'width', 'dash'];
	const FILL_FIELDS = ['color', 'width', 'dash', 'fill'];
	const LEVEL_FIELDS = ['color', 'width', 'dash', 'fill', 'levels'];
	const TEXT_FIELDS = ['text', 'size', 'color'];
	const PHI = 1.618033988749895;

	// points: 기준점 개수. 'free'는 끌어서, 'many'는 원하는 만큼 찍고 두 번 눌러(또는 Enter) 끝내는 도구.
	// loose: 봉에 맞추지 않고 누른 자리에 그대로 둔다.
	const pattern = (id, name, labels, extra = {}) =>
		({ id, type: 'pattern', name, points: labels.length, icon: 'pattern', style: { fill: 0.12 }, fields: FILL_FIELDS, labels, ...extra });
	const TOOLS = [
		// 선
		{ id: 'trend', type: 'line', name: '추세선', key: 'T', points: 2, style: { extend: 'none' } },
		{ id: 'ray', type: 'line', name: '레이 (반직선)', points: 2, style: { extend: 'right' } },
		{ id: 'info', type: 'line', name: '정보 라인', points: 2, style: { extend: 'none', info: 'info' } },
		{ id: 'extended', type: 'line', name: '연장선', points: 2, style: { extend: 'both' } },
		{ id: 'angle', type: 'line', name: '추세 각도', points: 2, style: { extend: 'none', info: 'angle' } },
		{ id: 'hline', type: 'hline', name: '수평선', key: 'H', points: 1 },
		{ id: 'hray', type: 'hray', name: '수평 레이', key: 'J', points: 1, style: { direction: 'right' }, fields: ['color', 'width', 'dash', 'direction'] },
		{ id: 'vline', type: 'vline', name: '수직선', key: 'V', points: 1 },
		{ id: 'cross', type: 'cross', name: '크로스라인', key: 'C', points: 1 },
		// 채널
		{ id: 'channel', type: 'channel', name: '평행 채널', points: 3, style: { fill: 0.12 } },
		{ id: 'regression', type: 'regression', name: '회귀 추세', points: 2, style: { fill: 0.1, dev: 2 } },
		{ id: 'flat', type: 'flat', name: '수평 상단/하단', points: 3, style: { fill: 0.12 } },
		{ id: 'disjoint', type: 'disjoint', name: '평행하지 않은 채널', points: 3, style: { fill: 0.12 } },
		// 피치포크
		{ id: 'pitchfork', type: 'pitchfork', name: '피치포크', points: 3, style: { fill: 0.08, variant: 'standard' } },
		{ id: 'schiff', type: 'pitchfork', name: '쉬프 피치포크', points: 3, icon: 'pitchfork', style: { fill: 0.08, variant: 'schiff' } },
		{ id: 'mschiff', type: 'pitchfork', name: '수정 쉬프 피치포크', points: 3, icon: 'pitchfork', style: { fill: 0.08, variant: 'modified' } },
		{ id: 'inside', type: 'pitchfork', name: '피치포크 안', points: 3, style: { fill: 0.08, variant: 'inside' } },
		// 피보나치
		{ id: 'fib', type: 'fib', name: '피보나치 되돌림', key: 'F', points: 2, style: { ...FIB_STYLE, extendLeft: false, extendRight: false, showPrices: true }, levels: RETRACE },
		{ id: 'fibext', type: 'fibext', name: '추세 기반 피보나치 확장', points: 3, style: { ...FIB_STYLE, extendLeft: false, extendRight: false, showPrices: true }, levels: EXTENSION },
		{ id: 'fibchannel', type: 'fibchannel', name: '피보나치 채널', points: 3, style: FIB_STYLE, levels: RETRACE },
		{ id: 'fibtime', type: 'fibtime', name: '피보나치 타임존', points: 2, style: { ...FIB_STYLE, fill: 0 }, levels: [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89] },
		{ id: 'fibfan', type: 'fibfan', name: '피보나치 스피드 저항 팬', points: 2, style: { ...FIB_STYLE, fill: 0 }, levels: QUARTERS },
		{ id: 'fibtrendtime', type: 'fibtrendtime', name: '추세 기반 피보나치 시간', points: 3, icon: 'fibtime', style: { ...FIB_STYLE, fill: 0 }, levels: [0, 0.382, 0.618, 1, 1.382, 1.618, 2, 2.618, 3] },
		{ id: 'fibcircle', type: 'fibcircle', name: '피보나치 서클', points: 2, style: { ...FIB_STYLE, fill: 0 }, levels: [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618] },
		{ id: 'fibspiral', type: 'fibspiral', name: '피보나치 나선', points: 2, style: { color: '#787b86', width: 1 }, loose: true },
		{ id: 'fibarc', type: 'fibarc', name: '피보나치 스피드 저항 아크', points: 2, style: { ...FIB_STYLE, fill: 0 }, levels: [0.236, 0.382, 0.5, 0.618, 0.786, 1] },
		{ id: 'fibwedge', type: 'fibwedge', name: '피보나치 웨지', points: 3, style: { ...FIB_STYLE, fill: 0 }, fields: ['color', 'width', 'dash', 'levels'], levels: [0.236, 0.382, 0.5, 0.618, 0.786, 1], loose: true },
		{ id: 'pitchfan', type: 'pitchfan', name: '피치팬', points: 3, style: { ...FIB_STYLE, fill: 0 }, fields: ['color', 'width', 'dash', 'levels'], levels: QUARTERS },
		// 갠
		{ id: 'gannbox', type: 'gannbox', name: '갠 박스', points: 2, style: { ...FIB_STYLE, fill: 0.05 }, levels: QUARTERS },
		{ id: 'gannfixed', type: 'gannsquare', name: '갠 스퀘어 고정', points: 2, icon: 'gannsquare', style: { color: '#787b86', width: 1, fill: 0.04, fixed: true }, fields: FILL_FIELDS },
		{ id: 'gannsquare', type: 'gannsquare', name: '갠 스퀘어', points: 2, style: { color: '#787b86', width: 1, fill: 0.04 }, fields: FILL_FIELDS },
		{ id: 'gannfan', type: 'gannfan', name: '갠 팬', points: 2, style: { color: '#787b86', width: 1 } },
		// 차트 패턴
		pattern('xabcd', 'XABCD 패턴', ['X', 'A', 'B', 'C', 'D'], { fills: [[0, 1, 2], [2, 3, 4]], ratios: true }),
		pattern('cypher', '사이퍼 패턴', ['X', 'A', 'B', 'C', 'D'], { fills: [[0, 1, 2], [2, 3, 4]], ratios: true }),
		pattern('hs', '헤드 앤 숄더', ['', '왼쪽 어깨', '', '머리', '', '오른쪽 어깨', ''], { fills: [[1, 2, 3], [3, 4, 5]], extended: [[2, 4]] }),
		pattern('abcd', 'ABCD 패턴', ['A', 'B', 'C', 'D'], { ratios: true }),
		pattern('tripattern', '삼각형 패턴', ['A', 'B', 'C', 'D'], { extended: [[0, 2], [1, 3]] }),
		pattern('drives', '쓰리 드라이브 패턴', ['', '1', '', '2', '', '3', ''], { ratios: true }),
		// 엘리엇 파동
		pattern('ew12345', '엘리엇 충격 파동 (1·2·3·4·5)', ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)'], { icon: 'wave' }),
		pattern('ewabc', '엘리엇 조정 파동 (A·B·C)', ['(0)', '(A)', '(B)', '(C)'], { icon: 'wave' }),
		pattern('ewabcde', '엘리엇 삼각 파동 (A·B·C·D·E)', ['(0)', '(A)', '(B)', '(C)', '(D)', '(E)'], { icon: 'wave' }),
		pattern('ewwxy', '엘리엇 이중 콤보 파동 (W·X·Y)', ['(0)', '(W)', '(X)', '(Y)'], { icon: 'wave' }),
		pattern('ewwxyxz', '엘리엇 삼중 콤보 파동 (W·X·Y·X·Z)', ['(0)', '(W)', '(X)', '(Y)', '(X)', '(Z)'], { icon: 'wave' }),
		// 사이클
		{ id: 'cyclelines', type: 'cycle', name: '순환선', points: 2, style: { width: 1, variant: 'lines' } },
		{ id: 'timecycles', type: 'cycle', name: '시간 주기', points: 2, style: { width: 1, variant: 'arcs' } },
		{ id: 'sine', type: 'cycle', name: '사인 라인', points: 2, style: { width: 1, variant: 'sine' } },
		// 예측
		{ id: 'long', type: 'position', name: '매수 포지션', points: 1, style: { side: 'long' }, fields: [], seed: true },
		{ id: 'short', type: 'position', name: '매도 포지션', points: 1, style: { side: 'short' }, fields: [], seed: true },
		{ id: 'forecast', type: 'forecast', name: '포지션 예측', points: 2, fields: ['width', 'dash'] },
		{ id: 'barspattern', type: 'barspattern', name: '봉패턴', points: 2, style: { color: '#787b86' }, fields: ['color'], progressive: true },
		{ id: 'ghost', type: 'ghost', name: '고스트 피드', points: 'many', fields: [] },
		{ id: 'sector', type: 'sector', name: '섹터', points: 3, style: { fill: 0.15 }, fields: FILL_FIELDS, loose: true },
		// 거래량 기반
		{ id: 'avwap', type: 'avwap', name: '고정 VWAP', points: 1, style: { color: '#f59e0b' } },
		{ id: 'vprofile', type: 'profile', name: '고정 범위 볼륨 프로필', points: 2, icon: 'profile', fields: ['color'] },
		{ id: 'avprofile', type: 'profile', name: '고정 거래량 프로파일', points: 1, icon: 'profile', fields: ['color'] },
		// 측정
		{ id: 'pricerange', type: 'measure', name: '가격 범위', points: 2, style: { mode: 'price' }, fields: [] },
		{ id: 'daterange', type: 'measure', name: '날짜 범위', points: 2, style: { mode: 'date' }, fields: [] },
		{ id: 'measure', type: 'measure', name: '날짜 및 가격 범위', points: 2, style: { mode: 'both' }, fields: [] },
		// 브러시
		{ id: 'brush', type: 'brush', name: '브러시', points: 'free' },
		{ id: 'highlighter', type: 'brush', name: '형광펜', points: 'free', style: { color: '#facc15', width: 14, alpha: 0.4 } },
		// 화살표
		{ id: 'arrow', type: 'line', name: '화살표', points: 2, style: { extend: 'none', arrow: true }, fields: LINE_FIELDS },
		{ id: 'arrowup', type: 'mark', name: '위쪽 화살표', points: 1, style: { color: PROFIT, glyph: 'up' }, fields: ['color'], loose: true },
		{ id: 'arrowmarker', type: 'arrowmarker', name: '화살표 마커', points: 2, fields: ['color'], loose: true },
		{ id: 'arrowdown', type: 'mark', name: '아래쪽 화살표', points: 1, style: { color: LOSS, glyph: 'down' }, fields: ['color'], loose: true },
		// 도형
		{ id: 'rect', type: 'rect', name: '사각형', key: 'R', points: 2, style: { fill: 0.15 } },
		{ id: 'rotrect', type: 'rotrect', name: '회전된 사각형', points: 3, style: { fill: 0.15 }, loose: true },
		{ id: 'path', type: 'path', name: '경로', points: 'many', style: { arrow: true }, fields: LINE_FIELDS },
		{ id: 'circle', type: 'circle', name: '원', points: 2, style: { fill: 0.15 }, loose: true },
		{ id: 'ellipse', type: 'ellipse', name: '타원', points: 2, style: { fill: 0.15 }, loose: true },
		{ id: 'polyline', type: 'polyline', name: '폴리라인', points: 'many', style: { fill: 0.15 } },
		{ id: 'triangle', type: 'triangle', name: '삼각형', points: 3, style: { fill: 0.15 } },
		{ id: 'arc', type: 'arc', name: '호', points: 3, loose: true },
		{ id: 'curve', type: 'curve', name: '곡선', points: 3, loose: true },
		{ id: 'doublecurve', type: 'doublecurve', name: '이중 곡선', points: 4, loose: true },
		// 텍스트와 노트
		{ id: 'text', type: 'text', name: '텍스트', points: 1, style: { text: '텍스트', size: 14 }, loose: true, edit: true },
		{ id: 'note', type: 'note', name: '노트', points: 1, style: { text: '노트', size: 13 }, fields: TEXT_FIELDS, loose: true, edit: true },
		{ id: 'pricenote', type: 'pricenote', name: '가격 노트', points: 2, style: { text: '', size: 13 }, fields: TEXT_FIELDS, edit: true },
		{ id: 'pin', type: 'pin', name: '핀', points: 1, style: { color: LOSS, text: '', size: 13 }, fields: TEXT_FIELDS, loose: true, edit: true },
		{ id: 'table', type: 'table', name: '테이블', points: 1, style: { text: '항목 | 값\n진입 | \n목표 | ', size: 13 }, fields: TEXT_FIELDS, loose: true, edit: true },
		{ id: 'callout', type: 'callout', name: '말풍선', points: 2, style: { text: '메모', size: 13 }, loose: true, edit: true },
		{ id: 'comment', type: 'comment', name: '코멘트', points: 1, style: { text: '코멘트', size: 13 }, fields: TEXT_FIELDS, loose: true, edit: true },
		{ id: 'pricelabel', type: 'pricelabel', name: '가격 라벨', points: 1, fields: ['color'] },
		{ id: 'signpost', type: 'signpost', name: '이정표', points: 1, style: { text: '이정표', size: 13 }, fields: TEXT_FIELDS, edit: true },
		{ id: 'flag', type: 'mark', name: '깃발 마크', points: 1, style: { color: LOSS, glyph: 'flag' }, fields: ['color'], loose: true },
		{ id: 'image', type: 'image', name: '이미지', points: 1, style: { image: '', ratio: 0.6, imageWidth: 180 }, fields: ['image'], loose: true, edit: true },
		// 그리고 나면 목록에 남지 않는 도구. 왼쪽 막대의 재기·확대 버튼이 쓴다.
		{ id: 'ruler', type: 'measure', name: '재기', points: 2, style: { mode: 'both' }, fields: [], transient: 'ruler' },
		{ id: 'zoom', type: 'rect', name: '확대', points: 2, style: { width: 1, dash: 'dashed', fill: 0.12 }, transient: 'zoom' },
	];
	const byId = new Map(TOOLS.map(tool => [tool.id, tool]));

	// 왼쪽 도구 막대의 묶음. 묶음마다 마지막에 쓴 도구가 대표로 보인다.
	const GROUPS = [
		{ id: 'lines', name: '추세 도구', sections: [
			['라인', ['trend', 'ray', 'info', 'extended', 'angle', 'hline', 'hray', 'vline', 'cross']],
			['채널', ['channel', 'regression', 'flat', 'disjoint']],
			['피치포크', ['pitchfork', 'schiff', 'mschiff', 'inside']],
		] },
		{ id: 'fib', name: '갠 및 피보나치 도구', sections: [
			['피보나치', ['fib', 'fibext', 'fibchannel', 'fibtime', 'fibfan', 'fibtrendtime', 'fibcircle', 'fibspiral', 'fibarc', 'fibwedge', 'pitchfan']],
			['갠', ['gannbox', 'gannfixed', 'gannsquare', 'gannfan']],
		] },
		{ id: 'patterns', name: '패턴', sections: [
			['차트 패턴', ['xabcd', 'cypher', 'hs', 'abcd', 'tripattern', 'drives']],
			['엘리엇 파동', ['ew12345', 'ewabc', 'ewabcde', 'ewwxy', 'ewwxyxz']],
			['사이클', ['cyclelines', 'timecycles', 'sine']],
		] },
		{ id: 'measure', name: '예측 및 측정 도구', sections: [
			['예측', ['long', 'short', 'forecast', 'barspattern', 'ghost', 'sector']],
			['거래량 기반', ['avwap', 'vprofile', 'avprofile']],
			['측정 도구', ['pricerange', 'daterange', 'measure']],
		] },
		{ id: 'shapes', name: '도형', sections: [
			['브러시', ['brush', 'highlighter']],
			['화살표', ['arrowmarker', 'arrow', 'arrowup', 'arrowdown']],
			['도형', ['rect', 'rotrect', 'path', 'circle', 'ellipse', 'polyline', 'triangle', 'arc', 'curve', 'doublecurve']],
		] },
		{ id: 'notes', name: '텍스트 및 노트', sections: [
			['텍스트 및 노트', ['text', 'note', 'pricenote', 'pin', 'table', 'callout', 'comment', 'pricelabel', 'signpost', 'flag']],
			['콘텐츠', ['image']],
		] },
	];

	// 설정 창에 보여 줄 항목. 도구에 fields가 있으면 그것을 쓴다.
	const TYPE_FIELDS = {
		line: ['color', 'width', 'dash', 'extend'],
		brush: LINE_FIELDS,
		channel: FILL_FIELDS,
		flat: FILL_FIELDS,
		disjoint: FILL_FIELDS,
		regression: ['color', 'width', 'dash', 'fill', 'dev'],
		pitchfork: FILL_FIELDS,
		rect: FILL_FIELDS,
		rotrect: FILL_FIELDS,
		circle: FILL_FIELDS,
		ellipse: FILL_FIELDS,
		polyline: FILL_FIELDS,
		triangle: FILL_FIELDS,
		fib: ['color', 'width', 'dash', 'fill', 'extendLeft', 'extendRight', 'showPrices', 'levels'],
		fibext: ['color', 'width', 'dash', 'fill', 'extendLeft', 'extendRight', 'showPrices', 'levels'],
		fibchannel: LEVEL_FIELDS,
		gannbox: LEVEL_FIELDS,
		fibtime: ['color', 'width', 'dash', 'levels'],
		fibtrendtime: ['color', 'width', 'dash', 'levels'],
		fibfan: ['color', 'width', 'dash', 'levels'],
		fibcircle: ['color', 'width', 'dash', 'levels'],
		fibarc: ['color', 'width', 'dash', 'levels'],
		text: ['text', 'size', 'color'],
		callout: ['text', 'size', 'color'],
	};
	const fieldsOf = drawing => byId.get(drawing.tool).fields ?? TYPE_FIELDS[drawing.type] ?? LINE_FIELDS;
	const levelsFor = toolId => levelsOf(byId.get(toolId).levels ?? RETRACE);

	function defaultStyle(toolId, remembered) {
		const tool = byId.get(toolId);
		const style = { ...BASE_STYLE, ...tool.style, ...(remembered ?? {}) };
		if (tool.levels && !Array.isArray(style.levels)) style.levels = levelsOf(tool.levels);
		return structuredClone(style);
	}

	function rgba(hex, alpha) {
		const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#2962ff';
		const channel = offset => parseInt(value.slice(offset, offset + 2), 16);
		return `rgba(${ channel(1) }, ${ channel(3) }, ${ channel(5) }, ${ alpha })`;
	}

	function distanceToSegment(point, a, b) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const lengthSquared = dx * dx + dy * dy;
		const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
		return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
	}

	function insidePolygon(point, polygon) {
		let inside = false;
		for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
			const a = polygon[i];
			const b = polygon[j];
			if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
		}
		return inside;
	}

	/** 선분을 화면 밖까지 늘린다. */
	function extend(a, b, left, right) {
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		if (length === 0) return [a, b];
		const far = 20000 / length;
		const stretch = (from, to) => ({ x: to.x + (to.x - from.x) * far, y: to.y + (to.y - from.y) * far });
		return [left ? stretch(b, a) : a, right ? stretch(a, b) : b];
	}

	const rectangle = (a, b) => [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
	const measurer = document.createElement('canvas').getContext('2d');
	const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
	const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
	const shifted = (point, dx, dy) => ({ x: point.x + dx, y: point.y + dy });
	const closed = points => [...points, points[0]];

	/** 타원(또는 그 일부)을 꺾은선으로 만든다. 각도는 화면 좌표 기준 라디안. */
	function ellipsePoints(center, rx, ry, from = 0, to = Math.PI * 2, steps = 72) {
		const points = [];
		for (let i = 0; i <= steps; i++) {
			const angle = from + (to - from) * i / steps;
			points.push({ x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry });
		}
		return points;
	}

	/** a에서 b로 가면서 c 쪽으로 휘는 2차 곡선. 곡선의 가운데가 c를 지난다. */
	function curvePoints(a, b, c, steps = 40) {
		const control = { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 };
		const points = [];
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const u = 1 - t;
			points.push({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y });
		}
		return points;
	}

	/** a에서 b까지 c를 지나는 원호. 세 점이 한 줄이면 직선. */
	function arcPoints(a, b, c) {
		const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
		if (Math.abs(d) < 1e-6) return [a, b];
		const sq = point => point.x * point.x + point.y * point.y;
		const center = {
			x: (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d,
			y: (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d,
		};
		const angle = point => Math.atan2(point.y - center.y, point.x - center.x);
		const turn = value => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
		const start = angle(a);
		let sweep = turn(angle(b) - start);
		if (turn(angle(c) - start) > sweep) sweep -= Math.PI * 2;
		const radius = distance(center, a);
		return ellipsePoints(center, radius, radius, start, start + sweep, 60);
	}

	function arrowHead(shape, from, to, stroke) {
		const angle = Math.atan2(to.y - from.y, to.x - from.x);
		const size = 8 + stroke.width * 2;
		const wing = offset => ({ x: to.x - Math.cos(angle + offset) * size, y: to.y - Math.sin(angle + offset) * size });
		shape.paths.push({ ...stroke, dash: 'solid', points: [wing(0.45), to, wing(-0.45)] });
	}

	function duration(seconds) {
		const total = Math.abs(Math.round(seconds));
		const days = Math.floor(total / 86400);
		const hours = Math.floor(total % 86400 / 3600);
		const minutes = Math.floor(total % 3600 / 60);
		const parts = [];
		if (days) parts.push(`${ days }일`);
		if (hours) parts.push(`${ hours }시간`);
		if (!days && minutes) parts.push(`${ minutes }분`);
		return parts.join(' ') || '0분';
	}

	const activeLevels = style => style.levels
		.filter(level => level.on && Number.isFinite(level.value))
		.sort((x, y) => x.value - y.value);

	// 작도 종류별로 모양을 만드는 함수. c = { drawing, tool, style, stroke, px(화면 좌표), points, shape, size }
	const BUILDERS = {
		line(layer, c) {
			const [a, b] = c.px;
			const { style, shape } = c;
			shape.paths.push({ ...c.stroke, points: extend(a, b, style.extend === 'both' || style.extend === 'left', style.extend === 'both' || style.extend === 'right') });
			if (style.arrow) arrowHead(shape, a, b, c.stroke);
			const degrees = Math.atan2(a.y - b.y, b.x - a.x) * 180 / Math.PI;
			if (style.info === 'angle') {
				shape.paths.push({ color: style.color, width: 1, dash: 'dotted', points: [a, shifted(a, 64, 0)] });
				shape.paths.push({ color: style.color, width: 1, dash: 'solid', points: ellipsePoints(a, 28, 28, 0, -degrees * Math.PI / 180, 16) });
				layer.text(shape, `${ degrees.toFixed(1) }°`, a.x + 70, a.y - 7, style.color, { size: 12 });
			}
			else if (style.info === 'info') {
				const stats = layer.stats(c.points[0], c.points[1]);
				const at = middle(a, b);
				layer.text(shape, `${ stats.price } · ${ stats.bars }봉 (${ duration(stats.seconds) }) · ${ degrees.toFixed(1) }°`, at.x, at.y - 26, '#ffffff',
					{ size: 12, align: 'center', background: style.color });
			}
		},

		hline(layer, c) {
			c.shape.paths.push({ ...c.stroke, points: [{ x: 0, y: c.px[0].y }, { x: c.size.width, y: c.px[0].y }] });
		},

		hray(layer, c) {
			c.shape.paths.push({ ...c.stroke, points: [c.px[0], { x: c.style.direction === 'left' ? 0 : c.size.width, y: c.px[0].y }] });
		},

		vline(layer, c) {
			c.shape.paths.push({ ...c.stroke, points: [{ x: c.px[0].x, y: 0 }, { x: c.px[0].x, y: c.size.height }] });
		},

		cross(layer, c) {
			BUILDERS.hline(layer, c);
			BUILDERS.vline(layer, c);
		},

		brush(layer, c) {
			c.shape.paths.push({ ...c.stroke, alpha: c.style.alpha, points: c.px });
			c.shape.handles = [];
		},

		/** 두 선과 그 사이를 그린다. 채널 종류가 함께 쓴다. */
		band(c, near, far, mid) {
			const { style, shape } = c;
			const corners = [near[0], near[1], far[1], far[0]];
			shape.paths.push({ ...c.stroke, points: near }, { ...c.stroke, points: far });
			if (mid) shape.paths.push({ color: style.color, width: 1, dash: 'dashed', points: mid });
			if (style.fill > 0) shape.fills.push({ color: rgba(style.color, style.fill), points: corners });
			shape.areas.push(corners);
		},

		channel(layer, c) {
			const [a, b, p] = c.px;
			// 세 번째 점을 지나도록 기준선을 평행 이동한다.
			const onLine = b.x === a.x ? a.y : a.y + (b.y - a.y) * (p.x - a.x) / (b.x - a.x);
			const offset = p.y - onLine;
			BUILDERS.band(c, [a, b], [shifted(a, 0, offset), shifted(b, 0, offset)], [shifted(a, 0, offset / 2), shifted(b, 0, offset / 2)]);
		},

		flat(layer, c) {
			const [a, b, p] = c.px;
			BUILDERS.band(c, [a, b], [{ x: a.x, y: p.y }, { x: b.x, y: p.y }]);
		},

		disjoint(layer, c) {
			const [a, b, p] = c.px;
			// 두 번째 선은 기준선과 기울기가 반대다.
			BUILDERS.band(c, [a, b], [{ x: a.x, y: p.y + (b.y - a.y) }, { x: b.x, y: p.y }]);
		},

		regression(layer, c) {
			const bars = layer.env.bars();
			const { style, shape } = c;
			const ends = c.points.map(point => Math.round(layer.logicalOfTime(point.t)));
			const from = Math.max(0, Math.min(...ends));
			const to = Math.min(bars.length - 1, Math.max(...ends));
			const count = to - from + 1;
			if (count < 2) return;
			let sumX = 0;
			let sumY = 0;
			let sumXY = 0;
			let sumXX = 0;
			for (let i = from; i <= to; i++) {
				const x = i - from;
				sumX += x;
				sumY += bars[i].close;
				sumXY += x * bars[i].close;
				sumXX += x * x;
			}
			const slope = (count * sumXY - sumX * sumY) / (count * sumXX - sumX * sumX);
			const base = (sumY - slope * sumX) / count;
			let squares = 0;
			for (let i = from; i <= to; i++) squares += (bars[i].close - (base + slope * (i - from))) ** 2;
			const spread = Math.sqrt(squares / count) * (Number.isFinite(style.dev) ? style.dev : 2);
			const line = (shift) => {
				const points = [layer.pixelAt(from, base + shift), layer.pixelAt(to, base + slope * (count - 1) + shift)];
				return points.every(Boolean) ? points : null;
			};
			const [mid, upper, lower] = [line(0), line(spread), line(-spread)];
			if (!mid || !upper || !lower) return;
			BUILDERS.band(c, upper, lower, mid);
			shape.handles = [mid[0], mid[1]];
			if (ends[0] > ends[1]) shape.handles.reverse();
		},

		pitchfork(layer, c) {
			const [a, b, p] = c.px;
			const { style, shape } = c;
			const origin = style.variant === 'schiff' ? { x: a.x, y: (a.y + b.y) / 2 } : style.variant === 'standard' ? a : middle(a, b);
			const target = middle(b, p);
			// '안' 피치포크는 첫 두 점의 가운데에서 시작하되, 기울기는 기본 피치포크와 같다.
			const base = style.variant === 'inside' ? a : origin;
			const ray = from => extend(from, shifted(from, target.x - base.x, target.y - base.y), false, true);
			const [upper, lower] = [ray(b), ray(p)];
			if (style.fill > 0) shape.fills.push({ color: rgba(style.color, style.fill), points: [upper[0], upper[1], lower[1], lower[0]] });
			shape.paths.push({ ...c.stroke, points: [b, p] }, { ...c.stroke, points: ray(origin) }, { ...c.stroke, points: upper }, { ...c.stroke, points: lower });
			if (origin !== a) shape.paths.push({ color: style.color, width: 1, dash: 'dashed', points: [a, b] });
		},

		/** 가격 레벨마다 가로선을 긋는다. 되돌림과 확장이 함께 쓴다. */
		priceLevels(layer, c, priceOf, left, right) {
			const { style, shape } = c;
			const levels = activeLevels(style)
				.map((level) => {
					const price = priceOf(level.value);
					return { ...level, price, y: layer.env.series().priceToCoordinate(price) };
				})
				.filter(level => level.y !== null);
			levels.forEach((level, i) => {
				const next = levels[i + 1];
				if (next && style.fill > 0) {
					shape.fills.push({ color: rgba(next.color, style.fill), points: rectangle({ x: left, y: level.y }, { x: right, y: next.y }) });
				}
				shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: [{ x: left, y: level.y }, { x: right, y: level.y }] });
				const text = style.showPrices ? `${ level.value } (${ layer.env.formatPrice(level.price) })` : String(level.value);
				layer.text(shape, text, left + 4, level.y - 15, level.color);
			});
		},

		fib(layer, c) {
			const [a, b] = c.px;
			const [start, end] = c.points;
			c.shape.paths.push({ color: c.style.color, width: 1, dash: 'dashed', points: [a, b] });
			// 0은 두 번째 점, 1은 첫 번째 점의 가격이다.
			BUILDERS.priceLevels(layer, c, value => end.p + (start.p - end.p) * value,
				c.style.extendLeft ? 0 : Math.min(a.x, b.x), c.style.extendRight ? c.size.width : Math.max(a.x, b.x));
		},

		fibext(layer, c) {
			const [a, b, p] = c.px;
			const [start, end, base] = c.points;
			c.shape.paths.push({ color: c.style.color, width: 1, dash: 'dashed', points: [a, b, p] });
			// 첫 두 점의 움직임을 세 번째 점에서 다시 잰다.
			BUILDERS.priceLevels(layer, c, value => base.p + (end.p - start.p) * value,
				c.style.extendLeft ? 0 : Math.min(a.x, b.x, p.x), c.style.extendRight ? c.size.width : Math.max(a.x, b.x, p.x));
		},

		fibchannel(layer, c) {
			const [a, b, p] = c.px;
			const { style, shape } = c;
			const onLine = b.x === a.x ? a.y : a.y + (b.y - a.y) * (p.x - a.x) / (b.x - a.x);
			const offset = p.y - onLine;
			const levels = activeLevels(style).map(level => ({ ...level, line: [shifted(a, 0, offset * level.value), shifted(b, 0, offset * level.value)] }));
			levels.forEach((level, i) => {
				const next = levels[i + 1];
				if (next && style.fill > 0) shape.fills.push({ color: rgba(next.color, style.fill), points: [level.line[0], level.line[1], next.line[1], next.line[0]] });
				shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: level.line });
				const left = level.line[0].x <= level.line[1].x ? level.line[0] : level.line[1];
				layer.text(shape, String(level.value), left.x + 4, left.y - 15, level.color);
			});
		},

		/** 시간 레벨마다 세로선을 긋는다. */
		timeLevels(layer, c, origin, unit) {
			const { style, shape, size } = c;
			if (Math.abs(unit) < 1) return;
			for (const level of activeLevels(style)) {
				const x = origin + unit * level.value;
				if (x < -20 || x > size.width + 20) continue;
				shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: [{ x, y: 0 }, { x, y: size.height }] });
				layer.text(shape, String(level.value), x + 4, size.height - 18, level.color);
			}
		},

		fibtime(layer, c) {
			const [a, b] = c.px;
			c.shape.paths.push({ color: c.style.color, width: 1, dash: 'dashed', points: [a, b] });
			BUILDERS.timeLevels(layer, c, a.x, b.x - a.x);
		},

		fibtrendtime(layer, c) {
			const [a, b, p] = c.px;
			c.shape.paths.push({ color: c.style.color, width: 1, dash: 'dashed', points: [a, b, p] });
			BUILDERS.timeLevels(layer, c, p.x, b.x - a.x);
		},

		fibfan(layer, c) {
			const [a, b] = c.px;
			const { style, shape } = c;
			for (const level of activeLevels(style)) {
				const targets = [{ x: b.x, y: a.y + (b.y - a.y) * level.value }];
				if (level.value !== 1) targets.push({ x: a.x + (b.x - a.x) * level.value, y: b.y });
				for (const target of targets) {
					shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: extend(a, target, false, true) });
					layer.text(shape, String(level.value), target.x + 4, target.y - 14, level.color);
				}
			}
		},

		fibcircle(layer, c) {
			const [a, b] = c.px;
			const { style, shape } = c;
			const radius = distance(a, b);
			shape.paths.push({ color: style.color, width: 1, dash: 'dashed', points: [a, b] });
			for (const level of activeLevels(style)) {
				shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: ellipsePoints(a, radius * level.value, radius * level.value) });
				layer.text(shape, String(level.value), a.x + 4, a.y - radius * level.value - 15, level.color);
			}
		},

		fibarc(layer, c) {
			const [a, b] = c.px;
			const { style, shape } = c;
			const radius = distance(a, b);
			// 두 번째 점이 있는 쪽으로만 반원을 그린다.
			const [from, to] = b.y <= a.y ? [Math.PI, Math.PI * 2] : [0, Math.PI];
			shape.paths.push({ color: style.color, width: 1, dash: 'dashed', points: [a, b] });
			for (const level of activeLevels(style)) {
				shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: ellipsePoints(a, radius * level.value, radius * level.value, from, to, 48) });
				layer.text(shape, String(level.value), a.x + radius * level.value + 4, a.y - 7, level.color);
			}
		},

		gannfan(layer, c) {
			const [a, b] = c.px;
			const { style, shape } = c;
			GANN_RATIOS.forEach(([ratio, label], i) => {
				// 1/1 선이 두 번째 점을 지난다.
				const target = ratio <= 1 ? { x: b.x, y: a.y + (b.y - a.y) * ratio } : { x: a.x + (b.x - a.x) / ratio, y: b.y };
				const color = ratio === 1 ? style.color : FIB_COLORS[i % FIB_COLORS.length];
				shape.paths.push({ color, width: style.width, dash: style.dash, points: extend(a, target, false, true) });
				layer.text(shape, label, target.x + 4, target.y - 14, color);
			});
		},

		gannbox(layer, c) {
			const [a, b] = c.px;
			const { style, shape } = c;
			const corners = rectangle(a, b);
			if (style.fill > 0) shape.fills.push({ color: rgba(style.color, style.fill), points: corners });
			shape.areas.push(corners);
			for (const level of activeLevels(style)) {
				const x = a.x + (b.x - a.x) * level.value;
				const y = a.y + (b.y - a.y) * level.value;
				shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: [{ x: a.x, y }, { x: b.x, y }] });
				shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: [{ x, y: a.y }, { x, y: b.y }] });
				layer.text(shape, String(level.value), Math.min(a.x, b.x) - 4, y - 6, level.color, { align: 'right' });
				layer.text(shape, String(level.value), x, Math.min(a.y, b.y) - 16, level.color, { align: 'center' });
			}
		},

		pattern(layer, c) {
			const { px, tool, style, shape } = c;
			for (const corners of tool.fills ?? []) {
				if (!corners.every(i => px[i])) continue;
				const points = corners.map(i => px[i]);
				if (style.fill > 0) shape.fills.push({ color: rgba(style.color, style.fill), points });
				shape.areas.push(points);
			}
			if (px.length > 1) shape.paths.push({ ...c.stroke, points: px });
			for (const [from, to] of tool.extended ?? []) {
				if (px[from] && px[to]) shape.paths.push({ color: style.color, width: 1, dash: 'dashed', points: extend(px[from], px[to], true, true) });
			}
			if (tool.ratios) {
				for (let i = 2; i < px.length; i++) {
					const previous = Math.abs(c.points[i - 1].p - c.points[i - 2].p);
					if (previous === 0) continue;
					const at = middle(px[i - 2], px[i]);
					shape.paths.push({ color: style.color, width: 1, dash: 'dotted', points: [px[i - 2], px[i]] });
					layer.text(shape, (Math.abs(c.points[i].p - c.points[i - 1].p) / previous).toFixed(3), at.x, at.y - 7, style.color, { align: 'center' });
				}
			}
			tool.labels.forEach((label, i) => {
				if (!label || !px[i]) return;
				const neighbor = px[i - 1] ?? px[i + 1];
				const above = !neighbor || px[i].y <= neighbor.y;
				layer.text(shape, label, px[i].x, above ? px[i].y - 22 : px[i].y + 8, style.color, { size: 13, align: 'center' });
			});
		},

		cycle(layer, c) {
			const [a, b] = c.px;
			const { style, shape, size } = c;
			const step = Math.abs(b.x - a.x);
			if (step < 4) return;
			if (style.variant === 'sine') {
				const points = [];
				for (let x = 0; x <= size.width; x += 3) points.push({ x, y: a.y + (b.y - a.y) * Math.sin(Math.PI / 2 * (x - a.x) / (b.x - a.x)) });
				shape.paths.push({ ...c.stroke, points });
				return;
			}
			const first = a.x - Math.ceil(a.x / step) * step;
			for (let x = first; x <= size.width; x += step) {
				if (style.variant === 'arcs') shape.paths.push({ ...c.stroke, points: ellipsePoints({ x: x + step / 2, y: a.y }, step / 2, step / 2, Math.PI, Math.PI * 2, 32) });
				else shape.paths.push({ ...c.stroke, points: [{ x, y: 0 }, { x, y: size.height }] });
			}
		},

		position(layer, c) {
			const [entry, target, stop] = c.px;
			const [entryPoint, targetPoint, stopPoint] = c.points;
			const { shape } = c;
			const stopAt = { x: target.x, y: stop.y };
			const zone = (corner, color) => {
				const corners = rectangle(entry, corner);
				shape.fills.push({ color: rgba(color, 0.18), points: corners });
				shape.areas.push(corners);
				shape.paths.push({ color, width: 1, dash: 'solid', points: [{ x: entry.x, y: corner.y }, corner] });
			};
			zone(target, PROFIT);
			zone(stopAt, LOSS);
			shape.paths.push({ color: '#787b86', width: 1, dash: 'solid', points: [entry, { x: target.x, y: entry.y }] });
			shape.handles = [entry, target, stopAt];
			const at = (entry.x + target.x) / 2;
			const outside = (y, text, color) => layer.text(shape, text, at, y < entry.y ? y - 24 : y + 8, '#ffffff', { size: 12, align: 'center', background: color });
			const percent = price => (entryPoint.p ? Math.abs(price - entryPoint.p) / entryPoint.p * 100 : 0).toFixed(2);
			const reward = Math.abs(targetPoint.p - entryPoint.p);
			const risk = Math.abs(stopPoint.p - entryPoint.p);
			outside(target.y, `목표 ${ layer.env.formatPrice(targetPoint.p) } (${ percent(targetPoint.p) }%)`, PROFIT);
			outside(stop.y, `손절 ${ layer.env.formatPrice(stopPoint.p) } (${ percent(stopPoint.p) }%)`, LOSS);
			layer.text(shape, `${ c.style.side === 'short' ? '매도' : '매수' } · 손익비 ${ risk ? (reward / risk).toFixed(2) : '–' }`, at, entry.y - 9, '#ffffff',
				{ size: 12, align: 'center', background: '#555b6b' });
		},

		avwap(layer, c) {
			const bars = layer.env.bars();
			const start = Math.max(0, Math.round(layer.logicalOfTime(c.points[0].t)));
			const visible = layer.env.chart.timeScale().getVisibleLogicalRange();
			const points = [];
			let volume = 0;
			let traded = 0;
			for (let i = start; i < bars.length; i++) {
				volume += bars[i].volume;
				traded += bars[i].volume * (bars[i].high + bars[i].low + bars[i].close) / 3;
				if (volume <= 0 || (visible && (i < visible.from - 1 || i > visible.to + 1))) continue;
				const pixel = layer.pixelAt(i, traded / volume);
				if (pixel) points.push(pixel);
			}
			if (points.length > 1) c.shape.paths.push({ ...c.stroke, points });
			// 거래량이 없는 종목은 선이 그려지지 않는다.
			else layer.text(c.shape, 'VWAP: 거래량 데이터 없음', c.px[0].x + 8, c.px[0].y - 7, c.style.color);
		},

		measure(layer, c) {
			const [a, b] = c.px;
			const { shape } = c;
			const mode = c.style.mode ?? 'both';
			const stats = layer.stats(c.points[0], c.points[1]);
			const rising = stats.change >= 0;
			const color = mode === 'date' ? '#2962ff' : rising ? '#2962ff' : '#ef4444';
			const corners = rectangle(a, b);
			const center = middle(a, b);
			shape.fills.push({ color: rgba(color, 0.15), points: corners });
			shape.areas.push(corners);
			if (mode !== 'date') {
				shape.paths.push({ color, width: 1, dash: 'solid', points: [{ x: center.x, y: a.y }, { x: center.x, y: b.y }] });
				arrowHead(shape, { x: center.x, y: a.y }, { x: center.x, y: b.y }, { color, width: 1 });
			}
			if (mode !== 'price') {
				shape.paths.push({ color, width: 1, dash: 'solid', points: [{ x: a.x, y: center.y }, { x: b.x, y: center.y }] });
				arrowHead(shape, { x: a.x, y: center.y }, { x: b.x, y: center.y }, { color, width: 1 });
			}
			const time = `${ stats.bars }봉, ${ duration(stats.seconds) }`;
			const text = mode === 'price' ? stats.price : mode === 'date' ? time : `${ stats.price } · ${ time }`;
			const top = Math.min(a.y, b.y);
			const bottom = Math.max(a.y, b.y);
			layer.text(shape, text, center.x, mode !== 'date' && !rising ? bottom + 8 : top - 24, '#ffffff', { size: 12, align: 'center', background: color });
		},

		/** 닫힌 도형. */
		polygon(c, points) {
			c.shape.paths.push({ ...c.stroke, points: closed(points) });
			if (c.style.fill > 0) {
				c.shape.fills.push({ color: rgba(c.style.color, c.style.fill), points });
				c.shape.areas.push(points);
			}
		},

		rect(layer, c) {
			BUILDERS.polygon(c, rectangle(c.px[0], c.px[1]));
		},

		rotrect(layer, c) {
			const [a, b, p] = c.px;
			const length = distance(a, b);
			if (length === 0) return;
			// 세 번째 점까지의 수직 거리만큼 변을 민다.
			const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
			const depth = (p.x - a.x) * normal.x + (p.y - a.y) * normal.y;
			BUILDERS.polygon(c, [a, b, shifted(b, normal.x * depth, normal.y * depth), shifted(a, normal.x * depth, normal.y * depth)]);
		},

		circle(layer, c) {
			const radius = distance(c.px[0], c.px[1]);
			BUILDERS.polygon(c, ellipsePoints(c.px[0], radius, radius).slice(0, -1));
		},

		ellipse(layer, c) {
			const [a, b] = c.px;
			BUILDERS.polygon(c, ellipsePoints(middle(a, b), Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2).slice(0, -1));
		},

		triangle(layer, c) {
			BUILDERS.polygon(c, c.px);
		},

		polyline(layer, c) {
			if (c.px.length > 2) BUILDERS.polygon(c, c.px);
			else if (c.px.length > 1) c.shape.paths.push({ ...c.stroke, points: c.px });
		},

		path(layer, c) {
			if (c.px.length < 2) return;
			c.shape.paths.push({ ...c.stroke, points: c.px });
			if (c.style.arrow) arrowHead(c.shape, c.px[c.px.length - 2], c.px[c.px.length - 1], c.stroke);
		},

		arc(layer, c) {
			c.shape.paths.push({ ...c.stroke, points: arcPoints(c.px[0], c.px[1], c.px[2]) });
		},

		curve(layer, c) {
			c.shape.paths.push({ ...c.stroke, points: curvePoints(c.px[0], c.px[1], c.px[2]) });
		},

		mark(layer, c) {
			const [a] = c.px;
			const { style, shape } = c;
			const color = rgba(style.color, 1);
			let points;
			if (style.glyph === 'flag') {
				shape.paths.push({ color: style.color, width: 2, dash: 'solid', points: [a, shifted(a, 0, -24)] });
				points = [shifted(a, 0, -24), shifted(a, 16, -19), shifted(a, 0, -13)];
			}
			else {
				// 화살표 끝이 기준점을 가리킨다.
				const flip = style.glyph === 'down' ? -1 : 1;
				points = [[0, 0], [-8, 10], [-3, 10], [-3, 24], [3, 24], [3, 10], [8, 10]].map(([x, y]) => shifted(a, x, y * flip));
			}
			shape.fills.push({ color, points });
			shape.areas.push(points);
		},

		text(layer, c) {
			const [a] = c.px;
			const box = layer.text(c.shape, c.style.text, a.x, a.y, c.style.color, { size: c.style.size });
			c.shape.areas.push(rectangle({ x: a.x - 3, y: a.y - 3 }, { x: a.x + box.width + 3, y: a.y + box.height + 3 }));
		},

		callout(layer, c) {
			const [tip, at] = c.px;
			const { style, shape } = c;
			const box = layer.text(shape, style.text, at.x, at.y, '#ffffff', { size: style.size, background: style.color });
			shape.paths.push({ color: style.color, width: 2, dash: 'solid', points: [tip, shifted(at, Math.min(box.width, 16), box.height / 2)] });
			shape.areas.push(rectangle(shifted(at, -6, -3), shifted(at, box.width + 6, box.height + 3)));
		},

		pricelabel(layer, c) {
			const [a] = c.px;
			const { style, shape } = c;
			const at = shifted(a, 18, -30);
			const box = layer.text(shape, layer.env.formatPrice(c.points[0].p), at.x, at.y, '#ffffff', { size: 12, background: style.color });
			shape.paths.push({ color: style.color, width: 2, dash: 'solid', points: [a, shifted(at, 0, box.height)] });
			shape.areas.push(rectangle(shifted(at, -6, -3), shifted(at, box.width + 6, box.height + 3)));
		},

		fibspiral(layer, c) {
			const [a, b] = c.px;
			const radius = distance(a, b);
			if (radius < 2) return;
			const start = Math.atan2(b.y - a.y, b.x - a.x);
			const points = [];
			// 4분의 1바퀴마다 반지름이 황금비만큼 커진다. 두 번째 점을 지난다.
			for (let step = -360; step <= 720; step++) {
				const turn = step * Math.PI / 90;
				const reach = radius * PHI ** (2 * turn / Math.PI);
				if (reach > 8000) break;
				points.push({ x: a.x + Math.cos(start + turn) * reach, y: a.y + Math.sin(start + turn) * reach });
			}
			c.shape.paths.push({ color: c.style.color, width: 1, dash: 'dashed', points: [a, b] }, { ...c.stroke, points });
		},

		/** 두 방향 사이의 짧은 쪽 각도. */
		sweep(a, from, to) {
			const start = Math.atan2(from.y - a.y, from.x - a.x);
			let turn = Math.atan2(to.y - a.y, to.x - a.x) - start;
			if (turn > Math.PI) turn -= Math.PI * 2;
			if (turn < -Math.PI) turn += Math.PI * 2;
			return [start, start + turn];
		},

		fibwedge(layer, c) {
			const [a, b, p] = c.px;
			const { style, shape } = c;
			const radius = distance(a, b);
			const [from, to] = BUILDERS.sweep(a, b, p);
			const levels = activeLevels(style);
			const reach = radius * Math.max(1, ...levels.map(level => level.value));
			const edge = angle => ({ x: a.x + Math.cos(angle) * reach, y: a.y + Math.sin(angle) * reach });
			shape.paths.push({ ...c.stroke, points: [edge(from), a, edge(to)] });
			for (const level of levels) {
				const arc = ellipsePoints(a, radius * level.value, radius * level.value, from, to, 40);
				shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: arc });
				layer.text(shape, String(level.value), arc[0].x + 4, arc[0].y - 14, level.color);
			}
			shape.handles = [a, b, edge(to)];
		},

		pitchfan(layer, c) {
			const [a, b, p] = c.px;
			const { style, shape } = c;
			shape.paths.push({ color: style.color, width: 1, dash: 'dashed', points: [b, p] });
			for (const level of activeLevels(style)) {
				const target = { x: b.x + (p.x - b.x) * level.value, y: b.y + (p.y - b.y) * level.value };
				shape.paths.push({ color: level.color, width: style.width, dash: style.dash, points: extend(a, target, false, true) });
				layer.text(shape, String(level.value), target.x + 4, target.y - 14, level.color);
			}
		},

		gannsquare(layer, c) {
			const [a, raw] = c.px;
			const { style, shape } = c;
			// 고정형은 화면에서 정사각형이 되도록 높이를 너비에 맞춘다.
			const b = style.fixed ? { x: raw.x, y: a.y + (raw.y >= a.y ? 1 : -1) * Math.abs(raw.x - a.x) } : raw;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const corners = rectangle(a, b);
			if (style.fill > 0) shape.fills.push({ color: rgba(style.color, style.fill), points: corners });
			shape.areas.push(corners);
			const thin = { color: style.color, width: 1, dash: 'dotted' };
			for (let step = 0; step <= 5; step++) {
				const part = step / 5;
				shape.paths.push({ ...(step % 5 === 0 ? c.stroke : thin), points: [{ x: a.x, y: a.y + dy * part }, { x: b.x, y: a.y + dy * part }] });
				shape.paths.push({ ...(step % 5 === 0 ? c.stroke : thin), points: [{ x: a.x + dx * part, y: a.y }, { x: a.x + dx * part, y: b.y }] });
				if (step === 0) continue;
				const color = FIB_COLORS[step % FIB_COLORS.length];
				// 첫 점에서 뻗는 부챗살과 4분의 1 원호.
				shape.paths.push({ color, width: style.width, dash: style.dash, points: [a, { x: b.x, y: a.y + dy * part }] });
				if (step < 5) shape.paths.push({ color, width: style.width, dash: style.dash, points: [a, { x: a.x + dx * part, y: b.y }] });
				shape.paths.push({ color, width: 1, dash: style.dash, points: ellipsePoints(a, dx * part, dy * part, 0, Math.PI / 2, 24) });
			}
			shape.handles = [a, b];
		},

		forecast(layer, c) {
			const [a, b] = c.px;
			const { shape } = c;
			const stats = layer.stats(c.points[0], c.points[1]);
			const color = stats.change >= 0 ? PROFIT : LOSS;
			const stroke = { color, width: c.style.width, dash: 'dashed' };
			const bend = { x: (a.x + b.x) / 2, y: a.y + (b.y - a.y) * 0.15 };
			const curve = curvePoints(a, b, middle(bend, middle(a, b)));
			shape.paths.push({ ...stroke, points: curve });
			arrowHead(shape, curve[curve.length - 4], b, stroke);
			layer.text(shape, layer.env.formatPrice(c.points[0].p), a.x, a.y + 10, '#ffffff', { size: 12, align: 'center', background: '#555b6b' });
			layer.text(shape, `${ layer.env.formatPrice(c.points[1].p) }\n${ stats.price }\n${ stats.bars }봉 (${ duration(stats.seconds) })`,
				b.x + 12, b.y - 24, '#ffffff', { size: 12, background: color });
		},

		/** 봉 여러 개를 그린다. rows = [{ logical, open, high, low, close }] */
		candles(layer, c, rows, colorOf) {
			const axis = layer.axis();
			const series = layer.env.series();
			if (!axis) return;
			const half = Math.max(1, Math.abs(axis.spacing) * 0.3);
			let left = Infinity;
			let right = -Infinity;
			let top = Infinity;
			let bottom = -Infinity;
			for (const row of rows) {
				const x = axis.origin + row.logical * axis.spacing;
				const [open, high, low, close] = [row.open, row.high, row.low, row.close].map(price => series.priceToCoordinate(price));
				if (open === null || high === null || low === null || close === null) continue;
				const color = colorOf(row);
				c.shape.paths.push({ color, width: 1, dash: 'solid', alpha: 0.85, points: [{ x, y: high }, { x, y: low }] });
				c.shape.fills.push({ color: rgba(color, 0.6), points: rectangle({ x: x - half, y: open }, { x: x + half, y: close === open ? close + 1 : close }) });
				left = Math.min(left, x - half);
				right = Math.max(right, x + half);
				top = Math.min(top, high);
				bottom = Math.max(bottom, low);
			}
			if (left < right) c.shape.areas.push(rectangle({ x: left, y: top }, { x: right, y: bottom }));
		},

		barspattern(layer, c) {
			const { style, shape, px } = c;
			if (!style.pattern) {
				// 아직 구간을 고르는 중이다.
				if (px.length > 1) shape.paths.push({ color: style.color, width: 1, dash: 'dashed', points: closed(rectangle(px[0], px[1])) });
				return;
			}
			const start = Math.round(layer.logicalOfTime(c.points[0].t));
			const base = c.points[0].p;
			BUILDERS.candles(layer, c, style.pattern.map(([open, high, low, close], i) =>
				({ logical: start + i, open: base + open, high: base + high, low: base + low, close: base + close })), () => style.color);
		},

		ghost(layer, c) {
			const { shape, px, points } = c;
			if (px.length > 1) shape.paths.push({ color: '#787b86', width: 1, dash: 'dotted', points: px });
			const rows = [];
			let previous = points[0].p;
			for (let i = 1; i < points.length; i++) {
				const from = Math.round(layer.logicalOfTime(points[i - 1].t));
				const to = Math.round(layer.logicalOfTime(points[i].t));
				for (let logical = from + 1; logical <= to; logical++) {
					const close = points[i - 1].p + (points[i].p - points[i - 1].p) * (logical - from) / (to - from);
					// 꼬리 길이는 봉 번호로 정해 다시 그려도 모양이 같다.
					const wick = Math.abs(close - previous) * (0.25 + 0.5 * Math.abs(Math.sin(logical * 12.9898)));
					rows.push({ logical, open: previous, close, high: Math.max(previous, close) + wick, low: Math.min(previous, close) - wick });
					previous = close;
				}
			}
			BUILDERS.candles(layer, c, rows, row => (row.close >= row.open ? PROFIT : LOSS));
		},

		sector(layer, c) {
			const [a, b, p] = c.px;
			const radius = distance(a, b);
			const [from, to] = BUILDERS.sweep(a, b, p);
			BUILDERS.polygon(c, [a, ...ellipsePoints(a, radius, radius, from, to, 48)]);
			c.shape.handles = [a, b, { x: a.x + Math.cos(to) * radius, y: a.y + Math.sin(to) * radius }];
		},

		profile(layer, c) {
			const bars = layer.env.bars();
			const { style, shape, size } = c;
			const ends = c.points.map(point => Math.round(layer.logicalOfTime(point.t)));
			const from = Math.max(0, Math.min(...ends));
			// 점이 하나면 그 봉부터 마지막 봉까지 잰다.
			const to = Math.min(bars.length - 1, ends.length > 1 ? Math.max(...ends) : bars.length - 1);
			if (to < from) return;
			let low = Infinity;
			let high = -Infinity;
			for (let i = from; i <= to; i++) {
				low = Math.min(low, bars[i].low);
				high = Math.max(high, bars[i].high);
			}
			const rows = 24;
			const step = (high - low) / rows;
			const volumes = new Array(rows).fill(0);
			for (let i = from; i <= to && step > 0; i++) {
				const first = Math.min(rows - 1, Math.floor((bars[i].low - low) / step));
				const last = Math.min(rows - 1, Math.floor((bars[i].high - low) / step));
				for (let row = first; row <= last; row++) volumes[row] += bars[i].volume / (last - first + 1);
			}
			const peak = Math.max(...volumes);
			const start = layer.pixelAt(from, low);
			const end = layer.pixelAt(to, high);
			if (!start || !end) return;
			if (!(peak > 0)) {
				layer.text(shape, '볼륨 프로필: 거래량 데이터 없음', start.x + 8, c.px[0].y - 7, style.color);
				return;
			}
			const width = ends.length > 1 ? Math.max(40, end.x - start.x) : Math.min(size.width * 0.3, Math.max(60, end.x - start.x));
			const series = layer.env.series();
			volumes.forEach((volume, row) => {
				const top = series.priceToCoordinate(low + step * (row + 1));
				const bottom = series.priceToCoordinate(low + step * row);
				if (top === null || bottom === null) return;
				const most = volume === peak;
				const bar = rectangle({ x: start.x, y: top + 0.5 }, { x: start.x + width * volume / peak, y: bottom - 0.5 });
				shape.fills.push({ color: rgba(most ? '#f59e0b' : style.color, most ? 0.65 : 0.35), points: bar });
				shape.areas.push(bar);
				// 거래가 가장 많았던 가격대(POC)를 선으로 잇는다.
				if (most) shape.paths.push({ color: '#f59e0b', width: 1, dash: 'dashed', points: [{ x: start.x, y: (top + bottom) / 2 }, { x: Math.max(end.x, start.x + width), y: (top + bottom) / 2 }] });
			});
			shape.paths.push({ color: style.color, width: 1, dash: 'dotted', points: closed(rectangle(start, { x: Math.max(end.x, start.x + width), y: end.y })) });
		},

		arrowmarker(layer, c) {
			const [a, b] = c.px;
			const length = distance(a, b);
			if (length < 2) return;
			const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
			const across = { x: -along.y, y: along.x };
			const head = Math.min(22, length * 0.6);
			const neck = shifted(b, -along.x * head, -along.y * head);
			const side = (point, amount) => shifted(point, across.x * amount, across.y * amount);
			const points = [side(a, 2), side(neck, 4), side(neck, 11), b, side(neck, -11), side(neck, -4), side(a, -2)];
			c.shape.fills.push({ color: rgba(c.style.color, 0.9), points });
			c.shape.areas.push(points);
		},

		doublecurve(layer, c) {
			const [a, b, p, d] = c.px;
			const points = [];
			// 가운데 두 점이 곡선을 당기는 3차 곡선.
			for (let i = 0; i <= 48; i++) {
				const t = i / 48;
				const u = 1 - t;
				const mix = key => u * u * u * a[key] + 3 * u * u * t * b[key] + 3 * u * t * t * p[key] + t * t * t * d[key];
				points.push({ x: mix('x'), y: mix('y') });
			}
			c.shape.paths.push({ ...c.stroke, points }, { color: c.style.color, width: 1, dash: 'dotted', alpha: 0.5, points: [a, b] }, { color: c.style.color, width: 1, dash: 'dotted', alpha: 0.5, points: [p, d] });
		},

		/** 바탕이 있는 글 상자를 놓고 맞히기 영역을 더한다. */
		box(layer, c, x, y, text = c.style.text) {
			const box = layer.text(c.shape, text, x, y, '#ffffff', { size: c.style.size, background: c.style.color });
			c.shape.areas.push(rectangle({ x: x - 6, y: y - 3 }, { x: x + box.width + 6, y: y + box.height + 3 }));
			return box;
		},

		note(layer, c) {
			const [a] = c.px;
			const mark = rectangle(shifted(a, -6, -7), shifted(a, 6, 7));
			c.shape.fills.push({ color: rgba(c.style.color, 1), points: mark });
			c.shape.paths.push({ color: '#ffffff', width: 1, dash: 'solid', points: [shifted(a, -3, -3), shifted(a, 3, -3)] }, { color: '#ffffff', width: 1, dash: 'solid', points: [shifted(a, -3, 1), shifted(a, 3, 1)] });
			c.shape.areas.push(mark);
			BUILDERS.box(layer, c, a.x + 16, a.y - 9);
		},

		pricenote(layer, c) {
			const [a, b] = c.px;
			const { style, shape } = c;
			shape.paths.push({ color: style.color, width: 1, dash: 'solid', points: [a, b] }, { color: style.color, width: 2, dash: 'solid', points: ellipsePoints(a, 3, 3, 0, Math.PI * 2, 12) });
			const price = layer.env.formatPrice(c.points[0].p);
			BUILDERS.box(layer, c, b.x + 6, b.y - 9, style.text ? `${ price }\n${ style.text }` : price);
		},

		pin(layer, c) {
			const [a] = c.px;
			const center = shifted(a, 0, -19);
			const points = [...ellipsePoints(center, 8, 8, Math.PI * 0.75, Math.PI * 2.25, 24), a];
			c.shape.fills.push({ color: rgba(c.style.color, 1), points });
			c.shape.fills.push({ color: '#ffffff', points: ellipsePoints(center, 3, 3, 0, Math.PI * 2, 12) });
			c.shape.areas.push(points);
			if (c.style.text) BUILDERS.box(layer, c, a.x + 14, a.y - 28);
		},

		comment(layer, c) {
			const [a] = c.px;
			const height = String(c.style.text).split('\n').length * c.style.size * 1.3;
			const top = a.y - height - 18;
			BUILDERS.box(layer, c, a.x + 6, top);
			c.shape.fills.push({ color: rgba(c.style.color, 1), points: [a, { x: a.x + 4, y: top + height }, { x: a.x + 18, y: top + height }] });
		},

		signpost(layer, c) {
			const [a] = c.px;
			const height = String(c.style.text).split('\n').length * c.style.size * 1.3;
			const top = a.y - 64 - height;
			c.shape.paths.push({ color: c.style.color, width: 1, dash: 'dashed', points: [a, { x: a.x, y: top + height + 2 }] });
			measurer.font = `${ c.style.size }px ${ layer.env.fontFamily() }`;
			const width = Math.max(...String(c.style.text).split('\n').map(line => measurer.measureText(line).width));
			BUILDERS.box(layer, c, a.x - width / 2, top);
		},

		table(layer, c) {
			const [a] = c.px;
			const { style, shape } = c;
			const rows = String(style.text).split('\n').map(line => line.split('|').map(cell => cell.trim()));
			const columns = Math.max(...rows.map(row => row.length));
			const font = `${ style.size }px ${ layer.env.fontFamily() }`;
			measurer.font = font;
			const widths = Array.from({ length: columns }, (unused, column) =>
				Math.max(24, ...rows.map(row => measurer.measureText(row[column] ?? '').width)) + 16);
			const rowHeight = style.size * 1.3 + 10;
			const total = widths.reduce((sum, width) => sum + width, 0);
			const frame = rectangle(a, shifted(a, total, rowHeight * rows.length));
			shape.fills.push({ color: rgba(style.color, 0.12), points: frame }, { color: rgba(style.color, 0.25), points: rectangle(a, shifted(a, total, rowHeight)) });
			shape.areas.push(frame);
			const line = { color: style.color, width: 1, dash: 'solid' };
			for (let row = 0; row <= rows.length; row++) shape.paths.push({ ...line, points: [shifted(a, 0, rowHeight * row), shifted(a, total, rowHeight * row)] });
			let x = a.x;
			for (let column = 0; column <= columns; column++) {
				shape.paths.push({ ...line, points: [{ x, y: a.y }, { x, y: a.y + rowHeight * rows.length }] });
				if (column === columns) break;
				rows.forEach((row, i) => shape.labels.push({ x: x + 8, y: a.y + rowHeight * i + 5, lines: [row[column] ?? ''], font, size: style.size, color: layer.env.textColor() }));
				x += widths[column];
			}
		},

		image(layer, c) {
			const [a] = c.px;
			const { style, shape } = c;
			const width = Number.isFinite(style.imageWidth) ? style.imageWidth : 180;
			const frame = rectangle(a, shifted(a, width, width * style.ratio));
			shape.areas.push(frame);
			if (style.image) {
				shape.images.push({ src: style.image, x: a.x, y: a.y, width, height: width * style.ratio });
				return;
			}
			shape.fills.push({ color: rgba(style.color, 0.1), points: frame });
			shape.paths.push({ color: style.color, width: 1, dash: 'dashed', points: closed(frame) });
			layer.text(shape, '이미지를 고르세요\n(두 번 눌러 설정)', a.x + 10, a.y + 10, style.color, { size: 12 });
		},
	};

	class Layer {
		constructor(env) {
			this.env = env;
			this.draft = null;
			this.cursorAnchor = null;
			this.selectedId = null;
			this.drag = null;
			this.requestUpdate = null;
			this.size = { width: 0, height: 0 };
			this.view = {
				zOrder: () => 'top',
				renderer: () => ({
					draw: target => target.useMediaCoordinateSpace(scope => this.draw(scope.context, scope.mediaSize)),
				}),
			};
			this.onDown = event => this.handleDown(event);
			this.onMove = event => this.handleMove(event);
			this.onDoubleClick = event => this.handleDoubleClick(event);
			env.body.addEventListener('mousedown', this.onDown, true);
			env.body.addEventListener('mousemove', this.onMove);
			env.body.addEventListener('dblclick', this.onDoubleClick, true);
		}

		// ----- 차트 라이브러리가 부르는 메서드 -----

		attached(param) {
			this.requestUpdate = param.requestUpdate;
		}

		detached() {
			this.requestUpdate = null;
		}

		updateAllViews() {}

		paneViews() {
			return [this.view];
		}

		priceAxisViews() {
			const views = [];
			// 봉 마감까지 남은 시간. 현재가 라벨 바로 아래에 붙인다.
			const countdown = this.env.countdown?.();
			const base = countdown ? this.env.series().priceToCoordinate(countdown.price) : null;
			if (base !== null) {
				views.push({
					coordinate: () => base + 20,
					fixedCoordinate: () => base + 20,
					text: () => countdown.text,
					textColor: () => '#ffffff',
					backColor: () => countdown.color,
					visible: () => true,
				});
			}
			if (this.env.hidden()) return views;
			return views.concat(this.env.list()
				.filter(drawing => ['hline', 'hray', 'cross'].includes(drawing.type))
				.map((drawing) => {
					const price = drawing.points[0].p;
					const y = this.env.series().priceToCoordinate(price);
					return {
						coordinate: () => y ?? -100,
						text: () => this.env.formatPrice(price),
						textColor: () => '#ffffff',
						backColor: () => drawing.style.color,
						visible: () => y !== null,
					};
				}));
		}

		redraw() {
			this.requestUpdate?.();
		}

		// ----- 좌표 변환 -----

		/** 봉 사이의 대표 간격(초). */
		step() {
			const bars = this.env.bars();
			return bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 0;
		}

		/** 저장된 시각을 봉 번호(소수 포함)로 바꾼다. 데이터 범위 밖은 간격으로 늘려 잡는다. */
		logicalOfTime(time) {
			const bars = this.env.bars();
			const step = this.step();
			if (bars.length === 0 || step <= 0) return null;
			const chartTime = time + this.env.tzOffset;
			const last = bars.length - 1;
			if (chartTime <= bars[0].time) return (chartTime - bars[0].time) / step;
			if (chartTime >= bars[last].time) return last + (chartTime - bars[last].time) / step;
			let low = 0;
			let high = last;
			while (high - low > 1) {
				const mid = (low + high) >> 1;
				if (bars[mid].time <= chartTime) low = mid;
				else high = mid;
			}
			return low + (chartTime - bars[low].time) / (bars[high].time - bars[low].time);
		}

		timeOfLogical(logical) {
			const bars = this.env.bars();
			const step = this.step();
			const last = bars.length - 1;
			let chartTime;
			if (logical <= 0) chartTime = bars[0].time + logical * step;
			else if (logical >= last) chartTime = bars[last].time + (logical - last) * step;
			else {
				const index = Math.floor(logical);
				chartTime = bars[index].time + (logical - index) * (bars[index + 1].time - bars[index].time);
			}
			return chartTime - this.env.tzOffset;
		}

		/** 봉 번호 0의 x좌표와 봉 하나의 폭. */
		axis() {
			const timeScale = this.env.chart.timeScale();
			const origin = timeScale.logicalToCoordinate(0);
			const next = timeScale.logicalToCoordinate(1);
			return origin === null || next === null ? null : { origin, spacing: next - origin };
		}

		toPixel(point) {
			const logical = this.logicalOfTime(point.t);
			const axis = this.axis();
			const y = this.env.series().priceToCoordinate(point.p);
			if (logical === null || axis === null || y === null) return null;
			return { x: axis.origin + logical * axis.spacing, y };
		}

		logicalOfX(x) {
			const axis = this.axis();
			return axis === null || axis.spacing === 0 ? null : (x - axis.origin) / axis.spacing;
		}

		/** 화면 좌표를 기준점으로 바꾼다. free가 아니면 봉에 맞추고, 자석이 켜져 있으면 시고저종에 붙인다. */
		anchorAt(position, free) {
			if (this.env.bars().length < 2) return null;
			let logical = this.logicalOfX(position.x);
			let price = this.env.series().coordinateToPrice(position.y);
			if (logical === null || price === null) return null;
			if (!free) {
				logical = Math.round(logical);
				const bar = this.env.bars()[logical];
				if (bar && this.env.magnet()) {
					let best = MAGNET_DISTANCE;
					for (const candidate of [bar.open, bar.high, bar.low, bar.close]) {
						const y = this.env.series().priceToCoordinate(candidate);
						if (y !== null && Math.abs(y - position.y) <= best) {
							best = Math.abs(y - position.y);
							price = candidate;
						}
					}
				}
			}
			return { t: this.timeOfLogical(logical), p: price };
		}

		/** 마우스 위치를 가격 차트 영역 기준 좌표로 바꾼다. clamp가 참이면 영역 밖은 null. */
		localPosition(event, clamp = true) {
			// 범례 버튼이나 편집 막대처럼 차트 위에 떠 있는 요소의 클릭은 작도와 무관하다.
			if (clamp && !this.env.surface.contains(event.target)) return null;
			const node = this.env.chart.panes()[0]?.getHTMLElement();
			if (!node) return null;
			const rect = node.getBoundingClientRect();
			const position = { x: event.clientX - rect.left, y: event.clientY - rect.top };
			if (clamp && (position.x < 0 || position.y < 0 || position.y > rect.height || position.x > this.env.chart.timeScale().width())) return null;
			return position;
		}

		// ----- 모양 만들기 -----

		/** 작도 하나를 선, 면, 글자로 풀어낸다. 그리기와 맞히기 판정이 같은 결과를 쓴다. */
		build(drawing, size) {
			const shape = { paths: [], fills: [], labels: [], areas: [], handles: [], images: [] };
			const tool = byId.get(drawing.tool);
			const px = drawing.points.map(point => this.toPixel(point));
			if (!tool || px.length === 0 || px.some(pixel => pixel === null)) return shape;
			const style = drawing.style;
			shape.handles = px;
			const stroke = { color: style.color, width: style.width, dash: style.dash };
			// 기준점을 다 찍기 전에는 지금까지 찍은 점만 이어서 보여 준다.
			if (Number.isInteger(tool.points) && px.length < tool.points && drawing.type !== 'pattern' && !tool.progressive) {
				if (px.length > 1) shape.paths.push({ ...stroke, points: px });
				return shape;
			}
			BUILDERS[drawing.type](this, { drawing, tool, style, stroke, px, points: drawing.points, shape, size });
			return shape;
		}

		/** 글자를 얹고 차지하는 크기를 돌려준다. background가 있으면 둥근 바탕을 깐다. */
		text(shape, text, x, y, color, { size = 11, align = 'left', background } = {}) {
			const font = `${ size }px ${ this.env.fontFamily() }`;
			measurer.font = font;
			const lines = String(text).split('\n');
			const width = Math.max(...lines.map(line => measurer.measureText(line).width));
			const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
			shape.labels.push({ x: left, y, lines, font, size, color, background, width: width + 12 });
			return { width, height: lines.length * size * 1.3 };
		}

		/** 두 기준점 사이의 가격 변화와 봉 수. */
		stats(start, end) {
			const change = end.p - start.p;
			const percent = start.p === 0 ? 0 : change / start.p * 100;
			const sign = change >= 0 ? '+' : '';
			return {
				change,
				bars: Math.round(this.logicalOfTime(end.t) - this.logicalOfTime(start.t)),
				seconds: end.t - start.t,
				price: `${ sign }${ this.env.formatPrice(change) } (${ sign }${ percent.toFixed(2) }%)`,
			};
		}

		/** 봉 번호와 가격의 화면 좌표. */
		pixelAt(logical, price) {
			const axis = this.axis();
			const y = this.env.series().priceToCoordinate(price);
			return axis === null || y === null ? null : { x: axis.origin + logical * axis.spacing, y };
		}

		/** 매수·매도 포지션은 한 번 눌러 진입가, 목표가, 손절가를 한꺼번에 놓는다. */
		seed(tool, position) {
			const direction = tool.style.side === 'short' ? 1 : -1;
			const series = this.env.series();
			const entry = this.anchorAt(position, false);
			const far = this.anchorAt({ x: position.x + 170, y: position.y }, false);
			const target = series.coordinateToPrice(position.y + direction * this.size.height * 0.18);
			const stop = series.coordinateToPrice(position.y - direction * this.size.height * 0.09);
			if (!entry || !far || target === null || stop === null) return null;
			return [entry, { t: far.t, p: target }, { t: far.t, p: stop }];
		}

		// ----- 그리기 -----

		/** 저장된 이미지를 그릴 수 있는 객체로 바꾼다. 다 읽히면 다시 그린다. */
		picture(source) {
			this.pictures ??= new Map();
			if (!this.pictures.has(source)) {
				const image = new Image();
				image.addEventListener('load', () => this.redraw());
				image.src = source;
				this.pictures.set(source, image);
			}
			return this.pictures.get(source);
		}

		paint(context, shape) {
			for (const item of shape.images) {
				const image = this.picture(item.src);
				if (image.complete && image.naturalWidth > 0) context.drawImage(image, item.x, item.y, item.width, item.height);
			}
			for (const fill of shape.fills) {
				context.beginPath();
				fill.points.forEach((point, i) => (i === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
				context.closePath();
				context.fillStyle = fill.color;
				context.fill();
			}
			for (const path of shape.paths) {
				context.beginPath();
				path.points.forEach((point, i) => (i === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
				context.strokeStyle = path.color;
				context.lineWidth = path.width;
				context.lineJoin = 'round';
				context.setLineDash(DASHES[path.dash] ?? []);
				context.globalAlpha = path.alpha ?? 1;
				context.stroke();
			}
			context.globalAlpha = 1;
			context.setLineDash([]);
			for (const label of shape.labels) {
				context.font = label.font;
				context.textBaseline = 'top';
				if (label.background) {
					context.fillStyle = label.background;
					context.beginPath();
					context.roundRect(label.x - 6, label.y - 3, label.width, label.lines.length * label.size * 1.3 + 5, 4);
					context.fill();
				}
				context.fillStyle = label.color;
				label.lines.forEach((line, i) => context.fillText(line, label.x, label.y + i * label.size * 1.3));
			}
		}

		draw(context, size) {
			this.size = size;
			const axis = this.axis();
			for (const overlay of this.env.overlays?.() ?? []) {
				overlay.draw(context, {
					width: this.env.chart.timeScale().width(),
					height: size.height,
					priceY: price => this.env.series().priceToCoordinate(price),
					barX: logical => (axis === null ? null : axis.origin + logical * axis.spacing),
					formatPrice: this.env.formatPrice,
					font: this.env.fontFamily(),
					...this.env.palette(),
				});
			}
			if (this.env.hidden()) return;
			context.save();
			for (const drawing of this.env.list()) {
				const shape = this.build(drawing, size);
				this.paint(context, shape);
				if (drawing.id === this.selectedId) this.paintHandles(context, shape);
			}
			if (this.transient) this.paint(context, this.build(this.transient, size));
			if (this.draft) {
				const preview = this.cursorAnchor && byId.get(this.draft.tool).points !== 'free'
					? { ...this.draft, points: [...this.draft.points, this.cursorAnchor] }
					: this.draft;
				const shape = this.build(preview, size);
				this.paint(context, shape);
				this.paintHandles(context, shape);
			}
			context.restore();
		}

		paintHandles(context, shape) {
			for (const handle of shape.handles) {
				context.beginPath();
				context.arc(handle.x, handle.y, HANDLE_RADIUS, 0, Math.PI * 2);
				context.fillStyle = '#ffffff';
				context.fill();
				context.strokeStyle = '#2962ff';
				context.lineWidth = 2;
				context.stroke();
			}
		}

		// ----- 맞히기 판정 -----

		hits(shape, position) {
			for (const path of shape.paths) {
				for (let i = 1; i < path.points.length; i++) {
					if (distanceToSegment(position, path.points[i - 1], path.points[i]) <= HIT_DISTANCE + path.width / 2) return true;
				}
			}
			return shape.areas.some(area => insidePolygon(position, area));
		}

		hitAt(position) {
			const list = this.env.list();
			const selected = list.find(drawing => drawing.id === this.selectedId);
			if (selected) {
				const handles = this.build(selected, this.size).handles;
				const handle = handles.findIndex(point => Math.hypot(point.x - position.x, point.y - position.y) <= HANDLE_RADIUS + 3);
				if (handle >= 0) return { drawing: selected, handle };
			}
			for (let i = list.length - 1; i >= 0; i--) {
				if (this.hits(this.build(list[i], this.size), position)) return { drawing: list[i], handle: -1 };
			}
			return null;
		}

		// ----- 마우스 -----

		handleDown(event) {
			if (event.button !== 0 || this.env.hidden()) return;
			const position = this.localPosition(event);
			if (!position) return;
			// 재기 결과는 다음에 차트를 누르면 사라진다.
			if (this.transient) {
				this.transient = null;
				this.redraw();
			}
			if (!this.env.tool() && event.shiftKey) this.env.startTool('ruler');
			const tool = this.env.tool();
			if (tool) {
				event.stopPropagation();
				event.preventDefault();
				this.env.activate();
				this.place(tool, position, event.detail);
				return;
			}
			const hit = this.hitAt(position);
			if (!hit) {
				if (this.selectedId) this.select(null);
				return;
			}
			event.stopPropagation();
			event.preventDefault();
			this.env.activate();
			this.select(hit.drawing.id);
			this.startDrag(hit, position);
		}

		place(tool, position, clicks = 1) {
			const free = tool.points === 'free';
			// 여러 점을 찍는 도구는 두 번 누르면 끝난다. 첫 번째 누름에서 이미 점이 찍혔다.
			if (tool.points === 'many' && clicks > 1 && this.draft) {
				this.finish();
				return;
			}
			const anchor = this.anchorAt(position, free || tool.loose === true);
			if (!anchor) return;
			if (!this.draft) {
				this.draft = {
					id: Math.random().toString(36).slice(2, 10),
					type: tool.type,
					tool: tool.id,
					points: [],
					style: this.env.defaults(tool.id),
				};
			}
			this.draft.points.push(anchor);
			if (tool.seed) {
				const points = this.seed(tool, position);
				if (!points) return this.cancel();
				this.draft.points = points;
			}
			if (free) {
				this.track((moveEvent) => {
					const next = this.localPosition(moveEvent, false);
					const last = this.toPixel(this.draft.points[this.draft.points.length - 1]);
					if (!next || !last || Math.hypot(next.x - last.x, next.y - last.y) < 3) return;
					const point = this.anchorAt(next, true);
					if (point) this.draft.points.push(point);
					this.redraw();
				}, () => (this.draft.points.length > 1 ? this.commit() : this.cancel()));
			}
			else if (tool.points !== 'many' && this.draft.points.length >= tool.points) {
				this.commit();
			}
			this.redraw();
		}

		/** 여러 점을 찍는 도구를 지금까지 찍은 점으로 끝낸다. */
		finish() {
			if (!this.draft || byId.get(this.draft.tool).points !== 'many') return false;
			if (this.draft.points.length > 1) this.commit();
			else this.cancel();
			return true;
		}

		commit() {
			this.committedAt = performance.now();
			const drawing = this.draft;
			const tool = byId.get(drawing.tool);
			this.draft = null;
			this.cursorAnchor = null;
			if (tool.transient) {
				this.env.toolDone();
				if (tool.transient === 'zoom') this.zoom(drawing.points);
				else this.transient = drawing;
				this.redraw();
				return;
			}
			if (tool.id === 'barspattern' && !this.capturePattern(drawing)) {
				this.env.toolDone();
				return;
			}
			this.env.list().push(drawing);
			this.env.changed(true);
			this.env.toolDone();
			this.select(drawing.id);
			if (tool.edit) this.env.openSettings(drawing);
		}

		/** 확대 도구로 고른 두 점을 봉 번호와 가격 범위로 바꿔 넘긴다. */
		zoom([first, second]) {
			const ends = [first, second].map(point => this.logicalOfTime(point.t));
			const from = Math.min(...ends);
			const to = Math.max(...ends);
			const low = Math.min(first.p, second.p);
			const high = Math.max(first.p, second.p);
			if (to - from >= 1 && high > low) this.env.zoom({ from, to, low, high });
		}

		/** 고른 구간의 봉 모양을 작도에 담는다. 담고 나면 끌어서 다른 자리에 대 볼 수 있다. */
		capturePattern(drawing) {
			const bars = this.env.bars();
			const ends = drawing.points.map(point => Math.round(this.logicalOfTime(point.t)));
			const from = Math.max(0, Math.min(...ends));
			const to = Math.min(bars.length - 1, Math.max(...ends), from + 499);
			if (to < from) return false;
			const base = bars[from].open;
			drawing.style.pattern = bars.slice(from, to + 1).map(bar => [bar.open - base, bar.high - base, bar.low - base, bar.close - base]);
			drawing.points = [{ t: this.timeOfLogical(from), p: base }];
			return true;
		}

		cancel() {
			this.draft = null;
			this.cursorAnchor = null;
			this.transient = null;
			this.redraw();
		}

		startDrag(hit, position) {
			const { drawing, handle } = hit;
			const startLogical = this.logicalOfX(position.x);
			const startPrice = this.env.series().coordinateToPrice(position.y);
			const origin = drawing.points.map(point => ({ logical: this.logicalOfTime(point.t), p: point.p }));
			if (startLogical === null || startPrice === null || origin.some(point => point.logical === null)) return;
			const tool = byId.get(drawing.tool);
			const free = tool.points === 'free' || tool.loose === true;
			let moved = false;
			this.track((moveEvent) => {
				const next = this.localPosition(moveEvent, false);
				if (!next) return;
				if (handle >= 0) {
					const anchor = this.anchorAt(next, free);
					if (!anchor) return;
					drawing.points[handle] = anchor;
				}
				else {
					const logical = this.logicalOfX(next.x);
					const price = this.env.series().coordinateToPrice(next.y);
					if (logical === null || price === null) return;
					const shift = free ? logical - startLogical : Math.round(logical - startLogical);
					drawing.points = origin.map(point => ({ t: this.timeOfLogical(point.logical + shift), p: point.p + price - startPrice }));
				}
				moved = true;
				this.env.changed(false);
			}, () => {
				if (moved) this.env.changed(true);
			});
		}

		/** 버튼을 뗄 때까지 창 전체에서 마우스를 따라간다. */
		track(onMove, onEnd) {
			this.drag = true;
			const end = () => {
				window.removeEventListener('mousemove', onMove, true);
				window.removeEventListener('mouseup', end, true);
				this.drag = null;
				onEnd();
			};
			window.addEventListener('mousemove', onMove, true);
			window.addEventListener('mouseup', end, true);
		}

		handleMove(event) {
			if (this.drag) return;
			const position = this.localPosition(event);
			if (this.draft) {
				this.cursorAnchor = position ? this.anchorAt(position, false) : null;
				this.redraw();
				return;
			}
			const hit = position && !this.env.tool() && !this.env.hidden() ? this.hitAt(position) : null;
			this.env.body.classList.toggle('over-drawing', hit !== null);
		}

		handleDoubleClick(event) {
			// 두 번 눌러 작도를 끝낸 직후에는 설정 창을 열지 않는다.
			if (this.env.tool() || this.env.hidden() || performance.now() - (this.committedAt ?? 0) < 500) return;
			const position = this.localPosition(event);
			const hit = position ? this.hitAt(position) : null;
			if (!hit) return;
			event.stopPropagation();
			event.preventDefault();
			this.select(hit.drawing.id);
			this.env.openSettings(hit.drawing);
		}

		select(id) {
			this.selectedId = id;
			this.env.selected(id === null ? null : this.env.list().find(drawing => drawing.id === id) ?? null);
			this.redraw();
		}

		selected() {
			return this.env.list().find(drawing => drawing.id === this.selectedId) ?? null;
		}

		destroy() {
			this.env.body.removeEventListener('mousedown', this.onDown, true);
			this.env.body.removeEventListener('mousemove', this.onMove);
			this.env.body.removeEventListener('dblclick', this.onDoubleClick, true);
		}
	}

	return { TOOLS, GROUPS, byId, fieldsOf, levelsFor, Layer, defaultStyle };
})();
