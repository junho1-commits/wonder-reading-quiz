const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const context = { window: {} };
vm.runInNewContext(read('questions.js'), context);
vm.runInNewContext(read('quiz-utils.js'), context);
const { isCorrectAnswer, normalizeAnswer } = context.window.QuizUtils;
const sets = context.window.QUESTION_SETS;
const questions = sets.find(s => s.id === 'reading30').questions;
assert.equal(questions.length, 30);
assert.deepEqual(JSON.parse(JSON.stringify(questions)), JSON.parse(read('questions.json')));
assert.equal(questions.filter(q => q.type === 'short').length, 23);
assert.equal(questions.filter(q => q.type === 'ox').length, 1);
assert.equal(questions.filter(q => q.type === 'choice').length, 6);
for (const set of sets) {
  set.questions.forEach((q, i) => {
    assert.equal(q.id, i + 1);
    assert.ok(q.question && q.explanation && q.timeLimit > 0);
    assert.ok(isCorrectAnswer(q, q.answer), `${set.id} ${q.id} 대표 정답`);
    assert.equal(isCorrectAnswer(q, null), false);
    assert.equal(isCorrectAnswer(q, ''), false);
    if (q.type === 'short') {
      assert.ok(isCorrectAnswer(q, q.answer.replace(/\s/g, '')), `${q.id} 공백 제거`);
      assert.ok(isCorrectAnswer(q, [...q.answer.normalize('NFD')].join(' \t\n')), `${q.id} 공백·한글 정규화`);
      for (const answer of q.acceptedAnswers || []) assert.ok(isCorrectAnswer(q, answer), `${q.id} 인정 답안`);
    } else {
      assert.equal(isCorrectAnswer(q, String(q.answer)), false);
      assert.equal(isCorrectAnswer(q, q.answer === 1 ? 2 : 1), false);
    }
  });
}
const q = id => questions[id - 1];
assert.ok(isCorrectAnswer(q(1), '흰 바위코 뿔소'));
assert.equal(isCorrectAnswer(q(1), '코뿔소'), false);
assert.equal(isCorrectAnswer(q(1), '흰바위코뿔소아님'), false);
assert.ok(isCorrectAnswer(q(7), '헬멧'));
assert.ok(isCorrectAnswer(q(29), 'ＵＮＤＥＲＳＴＵＤＹ'));
assert.equal(normalizeAnswer(' \u200b，.'), '');
assert.equal(isCorrectAnswer(q(16), '코딱지, 눈곱'), false);
assert.ok(isCorrectAnswer(q(16), '눈곱 / 코딱지'));
assert.equal(isCorrectAnswer(q(27), '펭귄, 코뿔소'), false);
assert.ok(isCorrectAnswer(q(27), '코뿔소 와 펭귄'));
assert.ok(isCorrectAnswer(q(18), '샬럿, 줄리언, 잭윌'));
assert.ok(isCorrectAnswer(q(18), '줄리안과 잭 윌 그리고 샬롯'));
assert.equal(isCorrectAnswer(q(18), '잭 윌, 줄리안'), false);
assert.equal(isCorrectAnswer(q(18), '잭 윌, 줄리안, 샬롯, 미란다'), false);
assert.equal(isCorrectAnswer(q(18), '잭 윌, 잭 윌, 샬롯'), false);
// HTML 내 실제 실행 스크립트도 문법 검사합니다.
for (const name of ['teacher.html', 'student.html']) {
  for (const match of read(name).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], { filename: name });
  }
  assert.ok(read(name).includes('src="quiz-utils.js"'));
}
console.log('PASS: 100문제 데이터, 단답형 대체 답안·공백·순서, 기존 객관식, HTML 스크립트 문법');
