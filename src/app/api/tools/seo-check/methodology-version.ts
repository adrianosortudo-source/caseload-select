export const CURRENT_METHODOLOGY_VERSION = 5;
export const LIMITED_SCORE_METHODOLOGY_VERSIONS = [4, CURRENT_METHODOLOGY_VERSION] as const;

export function isLimitedScoreMethodology(version: number): boolean {
  return (LIMITED_SCORE_METHODOLOGY_VERSIONS as readonly number[]).includes(version);
}

export function isCurrentMethodology(version: number): boolean {
  return version === CURRENT_METHODOLOGY_VERSION;
}
