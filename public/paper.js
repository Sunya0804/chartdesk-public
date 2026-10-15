// 바 리플레이용 모의 매매 계좌. 주문은 지금 보이는 마지막 봉의 종가에 바로 체결된다(시장가).
// 포지션은 한 방향 하나만 둔다. 같은 방향 주문은 평단을 합치고, 반대 방향 주문은 지금 포지션을 그 비율만큼 정리한다.
// 선물은 격리 증거금으로 계산한다: 증거금 × 배율만큼 사고, 청산가에 닿으면 증거금을 모두 잃는다.
window.ChartDeskPaper = (() => {
	'use strict';

	// 유지 증거금률. 거래소마다 다르지만 대략 0.5%로 본다.
	const MAINTENANCE = 0.005;

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
			this.trades = [];
			this.fills = [];
		}

		/** 포지션의 평가 손익. */
		unrealized(price) {
			const p = this.position;
			return p ? p.side * p.qty * (price - p.entry) : 0;
		}

		/** 현금 + 포지션 증거금 + 평가 손익. */
		equity(price) {
			return this.cash + (this.position ? this.position.margin + this.unrealized(price) : 0);
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
		 * 주문. side: 1 매수(롱), -1 매도(숏). fraction: 쓸 수 있는 현금 중 넣을 비율(0~1).
		 * 결과를 글로 돌려준다. 할 수 없으면 Error를 던진다.
		 */
		order(side, fraction, price, time) {
			const p = this.position;
			// 반대 방향 주문은 지금 포지션을 그 비율만큼 정리한다(현물 보유분 매도, 선물 포지션 줄이기).
			if (p && p.side !== side) return this.close(fraction, price, time, this.futures ? '반대 주문' : '매도');
			if (!this.futures && side < 0) throw new Error('현물은 가진 만큼만 팔 수 있습니다. 숏은 선물 종목에서 할 수 있습니다.');
			// 수수료까지 낼 수 있는 만큼만 증거금으로 쓴다.
			const margin = this.cash * fraction / (1 + this.leverage * this.fee);
			if (margin <= this.seed * 1e-6) throw new Error('주문할 현금이 없습니다.');
			const qty = margin * this.leverage / price;
			const fee = qty * price * this.fee;
			this.cash -= margin + fee;
			if (p) {
				p.entry = (p.entry * p.qty + price * qty) / (p.qty + qty);
				p.qty += qty;
				p.margin += margin;
				p.fees += fee;
			}
			else {
				this.position = { side, qty, entry: price, margin, fees: fee, time };
			}
			this.setExits();
			this.fills.push({ time, side, price, kind: 'open' });
			return `${ side > 0 ? (this.futures ? '롱' : '매수') : '숏' } ${ formatQty(qty) } 체결`;
		}

		/** 손절·익절 가격을 평단에 맞춰 다시 정한다. */
		setExits() {
			const p = this.position;
			if (!p) return;
			// 손절·익절 %는 증거금 대비가 아니라 가격 변화 기준이다.
			p.stopPrice = this.stop > 0 ? p.entry * (1 - p.side * this.stop / 100) : null;
			p.targetPrice = this.target > 0 ? p.entry * (1 + p.side * this.target / 100) : null;
		}

		/** fraction만큼 포지션을 정리한다. */
		close(fraction, price, time, reason = '청산') {
			const p = this.position;
			if (!p) throw new Error('정리할 포지션이 없습니다.');
			const qty = p.qty * fraction;
			const margin = p.margin * fraction;
			const pnl = p.side * qty * (price - p.entry);
			const fee = qty * price * this.fee;
			const openFee = p.fees * fraction;
			// 격리 증거금이라 증거금보다 많이 잃지는 않는다. 강제 청산이면 남은 유지 증거금까지 거래소가 가져간다.
			const back = reason === '강제 청산' ? 0 : Math.max(0, margin + pnl - fee);
			this.cash += back;
			const net = back - margin - openFee;
			this.trades.push({ side: p.side, entry: p.entry, exit: price, qty, openTime: p.time, time, pnl: net, ret: net / (margin + openFee), reason });
			this.fills.push({ time, side: -p.side, price, kind: 'close', pnl: net, ret: net / (margin + openFee), reason });
			p.qty -= qty;
			p.margin -= margin;
			p.fees -= openFee;
			if (fraction >= 0.9999 || p.qty <= 1e-12) this.position = null;
			return `${ reason } ${ formatQty(qty) } · 손익 ${ net >= 0 ? '+' : '' }${ net.toFixed(2) }`;
		}

		/**
		 * 새 봉이 나왔을 때. 청산가, 손절, 익절 순서로 봉 안에서 닿았는지 본다(한 봉에서 여럿 닿으면 불리한 쪽 먼저).
		 * 일어난 일을 글로 돌려준다. 없으면 null.
		 */
		onBar(bar) {
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
