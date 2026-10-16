import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO, addDays, diffDays, dateRange, weekStart, monthEnd, periodWeeks, computeProgress, normalizeGoals, rankRows,
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

test('부분 주는 목표를 비례 배분', () => {
  // 2026-10-07(수) ~ 2026-10-31(토)
  const w = periodWeeks('2026-10-07', '2026-10-31', 5);
  assert.equal(w[0].from, '2026-10-07');
  assert.equal(w[0].to, '2026-10-11');
  assert.equal(w[0].goal, Math.ceil(5 * 5 / 7)); // 5일 걸침 → 4
  assert.equal(w[1].goal, 5);
  assert.equal(w.at(-1).to, '2026-10-31');
});

test('목표값 — 미션/자유 따로, 예전 값은 미션 목표로 이어진다', () => {
  assert.deepEqual(normalizeGoals({ weeklyMission: 3, weeklyFree: 0, totalMission: 12, totalFree: 4 }),
    { weeklyMission: 3, weeklyFree: 0, totalMission: 12, totalFree: 4 });
  assert.deepEqual(normalizeGoals({ weekly: 5, total: 18 }), { weeklyMission: 5, weeklyFree: 0, totalMission: 18, totalFree: 0 });
  assert.deepEqual(normalizeGoals({ daily: 1, weekly: 5, monthly: 18 }), { weeklyMission: 5, weeklyFree: 0, totalMission: 18, totalFree: 0 });
  assert.deepEqual(normalizeGoals({}), { weeklyMission: 3, weeklyFree: 2, totalMission: 12, totalFree: 8 });
});

test('진척 계산 — 위클리·챌린지 목표를 미션/자유 포스팅으로 따로 센다', () => {
  const cohort = { startDate: '2026-10-05', endDate: '2026-11-01', goals: { weeklyMission: 3, weeklyFree: 2, totalMission: 12, totalFree: 8 } };
  const R = (d) => ({ postDate: d, type: 'review' });
  const F = (d) => ({ postDate: d, type: 'free' });
  const posts = [R('2026-10-05'), R('2026-10-07'), R('2026-10-08'), F('2026-10-06'), F('2026-10-09'), F('2026-10-12'), R('2026-09-30')];
  const pr = computeProgress(cohort, posts, '2026-10-09');
  assert.equal(pr.valid, true);
  assert.equal(pr.phase, 'running');
  assert.equal(pr.dayNumber, 5);
  assert.equal(pr.totalPosts, 6); // 기간 밖 9/30 제외
  assert.deepEqual([pr.weekly.index, pr.weekly.mission.count, pr.weekly.mission.goal, pr.weekly.mission.done], [1, 3, 3, true]);
  assert.deepEqual([pr.weekly.free.count, pr.weekly.free.goal, pr.weekly.free.done, pr.weekly.done], [2, 2, true, true]);
  assert.deepEqual([pr.weeks[1].free.count, pr.weeks[1].mission.count, pr.weeks[1].done], [1, 0, false]);
  assert.deepEqual([pr.challenge.mission.count, pr.challenge.mission.goal, pr.challenge.free.count, pr.challenge.free.goal], [3, 12, 3, 8]);
  assert.equal(pr.challenge.done, false);
  assert.equal(pr.goalRate, 30); // (3 + 3) / 20
  assert.equal(pr.days.length, 28);
  assert.equal(pr.days.find((d) => d.date === '2026-10-06').done, true);
});

test('진척 — 목표 0 은 목표 없음, 한 종류만 많이 써도 진행률이 넘치지 않음', () => {
  const cohort = { startDate: '2026-10-05', endDate: '2026-10-11', goals: { weeklyMission: 2, weeklyFree: 0, totalMission: 2, totalFree: 2 } };
  const posts = ['05', '06', '07', '08'].map((d) => ({ postDate: `2026-10-${d}`, type: 'review' }));
  const pr = computeProgress(cohort, posts, '2026-10-09');
  assert.deepEqual([pr.weekly.free.goal, pr.weekly.free.done, pr.weekly.done], [0, true, true]);
  assert.equal(pr.goalRate, 50); // 미션 2(목표까지만) + 자유 0 / 4
  assert.equal(pr.challenge.done, false);
});

