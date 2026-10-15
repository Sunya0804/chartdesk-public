// 바 리플레이용 모의 매매 계좌. 거래소의 단방향(one-way) 모드처럼 포지션은 한 방향 하나만 둔다.
// - 시장가: 지금 보이는 마지막 봉의 종가에 바로 체결된다.
// - 지정가: 걸어 두면 다음 봉부터 그 가격에 닿을 때 그 가격으로 체결된다(시가가 이미 넘어 있으면 더 유리한 시가로).
//   지금가보다 불리한 쪽으로 건 지정가(지금가보다 비싼 매수, 싼 매도)는 거래소처럼 바로 지금가에 체결된다.
// - 같은 방향 주문은 평단을 합치고, 반대 방향 주문은 그 수량만큼 포지션을 줄인다. 선물은 남는 수량으로 반대 포지션을 연다.
// - 선물은 격리 증거금으로 계산한다: 증거금 × 배율만큼 사고, 청산가에 닿으면 증거금을 모두 잃는다.
// 주문 크기(sizing): { mode: 'percent', value: 25 }(쓸 수 있는 현금의 %, 반대 방향이면 포지션의 %),
//                    { mode: 'amount', value: 1000 }(넣을 증거금), { mode: 'qty', value: 0.5 }(개수)
window.ChartDeskPaper = (() => {
	'use strict';

	// 유지 증거금률. 거래소마다 다르지만 대략 0.5%로 본다.
	const MAINTENANCE = 0.005;
	const TINY = 1e-12;
	let nextId = 1;

	class Account {
		/** options: { seed, fee(%), leverage, futures, stop(%), target(%) } */
		constructor(options) {
			this.seed = options.seed;
			this.fee = options.fee / 100;
			this.leverage = options.futures ? Math.max(1, options.leverage) : 1;
			this.futures = options.futures;
			this.stop = options.stop;
			this.target = options.target;
			this.cash = options.seed;
			this.position = null;
			this.orders = [];
			this.trades = [];
			this.fills = [];
		}

		/** 포지션의 평가 손익. */
		unrealized(price) {
			const p = this.position;
			return p ? p.side * p.qty * (price - p.entry) : 0;
		}

		/** 현금 + 포지션 증거금 + 평가 손익. 대기 주문에 잡아 둔 돈도 현금에 들어 있다. */
		equity(price) {
			return this.cash + (this.position ? this.position.margin + this.unrealized(price) : 0);
		}

		/** 대기 주문이 잡아 둔 돈을 뺀, 새로 주문할 수 있는 현금. */
		available() {
			return Math.max(0, this.cash - this.orders.reduce((sum, order) => sum + order.reserve, 0));
		}

		/** 강제 청산 가격(선물만). */
		liquidation() {
			const p = this.position;
			if (!p || !this.futures) return null;
			// 증거금이 유지 증거금만큼 남을 때까지 버틴다.
			const move = (p.margin - MAINTENANCE * p.qty * p.entry) / p.qty;
			return p.side > 0 ? p.entry - move : p.entry + move;
		}

		/**
		 * 주문 크기를 수량으로 바꾼다. reduce: 포지션을 줄이기만 하는 주문인지(반대 방향 비율 주문).
		 * reserve: 새로 여는 몫에 필요한 증거금과 수수료(대기 주문이 잡아 둘 돈).
		 */
		size(side, sizing, price) {
			const p = this.position;
			const opposite = p && p.side !== side;
			const value = Number(sizing.value);
			if (!(value > 0)) throw new Error('주문 크기를 넣으세요.');
			let qty;
			let reduce = false;
			if (sizing.mode === 'percent') {
				if (opposite) {
					qty = p.qty * Math.min(100, value) / 100;
					reduce = true;
				}
				else {
					const margin = this.available() * Math.min(100, value) / 100 / (1 + this.leverage * this.fee);
					qty = margin * this.leverage / price;
				}
			}
			else if (sizing.mode === 'amount') qty = value * this.leverage / price;
			else qty = value;
			if (!(qty > TINY)) throw new Error('주문할 현금이 없습니다.');
			if (!this.futures && side < 0) {
				if (!p) throw new Error('현물은 가진 만큼만 팔 수 있습니다. 숏은 선물 종목에서 할 수 있습니다.');
				qty = Math.min(qty, p.qty);
			}
			const opening = opposite ? Math.max(0, qty - p.qty) : qty;
			const reserve = reduce || (!this.futures && opposite) ? 0 : opening * price / this.leverage * (1 + this.leverage * this.fee);
			if (reserve > this.available() * (1 + 1e-9)) throw new Error(`쓸 수 있는 현금이 모자랍니다 (필요 ${ reserve.toFixed(2) }, 가능 ${ this.available().toFixed(2) }).`);
			return { qty, reduce, reserve };
		}

		/** 시장가 주문. 결과를 글로 돌려준다. 할 수 없으면 Error를 던진다. */
		market(side, sizing, price, time) {
			const { qty } = this.size(side, sizing, price);
			return this.fill(side, qty, price, time, '시장가');
		}

		/** 지정가 주문을 건다. 지금가보다 불리한 쪽이면 바로 체결한다. */
		limit(side, sizing, price, marketPrice, time) {
			if (!(price > 0)) throw new Error('지정가를 넣으세요.');
			if (side > 0 ? price >= marketPrice : price <= marketPrice) return `지정가가 지금가보다 ${ side > 0 ? '높아' : '낮아' } 바로 체결: ${ this.market(side, sizing, marketPrice, time) }`;
			const { qty, reduce, reserve } = this.size(side, sizing, price);
			this.orders.push({ id: nextId++, side, price, qty, reduce, reserve, time });
			return `지정가 ${ this.sideName(side) } ${ formatQty(qty) } 대기`;
		}

		cancel(id) {
			this.orders = this.orders.filter(order => order.id !== id);
		}

		sideName(side) {
			return side > 0 ? (this.futures ? '롱' : '매수') : (this.futures ? '숏' : '매도');
		}

		/** 체결: 반대 포지션이 있으면 먼저 줄이고, 남는 수량으로 포지션을 열거나 늘린다. */
		fill(side, qty, price, time, how) {
			const messages = [];
			let left = qty;
			const p = this.position;
			if (p && p.side !== side) {
				const closing = Math.min(left, p.qty);
				messages.push(this.closeQty(closing, price, time, `${ how } ${ this.futures ? '정리' : '매도' }`));
				left = this.futures ? left - closing : 0;
			}
			if (left > TINY) {
				if (!this.futures && side < 0) throw new Error('현물은 가진 만큼만 팔 수 있습니다.');
				// 현금이 모자라면 살 수 있는 만큼만 산다.
				const costPerUnit = price / this.leverage * (1 + this.leverage * this.fee);
				left = Math.min(left, this.cash / costPerUnit);
				if (left <= TINY) throw new Error('주문할 현금이 없습니다.');
				const margin = left * price / this.leverage;
				const fee = left * price * this.fee;
				this.cash -= margin + fee;
				const current = this.position;
				if (current) {
					current.entry = (current.entry * current.qty + price * left) / (current.qty + left);
					current.qty += left;
					current.margin += margin;
					current.fees += fee;
				}
				else {
					this.position = { side, qty: left, entry: price, margin, fees: fee, time };
				}
				this.setExits();
				this.fills.push({ time, side, price, kind: 'open', how });
				messages.push(`${ how } ${ this.sideName(side) } ${ formatQty(left) } 체결`);
			}
			return messages.join(' · ');
		}

		/** 손절·익절 가격을 평단에 맞춰 다시 정한다. */
		setExits() {
			const p = this.position;
			if (!p) return;
			// 손절·익절 %는 증거금 대비가 아니라 가격 변화 기준이다.
			p.stopPrice = this.stop > 0 ? p.entry * (1 - p.side * this.stop / 100) : null;
			p.targetPrice = this.target > 0 ? p.entry * (1 + p.side * this.target / 100) : null;
		}

		/** fraction만큼 포지션을 정리한다(시장가). */
		close(fraction, price, time, reason = '청산') {
			const p = this.position;
			if (!p) throw new Error('정리할 포지션이 없습니다.');
			return this.closeQty(p.qty * fraction, price, time, reason);
		}

		closeQty(qty, price, time, reason) {
			const p = this.position;
			const fraction = Math.min(1, qty / p.qty);
			const margin = p.margin * fraction;
			const pnl = p.side * qty * (price - p.entry);
			const fee = qty * price * this.fee;
			const openFee = p.fees * fraction;
			// 격리 증거금이라 증거금보다 많이 잃지는 않는다. 강제 청산이면 남은 유지 증거금까지 거래소가 가져간다.
			const back = reason === '강제 청산' ? 0 : Math.max(0, margin + pnl - fee);
			this.cash += back;
			const net = back - margin - openFee;
			const ret = net / (margin + openFee);
			this.trades.push({ side: p.side, entry: p.entry, exit: price, qty, openTime: p.time, time, pnl: net, ret, reason });
			this.fills.push({ time, side: -p.side, price, kind: 'close', pnl: net, ret, reason });
			p.qty -= qty;
			p.margin -= margin;
			p.fees -= openFee;
			if (fraction >= 0.9999 || p.qty <= TINY) {
				this.position = null;
				// 포지션이 없어지면 포지션을 줄이려던 대기 주문은 쓸모가 없다.
				this.orders = this.orders.filter(order => !order.reduce);
			}
			return `${ reason } ${ formatQty(qty) } · 손익 ${ net >= 0 ? '+' : '' }${ net.toFixed(2) }`;
		}

		/**
		 * 새 봉이 나왔을 때. 대기 지정가가 닿았는지 보고, 그다음 청산가·손절·익절을 본다.
		 * 일어난 일을 글 목록으로 돌려준다.
		 */
		onBar(bar) {
			const events = [];
			for (const order of this.orders.slice()) {
				const hit = order.side > 0 ? bar.low <= order.price : bar.high >= order.price;
				if (!hit) continue;
				this.cancel(order.id);
				// 시가가 이미 지정가보다 유리하면 시가에 체결된다.
				const price = order.side > 0 ? Math.min(bar.open, order.price) : Math.max(bar.open, order.price);
				if (order.reduce && (!this.position || this.position.side === order.side)) {
					events.push(`지정가 ${ this.sideName(order.side) } 취소: 줄일 포지션이 없습니다`);
					continue;
				}
				try {
					events.push(this.fill(order.side, order.qty, price, bar.time, '지정가'));
				}
				catch (error) {
					events.push(`지정가 ${ this.sideName(order.side) } 취소: ${ error.message }`);
				}
			}
			const exit = this.checkExits(bar);
			if (exit) events.push(exit);
			return events;
		}

		/** 청산가, 손절, 익절. 한 봉에서 여럿 닿으면 불리한 쪽 먼저. */
		checkExits(bar) {
			const p = this.position;
			if (!p) return null;
			// 불리한 쪽 가격(청산가, 손절가)은 진입가에 가까운 것부터 본다. 시가부터 넘어 있으면 시가에 나온다.
			const losses = [];
			const liq = this.liquidation();
			if (liq !== null) losses.push([liq, '강제 청산']);
			if (p.stopPrice) losses.push([p.stopPrice, '손절']);
			losses.sort((a, b) => (p.side > 0 ? b[0] - a[0] : a[0] - b[0]));
			for (const [level, reason] of losses) {
				const hit = p.side > 0 ? bar.low <= level : bar.high >= level;
				if (!hit) continue;
				const gap = p.side > 0 ? bar.open < level : bar.open > level;
				// 강제 청산은 청산가에서 증거금을 모두 잃는 것으로 본다.
				return this.close(1, reason === '강제 청산' || !gap ? level : bar.open, bar.time, reason);
			}
			const reached = p.targetPrice && (p.side > 0 ? bar.high >= p.targetPrice : bar.low <= p.targetPrice);
			if (reached) return this.close(1, p.side > 0 ? Math.max(bar.open, p.targetPrice) : Math.min(bar.open, p.targetPrice), bar.time, '익절');
			return null;
		}

		summary(price) {
			const equity = this.equity(price);
			const wins = this.trades.filter(trade => trade.pnl > 0).length;
			return {
				equity,
				ret: equity / this.seed - 1,
				trades: this.trades.length,
				winRate: this.trades.length ? wins / this.trades.length : 0,
			};
		}
	}

	function formatQty(qty) {
		if (qty >= 1000) return qty.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
		if (qty >= 1) return qty.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
		return qty.toPrecision(3);
	}

	return { Account, formatQty };
})();
