/* Firebase 웹 앱 설정을 Vercel 환경변수에서 읽어 브라우저에 넘겨 준다.
 * (웹 앱 설정값은 원래 공개되는 값이다. 비밀 키가 아니며, 데이터 보호는 firestore.rules 가 맡는다.)
 * js/config.js 의 FIREBASE_CONFIG 를 직접 채웠다면 이 함수는 호출되지 않는다. */
export default function handler(req, res) {
  const e = process.env;
  const cfg = {
    apiKey: e.FIREBASE_API_KEY || '',
    authDomain: e.FIREBASE_AUTH_DOMAIN || (e.FIREBASE_PROJECT_ID ? `${e.FIREBASE_PROJECT_ID}.firebaseapp.com` : ''),
    projectId: e.FIREBASE_PROJECT_ID || '',
    storageBucket: e.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: e.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: e.FIREBASE_APP_ID || ''
  };
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (!cfg.apiKey || !cfg.projectId) return res.status(404).json({ error: 'FIREBASE_API_KEY / FIREBASE_PROJECT_ID 환경변수가 없습니다.' });
  return res.status(200).json(cfg);
}
