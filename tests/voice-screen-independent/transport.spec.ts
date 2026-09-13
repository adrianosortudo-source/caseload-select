import { expect, test, type Page, type Route } from "@playwright/test";
import type { ContinuationPayload, ContinuationView } from "../../src/lib/voice-screen-continuation";

// Synthetic bearer: intercepted requests never reach a continuation backend.
const TOKEN = "T".repeat(43);
const SMS_URL = `/widget/voice-continuation#${TOKEN}`;
const WIDGET = '[data-ui-component-content="live-continuation"]';
const QUESTION_ONE = "What else should the team know?";
const QUESTION_TWO = "What would you like help deciding?";

function fixture(options = false): ContinuationView {
  return {
    revision: 0,
    status: "partial",
    reviewConfirmed: !options,
    question: options ? {
      id: "proof_of_delivery",
      text: "Do you have anything showing the work was delivered?",
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    } : { id: "initial_detail", text: QUESTION_ONE, options: [] },
    summary: {
      fields: [
        { id: "client_name", label: "Your name", value: "Alex Morgan", editable: true, uncertain: false },
        { id: "client_phone", label: "Contact number", value: "••• ••• 0142", editable: true, uncertain: false },
        { id: "situation", label: "What you need help with", value: "An unpaid invoice for completed work.", editable: true, uncertain: false },
        { id: "deadline", label: "Timing or deadline", value: "Not captured", editable: true, uncertain: true },
      ],
      answers: [],
    },
  };
}

