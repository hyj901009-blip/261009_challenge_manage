/* 화면 공통 도우미 — 이스케이프, 토스트, 진행 막대, 방문자 추이 SVG 차트, 페이지 접근 제어 */
import { APP } from './config.js';
import { currentUser, getRole, ready } from './firebase.js';
import { shortDate } from './utils.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(msg, kind = 'info') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

/** 버튼을 잠근 채로 비동기 작업을 돌리고, 실패하면 토스트로 알린다 */
export async function busy(btn, fn, errMsg) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(errMsg ? errMsg(e) : (e.message || '오류가 발생했습니다.'), 'bad');
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Firestore Timestamp | Date | null → Date */
export function toDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
}

export function fmtDateTime(ts) {
  const d = toDate(ts);
  if (!d) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: APP.timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d);
}

/** 'HH:MM' (기준 시간대) */
export function fmtTime(ts) {
  const d = typeof ts === 'number' ? new Date(ts) : toDate(ts);
  if (!d) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: APP.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export const tsMillis = (ts) => { const d = toDate(ts); return d ? d.getTime() : 0; };

export function reactionOf(key) {
  return APP.reactions.find((r) => r.key === key) || null;
}

export const POST_STATUS = {
  pending: { label: '검토 대기', cls: 'warn' },
  approved: { label: '검토 완료', cls: 'ok' },
  revise: { label: '수정 요청', cls: 'bad' },
  free: { label: '자유 등록', cls: 'info' }
};
export const POST_TYPE = { review: '검토 요청', free: '자유 등록' };

export function statusBadge(post) {
  if (post.status === 'free') return ''; // 등록 방식 배지('자유 등록')와 겹치므로 생략
  const s = POST_STATUS[post.status] || { label: post.status, cls: '' };
  return `<span class="badge ${s.cls}">${esc(s.label)}</span>`;
}

/** 진행 막대 + "n / goal" */
export function progressBlock(title, count, goal, sub) {
  const pct = goal ? Math.min(100, Math.round((count / goal) * 100)) : 0;
  const done = count >= goal;
  return `
    <div class="prog ${done ? 'done' : ''}">
      <div class="prog-head"><span class="prog-title">${esc(title)}</span>
        <span class="prog-num"><b>${count}</b> / ${goal}${done ? ' ✅' : ''}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${sub ? `<div class="prog-sub">${esc(sub)}</div>` : ''}
    </div>`;
}

/** 기간 전체 날짜 칸(잔디) */
export function dayStrip(days, today) {
  return `<div class="strip">${days.map((d) => {
    const cls = d.done ? 'done' : 'miss';
    const t = `${shortDate(d.date)} · ${d.done ? '포스팅함' : '미등록'} · ${d.count}개`;
    const mmdd = `${d.date.slice(5, 7)}/${d.date.slice(8, 10)}`;
    return `<span class="cell ${cls} ${d.date === today ? 'today' : ''}" title="${esc(t)}" data-tip="${esc(t)}">${mmdd}</span>`;
  }).join('')}</div>`;
}

/**
 * 방문자 추이 라인 차트(SVG). series: [{date, value|null}] — 챌린지 기간 전체를 넘겨 받는다.
 * 아직 오지 않은 날은 빈칸으로 두고, 기록이 생기는 대로 하루하루 채워진다.
 * 점에 마우스를 올리면(모바일은 탭) 그날의 일 방문자 수가 말풍선으로 보인다.
 * 외부 라이브러리 없이 그려서 CDN 의존과 번들 크기를 줄인다.
 * compact: 여러 명을 한 화면에 늘어놓는 작은 카드용 (가로 스크롤 없이 카드 폭에 맞춤)
 * maxValue: 세로 눈금 최댓값을 직접 정할 때 (여러 그래프를 같은 눈금으로 비교)
 */
export function lineChart(series, { height, label = '방문자', today = '', compact = false, maxValue = 0 } = {}) {
  const pts = series.map((p, i) => ({ i, date: p.date, v: p.value }));
  if (!pts.length) return '<div class="empty">표시할 기간이 없습니다.</div>';
  const vals = pts.filter((p) => p.v != null);

  const W = compact ? 420 : Math.max(720, pts.length * 26);
  const H = height || (compact ? 190 : 240);
  const pad = compact ? { l: 40, r: 12, t: 18, b: 28 } : { l: 48, r: 16, t: 18, b: 36 };
  const maxV = Math.max(maxValue || 0, vals.length ? Math.max(...vals.map((p) => p.v)) : 0);
  const mag = maxV > 0 ? Math.pow(10, Math.floor(Math.log10(maxV))) : 1;
  const niceMax = maxV <= 5 ? 5 : Math.ceil(maxV / mag) * mag;
  const x = (i) => pad.l + (pts.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (pts.length - 1));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / niceMax);

  // 빈 날은 선을 끊어서 "0 방문"으로 오해하지 않게 한다
  const segs = [];
  let cur = [];
  for (const p of pts) {
    if (p.v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length) segs.push(cur);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = Math.round(niceMax * f);
    return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${pad.l - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v.toLocaleString()}</text>`;
  }).join('');
  const step = Math.ceil(pts.length / (compact ? 5 : 14));
  const last = pts.length - 1;
  // 마지막 날짜 라벨과 겹치지 않게, 마지막 바로 앞의 규칙적인 라벨은 너무 가까우면 뺀다
  const xl = pts.filter((p) => p.i === last || (p.i % step === 0 && last - p.i >= Math.max(2, step * 0.6)))
    .map((p) => `<text x="${x(p.i)}" y="${H - (compact ? 8 : 12)}" class="axis ${p.date === today ? 'axis-today' : ''}" text-anchor="${compact && p.i === last ? 'end' : compact && p.i === 0 ? 'start' : 'middle'}">${p.date.slice(5).replace('-', '/')}</text>`).join('');
  const todayIdx = pts.findIndex((p) => p.date === today);
  const todayLine = todayIdx >= 0
    ? `<line class="today-line" x1="${x(todayIdx)}" x2="${x(todayIdx)}" y1="${pad.t}" y2="${H - pad.b}"/>
       <text class="axis axis-today" x="${x(todayIdx)}" y="${pad.t - 5}" text-anchor="middle">오늘</text>` : '';
  // 아직 오지 않은 날은 연한 배경으로 표시
  const futureFrom = today ? pts.findIndex((p) => p.date > today) : -1;
  const future = futureFrom >= 0
    ? `<rect class="future-area" x="${x(futureFrom) - (futureFrom ? (x(1) - x(0)) / 2 : 0)}" y="${pad.t}" width="${W - pad.r - x(futureFrom) + (futureFrom ? (x(1) - x(0)) / 2 : 0)}" height="${H - pad.t - pad.b}"/>` : '';
  const lines = segs.map((sg) => `<polyline class="line" points="${sg.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}"/>`).join('');
  const dots = vals.map((p) => {
    const tip = `${shortDate(p.date)} · ${p.v.toLocaleString()}명`;
    return `<g class="pt" data-tip="${esc(tip)}"><circle class="hit" cx="${x(p.i)}" cy="${y(p.v)}" r="${compact ? 9 : 12}"/>
      <circle class="dot" cx="${x(p.i)}" cy="${y(p.v)}" r="${compact ? 3 : 4}"/></g>`;
  }).join('');
  const emptyMsg = vals.length ? '' : `<text class="axis" x="${W / 2}" y="${(H - pad.b) / 2 + pad.t / 2}" text-anchor="middle">${compact ? '아직 기록이 없습니다' : '아직 기록이 없습니다. 하루하루 채워집니다.'}</text>`;

  const size = compact ? '' : ` style="min-width:${Math.round(W * 0.85)}px"`;
  return `<div class="chart-scroll"><svg class="chart${compact ? ' compact' : ''}" viewBox="0 0 ${W} ${H}"${size} role="img" aria-label="${esc(label)} 추이">
    ${future}${grid}${todayLine}${xl}${lines}${dots}${emptyMsg}</svg></div>`;
}

/* ── 여러 명 꺾은선 (한 판에 여러 선) ─────────────────────
 * 색은 사람마다 고정(순위나 정렬이 바뀌어도 같은 사람은 같은 색).
 * 8가지 색은 색각 이상에서도 이웃끼리 구분되도록 검증한 순서. 9번째부터는 같은 색 순서에 점선을 더한다. */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const seriesStyle = (i) => ({ color: SERIES_COLORS[i % SERIES_COLORS.length], dashed: i >= SERIES_COLORS.length });

/**
 * series: [{ key, name, colorIndex, points:[{date, value|null}] }] — points 는 모두 같은 날짜 목록
 * hidden: 숨길 key 의 Set,  today: 'YYYY-MM-DD'
 * 마우스를 올리면 세로선 + 그날 모든 사람의 값이 말풍선으로 나온다.
 */
export function renderMultiLineChart(el, series, { today = '', hidden = new Set(), label = '방문자' } = {}) {
  const dates = series.length ? series[0].points.map((p) => p.date) : [];
  if (!dates.length) { el.innerHTML = '<div class="empty">표시할 기간이 없습니다.</div>'; return; }
  const shown = series.filter((s) => !hidden.has(s.key));
  const W = Math.max(760, dates.length * 28);
  const H = 360;
  const pad = { l: 52, r: 18, t: 22, b: 38 };
  const allVals = shown.flatMap((s) => s.points.map((p) => p.value).filter((v) => v != null));
  const maxV = allVals.length ? Math.max(...allVals) : 0;
  const mag = maxV > 0 ? Math.pow(10, Math.floor(Math.log10(maxV))) : 1;
  const niceMax = maxV <= 5 ? 5 : Math.ceil(maxV / mag) * mag;
  const x = (i) => pad.l + (dates.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (dates.length - 1));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / niceMax);
  const colW = dates.length > 1 ? x(1) - x(0) : W;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = Math.round(niceMax * f);
    return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${pad.l - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v.toLocaleString()}</text>`;
  }).join('');
  const last = dates.length - 1;
  const step = Math.ceil(dates.length / 14);
  const xl = dates.map((d, i) => ({ d, i }))
    .filter(({ i }) => i === last || (i % step === 0 && last - i >= Math.max(2, step * 0.6)))
    .map(({ d, i }) => `<text x="${x(i)}" y="${H - 14}" class="axis ${d === today ? 'axis-today' : ''}" text-anchor="${i === last ? 'end' : i === 0 ? 'start' : 'middle'}">${d.slice(5).replace('-', '/')}</text>`).join('');
  const ti = dates.indexOf(today);
  const todayLine = ti >= 0 ? `<line class="today-line" x1="${x(ti)}" x2="${x(ti)}" y1="${pad.t}" y2="${H - pad.b}"/>
    <text class="axis axis-today" x="${x(ti)}" y="${pad.t - 6}" text-anchor="middle">오늘</text>` : '';
  const ff = today ? dates.findIndex((d) => d > today) : -1;
  const future = ff >= 0 ? `<rect class="future-area" x="${x(ff) - (ff ? colW / 2 : 0)}" y="${pad.t}" width="${W - pad.r - x(ff) + (ff ? colW / 2 : 0)}" height="${H - pad.t - pad.b}"/>` : '';

  const lines = shown.map((s) => {
    const st = seriesStyle(s.colorIndex);
    const segs = [];
    let cur = [];
    s.points.forEach((p, i) => { if (p.value == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(p.value)]); });
    if (cur.length) segs.push(cur);
    const dash = st.dashed ? ' stroke-dasharray="6 4"' : '';
    const path = segs.map((sg) => `<polyline points="${sg.map((q) => q.join(',')).join(' ')}"${dash}/>`).join('');
    const dots = s.points.map((p, i) => (p.value == null ? '' : `<circle cx="${x(i)}" cy="${y(p.value)}" r="3"/>`)).join('');
    return `<g class="mline" data-key="${esc(s.key)}" style="--c:${st.color}">${path}${dots}</g>`;
  }).join('');
  const empty = allVals.length ? '' : `<text class="axis" x="${W / 2}" y="${(H - pad.b + pad.t) / 2}" text-anchor="middle">아직 기록이 없습니다. 하루하루 채워집니다.</text>`;

  el.innerHTML = `<div class="mchart-wrap"><div class="chart-scroll"><svg class="chart mchart" viewBox="0 0 ${W} ${H}" style="min-width:${Math.round(W * 0.85)}px" role="img" aria-label="${esc(label)} 추이">
    ${future}${grid}${todayLine}${xl}${lines}
    <line class="cross" y1="${pad.t}" y2="${H - pad.b}" x1="0" x2="0" visibility="hidden"/>
    <rect class="hover-zone" x="${pad.l - colW / 2}" y="${pad.t}" width="${W - pad.l - pad.r + colW}" height="${H - pad.t - pad.b}"/>${empty}
  </svg></div><div class="mtip" hidden></div></div>`;

  // 세로선 + 말풍선: 마우스 위치에서 가장 가까운 날짜
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.mtip');
  const cross = el.querySelector('.cross');
  const wrap = el.querySelector('.mchart-wrap');
  const pick = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(last, Math.round(dates.length === 1 ? 0 : ((sx - pad.l) / (W - pad.l - pad.r)) * last)));
  };
  const move = (ev) => {
    const i = pick(ev);
    const rows = shown.map((s) => ({ s, v: s.points[i].value })).sort((a, b) => (b.v == null ? -1 : b.v) - (a.v == null ? -1 : a.v));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    svg.querySelectorAll('.mline circle.on').forEach((c) => c.classList.remove('on'));
    tip.innerHTML = `<div class="mtip-date">${esc(shortDate(dates[i]))}${dates[i] > today && today ? ' · 예정' : ''}</div>${rows.map(({ s, v }) =>
      `<div class="mtip-row"><i style="background:${seriesStyle(s.colorIndex).color}"></i><span>${esc(s.name)}</span><b>${v == null ? '-' : `${v.toLocaleString()}명`}</b></div>`).join('')}`;
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const px = sr.left - wr.left + (x(i) / W) * sr.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${px + 14 + tw > wr.width ? Math.max(0, px - 14 - tw) : px + 14}px`;
    tip.style.top = `${Math.max(0, ev.clientY - wr.top - tip.offsetHeight / 2)}px`;
  };
  const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  const zone = svg.querySelector('.hover-zone');
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerdown', move);
  zone.addEventListener('pointerleave', leave);
}

/* 차트 점·날짜 칸 위에 마우스를 올리면(모바일은 탭) 말풍선을 띄운다 — 페이지마다 한 번만 설치 */
let tipInstalled = false;
export function installTooltips() {
  if (tipInstalled) return;
  tipInstalled = true;
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  let current = null;
  const place = (el, clientX) => {
    const r = el.getBoundingClientRect();
    const cx = clientX != null ? clientX : r.left + r.width / 2;
    tip.style.left = `${Math.min(window.innerWidth - 8, Math.max(8, cx))}px`;
    tip.style.top = `${Math.max(8, r.top - 8)}px`;
  };
  const show = (el, ev) => {
    current = el;
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    place(el, ev && ev.pointerType === 'mouse' ? ev.clientX : null);
  };
  const hide = () => { current = null; tip.hidden = true; };
  const target = (ev) => ev.target.closest && ev.target.closest('.chart [data-tip], .strip [data-tip]');
  document.addEventListener('pointerover', (ev) => { const el = target(ev); if (el) show(el, ev); });
  document.addEventListener('pointerout', (ev) => {
    const el = target(ev);
    if (el && !(ev.relatedTarget && el.contains(ev.relatedTarget))) hide();
  });
  // 스크롤하면 말풍선이 점을 따라가게 한다 (점이 화면 밖으로 나가면 숨김)
  document.addEventListener('scroll', () => {
    if (!current) return;
    const r = current.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || !current.isConnected) hide();
    else place(current);
  }, { passive: true, capture: true });
}

/** 로그인 + 역할 확인. 맞지 않으면 로그인 화면으로 보낸다. */
export async function requireRole(role) {
  try {
    await ready();
  } catch (e) {
    document.body.innerHTML = `<main class="wrap"><div class="card"><h2>설정 필요</h2><p>${esc(e.message)}</p></div></main>`;
    throw e;
  }
  const user = await currentUser();
  if (!user) { location.replace('index.html'); throw new Error('로그인 필요'); }
  const r = await getRole(user);
  if (r.role !== role) {
    location.replace(r.role === 'admin' ? 'admin.html' : r.role === 'member' ? 'member.html' : 'index.html');
    throw new Error('권한 없음');
  }
  return { user, profile: r.profile };
}
