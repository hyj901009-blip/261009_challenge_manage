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
    const cls = d.future ? 'future' : d.done ? 'done' : d.count ? 'part' : 'miss';
    const t = `${shortDate(d.date)} · ${d.count}개`;
    return `<span class="cell ${cls} ${d.date === today ? 'today' : ''}" title="${esc(t)}">${d.count || ''}</span>`;
  }).join('')}</div>`;
}

/**
 * 방문자 추이 라인 차트(SVG). series: [{date, value|null}]
 * 외부 라이브러리 없이 그려서 CDN 의존과 번들 크기를 줄인다.
 */
export function lineChart(series, { height = 220, label = '방문자' } = {}) {
  const pts = series.map((p, i) => ({ i, date: p.date, v: p.value }));
  const vals = pts.filter((p) => p.v != null);
  if (!vals.length) return `<div class="empty">아직 입력된 ${esc(label)} 기록이 없습니다.</div>`;

  const W = Math.max(720, pts.length * 22);
  const H = height;
  const pad = { l: 44, r: 14, t: 16, b: 34 };
  const maxV = Math.max(...vals.map((p) => p.v));
  const niceMax = maxV <= 5 ? 5 : Math.ceil(maxV / Math.pow(10, Math.floor(Math.log10(maxV)))) * Math.pow(10, Math.floor(Math.log10(maxV)));
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
      <text x="${pad.l - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v.toLocaleString()}</text>`;
  }).join('');
  const step = Math.ceil(pts.length / 10);
  const xl = pts.filter((p) => p.i % step === 0 || p.i === pts.length - 1)
    .map((p) => `<text x="${x(p.i)}" y="${H - 12}" class="axis" text-anchor="middle">${p.date.slice(5).replace('-', '/')}</text>`).join('');
  const lines = segs.map((s) => `<polyline class="line" points="${s.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}"/>`).join('');
  const dots = vals.map((p) => `<circle class="dot" cx="${x(p.i)}" cy="${y(p.v)}" r="3.5"><title>${shortDate(p.date)} · ${p.v.toLocaleString()}명</title></circle>`).join('');

  return `<div class="chart-scroll"><svg class="chart" viewBox="0 0 ${W} ${H}" style="min-width:${Math.round(W * 0.6)}px" role="img" aria-label="${esc(label)} 추이">
    ${grid}${xl}${lines}${dots}</svg></div>`;
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
