# ChartDesk

개인용 차트 프로그램입니다. Windows 데스크톱 앱이나 안드로이드 앱으로 설치하거나, 브라우저와 작은 로컬 서버로 실행할 수 있습니다.

## 데스크톱 앱 설치 (Windows)

[Releases](https://github.com/Sunya0804/chartdesk-public/releases/latest)에서 `ChartDesk-Setup-x.y.z.exe`를 받아 실행하면 설치되고 바로 켜집니다. Node.js는 필요 없습니다.

- 처음 실행할 때 "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**을 누릅니다. 코드 서명 인증서가 없어서 나오는 경고입니다.
- 앱을 켤 때와 켜 둔 동안 6시간마다 새 버전을 확인해 받아 두고, 다시 켤 때 적용합니다. 오른쪽 위 톱니바퀴에서 버전과 업데이트 상태를 보고, 직접 확인할 수도 있습니다.

## 안드로이드 앱 설치

휴대폰에서 [Releases](https://github.com/Sunya0804/chartdesk-public/releases/latest)의 `ChartDesk-x.y.z.apk`를 받아 엽니다. Android 8.0 이상.

- 처음 설치할 때 "출처를 알 수 없는 앱" 설치를 허용하라고 나오면 허용합니다(브라우저나 파일 앱에 한 번).
- 앱을 열 때와, 6시간이 지나 앱으로 돌아올 때 새 버전을 확인합니다. 새 버전이 있으면 받아 두고 설치할지 묻습니다. 처음 한 번은 ChartDesk에 "이 출처의 앱 설치"를 허용해야 합니다. 톱니바퀴에서 직접 확인할 수도 있습니다.
- 화면과 기능은 데스크톱과 같습니다. 작도는 손가락으로 점을 차례로 누르고, 작도를 끌어 옮기고, 두 번 눌러 설정을 엽니다.
- AI 분석은 API 키로만 연결됩니다(구독 계정 연결은 PC의 CLI가 필요해 PC 앱에서만 됩니다). 키는 앱 저장소에만 둡니다.
- 가격 알림은 앱이 켜져 있을 때 휴대폰 알림으로 뜹니다.

## 브라우저로 실행

Node.js 22 이상이 필요합니다. 따로 설치할 패키지는 없습니다.

```
node server.mjs
```

그다음 브라우저에서 `http://127.0.0.1:5173/`을 엽니다. 포트를 바꾸려면 `PORT` 환경 변수를 씁니다.

## 구성

| 파일 | 내용 |
|---|---|
| `server.mjs` | 정적 파일 제공, Yahoo Finance 대리 호출, AI API 대리 호출, Claude Code·Codex·Gemini CLI(계정 로그인) 실행 |
| `desktop/` | 데스크톱 앱(Electron): 창, 자동 업데이트 |
| `android/` | 안드로이드 앱: 웹뷰, `server.mjs`를 옮긴 앱 안 로컬 서버(`LocalServer.java`), 자동 업데이트(`Updater.java`) |
| `public/app.js` | 화면, 차트, 상태 저장, 설정 내보내기·가져오기 |
| `public/providers.js` | 시세 공급원 (Binance, Upbit, Bithumb, Bybit, OKX, Yahoo Finance) |
| `public/indicators.js` | 지표 계산 |
| `public/indicator-help.js` | 지표 설명과 사용법 |
| `public/drawings.js` | 작도 도구 |
| `public/ai.js` | AI 분석 창 |
| `public/vendor/` | 차트 라이브러리 Lightweight Charts (Apache-2.0, TradingView) |

## 저장되는 곳

- 지표, 작도, 관심종목, 테마, 알림 같은 설정은 브라우저(또는 앱) 안에 저장됩니다. 브라우저판과 앱, PC마다 따로입니다.
- 톱니바퀴의 **설정 내보내기·가져오기**로 이 설정을 파일 하나로 옮길 수 있습니다. AI API 키는 들어가지 않습니다.
- AI API 키는 브라우저판은 `ai-keys.json`(git 제외), 앱은 `%APPDATA%\ChartDesk\ai-keys.json`, 안드로이드 앱은 앱 전용 저장소에 저장됩니다.

## 새 버전 내기

```
npm ci
# package.json의 version을 올린다 (예: 1.0.1)
npm run dist
gh release create v1.0.1 dist/ChartDesk-Setup-1.0.1.exe dist/ChartDesk-Setup-1.0.1.exe.blockmap dist/latest.yml --title "ChartDesk 1.0.1" --notes "바뀐 점"
```

설치된 앱은 `latest.yml`을 보고 새 버전을 찾으므로 세 파일을 모두 올려야 합니다.

안드로이드 APK도 같은 릴리스에 올립니다. 안드로이드 앱은 최신 릴리스에서 `.apk` 파일을 찾아 업데이트합니다.

```
npm run dist:android     # dist/ChartDesk-1.0.1.apk
gh release upload v1.0.1 dist/ChartDesk-1.0.1.apk
```

빌드에는 Android SDK(`android/local.properties`의 `sdk.dir`, git 제외)와 JDK 17 이상이 필요합니다. Windows 사용자 폴더 이름이 한글이면 에뮬레이터가 동작하지 않으므로 SDK는 `C:\Android\Sdk`처럼 영문 경로에 둡니다.

APK 서명 키는 사용자 폴더의 `.chartdesk/`(`android-release.jks`, `android-signing.properties`)에 있습니다. 업데이트는 같은 키로 서명한 APK만 설치되므로 **이 폴더를 꼭 따로 백업**하세요. 잃어버리면 휴대폰에서 앱을 지우고 새로 설치해야 하고, 그때 앱의 설정도 사라집니다.

## 알아 둘 점

- Yahoo Finance는 공식 공개 API가 아닙니다. 개인 용도로만 쓰고, 예고 없이 막힐 수 있습니다. 주식 시세는 지연될 수 있습니다.
- 확장 시간의 장전·장후 봉에는 거래량이 없습니다. Yahoo가 그 구간의 거래량을 주지 않기 때문입니다.
- AI 분석은 각자 자기 API 키(Claude, GPT, Gemini)를 넣거나, 이 컴퓨터의 공식 CLI에 본인 계정으로 로그인해 두면 키 없이 쓸 수 있습니다(AI 분석 → 계정 연결): Claude는 [Claude Code](https://claude.com/claude-code)(Claude Pro·Max), GPT는 [Codex](https://developers.openai.com/codex/cli) 앱 또는 CLI(ChatGPT 계정), Gemini는 [Gemini CLI](https://github.com/google-gemini/gemini-cli)(Google 계정). 이때 사용량은 각 계정의 한도에서 빠집니다.
- 투자 판단의 책임은 쓰는 사람에게 있습니다. 지표와 AI 분석은 참고용입니다.
- GOSU 지표는 공개된 거래내역을 분석한 통계를 옮긴 것입니다. 이 지표나 이를 바탕으로 한 프로그램을 유료로 판매하지 말아 주세요.
- 서버는 `127.0.0.1`에서만 듣습니다. 외부에 공개하는 용도로 만들지 않았습니다.