test('부분 주는 종류별 목표를 비례 배분', () => {
  // 2026-10-07(수) ~ 2026-10-31(토): 첫 주 5일
  const pr = computeProgress({ startDate: '2026-10-07', endDate: '2026-10-31', goals: { weeklyMission: 5, weeklyFree: 2, totalMission: 1, totalFree: 1 } }, [], '2026-10-08');
  assert.deepEqual([pr.weeks[0].mission.goal, pr.weeks[0].free.goal], [Math.ceil(5 * 5 / 7), Math.ceil(2 * 5 / 7)]);
  assert.deepEqual([pr.weeks[1].mission.goal, pr.weeks[1].free.goal], [5, 2]);
});

test('기간 전/후', () => {
  const cohort = { startDate: '2026-11-01', endDate: '2026-11-07', goals: {} };
  assert.equal(computeProgress(cohort, [], '2026-10-09').phase, 'before');
  const after = computeProgress(cohort, [{ postDate: '2026-11-06', type: 'free' }], '2026-12-01');
  assert.equal(after.phase, 'after');
  assert.equal(after.weekly.index, 2); // 11/1(일)이 1주차, 11/2~7 이 2주차
  assert.equal(after.challenge.free.count, 1);
  assert.equal(computeProgress({ startDate: '', endDate: '' }, [], '2026-10-09').valid, false);
});

test('아이디·비밀번호 검증 (4자 이상)', () => {
  assert.equal(normalizeLoginId('  홍길동 '), '홍길동');
  assert.equal(normalizeLoginId('ABC'), 'abc');
  assert.equal(validateLoginId('홍길동'), '');
  assert.equal(validateLoginId('blog_123'), '');
  assert.ok(validateLoginId('홍 길동'));
  assert.ok(validateLoginId('a'));
  assert.ok(validatePassword('123'));
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

test('순위 — 동점은 같은 등수', () => {
  const r = rankRows([{ name: '다', count: 3 }, { name: '가', count: 5 }, { name: '나', count: 3 }, { name: '라', count: 0 }]);
  assert.deepEqual(r.map((x) => `${x.rank}${x.name}`), ['1가', '2나', '2다', '4라']);
});

test('4자리 비밀번호 — Firebase 용으로 늘리고, 6자 이상은 그대로', async () => {
  const { toAuthPassword, validatePassword } = await import('../js/utils.js');
  assert.equal(validatePassword('1234'), '');
  assert.ok(validatePassword('123'));
  assert.ok(toAuthPassword('1234').length >= 6);
  assert.notEqual(toAuthPassword('1234'), toAuthPassword('5678'));
  assert.equal(toAuthPassword('hong1234'), 'hong1234');
  assert.equal(toAuthPassword('123456'), '123456');
});

test('그래프 세로축 — 최고값이 약 90% 높이에 오게', async () => {
  const { niceAxisMax, axisTicks } = await import('../js/utils.js');
  for (const [max, want] of [[1400, 1600], [1500, 1700], [130, 150], [260, 290], [90, 100], [42, 47], [0, 5], [2000, 2300]]) {
    assert.equal(niceAxisMax(max), want, `최고 ${max}`);
  }
  for (const max of [7, 42, 55, 130, 260, 333, 990, 1234, 1400, 1500, 2000, 98765]) {
    const pct = max / niceAxisMax(max);
    assert.ok(pct <= 0.9 + 1e-9 && pct >= 0.8, `최고 ${max} → ${niceAxisMax(max)} (${Math.round(pct * 100)}%)`);
    const t = axisTicks(niceAxisMax(max));
    assert.ok(t[0] === 0 && t.length >= 3 && t.length <= 6 && t.at(-1) <= niceAxisMax(max), `눈금 ${t}`);
  }
  assert.deepEqual(axisTicks(1600), [0, 500, 1000, 1500]);
  assert.deepEqual(axisTicks(150), [0, 50, 100, 150]);
});
