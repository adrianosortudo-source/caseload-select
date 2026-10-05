// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { InterviewClarificationPrompt } from "@/lib/desired-client/types";
import { InterviewClarificationStep } from "../InterviewClarificationStep";

afterEach(cleanup);

const prompt: Extract<InterviewClarificationPrompt,{outcome:"ask"}> = {
  outcome:"ask",
  id:"11111111-1111-4111-8111-111111111111",
  stage:2,
  purpose:"client_goal_detail",
  source_answer_ids:["client.goal_detail"],
  question:"What outcome does the client want?",
  choices:[{id:"understand",label:"Understand the options"},{id:"other",label:"Something else"}],
  reflection:"",
};

describe("InterviewClarificationStep answer limits",()=>{
  it("blocks a 13-line custom answer and allows one within the shared validator limit",()=>{
    render(createElement(InterviewClarificationStep,{prompt,onAnswer:()=>undefined,onSkip:()=>undefined}));
    const writeIn=screen.getByRole("textbox");
    const submit=screen.getByRole("button",{name:"Use this answer"}) as HTMLButtonElement;
    fireEvent.change(writeIn,{target:{value:Array.from({length:13},()=>"line").join("\n")}});
    expect(screen.getByRole("alert").textContent).toContain("Use 12 lines or fewer");
    expect(submit.disabled).toBe(true);
    fireEvent.change(writeIn,{target:{value:Array.from({length:12},()=>"line").join("\n")}});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(submit.disabled).toBe(false);
  });
});
