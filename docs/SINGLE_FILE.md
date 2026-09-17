# 단일 HTML 사용 및 개발 안내

## 목차

1. 실행 파일과 개발 소스
2. 빌드와 검증
3. PC와 모바일
4. 저장 및 file:// 제한

## 1. 실행 파일과 개발 소스

사용 파일은 저장소 루트의 **index.html** 하나입니다. CSS 3개, JavaScript 4개, SVG 아이콘을 포함합니다. 외부 글꼴 요청 없이 기기의 기본 글꼴을 사용합니다. 앱 실행에 assets 폴더나 Node.js가 필요하지 않습니다.

| 파일 | 역할 |
|---|---|
| src/index.template.html | 공유 HTML 원본. 화면 구조 수정은 여기에서 수행 |
| assets/styles.css, assets/workspace.css | 보존한 기본 스타일과 PC 워크스페이스 |
| assets/mobile.css | 800px 이하의 모바일·태블릿 스타일 |
| assets/core.js, assets/billing.js | 기존 데이터 검증·저장 및 업무 계산 |
| assets/app.js, assets/enhancements.js | 공유 UI·동기화·대시보드·초안 |
| scripts/build.cjs | 의존성 없는 Node.js 자동 빌드 |
| index.html | 자동 생성된 최종 실행본. 직접 편집하지 않음 |
| sw.js, manifest.json, icon.svg | HTTP/HTTPS에서 선택적으로 제공하는 PWA 파일 |

빌드에서 icon.svg를 data URI로 변환합니다. 브랜드·예시 종료 링크도 폴더가 아닌 index.html을 가리킵니다. CSS와 JS는 원본 순서로 포함하며, 인라인 classic script는 defer가 작동하지 않으므로 body 끝에서 DOMContentLoaded 전에 실행합니다. 전역 함수·초기화 순서를 유지합니다.

## 2. 빌드와 검증

```sh
npm run build
npm run check:build
npm run test:all
```

- build는 같은 소스에서 동일한 바이트의 index.html을 생성합니다. 미번들 자산 참조, 외부 자산에 의존하는 CSS, JS 문법 오류는 실패 처리합니다.
- check:build는 생성본과 현재 소스의 일치를 검사합니다.
- npm start, 실행.cmd, test:all은 빌드를 자동 실행합니다.
- 기존 브라우저 테스트 4개 묶음을 보존하고 single-file-browser.cjs를 추가했습니다. Playwright는 기존 설치 또는 NODE_PATH로 제공하며 앱 런타임 라이브러리는 추가하지 않았습니다.
- 추가 검증은 test-results/single-file/portable/index.html만 있는 폴더를 만듭니다. file:// 및 index.html만 제공하는 임시 HTTP 서버에서 실제 UI·저장·백업/복원을 검사합니다. 운영 브라우저 프로필이나 Google 서버에 쓰지 않습니다.
- PC 비교 기준은 변경 전 커밋 33e61e6입니다. 테스트는 해당 커밋의 소스를 읽기만 하며 체크아웃하거나 작업 파일을 덮어쓰지 않습니다.

## 3. PC와 모바일

PC 스타일은 그대로 두고 모바일 규칙만 별도 CSS에 추가했습니다. 800px 이하에서 같은 메뉴 DOM을 하단 고정 탐색으로 사용합니다. 모바일 헤더, 2열 지표 카드, 세로 고지서 작업 버튼, 44px 이상 주요 터치 버튼, 16px 입력 글꼴, 좁은 화면의 1열 입력을 적용했습니다.

하단 안전 영역과 스크롤 여백을 확보하며 모달은 메뉴 위에 표시합니다. 정산 배분표는 금액을 압축하지 않고 **표 내부만 가로 스크롤**합니다. 페이지 전체에는 가로 스크롤이 발생하지 않도록 검사합니다.

공유 DOM·상태·업무 계산을 유지하며 모바일 전용 데이터 구조는 없습니다.

## 4. 저장 및 file:// 제한

- 기존 RentalCore, rentalApp.state.v1, validation, recovery snapshot, 저장 잠금·충돌 방지, JSON 백업 형식을 그대로 사용합니다.
- 검증한 Windows Edge의 file:// 환경에서는 localStorage 및 Web Locks가 동작하여 저장·재로드·백업/복원이 가능합니다. 다른 브라우저·모바일 파일 뷰어의 지원은 보장하지 않습니다. 파일을 웹 페이지로 실행하지 않는 미리보기 앱에서는 사용할 수 없습니다.
- 파일 안에 사용자의 데이터가 들어가는 구조는 아닙니다. **HTML 파일만 다른 기기로 복사해도 저장 자료가 함께 이동하지 않습니다.** 설정에서 JSON 백업을 내보내고 새 환경에서 가져옵니다.
- 브라우저·프로필·파일 경로·HTTP 출처가 달라지면 저장소도 달라질 수 있습니다. 파일 이동·이름 변경·브라우저 데이터 정리 전 백업을 보관하세요.
- file://에서는 manifest를 요청하거나 서비스 워커를 등록하지 않습니다. PWA 설치·캐시 업데이트는 HTTP/HTTPS 제공 시 선택 기능입니다. localhost 외 일반 HTTP에서는 브라우저가 Web Locks·서비스 워커 등 보안 컨텍스트 기능을 제한할 수 있습니다.
- HTTP에서 단일 HTML만 제공해도 핵심 기능은 실행됩니다. 별도 PWA 파일이 없으면 오프라인 준비 안내가 표시될 수 있지만 앱 실행을 막지 않습니다. 전체 저장소를 제공할 때 기존 서비스 워커 설치·업데이트·오프라인 기능을 유지합니다.
- Google 동기화는 인터넷 및 기존 서버 계약·권한·CORS 조건에 따릅니다. file://에서 운영 Google 서버 연결 성공을 검증한 것은 아닙니다.
- 휴대폰 크기의 터치 에뮬레이션을 검증했습니다. 실제 Android·iOS 기기의 파일 열기, 키보드·회전 및 브라우저별 저장 정책은 물리 기기 확인이 필요합니다.
