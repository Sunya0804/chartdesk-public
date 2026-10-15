// 안드로이드 앱에서만 불린다. 데스크톱 앱의 preload.cjs처럼 window.chartdeskApp(버전, 업데이트)을 만들고,
// 웹뷰가 혼자 못 하는 일(파일 저장, 알림)을 앱(MainActivity.Bridge)에 넘긴다.
(() => {
	const native = window.ChartDeskNative;
	if (!native) return;

	// 앱의 일은 오래 걸릴 수 있어 번호를 붙여 넘기고, 앱이 __chartdeskDone(번호, 값)으로 끝을 알린다.
	const waiting = new Map();
	let next = 0;
	const call = start => new Promise((done) => {
		const id = ++next;
		waiting.set(id, done);
		start(id);
	});
	window.__chartdeskDone = (id, value) => {
		waiting.get(id)?.(value);
		waiting.delete(id);
	};

	window.chartdeskApp = {
		platform: 'android',
		version: native.version(),
		updateStatus: () => native.updateStatus(),
		checkForUpdates: () => call(id => native.checkForUpdates(id)),
	};

	// 웹뷰는 <a download>로 파일을 저장하지 못한다. 설정 내보내기, 차트 이미지 저장은 저장 위치를 고르는 창으로 넘긴다.
	const click = HTMLAnchorElement.prototype.click;
	HTMLAnchorElement.prototype.click = function() {
		if (!this.download || !this.href.startsWith('blob:')) return click.call(this);
		const name = this.download;
		fetch(this.href)
			.then(response => response.blob())
			.then(blob => new Promise((done) => {
				const reader = new FileReader();
				reader.onload = () => done({ type: blob.type, data: String(reader.result).split(',')[1] ?? '' });
				reader.readAsDataURL(blob);
			}))
			.then(({ type, data }) => native.saveFile(name, type, data));
	};

	// 가격 알림은 휴대폰 알림으로 띄운다.
	class AppNotification {
		constructor(title, options = {}) {
			native.notify(String(title), String(options.body ?? ''));
		}

		static get permission() {
			return native.notificationPermission();
		}

		static requestPermission() {
			return call(id => native.requestNotificationPermission(id));
		}
	}
	window.Notification = AppNotification;
})();
