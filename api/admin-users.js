/* 관리자 전용 계정 관리 API (Vercel 서버리스 함수)
 *
 *   GET  /api/admin-users                       → { enabled }  서버 설정 여부
 *   POST /api/admin-users  (Authorization: Bearer <관리자 Google 로그인 Firebase ID 토큰>)
 *        { action: 'resetPassword', uid, password }
 *        { action: 'deleteUser', uid }
 *
 * 브라우저(클라이언트 SDK)로는 남의 비밀번호를 바꾸거나 계정을 지울 수 없어서 이 두 가지만 서버에서 한다.
 */
import { getAdmin } from './_lib/firebaseAdmin.js';
import { isAdminEmail, isAdminToken, verifyCaller, readBody } from './_lib/auth.js';
import { validatePassword, toAuthPassword } from '../js/utils.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const admin = getAdmin();

  if (req.method === 'GET') return res.status(200).json({ enabled: !!admin });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!admin) return res.status(503).json({ error: '서버에 FIREBASE_SERVICE_ACCOUNT 환경변수가 설정되지 않았습니다.' });

  // 1) 요청한 사람이 관리자인지 확인
  const caller = await verifyCaller(admin, req, res);
  if (!caller) return undefined;
  if (!isAdminToken(caller)) return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });

  // 2) 작업
  const body = readBody(req);
  const { action, uid, password } = body;
  if (!uid || typeof uid !== 'string') return res.status(400).json({ error: 'uid 가 필요합니다.' });
  if (uid === caller.uid) return res.status(400).json({ error: '자기 자신은 여기서 바꿀 수 없습니다.' });
  try {
    // 관리자 Google 계정은 건드리지 않는다
    const target = await admin.auth.getUser(uid).catch((e) => { if (e.code === 'auth/user-not-found') return null; throw e; });
    if (target && isAdminEmail(target.email)) return res.status(400).json({ error: '관리자 계정은 변경할 수 없습니다.' });

    if (action === 'resetPassword') {
      const msg = typeof password === 'string' ? validatePassword(password) : '비밀번호가 필요합니다.';
      if (msg) return res.status(400).json({ error: msg });
      // 4~5자 비밀번호는 로그인 화면과 같은 규칙으로 늘려서 저장
      await admin.auth.updateUser(uid, { password: toAuthPassword(password) });
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

