/* 날짜 · 집계 유틸 — DOM/Firebase에 의존하지 않는 순수 함수만 둔다(Node 테스트에서 그대로 import).
 * 날짜는 모두 'YYYY-MM-DD' 문자열로 다루고, "오늘"은 챌린지 기준 시간대(기본 KST)로 판정한다. */

export const DEFAULT_TZ = 'Asia/Seoul';

/** 기준 시간대의 오늘 날짜 'YYYY-MM-DD' */
export function todayISO(tz = DEFAULT_TZ, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toISO = (dt) => dt.toISOString().slice(0, 10);

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(toUTC(s)) === s;
}

export function addDays(iso, n) {
  const dt = toUTC(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISO(dt);
}

/** b - a (일) */
export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** from~to 양끝 포함 날짜 배열 */
export function dateRange(from, to) {
  const out = [];
  for (let cur = from, guard = 0; cur <= to && guard < 2000; cur = addDays(cur, 1), guard++) out.push(cur);
  return out;
}

/** 그 주의 월요일 */
export function weekStart(iso) {
  const dow = (toUTC(iso).getUTCDay() + 6) % 7; // 월=0 … 일=6
  return addDays(iso, -dow);
}

export function monthStart(iso) { return iso.slice(0, 8) + '01'; }

export function monthEnd(iso) {
  const dt = toUTC(monthStart(iso));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCDate(0);
  return toISO(dt);
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function weekdayKo(iso) { return DOW[toUTC(iso).getUTCDay()]; }

/** '2026-10-09' → '10/9(금)' */
export function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}(${weekdayKo(iso)})`;
}

const maxDate = (a, b) => (a > b ? a : b);
const minDate = (a, b) => (a < b ? a : b);

/** 목표값 정리 — 비었거나 이상한 값은 기본값으로 */
export function normalizeGoals(goals = {}) {
  const pick = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  return { daily: pick(goals.daily, 1), weekly: pick(goals.weekly, 5), monthly: pick(goals.monthly, 20) };
}

/** 날짜별 포스팅 수 { 'YYYY-MM-DD': n } — 기간 밖 날짜는 집계하지 않는다 */
export function countByDate(posts, start, end) {
  const out = {};
  for (const p of posts || []) {
    const d = p && p.postDate;
    if (!isISODate(d)) continue;
    if (start && d < start) continue;
    if (end && d > end) continue;
    out[d] = (out[d] || 0) + 1;
  }
  return out;
}

function sumRange(counts, from, to) {
  let n = 0;
  for (const d of dateRange(from, to)) n += counts[d] || 0;
  return n;
}

/** 기간에 일부만 걸친 주/달은 걸친 일수만큼 목표를 비례 배분(올림) */
function proratedGoal(goal, daysInside, daysTotal) {
  return Math.max(1, Math.ceil(goal * daysInside / daysTotal));
}

/** 기간을 주(월~일) 단위로 자른 목록 */
export function periodWeeks(start, end, weeklyGoal) {
  const out = [];
  for (let ws = weekStart(start), i = 1; ws <= end; ws = addDays(ws, 7), i++) {
    const from = maxDate(ws, start);
    const to = minDate(addDays(ws, 6), end);
    out.push({ index: i, from, to, goal: proratedGoal(weeklyGoal, diffDays(from, to) + 1, 7) });
  }
  return out;
}

/** 기간을 달력 월 단위로 자른 목록 */
export function periodMonths(start, end, monthlyGoal) {
  const out = [];
  for (let ms = monthStart(start); ms <= end; ms = addDays(monthEnd(ms), 1)) {
    const from = maxDate(ms, start);
    const to = minDate(monthEnd(ms), end);
    const total = diffDays(ms, monthEnd(ms)) + 1;
    out.push({ label: `${Number(ms.slice(5, 7))}월`, from, to, goal: proratedGoal(monthlyGoal, diffDays(from, to) + 1, total) });
  }
  return out;
}

/**
 * 한 사람의 미션 진척을 계산한다.
 * @param cohort { startDate, endDate, goals:{daily,weekly,monthly} }
 * @param posts  [{ postDate }]
 * @param today  기준일 'YYYY-MM-DD'
 */
export function computeProgress(cohort, posts, today) {
  const goals = normalizeGoals(cohort && cohort.goals);
  const start = cohort && cohort.startDate;
  const end = cohort && cohort.endDate;
  if (!isISODate(start) || !isISODate(end) || start > end) {
    return { valid: false, goals };
  }
  const counts = countByDate(posts, start, end);
  const phase = today < start ? 'before' : today > end ? 'after' : 'running';
  // 기간 밖이면 가장 가까운 기간 안 날짜를 기준으로 보여 준다
  const ref = today < start ? start : today > end ? end : today;

  const dailyCount = counts[ref] || 0;
  const daily = { date: ref, count: dailyCount, goal: goals.daily, done: dailyCount >= goals.daily };

  const weeks = periodWeeks(start, end, goals.weekly).map((w) => {
    const count = sumRange(counts, w.from, w.to);
    return Object.assign(w, { count, done: count >= w.goal });
  });
  const weekly = weeks.find((w) => w.from <= ref && ref <= w.to);

  const months = periodMonths(start, end, goals.monthly).map((m) => {
    const count = sumRange(counts, m.from, m.to);
    return Object.assign(m, { count, done: count >= m.goal });
  });
  const monthly = months.find((m) => m.from <= ref && ref <= m.to);

  // 지난 날짜 + (오늘 이미 달성했다면 오늘) 을 분모로 — 아침마다 달성률이 뚝 떨어지지 않게
  let elapsedEnd = null;
  if (phase === 'after') elapsedEnd = end;
  else if (phase === 'running') elapsedEnd = daily.done ? today : addDays(today, -1);
  const elapsedDays = elapsedEnd && elapsedEnd >= start ? dateRange(start, elapsedEnd) : [];
  const achievedDays = elapsedDays.filter((d) => (counts[d] || 0) >= goals.daily).length;

  // 연속 달성: 오늘 달성했으면 오늘부터, 아니면 어제부터 거꾸로
  let streak = 0;
  if (phase !== 'before') {
    let cur = phase === 'after' ? end : (daily.done ? today : addDays(today, -1));
    while (cur >= start && (counts[cur] || 0) >= goals.daily) { streak++; cur = addDays(cur, -1); }
  }

  const days = dateRange(start, end).map((d) => ({
    date: d,
    count: counts[d] || 0,
    done: (counts[d] || 0) >= goals.daily,
    future: d > today
  }));

  return {
    valid: true,
    phase,
    ref,
    goals,
    totalDays: days.length,
    dayNumber: phase === 'running' ? diffDays(start, today) + 1 : null,
    daily,
    weekly,
    monthly,
    weeks,
    months,
    days,
    totalPosts: Object.values(counts).reduce((a, b) => a + b, 0),
    achievedDays,
    elapsedDays: elapsedDays.length,
    rate: elapsedDays.length ? Math.round((achievedDays / elapsedDays.length) * 100) : 0,
    streak
  };
}

/** 로그인 ID 규칙: 한글/영문/숫자/밑줄 2~20자. 영문은 소문자로 맞춘다. */
export function normalizeLoginId(raw) {
  return String(raw == null ? '' : raw).normalize('NFC').trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function validateLoginId(id) {
  if (!id) return '아이디를 입력해 주세요.';
  if (!/^[가-힣a-z0-9_]{2,20}$/.test(id)) return '아이디는 한글·영문·숫자·밑줄(_)로 2~20자여야 합니다. (띄어쓰기 불가)';
  return '';
}

export function validatePassword(pw) {
  if (!pw || String(pw).length < 6) return '비밀번호는 6자 이상이어야 합니다.';
  if (String(pw).length > 64) return '비밀번호가 너무 깁니다. (64자 이하)';
  return '';
}

/** 블로그 URL 정리 — http(s)만 허용, 스킴이 없으면 https:// 를 붙인다 */
export function normalizeUrl(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch (_) {
    return '';
  }
}

/** 방문자 기록 [{date,count}] → 기간 안의 연속 시계열(빈 날은 null) */
export function visitSeries(visits, from, to) {
  const map = {};
  for (const v of visits || []) {
    if (v && isISODate(v.date) && Number.isFinite(Number(v.count))) map[v.date] = (map[v.date] || 0) + Number(v.count);
  }
  return dateRange(from, to).map((d) => ({ date: d, value: d in map ? map[d] : null }));
}

/** 시계열 요약: 최근값, 직전 대비 변화, 평균, 최대 */
export function seriesStats(series) {
  const vals = series.filter((p) => p.value != null);
  if (!vals.length) return { last: null, prev: null, delta: null, avg: null, max: null, n: 0 };
  const last = vals[vals.length - 1].value;
  const prev = vals.length > 1 ? vals[vals.length - 2].value : null;
  const sum = vals.reduce((a, p) => a + p.value, 0);
  return {
    last,
    prev,
    delta: prev == null ? null : last - prev,
    avg: Math.round(sum / vals.length),
    max: Math.max(...vals.map((p) => p.value)),
    n: vals.length
  };
}

/* ── 네이버 블로그 ─────────────────────────────────────── */
/**
 * 블로그 주소에서 네이버 블로그 아이디를 뽑는다. 네이버 블로그가 아니면 ''.
 *   https://blog.naver.com/myid            https://m.blog.naver.com/myid/223...
 *   https://blog.naver.com/PostView.naver?blogId=myid&logNo=...      https://myid.blog.me
 */
export function naverBlogId(raw) {
  const url = normalizeUrl(raw);
  if (!url) return '';
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const valid = (id) => (/^[a-z0-9_-]{2,40}$/i.test(id || '') ? id.toLowerCase() : '');
  const me = host.match(/^([a-z0-9_-]+)\.blog\.me$/i);
  if (me) return valid(me[1]);
  if (host !== 'blog.naver.com' && host !== 'm.blog.naver.com') return '';
  const q = u.searchParams.get('blogId');
  if (q) return valid(q);
  const first = u.pathname.split('/').filter(Boolean)[0] || '';
  if (/\.(naver|nhn)$/i.test(first)) return '';
  return valid(first);
}

/**
 * 네이버 방문자 위젯 응답(XML) → [{ date:'YYYY-MM-DD', count }]
 *   <visitorcnts><visitorcnt id="20261008" cnt="123" />…</visitorcnts>
 * 비공식 형식이라 속성 순서가 바뀌어도 읽히게 태그마다 따로 뽑는다.
 */
export function parseNaverVisitors(xml) {
  const out = [];
  for (const tag of String(xml || '').match(/<visitorcnt\b[^>]*>/gi) || []) {
    const id = (tag.match(/\bid\s*=\s*["'](\d{8})["']/i) || [])[1];
    const cnt = (tag.match(/\bcnt\s*=\s*["'](\d+)["']/i) || [])[1];
    if (!id || cnt == null) continue;
    const date = `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
    if (isISODate(date)) out.push({ date, count: Number(cnt) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
