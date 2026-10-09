/* 관리자 페이지 — 진척 현황 / 포스팅 검토·코멘트 / 방문자 추이 / 챌린지원 계정 / 기수·미션 설정 */
import { APP } from './config.js';
import {
  logout, authErrorMessage, getAppMeta, setActiveCohort, listCohorts, createCohort, updateCohort, wipeCohortData, deleteCohort,
  listMembers, createMember, updateMember, deleteMember, resetPasswordViaApi, isAdminApiEnabled,
  listPostsByCohort, setPostStatus, deletePost, listCommentsByCohort, addComment, editComment, deleteComment,
  listVisitsByCohort, syncNaverVisitors
} from './firebase.js';
import {
  todayISO, addDays, computeProgress, shortDate, isISODate, normalizeGoals, normalizeUrl, normalizeLoginId,
  validateLoginId, validatePassword, visitSeries, seriesStats, naverBlogId
} from './utils.js';
import {
  $, $$, esc, toast, busy, requireRole, lineChart, statusBadge, fmtDateTime, tsMillis, reactionOf, POST_TYPE
} from './ui.js';

const S = {
  user: null, me: null, apiEnabled: false,
  cohorts: [], meta: {}, cohortId: '', members: [],
  posts: [], comments: [], visits: []
};
const today = () => todayISO(APP.timezone);
const cohort = () => S.cohorts.find((c) => c.id === S.cohortId) || null;
const store = {
  get(k) { try { return localStorage.getItem('bc.admin.' + k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem('bc.admin.' + k, v); } catch (_) { /* 무시 */ } }
};

$$('.app-title').forEach((el) => { el.textContent = APP.title; });
$('#logoutBtn').addEventListener('click', async () => { await logout(); location.replace('index.html'); });

/* ── 탭 ──────────────────────────────────────────────── */
function showTab(name) {
  $$('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  store.set('tab', name);
}
$$('[role="tab"]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ── 참여자 목록(보고 있는 기수) ─────────────────────────
 * 지금 이 기수에 속한 멤버 + 이 기수에 글을 남겼지만 다른 기수로 옮겨 간/삭제된 멤버까지 포함한다.
 * 그래야 지난 기수를 다시 열어도 그때 참여자가 빠짐없이 보인다. */
function participants() {
  const map = new Map();
  for (const m of S.members) if (m.cohortId === S.cohortId) map.set(m.id, { uid: m.id, name: m.name || m.loginId, loginId: m.loginId, member: m });
  for (const p of S.posts) {
    if (map.has(p.uid)) continue;
    const m = S.members.find((x) => x.id === p.uid);
    map.set(p.uid, { uid: p.uid, name: (m && (m.name || m.loginId)) || p.name || p.loginId, loginId: (m && m.loginId) || p.loginId, member: m || null, moved: !!m, deleted: !m });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
const nameOf = (uid) => {
  const m = S.members.find((x) => x.id === uid);
  if (m) return m.name || m.loginId;
  const p = S.posts.find((x) => x.uid === uid);
  return p ? (p.name || p.loginId) : '(알 수 없음)';
};
const tag = (p) => (p.deleted ? ' <span class="badge">삭제됨</span>' : p.moved ? ' <span class="badge">이동</span>' : '');

/* ── 진척 현황 ────────────────────────────────────────── */
function progressRows() {
  const c = cohort();
  const ref = $('#refDate').value || today();
  return participants().map((p) => Object.assign(p, { pr: computeProgress(c, S.posts.filter((x) => x.uid === p.uid), ref) }));
}

function miniBar(count, goal) {
  const pct = goal ? Math.min(100, Math.round((count / goal) * 100)) : 0;
  return `<span class="mini-bar ${count >= goal ? 'done' : ''}"><i style="width:${pct}%"></i></span>`;
}

function renderProgress() {
  const c = cohort();
  if (!c) { $('#progTiles').innerHTML = ''; $('#progTable').innerHTML = '<div class="empty">기수를 먼저 만들어 주세요.</div>'; $('#matrix').innerHTML = ''; return; }
  const rows = progressRows();
  const ref = $('#refDate').value || today();
  $('#periodText').textContent = `${c.name} · ${shortDate(c.startDate)} ~ ${shortDate(c.endDate)} · 목표 일 ${normalizeGoals(c.goals).daily} / 주 ${normalizeGoals(c.goals).weekly} / 월 ${normalizeGoals(c.goals).monthly}`;

  const valid = rows.filter((r) => r.pr.valid);
  const n = valid.length;
  const cnt = (f) => valid.filter(f).length;
  const avgRate = n ? Math.round(valid.reduce((a, r) => a + r.pr.rate, 0) / n) : 0;
  const pending = S.posts.filter((p) => p.status === 'pending').length;
  const unread = S.comments.filter((c2) => !c2.readAt).length;
  $('#progTiles').innerHTML = `
    <div class="tile"><div class="lbl">참여 인원</div><div class="val">${n}<small> 명</small></div></div>
    <div class="tile"><div class="lbl">데일리 달성 (${esc(shortDate(valid[0] ? valid[0].pr.ref : ref))})</div><div class="val">${cnt((r) => r.pr.daily.done)}<small> / ${n}</small></div></div>
    <div class="tile"><div class="lbl">이번 주 위클리 달성</div><div class="val">${cnt((r) => r.pr.weekly.done)}<small> / ${n}</small></div></div>
    <div class="tile"><div class="lbl">이번 달 먼슬리 달성</div><div class="val">${cnt((r) => r.pr.monthly.done)}<small> / ${n}</small></div></div>
    <div class="tile"><div class="lbl">평균 데일리 달성률</div><div class="val">${avgRate}<small>%</small></div></div>
    <div class="tile"><div class="lbl">검토 대기 · 안 읽은 코멘트</div><div class="val">${pending}<small> · ${unread}</small></div></div>`;

  const sort = $('#sortSel').value;
  const sorted = valid.slice().sort((a, b) => {
    if (sort === 'rate') return b.pr.rate - a.pr.rate || a.name.localeCompare(b.name, 'ko');
    if (sort === 'rateAsc') return a.pr.rate - b.pr.rate || a.name.localeCompare(b.name, 'ko');
    if (sort === 'total') return b.pr.totalPosts - a.pr.totalPosts || a.name.localeCompare(b.name, 'ko');
    return a.name.localeCompare(b.name, 'ko');
  });
  $('#progTable').innerHTML = !sorted.length ? '<div class="empty">아직 이 기수에 챌린지원이 없습니다.</div>' : `
    <table><thead><tr><th>이름</th><th>데일리</th><th>위클리</th><th>먼슬리</th><th class="num">총 포스팅</th><th class="num">연속</th><th class="num">달성률</th><th>검토</th></tr></thead>
    <tbody>${sorted.map((r) => {
      const pr = r.pr;
      const mine = S.posts.filter((p) => p.uid === r.uid);
      const pend = mine.filter((p) => p.status === 'pending').length;
      return `<tr>
        <td><b>${esc(r.name)}</b> <span class="faint">${esc(r.loginId)}</span>${tag(r)}</td>
        <td>${pr.daily.count}/${pr.daily.goal} ${pr.daily.done ? '✅' : ''}</td>
        <td>${pr.weekly.count}/${pr.weekly.goal}${miniBar(pr.weekly.count, pr.weekly.goal)}</td>
        <td>${pr.monthly.count}/${pr.monthly.goal}${miniBar(pr.monthly.count, pr.monthly.goal)}</td>
        <td class="num">${pr.totalPosts}</td>
        <td class="num">🔥${pr.streak}</td>
        <td class="num">${pr.rate}%</td>
        <td>${pend ? `<span class="badge warn">대기 ${pend}</span>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
  renderMatrix(sorted, ref);
}

function renderMatrix(rows, ref) {
  const view = $('input[name="mview"]:checked').value;
  if (!rows.length) { $('#matrix').innerHTML = ''; return; }
  const cls = (count, goal, future) => (future ? 'future' : count >= goal ? 'done' : count ? 'part' : 'miss');
  let head, body;
  if (view === 'daily') {
    const days = rows[0].pr.days;
    head = days.map((d) => `<th class="${d.date === ref ? 'today' : ''}" title="${esc(shortDate(d.date))}">${Number(d.date.slice(8))}</th>`).join('');
    body = rows.map((r) => `<tr><td>${esc(r.name)}</td>${r.pr.days.map((d) => {
      const fut = d.date > ref;
      return `<td><span class="m ${cls(d.count, r.pr.goals.daily, fut)}" title="${esc(shortDate(d.date))} · ${d.count}개">${fut ? '' : d.count}</span></td>`;
    }).join('')}</tr>`).join('');
  } else {
    const key = view === 'weekly' ? 'weeks' : 'months';
    const cols = rows[0].pr[key];
    head = cols.map((w) => `<th title="${esc(shortDate(w.from))}~${esc(shortDate(w.to))}">${view === 'weekly' ? `${w.index}주` : esc(w.label)}</th>`).join('');
    body = rows.map((r) => `<tr><td>${esc(r.name)}</td>${r.pr[key].map((w) => {
      const fut = w.from > ref;
      return `<td><span class="m ${cls(w.count, w.goal, fut)}" style="width:auto;padding:0 6px">${fut ? '-' : `${w.count}/${w.goal}`}</span></td>`;
    }).join('')}</tr>`).join('');
  }
  $('#matrix').innerHTML = `<table class="matrix"><thead><tr><th>이름</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

$('#refDate').addEventListener('change', renderProgress);
$('#sortSel').addEventListener('change', renderProgress);
$$('input[name="mview"]').forEach((r) => r.addEventListener('change', renderProgress));

/* ── 포스팅 검토 · 코멘트 ─────────────────────────────── */
function commentHTML(cm) {
  const r = reactionOf(cm.reaction);
  const state = !cm.readAt ? '<span class="badge warn">안 읽음</span>'
    : `<span class="badge ok">읽음</span>${r ? ` <span class="react-show" title="${esc(r.label)}">${r.emoji}</span>` : ''}`;
  return `
    <div class="comment" data-cid="${esc(cm.id)}">
      <div class="comment-text">${esc(cm.text)}</div>
      <div class="comment-meta">
        <span>${esc(fmtDateTime(cm.createdAt))}</span>${state}
        <button class="btn sm" type="button" data-editc="${esc(cm.id)}">수정</button>
        <button class="btn sm danger" type="button" data-delc="${esc(cm.id)}">삭제</button>
      </div>
      <form class="comment-form cedit" data-cid="${esc(cm.id)}" hidden>
        <textarea maxlength="${APP.commentMaxLength}">${esc(cm.text)}</textarea>
        <div class="row" style="justify-content:space-between"><span class="counter"></span>
          <span><button class="btn sm" type="button" data-cancelc>취소</button> <button class="btn sm primary" type="submit">저장</button></span></div>
      </form>
    </div>`;
}

function filteredPosts() {
  const type = $('input[name="ptype"]:checked').value;
  const st = $('#pStatus').value;
  const mem = $('#pMember').value;
  const q = $('#pSearch').value.trim().toLowerCase();
  return S.posts.filter((p) => {
    if (type !== 'all' && p.type !== type) return false;
    if (st !== 'all' && p.status !== st) return false;
    if (mem && p.uid !== mem) return false;
    if (q) {
      const cms = S.comments.filter((c) => c.postId === p.id).map((c) => c.text).join(' ');
      const hay = [p.title, p.url, p.memo, p.name, p.loginId, cms].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    // 검토 대기 글을 맨 위로, 그다음은 최근 등록순
    const pa = a.status === 'pending' ? 0 : 1;
    const pb = b.status === 'pending' ? 0 : 1;
    return pa - pb || tsMillis(b.createdAt) - tsMillis(a.createdAt);
  });
}

function renderPostCounts() {
  const pending = S.posts.filter((p) => p.status === 'pending').length;
  $('#pendingBadge').hidden = !pending;
  $('#pendingBadge').textContent = pending;
  $('#cntReview').innerHTML = pending ? `<span class="badge new">${pending}</span>` : '';
  const free = S.posts.filter((p) => p.type === 'free').length;
  $('#cntFree').textContent = free ? `(${free})` : '';
}

function renderPosts() {
  renderPostCounts();
  const list = filteredPosts();
  if (!list.length) { $('#postList').innerHTML = '<div class="empty">조건에 맞는 포스팅이 없습니다.</div>'; return; }
  $('#postList').innerHTML = list.map((p) => {
    const cms = S.comments.filter((c) => c.postId === p.id).sort((a, b) => tsMillis(a.createdAt) - tsMillis(b.createdAt));
    const reviewBtns = p.type === 'review' ? `
      ${p.status !== 'approved' ? `<button class="btn sm ok" type="button" data-status="approved" data-id="${esc(p.id)}">✅ 검토 완료</button>` : ''}
      ${p.status !== 'revise' ? `<button class="btn sm" type="button" data-status="revise" data-id="${esc(p.id)}">✏️ 수정 요청</button>` : ''}
      ${p.status !== 'pending' ? `<button class="btn sm" type="button" data-status="pending" data-id="${esc(p.id)}">↩ 대기로</button>` : ''}` : '';
    return `
      <article class="post">
        <div class="post-head">
          <b>${esc(nameOf(p.uid))}</b><span class="badge">${esc(POST_TYPE[p.type] || p.type)}</span>${statusBadge(p)}
          <span class="post-meta">${shortDate(p.postDate)} 발행 · ${esc(fmtDateTime(p.createdAt))} 등록</span>
        </div>
        <div class="post-title" style="margin-top:4px">${esc(p.title || '(제목 없음)')}</div>
        <a class="post-url" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url)}</a>
        ${p.memo ? `<p class="post-memo">💬 ${esc(p.memo)}</p>` : ''}
        <div class="post-actions">${reviewBtns}
          <button class="btn sm danger" type="button" data-delpost="${esc(p.id)}">글 삭제</button></div>
        <div class="comments">
          ${cms.map(commentHTML).join('')}
          <form class="comment-form cnew" data-id="${esc(p.id)}">
            <textarea maxlength="${APP.commentMaxLength}" placeholder="코멘트를 남겨 주세요 (${APP.commentMaxLength}자 이내)"></textarea>
            <div class="row" style="justify-content:space-between"><span class="counter">0 / ${APP.commentMaxLength}</span>
              <button class="btn sm primary" type="submit">코멘트 등록</button></div>
          </form>
        </div>
      </article>`;
  }).join('');
}

['#pStatus', '#pMember'].forEach((s) => $(s).addEventListener('change', renderPosts));
$$('input[name="ptype"]').forEach((r) => r.addEventListener('change', renderPosts));
$('#pSearch').addEventListener('input', renderPosts);

$('#postList').addEventListener('input', (ev) => {
  if (ev.target.tagName !== 'TEXTAREA') return;
  const counter = ev.target.closest('form').querySelector('.counter');
  const n = ev.target.value.length;
  counter.textContent = `${n} / ${APP.commentMaxLength}`;
  counter.classList.toggle('over', n > APP.commentMaxLength);
});

$('#postList').addEventListener('click', async (ev) => {
  const t = ev.target;
  const stBtn = t.closest('[data-status]');
  const delPost = t.closest('[data-delpost]');
  const editC = t.closest('[data-editc]');
  const delC = t.closest('[data-delc]');
  const cancelC = t.closest('[data-cancelc]');
  if (stBtn) {
    await busy(stBtn, async () => {
      await setPostStatus(stBtn.dataset.id, stBtn.dataset.status);
      const p = S.posts.find((x) => x.id === stBtn.dataset.id);
      p.status = stBtn.dataset.status;
      renderPosts();
      renderProgress();
      toast('상태를 바꿨습니다.', 'ok');
    }, authErrorMessage);
  } else if (delPost) {
    if (!confirm('이 포스팅과 달린 코멘트를 모두 삭제할까요? 미션 기록에서도 빠집니다.')) return;
    await busy(delPost, async () => {
      await deletePost(delPost.dataset.delpost);
      S.posts = S.posts.filter((p) => p.id !== delPost.dataset.delpost);
      S.comments = S.comments.filter((c) => c.postId !== delPost.dataset.delpost);
      renderPosts();
      renderProgress();
      toast('삭제했습니다.');
    }, authErrorMessage);
  } else if (editC) {
    const form = $(`form.cedit[data-cid="${CSS.escape(editC.dataset.editc)}"]`);
    form.hidden = false;
    const ta = form.querySelector('textarea');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  } else if (cancelC) {
    cancelC.closest('form').hidden = true;
  } else if (delC) {
    if (!confirm('이 코멘트를 삭제할까요?')) return;
    await busy(delC, async () => {
      await deleteComment(delC.dataset.delc);
      S.comments = S.comments.filter((c) => c.id !== delC.dataset.delc);
      renderPosts();
      toast('삭제했습니다.');
    }, authErrorMessage);
  }
});

$('#postList').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const ta = form.querySelector('textarea');
  const btn = form.querySelector('[type="submit"]');
  if (form.classList.contains('cnew')) {
    const post = S.posts.find((p) => p.id === form.dataset.id);
    await busy(btn, async () => {
      const cm = await addComment(post, ta.value);
      S.comments.push(cm);
      renderPosts();
      toast('코멘트를 남겼습니다.', 'ok');
    }, authErrorMessage);
  } else if (form.classList.contains('cedit')) {
    await busy(btn, async () => {
      await editComment(form.dataset.cid, ta.value);
      const cm = S.comments.find((c) => c.id === form.dataset.cid);
      Object.assign(cm, { text: ta.value.trim(), readAt: null, reaction: '' });
      renderPosts();
      toast('수정했습니다. (챌린지원에게 다시 새 코멘트로 표시됩니다)', 'ok');
    }, authErrorMessage);
  }
});

/* ── 방문자 추이 ──────────────────────────────────────── */
function visitRange() {
  const c = cohort();
  const t = today();
  if (!c) return { from: addDays(t, -29), to: t };
  return { from: c.startDate, to: t < c.startDate ? c.startDate : t > c.endDate ? c.endDate : t };
}

function deltaHTML(d) {
  if (d == null) return '-';
  return `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toLocaleString()}</span>`;
}

function renderVisits() {
  const { from, to } = visitRange();
  const target = $('#vTarget').value;
  const visits = target === '__sum' ? S.visits : S.visits.filter((v) => v.uid === target);
  const series = visitSeries(visits, from, to);
  const st = seriesStats(series);
  $('#vTiles').innerHTML = `
    <div class="tile"><div class="lbl">최근 기록</div><div class="val">${st.last == null ? '-' : st.last.toLocaleString()}<small> 명</small></div></div>
    <div class="tile"><div class="lbl">직전 대비</div><div class="val">${deltaHTML(st.delta)}</div></div>
    <div class="tile"><div class="lbl">평균</div><div class="val">${st.avg == null ? '-' : st.avg.toLocaleString()}<small> 명</small></div></div>
    <div class="tile"><div class="lbl">최고</div><div class="val">${st.max == null ? '-' : st.max.toLocaleString()}<small> 명</small></div></div>`;
  $('#vChart').innerHTML = lineChart(series, { label: '방문자' });

  const rows = participants().map((p) => {
    const s = visitSeries(S.visits.filter((v) => v.uid === p.uid), from, to);
    return Object.assign({ p }, seriesStats(s));
  });
  $('#vTable').innerHTML = !rows.length ? '<div class="empty">참여자가 없습니다.</div>' : `
    <table><thead><tr><th>이름</th><th>블로그</th><th class="num">최근</th><th class="num">직전 대비</th><th class="num">평균</th><th class="num">최고</th><th class="num">기록 일수</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.p.name)}${tag(r.p)}</td>
      <td>${blogCell(r.p.member)}</td>
      <td class="num">${r.last == null ? '-' : r.last.toLocaleString()}</td><td class="num">${deltaHTML(r.delta)}</td>
      <td class="num">${r.avg == null ? '-' : r.avg.toLocaleString()}</td><td class="num">${r.max == null ? '-' : r.max.toLocaleString()}</td>
      <td class="num">${r.n}</td><td><button class="btn sm" type="button" data-vsel="${esc(r.p.uid)}">그래프</button>
        ${r.p.member && naverBlogId(r.p.member.blogUrl) ? `<button class="btn sm" type="button" data-vsync="${esc(r.p.uid)}" ${S.apiEnabled ? '' : 'disabled'}>🔄</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
  $('#vSyncAll').disabled = !S.apiEnabled;
  const naverCount = rows.filter((r) => r.p.member && naverBlogId(r.p.member.blogUrl)).length;
  $('#vSyncNote').hidden = false;
  $('#vSyncNote').textContent = S.apiEnabled
    ? `네이버 블로그로 등록된 챌린지원 ${naverCount}명 / ${rows.length}명`
    : '네이버 자동 가져오기는 Vercel 환경변수 FIREBASE_SERVICE_ACCOUNT 를 등록해야 동작합니다.';
}

function blogCell(m) {
  if (!m || !m.blogUrl) return '<span class="faint">-</span>';
  const id = naverBlogId(m.blogUrl);
  return `<a href="${esc(m.blogUrl)}" target="_blank" rel="noopener noreferrer">${id ? `<span class="badge ok">N</span> ${esc(id)}` : '열기'}</a>`;
}

function syncReport(r) {
  if (!r.total) return '네이버 블로그 주소가 등록된 챌린지원이 없습니다.';
  const fail = r.failed.length ? ` · 실패 ${r.failed.length}명: ${r.failed.map((f) => `${f.name}(${f.error})`).join(', ')}` : '';
  return `네이버에서 ${r.ok}/${r.total}명 가져왔습니다${fail}`;
}

$('#vSyncAll').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
  const r = await syncNaverVisitors({ cohortId: S.cohortId });
  S.visits = await listVisitsByCohort(S.cohortId);
  renderVisits();
  $('#vSyncNote').textContent = syncReport(r);
  toast(`${r.ok}/${r.total}명 가져옴`, r.failed.length ? 'bad' : 'ok');
}, authErrorMessage));

$('#vTarget').addEventListener('change', renderVisits);
$('#vTable').addEventListener('click', async (ev) => {
  const sync = ev.target.closest('[data-vsync]');
  if (sync) {
    await busy(sync, async () => {
      const r = await syncNaverVisitors({ uid: sync.dataset.vsync });
      S.visits = await listVisitsByCohort(S.cohortId);
      renderVisits();
      toast(r.ok ? '네이버에서 가져왔습니다.' : syncReport(r), r.ok ? 'ok' : 'bad');
    }, authErrorMessage);
    return;
  }
  const b = ev.target.closest('[data-vsel]');
  if (!b) return;
  $('#vTarget').value = b.dataset.vsel;
  renderVisits();
  $('#vChart').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* ── 챌린지원 관리 ────────────────────────────────────── */
function genPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}
$('#genPw').addEventListener('click', () => { $('#mPw').value = genPassword(); });

function appendHandout(loginId, pw, title = '로그인 안내') {
  const text = `[${APP.title}] ${title}\n주소: ${location.origin}\n아이디: ${loginId}\n비밀번호: ${pw}\n※ 로그인 후 맨 아래 [비밀번호 변경]에서 바꿀 수 있어요.\n`;
  const ta = $('#handout');
  ta.value = (ta.value ? ta.value + '\n' : '') + text;
  ta.scrollTop = ta.scrollHeight;
}
$('#copyHandout').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#handout').value); toast('복사했습니다.', 'ok'); } catch (_) { $('#handout').select(); toast('복사 단축키(Ctrl/⌘+C)로 복사해 주세요.'); }
});
$('#clearHandout').addEventListener('click', () => { $('#handout').value = ''; });

function cohortOptions(selected, { withNone } = {}) {
  return (withNone ? `<option value="" ${!selected ? 'selected' : ''}>(기수 없음)</option>` : '') +
    S.cohorts.map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}${c.id === S.meta.activeCohortId ? ' (활성)' : ''}</option>`).join('');
}

async function createOne(loginId, pw, name, cohortId, blogUrl) {
  const id = normalizeLoginId(loginId);
  const msg = validateLoginId(id) || validatePassword(pw);
  if (msg) throw new Error(`${loginId}: ${msg}`);
  const m = await createMember({ loginId: id, password: pw, name, cohortId, blogUrl });
  S.members.push(m);
  appendHandout(id, pw);
  return m;
}

$('#mForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const blog = $('#mBlog').value.trim();
  const blogUrl = blog ? normalizeUrl(blog) : '';
  if (blog && !blogUrl) { toast('블로그 주소가 올바르지 않습니다.', 'bad'); return; }
  await busy($('#mBtn'), async () => {
    await createOne($('#mId').value, $('#mPw').value, $('#mName').value, $('#mCohort').value, blogUrl);
    $('#mForm').reset();
    $('#mCohort').value = S.cohortId;
    renderMembers();
    renderAllCohortViews();
    toast('계정을 만들었습니다. 오른쪽 안내문을 전달해 주세요.', 'ok');
  }, authErrorMessage);
});

$('#bulkBtn').addEventListener('click', async (ev) => {
  const lines = $('#bulkText').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { toast('내용을 입력해 주세요.'); return; }
  const cohortId = $('#mCohort').value;
  await busy(ev.currentTarget, async () => {
    const fails = [];
    let ok = 0;
    for (const line of lines) {
      const [id, pw, name] = line.split(/[,\t]/).map((s) => (s || '').trim());
      try {
        await createOne(id, pw || genPassword(), name, cohortId, '');
        ok++;
      } catch (e) {
        fails.push(`${id || line}: ${authErrorMessage(e).replace(`${id}: `, '')}`);
      }
    }
    $('#bulkText').value = fails.join('\n');
    renderMembers();
    renderAllCohortViews();
    toast(`${ok}명 생성${fails.length ? `, ${fails.length}건 실패(입력칸에 남겨 둠)` : ''}`, fails.length ? 'bad' : 'ok');
  });
});

function renderMembers() {
  const all = $('#mAll').checked;
  const list = S.members.filter((m) => all || m.cohortId === S.cohortId);
  $('#apiNotice').hidden = S.apiEnabled;
  $('#mTable').innerHTML = !list.length ? '<div class="empty">챌린지원이 없습니다.</div>' : `
    <table><thead><tr><th>이름</th><th>아이디</th><th>기수</th><th>블로그</th><th>생성일</th><th></th></tr></thead>
    <tbody>${list.map((m) => `<tr data-uid="${esc(m.id)}">
      <td><b>${esc(m.name || m.loginId)}</b></td>
      <td>${esc(m.loginId)}</td>
      <td><select class="mc" style="width:auto;padding:4px 8px">${cohortOptions(m.cohortId, { withNone: true })}</select></td>
      <td>${m.blogUrl ? `<a href="${esc(m.blogUrl)}" target="_blank" rel="noopener noreferrer">열기</a>` : '<span class="faint">-</span>'}</td>
      <td class="faint">${esc(fmtDateTime(m.createdAt))}</td>
      <td>
        <button class="btn sm" type="button" data-medit>수정</button>
        <button class="btn sm" type="button" data-mpw ${S.apiEnabled ? '' : 'disabled title="서버 설정 필요"'}>비번 재설정</button>
        <button class="btn sm danger" type="button" data-mdel>삭제</button>
      </td></tr>`).join('')}</tbody></table>`;
}
$('#mAll').addEventListener('change', renderMembers);

$('#mTable').addEventListener('change', async (ev) => {
  if (!ev.target.classList.contains('mc')) return;
  const uid = ev.target.closest('tr').dataset.uid;
  const m = S.members.find((x) => x.id === uid);
  await busy(ev.target, async () => {
    await updateMember(uid, { cohortId: ev.target.value });
    m.cohortId = ev.target.value;
    renderMembers();
    renderAllCohortViews();
    toast('기수를 옮겼습니다.', 'ok');
  }, authErrorMessage);
});

$('#mTable').addEventListener('click', async (ev) => {
  const tr = ev.target.closest('tr[data-uid]');
  if (!tr) return;
  const m = S.members.find((x) => x.id === tr.dataset.uid);
  const btn = ev.target.closest('button');
  if (!btn) return;
  if (btn.hasAttribute('data-medit')) {
    const name = prompt('표시 이름', m.name || m.loginId);
    if (name == null) return;
    const blog = prompt('블로그 주소 (비우면 삭제)', m.blogUrl || '');
    if (blog == null) return;
    const blogUrl = blog.trim() ? normalizeUrl(blog) : '';
    if (blog.trim() && !blogUrl) { toast('블로그 주소가 올바르지 않습니다.', 'bad'); return; }
    await busy(btn, async () => {
      const patch = { name: name.trim().slice(0, 30) || m.loginId, blogUrl };
      await updateMember(m.id, patch);
      Object.assign(m, patch);
      renderMembers();
      renderAllCohortViews();
      toast('수정했습니다.', 'ok');
    }, authErrorMessage);
  } else if (btn.hasAttribute('data-mpw')) {
    const pw = prompt(`${m.loginId} 님의 새 비밀번호 (6자 이상)`, genPassword());
    if (pw == null) return;
    await busy(btn, async () => {
      await resetPasswordViaApi(m.id, pw);
      appendHandout(m.loginId, pw, '비밀번호 재설정 안내');
      toast('비밀번호를 바꿨습니다. 안내문을 전달해 주세요.', 'ok');
    });
  } else if (btn.hasAttribute('data-mdel')) {
    if (!confirm(`${m.name || m.loginId} 님을 삭제할까요?\n(작성한 포스팅 기록은 남습니다)`)) return;
    await busy(btn, async () => {
      const { authDeleted } = await deleteMember(m.id);
      S.members = S.members.filter((x) => x.id !== m.id);
      renderMembers();
      renderAllCohortViews();
      toast(authDeleted ? '삭제했습니다.' : '삭제했습니다. 같은 아이디를 다시 쓰려면 Firebase 콘솔 Authentication 에서 계정도 지워 주세요.', 'ok');
    });
  }
});

/* ── 기수 · 미션 설정 ─────────────────────────────────── */
function fillCohortForms() {
  const c = cohort();
  $('#editCohortCard').hidden = !c;
  if (c) {
    const g = normalizeGoals(c.goals);
    $('#cName').value = c.name || '';
    $('#cStart').value = c.startDate || '';
    $('#cEnd').value = c.endDate || '';
    $('#cDaily').value = g.daily;
    $('#cWeekly').value = g.weekly;
    $('#cMonthly').value = g.monthly;
    const active = c.id === S.meta.activeCohortId;
    $('#activeMark').innerHTML = active ? '<span class="badge ok">활성 기수</span>' : '<span class="badge">비활성</span>';
    $('#cActivate').hidden = active;
  }
  // 새 기수 기본값: 지금 기수 다음 날부터 4주, 목표는 그대로
  const start = c && isISODate(c.endDate) && c.endDate >= today() ? addDays(c.endDate, 1) : today();
  const g = normalizeGoals(c ? c.goals : APP.defaultGoals);
  $('#nName').value = `${S.cohorts.length + 1}기`;
  $('#nStart').value = start;
  $('#nEnd').value = addDays(start, 27);
  $('#nDaily').value = g.daily;
  $('#nWeekly').value = g.weekly;
  $('#nMonthly').value = g.monthly;
  $('#nMove').parentElement.hidden = !c;
  $('#wipeBtn').disabled = !c;
  $('#delCohortBtn').disabled = !c;
}

function readCohortForm(p) {
  const data = {
    name: $(`#${p}Name`).value.trim().slice(0, 30),
    startDate: $(`#${p}Start`).value,
    endDate: $(`#${p}End`).value,
    goals: normalizeGoals({ daily: $(`#${p}Daily`).value, weekly: $(`#${p}Weekly`).value, monthly: $(`#${p}Monthly`).value })
  };
  if (!data.name) throw new Error('기수 이름을 입력해 주세요.');
  if (!isISODate(data.startDate) || !isISODate(data.endDate)) throw new Error('시작일과 종료일을 입력해 주세요.');
  if (data.startDate > data.endDate) throw new Error('종료일이 시작일보다 빠릅니다.');
  return data;
}

