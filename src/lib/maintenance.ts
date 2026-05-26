/**
 * 유지보수 모드 stub — 현재 마이크로사이트는 Firestore 미사용.
 * 향후 운영자 콘솔에서 일시 차단 기능 도입 시 이 함수에 Firestore read 추가.
 */
export async function isWriteFrozen(): Promise<boolean> {
  return false;
}
