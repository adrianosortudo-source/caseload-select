"use client";
import { createElement, type ReactElement } from "react";
import { pdf } from "@react-pdf/renderer";
import type { BlueprintViewModel } from "./blueprint";
import type { DesiredClientAnswers, SavedBrief } from "./types";
import { buildBlueprintViewModel } from "./blueprint";
export async function downloadBlueprintPdf(model:BlueprintViewModel,saved:SavedBrief,answers:DesiredClientAnswers){
 const {DesiredClientBlueprintPdf}=await import("@/components/desired-client/DesiredClientBlueprintPdf");
 const current=buildBlueprintViewModel(saved.brief,answers,{mode:saved.mode,generatedAt:saved.generatedAt,wordingReviewed:saved.wordingReviewed,openClarificationCode:saved.openClarificationCode});
 if(current.brief!==model.brief||current.date!==model.date)throw new Error("The blueprint changed while the PDF was being prepared.");
 const blob=await pdf(createElement(DesiredClientBlueprintPdf,{model}) as ReactElement).toBlob();
 const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`desired-client-blueprint-${model.date.replaceAll("/","-")}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
