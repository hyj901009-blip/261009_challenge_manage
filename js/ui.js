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
    const cls = d.future ? 'future' : d.done ? 'done' : 'miss';
    const t = `${shortDate(d.date)} · ${d.future ? '예정' : `${d.count}개`}`;
    const mmdd = `${d.date.slice(5, 7)}/${d.date.slice(8, 10)}`;
    return `<span class="cell ${cls} ${d.date === today ? 'today' : ''}" title="${esc(t)}" data-tip="${esc(t)}">${mmdd}</span>`;
  }).join('')}</div>`;
}

/**
 * 방문자 추이 라인 차트(SVG). series: [{date, value|null}] — 챌린지 기간 전체를 넘겨 받는다.
 * 아직 오지 않은 날은 빈칸으로 두고, 기록이 생기는 대로 하루하루 채워진다.
 * 점에 마우스를 올리면(모바일은 탭) 그날의 일 방문자 수가 말풍선으로 보인다.
 * 외부 라이브러리 없이 그려서 CDN 의존과 번들 크기를 줄인다.
 */
export function lineChart(series, { height = 240, label = '방문자', today = '' } = {}) {
  const pts = series.map((p, i) => ({ i, date: p.date, v: p.value }));
  if (!pts.length) return '<div class="empty">표시할 기간이 없습니다.</div>';
  const vals = pts.filter((p) => p.v != null);

  const W = Math.max(720, pts.length * 26);
  const H = height;
  const pad = { l: 48, r: 16, t: 18, b: 36 };
  const maxV = vals.length ? Math.max(...vals.map((p) => p.v)) : 0;
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
  const step = Math.ceil(pts.length / 14);
  const last = pts.length - 1;
  // 마지막 날짜 라벨과 겹치지 않게, 마지막 바로 앞의 규칙적인 라벨은 너무 가까우면 뺀다
  const xl = pts.filter((p) => p.i === last || (p.i % step === 0 && last - p.i >= Math.max(2, step * 0.6)))
    .map((p) => `<text x="${x(p.i)}" y="${H - 12}" class="axis ${p.date === today ? 'axis-today' : ''}" text-anchor="middle">${p.date.slice(5).replace('-', '/')}</text>`).join('');
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
    return `<g class="pt" data-tip="${esc(tip)}"><circle class="hit" cx="${x(p.i)}" cy="${y(p.v)}" r="12"/>
      <circle class="dot" cx="${x(p.i)}" cy="${y(p.v)}" r="4"/></g>`;
  }).join('');
  const emptyMsg = vals.length ? '' : `<text class="axis" x="${W / 2}" y="${(H - pad.b) / 2 + pad.t / 2}" text-anchor="middle">아직 기록이 없습니다. 하루하루 채워집니다.</text>`;

  return `<div class="chart-scroll"><svg class="chart" viewBox="0 0 ${W} ${H}" style="min-width:${Math.round(W * 0.85)}px" role="img" aria-label="${esc(label)} 추이">
    ${future}${grid}${todayLine}${xl}${lines}${dots}${emptyMsg}</svg></div>`;
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
