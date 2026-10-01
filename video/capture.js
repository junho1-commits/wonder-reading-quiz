// 실제 teacher.html·student.html을 구동해 장면별 교사/학생 화면을 캡처하고 scenes/meta.json을 만드는 스크립트
// 사용: WORK=<npm 패키지 설치 폴더> node capture.js   (repo 루트를 localhost:8765로 서빙해 둔 상태에서 실행)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WORK = process.env.WORK;
const BASE = 'http://localhost:8765';
const OUT = path.join(__dirname, 'scenes');
const REAL_BASE = 'https://junho1-commits.github.io/wonder-reading-quiz';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const FAKE_MQTT = fs.readFileSync(path.join(__dirname, 'fake-mqtt.js'), 'utf8');
const QR_JS = fs.readFileSync(path.join(WORK, 'node_modules/qrcodejs/qrcode.min.js'), 'utf8');
const FONT = fs.readFileSync(path.join(WORK, 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2'));
const FONT_CSS = `@font-face{font-family:'SUIT Variable';src:url('https://font.local/p.woff2') format('woff2');font-weight:100 900;}`;

const HELPERS = [
  { grade: 6, cls: 3, num: 2, name: '이서준' },
  { grade: 6, cls: 3, num: 3, name: '박지우' },
  { grade: 6, cls: 3, num: 4, name: '최도윤' },
];
const ME = { grade: 6, cls: 3, num: 1, name: '김하늘' };

const HI_CSS = `.__hi{outline:5px solid #f43f5e !important;outline-offset:5px;border-radius:14px;box-shadow:0 0 0 10px rgba(244,63,94,.28) !important;position:relative;z-index:50}`;

const meta = [];
let seq = 0;

async function highlight(page, selectors) {
  if (!page) return;
  await page.evaluate(([css, sels]) => {
    let st = document.getElementById('__hi_style');
    if (!st) { st = document.createElement('style'); st.id = '__hi_style'; document.head.appendChild(st); }
    st.textContent = css;
    document.querySelectorAll('.__hi').forEach(e => e.classList.remove('__hi'));
    sels.forEach(s => document.querySelectorAll(s).forEach(e => e.classList.add('__hi')));
  }, [HI_CSS, selectors]);
}

async function scene(t, p, o) {
  seq += 1;
  const id = String(seq).padStart(2, '0');
  await highlight(t, o.hiT || []);
  await highlight(p, o.hiP || []);
  await t.waitForTimeout(900);
  if (o.teacher !== false) await t.screenshot({ path: path.join(OUT, `${id}-t.png`) });
  if (o.phone !== false && p) await p.screenshot({ path: path.join(OUT, `${id}-p.png`) });
  meta.push({ id, step: o.step, title: o.title, caption: o.caption, teacher: o.teacher !== false, phone: o.phone !== false });
  await highlight(t, []);
  await highlight(p, []);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'ko-KR' });
  await ctx.route(/^https?:\/\/(?!localhost)/, route => {
    const u = route.request().url();
    if (u.includes('unpkg.com/mqtt')) return route.fulfill({ contentType: 'application/javascript', body: FAKE_MQTT });
    if (u.includes('qrcodejs')) return route.fulfill({ contentType: 'application/javascript', body: QR_JS });
    if (u.includes('SUIT-Variable.css')) return route.fulfill({ contentType: 'text/css', body: FONT_CSS });
    if (u.includes('font.local')) return route.fulfill({ contentType: 'font/woff2', body: FONT });
    return route.abort();
  });

  const t = await ctx.newPage();
  t.on('dialog', d => d.accept());
  t.on('pageerror', e => console.log('[teacher error]', e.message));
  await t.goto(`${BASE}/teacher.html`);
  await t.waitForFunction(() => document.getElementById('joinPinText').innerText !== '----');
  const room = await t.evaluate(() => ROOM_CODE);

  // 화면에 표시되는 접속 주소·QR을 실제 배포 주소로 바꿔서 촬영 (교사가 보게 될 화면과 동일)
  const realUrl = `${REAL_BASE}/student.html?room=${room}`;
  await t.evaluate((u) => {
    document.getElementById('joinUrlText').innerText = u;
    const box = document.getElementById('qrCanvasContainer');
    box.innerHTML = '';
    new QRCode(box, { text: u, width: 240, height: 240, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  }, realUrl);

  await scene(t, null, {
    step: 1, teacher: true, phone: false, hiT: ['.lobby-qr-box', '#joinPinText'],
    title: '교사 화면 열기',
    caption: '교사 컴퓨터(전자칠판)에서 teacher.html을 엽니다. 방 번호(PIN)와 QR코드가 나타나요.',
  });

  // 학생 휴대폰
  // 같은 브라우저 컨텍스트여야 가짜 버스가 연결되므로, 휴대폰 화면도 같은 컨텍스트의 다른 탭으로 열고 뷰포트만 바꾼다
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 390, height: 844 });
  p.on('dialog', d => d.accept());
  p.on('pageerror', e => console.log('[student error]', e.message));
  // 이 탭은 localStorage를 교사와 공유하므로 입장 전에는 저장된 세션이 없다
  await p.goto(`${BASE}/student.html?room=${room}`);
  await p.waitForSelector('#pinInput');

  await scene(t, p, {
    step: 2, hiP: ['#pinInput'],
    title: '학생 휴대폰으로 접속',
    caption: '학생은 휴대폰으로 QR코드를 찍거나 접속 주소로 들어갑니다. 방 번호는 자동으로 입력돼요.',
  });

  await p.fill('#gradeInput', String(ME.grade));
  await p.fill('#clsInput', String(ME.cls));
  await p.fill('#numInput', String(ME.num));
  await p.fill('#nameInput', ME.name);
  await scene(t, p, {
    step: 3, hiP: ['#gradeInput', '#clsInput', '#numInput', '#nameInput', '.join-btn'],
    title: '학년·반·번호, 이름 입력',
    caption: '학년·반·번호와 이름을 입력하고 [골든벨 입장하기]를 누릅니다.',
  });

  await p.click('.join-btn');
  await p.waitForSelector('#lobbyView', { state: 'visible' });
  await t.waitForTimeout(400);
  for (const h of HELPERS) await t.evaluate((x) => handleStudentJoin(x), h);
  await t.waitForTimeout(400);
  await scene(t, p, {
    step: 4, hiT: ['#studentGrid'], hiP: ['#welcomeMsg'],
    title: '입장 완료',
    caption: '입장하면 학생 폰은 대기실이 되고, 칠판에는 입장한 학생이 학반·번호로 실시간 표시됩니다.',
  });

  await t.click('.set-btn:nth-child(2)');
  await t.waitForTimeout(400);
  await scene(t, p, {
    step: 5, hiT: ['#setPicker'], hiP: ['#lobbySetTitle'],
    title: '퀴즈 세트 선택',
    caption: '시작 전에 퀴즈 세트를 고릅니다. 선택한 세트 이름이 학생 폰에도 바로 표시돼요.',
  });

  await t.click('#lockBtn');
  await t.waitForTimeout(300);
  await scene(t, p, {
    step: 6, hiT: ['#lockBtn'],
    title: '입장 잠금 (선택)',
    caption: '모두 들어왔다면 [입장 잠금]으로 새 학생의 입장을 막을 수 있어요. 이미 들어온 학생의 재접속은 가능해요.',
  });
  await t.click('#lockBtn');
  await t.waitForTimeout(300);

  await t.click('#startBtn');
  await t.waitForSelector('#quizView', { state: 'visible' });
  await p.waitForSelector('#quizView', { state: 'visible' });
  await t.waitForTimeout(500);
  await scene(t, p, {
    step: 7, hiT: ['#questionText'], hiP: ['#qPromptText'],
    title: '퀴즈 시작',
    caption: '[퀴즈 시작하기]를 누르면 모든 학생 폰에 같은 문제가 동시에 나타납니다.',
  });

  async function answerAll(correctForMe) {
    const q = await t.evaluate(() => ({ idx: gameState.currentQIndex, ans: questions[gameState.currentQIndex].answer }));
    const mine = correctForMe ? q.ans : (q.ans % 4) + 1;
    await p.click(`#btnOpt${mine}`);
    for (let i = 0; i < HELPERS.length; i++) {
      const c = (i % 2 === 0) ? q.ans : ((q.ans + i) % 4) + 1;
      await t.evaluate(([h, qi, ch]) => handleStudentSubmit({ ...h, qIndex: qi, choice: ch }), [HELPERS[i], q.idx, c]);
    }
    await t.waitForTimeout(400);
  }

  await answerAll(true);
  await scene(t, p, {
    step: 8, hiT: ['.submit-counter-badge'], hiP: ['#submittedNotice'],
    title: '학생이 답 제출',
    caption: '학생이 보기를 고르면 "답안 제출 n/전체 명"이 칠판 위쪽에 실시간으로 올라갑니다.',
  });

  await t.keyboard.press('h');
  await t.waitForTimeout(400);
  await scene(t, p, {
    step: 9, teacher: true, phone: false, hiT: ['#btnHint', '#btnPause', '#hintBox'],
    title: '힌트와 일시정지',
    caption: '[H] 키로 힌트를 보여 주고, [P] 키로 타이머를 잠시 멈출 수 있어요.',
  });
  await t.keyboard.press('h');

  await t.keyboard.press('Space');
  await t.waitForTimeout(700);
  await scene(t, p, {
    step: 10, hiT: ['#explanationDrawer', '#btnNext'], hiP: ['#resultTitle'],
    title: '정답 공개',
    caption: '[Space] 키로 정답을 공개합니다. 학생 폰에는 정답 여부가, 칠판에는 정답과 책 속 해설이 나타나요.',
  });

  await t.keyboard.press('Space');
  await p.waitForSelector('#quizView', { state: 'visible' });
  await t.waitForTimeout(500);
  await scene(t, p, {
    step: 11, hiT: ['#questionText'], hiP: ['#qNumText'],
    title: '다음 문제',
    caption: '[Space]를 한 번 더 누르면 다음 문제로 넘어갑니다. 같은 방식으로 문제를 계속 진행해요.',
  });

  // 마지막 문제까지 진행 (문제마다 학생 답을 넣고 정답 공개 → 다음)
  for (let guard = 0; guard < 40; guard++) {
    const st = await t.evaluate(() => gameState.status);
    if (st === 'finished') break;
    if (st === 'question') {
      await answerAll(guard % 3 !== 2);
      await t.keyboard.press('Space');
    } else if (st === 'answer') {
      await t.keyboard.press('Space');
    }
    await t.waitForTimeout(150);
  }
  await t.waitForTimeout(1200);
  await scene(t, p, {
    step: 12, hiP: ['#resultTitle'],
    title: '골든벨 종료',
    caption: '마지막 문제가 끝나면 점수 순위가 나오는 명예의 전당 화면이 나타나요. 학생 폰에도 종료 화면이 표시됩니다.',
  });

  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ room, scenes: meta }, null, 2));
  await browser.close();
  console.log('captured', meta.length, 'scenes, room', room);
})().catch(e => { console.error(e); process.exit(1); });
