/** Research is maintained in the verified local D: workspace after this release. */
export const PROSPECT_RESEARCH_STORAGE = (process.env.NEXT_PUBLIC_PROSPECT_RESEARCH_STORAGE === "online" ? "online" : "local") as "local" | "online";
export const LOCAL_RESEARCH_MESSAGE = "Law-firm research is stored on your computer. Open the LocalResearch folder on D: to search the retained evidence and history.";
