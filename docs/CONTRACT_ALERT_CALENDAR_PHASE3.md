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
