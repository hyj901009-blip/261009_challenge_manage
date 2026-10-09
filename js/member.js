/* 챌린지원 대시보드 — 미션 진척 / 순위 / 블로그 글 등록 / 받은 코멘트 + 반응 / 방문자 추이 */
import { APP } from './config.js';
import {
  logout, getCohort, listMyPosts, addPost, editMyPost, deleteMyPost, listMyComments, reactToComment,
  listMyVisits, saveVisit, deleteVisit, authErrorMessage,
  isAdminApiEnabled, syncNaverVisitors, getLeaderboard
} from './firebase.js';
import {
  todayISO, addDays, computeProgress, shortDate, normalizeUrl, isISODate, visitSeries, seriesStats, diffDays, naverBlogId, rankRows
} from './utils.js';
import {
  $, $$, esc, toast, busy, requireRole, progressBlock, dayStrip, lineChart, statusBadge, fmtDateTime,
  tsMillis, reactionOf, POST_TYPE, installTooltips, fmtTime
} from './ui.js';

const S = { user: null, me: null, cohort: null, posts: [], comments: [], visits: [], editingId: null, apiEnabled: false, board: null };
const today = () => todayISO(APP.timezone);

$$('.app-title').forEach((el) => { el.textContent = APP.title; });
$('#logoutBtn').addEventListener('click', async () => { await logout(); location.replace('index.html'); });

/* ── 진척 ─────────────────────────────────────────────── */
function myCohortPosts() {
  return S.posts.filter((p) => p.cohortId === S.me.cohortId);
}

function renderProgress() {
  const c = S.cohort;
  if (!c) {
    $('#progressCard').hidden = true;
    return;
  }
  const t = today();
  const pr = computeProgress(c, myCohortPosts(), t);
  if (!pr.valid) {
    $('#progressCard').innerHTML = '<h2>📈 미션 진척</h2><div class="empty">미션 기간이 아직 설정되지 않았습니다.</div>';
    return;
  }
  const phaseText = pr.phase === 'before' ? `시작까지 D-${diffDays(t, c.startDate)}`
    : pr.phase === 'after' ? '미션 종료' : `${pr.dayNumber}일차 / ${pr.totalDays}일`;
  $('#periodText').textContent = `${shortDate(c.startDate)} ~ ${shortDate(c.endDate)} · ${phaseText}`;

  $('#summaryTiles').innerHTML = `
    <div class="tile"><div class="lbl">총 포스팅</div><div class="val">${pr.totalPosts}<small> 개</small></div></div>
    <div class="tile"><div class="lbl">오늘 포스팅</div><div class="val">${pr.phase === 'running' ? (pr.today.done ? `✅<small> ${pr.today.count}개</small>` : '<small>아직이에요</small>') : '-'}</div></div>
    <div class="tile"><div class="lbl">연속 포스팅</div><div class="val">🔥 ${pr.streak}<small> 일</small></div></div>`;

  $('#progBlocks').innerHTML =
    progressBlock(`위클리 · ${pr.weekly.index}주차`, pr.weekly.count, pr.weekly.goal, `${shortDate(pr.weekly.from)} ~ ${shortDate(pr.weekly.to)} · 주 ${pr.goals.weekly}개 목표`) +
    progressBlock('챌린지 목표', pr.challenge.count, pr.challenge.goal, `${shortDate(pr.challenge.from)} ~ ${shortDate(pr.challenge.to)} · 전체 기간`);

  $('#strip').innerHTML = dayStrip(pr.days, t);
  $('#weekTable').innerHTML = `<table><thead><tr><th>주차</th><th>기간</th><th class="num">달성</th></tr></thead><tbody>${
    pr.weeks.map((w) => `<tr><td>${w.index}주차</td><td>${shortDate(w.from)}~${shortDate(w.to)}</td>
      <td class="num">${w.count}/${w.goal} ${w.done ? '✅' : ''}</td></tr>`).join('')}</tbody></table>`;
}

/* ── 순위 ─────────────────────────────────────────────── */
async function loadRanking() {
  if (!S.cohort) { $('#ranking').hidden = true; return; }
  if (!S.apiEnabled) {
    $('#rankBody').innerHTML = '<div class="empty">순위는 관리자가 서버 설정을 마치면 보입니다.</div>';
    return;
  }
  try {
    S.board = await getLeaderboard();
  } catch (e) {
    console.warn(e);
    $('#rankBody').innerHTML = `<div class="empty">순위를 불러오지 못했습니다. (${esc(e.message)})</div>`;
    return;
  }
  renderRanking();
}

