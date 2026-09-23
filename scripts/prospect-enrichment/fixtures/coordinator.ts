export const producerDate = "2026-09-23T12:00:00.000Z";
export function coordinatorFixture() {
  const source={sourceUrl:"https://synthetic.example/team",observedAt:"2026-09-22"};
  const result=(i:number,disposition:string)=>({
    resultId:"synthetic-result-"+i,workKey:"domain:synthetic-"+i+".example",claimId:"synthetic-claim-"+i,worker:"synthetic-worker-"+i,disposition,
    reason:"Synthetic recorded rationale",researchKey:{canonicalDomain:"synthetic-"+i+".example",databaseUuid:null,sourceRecordKey:null,stableFirmId:null,identityStatus:"unresolved"},
    evidence:[{...source,supports:"Synthetic original support",result:"Keep this exact text"}],
    researchFailures:[{code:"synthetic-unavailable",sourceUrl:"https://synthetic.example/failure",observedAt:"2026-09-22",failure:"Synthetic failure; unknown result"}],
    missingGates:["published-direct-email"],computedMissingGates:["specific-opportunity"],submittedAt:producerDate,sha256:"d".repeat(64),elapsedSeconds:45,
    evidenceArtifacts:[] as string[],
    record:{
      firmId:null,databaseFirmId:null,sourceRecordKey:null,canonicalDomain:"synthetic-"+i+".example",firmName:"Synthetic firm "+i,website:"https://synthetic-"+i+".example/",
      office:{province:"ON",address:"Synthetic address",...source},
      independence:{verified:true,summary:"Synthetic source statement",...source},
      services:[{description:"Synthetic estate service",niche:"wills-estates-probate",...source}],
      lawyerCount:{count:2,firmWide:true,activePractisingOnly:true,roster:[{name:"Synthetic A",role:"Lawyer"},{name:"Synthetic B",role:"Lawyer"}],exclusions:[{name:"Synthetic C",reason:"Student"}],...source},
      decisionMaker:{name:"Synthetic A",role:"Managing partner",roleEvidence:{...source}},
      email:{address:"a@synthetic.example",attributedTo:"Synthetic A",kind:"published-direct",inferred:false,...source},
      generalInbox:{address:"info@synthetic.example",...source},
      advertising:{status:"pixels-detected",observations:[{vendor:"google_ads",kind:"conversion-tag",identifier:"AW-1234",...source},{vendor:"meta",kind:"recent-ad",advertiser:"Synthetic advertiser",adDate:"2026-09-21",...source}]},
      opportunity:{summary:"Synthetic observed opportunity",observation:"Synthetic exact visible observation",...source},
      selectionRationale:"Synthetic rationale only"
    }
  });
  return {
    schemaVersion:"whole-firm-coordinator-v1",updatedAt:producerDate,lastProgressAt:producerDate,maxInFlight:3,reserveTarget:0,historical:{reportedQualifiedCount:0},
    candidates:["complete","held","rejected"].map((d,i)=>({key:"domain:synthetic-"+i+".example",firmName:"Synthetic firm "+i,status:d==="complete"?"awaiting-db":d,history:[{event:"synthetic-only"}],receipts:[],identityConflicts:[],results:[result(i,d)],evidenceSources:[],claim:{worker:"synthetic-worker-"+i}}))
  };
}