$('#cForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  await busy($('#cSave'), async () => {
    const data = readCohortForm('c');
    await updateCohort(S.cohortId, data);
    Object.assign(cohort(), data);
    renderCohortSelect();
    renderAllCohortViews();
    toast('미션 설정을 저장했습니다.', 'ok');
  }, authErrorMessage);
});

$('#cActivate').addEventListener('click', async (ev) => {
  await busy(ev.currentTarget, async () => {
    await setActiveCohort(S.cohortId);
    S.meta.activeCohortId = S.cohortId;
    renderCohortSelect();
    fillCohortForms();
    toast('활성 기수로 지정했습니다.', 'ok');
  }, authErrorMessage);
});

$('#nForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  await busy($('#nBtn'), async () => {
    const data = readCohortForm('n');
    if (S.cohorts.some((c) => c.name === data.name)) throw new Error('같은 이름의 기수가 이미 있습니다.');
    const prevId = S.cohortId;
    const id = await createCohort(data);
    if ($('#nActivate').checked) { await setActiveCohort(id); S.meta.activeCohortId = id; }
    let moved = 0;
    if (prevId && $('#nMove').checked) {
      for (const m of S.members.filter((x) => x.cohortId === prevId)) {
        await updateMember(m.id, { cohortId: id });
        m.cohortId = id;
        moved++;
      }
    }
    S.cohorts = await listCohorts();
    await selectCohort(id);
    toast(`${data.name}을(를) 만들었습니다.${moved ? ` 챌린지원 ${moved}명을 옮겼습니다.` : ''}`, 'ok');
  }, authErrorMessage);
});

