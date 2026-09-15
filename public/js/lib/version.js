/**
 * version.js — 이 빌드가 어느 커밋에서 나왔는지
 *
 * 저장소에 커밋돼 있는 값은 항상 'dev' 입니다.
 * 배포 파이프라인이 scripts/stamp-build.mjs 로 실제 값을 찍어 넣습니다.
 * (저장소 사본을 그대로 두는 이유: 테스트를 돌릴 때마다 작업 트리가 더러워지면
 *  '빌드 결과물이 소스와 어긋나는지' 검사가 항상 실패합니다)
 *
 * 앱에 설치된 APK 가 최신인지 확인할 때 이 커밋을 GitHub 릴리스의 커밋과 비교합니다.
 */

export const BUILD = Object.freeze({
  /** 이 빌드를 만든 커밋 SHA. 개발 중에는 'dev'. */
  commit: 'dev',
  /** 빌드 시각(ISO). 개발 중에는 빈 문자열. */
  builtAt: '',
});

/** 화면에 보여 줄 짧은 버전 문자열. */
export function shortVersion() {
  if (!BUILD.commit || BUILD.commit === 'dev') return 'dev';
  return BUILD.commit.slice(0, 7);
}

/** 찍힌 값이 실제 커밋인지. 개발 빌드에서는 버전 비교를 하지 않습니다. */
export function isStamped() {
  return /^[0-9a-f]{40}$/.test(BUILD.commit);
}