function renderRanking() {
  if (!S.board) return;
  // 내 개수는 방금 등록·삭제한 것까지 반영되도록 화면에서 바로 센 값으로 덮어쓴다 (서버 순위는 5분마다 갱신)
  const mine = computeProgress(S.cohort, myCohortPosts(), today());
  const rows = S.board.rows.map((r) => (r.uid === S.user.uid && mine.valid ? Object.assign({}, r, { count: mine.totalPosts }) : r));
  if (!rows.some((r) => r.uid === S.user.uid) && mine.valid) rows.push({ uid: S.user.uid, name: S.me.name || S.me.loginId, count: mine.totalPosts });
  const ranked = rankRows(rows);
  const max = Math.max(1, ...ranked.map((r) => r.count));
  const me = ranked.find((r) => r.uid === S.user.uid);
  const medal = (n) => (n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : `${n}`);
  $('#rankMeta').textContent = `${ranked.length}명 · ${fmtTime(S.board.updatedAt)} 기준`;
  $('#rankBody').innerHTML = `
    ${me ? `<div class="rank-me">나의 순위 <b>${me.rank}위</b> <span class="faint">/ ${ranked.length}명 · ${me.count}개</span></div>` : ''}
    <ol class="rank-list">${ranked.map((r) => `
      <li class="${r.uid === S.user.uid ? 'me' : ''}">
        <span class="rank-no">${medal(r.rank)}</span>
        <span class="rank-name">${esc(r.name)}${r.uid === S.user.uid ? ' <span class="badge info">나</span>' : ''}</span>
        <span class="rank-bar"><i style="width:${Math.round((r.count / max) * 100)}%"></i></span>
        <span class="rank-cnt"><b>${r.count}</b>개</span>
      </li>`).join('')}</ol>`;
}

/* ── 글 등록 ──────────────────────────────────────────── */
function currentType() { return $('input[name="ptype"]:checked').value; }

function paintTypeHelp() {
  const review = currentType() === 'review';
  $('#typeHelp').textContent = review
    ? '관리자가 글을 읽고 검토 결과와 코멘트를 남겨 줍니다.'
    : '검토 없이 바로 미션으로 기록됩니다. (관리자가 코멘트를 남길 수도 있어요)';
  // '관리자에게 한마디'는 검토 요청일 때만
  $('#memoField').hidden = !review;
}
$$('input[name="ptype"]').forEach((r) => r.addEventListener('change', paintTypeHelp));

function resetForm() {
  S.editingId = null;
  $('#postForm').reset();
  $('#pDate').value = defaultPostDate();
  $('#postBtn').textContent = '등록하기';
  $('#cancelEdit').hidden = true;
  paintTypeHelp();
}
$('#cancelEdit').addEventListener('click', resetForm);

function defaultPostDate() {
  const t = today();
  const c = S.cohort;
  if (c && c.endDate && t > c.endDate) return c.endDate;
  return t;
}

$('#postForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!S.me.cohortId) { toast('참여 기수가 지정되지 않아 등록할 수 없습니다.', 'bad'); return; }
  const url = normalizeUrl($('#pUrl').value);
  if (!url) { toast('올바른 블로그 주소(http/https)를 입력해 주세요.', 'bad'); return; }
  const postDate = $('#pDate').value;
  if (!isISODate(postDate)) { toast('발행일을 선택해 주세요.', 'bad'); return; }
  if (postDate > today()) { toast('미래 날짜로는 등록할 수 없습니다.', 'bad'); return; }
  const c = S.cohort;
  if (c && (postDate < c.startDate || postDate > c.endDate)) {
    toast(`발행일은 미션 기간(${shortDate(c.startDate)} ~ ${shortDate(c.endDate)}) 안에서 골라 주세요.`, 'bad');
    return;
  }
  const data = {
    url,
    title: $('#pTitle').value.trim().slice(0, 120),
    postDate,
    memo: currentType() === 'review' ? $('#pMemo').value.trim().slice(0, 300) : '',
    type: currentType()
  };
  await busy($('#postBtn'), async () => {
    if (S.editingId) {
      await editMyPost(S.editingId, data);
      toast('수정했습니다.', 'ok');
    } else {
      await addPost(Object.assign(data, { uid: S.user.uid, loginId: S.me.loginId, name: S.me.name || S.me.loginId, cohortId: S.me.cohortId }));
      toast(data.type === 'review' ? '검토 요청을 보냈습니다.' : '등록했습니다.', 'ok');
    }
    resetForm();
    S.posts = await listMyPosts(S.user.uid);
    renderAll();
  }, authErrorMessage);
});