$('#wipeBtn').addEventListener('click', async (ev) => {
  const c = cohort();
  const typed = prompt(`[${c.name}]의 포스팅 ${S.posts.length}개, 코멘트 ${S.comments.length}개, 방문자 기록 ${S.visits.length}개를 모두 삭제합니다.\n계속하려면 기수 이름 "${c.name}"을 정확히 입력하세요.`);
  if (typed == null) return;
  if (typed.trim() !== c.name) { toast('기수 이름이 일치하지 않아 취소했습니다.'); return; }
  const btn = ev.currentTarget;
  await busy(btn, async () => {
    const n = await wipeCohortData(c.id, (done) => { btn.textContent = `삭제 중… ${done}`; });
    btn.textContent = '이 기수 기록 초기화';
    await selectCohort(c.id);
    toast(`${n}건을 삭제했습니다.`, 'ok');
  }, authErrorMessage);
  btn.textContent = '이 기수 기록 초기화';
});

$('#delCohortBtn').addEventListener('click', async (ev) => {
  const c = cohort();
  if (c.id === S.meta.activeCohortId) { toast('활성 기수는 삭제할 수 없습니다. 다른 기수를 먼저 활성으로 지정해 주세요.', 'bad'); return; }
  const n = S.members.filter((m) => m.cohortId === c.id).length;
  if (n) { toast(`이 기수에 챌린지원 ${n}명이 있습니다. 먼저 다른 기수로 옮기거나 삭제해 주세요.`, 'bad'); return; }
  const typed = prompt(`[${c.name}] 기수와 그 기록을 모두 삭제합니다. 계속하려면 "${c.name}"을 입력하세요.`);
  if (typed == null || typed.trim() !== c.name) return;
  await busy(ev.currentTarget, async () => {
    await deleteCohort(c.id);
    S.cohorts = await listCohorts();
    await selectCohort(S.meta.activeCohortId || (S.cohorts[0] && S.cohorts[0].id) || '');
    toast('기수를 삭제했습니다.', 'ok');
  }, authErrorMessage);
});

