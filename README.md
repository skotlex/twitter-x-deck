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
툴바 아이콘을 누르면 x.com 탭이 열리고 그 위에 덱이 얹힌다. 로그인이 안 돼 있으면 덱이
비켜나며 x.com 로그인 화면이 그대로 보인다.

개발 중에는 `npm run dev` (watch 빌드) 후 확장 새로고침.
아이콘을 바꿨다면 `npm run icons`.

## 구조

덱은 **x.com 탭 위에 얹힌다**. 확장 페이지가 아니다.

```
x.com/home?xdeck_role=foryou&xdeck=1   ← 확장 아이콘이 여는 탭
├─ deck.js       그림자 DOM 안에 덱 UI 를 얹는다. 이 문서가 '추천' 을 직접 수집
├─ interceptor.js (MAIN)      fetch/XHR 응답 엿보기 + 문서를 항상 '보임' 으로 위장
├─ bridge.js      (ISOLATED)  자식 프레임 전용 진입점
└─ 숨은 iframe: x.com/home?xdeck_role=following   ← '팔로잉' 담당
```

| 경로 | 역할 |
| --- | --- |
| `src/content/mount.tsx` | 덱 진입점. 그림자 DOM 을 만들고 최상위 문서의 수집기를 띄운다 |
| `src/content/collector.ts` | 수집 본체. 탭 유지, 알림 감지·클릭, 강제 갱신 사다리 |
| `src/content/selectors.ts` | x.com DOM 선택자 **전부**. UI 개편 시 여기만 고친다 |
| `src/injected/interceptor.ts` | `HomeTimeline`·`HomeLatestTimeline` 응답만 복제해 넘긴다 |
| `src/core/parser.ts` | GraphQL 응답 → `Tweet` 정규화 (정석 경로 실패 시 전체 훑기로 폴백) |
| `src/core/db.ts` | IndexedDB 영속 저장 · 보관 정책 |
| `src/ui/` | 덱 UI. x.com DOM 을 아는 코드가 한 줄도 없다 |

### 왜 확장 페이지가 아니라 x.com 페이지인가

x.com 은 `frame-ancestors 'self'` 로 임베드를 막는다. 이건 **x.com 이 x.com 을 임베드하는
것만 허용**한다는 뜻이다. 그래서 부모를 x.com 으로 두면 —

- CSP 를 우회할 필요가 없다 (`declarativeNetRequest` 권한 자체가 필요 없음)
- 쿠키가 same-site 로 그대로 실린다
- 최상위 탭이라 타이머 스로틀링이 없다
- 로그인은 x.com 자체가 처리한다
- 탭이 하나만 생긴다

x.com 의 DOM 은 지우지 않고 살려둔 채 덮는다. 그 아래에서 x.com 이 계속 폴링해야
'새 게시물 보기' 알림이 뜨고, 그게 우리 수집의 출발점이다. 스타일은 그림자 DOM +
구성된 스타일시트로 넣어 x.com 의 CSS 와 CSP 양쪽에서 격리된다.

상단 바의 눈 아이콘을 누르면 덱이 비켜나 아래 x.com 을 그대로 쓸 수 있다.

### 갱신이 멈추지 않게 하는 장치

x.com 은 `document.hidden` 이면 새 게시물 폴링을 멈춘다. 인터셉터가 `visibilityState`·
`hidden`·`hasFocus` 를 항상 '보임' 으로 위장하고 `visibilitychange`·`blur` 를 캡처 단계에서
삼켜 폴링이 계속 돌게 한다. 역할이 지정된 프레임/탭에서만 적용되므로 평소 쓰는 x.com 탭은
영향을 받지 않는다.

그래도 응답이 안 들어오면 강제 갱신 사다리를 오른다 — 알림 클릭 → 홈 링크 재클릭 →
탭 재클릭 → `.` 단축키 → 문서 새로고침. 응답이 들어오면 맨 아래로 되돌아온다.

### 게시물 동작

답글·리포스트·마음에 들어요는 x.com 공식 intent 페이지로 넘긴다. 내부 뮤테이션을 직접
호출하면 덱 안에서 끝낼 수 있지만, 읽기만 하던 확장이 계정으로 쓰기를 하게 되고 잠금
위험을 진다. 최종 확인은 x.com 화면에서 이뤄지도록 남겼다.

## 버전

`package.json` 의 `version` 이 단일 출처다. 빌드 시 `dist/manifest.json` 으로 주입된다.

## 검증이 남은 부분

`src/content/selectors.ts` 의 선택자는 실제 x.com 화면에서 확인이 끝나지 않았다.
`탭 선택` · `'N개의 게시물 보기' 알림` 두 가지가 어긋나면 수집이 멈춘다.
컬럼 헤더의 상태 배지(`준비 중` / `수신 중`)와 `폴백 파싱` 배지가 진단 지점이다.