/* ── 코멘트 + 반응 ────────────────────────────────────── */
function commentHTML(cm, { withPost } = {}) {
  const unread = !cm.readAt;
  const post = withPost ? S.posts.find((p) => p.id === cm.postId) : null;
  const r = reactionOf(cm.reaction);
  return `
    <div class="comment ${unread ? 'unread' : ''}" data-cid="${esc(cm.id)}">
      ${post ? `<div class="faint">📄 ${esc(post.title || post.url)} · ${shortDate(post.postDate)}</div>` : ''}
      <div class="comment-text">${esc(cm.text)}</div>
      <div class="comment-meta">
        <span>관리자 · ${esc(fmtDateTime(cm.createdAt))}</span>
        ${unread ? '<span class="badge new">NEW</span>' : `<span class="badge ok">확인함 ${r ? r.emoji : ''}</span>`}
      </div>
      <div class="reactions">
        ${APP.reactions.map((x) => `<button type="button" class="react-btn" data-react="${x.key}" aria-pressed="${cm.reaction === x.key}" title="${esc(x.label)}">${x.emoji}</button>`).join('')}
        ${unread ? '<button type="button" class="react-btn" data-react="">✔ 확인</button>' : ''}
      </div>
    </div>`;
}

function sortedComments() {
  return S.comments.slice().sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
}

function renderCommentFeed() {
  const unread = S.comments.filter((c) => !c.readAt).length;
  $('#unreadBadge').hidden = !unread;
  $('#unreadBadge').textContent = `새 코멘트 ${unread}`;
  let list = sortedComments();
  if ($('#onlyUnread').checked) list = list.filter((c) => !c.readAt);
  $('#commentFeed').innerHTML = list.length
    ? list.map((c) => commentHTML(c, { withPost: true })).join('')
    : `<div class="empty">${$('#onlyUnread').checked ? '안 읽은 코멘트가 없습니다. 🎉' : '아직 받은 코멘트가 없습니다.'}</div>`;
}
$('#onlyUnread').addEventListener('change', renderCommentFeed);

document.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.react-btn');
  if (!btn) return;
  const box = btn.closest('[data-cid]');
  const cm = S.comments.find((c) => c.id === box.dataset.cid);
  if (!cm) return;
  // 같은 반응을 다시 누르면 반응만 취소(확인 상태는 유지)
  const next = btn.dataset.react && cm.reaction === btn.dataset.react ? '' : btn.dataset.react;
  await busy(btn, async () => {
    await reactToComment(cm.id, next);
    cm.reaction = next;
    cm.readAt = cm.readAt || new Date();
    renderCommentFeed();
    renderPosts();
    const r = reactionOf(next);
    toast(r ? `${r.emoji} ${r.label}를 남겼어요` : '확인했어요', 'ok');
  }, authErrorMessage);
});

/* ── 내 포스팅 ────────────────────────────────────────── */
function renderPosts() {
  const f = $('#postFilter').value;
  const list = S.posts
    .filter((p) => f === 'all' || p.type === f)
    .sort((a, b) => (b.postDate || '').localeCompare(a.postDate || '') || tsMillis(b.createdAt) - tsMillis(a.createdAt));
  if (!list.length) { $('#postList').innerHTML = '<div class="empty">아직 등록한 글이 없습니다.</div>'; return; }
  $('#postList').innerHTML = list.map((p) => {
    const cms = S.comments.filter((c) => c.postId === p.id).sort((a, b) => tsMillis(a.createdAt) - tsMillis(b.createdAt));
    const unread = cms.some((c) => !c.readAt);
    const other = p.cohortId !== S.me.cohortId ? '<span class="badge">지난 기수</span>' : '';
    const editable = p.status !== 'approved' && p.cohortId === S.me.cohortId;
    return `
      <article class="post ${unread ? 'unread' : ''}">
        <div class="post-head">
          <span class="badge">${esc(POST_TYPE[p.type] || p.type)}</span>${statusBadge(p)}${other}
          <span class="post-meta">${shortDate(p.postDate)} 발행</span>
        </div>
        <div class="post-title" style="margin-top:4px">${esc(p.title || '(제목 없음)')}</div>
        <a class="post-url" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url)}</a>
        ${p.memo ? `<p class="post-memo">${esc(p.memo)}</p>` : ''}
        ${editable ? `<div class="post-actions">
          <button class="btn sm" data-edit="${esc(p.id)}" type="button">수정</button>
          <button class="btn sm danger" data-del="${esc(p.id)}" type="button">삭제</button></div>` : ''}
        ${cms.length ? `<div class="comments">${cms.map((c) => commentHTML(c)).join('')}</div>` : ''}
      </article>`;
  }).join('');
}
$('#postFilter').addEventListener('change', renderPosts);

