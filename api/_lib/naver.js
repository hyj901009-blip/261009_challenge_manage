/* 네이버 블로그 일 방문자 수 가져오기
 *
 * 네이버는 방문자 수 공식 API가 없다. 블로그 방문자 위젯이 쓰는 비공식 주소
 *   https://blog.naver.com/NVisitorgp4Ajax.nhn?blogId=<아이디>
 * 가 최근 5일치를 XML로 돌려주는 것을 이용한다. 브라우저에서는 CORS 때문에 직접 부를 수 없어 서버에서 부른다.
 * ⚠️ 비공식이라 네이버가 바꾸면 동작하지 않을 수 있다. 그때도 앱의 수동 입력은 그대로 쓸 수 있다.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { naverBlogId, parseNaverVisitors } from '../../js/utils.js';

export async function fetchNaverVisitors(blogId) {
  const url = `https://blog.naver.com/NVisitorgp4Ajax.nhn?blogId=${encodeURIComponent(blogId)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Referer: `https://blog.naver.com/${blogId}`,
        Accept: 'application/xml,text/xml,*/*'
      }
    });
    if (!res.ok) throw new Error(`네이버 응답 오류 (${res.status})`);
    const rows = parseNaverVisitors(await res.text());
    if (!rows.length) throw new Error('방문자 수를 읽지 못했습니다. (블로그 아이디 확인, 또는 방문자 수 비공개)');
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

/** 멤버 한 명의 최근 방문자 수를 visits 컬렉션에 저장 */
export async function syncMember(admin, uid, member) {
  const blogId = naverBlogId(member.blogUrl);
  if (!blogId) return { uid, name: member.name || member.loginId, ok: false, skipped: true, error: '네이버 블로그 주소가 없습니다.' };
  try {
    const rows = await fetchNaverVisitors(blogId);
    const batch = admin.db.batch();
    for (const r of rows) {
      batch.set(admin.db.doc(`visits/${uid}_${r.date}`), {
        uid, cohortId: member.cohortId || '', date: r.date, count: r.count, source: 'naver', updatedAt: FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
    return { uid, name: member.name || member.loginId, ok: true, days: rows.length, last: rows[rows.length - 1] };
  } catch (e) {
    return { uid, name: member.name || member.loginId, ok: false, error: e.name === 'AbortError' ? '네이버 응답 시간 초과' : e.message };
  }
}

/** 여러 명을 동시에 몇 명씩 나눠서 처리 (네이버에 한꺼번에 몰리지 않게) */
export async function syncMany(admin, entries, concurrency = 4) {
  const results = [];
  for (let i = 0; i < entries.length; i += concurrency) {
    const chunk = entries.slice(i, i + concurrency);
    results.push(...await Promise.all(chunk.map(([uid, m]) => syncMember(admin, uid, m))));
  }
  return results;
}
