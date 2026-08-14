# X Deck

x.com 의 **추천 / 팔로잉** 타임라인을 덱 형태로 실시간 스트리밍하는 브라우저 확장.

API 요금 없이 동작한다. 본인 브라우저 세션으로 x.com 을 띄워두고, x.com 이 스스로 보내는
타임라인 응답을 그대로 받아 우리 화면에 다시 그린다. 새 요청을 만들지 않으므로
x.com 이 화면에 뿌리는 것과 우리가 받는 것이 항상 같다.

## 실행

```bash
npm install
npm run build      # dist/ 생성
```

`chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램 로드** → `dist/` 선택.
툴바 아이콘을 누르면 덱이 열린다. 로그인이 안 돼 있으면 덱 안에서 x.com 로그인 화면이 뜬다.

개발 중에는 `npm run dev` (watch 빌드) 후 확장 새로고침.
아이콘을 바꿨다면 `node scripts/make-icons.mjs`.

## 구조

```
deck.html ─ 우리가 만든 덱 UI (React) ─────────┐
                                              │ postMessage
  숨은 iframe: x.com/home?xdeck_role=foryou    │
  숨은 iframe: x.com/home?xdeck_role=following ┘
        └ interceptor.js (MAIN world)  ─ fetch/XHR 응답 엿보기
        └ bridge.js      (ISOLATED)    ─ 탭 유지 · 새 게시물 알림 클릭 · 중계
```

| 경로 | 역할 |
| --- | --- |
| `src/injected/interceptor.ts` | `HomeTimeline`·`HomeLatestTimeline` GraphQL **응답만** 복제해 넘긴다 |
| `src/content/bridge.ts` | 담당 탭 선택 유지, '새 게시물 보기' 감지·클릭, 로그인 상태 보고 |
| `src/content/selectors.ts` | x.com DOM 선택자 **전부**. UI 개편 시 여기만 고친다 |
| `src/core/parser.ts` | GraphQL 응답 → `Tweet` 정규화 (정석 경로 실패 시 전체 훑기로 폴백) |
| `src/core/db.ts` | IndexedDB 영속 저장 · 보관 정책 |
| `src/ui/` | 덱 UI. x.com DOM 을 아는 코드가 한 줄도 없다 |

### 왜 iframe 인가

x.com 은 `frame-ancestors` CSP 로 임베드를 막는다. 확장의 `declarativeNetRequest` 로
**`sub_frame` 요청에 한해서만** 그 헤더를 제거한다 (`rules.json`). 일반 브라우징에는 영향이 없다.

프레임은 `opacity-0` 으로 감춘다. `display:none` 이나 화면 밖 배치는 렌더링이 멈추거나
스로틀링돼 타임라인이 갱신되지 않는다. `sandbox` 에 `allow-top-navigation` 을 주지 않아
x.com 이 프레임을 탈출하지 못한다.

임베드가 끝내 막히면 20초 뒤 **고정 탭 모드**로 자동 전환한다.

### 로그인

자체 로그인 폼을 두지 않는다. 프레임이 `/login` 으로 밀리면 그 프레임을 전체화면으로 펼쳐
**x.com 공식 로그인 화면을 그대로** 보여준다. 자격 증명은 확장을 거치지 않는다.

## 버전

`package.json` 의 `version` 이 단일 출처다. 빌드 시 `dist/manifest.json` 으로 주입된다.

## 검증이 남은 부분

`src/content/selectors.ts` 의 선택자는 실제 x.com 화면에서 확인이 끝나지 않았다.
`탭 선택` · `'N개의 게시물 보기' 알림` 두 가지가 어긋나면 수집이 멈춘다.
컬럼 헤더의 상태 배지(`준비 중` / `수신 중`)와 `폴백 파싱` 배지가 진단 지점이다.
