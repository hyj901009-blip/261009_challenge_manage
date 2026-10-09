/* Firebase 어댑터 — 인증(아이디/비밀번호)과 Firestore 읽기·쓰기를 한 곳에 모은다.
 *
 * Spark(무료) 요금제에서 쓰는 것만 사용: Authentication(이메일/비밀번호) + Cloud Firestore.
 * Cloud Functions·Storage 는 쓰지 않는다.
 *
 * 컬렉션 구조
 *   setup/admin         { uid, createdAt }                     ← 최초 관리자 생성 여부 (1회용)
 *   admins/{uid}        { loginId, createdAt }
 *   meta/app            { activeCohortId }
 *   cohorts/{id}        { name, startDate, endDate, goals:{daily,weekly,monthly}, status, createdAt }
 *   members/{uid}       { loginId, name, cohortId, blogUrl, createdAt }
 *   posts/{id}          { uid, loginId, name, cohortId, url, title, postDate, type:'review'|'free',
 *                         status:'pending'|'approved'|'revise'|'free', memo, createdAt, updatedAt, reviewedAt }
 *   comments/{id}       { postId, memberUid, cohortId, text, createdAt, reaction, readAt }
 *   visits/{uid_date}   { uid, cohortId, date, count, updatedAt }   ← 블로그 일 방문자 수
 */
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider, connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, writeBatch, serverTimestamp, connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { FIREBASE_CONFIG, APP } from './config.js';
import { normalizeLoginId, validateLoginId, validatePassword } from './utils.js';

/* ── 초기화 ─────────────────────────────────────────────── */
/* 로컬 개발: localhost 에서 ?emulator=1 로 열면 Firebase 에뮬레이터(Auth 9099, Firestore 8080)에 붙는다.
 * 실제 프로젝트 없이 화면·보안 규칙을 시험해 볼 수 있다. (README 참고) */
const USE_EMULATOR = (() => {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return false;
  try {
    const q = new URLSearchParams(location.search).get('emulator');
    if (q != null) sessionStorage.setItem('bc.emulator', q === '0' ? '' : '1');
    return !!sessionStorage.getItem('bc.emulator');
  } catch (_) {
    return false;
  }
})();

async function loadConfig() {
  if (USE_EMULATOR) return { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-blog-challenge', appId: 'demo' };
  if (FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.apiKey) return FIREBASE_CONFIG;
  try {
    const res = await fetch('/api/firebase-config', { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && cfg.projectId && cfg.apiKey) return cfg;
    }
  } catch (_) { /* 정적 서버로 띄운 경우 /api 가 없다 */ }
  throw new Error('Firebase 설정이 비어 있습니다. js/config.js 를 채우거나 Vercel 환경변수를 등록해 주세요.');
}

let cfg, app, auth, db;
const readyPromise = (async () => {
  cfg = await loadConfig();
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
  if (USE_EMULATOR) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
})();
export const ready = () => readyPromise;

const col = (name) => collection(db, name);
const ref = (name, id) => doc(db, name, id);
const withId = (snap) => Object.assign({ id: snap.id }, snap.data());

/* ── 아이디 ↔ 내부 메일 ─────────────────────────────────── */
/** 한글 아이디를 SHA-256 해시로 바꿔 Firebase 가 받아 주는 메일 형태로 만든다. */
export async function loginIdToEmail(loginId) {
  const bytes = new TextEncoder().encode(normalizeLoginId(loginId));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `u${hex.slice(0, 40)}@${APP.idEmailDomain}`;
}

export function authErrorMessage(err) {
  const code = (err && err.code) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return '아이디 또는 비밀번호가 올바르지 않습니다.';
  if (/too-many-requests/.test(code)) return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (/email-already-in-use/.test(code)) return '이미 사용 중인 아이디입니다.';
  if (/weak-password/.test(code)) return '비밀번호는 6자 이상이어야 합니다.';
  if (/operation-not-allowed/.test(code)) return 'Firebase 콘솔에서 [Authentication → 이메일/비밀번호] 로그인을 사용 설정해 주세요.';
  if (/requires-recent-login/.test(code)) return '보안을 위해 다시 로그인한 뒤 시도해 주세요.';
  if (/network-request-failed/.test(code)) return '네트워크 연결을 확인해 주세요.';
  if (/permission-denied/.test(code)) return '권한이 없습니다. (Firestore 보안 규칙을 배포했는지 확인해 주세요)';
  return (err && err.message) || '알 수 없는 오류가 발생했습니다.';
}

/* ── 인증 ───────────────────────────────────────────────── */
export async function login(loginId, password) {
  await ready();
  const id = normalizeLoginId(loginId);
  const msg = validateLoginId(id);
  if (msg) throw new Error(msg);
  return signInWithEmailAndPassword(auth, await loginIdToEmail(id), password);
}

export async function logout() {
  await ready();
  return signOut(auth);
}

/** 로그인 상태가 처음 확정될 때 한 번 user(또는 null)를 돌려준다 */
export async function currentUser() {
  await ready();
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (user) => { off(); resolve(user); });
  });
}