$('#postList').addEventListener('click', async (ev) => {
  const ed = ev.target.closest('[data-edit]');
  const del = ev.target.closest('[data-del]');
  if (ed) {
    const p = S.posts.find((x) => x.id === ed.dataset.edit);
    S.editingId = p.id;
    $('#pUrl').value = p.url;
    $('#pTitle').value = p.title || '';
    $('#pDate').value = p.postDate;
    $('#pMemo').value = p.memo || '';
    $(`input[name="ptype"][value="${p.type}"]`).checked = true;
    paintTypeHelp();
    $('#postBtn').textContent = '수정 저장';
    $('#cancelEdit').hidden = false;
    $('#postForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (del) {
    const id = del.dataset.del;
    if (S.comments.some((c) => c.postId === id)) { toast('코멘트가 달린 글은 관리자에게 삭제를 요청해 주세요.', 'bad'); return; }
    if (!confirm('이 글을 삭제할까요? 미션 기록에서도 빠집니다.')) return;
    await busy(del, async () => {
      await deleteMyPost(id);
      S.posts = S.posts.filter((p) => p.id !== id);
      renderAll();
      toast('삭제했습니다.');
    }, authErrorMessage);
  }
});

/* ── 방문자 수 ─────────────────────────────────────────── */
function visitRange() {
  const c = S.cohort;
  const t = today();
  if (c && isISODate(c.startDate) && isISODate(c.endDate)) {
    return { from: c.startDate, to: c.endDate }; // 챌린지 기간 전체 — 아직 오지 않은 날은 빈칸
  }
  return { from: addDays(t, -29), to: t };
}

function renderVisits() {
  const { from, to } = visitRange();
  const series = visitSeries(S.visits, from, to);
  const st = seriesStats(series);
  $('#visitTiles').innerHTML = `
    <div class="tile"><div class="lbl">현재 일방문자수${st.lastDate ? ` <span class="faint">(${shortDate(st.lastDate)})</span>` : ''}</div><div class="val">${st.last == null ? '-' : st.last.toLocaleString()}<small> 명</small></div></div>
    <div class="tile"><div class="lbl">평균</div><div class="val">${st.avg == null ? '-' : st.avg.toLocaleString()}<small> 명</small></div></div>
    <div class="tile"><div class="lbl">최고</div><div class="val">${st.max == null ? '-' : st.max.toLocaleString()}<small> 명</small></div></div>`;
  $('#visitChart').innerHTML = lineChart(series, { label: '방문자', today: today() });
}

function fillVisitInput() {
  const v = S.visits.find((x) => x.date === $('#vDate').value);
  $('#vCount').value = v ? v.count : '';
}
$('#vDate').addEventListener('change', fillVisitInput);

$('#visitForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const date = $('#vDate').value;
  if (!isISODate(date) || date > today()) { toast('오늘 이전 날짜를 선택해 주세요.', 'bad'); return; }
  await busy($('#visitBtn'), async () => {
    await saveVisit(S.user.uid, S.me.cohortId || '', date, $('#vCount').value);
    S.visits = await listMyVisits(S.user.uid);
    renderVisits();
    toast('저장했습니다.', 'ok');
  }, authErrorMessage);
});

$('#visitDel').addEventListener('click', async (ev) => {
  const date = $('#vDate').value;
  if (!S.visits.some((v) => v.date === date)) { toast('이 날짜에는 기록이 없습니다.'); return; }
  if (!confirm(`${shortDate(date)} 방문자 기록을 삭제할까요?`)) return;
  await busy(ev.currentTarget, async () => {
    await deleteVisit(S.user.uid, date);
    S.visits = S.visits.filter((v) => v.date !== date);
    fillVisitInput();
    renderVisits();
    toast('삭제했습니다.');
  }, authErrorMessage);
});

