/**
 * 독서 골든벨 - 구글시트 자동 저장 (Apps Script 웹앱)
 * 사용법은 '구글시트_연동_방법.md' 참고.
 *
 * - 교사 화면이 학생 명단/점수를 보내면 '성적표' 시트에 저장합니다.
 * - 같은 회차(날짜_방번호_퀴즈)는 해당 회차 행만 통째로 교체하므로 중복 행이 쌓이지 않습니다.
 * - 다른 회차(다른 날/다른 방/다른 퀴즈)의 기록은 그대로 보존됩니다.
 * - 퀴즈마다 문제 수가 달라도(30/10/10) 한 시트에 함께 쌓입니다.
 */
const SHEET_NAME = '성적표';
const FIXED_HEADER = ['회차', '퀴즈', '학년', '반', '번호', '이름', '총점', '갱신시각'];

function doGet(e) {
  // 교사 화면의 '연결 테스트'용
  return json_({ ok: true, msg: '골든벨 시트 연동 정상' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const d = JSON.parse(e.postData.contents);
    const qn = d.questionCount || 20;
    const fixed = FIXED_HEADER.length;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SHEET_NAME);

    // 예전 형식(고정 열 구성이 다른 시트)이면 이름을 바꿔 보관하고 새로 만든다
    if (sh && sh.getLastRow() > 0 && String(sh.getRange(1, 2).getValue()) !== FIXED_HEADER[1]) {
      sh.setName(SHEET_NAME + '_이전형식_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'MMdd_HHmm'));
      sh = null;
    }
    if (!sh) sh = ss.insertSheet(SHEET_NAME);

    // 기존 행 중 다른 회차는 보존
    let keep = [];
    let maxQ = qn;
    const last = sh.getLastRow();
    if (last > 1) {
      const lastCol = sh.getLastColumn();
      maxQ = Math.max(qn, lastCol - fixed);
      keep = sh.getRange(2, 1, last - 1, lastCol).getValues()
        .filter(r => String(r[0]) !== String(d.session));
    }

    const width = fixed + maxQ;
    const header = FIXED_HEADER.slice();
    for (let i = 1; i <= maxQ; i++) header.push('Q' + i);

    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    const fresh = (d.students || []).map(s =>
      [d.session, d.quiz || '', s.grade, s.cls, s.num, s.name, s.score, now].concat(s.answers)
    );

    const rows = keep.concat(fresh).map(r => {
      const row = r.slice(0, width);
      while (row.length < width) row.push('');
      return row;
    });

    sh.clearContents();
    sh.getRange(1, 1, 1, width).setValues([header]).setFontWeight('bold').setBackground('#e0e7ff');
    if (rows.length) {
      sh.getRange(2, 1, rows.length, 1).setNumberFormat('@'); // 회차는 문자열로 유지
      sh.getRange(2, 1, rows.length, width).setValues(rows);
    }
    sh.setFrozenRows(1);
    sh.setFrozenColumns(6);

    return json_({ ok: true, saved: fresh.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
