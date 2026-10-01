# 컨텍스트 노트
- 2026-10-01 사용자 요청: 다른 교사용 앱 사용 설명 영상. 방식 = 화면 모형+자막 mp4, 범위 = 교사 진행 + 학생 입장·풀이.
- 환경 제약: 샌드박스에서 broker.emqx.io, unpkg, cdn.jsdelivr.net 접속 불가(403). npm 레지스트리는 가능. 한국어 TTS·한글 글꼴 없음 → 음성 없이 자막만.
- 결정: HTML을 새로 그려 모형을 만드는 대신 실제 앱을 Playwright로 구동. 앱 소스는 건드리지 않고, 외부 의존성만 네트워크 라우팅으로 대체한다. 모형보다 실제 화면이 앱 변경에도 정확하다.
- 구현: fake-mqtt.js(BroadcastChannel 가짜 브로커) + capture.js(실제 앱 구동·캡처) + compose.js(자막 합성·ffmpeg). 앱 소스는 수정하지 않음.
- 교사 화면은 전자칠판 기준 1920x1080으로 촬영 (1280x720에서는 헤더가 줄바꿈되고 QR이 잘림). 영상 안에서 1280x720으로 축소해 표시.
- 접속 주소·QR은 촬영 시 https://junho1-commits.github.io/wonder-reading-quiz/student.html?room=… 로 치환 (스크린샷의 도메인에서 추정한 배포 주소. 실제 경로가 다르면 capture.js의 REAL_BASE 수정).
- 앱 동작 확인으로 자막 정정: 대기실은 이름이 아닌 '번호'만 표시, 보기별 선택 수는 정답 공개 후에만 표시.
- 알려진 앱 quirk (수정하지 않음): 긴긴밤 세트에서도 해설 제목이 '《원더》 책 속 이야기 & 해설'로 표시됨. 영상에 그대로 찍힘.
- 재생성: 서버(python3 -m http.server 8765, repo 루트) 실행 후 `WORK=<npm i mqtt@5.3.5 qrcodejs@1.0.0 pretendard 한 폴더> node capture.js && node compose.js`