async function interceptContinuation(page: Page, initial: ContinuationView, onPost: (payload: ContinuationPayload, route: Route) => Promise<void>) {
  const backend = { view: initial, loads: 0, writes: [] as ContinuationPayload[] };
  await page.route(url => url.pathname.startsWith("/api/"), route => route.abort());
  await page.route(url => url.pathname === "/api/voice-screen/continue", async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${TOKEN}`);
    if (route.request().method() === "GET") {
      backend.loads += 1;
      await route.fulfill({ status: 200, json: backend.view });
    } else {
      expect(route.request().method()).toBe("POST");
      const payload = route.request().postDataJSON() as ContinuationPayload;
      backend.writes.push(payload);
      await onPost(payload, route);
    }
  });
  return backend;
}

test("SMS caller retains explanation on a failed save, retries, and reopens the saved inquiry", async ({ page }) => {
  let failAnswer = true;
  const explanation = "The customer confirmed delivery by phone, but has not sent written acceptance.";
  const backend = await interceptContinuation(page, fixture(true), async (payload, route) => {
    expect(payload.revision).toBe(backend.view.revision);
    if (payload.confirmReview) {
      backend.view = { ...backend.view, revision: 1, reviewConfirmed: true };
      await route.fulfill({ status: 200, json: backend.view });
    } else if (failAnswer) {
      failAnswer = false;
      await route.fulfill({ status: 503, json: { error: "temporarily_unavailable" } });
    } else {
      expect(payload).toEqual({ revision: 1, slotId: "proof_of_delivery", value: `other:${explanation}`, skip: false });
      backend.view = {
        ...backend.view, revision: 2,
        question: { id: "initial_detail", text: QUESTION_ONE, options: [] },
        summary: { ...backend.view.summary, answers: [{ question: backend.view.question!.text, answer: explanation }] },
      };
      await route.fulfill({ status: 200, json: backend.view });
    }
  });
  await page.goto(SMS_URL);
  const widget = page.locator(WIDGET);
  await widget.getByRole("button", { name: "That's right, continue", exact: true }).click();
  await widget.getByRole("button", { name: "Something else, I will explain", exact: true }).click();
  const input = widget.getByRole("textbox", { name: "In your own words:", exact: true });
  await input.fill(explanation);
  await widget.getByRole("button", { name: "View your summary", exact: true }).click();
  await expect(input).toBeHidden();
  await widget.getByRole("button", { name: "Continue your inquiry", exact: true }).click();
  await expect(input).toHaveValue(explanation);
  const submit = widget.getByRole("button", { name: "Continue", exact: true });
  await submit.click();
  await expect(widget.getByRole("alert")).toContainText("Your answer could not be saved");
  await expect(input).toHaveValue(explanation);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(widget.getByRole("textbox", { name: QUESTION_ONE, exact: true })).toBeVisible();
  await widget.getByRole("button", { name: "View your summary", exact: true }).click();
  await expect(widget.getByRole("region", { name: "Additional answers", exact: true })).toContainText(explanation);
  await expect(widget.getByRole("region", { name: "Additional answers", exact: true })).not.toContainText("other:");
  // The transport deliberately removes the bearer from the address bar.
  // Reopen the original SMS link to simulate returning on another visit.
  expect(new URL(page.url()).hash).toBe("");
  await page.goto(SMS_URL);
  await page.reload();
  await expect(widget.getByRole("textbox", { name: QUESTION_ONE, exact: true })).toBeVisible();
  await expect(widget.getByRole("button", { name: "That's right, continue", exact: true })).toHaveCount(0);
  await widget.getByRole("button", { name: "View your summary", exact: true }).click();
  await expect(widget).toContainText(explanation);
  expect(backend.loads).toBeGreaterThanOrEqual(2);
  expect(backend.writes).toHaveLength(3);
});

for (const change of ["correction", "conflict"] as const) {
  test(`SMS caller clears a text draft when ${change} changes the current question`, async ({ page }) => {
    const correctedSituation = "I need help understanding an employment agreement.";
    const backend = await interceptContinuation(page, fixture(), async (payload, route) => {
      if (change === "correction") expect(payload.correction).toEqual({ fieldId: "situation", value: correctedSituation });
      else expect(payload.slotId).toBe("initial_detail");
      backend.view = {
        ...backend.view, revision: backend.view.revision + 1,
        question: { id: "replacement_detail", text: QUESTION_TWO, options: [] },
        summary: { ...backend.view.summary, fields: backend.view.summary.fields.map(field => field.id === "situation" ? { ...field, value: correctedSituation } : field) },
      };
      await route.fulfill(change === "correction"
        ? { status: 200, json: backend.view }
        : { status: 409, json: { error: "refresh_required" } });
    });
    await page.goto(SMS_URL);
    const widget = page.locator(WIDGET);
    const draft = widget.getByRole("textbox", { name: QUESTION_ONE, exact: true });
    await draft.fill("An unfinished answer to the original question.");
    await widget.getByRole("button", { name: "View your summary", exact: true }).click();
    await widget.getByRole("button", { name: "Continue your inquiry", exact: true }).click();
    await expect(draft).toHaveValue("An unfinished answer to the original question.");

    if (change === "correction") {
      await widget.getByRole("button", { name: "View your summary", exact: true }).click();
      await widget.getByRole("button", { name: "Correct something", exact: true }).click();
      await widget.getByRole("button", { name: "Edit what you need help with", exact: true }).click();
      await widget.getByRole("textbox", { name: "What you need help with", exact: true }).fill(correctedSituation);
      await widget.getByRole("button", { name: "Save correction", exact: true }).click();
      await expect(widget.getByRole("button", { name: "Save correction", exact: true })).toHaveCount(0);
    } else {
      await widget.getByRole("button", { name: "Save and continue", exact: true }).click();
      await expect(widget.getByRole("alert")).toContainText("changed in another window");
    }
    await widget.getByRole("button", { name: "Continue your inquiry", exact: true }).click();
    const replacement = widget.getByRole("textbox", { name: QUESTION_TWO, exact: true });
    await expect(replacement).toBeVisible();
    await expect(replacement).toHaveValue("");
    await expect(widget.getByRole("button", { name: "Save and continue", exact: true })).toBeDisabled();
    expect(backend.writes).toHaveLength(1);
  });
}
