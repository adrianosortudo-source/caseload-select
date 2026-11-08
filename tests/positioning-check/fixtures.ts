import type { PositioningResult } from "../../src/lib/positioning-check/types";
import complete from "../../docs/positioning-check/browser-fixtures/complete.json";
import partial from "../../docs/positioning-check/browser-fixtures/partial.json";
export const completeFixture = complete as unknown as PositioningResult;
export const partialFixture = partial as unknown as PositioningResult;

