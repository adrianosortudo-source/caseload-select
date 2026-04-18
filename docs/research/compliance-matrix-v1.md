# CaseLoad Screen — Compliance Matrix v1
## Ontario Intake Flags, Mandatory Gate Questions & Limitation Periods

**Status:** Draft — Session 0a  
**Date:** 2026-04-17  
**Sources:** LawPRO practicePRO Claims Fact Sheets, LSO Rules of Professional Conduct (Chapter 3), Ontario Limitations Act 2002, PA-specific statutes (citations inline)  
**Methodology:** Desk research only. No lawyer validation. Pilot firm calibration planned for v2.

---

## Framework

### Severity Tiers

| Tier | Label | Definition |
|------|-------|------------|
| S1 | CRITICAL | Missed flag = malpractice exposure or barred claim. Must surface at first message. |
| S2 | HIGH | Significant risk if not captured at intake. Surface within Round 1. |
| S3 | MEDIUM | Important context for case quality scoring. Round 1 or Round 2. |

### Flag Structure

Each flag has:
- **ID:** Snake_case identifier used in gate rules engine
- **PA(s):** Which practice areas trigger it
- **Trigger signals:** Natural language patterns that activate the flag
- **Severity:** S1 / S2 / S3
- **Mandatory gate questions:** Must ask if flag is active (TypeScript gate, not LLM-generated)
- **Limitation deadline:** Where time-sensitive
- **LawPRO risk ref:** Primary malpractice category it targets

---

## Universal Flags (Apply to All Practice Areas)

These fire regardless of PA. They are the baseline intake layer.

### FLAG: limitation_proximity

**Severity:** S1  
**Trigger signals:** "happened two years ago," "a while back," "years ago," event dates close to 2-year mark  
**LawPRO risk:** Failure to advise on limitation period (top claim driver across all PAs)

**Mandatory gate questions:**
1. When exactly did this happen? (date of incident or discovery)
2. Have you spoken to any other lawyer about this? If yes, when?
3. Has anything been filed with a court or tribunal already?

**Notes:** Discoverability rule applies — clock starts when client knew or ought to have known. Surface immediately if event date > 18 months ago. Escalate to lawyer if < 30 days to likely deadline.

---

### FLAG: conflict_adverse_party

**Severity:** S1  
**Trigger signals:** Opposing party names any person or organization, client names employer/insurer/other party  
**LawPRO risk:** Failure to identify conflict (LSO Rule 3.4)

**Mandatory gate questions:**
1. Who is the other party? Full name and organization if applicable.
2. Do you know if they have a lawyer representing them?

**Notes:** All named parties flagged for conflict check against firm's client database before retainer is signed. No auto-clear — requires human review.

---

### FLAG: prior_counsel

**Severity:** S2  
**Trigger signals:** "my last lawyer," "I had a lawyer before," "changed lawyers," "fired my attorney"  
**LawPRO risk:** Scope creep, unrealistic expectations, client blaming prior counsel error on current firm

**Mandatory gate questions:**
1. Who was your previous lawyer and which firm?
2. Why did the relationship end?
3. Has any court filing, limitation extension, or tolling agreement been put in place by prior counsel?

---

### FLAG: minor_claimant

**Severity:** S2  
**Trigger signals:** Child, minor, under 18, "my son/daughter who is [age]," teen, youth  
**LawPRO risk:** Limitation period tolled for minors but litigation guardian required; failure to identify proper representative

