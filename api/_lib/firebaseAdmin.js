/* firebase-admin 초기화 (Vercel 서버리스 함수 전용 — 브라우저에는 절대 노출되지 않는다)
 *
 * 환경변수 (둘 중 하나)
 *   FIREBASE_SERVICE_ACCOUNT  : 서비스 계정 키 JSON 전체 (한 줄로 붙여 넣기)
 *   또는 FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *
 * 비밀번호 재설정·계정 삭제(Admin SDK Auth)는 Spark(무료) 요금제에서도 무료입니다.
 * 설정이 없으면 null 을 돌려주고, 화면은 해당 기능만 숨긴 채 나머지는 그대로 동작합니다.
 */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function readCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    try {
      const json = JSON.parse(raw);
      return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key };
    } catch (e) {
      console.error('FIREBASE_SERVICE_ACCOUNT 를 JSON 으로 읽지 못했습니다.', e.message);
      return null;
    }
  }
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    // Vercel 대시보드에 붙여 넣으면 줄바꿈이 \n 문자로 들어오는 경우가 있다
    return { projectId: FIREBASE_PROJECT_ID, clientEmail: FIREBASE_CLIENT_EMAIL, privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') };
  }
  return null;
}

let cached;
export function getAdmin() {
  if (cached !== undefined) return cached;
  const creds = readCredentials();
  if (!creds) { cached = null; return cached; }
  const app = getApps()[0] || initializeApp({ credential: cert(creds) });
  cached = { auth: getAuth(app), db: getFirestore(app) };
  return cached;
}
