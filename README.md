# ChartDesk

개인용 차트 프로그램입니다. 브라우저에서 동작하고, 같은 PC에서 돌리는 작은 로컬 서버가 시세와 AI 요청을 대신 불러 줍니다.

## 실행

Node.js 22 이상이 필요합니다. 따로 설치할 패키지는 없습니다.

```
node server.mjs
```

그다음 브라우저에서 `http://127.0.0.1:5173/`을 엽니다. 포트를 바꾸려면 `PORT` 환경 변수를 씁니다.

## 구성

| 파일 | 내용 |
|---|---|
| `server.mjs` | 정적 파일 제공, Yahoo Finance 대리 호출, AI API 대리 호출 |
| `public/app.js` | 화면, 차트, 상태 저장 |
| `public/providers.js` | 시세 공급원 (Binance, Upbit, Bithumb, Bybit, OKX, Yahoo Finance) |
| `public/indicators.js` | 지표 계산 |
| `public/indicator-help.js` | 지표 설명과 사용법 |
| `public/drawings.js` | 작도 도구 |
| `public/ai.js` | AI 분석 창 |
| `public/vendor/` | 차트 라이브러리 Lightweight Charts (Apache-2.0, TradingView) |

## 저장되는 곳

- 지표, 작도, 관심종목, 테마, 알림 같은 설정은 **브라우저의 localStorage**에 저장됩니다. 이 저장소에는 들어가지 않으며, 브라우저나 PC가 바뀌면 따라오지 않습니다.
- AI API 키는 `ai-keys.json`에 저장되고 git에서 제외됩니다.

## 알아 둘 점

- Yahoo Finance는 공식 공개 API가 아닙니다. 개인 용도로만 쓰고, 예고 없이 막힐 수 있습니다. 주식 시세는 지연될 수 있습니다.
- 확장 시간의 장전·장후 봉에는 거래량이 없습니다. Yahoo가 그 구간의 거래량을 주지 않기 때문입니다.
- AI 분석은 각자 자기 API 키(Claude, GPT, Gemini)를 넣어야 쓸 수 있습니다.
- 투자 판단의 책임은 쓰는 사람에게 있습니다. 지표와 AI 분석은 참고용입니다.
- GOSU 지표는 공개된 거래내역을 분석한 통계를 옮긴 것입니다. 이 지표나 이를 바탕으로 한 프로그램을 유료로 판매하지 말아 주세요.
- 서버는 `127.0.0.1`에서만 듣습니다. 외부에 공개하는 용도로 만들지 않았습니다.
