# 계약기한 경고·Calendar 연동 3차 개발 기록

## 변경 범위

- `건물 운영현황` 상단에 현재 계약 종료일로 계산한 `확인 필요` 영역을 추가했습니다.
- 한국시간 날짜를 기준으로 31~45일은 `계약 확인 필요`, 0~30일은 `계약 만료 임박`, 지난 계약은 `계약기한 경과`로 표시합니다. D-day와 경고는 저장하지 않습니다.
- `재계약예정`, `계약종료예정`, `명도소송중`, `강제집행중`은 저장된 상태를 함께 드러내는 문구를 사용합니다. `공실(정리중)`과 `임대모집중`은 남아 있는 과거 계약일로 경고하지 않습니다.
- 현재 계약이 갱신되어 tenant의 계약기간이 새 값으로 바뀌면 새 종료일만 사용합니다. 보관된 과거 임차인도 경고와 Calendar 대상에서 제외합니다.
- `Google Calendar 동기화` 버튼은 revision이 일치하는 서버 저장 DB만 사용합니다. 브라우저의 tenant payload를 서버로 보내지 않습니다.

## Calendar 동기화 규칙

동기화는 임대관리앱에서 Calendar로만 진행합니다. 유효한 종료일을 가진 현재 임차인의 계약마다 하루 종일 일정 한 개를 만들며 제목은 `[임대관리] 3층 상호 계약 만료` 형식입니다. 설명에는 층, 임차인, 상호, 계약 종료일과 현재 임대상태를 넣습니다.

tenant ID와 Google Calendar event ID의 연결은 Script Properties의 `RENTAL_CONTRACT_CALENDAR_EVENTS_V1`에 저장합니다. 임차인·월별 고지·audit 구조에는 Calendar 필드를 추가하지 않았습니다. 같은 tenant를 다시 동기화하면 기존 일정을 찾아 날짜, 제목과 설명을 갱신합니다. 일정이 Calendar에서 수동 삭제되어 event ID를 찾을 수 없으면 새 일정으로 복구합니다.

앱은 일정을 자동 삭제하지 않습니다. 임차인이 보관되거나 공실·모집 상태로 바뀌어 동기화 대상에서 빠져도 기존 Calendar 일정은 그대로 둡니다. 필요한 삭제는 사용자가 Calendar에서 명시적으로 수행합니다.

기본 대상은 Apps Script 실행 계정의 기본 Calendar입니다. 별도 Calendar를 쓰려면 Script Properties에 `RENTAL_CALENDAR_ID`를 설정합니다. 값이 잘못됐거나 Calendar 권한/API 호출이 실패하면 Calendar 결과만 오류로 반환하며 DB 저장과 기존 기능에는 영향을 주지 않습니다.

## 배포 전 검증 경계

- 계약 종료 100일, 45일, 44일, 30일, 1일, 당일, 1일 경과 및 갱신된 현재 계약을 고정 fixture로 검증했습니다.
- 공실·모집 상태의 과거 날짜 억제와 재계약·종료·명도소송·강제집행 문구를 검증했습니다.
- 최초 생성, 같은 계약 재동기화, 계약일·임차인명·상호 변경 시 동일 event 갱신, 권한 거부와 API 실패 격리를 mock Calendar로 검증했습니다.
- 확인 영역과 필터 조회 전후의 앱 데이터가 동일하고 audit가 추가되지 않음을 브라우저에서 검증했습니다.
- 운영 DB와 실제 Google Calendar는 사용하거나 변경하지 않았습니다.

## 운영 반영 절차

