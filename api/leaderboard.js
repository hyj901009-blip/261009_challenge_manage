/* 챌린지 순위 (Vercel 서버리스 함수)
 *
 *   GET /api/leaderboard[?cohortId=…]   Authorization: Bearer <Firebase ID 토큰>
 *     챌린지원: 자기 기수 순위 / 관리자: cohortId 로 고른 기수
 *     → { cohortId, rows:[{ uid, name, count }], updatedAt }
 *
 * 챌린지원은 보안 규칙상 남의 포스팅을 읽을 수 없으므로 서버가 대신 "개수만" 세어 돌려준다.
 * 무료 한도(하루 읽기 5만)를 아끼려고
 *   - 사람마다 count() 집계 쿼리를 쓴다 (1명당 읽기 1회로 계산됨)
 *   - 결과를 leaderboards/{cohortId} 문서에 5분 동안 보관해 두고 다시 쓴다
 */
import { getAdmin } from './_lib/firebaseAdmin.js';
import { isAdminToken, verifyCaller } from './_lib/auth.js';

const CACHE_MS = 5 * 60 * 1000;

/** 기간 안 포스팅 개수. 복합 색인이 없으면(FAILED_PRECONDITION) 기간 조건 없이 센다. */
async function countPosts(db, uid, cohort) {
  const base = db.collection('posts').where('uid', '==', uid).where('cohortId', '==', cohort.id);
  try {
    const snap = await base.where('postDate', '>=', cohort.startDate).where('postDate', '<=', cohort.endDate).count().get();
    return snap.data().count;
  } catch (e) {
    if (e.code !== 9 && !/FAILED_PRECONDITION|index/i.test(String(e.message))) throw e;
    const snap = await base.count().get();
    return snap.data().count;
  }
}

async function compute(db, cohort) {
  const members = await db.collection('members').where('cohortId', '==', cohort.id).get();
  const rows = await Promise.all(members.docs.map(async (d) => {
    const m = d.data();
    return { uid: d.id, name: m.name || m.loginId, count: await countPosts(db, d.id, cohort) };
  }));
  return rows;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  const admin = getAdmin();
  if (!admin) return res.status(503).json({ error: '서버에 FIREBASE_SERVICE_ACCOUNT 환경변수가 설정되지 않았습니다.' });

  const caller = await verifyCaller(admin, req, res);
  if (!caller) return undefined;

  let cohortId;
  if (isAdminToken(caller)) {
    cohortId = String((req.query && req.query.cohortId) || '');
  } else {
    const me = await admin.db.doc(`members/${caller.uid}`).get();
    if (!me.exists) return res.status(403).json({ error: '등록된 챌린지원이 아닙니다.' });
    cohortId = me.data().cohortId || '';
  }
  if (!cohortId) return res.status(200).json({ cohortId: '', rows: [], updatedAt: Date.now() });

  const cSnap = await admin.db.doc(`cohorts/${cohortId}`).get();
  if (!cSnap.exists) return res.status(404).json({ error: '기수를 찾을 수 없습니다.' });
  const cohort = Object.assign({ id: cSnap.id }, cSnap.data());

  // 5분 안에 계산해 둔 결과가 있고 기간이 그대로면 재사용
  const cacheRef = admin.db.doc(`leaderboards/${cohortId}`);
  const cache = await cacheRef.get();
  if (cache.exists) {
    const c = cache.data();
    if (Date.now() - c.updatedAt < CACHE_MS && c.startDate === cohort.startDate && c.endDate === cohort.endDate) {
      return res.status(200).json({ cohortId, rows: c.rows, updatedAt: c.updatedAt, cached: true });
    }
  }

  try {
    const rows = await compute(admin.db, cohort);
    const updatedAt = Date.now();
    await cacheRef.set({ rows, updatedAt, startDate: cohort.startDate, endDate: cohort.endDate });
    return res.status(200).json({ cohortId, rows, updatedAt });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '서버 오류' });
  }
}