/* ── 네이버 블로그 방문자 수 자동 가져오기 ─────────────── */
function paintNaver() {
  const id = naverBlogId(S.me.blogUrl);
  $('#myBlogText').innerHTML = S.me.blogUrl
    ? `<a href="${esc(S.me.blogUrl)}" target="_blank" rel="noopener noreferrer">${esc(S.me.blogUrl)}</a>`
    : '아직 등록되지 않음';
  const btn = $('#naverSync');
  btn.disabled = !id || !S.apiEnabled;
  let help;
  if (!S.me.blogUrl) help = '관리자가 블로그 주소를 등록하면 네이버 블로그 방문자 수를 자동으로 가져옵니다. 그 전에는 아래에 직접 입력해 주세요.';
  else if (!id) help = '네이버 블로그가 아니라서 자동으로 가져올 수 없습니다. 아래 [직접 입력하기]를 이용해 주세요.';
  else if (!S.apiEnabled) help = `네이버 블로그(${id})로 인식했습니다. 서버 설정이 끝나면 자동으로 가져옵니다. 그 전에는 직접 입력해 주세요.`;
  else help = `네이버 블로그(${id})의 최근 5일 방문자 수를 매일 자동으로 가져옵니다. 블로그의 방문자 수가 공개되어 있어야 합니다.`;
  $('#naverHelp').textContent = help;
  // 네이버 자동 수집이 안 되면 직접 입력 칸을 펼쳐 둔다
  $('#manualFold').open = btn.disabled;
}

async function runNaverSync(btn, { silent } = {}) {
  const r = silent
    ? await syncNaverVisitors().catch((e) => { console.warn('네이버 자동 가져오기 실패', e); return null; })
    : await busy(btn, () => syncNaverVisitors(), authErrorMessage);
  if (!r) return;
  const one = r.results && r.results[0];
  if (one && one.ok) {
    S.visits = await listMyVisits(S.user.uid);
    renderVisits();
    fillVisitInput();
    if (!silent) toast(`네이버에서 ${one.days}일치 방문자 수를 가져왔습니다.`, 'ok');
  } else if (!silent) {
    toast((one && one.error) || '가져오지 못했습니다.', 'bad');
  }
}
$('#naverSync').addEventListener('click', (ev) => runNaverSync(ev.currentTarget));

/** 대시보드를 열 때 하루 한 번 조용히 가져온다 (예약 실행이 놓친 날을 보충) */
async function autoNaverSync() {
  if (!S.apiEnabled || !naverBlogId(S.me.blogUrl)) return;
  const key = `bc.naverSync.${S.user.uid}`;
  try { if (localStorage.getItem(key) === today()) return; localStorage.setItem(key, today()); } catch (_) { /* 무시 */ }
  await runNaverSync($('#naverSync'), { silent: true });
}

/* ── 시작 ─────────────────────────────────────────────── */
function renderAll() {
  renderProgress();
  renderRanking();
  renderCommentFeed();
  renderPosts();
  renderVisits();
}

async function boot() {
  const { user, profile } = await requireRole('member');
  S.user = user;
  S.me = profile;
  $('#who').textContent = `${profile.name || profile.loginId} 님`;
  const [cohort, posts, comments, visits, apiEnabled] = await Promise.all([
    getCohort(profile.cohortId),
    listMyPosts(user.uid),
    listMyComments(user.uid),
    listMyVisits(user.uid),
    isAdminApiEnabled()
  ]);
  S.apiEnabled = apiEnabled;
  S.cohort = cohort;
  S.posts = posts;
  S.comments = comments;
  S.visits = visits;
  if (cohort) { $('#cohortTag').hidden = false; $('#cohortTag').textContent = cohort.name; }
  $('#noCohort').hidden = !!cohort;
  $('#pDate').value = defaultPostDate();
  $('#pDate').max = today();
  $('#vDate').value = addDays(today(), -1);
  $('#vDate').max = today();
  fillVisitInput();
  paintTypeHelp();
  paintNaver();
  renderAll();
  installTooltips();
  $('#main').hidden = false;
  autoNaverSync();
  loadRanking();
}

boot().catch((e) => {
  if (!/로그인 필요|권한 없음/.test(e.message)) { console.error(e); toast(authErrorMessage(e), 'bad'); $('#main').hidden = false; }
});
