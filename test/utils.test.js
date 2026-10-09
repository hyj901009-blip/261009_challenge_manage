import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO, addDays, diffDays, dateRange, weekStart, monthEnd, periodWeeks, periodMonths, computeProgress,
  normalizeLoginId, validateLoginId, validatePassword, normalizeUrl, visitSeries, seriesStats, isISODate, shortDate
} from '../js/utils.js';

test('KST 기준 오늘 — UTC 15시 이후는 다음 날', () => {
  assert.equal(todayISO('Asia/Seoul', new Date('2026-10-09T14:59:00Z')), '2026-10-09');
  assert.equal(todayISO('Asia/Seoul', new Date('2026-10-09T15:00:00Z')), '2026-10-10');
});

test('날짜 연산', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(diffDays('2026-10-01', '2026-10-09'), 8);
  assert.equal(dateRange('2026-10-30', '2026-11-02').length, 4);
  assert.equal(weekStart('2026-10-09'), '2026-10-05'); // 금 → 월
  assert.equal(weekStart('2026-10-11'), '2026-10-05'); // 일 → 같은 주 월
  assert.equal(monthEnd('2028-02-10'), '2028-02-29');
  assert.equal(shortDate('2026-10-09'), '10/9(금)');
  assert.ok(isISODate('2026-10-09'));
  assert.ok(!isISODate('2026-02-30'));
});

test('부분 주·월은 목표를 비례 배분', () => {
  // 2026-10-07(수) ~ 2026-10-31(토)
  const w = periodWeeks('2026-10-07', '2026-10-31', 5);
  assert.equal(w[0].from, '2026-10-07');
  assert.equal(w[0].to, '2026-10-11');
  assert.equal(w[0].goal, Math.ceil(5 * 5 / 7)); // 5일 걸침 → 4
  assert.equal(w[1].goal, 5);
  assert.equal(w.at(-1).to, '2026-10-31');
  const m = periodMonths('2026-10-15', '2026-11-14', 20);
  assert.equal(m.length, 2);
  assert.equal(m[0].label, '10월');
  assert.equal(m[0].goal, Math.ceil(20 * 17 / 31));
});

test('진척 계산 — 데일리/위클리/먼슬리, 연속, 달성률', () => {
  const cohort = { startDate: '2026-10-05', endDate: '2026-11-01', goals: { daily: 1, weekly: 5, monthly: 20 } };
  const posts = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-08', '2026-10-09', '2026-09-30']
    .map((postDate) => ({ postDate }));
  const pr = computeProgress(cohort, posts, '2026-10-09');
  assert.equal(pr.valid, true);
  assert.equal(pr.phase, 'running');
  assert.equal(pr.dayNumber, 5);
  assert.equal(pr.totalPosts, 6); // 기간 밖 9/30 제외
  assert.deepEqual([pr.daily.count, pr.daily.done], [1, true]);
  assert.deepEqual([pr.weekly.count, pr.weekly.goal, pr.weekly.done], [6, 5, true]);
  assert.equal(pr.monthly.label, '10월');
  assert.equal(pr.monthly.count, 6);
  assert.equal(pr.streak, 5);
  assert.equal(pr.rate, 100);
  assert.equal(pr.days.length, 28);
});

test('오늘 아직 안 썼으면 어제까지로 연속·달성률 계산', () => {
  const cohort = { startDate: '2026-10-05', endDate: '2026-11-01', goals: { daily: 1 } };
  const posts = ['2026-10-06', '2026-10-07', '2026-10-08'].map((postDate) => ({ postDate }));
  const pr = computeProgress(cohort, posts, '2026-10-09');
  assert.equal(pr.daily.done, false);
  assert.equal(pr.streak, 3);
  assert.equal(pr.elapsedDays, 4);
  assert.equal(pr.rate, 75);
});

test('기간 전/후', () => {
  const cohort = { startDate: '2026-11-01', endDate: '2026-11-07', goals: {} };
  const before = computeProgress(cohort, [], '2026-10-09');
  assert.equal(before.phase, 'before');
  assert.equal(before.elapsedDays, 0);
  assert.equal(before.streak, 0);
  const after = computeProgress(cohort, [{ postDate: '2026-11-06' }, { postDate: '2026-11-07' }], '2026-12-01');
  assert.equal(after.phase, 'after');
  assert.equal(after.streak, 2);
  assert.equal(after.elapsedDays, 7);
  assert.equal(computeProgress({ startDate: '', endDate: '' }, [], '2026-10-09').valid, false);
});

test('아이디·비밀번호 검증', () => {
  assert.equal(normalizeLoginId('  홍길동 '), '홍길동');
  assert.equal(normalizeLoginId('ABC'), 'abc');
  assert.equal(validateLoginId('홍길동'), '');
  assert.equal(validateLoginId('blog_123'), '');
  assert.ok(validateLoginId('홍 길동'));
  assert.ok(validateLoginId('a'));
  assert.ok(validatePassword('12345'));
  assert.equal(validatePassword('123456'), '');
});

test('URL 정리', () => {
  assert.equal(normalizeUrl('blog.naver.com/abc/123'), 'https://blog.naver.com/abc/123');
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
  assert.equal(normalizeUrl(''), '');
});

test('방문자 시계열과 요약', () => {
  const visits = [{ date: '2026-10-01', count: 10 }, { date: '2026-10-03', count: 30 }, { date: '2026-10-03', count: 5 }];
  const s = visitSeries(visits, '2026-10-01', '2026-10-04');
  assert.deepEqual(s.map((p) => p.value), [10, null, 35, null]);
  const st = seriesStats(s);
  assert.deepEqual([st.last, st.prev, st.delta, st.avg, st.max, st.n], [35, 10, 25, 23, 35, 2]);
  assert.equal(seriesStats([]).last, null);
});

test('네이버 블로그 아이디 추출', async () => {
  const { naverBlogId } = await import('../js/utils.js');
  assert.equal(naverBlogId('https://blog.naver.com/MyBlog_01'), 'myblog_01');
  assert.equal(naverBlogId('blog.naver.com/hong/223456789'), 'hong');
  assert.equal(naverBlogId('https://m.blog.naver.com/hong/223456789'), 'hong');
  assert.equal(naverBlogId('https://blog.naver.com/PostView.naver?blogId=hong&logNo=1'), 'hong');
  assert.equal(naverBlogId('https://hong.blog.me'), 'hong');
  assert.equal(naverBlogId('https://blog.naver.com/PostList.naver'), '');
  assert.equal(naverBlogId('https://tistory.com/hong'), '');
  assert.equal(naverBlogId(''), '');
});

test('네이버 방문자 XML 파싱', async () => {
  const { parseNaverVisitors } = await import('../js/utils.js');
  const xml = `<?xml version="1.0" encoding="utf-8"?><visitorcnts>
    <visitorcnt id="20261008" cnt="88" /><visitorcnt cnt="120" id="20261007"/>
    <visitorcnt id="20261009" cnt="5" /><visitorcnt id="bad" cnt="1"/></visitorcnts>`;
  assert.deepEqual(parseNaverVisitors(xml), [
    { date: '2026-10-07', count: 120 }, { date: '2026-10-08', count: 88 }, { date: '2026-10-09', count: 5 }
  ]);
  assert.deepEqual(parseNaverVisitors('<html>error</html>'), []);
});
