// scenes/ 캡처에 단계 표시·한글 자막을 입혀 1920x1080 프레임을 만들고 ffmpeg로 mp4로 합치는 스크립트
// 사용: WORK=<npm 패키지 설치 폴더> node compose.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const WORK = process.env.WORK;
const DIR = __dirname;
const SC = path.join(DIR, 'scenes');
const FR = path.join(DIR, 'frames');
const OUT = path.join(DIR, '원더_골든벨_사용법.mp4');
fs.rmSync(FR, { recursive: true, force: true });
fs.mkdirSync(FR, { recursive: true });

const FONT = fs.readFileSync(path.join(WORK, 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2')).toString('base64');
const { room, scenes } = JSON.parse(fs.readFileSync(path.join(SC, 'meta.json'), 'utf8'));
const b64 = f => 'data:image/png;base64,' + fs.readFileSync(path.join(SC, f)).toString('base64');

const CSS = `
@font-face{font-family:P;src:url(data:font/woff2;base64,${FONT}) format('woff2');font-weight:100 900}
*{box-sizing:border-box;margin:0}
body{width:1920px;height:1080px;font-family:P,sans-serif;color:#fff;background:radial-gradient(ellipse at 30% 0%,#1b2a52 0%,#0b1226 60%);position:relative;overflow:hidden}
.top{position:absolute;left:0;right:0;top:0;height:110px;display:flex;align-items:center;gap:24px;padding:0 60px}
.badge{background:#facc15;color:#1a1a1a;font-weight:900;font-size:34px;padding:8px 26px;border-radius:999px}
.title{font-weight:900;font-size:50px}
.tag{margin-left:auto;font-size:26px;color:#94a3b8;font-weight:700}
.shot{position:absolute;border-radius:16px;overflow:hidden;box-shadow:0 14px 50px rgba(0,0,0,.55);border:2px solid #334155}
.shot img{display:block;width:100%;height:100%}
.lab{position:absolute;font-size:24px;font-weight:800;color:#94a3b8}
.phone{border-radius:34px;border:6px solid #475569}
.cap{position:absolute;left:0;right:0;bottom:0;height:170px;background:rgba(2,6,23,.88);border-top:2px solid #334155;display:flex;align-items:center;justify-content:center;padding:0 120px;text-align:center;font-size:42px;font-weight:700;line-height:1.45;word-break:keep-all}
.card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:30px;padding:0 160px}
.card h1{font-size:96px;font-weight:900;color:#facc15;line-height:1.2}
.card h2{font-size:48px;font-weight:700}
.card p{font-size:36px;color:#cbd5e1;line-height:1.6}
.tips{display:grid;grid-template-columns:1fr 1fr;gap:22px 40px;text-align:left;margin-top:10px}
.tip{background:rgba(30,41,59,.9);border:2px solid #334155;border-radius:18px;padding:22px 30px;font-size:32px;line-height:1.45;font-weight:600}
.tip b{color:#facc15}
`;

function sceneHtml(s) {
  const top = `<div class="top"><span class="badge">STEP ${s.step}</span><span class="title">${s.title}</span><span class="tag">《원더》 독서 골든벨 사용법</span></div>`;
  let body = '';
  if (s.teacher && s.phone) {
    body = `<div class="shot" style="left:60px;top:130px;width:1280px;height:720px"><img src="${b64(s.id + '-t.png')}"></div>
      <div class="shot phone" style="left:1480px;top:122px;width:360px;height:780px"><img src="${b64(s.id + '-p.png')}"></div>
      <div class="lab" style="left:64px;top:858px">🖥️ 교사 화면(전자칠판)</div><div class="lab" style="left:1500px;top:922px;display:none"></div>`;
  } else {
    body = `<div class="shot" style="left:267px;top:125px;width:1386px;height:780px"><img src="${b64(s.id + '-t.png')}"></div>`;
  }
  return `<style>${CSS}</style>${top}${body}<div class="cap">${s.caption}</div>`;
}

const intro = `<style>${CSS}</style><div class="card">
  <h1>《원더》 독서 골든벨</h1><h2>교사용 사용 안내 영상</h2>
  <p>교사 컴퓨터(전자칠판) 1대와 학생 휴대폰, 인터넷만 있으면 됩니다.<br>실제 앱 화면으로 입장부터 종료까지 12단계로 안내합니다.</p></div>`;

const outro = `<style>${CSS}</style><div class="card" style="gap:22px">
  <h1 style="font-size:72px">수업 운영 팁</h1>
  <div class="tips">
    <div class="tip"><b>[Space]</b> 정답 공개 / 다음 문제<br><b>[H]</b> 힌트 · <b>[P]</b> 일시정지 · <b>[F]</b> 전체화면</div>
    <div class="tip">학생이 중간에 나갔다가 같은 학반번호로 다시 들어오면 <b>점수가 그대로 이어집니다.</b></div>
    <div class="tip"><b>🆕 새 방</b> : 명단과 점수를 지우고 새 방 번호로 시작해요.</div>
    <div class="tip"><b>🔓/🔒 입장 잠금</b> : 새 학생의 입장을 막아요.<br>(이미 들어온 학생의 재접속은 허용)</div>
  </div>
  <p style="margin-top:6px">성적 저장(구글시트 연동)은 <b style="color:#facc15">구글시트_연동_방법.md</b>를 참고하세요.</p></div>`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const frames = [{ name: 'f00', html: intro, dur: 6 }];
  scenes.forEach(s => frames.push({ name: 'f' + s.id, html: sceneHtml(s), dur: Math.max(6, Math.ceil(s.caption.length / 6) + 2) }));
  frames.push({ name: 'f99', html: outro, dur: 12 });

  for (const f of frames) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><body>${f.html}</body>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(FR, f.name + '.png') });
  }
  await browser.close();

  const clips = [];
  for (const f of frames) {
    const clip = path.join(FR, f.name + '.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-t', String(f.dur), '-i', path.join(FR, f.name + '.png'),
      '-vf', `fade=in:0:10,fade=out:st=${f.dur - 0.4}:d=0.4,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', clip]);
    clips.push(clip);
  }
  const list = path.join(FR, 'list.txt');
  fs.writeFileSync(list, clips.map(c => `file '${c}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', OUT]);
  console.log('done', OUT, frames.reduce((a, f) => a + f.dur, 0) + 's', 'room', room);
})().catch(e => { console.error(e); process.exit(1); });
