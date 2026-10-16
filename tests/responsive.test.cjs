const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const questions = JSON.parse(fs.readFileSync('questions.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext();
  context.setDefaultTimeout(10000);
  const errors = [];
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.includes('mqtt.min.js')) return route.fulfill({contentType:'application/javascript',body:`
      window.__messages=[];window.mqtt={connect(){return {connected:true,options:{},subscribe(){},
        on(){},publish(topic,payload){window.__messages.push({topic,data:JSON.parse(payload)});}};}};`});
    if (url.includes('qrcode.min.js')) return route.fulfill({contentType:'application/javascript',body:`
      window.QRCode=function(el,options){window.__qrText=options.text;
        el.innerHTML='<canvas width="240" height="240" aria-label="QR code"></canvas>';};QRCode.CorrectLevel={M:0};`});
    if (url.startsWith('http://quiz.test/') || url.startsWith('file:')) {
      const file = url.startsWith('file:') ? path.basename(fileURLToPath(url)) : new URL(url).pathname.slice(1);
      if (!['teacher.html','student.html','questions.js','quiz-utils.js'].includes(file)) return route.abort();
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8'});
    }
    return route.abort(); // 외부 브로커·구글시트로 테스트 정보가 전송되지 않습니다.
  });
  fs.mkdirSync('tests/screenshots', {recursive:true});
  const teacher=await context.newPage();
  teacher.on('pageerror',e=>errors.push(e.message));
  await teacher.goto('http://quiz.test/teacher.html?set=reading30');
  await teacher.waitForFunction(()=>window.__qrText);
  for (const viewport of [{width:1920,height:912},{width:1280,height:720},{width:1366,height:650}]) {
    await teacher.setViewportSize(viewport);
    await teacher.evaluate(()=>{gameState.status='lobby';updateUI();});
    for(const selector of ['#qrCanvasContainer','#joinPinText','#setPicker','#startBtn']) {
      const box=await teacher.locator(selector).boundingBox();
      assert.ok(box.y>=72&&box.y+box.height<=viewport.height,`${selector} 대기실 잘림: ${viewport.width}`);
    }
    const layout=await teacher.evaluate(()=>({x:document.documentElement.scrollWidth,w:innerWidth}));
    assert.ok(layout.x<=layout.w,'교사 대기실 가로 넘침');
    if(viewport.width===1920) await teacher.screenshot({path:'tests/screenshots/teacher-lobby-responsive.png'});
    for(const index of questions.map((_,i)=>i)) for(const status of ['question','answer']) {
      await teacher.evaluate(({index,status})=>{gameState.currentQIndex=index;gameState.status=status;updateUI();},{index,status});
      const control=await teacher.locator(status==='question'?'#btnReveal':'#btnNext').boundingBox();
      assert.ok(control.y+control.height<=viewport.height,`교사 제어 버튼 잘림: ${index+1} ${status} ${viewport.width}`);
      if(index===13&&status==='question') {
        const sizes=await teacher.locator('.option-text').evaluateAll(els=>els.map(el=>parseFloat(getComputedStyle(el).fontSize)));
        assert.ok(sizes.every(size=>size>=48),'교사 선지 글자 확대');
        for(let i=1;i<=4;i++) {
          const box=await teacher.locator('#optCard'+i).boundingBox();
          assert.ok(box.y+box.height<=control.y,'교사 기본 문제의 네 보기 표시');
        }
        if(viewport.width===1920) await teacher.screenshot({path:'tests/screenshots/teacher-options-large.png'});
      }
      if(status==='answer'&&index!==26) {
        const result=await teacher.evaluate(()=>{
          const grid=document.getElementById('optionsGrid'),exp=document.getElementById('explanationDrawer');
          return {bottom:grid.getBoundingClientRect().bottom,top:exp.getBoundingClientRect().top};
        });
        assert.ok(result.bottom<=result.top,'교사 보기와 해설 겹침');
      }
      if(status==='answer'&&(index===13||index===16)) {
        const boxes=await teacher.evaluate(()=>({grid:document.getElementById('optionsGrid').getBoundingClientRect().bottom,
          height:document.getElementById('optionsGrid').clientHeight,rows:getComputedStyle(document.getElementById('optionsGrid')).gridTemplateRows,
          options:[1,2,3,4].map(i=>document.getElementById('optCard'+i).getBoundingClientRect().bottom)}));
        assert.ok(boxes.options.every(bottom=>bottom<=boxes.grid+1),`교사 짧은 선지 네 개 모두 표시: ${index+1} ${viewport.width} ${JSON.stringify(boxes)}`);
      }
    }
  }
  const localTeacher=await context.newPage();
  await localTeacher.goto(pathToFileURL(path.resolve('teacher.html')).href);
  await localTeacher.waitForFunction(()=>window.__qrText);
  assert.ok((await localTeacher.evaluate(()=>window.__qrText)).startsWith('https://junho1-commits.github.io/wonder-reading-quiz/student.html?room='),'로컬 파일에서도 학생용 공개 주소 QR 생성');

  const student=await context.newPage();
  student.on('pageerror',e=>errors.push(e.message));
  await student.goto('http://quiz.test/student.html');
  async function show(index,extra={}) {
    const q=questions[index];
    await student.evaluate(state=>{serverChoice=null;lastState=state;handleTeacherState(state);}, {
      status:'question',currentQIndex:index,timerRemaining:30,setTitle:'독서 골든벨',
      question:{...q,answer:null,acceptedAnswers:undefined,answerGroups:undefined,totalQuestions:30,...extra}
    });
    await student.evaluate(()=>document.querySelector('main').scrollTop=0);
  }
  for(const viewport of [{width:800,height:1100},{width:1280,height:650},{width:1024,height:600},{width:390,height:844}]) {
    await student.setViewportSize(viewport);
    await show(13);
    const sizes=await student.locator('.btn-text').evaluateAll(els=>els.map(el=>parseFloat(getComputedStyle(el).fontSize)));
    assert.ok(sizes.every(size=>size>=26),'학생 선지 글자 확대');
    for(let i=1;i<=4;i++) {
      const box=await student.locator('#btnOpt'+i).boundingBox();
      assert.ok(box.y>=0&&box.y+box.height<=viewport.height,`학생 기본 문제 선지 ${i} 잘림: ${viewport.width}×${viewport.height}`);
      const textBox=await student.locator('#btnText'+i).boundingBox();
      assert.ok(textBox.y>=box.y&&textBox.y+textBox.height<=box.y+box.height,'선지 글자와 버튼 영역 일치');
    }
    if(viewport.width===800||viewport.width===1280) await student.screenshot({path:`tests/screenshots/student-tablet-${viewport.width}.png`});
    // 길어진 선지도 생략하지 않으며, 필요하면 세로로 스크롤해 네 버튼 모두 접근할 수 있습니다.
    await show(13,{options:Array(4).fill('책 속 인물의 마음과 행동을 자세히 설명하는 아주 긴 선지입니다. '.repeat(3))});
    for(let i=1;i<=4;i++) {
      await student.locator('#btnOpt'+i).scrollIntoViewIfNeeded();
      const text=await student.locator('#btnText'+i).evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,clamp:getComputedStyle(el).webkitLineClamp}));
      assert.ok(text.scroll<=text.height+1&&text.clamp==='none','긴 선지 글자 생략 방지');
    }
    await show(26);
    await student.locator('#shortAnswerSubmit').scrollIntoViewIfNeeded();
    assert.equal(await student.locator('#shortAnswerSubmit').isVisible(),true,'단답형 제출 버튼 접근');
    const width=await student.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert.ok(width.body<=width.viewport,'학생 화면 가로 넘침 방지');
  }
  // 브라우저 주소창이나 화면 회전으로 가용 높이가 줄어도 마지막 보기에 접근 가능합니다.
  await student.setViewportSize({width:800,height:400});
  await show(13);
  await student.locator('#btnOpt4').scrollIntoViewIfNeeded();
  const bottom=await student.locator('#btnOpt4').boundingBox();
  const scroll=await student.evaluate(()=>{const main=document.querySelector('main');return {top:main.scrollTop,height:main.clientHeight,scroll:main.scrollHeight,viewport:innerHeight};});
  await student.screenshot({path:'tests/screenshots/student-small-height.png'});
  assert.ok(bottom.y+bottom.height<=401,`작은 높이에서 스크롤로 마지막 선지 접근: ${JSON.stringify({bottom,scroll})}`);
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS: 교사 대기실·큰 선지·진행 버튼, 태블릿 가로/세로·높이 변경·긴 선지·단답형, 로컬 QR');
})().catch(error=>{console.error(error);process.exit(1);});