/** uid 의 역할: { role:'admin'|'member'|null, profile } */
export async function getRole(uid) {
  await ready();
  const a = await getDoc(ref('admins', uid));
  if (a.exists()) return { role: 'admin', profile: withId(a) };
  const m = await getDoc(ref('members', uid));
  if (m.exists()) return { role: 'member', profile: withId(m) };
  return { role: null, profile: null };
}

export async function changeMyPassword(currentPw, newPw) {
  await ready();
  const msg = validatePassword(newPw);
  if (msg) throw new Error(msg);
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPw));
  await updatePassword(user, newPw);
}

/**
 * 관리자가 다른 사람 계정을 만든다. 기본 앱으로 만들면 관리자 본인이 로그아웃되므로
 * 잠깐 쓰고 버리는 보조 앱 인스턴스에서 계정을 만든다(서버 없이 Spark 요금제에서 동작).
 */
async function createAuthAccount(loginId, password) {
  await ready();
  const id = normalizeLoginId(loginId);
  const msg = validateLoginId(id) || validatePassword(password);
  if (msg) throw new Error(msg);
  const sec = initializeApp(cfg, 'secondary-' + Date.now());
  try {
    const secAuth = getAuth(sec);
    if (USE_EMULATOR) connectAuthEmulator(secAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const cred = await createUserWithEmailAndPassword(secAuth, await loginIdToEmail(id), password);
    await signOut(secAuth);
    return { uid: cred.user.uid, loginId: id };
  } finally {
    await deleteApp(sec);
  }
}

/* ── 최초 관리자 ─────────────────────────────────────────── */
export async function isSetupDone() {
  await ready();
  return (await getDoc(ref('setup', 'admin'))).exists();
}

export async function createFirstAdmin(loginId, password) {
  await ready();
  const id = normalizeLoginId(loginId);
  const msg = validateLoginId(id) || validatePassword(password);
  if (msg) throw new Error(msg);
  const cred = await createUserWithEmailAndPassword(auth, await loginIdToEmail(id), password);
  const uid = cred.user.uid;
  const batch = writeBatch(db);
  batch.set(ref('admins', uid), { loginId: id, createdAt: serverTimestamp() });
  batch.set(ref('setup', 'admin'), { uid, createdAt: serverTimestamp() });
  await batch.commit();
  return uid;
}

/* ── 서버 API (Vercel 함수, 선택) — 비밀번호 재설정·계정 삭제 ─────── */
let apiEnabledCache = null;
export async function isAdminApiEnabled() {
  if (apiEnabledCache != null) return apiEnabledCache;
  try {
    const res = await fetch('/api/admin-users', { cache: 'no-store' });
    apiEnabledCache = res.ok && !!(await res.json()).enabled;
  } catch (_) {
    apiEnabledCache = false;
  }
  return apiEnabledCache;
}

async function adminApi(body) {
  await ready();
  const token = await auth.currentUser.getIdToken();
  const res = await fetch('/api/admin-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

export const resetPasswordViaApi = (uid, password) => {
  const msg = validatePassword(password);
  if (msg) return Promise.reject(new Error(msg));
  return adminApi({ action: 'resetPassword', uid, password });
};

/* ── 관리자 계정 ─────────────────────────────────────────── */
export async function listAdmins() {
  await ready();
  return (await getDocs(col('admins'))).docs.map(withId);
}

export async function createAdmin(loginId, password) {
  const { uid, loginId: id } = await createAuthAccount(loginId, password);
  await setDoc(ref('admins', uid), { loginId: id, createdAt: serverTimestamp() });
  return uid;
}

/* ── 앱 메타 / 기수 ─────────────────────────────────────── */
export async function getAppMeta() {
  await ready();
  const s = await getDoc(ref('meta', 'app'));
  return s.exists() ? s.data() : {};
}

export async function setActiveCohort(cohortId) {
  await ready();
  await setDoc(ref('meta', 'app'), { activeCohortId: cohortId }, { merge: true });
}

export async function listCohorts() {
  await ready();
  return (await getDocs(col('cohorts'))).docs.map(withId)
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
}

export async function getCohort(id) {
  await ready();
  if (!id) return null;
  const s = await getDoc(ref('cohorts', id));
  return s.exists() ? withId(s) : null;
}

export async function createCohort(data) {
  await ready();
  const r = await addDoc(col('cohorts'), Object.assign({ status: 'active', createdAt: serverTimestamp() }, data));
  return r.id;
}

export async function updateCohort(id, patch) {
  await ready();
  await updateDoc(ref('cohorts', id), patch);
}

/** 기수 데이터(포스팅·코멘트·방문자 기록) 전체 삭제. 기수 자체와 멤버 계정은 남긴다. */
export async function wipeCohortData(cohortId, onProgress) {
  await ready();
  let done = 0;
  for (const name of ['comments', 'posts', 'visits']) {
    const snap = await getDocs(query(col(name), where('cohortId', '==', cohortId)));
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
      done += Math.min(400, docs.length - i);
      if (onProgress) onProgress(done);
    }
  }
  return done;
}

export async function deleteCohort(cohortId) {
  await ready();
  await wipeCohortData(cohortId);
  await deleteDoc(ref('cohorts', cohortId));
}

/* ── 챌린지원 ───────────────────────────────────────────── */
export async function listMembers() {
  await ready();
  return (await getDocs(col('members'))).docs.map(withId)
    .sort((a, b) => String(a.name || a.loginId).localeCompare(String(b.name || b.loginId), 'ko'));
}

export async function createMember({ loginId, password, name, cohortId, blogUrl }) {
  const { uid, loginId: id } = await createAuthAccount(loginId, password);
  const body = { loginId: id, name: (name || '').trim() || id, cohortId: cohortId || '', blogUrl: blogUrl || '', createdAt: serverTimestamp() };
  await setDoc(ref('members', uid), body);
  return Object.assign({ id: uid }, body);
}

export async function updateMember(uid, patch) {
  await ready();
  await updateDoc(ref('members', uid), patch);
}

/** 멤버 문서 삭제 (+ 서버 API가 켜져 있으면 로그인 계정도 삭제) */
export async function deleteMember(uid) {
  await ready();
  let authDeleted = false;
  if (await isAdminApiEnabled()) {
    await adminApi({ action: 'deleteUser', uid });
    authDeleted = true;
  }
  await deleteDoc(ref('members', uid));
  return { authDeleted };
}

/* ── 포스팅 ─────────────────────────────────────────────── */
export async function listPostsByCohort(cohortId) {
  await ready();
  return (await getDocs(query(col('posts'), where('cohortId', '==', cohortId)))).docs.map(withId);
}

export async function listMyPosts(uid) {
  await ready();
  return (await getDocs(query(col('posts'), where('uid', '==', uid)))).docs.map(withId);
}

export async function addPost(data) {
  await ready();
  const body = Object.assign({}, data, {
    status: data.type === 'review' ? 'pending' : 'free',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const r = await addDoc(col('posts'), body);
  return r.id;
}

/** 챌린지원 본인 수정 — 검토 요청 글은 다시 '검토 대기'로 돌아간다 */
export async function editMyPost(id, { url, title, postDate, memo, type }) {
  await ready();
  await updateDoc(ref('posts', id), {
    url, title, postDate, memo, type,
    status: type === 'review' ? 'pending' : 'free',
    updatedAt: serverTimestamp()
  });
}

export async function setPostStatus(id, status) {
  await ready();
  await updateDoc(ref('posts', id), { status, reviewedAt: serverTimestamp() });
}

export async function deletePost(id) {
  await ready();
  const snap = await getDocs(query(col('comments'), where('postId', '==', id)));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(ref('posts', id));
  await batch.commit();
}

/** 챌린지원이 자기 글을 지울 때 — 코멘트는 관리자만 지울 수 있어서 글만 지운다 */
export async function deleteMyPost(id) {
  await ready();
  await deleteDoc(ref('posts', id));
}

/* ── 코멘트 ─────────────────────────────────────────────── */
export async function listCommentsByCohort(cohortId) {
  await ready();
  return (await getDocs(query(col('comments'), where('cohortId', '==', cohortId)))).docs.map(withId);
}

export async function listMyComments(uid) {
  await ready();
  return (await getDocs(query(col('comments'), where('memberUid', '==', uid)))).docs.map(withId);
}

export async function addComment(post, text) {
  await ready();
  const t = String(text || '').trim();
  if (!t) throw new Error('코멘트를 입력해 주세요.');
  if (t.length > APP.commentMaxLength) throw new Error(`코멘트는 ${APP.commentMaxLength}자 이내로 입력해 주세요.`);
  const body = { postId: post.id, memberUid: post.uid, cohortId: post.cohortId, text: t, createdAt: serverTimestamp(), reaction: '', readAt: null };
  const r = await addDoc(col('comments'), body);
  return Object.assign({ id: r.id }, body, { createdAt: new Date() });
}

export async function editComment(id, text) {
  await ready();
  const t = String(text || '').trim();
  if (!t || t.length > APP.commentMaxLength) throw new Error(`코멘트는 1~${APP.commentMaxLength}자로 입력해 주세요.`);
  await updateDoc(ref('comments', id), { text: t, readAt: null, reaction: '' });
}

export async function deleteComment(id) {
  await ready();
  await deleteDoc(ref('comments', id));
}

/** 챌린지원: 코멘트 확인 + 반응(따봉/하트 등). reaction '' 이면 확인만 */
export async function reactToComment(id, reaction) {
  await ready();
  await updateDoc(ref('comments', id), { reaction: reaction || '', readAt: serverTimestamp() });
}

/* ── 방문자 수 ──────────────────────────────────────────── */
export async function listVisitsByCohort(cohortId) {
  await ready();
  return (await getDocs(query(col('visits'), where('cohortId', '==', cohortId)))).docs.map(withId);
}

export async function listMyVisits(uid) {
  await ready();
  return (await getDocs(query(col('visits'), where('uid', '==', uid)))).docs.map(withId);
}

export async function saveVisit(uid, cohortId, date, count) {
  await ready();
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0 || n > 9999999) throw new Error('방문자 수는 0 이상의 정수로 입력해 주세요.');
  await setDoc(ref('visits', `${uid}_${date}`), { uid, cohortId, date, count: n, updatedAt: serverTimestamp() });
}

export async function deleteVisit(uid, date) {
  await ready();
  await deleteDoc(ref('visits', `${uid}_${date}`));
}
