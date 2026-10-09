/* 로그인 화면 — 챌린지원은 아이디/비밀번호, 관리자는 Google 로그인. 역할에 따라 이동한다 */
import { APP } from './config.js';
import { ready, login, loginWithGoogle, logout, currentUser, getRole, authErrorMessage } from './firebase.js';
import { $ } from './ui.js';

$('#appTitle').textContent = APP.title;

async function goByRole(user, viaGoogle) {
  const { role } = await getRole(user);
  if (role === 'admin') location.replace('admin.html');
  else if (role === 'member') location.replace('member.html');
  else {
    await logout();
    $('#loginErr').textContent = viaGoogle
      ? `${user.email || '이 Google 계정'}은(는) 관리자로 등록되어 있지 않습니다. 챌린지원은 위의 아이디/비밀번호로 로그인해 주세요.`
      : '등록되지 않은 계정입니다. 관리자에게 문의해 주세요.';
  }
}

async function boot() {
  try {
    await ready();
  } catch (e) {
    $('#loginErr').textContent = e.message;
    $('#loginBtn').disabled = true;
    $('#googleBtn').disabled = true;
    return;
  }
  const user = await currentUser();
  if (user) await goByRole(user, user.providerData.some((p) => p.providerId === 'google.com'));
}

async function attempt(btn, fn, viaGoogle) {
  $('#loginErr').textContent = '';
  btn.disabled = true;
  try {
    const cred = await fn();
    await goByRole(cred.user, viaGoogle);
  } catch (e) {
    $('#loginErr').textContent = authErrorMessage(e);
  } finally {
    btn.disabled = false;
  }
}

$('#loginForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  attempt($('#loginBtn'), () => login($('#loginId').value, $('#loginPw').value), false);
});

$('#googleBtn').addEventListener('click', () => attempt($('#googleBtn'), loginWithGoogle, true));

boot();
