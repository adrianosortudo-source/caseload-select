import"./modulepreload-polyfill-B5Qt9EMX.js";const i=[{num:"01",group:"Advisory",input:"I want to start a business with a friend and protect myself",expected:`corporate / business_setup_advisory / Band B
advisory_path=Starting a new business, co_owner_count=One partner, advisory_concern=Avoiding problems with a partner later
signed_anything should be null
Next question: signed_anything`},{num:"02",group:"Advisory",input:"We're thinking of opening a company together and want to do it properly",expected:`business_setup_advisory / Band B
advisory_path=Starting a new business, co_owner_count=One partner
advisory_concern=Knowing what kind of company to set up
signed_anything null — should not stop early`},{num:"03",group:"Advisory",input:"I have a business idea and might bring someone in as a partner",expected:`business_setup_advisory / Band B or low B
advisory_path=Starting a new business, co_owner_count=Not sure yet
actionability=Just exploring — continue qualifying`},{num:"04",group:"Advisory",input:"I want to incorporate by myself and just need basic guidance",expected:`business_setup_advisory / solo_setup
Must NOT ask ownership split
Should ask business type / stage / setup / location
Lower fee range`},{num:"05",group:"Advisory",input:"I'm buying into an existing company and need someone to review the documents this week",expected:`business_setup_advisory / buy_in_or_joining
documents_exist=Yes (explicit), advisory_timing=Urgent (explicit)
signed_anything null unless explicit
Band A possible — fee $3,000–$8,000+`},{num:"06",group:"Shareholder",input:"I started a company with a friend and now I can't access the bank account and they won't show me anything",expected:`shareholder_dispute
corporate_records_available=No (explicit)
Must NOT ask bank access again
Must NOT ask generic docs repeatedly
Continue if ownership/value gaps remain`},{num:"07",group:"Shareholder",input:"My business partner is making decisions without me and I think money is being taken out of the company",expected:`shareholder_dispute
management_exclusion=Yes, dividend_or_money_issue=Yes
Next question: ownership / proof / value`},{num:"08",group:"Shareholder",input:"I own part of a company but I'm being left out",expected:`shareholder_dispute
Next: ask ownership percentage or proof of ownership`},{num:"09",group:"Unpaid Invoice",input:"They're not paying me and now they're saying the work wasn't done right",expected:`unpaid_invoice
payment_status=unpaid, dispute_reason=quality_issue
Next: amount or proof of delivery`},{num:"10",group:"Unpaid Invoice",input:"A client owes us money but keeps delaying and giving excuses",expected:`unpaid_invoice
Next: ask amount or invoice/proof`},{num:"11",group:"Contract",input:"We agreed over email and now they deny everything",expected:`contract_dispute
written_terms=Yes (explicit)
dispute_reason=denial
Do NOT ask written_terms again
Next: ask value or risk`}],o=document.getElementById("cases");for(const e of i){const n=document.createElement("div");n.className="case-card",n.innerHTML=`
    <div class="case-num">Case ${e.num} — ${e.group}</div>
    <div class="case-input">"${e.input}"</div>
    <div class="case-expected"><strong>Expected:</strong><br>${e.expected.replace(/\n/g,"<br>")}</div>
    <button class="run-btn">Run in engine →</button>
  `,n.querySelector(".run-btn").addEventListener("click",()=>{const t=`/?input=${encodeURIComponent(e.input)}`;window.location.href=t}),o.appendChild(n)}
