/* 교사와 학생 화면이 같은 규칙으로 채점합니다. 정답 정보는 공개 시에만 전송합니다. */
(function (root) {
  'use strict';
  function normalizeAnswer(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase()
      .replace(/[\s\u200B-\u200D\uFEFF\p{P}]/gu, '').normalize('NFKC');
  }

  function isShortAnswer(q) { return q.type === 'short'; }

  function matchesGroups(input, groups, ordered) {
    if (!groups.length) return input === '';
    const indices = ordered ? [0] : groups.map((_, i) => i);
    return indices.some(i => groups[i].some(alias => {
      const word = normalizeAnswer(alias);
      if (!word || !input.startsWith(word)) return false;
      const remaining = groups.filter((_, j) => j !== i);
      const rest = input.slice(word.length);
      if (!remaining.length) return rest === '';
      return ['', '와', '과', '및', '그리고', '하고'].some(separator =>
        rest.startsWith(separator) && matchesGroups(rest.slice(separator.length), remaining, ordered));
    }));
  }

  function isCorrectAnswer(q, choice) {
    if (!isShortAnswer(q)) return Number.isInteger(choice) && choice === q.answer;
    if (typeof choice !== 'string') return false;
    const input = normalizeAnswer(choice);
    if (!input) return false;
    if ([q.answer, ...(q.acceptedAnswers || [])].some(a => normalizeAnswer(a) === input)) return true;
    return !!q.answerGroups && matchesGroups(input, q.answerGroups, q.ordered !== false);
  }

  function answerLabel(q) {
    return isShortAnswer(q) ? q.answer : `${q.answer}번 · ${q.options[q.answer - 1]}`;
  }

  root.QuizUtils = { normalizeAnswer, isShortAnswer, isCorrectAnswer, answerLabel };
})(typeof window !== 'undefined' ? window : globalThis);
