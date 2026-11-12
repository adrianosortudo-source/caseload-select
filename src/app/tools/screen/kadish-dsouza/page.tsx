import type { Metadata } from "next";
import { KadishScreenMockup } from "@/components/prospect-demo/KadishScreenMockup";
export const metadata: Metadata = {title:"Kadish D’Souza LLP | SCREEN Website Preview",description:"A fictional disability-benefit intake on Kadish D’Souza LLP’s website mockup.",robots:{index:false,follow:false}};
export default function KadishScreenPage(){ return <KadishScreenMockup/>; }
