export function wheelUnit(deltaMode: number): number {
  return deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
}
