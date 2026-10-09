/* 로그인 화면 — 아이디/비밀번호로 로그인하고 역할(관리자/챌린지원)에 따라 이동한다 */
import { APP } from './config.js';
import { ready, login, logout, currentUser, getRole, isSetupDone, createFirstAdmin, authErrorMessage } from './firebase.js';
import { $ } from './ui.js';

$('#appTitle').textContent = APP.title;

async function goByRole(uid) {
  const { role } = await getRole(uid);
  if (role === 'admin') location.replace('admin.html');
  else if (role === 'member') location.replace('member.html');
  else {
    await logout();
    $('#loginErr').textContent = '등록되지 않은 계정입니다. 관리자에게 문의해 주세요.';
  }
}

async function boot() {
  try {
    await ready();
  } catch (e) {
    $('#loginErr').textContent = e.message;
    $('#loginBtn').disabled = true;
    return;
  }
  const user = await currentUser();
  if (user) { await goByRole(user.uid); return; }
  try {
    if (!(await isSetupDone())) $('#setupBox').hidden = false;
  } catch (e) {
    console.warn(e);
  }
}

$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('#loginBtn');
  $('#loginErr').textContent = '';
  btn.disabled = true;
  try {
    const cred = await login($('#loginId').value, $('#loginPw').value);
    await goByRole(cred.user.uid);
  } catch (e) {
    $('#loginErr').textContent = authErrorMessage(e);
  } finally {
    btn.disabled = false;
  }
});

$('#setupForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('#setupErr');
  err.textContent = '';
  if ($('#setupPw').value !== $('#setupPw2').value) { err.textContent = '비밀번호 확인이 일치하지 않습니다.'; return; }
  const btn = $('#setupBtn');
  btn.disabled = true;
  try {
    await createFirstAdmin($('#setupId').value, $('#setupPw').value);
    location.replace('admin.html');
  } catch (e) {
    err.textContent = authErrorMessage(e);
  } finally {
    btn.disabled = false;
  }
});

boot();