1. 복구 기준 `backup/phase2-complete-20260917`과 3차 작업 브랜치의 최종 커밋을 확인합니다.
2. Apps Script에 `server/Billing.gs`, `server/CurrentStatus.gs`, `server/CalendarSync.gs`, `server/Code.gs`를 함께 반영합니다.
3. 기존 웹 앱 URL, 실행 계정과 접근 정책을 유지해 새 버전을 배포하고 Calendar 권한을 승인합니다.
4. 기존 소유자 전용 Sites 프로젝트에 생성된 `index.html`을 배포합니다.
5. 운영 DB GET으로 revision을 확인하고, 실제 생성·갱신 예정 일정을 검토한 뒤 별도 승인 후 `Google Calendar 동기화`를 한 번 실행합니다.
6. 문제가 있으면 Apps Script 버전 5와 Sites 버전 4로 되돌리고 Git tag `backup/phase2-complete-20260917`을 기준으로 복구합니다. Calendar 일정은 자동 삭제하지 않으므로 필요한 경우 생성·갱신된 일정만 Calendar에서 직접 확인합니다.

## 운영 반영 결과

사용자 승인 후 `main`을 `bcfd55f`로 fast-forward하고 기존 Apps Script 웹 앱 배포를 버전 6 `계약기한 경고·Calendar 연동 3차 개발_2026-09-17`로 갱신했습니다. 기존 배포 ID, URL, 실행 계정, 접근 설정은 유지했습니다. 연속 GET 두 번에서 HTTP 200, `status=ok`, 동일 revision과 동일 전체 응답 해시, `contractCalendar=true`, 임차인 4명을 확인했습니다. POST와 Calendar 호출은 실행하지 않았습니다.

기존 소유자 전용 Sites 프로젝트에는 원격 `main`의 `bcfd55f`와 일치하는 정적 아카이브를 버전 5로 저장해 배포했습니다. 배포 ID `appgdep_6aabee7eed88819191432f600017e308`은 `succeeded`이며 기존 HTTPS 주소와 소유자 전용 접근 정책을 유지했습니다. 운영 URL의 390×844 격리 브라우저에서 확인 필요 영역, Calendar 버튼, 메뉴 6개, 1~5층 순서, 데이터 불변, 가로 넘침 없음과 콘솔 오류 0건을 확인했습니다. Google 요청은 GET 한 번뿐이었습니다.

2단계 사용자 승인 후 Apps Script 프로젝트 소유자 계정으로 Calendar 권한을 승인하고, 실행 직전 운영 DB revision `sha256-9e9a6a305978d5556a7fd46c6feed8aae03ad2f99d2f8aac7e746db0d2c447f9`을 다시 확인했습니다. 첫 동기화에서 다음 일정 4건을 생성했습니다.

- `[임대관리] 1층 심야잡화점 계약 만료` — 2027-05-08
- `[임대관리] 2층 타키 노원역점 계약 만료` — 2027-02-14
- `[임대관리] 3층 오술차 노원점 계약 만료` — 2026-10-19
- `[임대관리] 4층 문 바 노원점 계약 만료` — 2027-02-09

같은 DB로 두 번째 동기화를 실행한 결과 `created=0`, `updated=4`였으므로 tenant별 event ID 연결과 중복 방지를 운영 Calendar에서 확인했습니다. 두 실행 전후 DB revision과 임차인 수는 변하지 않았습니다. 권한승인에 사용한 소유자 전용 임시 배포는 검증 후 제거했으며, 운영 Apps Script 버전 6과 Sites 버전 5는 그대로 유지했습니다. 앱은 Calendar 일정을 자동 삭제하지 않습니다.

이후 운영 저장에서 세분화된 Google Docs 권한이 빠진 것이 확인되어 프로젝트 배포자 계정으로 Documents 권한을 다시 승인했습니다. 최신 revision `sha256-facf733b1f2f0e42fb201a6f16df8c4a69f9c50a579a03bcbb1dec34c3a3d61b`에서 현재현황을 연속 두 번 재생성했고, 두 번 모두 기존 문서 ID `1-HZYrBDD8HPZYO8sNCy33Q298DJ91LJIJAWRuWdQgFI`를 재사용했습니다. 전후 DB revision과 임차인 4명은 그대로였으며 임시 승인 함수와 배포는 제거했습니다.
