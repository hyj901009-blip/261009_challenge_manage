/* 관리자 전용 계정 관리 API (Vercel 서버리스 함수)
 *
 *   GET  /api/admin-users                       → { enabled }  서버 설정 여부
 *   POST /api/admin-users  (Authorization: Bearer <관리자 Firebase ID 토큰>)
 *        { action: 'resetPassword', uid, password }
 *        { action: 'deleteUser', uid }
 *
 * 브라우저(클라이언트 SDK)로는 남의 비밀번호를 바꾸거나 계정을 지울 수 없어서 이 두 가지만 서버에서 한다.
 */
import { getAdmin } from './_lib/firebaseAdmin.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const admin = getAdmin();

  if (req.method === 'GET') return res.status(200).json({ enabled: !!admin });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!admin) return res.status(503).json({ error: '서버에 FIREBASE_SERVICE_ACCOUNT 환경변수가 설정되지 않았습니다.' });

  // 1) 요청한 사람이 관리자인지 확인
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  let caller;
  try {
    caller = await admin.auth.verifyIdToken(token);
  } catch (_) {
    return res.status(401).json({ error: '로그인이 만료되었습니다. 다시 로그인해 주세요.' });
  }
  const isAdmin = (await admin.db.doc(`admins/${caller.uid}`).get()).exists;
  if (!isAdmin) return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });

  // 2) 작업
  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const { action, uid, password } = body;
  if (!uid || typeof uid !== 'string') return res.status(400).json({ error: 'uid 가 필요합니다.' });
  if (uid === caller.uid) return res.status(400).json({ error: '자기 자신은 여기서 바꿀 수 없습니다.' });
  // 다른 관리자 계정은 건드리지 않는다
  if ((await admin.db.doc(`admins/${uid}`).get()).exists) return res.status(400).json({ error: '관리자 계정은 변경할 수 없습니다.' });

  try {
    if (action === 'resetPassword') {
      if (typeof password !== 'string' || password.length < 6 || password.length > 64) {
        return res.status(400).json({ error: '비밀번호는 6~64자여야 합니다.' });
      }
      await admin.auth.updateUser(uid, { password });
      return res.status(200).json({ ok: true });
    }
    if (action === 'deleteUser') {
      try {
        await admin.auth.deleteUser(uid);
      } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: '알 수 없는 action 입니다.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '서버 오류' });
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (_) { return {}; }
}
