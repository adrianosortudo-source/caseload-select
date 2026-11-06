import { ResearchPanel } from "./ResearchEvidence";
import { LOCAL_RESEARCH_MESSAGE } from "@/lib/prospect-research-storage";
export default function LocalResearchNotice() {
  return <ResearchPanel title="Research is stored locally" name="local-research-notice">
    <p className="w-full text-sm text-black/60" data-ui-copy="body">{LOCAL_RESEARCH_MESSAGE}</p>
  </ResearchPanel>;
}