**Mandatory gate questions:**
1. How old is the person the claim is on behalf of?
2. Who is the parent or guardian?
3. Has any court been involved (i.e. Official Guardian or Children's Lawyer)?

---

### FLAG: vulnerable_client

**Severity:** S2  
**Trigger signals:** Memory issues, dementia, "my mother/father who has," cognitive impairment, psychiatric history  
**LawPRO risk:** Testamentary capacity, undue influence, instructions unclear, will challenges

**Mandatory gate questions:**
1. Can the person give clear instructions independently?
2. Is anyone else helping them understand their options?

---

## Practice Area Flags

---

### PA: Personal Injury (General)

**Limitation period:** 2 years from discovery — Limitations Act, 2002, s.4. Ultimate: 15 years.

#### FLAG: pi_limitation_window

**Severity:** S1  
**Trigger:** Date of incident anywhere near 2-year mark  
**LawPRO risk:** Failure to advise on limitation period

**Gate questions:**
1. What was the exact date of the incident?
2. Have you received any medical treatment? When did you first see a doctor?
3. Have you had any contact with an insurance adjuster or signed any documents?

---

#### FLAG: pi_unidentified_parties

**Severity:** S1  
**Trigger:** "I don't know who owns it," "the person drove away," "I never got their information"  
**LawPRO risk:** Failure to identify all defendants at intake

**Gate questions:**
1. Do you know the full name of the person or company responsible?
2. Was there a property owner, manager, or employer involved?
3. Are there any witnesses who can identify the responsible party?

---

#### FLAG: pi_evidence_preservation

**Severity:** S2  
**Trigger:** Days or weeks after incident, no photos yet, witnesses not yet identified  
**LawPRO risk:** Inadequate fact investigation at intake

**Gate questions:**
1. Do you have photos of the scene or your injuries?
2. Did anyone witness what happened? Do you have their contact information?
3. Are there surveillance cameras at or near the location?

---

### PA: Motor Vehicle Accidents

**Limitation period:** 2 years from discovery — Limitations Act, 2002, s.4.  
**Critical secondary:** 7-day insurer notification for accident benefits (Insurance Act, s.258.3). Non-compliance risks accident benefits claim.

#### FLAG: mvac_insurer_not_notified

**Severity:** S1  
**Trigger:** Accident within last 7 days and no insurer contact mentioned, OR client says "I haven't called insurance yet"  
**LawPRO risk:** Missed 7-day accident benefits notification deadline

**Gate questions:**
1. Have you notified your insurance company about the accident yet?
2. What date did the accident happen?
3. Do you have your insurance policy number available?

---

#### FLAG: mvac_hit_and_run

**Severity:** S1  
**Trigger:** "they drove away," "didn't get their plates," "hit and run," "uninsured driver"  
**LawPRO risk:** Failure to identify proper defendant; OPCF 44R uninsured motorist coverage not identified

**Gate questions:**
1. Did you get the other driver's license plate, name, or insurance information?
2. Did any witnesses see the other vehicle? Do you have their contact details?
3. Was the accident reported to police? Do you have a report number?

---

#### FLAG: mvac_accident_benefits

**Severity:** S2  
**Trigger:** Injury from car accident, any mention of medical treatment, time off work  
**LawPRO risk:** Failure to advise client on accident benefits entitlement (separate from tort claim)

**Gate questions:**
1. Have you applied for accident benefits (also called "no-fault benefits") with your insurer?
2. Are you currently receiving any income replacement or medical benefits?
3. What injuries are you dealing with and are you still receiving treatment?

---

### PA: Medical Malpractice

**Limitation period:** 2 years from discovery of negligent act AND its causal link to injury — Limitations Act, 2002, s.5. Ultimate: 15 years.

#### FLAG: medmal_causation_unclear

**Severity:** S1  
**Trigger:** "I think something went wrong," "they made a mistake," "the surgery didn't work"  
**LawPRO risk:** Failure to establish causation chain at intake; inadequate expert opinion

**Gate questions:**
1. What procedure or treatment did you receive, and who performed it?
2. What outcome did you expect, and what actually happened?
3. When did you first realize something may have gone wrong?

---

#### FLAG: medmal_multiple_providers

**Severity:** S2  
**Trigger:** Multiple hospitals, specialists, or treating physicians mentioned  
**LawPRO risk:** Failure to identify all potentially liable defendants

**Gate questions:**
1. How many different doctors or hospitals were involved in your care?
2. Can you list each provider and what they did?
3. Have you requested your medical records from all providers?

---

### PA: Slip & Fall / Occupiers' Liability

**Limitation period:** 2 years from discovery — Limitations Act, 2002, s.4. Ultimate: 15 years.  
**Critical secondary:** 60-day written notice for snow/ice on private property — Occupiers' Liability Act, s.6(1). Failure to give notice bars claim.

#### FLAG: slip_ice_snow

**Severity:** S1  
**Trigger:** Fall on ice, snow, slippery surface in winter, icy walkway, unsalted steps  
**LawPRO risk:** Missed 60-day written notice to occupier for snow/ice on private property

**Gate questions:**
1. When exactly did you fall, and what were the conditions (ice, snow, slush)?
2. What type of property was it — private home, business, municipal sidewalk?
3. Have you given any written notice to the property owner? When?

---

#### FLAG: slip_municipality

**Severity:** S1  
**Trigger:** Fall on sidewalk, road, city property, public park  
**LawPRO risk:** Missed 10-day notice of claim for municipal property — Municipal Act, 2001, s.44(10)

**Gate questions:**
1. Was the fall on a city sidewalk, road, or other public property?
2. Have you notified the municipality? In writing?
3. What is the exact address or location of the fall?

---

### PA: Long-Term Disability

**Limitation period:** 2 years from date client knew or ought to have known claim was denied — Limitations Act, 2002, s.4.  
**Critical:** Internal appeal does NOT pause court limitation period.

#### FLAG: ltd_appeal_clock_running

**Severity:** S1  
**Trigger:** "they denied my claim," "I'm appealing," "they said I can appeal internally," "appeal deadline"  
**LawPRO risk:** Failure to warn client that internal appeal does not toll court limitation period

**Gate questions:**
1. When did you receive the written denial from the insurer?
2. Are you currently in an internal appeal process with the insurer?
3. Do you have a copy of the denial letter? What reason did they give?

---

#### FLAG: ltd_policy_definition

**Severity:** S2  
**Trigger:** "any occupation," "can't do my job but could do other work," "they said I can work other jobs"  
**LawPRO risk:** Failure to analyze policy definition of disability (own-occupation vs. any-occupation changes entitlement entirely)

**Gate questions:**
1. Is your policy through your employer or did you purchase it individually?
2. How long have you been receiving LTD payments (or were you before the denial)?
3. What reason did the insurer give for the denial or termination?

---

### PA: Family Law

**Limitation periods:**
- Property equalization: 6 years from separation OR 2 years from divorce — Family Law Act, s.7(3)
- Spousal support: No limitation (weakness in case grows with delay)
- Child support: No limitation

#### FLAG: fam_property_clock

**Severity:** S1  
**Trigger:** Separated 4+ years ago, "we split up a long time ago," long separation without court proceedings  
**LawPRO risk:** Missed 6-year property equalization deadline (permanently bars claim)

**Gate questions:**
1. What is the exact date of separation?
2. Have any court proceedings been started yet?
3. Are there significant assets (home, pension, investments) to divide?

---

#### FLAG: fam_abduction

**Severity:** S1  
**Trigger:** "taken to another country," "she left with the kids," "my child is abroad," "won't let me see," international custody  
**LawPRO risk:** Hague Convention deadlines, jurisdictional bars; failure to advise on emergency custody order

**Gate questions:**
1. What country is the child currently in?
2. When did the child leave Canada, and was it with your knowledge?
3. Is there a current custody order in place? From which court?
4. Is the destination country a signatory to the Hague Convention on Child Abduction?
5. Have you contacted police or a lawyer in the destination country?

---

#### FLAG: fam_domestic_violence

**Severity:** S1  
**Trigger:** Abuse, violence, threats, fear of spouse, police involvement, restraining order, shelter  
**LawPRO risk:** Failure to identify DV history impacts custody, safety planning, and evidence strategy

**Gate questions:**
1. Is there a history of physical, emotional, or financial abuse in the relationship?
2. Are there any existing restraining orders or police involvement?
3. Are you and your children currently safe?

---

#### FLAG: fam_hidden_assets

**Severity:** S2  
**Trigger:** Business owner, self-employed spouse, offshore accounts, "I don't know what he earns," cryptocurrency  
**LawPRO risk:** Inadequate asset disclosure leads to unfair settlement; malpractice if lawyer failed to investigate

**Gate questions:**
1. Does your spouse own a business or have self-employment income?
2. Are you aware of all financial accounts, investments, or real estate your spouse holds?
3. Has your spouse produced full financial disclosure yet?

---

### PA: Child Protection

**Limitation period:** No civil limitation — governed by Child, Youth and Family Services Act, 2017 (CYFSA).  
**Court timeline:** Child must be brought before court within 5 days of apprehension — CYFSA, s.16.

#### FLAG: child_apprehension_recent

**Severity:** S1  
**Trigger:** CAS took child, child removed, apprehension, foster care placement, days since removal  
**LawPRO risk:** Failure to advise on 5-day hearing timeline and client's rights at hearing

**Gate questions:**
1. When was the child removed or apprehended?
2. Where is the child placed now (foster home, relative, other parent)?
3. Has a court date been scheduled? When is the first hearing?

---

#### FLAG: child_protection_allegations

**Severity:** S2  
**Trigger:** Abuse allegations, neglect, exposure to domestic violence, substance use, mental health  
**LawPRO risk:** Inadequate documentation of client's rehabilitation steps and parenting capacity

**Gate questions:**
1. What specific allegations has CAS made against you?
2. Have you completed or been offered any parenting programs, counselling, or other services?
3. What contact or access are you currently having with the child?

---

### PA: Immigration

**Limitation periods:**
- RAD notice of appeal: 15 days from RPD decision — IRPA, Refugee Appeal Division Rules, Rule 3
- RAD appellant's record: 45 days from notice
- Federal Court judicial review: 30 days from tribunal decision

#### FLAG: imm_rad_deadline

**Severity:** S1  
**Trigger:** "my refugee claim was refused," "RPD denied," "I need to appeal my refugee decision"  
**LawPRO risk:** Missed 15-day RAD notice deadline bars appeal permanently

**Gate questions:**
1. When did you receive the written RPD decision?
2. Have you already filed a Notice of Appeal to the RAD?
3. Do you have a copy of the RPD decision?

---

#### FLAG: imm_removal_order

**Severity:** S1  
**Trigger:** Deportation order, removal notice, CBSA enforcement, "I have to leave Canada"  
**LawPRO risk:** Missed stay application deadline; failure to identify Pre-Removal Risk Assessment (PRRA) eligibility

**Gate questions:**
1. Do you have a removal order? What type (departure, exclusion, deportation)?
2. What date have you been told to leave Canada?
3. Have you applied for a PRRA (Pre-Removal Risk Assessment)?

---

#### FLAG: imm_inadmissibility

**Severity:** S2  
**Trigger:** Criminal record, medical condition, security concerns, prior deportation  
**LawPRO risk:** Failure to identify admissibility bars that will defeat immigration application

**Gate questions:**
1. Do you have a criminal record in Canada or any other country?
2. Have you ever been deported or refused entry to Canada or another country?
3. Do you have any medical conditions that required disclosure on immigration forms?

---

### PA: Criminal Law

**Limitation period (summary conviction):** 12 months from alleged offence — Criminal Code, s.786(2).  
**Indictable:** No limitation period.

#### FLAG: crim_charter_violation

**Severity:** S1  
**Trigger:** "police searched without a warrant," "they didn't tell me my rights," "detained without reason," "breathalyzer without lawyer"  
**LawPRO risk:** Failure to identify Charter breaches that could lead to exclusion of evidence

**Gate questions:**
1. Were you told you had the right to a lawyer when police first detained you?
2. Did police search your home, car, or phone? Did they have a warrant?
3. Were you given time to speak with a lawyer before any tests or questioning?

---

#### FLAG: crim_co_accused

**Severity:** S1  
**Trigger:** Multiple people charged, "my friend was also arrested," "we were both there"  
**LawPRO risk:** Conflict of interest between co-accused (different defences, plea incentives)

**Gate questions:**
1. Are there other people charged in connection with the same incident?
2. Have any of them contacted you or your lawyer?
3. Is the same lawyer being asked to represent more than one person?

---

#### FLAG: crim_bail_conditions

**Severity:** S2  
**Trigger:** Bail, house arrest, no-contact order, curfew, reporting condition  
**LawPRO risk:** Failure to advise client on bail condition restrictions; subsequent breach charges

**Gate questions:**
1. Are you currently out on bail? What are your conditions?
2. Is there a no-contact order with any specific person?
3. When is your next court date?

---

### PA: Employment Law (Wrongful Dismissal)

**Limitation periods:**
- Common law wrongful dismissal: 2 years from termination discovery
- ESA complaint to MOL: 2 years from violation — ESA, 2000, s.25
- HRTO discrimination: 1 year from last incident — Human Rights Code, s.34

#### FLAG: emp_hrto_clock

**Severity:** S1  
**Trigger:** Discrimination, harassment, human rights violation, protected ground (disability, race, gender, age)  
**LawPRO risk:** Missed 1-year HRTO application deadline (stricter than general 2-year limitation)

**Gate questions:**
1. When was the last act of discrimination or harassment?
2. Is the basis for discrimination related to a protected ground (disability, race, gender, age, etc.)?
3. Have you filed a complaint with HR or any government body already?

---

#### FLAG: emp_severance_signed

**Severity:** S1  
**Trigger:** "I already signed something," "they gave me papers to sign," release, severance agreement  
**LawPRO risk:** Client signed release without independent legal advice; time pressure tactics by employer

**Gate questions:**
1. Have you signed any documents since your termination?
2. Was there a deadline to sign? What was it?
3. Do you have a copy of what you signed?

---

#### FLAG: emp_constructive_dismissal

**Severity:** S2  
**Trigger:** "they changed my job," "cut my pay," "made it impossible to stay," forced resignation  
**LawPRO risk:** Failure to identify constructive dismissal; client "resigned" but has wrongful dismissal claim

**Gate questions:**
1. Did you resign, or were you terminated by your employer?
2. Were there significant changes to your role, pay, or working conditions before you left?
3. Did you give your employer written notice of the unacceptable changes?

---

### PA: Human Rights (HRTO)

**Limitation period:** 1 year from last incident — Human Rights Code, s.34.

#### FLAG: hrto_one_year_clock

**Severity:** S1  
**Trigger:** Discrimination, harassment, human rights issue  
**LawPRO risk:** 1-year deadline is a hard bar (stricter than 2-year general limitation)

**Gate questions:**
1. When did the last incident of discrimination or harassment occur?
2. Has discrimination been ongoing or was it a single event?
3. Have you filed a complaint with your employer or union?

---

#### FLAG: hrto_respondent_id

**Severity:** S2  
**Trigger:** Complex employer structure, franchise, contractor, union involvement  
**LawPRO risk:** Misidentification of respondent entity leads to rejected application

**Gate questions:**
1. Who is your direct employer — the specific company name and any parent company?
2. If you work at a franchise, do you know who the actual employer is?
3. Is there a union involved? If so, are you filing against the employer, the union, or both?

---

### PA: Real Estate

**Limitation period:** 2 years from discovery — Limitations Act, 2002.  
**Critical:** Title defects and encumbrances must be identified before completion, not after.

#### FLAG: real_estate_undisclosed_defects

**Severity:** S1  
**Trigger:** "they didn't tell me about," "I found out after closing," defects, water damage, mold, foundation  
**LawPRO risk:** Failure to identify non-disclosed material defects pre-completion

**Gate questions:**
1. When did you take possession of the property?
2. When did you first discover the issue?
3. Did the sellers provide a SPIS (Seller Property Information Statement)?

---

#### FLAG: real_estate_dual_representation

**Severity:** S1  
**Trigger:** "our lawyer is representing both of us," same lawyer for buyer and seller  
**LawPRO risk:** Dual representation conflict (LSO Rule 3.4); disclosure duty conflicts

**Gate questions:**
1. Is the same lawyer representing both the buyer and seller in this transaction?
2. Have you been advised of the potential conflict of interest?

---

#### FLAG: real_estate_title

**Severity:** S2  
**Trigger:** Unknown liens, easements, prior owner disputes, title insurance questions  
**LawPRO risk:** Inadequate title search or failure to advise on encumbrances

**Gate questions:**
1. Has a title search been completed on the property?
2. Are there any known liens, mortgages, or easements on the property?
3. Has title insurance been obtained or considered?

---

### PA: Wills & Estates

**Limitation periods:**
- Dependant relief claims: 6 months from grant of probate — Succession Law Reform Act, s.61
- General estate claims: 2 years from discovery

#### FLAG: estates_capacity

**Severity:** S1  
**Trigger:** Elderly client, dementia, cognitive impairment, "she doesn't really understand," caregiver making decisions  
**LawPRO risk:** Testamentary capacity; will contested as invalid

**Gate questions:**
1. Is the person making the will able to understand what they own, who their family members are, and what they want to give?
2. Is there any medical diagnosis related to memory or cognition?
3. Is anyone else present when instructions are given for the will?

---

#### FLAG: estates_undue_influence

**Severity:** S1  
**Trigger:** Caregiver inheriting everything, family member "helping" with will, major beneficiary present during instructions  
**LawPRO risk:** Will challenged for undue influence; lawyer failed to get independent instructions

**Gate questions:**
1. Who is present when the will instructions are being given?
2. Is the main beneficiary also the person bringing the client to the lawyer?
3. Has the client expressed any different wishes when alone?

---

#### FLAG: estates_dependant_relief

**Severity:** S2  
**Trigger:** Spouse or child left out of will, "he left everything to his girlfriend," inadequate provision for spouse  
**LawPRO risk:** Missed 6-month dependant relief deadline from probate grant

**Gate questions:**
1. When was probate granted (the official appointment of the estate trustee)?
2. Is the person challenging the will a spouse, child, or dependant of the deceased?
3. Has the estate trustee begun distributing assets yet?

---

### PA: Corporate / Business Law

**Limitation period:** 2 years from discovery — Limitations Act, 2002. Oppression remedy: no fixed limitation but delay defeats claim.

#### FLAG: corp_oppression

**Severity:** S2  
**Trigger:** Minority shareholder, "pushed out," "diluted my shares," "excluded from decisions," partner dispute  
**LawPRO risk:** Failure to identify oppression remedy or derivative action rights

**Gate questions:**
1. What is your ownership percentage in the corporation?
2. What actions have the majority shareholders or directors taken against your interests?
3. When did you first become aware of the conduct you are complaining about?

---

#### FLAG: corp_personal_liability

**Severity:** S2  
**Trigger:** Director liability, "they're coming after me personally," corporate debt, CRA director  
**LawPRO risk:** Failure to identify personal liability exposure; director due diligence defence not raised

**Gate questions:**
1. Are you a director of the corporation?
2. What debts or claims are being made against you personally?
3. Have you received any demand letters or CRA director liability assessments?

---

### PA: Construction Law

**Limitation periods:**
- Lien preservation (post-July 1, 2018): 60 days from date of publication of certificate of substantial performance — Construction Act, s.31
- Lien perfection: 45 days after expiry of preservation period
- Legacy projects (pre-July 1, 2018): 45-day preservation from substantial performance

#### FLAG: construction_lien_deadline

**Severity:** S1  
**Trigger:** Contractor not paid, subcontractor not paid, holdback not released, work done months ago  
**LawPRO risk:** Missed 60-day lien preservation deadline (no extension; claim lost permanently)

**Gate questions:**
1. When was substantial performance of your work achieved or the project substantially completed?
2. Has a certificate of substantial performance been published on Ontario's Construction Act registry?
3. Have you already registered a lien? If not, how many days ago was work substantially completed?

---

#### FLAG: construction_contract_dispute

**Severity:** S2  
**Trigger:** Defective work, change orders, extras, owner refusing payment, delay claims  
**LawPRO risk:** Failure to advise on holdback obligations, Notice of Non-Payment requirements

**Gate questions:**
1. Was there a written contract? Who were the parties?
2. What amount is in dispute and why is the owner withholding payment?
3. Has a Notice of Non-Payment been issued by the owner or any party?

---

### PA: Landlord & Tenant

**Limitation period:** 2 years for most LTB applications — Residential Tenancies Act, 2006, s.69.  
**Critical:** Termination notice periods must be calculated exactly (60 days for monthly tenancy).

#### FLAG: llt_notice_validity

**Severity:** S1  
**Trigger:** "I gave notice," "they gave me notice," eviction notice, N-form notices  
**LawPRO risk:** Improper notice period calculation voids termination notice; application rejected

**Gate questions:**
1. What type of notice was given (non-payment, own-use, end of lease, other)?
2. What date was the notice served, and what method was used (hand-delivered, email, mail)?
3. What date does the notice say the tenancy ends?

---

#### FLAG: llt_non_payment

**Severity:** S2  
**Trigger:** Rent arrears, unpaid rent, "hasn't paid in months"  
**LawPRO risk:** Incorrect arrears calculation, failure to account for partial payments

**Gate questions:**
1. What is the monthly rent and when was the last payment received?
2. What is the total amount of rent owing?
3. Has the tenant made any partial payments that need to be accounted for?

---

### PA: Intellectual Property

**Limitation period:** 2 years from discovery — Limitations Act, 2002.  
**Critical secondary:** Patent maintenance fees have strict abandonment deadlines at CIPO.

#### FLAG: ip_maintenance_lapse

**Severity:** S1  
**Trigger:** Patent maintenance fee, "my patent lapsed," "CIPO sent a notice," patent maintenance deadline  
**LawPRO risk:** Patent deemed abandoned if maintenance fee missed; reinstatement requires "due care" showing

**Gate questions:**
1. What is the patent number and application number?
2. When was the last maintenance fee paid?
3. Has CIPO sent any notice of deemed abandonment?

---

#### FLAG: ip_infringement

**Severity:** S2  
**Trigger:** "someone copied my product," "they stole my idea," counterfeit, piracy, trademark confusion  
**LawPRO risk:** Failure to preserve evidence; delay weakens injunctive relief application

**Gate questions:**
1. When did you first become aware of the alleged infringement?
2. Do you have documented evidence of the infringement (screenshots, samples, dates)?
3. Have you sent a cease-and-desist letter already?

---

### PA: Insurance Law

**Limitation period:** 2 years from denial — Limitations Act, 2002. Internal appeal does NOT toll limitation.

#### FLAG: ins_claim_denial

**Severity:** S1  
**Trigger:** "they denied my claim," "insurance won't pay," "refused my claim," appeal in progress  
**LawPRO risk:** Internal appeal does not pause court limitation; client may be barred while appealing

**Gate questions:**
1. When did you receive the written denial?
2. Are you currently in an internal appeal with the insurer?
3. Do you have a copy of the denial letter and the policy?

---

### PA: Administrative Law

**Limitation period:** 30 days from tribunal decision for judicial review — Judicial Review Procedure Act (amended July 8, 2020).

#### FLAG: admin_jr_deadline

**Severity:** S1  
**Trigger:** "I want to appeal the tribunal's decision," decision from LTB / HRTO / WSIAT / any tribunal  
**LawPRO risk:** Missed 30-day judicial review application deadline (hard bar; no extension)

**Gate questions:**
1. Which tribunal issued the decision (LTB, HRTO, WSIAT, other)?
2. What date was the decision issued or reasons released?
3. Has any judicial review application been filed yet?

---

### PA: Workers' Compensation (WSIB/WCB)

**Limitation period:**
- WSIB claim: 6 months from accident or diagnosis — Workplace Safety and Insurance Act, 1997, s.22
- WSIAT appeal from WSIB decision: generally 30 days from decision letter

#### FLAG: wsib_six_month_claim

**Severity:** S1  
**Trigger:** Workplace injury, occupational disease, work-related accident, WSIB not filed  
**LawPRO risk:** Missed 6-month WSIB claim filing deadline

**Gate questions:**
1. When did the workplace accident or injury occur, or when were you first diagnosed with the occupational condition?
2. Have you already filed a WSIB claim?
3. Has your employer reported the accident to WSIB?

---

#### FLAG: wsib_dearos

**Severity:** S2  
**Trigger:** "WSIB denied," "they cut off my benefits," return-to-work dispute, employer not accommodating  
**LawPRO risk:** Failure to identify DEAROS (Duty to Accommodate, Return to Work, and Other obligations) violations

**Gate questions:**
1. Have you received a decision letter from WSIB? When?
2. Has your employer offered modified duties or a return-to-work plan?
3. Have you appealed the WSIB decision internally?

---

### PA: Defamation

**Limitation period:** 2 years from discovery — Limitations Act, 2002.  
**Critical secondary:** Libel and Slander Act — 6-week notice requirement for defamatory statements in newspapers or broadcasts; failure to give notice bars claim (Libel and Slander Act, s.5).

#### FLAG: defamation_media_notice

**Severity:** S1  
**Trigger:** "newspaper article," "TV segment," "radio," "broadcast," "news story about me"  
**LawPRO risk:** Missed 6-week notice of action to newspaper/broadcaster; claim barred

**Gate questions:**
1. Was the statement published in a newspaper, magazine, online news outlet, or broadcast?
2. When was the statement first published?
3. Has any written notice been given to the publisher or broadcaster?

---

#### FLAG: defamation_online

**Severity:** S2  
**Trigger:** Social media, review site, forum post, Google review, defamatory tweet/post  
**LawPRO risk:** Failure to preserve screenshots; anonymous defendant identification

**Gate questions:**
1. On what platform was the statement published (Facebook, Google Reviews, Reddit, other)?
2. Do you have screenshots of the statement with dates visible?
3. Do you know who made the statement, or is the poster anonymous?

---

### PA: Bankruptcy & Insolvency

**Limitation period:** 2 years from discovery for creditor claims — Limitations Act, 2002.  
**Critical:** Consumer Proposal stay is limited; automatic stay of proceedings on bankruptcy filing (BIA, s.69).

#### FLAG: insolvency_creditor_action

**Severity:** S1  
**Trigger:** Wage garnishment, lawsuit filed, CRA collection, bank account frozen  
**LawPRO risk:** Failure to advise on automatic stay; client needs immediate protection

**Gate questions:**
1. Have any creditors taken legal action (lawsuit, wage garnishment, bank freeze)?
2. Are you facing a CRA collection notice or assessment?
3. Is there a court date coming up for a creditor action?

---

#### FLAG: insolvency_asset_disclosure

**Severity:** S2  
**Trigger:** RRSP, pension, home equity, business assets, vehicle  
**LawPRO risk:** Inadequate asset/exemption identification leads to poor advice on bankruptcy vs. proposal

**Gate questions:**
1. Do you own any real estate, vehicles, RRSPs, or pensions?
2. Are any of your assets jointly owned with a spouse or family member?
3. Have you transferred any assets to family members in the past 12 months?

---

### PA: Child & Youth Law

**Limitation period:** Governed by Youth Criminal Justice Act (YCJA) and CYFSA; no single civil limitation.

#### FLAG: youth_ycja_charges

**Severity:** S1  
**Trigger:** Youth charged, minor accused, 12-17 years old facing criminal charges, youth court  
**LawPRO risk:** Failure to identify YCJA protections (publication ban, record sealing) and different sentencing regime

**Gate questions:**
1. How old is the young person?
2. What offence has been alleged and when did it occur?
3. Have police spoken to the youth without a parent or lawyer present?

---

#### FLAG: youth_school_discipline

**Severity:** S2  
**Trigger:** School suspension, expulsion, safe schools tribunal, special education dispute  
**LawPRO risk:** Failure to identify appeal timelines under Education Act (expulsion review within 20 days)

**Gate questions:**
1. Has the student received a written suspension or expulsion notice?
2. When was the suspension/expulsion effective?
3. Has a review or appeal been requested?

---

### PA: Municipal Law

**Limitation period:** 30-day notice of claim for personal injury on municipal property — Municipal Act, 2001, s.44(10).  
**General 2-year limitation still applies for other municipal claims.**

#### FLAG: municipal_injury_notice

**Severity:** S1  
**Trigger:** Injury on city property, fall on municipal sidewalk, road defect, city-owned building  
**LawPRO risk:** Missed 10-day (injury) or 10-day (death) notice to municipality bars tort claim

**Gate questions:**
1. Was the injury on a city sidewalk, road, public park, or other municipal property?
2. When did the injury occur?
3. Has written notice been given to the municipality?

---

#### FLAG: municipal_bylaw_appeal

**Severity:** S2  
**Trigger:** Zoning dispute, permit refused, development application, bylaw violation  
**LawPRO risk:** Missed appeal deadline to LPAT/OLT (Ontario Land Tribunal); jurisdictional error

**Gate questions:**
1. What decision by the municipality is being challenged (permit, zoning, OMB/OLT matter)?
2. When was the decision issued?
3. Has any appeal been filed with the Ontario Land Tribunal?

---

### PA: Tax Law

**Limitation period:**
- CRA Notice of Objection: 90 days from NOA — Income Tax Act, s.165
- Extension to object: 1 year from 90-day deadline

#### FLAG: tax_objection_deadline

**Severity:** S1  
**Trigger:** CRA reassessment, notice of assessment, "they say I owe," income tax dispute  
**LawPRO risk:** Missed 90-day objection deadline after Notice of Assessment bars challenge

**Gate questions:**
1. Have you received a Notice of Assessment or Reassessment from CRA?
2. What date was on that notice?
3. Have you filed a Notice of Objection yet?

---

### PA: Environmental Law

**Limitation period:** 2 years from discovery — Limitations Act, 2002. Regulatory orders may have shorter compliance timelines.

#### FLAG: env_remediation_order

**Severity:** S1  
**Trigger:** Environmental compliance order, Ministry of Environment order, contamination, spill  
**LawPRO risk:** Failure to advise on compliance timeline; regulatory penalties accrue daily

**Gate questions:**
1. Has a government order or notice been issued requiring cleanup or remediation?
2. What is the compliance deadline in the order?
3. What type of contamination is involved (chemical, oil, industrial waste)?

---

### PA: Labour Law

**Limitation period:**
- Unfair labour practice complaint: 90 days from act — Ontario Labour Relations Act, s.96(4)
- Grievance arbitration: Per collective agreement (commonly 20–60 days from incident)

#### FLAG: labour_ulp_complaint

**Severity:** S1  
**Trigger:** Union organizing interference, employer retaliation, unfair labour practice, anti-union conduct  
**LawPRO risk:** Missed 90-day OLRB unfair labour practice deadline

**Gate questions:**
1. What specific action by the employer is alleged to be an unfair labour practice?
2. When did this action occur?
3. Is there an active union organizing drive or a certified bargaining unit?

---

### PA: Social Benefits

**Limitation period:** OW appeal: 30 days from decision — Ontario Works Act; ODSP appeal: 30 days from decision.

#### FLAG: social_benefits_appeal

**Severity:** S1  
**Trigger:** "they cut off my ODSP," "OW denied," "Ontario Works," "ODSP terminated," benefits refused  
**LawPRO risk:** Missed 30-day internal appeal deadline; Social Benefits Tribunal application deadlines

**Gate questions:**
1. What program was denied or cut — Ontario Works (OW) or ODSP?
2. When did you receive the written decision?
3. Have you already filed an appeal or requested a review?

---

### PA: Provincial Offences

**Limitation period (summary conviction):** 6 months from offence — Provincial Offences Act, s.76.

#### FLAG: poa_six_month_limit

**Severity:** S1  
**Trigger:** Traffic ticket, bylaw offence, regulatory charge, fine, Highway Traffic Act charge  
**LawPRO risk:** Missed 6-month limitation for Provincial Offences Act charges

**Gate questions:**
1. What type of charge or ticket is this (traffic, bylaw, regulatory)?
2. What date is shown on the ticket or charging document?
3. Have you requested a trial date yet?

---

### PA: Healthcare Law

**Limitation period:** 2 years from discovery — Limitations Act, 2002. CPSO complaints have no limitation period.

#### FLAG: health_cpso_complaint

**Severity:** S2  
**Trigger:** "I want to file a complaint about my doctor," physician misconduct, CPSO, RCDSO, CONO  
**LawPRO risk:** Failure to distinguish civil action from regulatory complaint; parallel proceedings

**Gate questions:**
1. Are you seeking compensation (civil action) or discipline of the healthcare provider (regulatory complaint)?
2. Do you want to pursue both simultaneously?
3. Has a complaint already been filed with the College?

---

### PA: Securities & Financial Law

**Limitation period:**
- OSC civil action under Securities Act: 3 years from date of discovery with knowledge, 6 years from transaction — Securities Act, s.138.14
- General: 2 years from discovery — Limitations Act

#### FLAG: sec_misrepresentation

**Severity:** S1  
**Trigger:** Investment fraud, mis-sold securities, advisor misconduct, unauthorized trading  
**LawPRO risk:** Failure to identify OSC-specific limitation periods or IIROC arbitration deadlines

**Gate questions:**
1. What type of investment product was involved (mutual fund, stock, GIC, other)?
2. When did you first realize there was a problem with this investment?
3. Is the person you are complaining about registered with IIROC, OSC, or another body?

---

### PA: Elder Law

**Limitation period:** 2 years from discovery — Limitations Act, 2002. PoA disputes governed by Substitute Decisions Act.

#### FLAG: elder_poa_abuse

**Severity:** S1  
**Trigger:** Power of attorney misused, "my family took my money," financial elder abuse, guardian misconduct  
**LawPRO risk:** Failure to identify financial elder abuse; improper PoA revocation process

**Gate questions:**
1. Is there a Power of Attorney for Property in place? Who is the attorney?
2. What transactions or actions are suspected to be unauthorized?
3. Does the person granting the PoA still have legal capacity to revoke it?

---

### PA: Privacy & Data Law

**Limitation period:** PIPEDA complaints to OPC: no fixed deadline but delay weakens case. Civil privacy torts: 2 years from discovery.

#### FLAG: privacy_data_breach

**Severity:** S2  
**Trigger:** Data breach, personal information exposed, hacked, unauthorized access to records  
**LawPRO risk:** Failure to identify whether PIPEDA, Ontario privacy legislation, or sector-specific rules apply

**Gate questions:**
1. What type of organization was involved (health, financial, government, commercial)?
2. What personal information was disclosed or accessed?
3. Has the organization notified you of the breach in writing?

---

### PA: Class Actions

**Limitation period:** 2 years from discovery (per Limitations Act). Class proceedings have suspension rules under CPA.

#### FLAG: class_action_opt_out

**Severity:** S2  
**Trigger:** "I received a class action notice," "I want to opt out," class action settlement, certification  
**LawPRO risk:** Failure to advise on opt-out deadline and individual claim value vs. class settlement

**Gate questions:**
1. Have you received a notice about a class action settlement?
2. What deadline is shown on the notice for opting out?
3. Is your individual claim larger than what the class action would provide?

---

### PA: Animal Law

**Limitation period:** 2 years from discovery — Limitations Act, 2002. OSPCA seizure: immediate court process.

#### FLAG: animal_bite_injury

**Severity:** S2  
**Trigger:** Dog bite, animal attack, injury caused by someone's pet  
**LawPRO risk:** Failure to identify strict liability under Dog Owners' Liability Act (Ontario) — no negligence required

**Gate questions:**
1. What type of animal was involved?
2. Do you know who owns the animal?
3. Did the attack require medical treatment? Do you have medical records?

---

## Flag Registry Summary

| Flag ID | PA | Severity | Primary Risk |
|---------|-----|----------|--------------|
| limitation_proximity | Universal | S1 | Missed limitation period |
| conflict_adverse_party | Universal | S1 | LSO Rule 3.4 conflict |
| prior_counsel | Universal | S2 | Scope creep, unrealistic expectations |
| minor_claimant | Universal | S2 | Litigation guardian not identified |
| vulnerable_client | Universal | S2 | Testamentary/instructional capacity |
| pi_limitation_window | PI | S1 | 2-year limitation |
| pi_unidentified_parties | PI | S1 | Missed defendants |
| pi_evidence_preservation | PI | S2 | Inadequate investigation |
| mvac_insurer_not_notified | MVA | S1 | 7-day accident benefits notice |
| mvac_hit_and_run | MVA | S1 | Unknown defendant, uninsured coverage |
| mvac_accident_benefits | MVA | S2 | AB entitlement not advised |
| medmal_causation_unclear | Medical Malpractice | S1 | Causation not established |
| medmal_multiple_providers | Medical Malpractice | S2 | Missed defendants |
| slip_ice_snow | Slip & Fall | S1 | 60-day occupier notice |
| slip_municipality | Slip & Fall | S1 | 10-day municipal notice |
| ltd_appeal_clock_running | LTD | S1 | Court clock runs during internal appeal |
| ltd_policy_definition | LTD | S2 | Policy definition not analysed |
| fam_property_clock | Family | S1 | 6-year equalization deadline |
| fam_abduction | Family | S1 | Hague Convention / emergency custody |
| fam_domestic_violence | Family | S1 | Safety; DV history not captured |
| fam_hidden_assets | Family | S2 | Inadequate financial disclosure |
| child_apprehension_recent | Child Protection | S1 | 5-day hearing timeline |
| child_protection_allegations | Child Protection | S2 | Rehabilitation steps not documented |
| imm_rad_deadline | Immigration | S1 | 15-day RAD notice |
| imm_removal_order | Immigration | S1 | Deportation; PRRA eligibility |
| imm_inadmissibility | Immigration | S2 | Admissibility bars |
| crim_charter_violation | Criminal | S1 | Charter breach not identified |
| crim_co_accused | Criminal | S1 | Co-accused conflict |
| crim_bail_conditions | Criminal | S2 | Bail condition compliance |
| emp_hrto_clock | Employment | S1 | 1-year HRTO deadline |
| emp_severance_signed | Employment | S1 | Release signed without ILA |
| emp_constructive_dismissal | Employment | S2 | Resignation vs. constructive dismissal |
| hrto_one_year_clock | HRTO | S1 | 1-year hard deadline |
| hrto_respondent_id | HRTO | S2 | Wrong respondent entity |
| real_estate_undisclosed_defects | Real Estate | S1 | Material defect after closing |
| real_estate_dual_representation | Real Estate | S1 | LSO Rule 3.4 dual rep |
| real_estate_title | Real Estate | S2 | Encumbrances not identified |
| estates_capacity | Wills & Estates | S1 | Testamentary capacity |
| estates_undue_influence | Wills & Estates | S1 | Independent instructions not taken |
| estates_dependant_relief | Wills & Estates | S2 | 6-month dependant relief deadline |
| corp_oppression | Corporate | S2 | Oppression remedy missed |
| corp_personal_liability | Corporate | S2 | Director liability not identified |
| construction_lien_deadline | Construction | S1 | 60-day lien preservation |
| construction_contract_dispute | Construction | S2 | Holdback / Notice of Non-Payment |
| llt_notice_validity | Landlord & Tenant | S1 | Invalid notice calculation |
| llt_non_payment | Landlord & Tenant | S2 | Incorrect arrears calculation |
| ip_maintenance_lapse | IP | S1 | Patent abandonment |
| ip_infringement | IP | S2 | Evidence preservation |
| ins_claim_denial | Insurance | S1 | Internal appeal / court clock |
| admin_jr_deadline | Administrative | S1 | 30-day judicial review |
| wsib_six_month_claim | WSIB | S1 | 6-month claim deadline |
| wsib_dearos | WSIB | S2 | RTW / accommodation dispute |
| defamation_media_notice | Defamation | S1 | 6-week notice to broadcaster |
| defamation_online | Defamation | S2 | Evidence preservation |
| insolvency_creditor_action | Bankruptcy | S1 | Automatic stay needed |
| insolvency_asset_disclosure | Bankruptcy | S2 | Exemptions not identified |
| youth_ycja_charges | Child & Youth | S1 | YCJA protections not identified |
| youth_school_discipline | Child & Youth | S2 | Education Act appeal timeline |
| municipal_injury_notice | Municipal | S1 | 10-day municipal notice |
| municipal_bylaw_appeal | Municipal | S2 | OLT appeal deadline |
| tax_objection_deadline | Tax | S1 | 90-day CRA objection |
| env_remediation_order | Environmental | S1 | Regulatory order compliance |
| labour_ulp_complaint | Labour | S1 | 90-day OLRB deadline |
| social_benefits_appeal | Social Benefits | S1 | 30-day OW/ODSP appeal |
| poa_six_month_limit | Provincial Offences | S1 | 6-month POA limitation |
| health_cpso_complaint | Healthcare | S2 | Regulatory vs. civil confusion |
| sec_misrepresentation | Securities | S1 | OSC-specific limitation |
| elder_poa_abuse | Elder Law | S1 | Financial elder abuse / capacity |
| privacy_data_breach | Privacy | S2 | Applicable legislation identified |
| class_action_opt_out | Class Actions | S2 | Opt-out deadline |
| animal_bite_injury | Animal Law | S2 | Strict liability DOLA |

**Total flags: 72**  
**S1 (CRITICAL): 45**  
**S2 (HIGH): 27**

---

## Sources

- LawPRO practicePRO Claims Fact Sheets: https://www.practicepro.ca/practice-aids/claims-fact-sheets/
- LSO Rules of Professional Conduct, Chapter 3: https://lso.ca/about-lso/legislation-rules/rules-of-professional-conduct/chapter-3
- Ontario Limitations Act, 2002: https://www.ontario.ca/laws/statute/02l24
- Insurance Act (Ontario): https://www.ontario.ca/laws/statute/90i08
- Occupiers' Liability Act (Ontario): https://www.ontario.ca/laws/statute/90o02
- Municipal Act, 2001: https://www.ontario.ca/laws/statute/01m25
- Human Rights Code (Ontario): https://www.ontario.ca/laws/statute/90h19
- Employment Standards Act, 2000: https://www.ontario.ca/laws/statute/00e41
- Family Law Act (Ontario): https://www.ontario.ca/laws/statute/90f03
- Child, Youth and Family Services Act, 2017: https://www.ontario.ca/laws/statute/17c14
- Immigration and Refugee Protection Act: https://laws-lois.justice.gc.ca/eng/acts/i-2.5/
- Workplace Safety and Insurance Act, 1997: https://www.ontario.ca/laws/statute/97w16
- Construction Act (Ontario): https://www.ontario.ca/laws/statute/90c30
- Residential Tenancies Act, 2006: https://www.ontario.ca/laws/statute/06r17
- Judicial Review Procedure Act (Ontario): https://www.ontario.ca/laws/statute/90j01
- Succession Law Reform Act: https://www.ontario.ca/laws/statute/90s26
- Libel and Slander Act (Ontario): https://www.ontario.ca/laws/statute/90l12
- Criminal Code of Canada: https://laws-lois.justice.gc.ca/eng/acts/c-46/
- Youth Criminal Justice Act: https://laws-lois.justice.gc.ca/eng/acts/y-1.5/
- Ontario Labour Relations Act: https://www.ontario.ca/laws/statute/95l01
- Provincial Offences Act: https://www.ontario.ca/laws/statute/90p33
- Securities Act (Ontario): https://www.ontario.ca/laws/statute/90s05
- Substitute Decisions Act, 1992: https://www.ontario.ca/laws/statute/92s30
- Dog Owners' Liability Act: https://www.ontario.ca/laws/statute/90d16
- HRLSC — JRPA 30-Day Amendment: https://hrlsc.on.ca/law-updates/new-amendments-to-the-judicial-review-procedure-act-jrpa-including-new-30-day-deadline-to-file-application/

---

## Next Steps

**Session 0b:** PA-specific deep dive for the 12 remaining PAs not yet sourced to LawPRO claims data directly. Verify S1 flags against LawPRO fact sheets per PA.

**Session 1:** Build classifier prompt schema — input: conversation transcript + firm's PA list; output: `{ pa: string, sub_type: string, flags: string[] }`.

**Session 2:** Implement flag registry as TypeScript config + gate rules engine — maps each flag ID to its mandatory gate questions array.

**Session 3:** Classifier golden test set (100 scenarios across 38 PAs, including edge cases: cross-border family, PI with municipal sidewalk, immigration + criminal overlap).
