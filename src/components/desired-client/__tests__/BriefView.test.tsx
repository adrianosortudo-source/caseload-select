// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BriefView } from "../BriefView";
import { buildStructuredBlueprintV4 } from "@/lib/desired-client/structured-blueprint";
import { completeAnswers } from "@/lib/desired-client/__tests__/blueprint-helpers";
import type { SavedBrief } from "@/lib/desired-client/types";

function fixture() {
  const answers=completeAnswers();
  const saved:SavedBrief={brief:buildStructuredBlueprintV4(answers),sourceAnswersVersion:"dcm-v3.2",sourceAnswersSnapshot:structuredClone(answers),sourceBriefRevision:answers.revision,generatedAt:"2026-10-05T12:00:00.000Z",wordingReviewed:false,mode:"structured"};
  return {answers,saved};
}

describe("Desired Client Blueprint definition review",()=>{
  it("keeps the definition review before material conditions and routes the two actions correctly",()=>{
    const {answers,saved}=fixture();
    const onReview=vi.fn(),onEdit=vi.fn();
    const {container}=render(<BriefView saved={saved} answers={answers} dismissedCode={null} reviewed={false} onReview={onReview} onEdit={onEdit} onAnother={vi.fn()} onClear={vi.fn()} storageWarning={false}/>);
    const definition=container.querySelector('[data-ui-component-content="desired-client-definition"]');
    const review=container.querySelector('[data-ui-component-content="desired-client-definition-review"]');
    const conditions=container.querySelector('[data-ui-component-content="desired-client-conditions"]');
    expect(definition&&review&&conditions).toBeTruthy();
    expect(Boolean(definition!.compareDocumentPosition(review!)&Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(review!.compareDocumentPosition(conditions!)&Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Yes, this reflects our direction"}));
    fireEvent.click(screen.getByRole("button",{name:"Edit the definition"}));
    expect(onReview).toHaveBeenCalledWith(true);
    expect(onEdit).toHaveBeenCalledWith(2);
  });

  it("does not render an empty conditions section",()=>{
    const {answers,saved}=fixture();
    answers.opportunity.sources=[];
    saved.brief=buildStructuredBlueprintV4(answers);
    const {container}=render(<BriefView saved={saved} answers={answers} dismissedCode={null} reviewed={false} onReview={vi.fn()} onEdit={vi.fn()} onAnother={vi.fn()} onClear={vi.fn()} storageWarning={false}/>);
    expect(container.querySelector('[data-ui-component-content="desired-client-conditions"]')).toBeNull();
  });
});
