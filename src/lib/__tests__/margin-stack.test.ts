import { describe, it, expect } from "vitest";
import { stackCards, stackBottom } from "../margin-stack";

describe("stackCards", () => {
  it("keeps non-colliding cards at their anchor", () => {
    const tops = stackCards(
      [
        { id: "a", anchor: 0, height: 50 },
        { id: "b", anchor: 200, height: 50 },
      ],
      10,
    );
    expect(tops.get("a")).toBe(0);
    expect(tops.get("b")).toBe(200);
  });

  it("pushes a colliding card down to clear the one above", () => {
    const tops = stackCards(
      [
        { id: "a", anchor: 0, height: 50 },
        { id: "b", anchor: 30, height: 50 },
      ],
      10,
    );
    expect(tops.get("a")).toBe(0);
    // b wanted 30 but a occupies 0..50 + 10 gap => 60
    expect(tops.get("b")).toBe(60);
  });

  it("resolves order by anchor regardless of input order", () => {
    const tops = stackCards(
      [
        { id: "late", anchor: 500, height: 40 },
        { id: "early", anchor: 10, height: 40 },
      ],
      10,
    );
    expect(tops.get("early")).toBe(10);
    expect(tops.get("late")).toBe(500);
  });

  it("cascades multiple collisions", () => {
    const tops = stackCards(
      [
        { id: "a", anchor: 0, height: 100 },
        { id: "b", anchor: 20, height: 100 },
        { id: "c", anchor: 40, height: 100 },
      ],
      10,
    );
    expect(tops.get("a")).toBe(0);
    expect(tops.get("b")).toBe(110);
    expect(tops.get("c")).toBe(220);
  });
});

describe("stackBottom", () => {
  it("returns the lowest card bottom plus gap", () => {
    const tops = new Map([
      ["a", 0],
      ["b", 110],
    ]);
    const heights = new Map([
      ["a", 100],
      ["b", 80],
    ]);
    expect(stackBottom(tops, heights, 10)).toBe(200);
  });

  it("is zero for an empty set", () => {
    expect(stackBottom(new Map(), new Map(), 10)).toBe(0);
  });
});