function renderAdmins() {
  $('#adminList').innerHTML = APP.adminEmails.map((e) => `<span class="badge" style="margin-right:4px">${esc(e)}${e.toLowerCase() === String(S.user.email).toLowerCase() ? ' (나)' : ''}</span>`).join('');
}

/* ── 기수 선택 / 로딩 ─────────────────────────────────── */
function renderCohortSelect() {
  $('#cohortSel').innerHTML = S.cohorts.length ? cohortOptions(S.cohortId) : '<option value="">(기수 없음)</option>';
  $('#mCohort').innerHTML = cohortOptions(S.cohortId, { withNone: true });
  $('#mCohort').value = S.cohortId;
  $('#noCohortNotice').hidden = S.cohorts.length > 0;
}

function renderSelectors() {
  const ps = participants();
  const keepM = $('#pMember').value;
  $('#pMember').innerHTML = '<option value="">전체</option>' + ps.map((p) => `<option value="${esc(p.uid)}">${esc(p.name)}</option>`).join('');
  $('#pMember').value = ps.some((p) => p.uid === keepM) ? keepM : '';
  const keepV = $('#vTarget').value;
  $('#vTarget').innerHTML = '<option value="__sum">전체 합계</option>' + ps.map((p) => `<option value="${esc(p.uid)}">${esc(p.name)}</option>`).join('');
  $('#vTarget').value = ps.some((p) => p.uid === keepV) ? keepV : '__sum';
}

