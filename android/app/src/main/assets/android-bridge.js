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

	// 웹뷰의 저장소(localStorage)는 포트마다 따로다. 앱 서버가 47380을 못 쓰고 다른 포트로 뜨면 설정이 비어 보이므로,
	// 설정('chartdesk'로 시작하는 값)을 앱 안에 따로 백업해 두고 포트가 바뀐 첫 실행에서 화면 스크립트보다 먼저 되돌린다.
	const PREFIX = 'chartdesk';
	try {
		const restore = native.restoreSettings();
		if (restore) {
			const entries = JSON.parse(restore);
			for (let i = localStorage.length - 1; i >= 0; i--) {
				const key = localStorage.key(i);
				if (key.startsWith(PREFIX) && !(key in entries)) localStorage.removeItem(key);
			}
			for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
		}
	}
	catch {
		// 되돌리지 못하면 이 포트의 저장소를 그대로 쓴다.
	}

	window.__chartdeskBackup = () => {
		try {
			const entries = {};
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key.startsWith(PREFIX)) entries[key] = localStorage.getItem(key);
			}
			// 화면을 아직 한 번도 저장하지 않았으면(빈 저장소) 이전 백업을 덮지 않는다.
			if ('chartdesk.workspace.v1' in entries) native.backupSettings(JSON.stringify(entries));
		}
		catch {
			// 백업하지 못해도 다음 기회에 다시 한다.
		}
	};
	// 화면의 저장(app.js)이 먼저 끝나도록 한 박자 늦게 백업한다.
	const later = () => setTimeout(window.__chartdeskBackup, 0);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') later();
	});
	window.addEventListener('pagehide', window.__chartdeskBackup);
})();
