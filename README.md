# 다이어트 코치

한 달 뒤 73kg을 목표로, 매일의 식사·운동·체중을 "오늘의 kcal 예산"과 체크리스트로 바꿔 주는 개인용 PWA. PRD: `../docs/prd/diet-app.md`

빌드 도구·백엔드 없음. 정적 파일만으로 동작하고 모든 데이터는 기기 로컬(localStorage)에만 저장된다.

## 실행

ES 모듈이라 `file://`로는 열리지 않는다. 아무 정적 서버로 서빙한다:

```sh
cd diet-app
python3 -m http.server 8080 --bind 0.0.0.0
# PC → http://localhost:8080/
# 휴대폰(같은 Wi-Fi) → http://<PC의 IP>:8080/   (ifconfig | grep "inet " 로 확인)
```

- `?debug`를 붙이면 관측 이벤트(`weight_logged`, `food_logged`, `workout_completed`, …)가 콘솔에 찍힌다.
- `#log` `#graph` `#cal` `#settings` 해시로 해당 탭이 바로 열린다.
- iOS Safari: 공유 → 「홈 화면에 추가」. Android Chrome: 메뉴 → 「앱 설치」.

## 테스트

```sh
./test.sh
```

Node가 있으면 `node tests/run.mjs`, 없으면 macOS 내장 JavaScriptCore(`jsc`)로 돈다. 테스트는 PRD 요구사항 번호(R-1 …)별로 묶여 있다.

## 구조

```
index.html         앱 셸 + CSS (모바일 우선, ≥1024px에서 홈|그래프 2컬럼, 라이트/다크)
src/config.js      튠 값 — PRD 부록의 [가정] 수치 전부 (하한 1400kcal, 1kg=7700kcal, 운동 kcal …)
src/calc.js        순수 계산: 목표 경로, 추세 체중, 하루 판정(스티커/단식), 예산, 예측, 시뮬레이션, TDEE 보정, 정체 판정
src/foods.js       내장 음식 DB(수기 시드) + 초성 검색
src/storage.js     localStorage 래퍼 (차단·손상 시 메모리 폴백)
src/state.js       상태·변경·파생값 (dayView / graphData / stats / 백업·복원 / 주기 작업)
src/chart.js       의존성 없는 inline SVG 차트 (체중·kcal·운동·예측 정확도)
src/main.js        렌더링과 이벤트 (홈 / 기록 / 그래프 / 달력 / 설정, 온보딩, 시뮬레이션 시트, 알림)
sw.js              서비스 워커 (앱 셸 캐시 → 오프라인 동작)
public/            manifest, 아이콘
tests/             하네스 + 요구사항별 테스트
```

## 데이터

- 저장 키 `diet.v1`, 스키마 버전 `state.version`. 설정 → 백업에서 JSON으로 내보내고, 덮어쓰기/병합으로 가져온다.
- 음식 DB를 바꾸려면 `src/foods.js`의 `SEED_FOODS`만 고치면 된다. `id`는 고유해야 한다.
- 운동 항목·개수 변경은 "내일부터" 적용된다 (`settings.workoutVersions`).

이 앱은 의학적 조언이 아니다. 예산은 안전 하한(기본 1,400kcal, 단식일 800kcal) 아래로 내려가지 않고, 연속 단식은 2일까지만 걸린다.