function renderAllCohortViews() {
  renderSelectors();
  renderProgress();
  renderPosts();
  renderVisits();
}

async function selectCohort(id) {
  S.cohortId = id;
  store.set('cohort', id);
  if (id) {
    [S.posts, S.comments, S.visits] = await Promise.all([listPostsByCohort(id), listCommentsByCohort(id), listVisitsByCohort(id)]);
  } else {
    S.posts = []; S.comments = []; S.visits = [];
  }
  const c = cohort();
  const t = today();
  $('#refDate').value = c ? (t < c.startDate ? c.startDate : t > c.endDate ? c.endDate : t) : t;
  renderCohortSelect();
  fillCohortForms();
  renderMembers();
  renderAllCohortViews();
}
$('#cohortSel').addEventListener('change', (ev) => busy(ev.target, () => selectCohort(ev.target.value), authErrorMessage));

async function loadAll(preferId) {
  const [cohorts, meta, members, apiEnabled] = await Promise.all([
    listCohorts(), getAppMeta(), listMembers(), isAdminApiEnabled()
  ]);
  Object.assign(S, { cohorts, meta, members, apiEnabled });
  const ids = cohorts.map((c) => c.id);
  const pick = [preferId, store.get('cohort'), meta.activeCohortId, ids[0]].find((x) => x && ids.includes(x)) || '';
  renderAdmins();
  await selectCohort(pick);
}
$('#reloadBtn').addEventListener('click', (ev) => busy(ev.currentTarget, async () => { await loadAll(S.cohortId); toast('새로 불러왔습니다.'); }, authErrorMessage));

async function boot() {
  const { user, profile } = await requireRole('admin');
  S.user = user;
  S.me = profile;
  $('#who').textContent = `${profile.loginId} 님`;
  await loadAll();
  showTab(S.cohorts.length ? (store.get('tab') || 'progress') : 'cohorts');
  $('#main').hidden = false;
}

boot().catch((e) => {
  if (!/로그인 필요|권한 없음/.test(e.message)) { console.error(e); toast(authErrorMessage(e), 'bad'); $('#main').hidden = false; }
});
