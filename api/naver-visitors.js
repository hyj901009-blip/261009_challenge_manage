/* 네이버 블로그 방문자 수 동기화 (Vercel 서버리스 함수)
 *
 *   GET  /api/naver-visitors                  ← Vercel Cron(매일 1회). Authorization: Bearer <CRON_SECRET>
 *        블로그 주소가 네이버인 모든 챌린지원의 최근 5일 방문자 수를 저장한다.
 *   POST /api/naver-visitors                  ← 화면의 [네이버에서 가져오기] 버튼. Authorization: Bearer <Firebase ID 토큰>
 *        챌린지원: 본인 것만 / 관리자: { cohortId } 그 기수 전체, { uid } 한 명
 *
 * 필요 환경변수: FIREBASE_SERVICE_ACCOUNT (저장용), CRON_SECRET (예약 실행 보호용)
 */
import { getAdmin } from './_lib/firebaseAdmin.js';
import { isAdminToken, verifyCaller, readBody } from './_lib/auth.js';
import { syncMember, syncMany } from './_lib/naver.js';
import { naverBlogId } from '../js/utils.js';

async function naverMembers(admin, cohortId) {
  const q = cohortId ? admin.db.collection('members').where('cohortId', '==', cohortId) : admin.db.collection('members');
  const snap = await q.get();
  return snap.docs.map((d) => [d.id, d.data()]).filter(([, m]) => naverBlogId(m.blogUrl));
}

const summary = (results) => ({
  total: results.length,
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).map((r) => ({ name: r.name, error: r.error })),
  results
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const admin = getAdmin();
  if (!admin) return res.status(503).json({ error: '서버에 FIREBASE_SERVICE_ACCOUNT 환경변수가 설정되지 않았습니다.' });

  // 1) 매일 예약 실행 (Vercel Cron)
  if (req.method === 'GET') {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(503).json({ error: 'CRON_SECRET 환경변수가 없어 예약 실행을 막았습니다.' });
    if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
    const results = await syncMany(admin, await naverMembers(admin));
    console.log(`naver-visitors cron: ${results.filter((r) => r.ok).length}/${results.length} ok`);
    return res.status(200).json(summary(results));
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 2) 화면 버튼
  const caller = await verifyCaller(admin, req, res);
  if (!caller) return undefined;
  const body = readBody(req);

  if (isAdminToken(caller)) {
    if (body.uid) {
      const snap = await admin.db.doc(`members/${body.uid}`).get();
      if (!snap.exists) return res.status(404).json({ error: '챌린지원을 찾을 수 없습니다.' });
      return res.status(200).json(summary([await syncMember(admin, snap.id, snap.data())]));
    }
    return res.status(200).json(summary(await syncMany(admin, await naverMembers(admin, body.cohortId || ''))));
  }

  // 챌린지원은 본인 것만
  const snap = await admin.db.doc(`members/${caller.uid}`).get();
  if (!snap.exists) return res.status(403).json({ error: '등록된 챌린지원이 아닙니다.' });
  return res.status(200).json(summary([await syncMember(admin, snap.id, snap.data())]));
}
