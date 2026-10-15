const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const questions = JSON.parse(fs.readFileSync('questions.json', 'utf8'));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  const errors = [];
  // 테스트 학생 정보가 실제 MQTT나 구글시트에 전송되지 않도록 모두 격리합니다.
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.includes('mqtt.min.js')) return route.fulfill({ contentType: 'application/javascript', body: `
      window.__messages=[]; window.__handlers={};
      window.mqtt={ connect(){ const client={connected:true,options:{},subscribe(){},
        publish(topic,payload){window.__messages.push({topic,data:JSON.parse(payload)});},
        on(event,handler){window.__handlers[event]=handler;}, reconnect(){}};
        window.__testClient=client; return client; }};` });
    if (url.includes('qrcode.min.js')) return route.fulfill({ contentType: 'application/javascript', body: 'window.QRCode=function(){}; QRCode.CorrectLevel={M:0};' });
    if (url.startsWith('http://quiz.test/')) {
      const file = new URL(url).pathname.slice(1);
      if (!['teacher.html','student.html','questions.js','quiz-utils.js'].includes(file)) return route.abort();
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8'});
    }
    return route.abort();
  });
  const teacher = await context.newPage();
  teacher.on('pageerror', e => errors.push(e.message));
  await teacher.goto('http://quiz.test/teacher.html?set=reading30');
  await teacher.waitForFunction(() => window.__testClient);
  if (process.env.QUIZ_LAYOUT_ONLY) {
    for(const viewport of [{width:1280,height:720},{width:1440,height:1000}]) {
      await teacher.setViewportSize(viewport);
      for(let index=0;index<questions.length;index++) for(const status of ['question','answer']) {
        await teacher.evaluate(({index,status})=>{gameState.currentQIndex=index;gameState.status=status;updateUI();},{index,status});
        const controls=await teacher.locator(status==='answer'?'#btnNext':'#btnReveal').boundingBox();
        assert.ok(controls.y+controls.height<=viewport.height,`제어 버튼: ${index+1} ${status}`);
        if(status==='answer' && questions[index].type!=='short') {
          const lastOption=await teacher.locator('#optCard'+questions[index].options.length).boundingBox();
          const explanation=await teacher.locator('#explanationDrawer').boundingBox();
          assert.ok(lastOption.y+lastOption.height<=explanation.y,`보기와 해설 겹침: ${index+1} ${viewport.width}`);
        }
        if(index===16&&status==='answer'&&viewport.width===1280)
          await teacher.screenshot({path:'tests/screenshots/teacher-small-screen.png',fullPage:true});
      }
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: 30문제 × 풀이/정답 × 전자칠판 2개 크기에서 제어 버튼과 보기·해설 배치');
    await browser.close();
    return;
  }
  // 실제 UI 함수·제출 처리·채널 데이터를 검사하며 외부 기록은 전송하지 않습니다.
  await teacher.evaluate(() => { scheduleSheetSync = () => {}; });
  await teacher.evaluate(() => handleStudentJoin({grade:6,cls:2,num:1,name:'테스트'}));
  teacher.on('dialog', d => d.accept());
  await teacher.locator('#startBtn').click();
  assert.equal(await teacher.locator('#shortAnswerPanel').isVisible(), true);
  assert.equal(await teacher.locator('#optionsGrid').isVisible(), false);
  assert.equal(await teacher.locator('#shortAnswerResult').isVisible(), false);
  const getPayload = () => teacher.evaluate(() => window.__messages.filter(m => m.topic.endsWith('/state')).at(-1).data);
  let state = await getPayload();
  assert.equal(state.question.answer, null);
  assert.equal(state.question.acceptedAnswers, undefined);
  assert.equal(state.question.answerGroups, undefined);
  const student = await context.newPage();
  student.on('pageerror', e => errors.push(e.message));
  await student.setViewportSize({width:390,height:844});
  await student.goto('http://quiz.test/student.html?room=123456');
  await student.locator('#gradeInput').fill('6');
  await student.locator('#clsInput').fill('2');
  await student.locator('#numInput').fill('1');
  await student.locator('#nameInput').fill('테스트');
  await student.evaluate(() => joinGame());
  const deliver = payload => student.evaluate(s => { lastState = s; handleTeacherState(s); }, payload);
  await deliver(state);
  assert.equal(await student.locator('#shortAnswerForm').isVisible(), true);
  await student.locator('#shortAnswerInput').fill('흰 바위코 뿔소');
  await student.locator('#shortAnswerSubmit').click();
  const submission = await student.evaluate(() => window.__messages.filter(m=>m.topic.endsWith('/submit')).at(-1).data);
  assert.equal(submission.choice, '흰 바위코 뿔소');
  assert.equal(await student.locator('#shortAnswerInput').isDisabled(), true);
  await teacher.evaluate(data => handleStudentSubmit(data), submission);
  await teacher.locator('#btnReveal').click();
  state = await getPayload();
  await deliver(state);
  assert.equal(await teacher.evaluate(() => gameState.students['6-2-1'].score), 1);
  assert.equal(await student.locator('#resultTitle').innerText(), '정답입니다!');
  assert.ok((await student.locator('#resultSub').innerText()).includes('흰바위 코뿔소'));
  // 같은 문제에 다시 제출해도 교사 기록이 바뀌지 않음.
  await teacher.evaluate(data => handleStudentSubmit({...data,choice:'오답'}), submission);
  assert.equal(await teacher.evaluate(() => gameState.currentAnswers['6-2-1']), '흰 바위코 뿔소');
  fs.mkdirSync('tests/screenshots', {recursive:true});
  await teacher.screenshot({path:'tests/screenshots/teacher-short-answer.png',fullPage:true});
  // 나머지 29문제도 실제 공개·전환·입력 표시와 채점을 모두 통과해야 합니다.
  for (let i=1;i<questions.length;i++) {
    await teacher.locator('#btnNext').click();
    state = await getPayload();
    await deliver(state);
    const q=questions[i];
    if(i===16) await teacher.screenshot({path:'tests/screenshots/teacher-long-question.png',fullPage:true});
    const bottom=await teacher.locator('#btnReveal').boundingBox();
    assert.ok(bottom.y+bottom.height<=1000, `문제 ${i+1}: 제어 버튼이 화면 안에 표시`);
    if(q.type==='short') {
      assert.equal(await student.locator('#shortAnswerInput').inputValue(), '');
      assert.equal(await student.locator('#shortAnswerInput').isDisabled(), false);
      if(i===17) await student.locator('#shortAnswerInput').fill('샬럿과 잭 윌 그리고 줄리안');
      else await student.locator('#shortAnswerInput').fill(q.answer.replace(/\s/g,''));
      if(i===26) await student.screenshot({path:'tests/screenshots/student-short-answer.png',fullPage:true});
      await student.locator('#shortAnswerSubmit').click();
    } else {
      assert.equal(await student.locator('#shortAnswerForm').isVisible(), false);
      assert.equal(await student.locator('#btnOpt4').isVisible(), q.options.length===4);
      await student.locator('#btnOpt'+q.answer).click();
    }
    const data=await student.evaluate(()=>window.__messages.filter(m=>m.topic.endsWith('/submit')).at(-1).data);
    await teacher.evaluate(data=>handleStudentSubmit(data),data);
    await teacher.locator('#btnReveal').click();
    await deliver(await getPayload());
    assert.equal(await student.locator('#resultTitle').innerText(),'정답입니다!',`문제 ${i+1}`);
  }
  assert.equal(await teacher.evaluate(()=>gameState.students['6-2-1'].score),30);
  // 새로 접속한 학생의 단답형 제출 내용 복구.
  await teacher.evaluate(() => { gameState.currentQIndex=0; gameState.status='question'; gameState.currentAnswers={'6-2-1':'흰바위코뿔소'}; broadcastState(); sendPrivate('6-2-1'); });
  await deliver(await getPayload());
  await student.evaluate(() => { myChoice=null; handlePrivate({name:'테스트',score:30,qIndex:0,choice:'흰바위코뿔소'}); });
  assert.equal(await student.locator('#shortAnswerInput').inputValue(),'흰바위코뿔소');
  assert.equal(await student.locator('#shortAnswerSubmit').isDisabled(),true);
  // 기존 객관식 세트의 보기, 공개, 점수도 유지.
  await teacher.evaluate(()=>{gameState.status='lobby';applySet('wonder',true);gameState.status='question';gameState.currentAnswers={};broadcastState();updateUI();});
  await student.evaluate(()=>{myChoice=null;serverChoice=null;currentQIdx=-1;});
  await deliver(await getPayload());
  await student.locator('#btnOpt3').click();
  const oldData=await student.evaluate(()=>window.__messages.filter(m=>m.topic.endsWith('/submit')).at(-1).data);
  await teacher.evaluate(data=>handleStudentSubmit(data),oldData);
  await teacher.locator('#btnReveal').click();
  await deliver(await getPayload());
  assert.equal(await student.locator('#resultTitle').innerText(),'정답입니다!');
  assert.equal(await teacher.evaluate(()=>gameState.students['6-2-1'].score),31);
  await teacher.locator('#btnNext').click();
  await deliver(await getPayload());
  await student.locator('#btnOpt1').click();
  const wrongData=await student.evaluate(()=>window.__messages.filter(m=>m.topic.endsWith('/submit')).at(-1).data);
  await teacher.evaluate(data=>handleStudentSubmit(data),wrongData);
  await teacher.locator('#btnReveal').click();
  await deliver(await getPayload());
  assert.equal(await student.locator('#resultTitle').innerText(),'아쉬워요!');
  assert.equal(await teacher.evaluate(()=>gameState.students['6-2-1'].score),31);
  // 작은 전자칠판에서도 긴 문제와 정답 공개 뒤 제어 버튼이 화면 안에 표시됩니다.
  await teacher.setViewportSize({width:1280,height:720});
  await teacher.evaluate(()=>{applySet('reading30',true);gameState.currentQIndex=16;gameState.status='answer';updateUI();});
  const smallBottom=await teacher.locator('#btnNext').boundingBox();
  assert.ok(smallBottom.y+smallBottom.height<=720,'작은 전자칠판의 다음 문제 버튼');
  await teacher.screenshot({path:'tests/screenshots/teacher-small-screen.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: 브라우저에서 30문제 진행·정답 30점, 모바일 입력, OX, 이름 순서, 재접속 복구, 정답 공개 전 비노출, 기존 객관식');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
