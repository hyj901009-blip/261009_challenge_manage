/* 서버 함수 공통: 요청 보낸 사람 확인 (Firebase ID 토큰) */
import { APP } from '../../js/config.js';

const ADMIN_EMAILS = APP.adminEmails.map((e) => e.toLowerCase());

export const isAdminEmail = (email) => ADMIN_EMAILS.includes(String(email || '').toLowerCase());

/** 관리자 = Google 로그인 + 이메일 인증 + 목록에 있는 이메일 (firestore.rules 의 isAdmin() 과 같은 기준) */
export const isAdminToken = (t) => !!t && t.email_verified === true
  && !!t.firebase && t.firebase.sign_in_provider === 'google.com'
  && isAdminEmail(t.email);

/** Authorization: Bearer <ID 토큰> 을 검증해 토큰 내용을 돌려준다. 실패하면 응답을 보내고 null. */
export async function verifyCaller(admin, req, res) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: '로그인이 필요합니다.' }); return null; }
  try {
    return await admin.auth.verifyIdToken(token);
  } catch (_) {
    res.status(401).json({ error: '로그인이 만료되었습니다. 다시 로그인해 주세요.' });
    return null;
  }
}

export function readBody(req) {
  if (typeof req.body !== 'string') return req.body || {};
  try { return JSON.parse(req.body); } catch (_) { return {}; }
}
