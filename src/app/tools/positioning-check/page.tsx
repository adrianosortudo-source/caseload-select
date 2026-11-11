import type { Metadata } from "next";
import PositioningCheck from "./PositioningCheck";
import "./positioning.css";
export const metadata: Metadata = { title: "Website positioning review · CaseLoad Select", description: "Explore what your law firm's website communicates, its evidence and possible positioning directions. Free, no account required." };
export default function Page() { return <PositioningCheck />; }
