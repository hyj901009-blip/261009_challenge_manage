/* 블로그 챌린지 — 전역 설정
 *
 * ── Firebase 설정 넣는 법 (둘 중 하나) ─────────────────────────────
 *  1) Vercel 환경변수(권장): FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
 *     FIREBASE_APP_ID … 를 넣어 두면 아래 FIREBASE_CONFIG 가 비어 있을 때
 *     /api/firebase-config 에서 자동으로 읽어 옵니다. (README 참고)
 *  2) 아래 FIREBASE_CONFIG 에 Firebase 콘솔의 웹 앱 설정값을 직접 붙여 넣기.
 *     (웹 앱 설정값은 원래 브라우저에 공개되는 값이라 커밋해도 됩니다. 보안은 firestore.rules 가 지킵니다.)
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDC7ID4V9hsRu08RwPPIhK7nUWPxvLdR0I',
  authDomain: 'challenge-manage.firebaseapp.com',
  projectId: 'challenge-manage',
  storageBucket: 'challenge-manage.firebasestorage.app',
  messagingSenderId: '762786706336',
  appId: '1:762786706336:web:bfac2cb454948db317eac5'
};

export const APP = {
  title: '블로그 챌린지',
  timezone: 'Asia/Seoul',

  // 한글 아이디를 Firebase 이메일/비밀번호 로그인에 쓰기 위한 "내부용 가짜 메일 도메인".
  // 아이디는 해시로 바뀌어 <해시>@이 도메인 형태의 계정이 됩니다. 실제로 메일이 가지 않습니다.
  // ⚠️ 운영을 시작한 뒤 바꾸면 기존 계정이 모두 로그인되지 않습니다.
  idEmailDomain: 'challenge.example.com',

  // 새 기수를 만들 때 기본으로 채워지는 미션 목표 (기수마다 관리자 화면에서 바꿀 수 있음)
  defaultGoals: { daily: 1, weekly: 5, monthly: 20 },

  commentMaxLength: 500,

  // 챌린지원이 관리자 코멘트에 남길 수 있는 반응
  reactions: [
    { key: 'like', emoji: '👍', label: '따봉' },
    { key: 'heart', emoji: '❤️', label: '하트' },
    { key: 'clap', emoji: '👏', label: '박수' },
    { key: 'thanks', emoji: '🙏', label: '감사' },
    { key: 'fire', emoji: '🔥', label: '불꽃' }
  ]
};
