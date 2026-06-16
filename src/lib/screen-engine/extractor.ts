import type {
  EngineState, PracticeArea, MatterType, IntentFamily,
  RawSignals, AdvisorySubtrack, DisputeFamily, SupportedLanguage,
} from './types';

const lower = (s: string) => s.toLowerCase();

function matchesAny(text: string, patterns: string[]): boolean {
  const t = lower(text);
  return patterns.some(p => t.includes(lower(p)));
}

// ─── Intent routing signals ────────────────────────────────────────────────

const SETUP_ADVISORY_SIGNALS = [
  'open a business', 'opening a business', 'open my business', 'opening my business',
  'start a business', 'starting a business', 'start my business', 'starting my business',
  'open a company', 'opening a company',
  'start a company', 'starting a company', 'set up a company', 'setting up a company',
  // Explicit "corporation" variants (the noun the lead may use instead of "company")
  'open a corporation', 'opening a corporation', 'start a corporation',
  'starting a corporation', 'set up a corporation', 'setting up a corporation',
  'form a corporation', 'forming a corporation', 'create a corporation',
  'creating a corporation', 'register a corporation', 'registering a corporation',
  'incorporate', 'incorporating', 'business idea', 'bring someone in as a partner',
  'bring in a partner', 'with a friend', 'company together', 'business together',
  'do it properly', 'protect myself', 'structure it properly', 'split ownership',
  'shareholder agreement before starting', 'buying into an existing company',
  'buying into a business', 'buying into an existing', 'joining a company',
  'review the documents before signing', 'check the documents before signing',
  'review documents', 'check the documents', 'with a partner', 'new business',
  'new company', 'launch a business', 'launch a company', 'register a company',
  'register the business', 'basic guidance', 'just need guidance',
  'incorporate by myself', 'need to incorporate',
  // Freelancer / sole-prop / tax registration — still corporate-lawyer territory
  'freelancing', 'freelancer', 'started freelancing', 'sole proprietor',
  'sole prop', 'self-employed', 'self employed', 'consultant on my own',
  'need a hst', 'need an hst', 'hst number', 'gst number', 'gst/hst',
  'register for hst', 'register for gst', 'business number',
  'should i incorporate', 'do i need to incorporate', 'incorporate or not',
  'sole prop vs corporation', 'sole proprietor or corporation',
  // Layperson phrasings
  'starting my own thing', 'going into business', 'going on my own',
  'work for myself', 'go independent', 'starting up', 'starting out on my own',
  'do my own thing', 'open my own', 'start my own', 'starting my own',
  'thinking of starting', 'thinking about starting', 'want to start',
  'wanting to start', 'planning to start', 'planning on starting',
  'open up shop', 'set up shop', 'do something together',
  'go in on this together', 'go into something together',
];

const BUSINESS_DISPUTE_SIGNALS = [
  'not paying', 'owes money', 'unpaid invoice', 'refuses to pay',
  'says the work was bad', 'denies the agreement', 'broke our agreement',
  'business partner hiding money', 'locked out', "can't access bank account",
  "won't show records", "won't show me anything", 'cofounder changed bank access',
  'partner making decisions without me', 'being left out', 'taking money from the business',
  'they owe', 'owes us', 'owes me', 'still not paid', 'money missing',
  'hiding money', 'bank access', 'locked me out', 'excluding me',
  'making decisions without me', 'overcharged', 'overcharging', 'billing dispute',
  'financial irregularity', 'embezzlement', 'embezzling', 'embezzle',
  'unauthorized transaction', 'unauthorized transfer', 'unauthorized charges',
  'suspicious transactions', 'fraudulent invoice', 'vendor dispute',
  'supplier dispute', 'contractor dispute',
  'business dispute', 'company dispute', 'problem in my company',
  'issue with my company', 'issue in my company', 'company finances',
  // Layperson phrasings
  'being weird about money', 'shady stuff', 'shady things',
  "can't get straight answers", 'feels off', 'something is off',
  'something feels wrong', 'something fishy', 'fishy', 'feels fishy',
  "i don't trust them anymore", 'they are hiding things', 'they hid things',
  'ripped us off', 'ripped me off', 'screwed us over', 'screwed me over',
  'shady billing', 'sketchy billing', 'sketchy invoice',
  'stiffed me', 'stiffed us', 'they ghosted', 'ghosted on payment',
  'ghosted us', "won't return my calls", "won't return our calls",
  'changed everything without telling me', 'changed things without telling me',
  'shut me out', 'shutting me out', 'frozen out', 'froze me out',
  "won't pay what they owe", "haven't paid in months", 'still waiting on payment',
  "they aren't doing what they said", "they aren't doing what was agreed",
  "don't follow through", "didn't follow through", 'going back on what we agreed',
];

// Strong dispute override: these signals mean business_dispute even if setup words are present
const DISPUTE_OVERRIDE_SIGNALS = [
  "can't access", "cannot access", "locked out", "locked me out",
  "won't show me", "not showing me", "taking money", "money missing",
  "hiding money", "changed bank access", "making decisions without me",
  "being left out", "excluding me", "won't show records",
  "removed from bank", "changed passwords", "pushed me out",
  // Layperson dispute overrides
  "shut me out", "froze me out", "frozen out", "shutting me out",
  "won't return my calls", "won't return our calls", "ghosted",
  "ghosted me", "ghosted us", "stiffed me", "stiffed us",
];

// ─── Composite classification signals ─────────────────────────────────────

const SHAREHOLDER_BUSINESS_RELATION = [
  'started a company', 'started a business', 'cofounder', 'co-founder',
  'business partner', 'partner in the company', 'shareholder', 'owner',
  'co-owner', 'own part of a company', 'shares in a company',
  'my partner', 'our company', 'own part', 'co owner',
];

const SHAREHOLDER_CONTROL_MONEY = [
  'taking money', 'took money', 'hiding money', 'money missing', 'company money',
  'bank access', 'locked me out', 'changed passwords', 'changed bank access',
  'not telling me', 'without telling me', 'excluding me', "won't show records",
  "won't show me anything", 'making decisions without me', 'left out',
  'keeping me out', 'locked out', "can't access", 'cannot access',
  'removed from', 'blocked me', 'pushed me out', 'being pushed out',
  "won't let me", 'restricted my access',
  // Layperson
  'shut me out', 'shutting me out', 'froze me out', 'frozen out',
  'being weird about money', 'shady stuff', 'fishy',
  "can't get straight answers", 'changed everything without telling me',
  "won't show me", 'show me the books', "won't show me the books",
  "won't open the books", "won't share the financials",
];

const UNPAID_PAYMENT_SIGNALS = [
  'not paying', "hasn't paid", "haven't paid", "won't pay", 'owes us', 'owes me',
  'owes my company', 'unpaid invoice', 'invoice', 'bill', 'past due',
  'delaying payment', 'refuses to pay', 'outstanding', 'not paid',
  'still owes', 'money owed', 'collecting', 'collect a debt',
  // Layperson
  'stiffed', 'ghosted', 'still waiting on payment', 'never paid',
  'keep saying they will pay', 'kept promising to pay', 'months behind on payment',
  'months late on payment',
];

const UNPAID_BUSINESS_CONTEXT = [
  'client', 'customer', 'vendor', 'supplier', 'company', 'business',
  'work', 'services', 'goods', 'delivered', 'service', 'project',
  'contractor', 'subcontractor',
];

const CONTRACT_AGREEMENT_SIGNALS = [
  'we agreed', 'agreement', 'contract', 'deal', 'terms', 'signed',
  'email agreement', 'messages', 'agreed by email', 'agreed by text',
  'we had a deal', 'our deal', 'the contract', 'the agreement',
];

const CONTRACT_BREACH_SIGNALS = [
  'broke', "didn't deliver", 'not delivering', 'failed to deliver',
  'not what was promised', 'changed the terms', 'backed out',
  'denying everything', 'denies everything', 'deny everything',
  'says there was no agreement', 'not honouring',
  // Layperson
  "they aren't doing what they said", 'going back on what we agreed',
  'changed their mind', 'changed his mind', 'changed her mind',
  "didn't follow through", "won't honour", 'broken promise',
  'broke their word', 'broke their promise',
];

// ─── General counsel advisory signals (DR-072) ─────────────────────────────
//
// Three named sets, unioned in detectIntent. Kept separate for the brief's
// "exact trigger phrases" documentation and for per-set regression tests.
//
// Anti-scope discipline (the no-junk-drawer guard): these are checked in
// detectIntent AFTER setup_advisory and business_dispute, so a real
// incorporation, dispute, purchase, or lease always wins. They are checked
// BEFORE the weak real-estate-base fallback and the corporate_general
// catch-all, so an explicit "on-call lawyer" / "records upkeep" ask routes
// here instead of dying in a generic lane. The contract-review set is kept
// tight to the word "contract" + named agreement types; pre-incorporation
// document review ("review the shareholders agreement before signing")
// stays with setup_advisory because setup is matched first.

const FRACTIONAL_COUNSEL_SIGNALS = [
  'fractional counsel', 'fractional general counsel', 'outsourced general counsel',
  'outsourced counsel', 'outside general counsel', 'general counsel services',
  'on-call lawyer', 'on call lawyer', 'lawyer on retainer', 'lawyer on call',
  'ongoing legal support', 'ongoing legal advice', 'ongoing counsel',
  'legal support on retainer', 'advisor on retainer', 'monthly legal support',
  'retainer arrangement', 'part-time general counsel', 'part time general counsel',
  'in-house counsel on demand', 'gc services', 'legal partner for my business',
];

const STANDALONE_CONTRACT_REVIEW_SIGNALS = [
  'review a contract', 'review this contract', 'review my contract',
  'review the contract', 'have a contract reviewed', 'need a contract reviewed',
  'get a contract reviewed', 'contract reviewed before', 'look over a contract',
  'look over this contract', 'check a contract', 'check this contract',
  'draft a contract', 'draft this contract', 'write up a contract',
  'review an nda', 'review a vendor agreement', 'review a service agreement',
  'review a consulting agreement', 'review a supplier agreement',
  'review a partnership contract before', 'contract review service',
  'review terms before i sign', 'review the terms before signing',
];

const NOTARY_SIGNALS = [
  'notarize', 'notarized', 'notarise', 'notarised', 'notary', 'notary public',
  'commissioner of oaths', 'commissioner for oaths', 'commission an oath',
  'certify a copy', 'certified copy', 'certified true copy', 'true copy',
  'witness my signature', 'witness a signature', 'attest a document',
  'attest my signature', 'statutory declaration witnessed', 'document notarized',
];

const RECORDS_UPKEEP_SIGNALS = [
  'records upkeep', 'minute book', 'minute books', 'corporate records',
  'annual records', 'annual return', 'annual returns', 'annual resolutions',
  'corporate maintenance', 'corporate compliance', 'keep my corporation compliant',
  'keep the corporation compliant', 'keep my company compliant',
  'maintain my corporation', 'maintain corporate records', 'update corporate records',
  'corporate housekeeping', 'corporate filings', 'keep up with filings',
  'annual filings', 'compliance filings',
];

// ─── New matter type signals ───────────────────────────────────────────────

const VENDOR_SUPPLIER_SIGNALS = [
  'overcharged by vendor', 'overcharged by supplier', 'overbilled',
  'billing dispute with vendor', 'billing dispute with supplier',
  'billing dispute with our vendor', 'billing dispute with our supplier',
  'vendor billed us wrong', 'supplier sent wrong invoice', 'wrong amount on invoice',
  'disputing vendor invoice', 'disputing supplier invoice',
  'charged for something we didn\'t receive', 'vendor charged us twice',
  'subscription dispute', 'saas billing', 'software subscription dispute',
  'vendor overcharged', 'supplier overcharged', 'vendor overcharging', 'overcharging us',
  'charges we never agreed', 'charges we didn\'t agree', 'unauthorized charges',
  'vendor added charges', 'supplier added charges', 'vendor charges',
  'goods not delivered', 'goods were never delivered', 'services not delivered',
  'dispute with our vendor', 'dispute with our supplier',
];

const VENDOR_BUSINESS_CONTEXT = [
  'vendor', 'supplier', 'service provider', 'software vendor', 'saas',
  'contractor', 'subcontractor', 'our supplier', 'a vendor', 'the vendor',
];

// ─── Real estate signals ───────────────────────────────────────────────────

const REAL_ESTATE_BASE_SIGNALS = [
  // Property types & general
  'real estate', 'property', 'house', 'home', 'condo', 'condominium', 'townhouse',
  'detached', 'semi-detached', 'apartment building', 'building', 'plaza',
  'commercial property', 'industrial property', 'office space', 'retail space',
  'warehouse', 'investment property', 'rental property', 'land', 'lot',
  'vacant land', 'farm land', 'parcel',
  // Transactions
  'buying a house', 'buying a home', 'buying a condo', 'buying a property',
  'selling my house', 'selling my home', 'selling a property',
  'purchase agreement', 'agreement of purchase and sale', 'aps',
  'real estate transaction', 'real estate deal', 'real estate purchase',
  'closing date', 'closing day', 'closing on', 'set to close',
  'land transfer tax', 'title insurance', 'title transfer',
  // Mortgage
  'mortgage', 'remortgage', 'refinance', 'second mortgage', 'private mortgage',
  // Tenancy
  'tenant', 'tenants', 'landlord', 'landlords', 'lease', 'leasing',
  'commercial lease', 'residential lease', 'rental agreement',
  'eviction', 'evict', 'evicted', 'rent dispute', 'unpaid rent',
  'ltb', 'landlord and tenant board', 'n4 notice', 'n12 notice', 'n13 notice',
  // Construction
  'construction lien', 'lien claim', 'construction act', 'mechanics lien',
  'holdback', 'unpaid contractor', 'unpaid subcontractor', 'general contractor',
  'lien preservation', 'preserve a lien', 'perfect a lien',
  // Preconstruction
  'pre-construction', 'preconstruction', 'pre construction', 'tarion',
  'delayed closing', 'extended closing', 'occupancy delay',
  'condo deposit', 'preconstruction condo', 'assignment', 'assigning my unit',
  'assignment fee', 'developer', 'builder',
  // Litigation / disputes
  'breach of aps', 'failed to close', 'failed closing', 'lost deposit',
  'deposit dispute', 'boundary dispute', 'easement dispute', 'easement',
  'title dispute', 'title issue', 'misrepresentation on the property',
  'undisclosed defect', 'hidden defect', 'real estate fraud',
  'power of sale', 'foreclosure', 'mortgage default',
];

const RE_TRANSACTION_SIGNALS = [
  'buying a house', 'buying a home', 'buying a condo', 'buying a property',
  'buying property', 'looking to buy', 'about to buy', 'closing on a',
  'selling my house', 'selling my home', 'selling a property',
  'selling my condo', 'about to sell', 'listing my',
  'purchase agreement', 'agreement of purchase and sale', 'sign an aps',
  'closing date', 'set to close', 'closing in', 'closing next',
  'closing this', 'review the aps', 'review the agreement',
  'commercial lease', 'leasing commercial', 'leasing office', 'leasing retail',
  'leasing a unit', 'sign a lease', 'review a lease',
  'land transfer tax', 'title insurance', 'closing documents',
  'mortgage approval', 'mortgage refinance', 'remortgage', 'refinancing',
  'first time buyer', 'second home', 'investment property purchase',
  // Layperson
  'getting a house', 'getting a home', 'getting a condo', 'getting a place',
  'we got a place', 'we got a house', 'got a condo', 'got the keys',
  'we are moving', "we're moving", 'we just bought', 'just bought a',
  'just sold a', "we're selling", 'we are selling', 'putting our place on the market',
  'making an offer', 'made an offer', 'we got an offer', 'accepted an offer',
  'got an offer accepted', 'thinking of buying', 'thinking about buying',
  'looking at a house', 'looking at a condo', 'looking at a place',
  'looking at a property', 'put in an offer',
];

const RE_DISPUTE_SIGNALS = [
  'breach of aps', 'failed to close', 'failed closing', 'buyer walked away',
  'seller walked away', 'lost deposit', 'deposit dispute', 'deposit refund',
  'boundary dispute', 'easement dispute', 'easement issue',
  'title dispute', 'title problem', 'title issue',
  'misrepresentation on the property', 'misrepresented the property',
  'undisclosed defect', 'hidden defect', 'latent defect',
  'real estate fraud', 'title fraud',
  'specific performance', 'sue the seller', 'sue the buyer',
  'eviction', 'evict', 'evicted', 'rent dispute', 'unpaid rent',
  'ltb application', 'n4 notice', 'n12 notice', 'n13 notice', 'l1 application',
  'commercial lease dispute', 'commercial tenant dispute',
  'construction lien', 'lien claim', 'unpaid contractor', 'unpaid subcontractor',
  'lien preservation', 'preserve a lien', 'perfect a lien',
  'tarion', 'delayed closing', 'occupancy delay', 'condo deposit',
  'assignment dispute', 'assignment fee dispute',
  'power of sale', 'foreclosure', 'mortgage default',
  // Construction context — non-payment phrasings
  'i am a contractor', 'i am a subcontractor', 'i am a general contractor',
  "i'm a contractor", "i'm a subcontractor", "i'm a general contractor",
  'we are a contractor', 'we are a subcontractor',
  "we're a contractor", "we're a subcontractor",
  'the gc stiffed', 'gc stiffed us', 'gc has not paid', 'gc not paying',
  'general contractor has not paid', 'contractor has not paid',
  'has not paid me for', 'has not paid us for', 'have not been paid for',
  'not been paid for', 'tenant won\'t pay', 'tenant not paying',
  // Layperson real-estate dispute phrasings
  'the seller lied', 'they lied about the house', 'they hid problems',
  'we found stuff after we moved in', 'found problems after closing',
  'the deal fell through', 'the deal fell apart', 'deal blew up',
  'they backed out', 'we lost our deposit', 'they kept our deposit',
  'they refused to give back the deposit', "won't give us our deposit back",
  'the place had hidden problems', 'fence is in the wrong place',
  'neighbour put a fence on my land', 'someone built on my land',
  'tenant won\'t leave', 'tenant refusing to leave', "can't get rid of my tenant",
  'landlord won\'t fix', 'landlord won\'t do repairs', 'trying to kick me out',
  "they're trying to evict me", 'landlord trying to evict',
  // Construction — layperson
  'we did the work but didn\'t get paid', 'did the work and weren\'t paid',
  'finished the job but no payment', 'the contractor stiffed us',
  'they ghosted on payment', 'owner won\'t pay us', 'owner ran off without paying',
  // Mortgage — layperson
  "bank's threatening to take", "bank is threatening to take", 'going to lose the house',
  'going to lose our home', "we're behind on payments", 'behind on the mortgage',
  'lender threatening', 'lender is threatening', 'they are taking the house',
  // Preconstruction layperson
  "the builder keeps pushing back", "can't get our deposit back from the builder",
  "developer keeps delaying", "stuck waiting on the builder", 'builder won\'t close',
  'builder keeps delaying', 'builder is delaying',
];

const COMMERCIAL_RE_SIGNALS = [
  'commercial property', 'commercial real estate', 'commercial purchase',
  'commercial lease', 'office space', 'retail space', 'industrial property',
  'warehouse', 'plaza', 'investment property', 'apartment building',
  'multi-residential', 'mixed use', 'commercial building',
  'business premises', 'leasing commercial', 'commercial tenant',
  // Business-scoped leasing phrasings (2026-06-11, DR-070). Field defect:
  // "I need to lease a space for my business" matched none of the above,
  // fell to real_estate_general, and the LLM force-fit the routing slot.
  // These phrases are deliberately business-anchored so residential
  // renters ("rent an apartment") never land here.
  'lease a space', 'leasing a space', 'space for my business',
  'lease an office', 'lease a storefront', 'lease commercial',
  'commercial leasing', 'offer to lease',
];

const RESIDENTIAL_RE_SIGNALS = [
  'buying a house', 'buying a home', 'buying a condo', 'buying my first home',
  'selling my house', 'selling my home', 'selling my condo',
  'closing on my house', 'closing on my home', 'closing on my condo',
  'first time buyer', 'first home', 'family home', 'principal residence',
  'detached', 'semi-detached', 'townhouse', 'townhome', 'bungalow',
  'residential', 'residential real estate', 'residential property',
  'house closing', 'home closing', 'condo closing',
];

const RE_LITIGATION_SIGNALS = [
  'breach of aps', 'failed to close', 'failed closing', 'walked away from',
  'lost deposit', 'deposit dispute', 'deposit refund', 'sue the seller',
  'sue the buyer', 'specific performance', 'real estate lawsuit',
  'boundary dispute', 'boundary issue', 'easement dispute', 'easement issue',
  'title dispute', 'title fraud', 'title problem', 'misrepresentation',
  'undisclosed defect', 'hidden defect', 'latent defect',
  'real estate fraud', 'real estate misrepresentation',
  // Layperson
  'seller lied', 'sellers lied', 'they lied about the house',
  'they lied about the condo', 'they lied about the property',
  'they lied about the basement', 'lied about the place',
  'hid problems', 'hid issues', 'didn\'t disclose', 'failed to disclose',
  'hidden problems we found', 'problems they didn\'t tell us about',
  'we found stuff after we moved in', 'found problems after closing',
];

const LANDLORD_TENANT_SIGNALS = [
  'tenant', 'tenants', 'landlord', 'evict', 'eviction', 'evicted',
  'unpaid rent', 'rent dispute', 'lease dispute', 'rental dispute',
  'ltb', 'landlord and tenant board', 'n4 notice', 'n12 notice', 'n13 notice',
  'l1 application', 'l2 application', 'commercial lease dispute',
  'commercial tenant dispute', 'tenant won\'t pay', 'tenant not paying',
  'tenant won\'t leave', 'tenant refusing to leave', 'overhold',
  // Layperson
  "can't get rid of my tenant", "can't get rid of the tenant",
  'tenant is causing trouble', "tenant won't pay rent", "tenants won't pay",
  'tenant trashed', 'damaged the unit', 'damaged my place',
  "landlord won't fix", "landlord won't do repairs",
  'trying to kick me out', "they're kicking me out", 'kicking us out',
  'broke the lease', 'broken lease',
];

const CONSTRUCTION_LIEN_SIGNALS = [
  'construction lien', 'lien claim', 'preserve a lien', 'perfect a lien',
  'construction act', 'mechanics lien', 'lien preservation',
  'unpaid contractor', 'unpaid subcontractor', 'unpaid for construction',
  'unpaid for renovation', 'construction holdback', 'holdback dispute',
  'general contractor not paid', 'contractor not paid',
  'i am a contractor', 'i am a subcontractor', 'i am a general contractor',
  "i'm a contractor", "i'm a subcontractor", "i'm a general contractor",
  'we are a contractor', 'we are a subcontractor',
  "we're a contractor", "we're a subcontractor",
  'as a contractor', 'as a subcontractor',
  'general contractor has not paid', 'contractor has not paid',
  'have not been paid for', 'has not paid me for', 'has not paid us for',
  'finished construction', 'finished the renovation', 'finished the work on',
  // Layperson
  'we did the work', 'did the renovation', 'we built', 'we framed',
  'we wired', 'we installed', 'we drywalled', 'we plumbed',
  'they stiffed us on the construction', 'they stiffed me on the construction',
  'contractor stiffed', 'gc stiffed', 'the gc stiffed',
  'stiffed on the construction', 'stiffed on the renovation',
  'stiffed on the build', 'stiffed on the work', 'stiffed on the project',
  'finished the job and they won\'t pay', 'job is done but no payment',
  'owner is stiffing us', 'owner ran off',
];

const PRECONSTRUCTION_CONDO_SIGNALS = [
  'pre-construction', 'preconstruction', 'pre construction', 'tarion',
  'delayed closing', 'extended closing', 'occupancy delay',
  'preconstruction condo', 'condo deposit', 'assignment fee', 'assigning my unit',
  'developer', 'builder', 'condo developer', 'new build', 'new construction',
];

const MORTGAGE_DISPUTE_SIGNALS = [
  'power of sale', 'foreclosure', 'mortgage default', 'defaulted on my mortgage',
  'mortgage arrears', 'lender is suing', 'lender threatening',
  'private mortgage dispute', 'second mortgage dispute',
  // Layperson
  "bank's threatening to take", 'bank is threatening to take',
  'going to lose the house', 'going to lose our home', 'going to lose my home',
  'we are behind on payments', "we're behind on payments",
  'behind on the mortgage', 'fell behind on mortgage',
  'lender taking the house', 'they are taking the house',
];

const CORPORATE_MONEY_FRAUD_SIGNALS = [
  'embezzlement', 'embezzled', 'embezzling', 'embezzle',
  'someone is stealing from the company', 'someone is stealing from our company',
  'employee is stealing', 'suspicious transactions', 'unauthorized transactions',
  'unauthorized transfers', 'unauthorized payments', 'financial fraud', 'fraud in the company',
  'forensic accountant', 'fraudulent invoices', 'fake invoices',
  'money is being stolen', 'funds are being misused',
  'as an accountant', 'as the accountant', 'as a bookkeeper',
  'i work for the company and', 'i noticed money', 'noticed suspicious',
  'wrong with our company finances', 'something wrong with the company finances',
  'money is missing from', 'funds are missing from',
  // Layperson
  'money is going missing', 'where the money went', "books don't add up",
  'numbers don\'t add up', 'i think they are stealing', 'i think they\'re stealing',
  'i think someone is stealing', 'fishy transactions', 'shady transactions',
  'worried about fraud', 'cash is disappearing', 'money is disappearing',
  'someone is dipping into the till',
];

// ─── Out-of-scope practice areas (detected, not yet supported) ────────────

const FAMILY_LAW_SIGNALS = [
  'divorce', 'separated from my spouse', 'separated from my husband',
  'separated from my wife', 'separated from my partner',
  'separating from my spouse', 'separating from my husband',
  'separating from my wife', 'separating from my partner',
  'getting divorced', 'going through a divorce', 'going through a separation',
  'marital separation', 'family separation',
  'custody', 'child custody', 'access to my kids', 'access to my children',
  'parenting plan', 'co-parenting', 'co parenting', 'shared parenting',
  'child support', 'spousal support', 'alimony', 'family law',
  'matrimonial home', 'matrimonial property', 'family court', 'family lawyer',
  'splitting property with my spouse', 'spousal separation agreement',
  'common-law partner', 'common law partner', 'restraining order', 'family violence',
  'child welfare', "children's aid", 'adoption application',
];

const IMMIGRATION_SIGNALS = [
  'immigration', 'visa', 'work permit', 'study permit',
  'permanent residence', 'pr application', 'permanent resident',
  'citizenship', 'naturalization', 'refugee claim', 'refugee status',
  'sponsorship', 'spousal sponsorship', 'parent sponsorship',
  'lmia', 'express entry', 'irb', 'cbsa', 'ircc',
  'inadmissibility', 'deportation', 'removal order',
  'pgwp', 'post-graduate work permit', 'temporary resident',
  'h&c', 'humanitarian and compassionate', 'judicial review immigration',
];

const EMPLOYMENT_SIGNALS = [
  'wrongful dismissal', 'wrongfully dismissed', 'fired without cause',
  'fired from my job', 'just got fired', 'i got fired',
  'severance package', 'severance pay', 'severance offer', 'about severance',
  'know about severance', 'asking about severance',
  'employment standards', 'esa claim', 'human rights at work',
  'workplace harassment', 'workplace discrimination',
  'constructive dismissal', 'wsib claim', 'wsib injury',
  'unpaid wages', 'overtime not paid', 'overtime pay',
  'fired for no reason', 'let go from my job', 'laid off',
  'lost my job', 'i lost my job', 'just lost my job',
];

const CRIMINAL_SIGNALS = [
  'criminal charge', 'criminal charges', 'criminal defence',
  'i was arrested', 'i was just arrested', 'just got arrested',
  'they arrested me', 'arrested last night', 'got arrested',
  'just got charged', 'charged with', 'court date for',
  'criminal record', 'pardon', 'record suspension',
  'bail hearing', 'released on bail',
  'duty counsel', 'crown attorney',
  'impaired driving', 'dui', 'driving under the influence', 'over .08',
  'assault charge', 'assault charges', 'theft charge', 'fraud charges',
  'criminal court', 'provincial offences',
];

const PERSONAL_INJURY_SIGNALS = [
  'car accident', 'motor vehicle accident', 'mva claim',
  'i was in an accident', 'i was hit by a car', 'we were rear-ended',
  'slip and fall', 'fell at the store', 'fell on the sidewalk',
  'injured at work', 'injury at work', 'personal injury',
  'long-term disability', 'long term disability', 'ltd claim',
  'denied disability', 'insurance denied my claim',
  'concussion from', 'whiplash from',
];

const ESTATES_SIGNALS = [
  'will and estate', 'wills and estates', 'estate planning',
  'probate', 'apply for probate', 'estate trustee', 'executor of an estate',
  'contested will', 'challenge a will', 'contesting a will', 'fight over the will',
  'fight over the estate', 'inheritance dispute', 'capacity assessment',
  'power of attorney for property', 'power of attorney for personal care',
  'poa for property', 'poa for personal care',
  // Bare "power of attorney" + "continuing power of attorney" (2026-06-11):
  // the area gate previously only matched the "for property / for personal
  // care" long forms, so "I need a power of attorney for my mother" missed
  // estates entirely and fell to unknown, even though the sub-type
  // classifier (ESTATES_POA_SIGNALS) was ready. DRG sells POAs; this closes
  // the gate gap.
  'power of attorney', 'continuing power of attorney',
  'guardianship of person', 'guardianship of property',
  'estate of my', 'when my mother passed', 'when my father passed',
  'when my parent passed', 'after my father died', 'after my mother died',
  'beneficiary of an estate', 'beneficiary dispute',
  // Layperson
  'make a will', 'need a will', 'write a will', 'update my will',
  'i need a will', 'i want a will', 'i want to make a will',
  'who gets what when i', 'leaving things to my', 'leave things to my kids',
];

interface OutOfScopeMatch {
  area: 'family' | 'immigration' | 'criminal' | 'personal_injury';
  signal: string;
}

interface InScopeAreaMatch {
  area: 'employment' | 'estates';
  signal: string;
}

function detectOutOfScope(input: string): OutOfScopeMatch | null {
  const t = lower(input);
  const hit = (patterns: string[]): string | null => {
    for (const p of patterns) {
      if (t.includes(lower(p))) return p;
    }
    return null;
  };
  let m: string | null;
  if ((m = hit(FAMILY_LAW_SIGNALS))) return { area: 'family', signal: m };
  if ((m = hit(IMMIGRATION_SIGNALS))) return { area: 'immigration', signal: m };
  if ((m = hit(CRIMINAL_SIGNALS))) return { area: 'criminal', signal: m };
  if ((m = hit(PERSONAL_INJURY_SIGNALS))) return { area: 'personal_injury', signal: m };
  return null;
}

/**
 * Detect inquiries in employment or estates areas. These areas are IN SCOPE
 * for firms whose LSO practice-area registration includes them (e.g. DRG Law
 * has all four: corporate, real_estate, employment, estates). The engine
 * routes these to the corresponding `*_general` matter type with a real
 * matter pack and proper banding instead of the thin Band D OOS template.
 *
 * Added 2026-05-21 in response to Call 10 feedback ("the brief must be as
 * rich and complete as all of them"). Phase A ships the catch-all general
 * lane; Phase B adds sub-type packs (wrongful_dismissal, will_drafting,
 * probate, etc.).
 */
function detectInScopeArea(input: string): InScopeAreaMatch | null {
  const t = lower(input);
  const hit = (patterns: string[]): string | null => {
    for (const p of patterns) {
      if (t.includes(lower(p))) return p;
    }
    return null;
  };
  let m: string | null;
  if ((m = hit(ESTATES_SIGNALS))) return { area: 'estates', signal: m };
  if ((m = hit(EMPLOYMENT_SIGNALS))) return { area: 'employment', signal: m };
  return null;
}

// ─── Phase B: employment + estates sub-type classification ──────────────
//
// Once detectInScopeArea identifies the area, these classifiers narrow to
// a specific matter_type. Order matters — more specific signals are
// checked before less specific ones. Falls back to the *_general routing
// lane when no sub-shape is confident.

const EMPLOYMENT_TERMINATION_SIGNALS = [
  'wrongful dismissal', 'wrongfully dismissed', 'fired without cause',
  'fired from my job', 'just got fired', 'i got fired', 'i was fired',
  'constructive dismissal', 'fired for no reason', 'let go from my job',
  'laid off', 'lost my job', 'i lost my job', 'just lost my job',
  'terminated', 'termination letter', 'just terminated',
];

const EMPLOYMENT_SEVERANCE_SIGNALS = [
  'severance package', 'severance pay', 'severance offer', 'about severance',
  'know about severance', 'asking about severance', 'severance review',
  'review my severance', 'severance amount',
];

const EMPLOYMENT_HARASSMENT_SIGNALS = [
  'workplace harassment', 'workplace discrimination', 'discriminat',
  'harassment at work', 'sexual harassment', 'human rights at work',
  'human rights complaint', 'hostile work environment', 'bullying at work',
  'racial discrimination', 'gender discrimination', 'age discrimination',
];

const EMPLOYMENT_WAGES_SIGNALS = [
  'unpaid wages', 'overtime not paid', 'overtime pay', 'wages owed',
  'esa claim', 'employment standards', 'minimum wage', 'vacation pay owed',
  'not paying me', 'they owe me', 'paycheck bounced', 'final pay',
];

const EMPLOYMENT_CONTRACT_SIGNALS = [
  'employment contract', 'employment agreement', 'job offer', 'offer letter',
  'review my contract', 'review the contract', 'sign this contract',
  'non-compete', 'non compete', 'restrictive covenant', 'nda at work',
  'confidentiality agreement at work',
];

function classifyEmploymentSubType(input: string): MatterType {
  const t = lower(input);
  const hit = (patterns: string[]): boolean => patterns.some((p) => t.includes(lower(p)));
  // Order: most-specific actionable signals first.
  if (hit(EMPLOYMENT_TERMINATION_SIGNALS)) return 'wrongful_dismissal';
  if (hit(EMPLOYMENT_SEVERANCE_SIGNALS)) return 'severance_review';
  if (hit(EMPLOYMENT_HARASSMENT_SIGNALS)) return 'harassment_complaint';
  if (hit(EMPLOYMENT_WAGES_SIGNALS)) return 'wage_recovery';
  if (hit(EMPLOYMENT_CONTRACT_SIGNALS)) return 'employment_contract_review';
  return 'employment_general';
}

const ESTATES_WILL_DRAFTING_SIGNALS = [
  'make a will', 'need a will', 'write a will', 'update my will',
  'i need a will', 'i want a will', 'i want to make a will', 'new will',
  'updating my will', 'revising my will', 'will and estate planning',
  'who gets what when i', 'leaving things to my', 'leave things to my kids',
];

const ESTATES_POA_SIGNALS = [
  'power of attorney for property', 'power of attorney for personal care',
  'poa for property', 'poa for personal care',
  'power of attorney', 'continuing power of attorney',
  'guardianship of person', 'guardianship of property',
];

const ESTATES_PROBATE_SIGNALS = [
  'probate', 'apply for probate', 'applying for probate',
  'estate trustee', 'executor of an estate', 'executor of the estate',
  'estate administration', 'certificate of appointment',
  'when my mother passed', 'when my father passed', 'when my parent passed',
  'after my father died', 'after my mother died', 'after my husband died',
  'after my wife died', 'estate of my',
];

const ESTATES_DISPUTE_SIGNALS = [
  'contested will', 'challenge a will', 'contesting a will',
  'fight over the will', 'fight over the estate', 'inheritance dispute',
  'beneficiary dispute', 'beneficiary of an estate',
  'capacity assessment', 'undue influence', 'will challenge',
  'dependant support', 'dependent support', 'pass accounts',
];

function classifyEstatesSubType(input: string): MatterType {
  const t = lower(input);
  const hit = (patterns: string[]): boolean => patterns.some((p) => t.includes(lower(p)));
  // Order: disputes before probate (because "challenge a will" includes
  // "will" and might also match drafting; explicit dispute wins).
  if (hit(ESTATES_DISPUTE_SIGNALS)) return 'estate_dispute';
  if (hit(ESTATES_PROBATE_SIGNALS)) return 'probate';
  if (hit(ESTATES_POA_SIGNALS)) return 'power_of_attorney';
  if (hit(ESTATES_WILL_DRAFTING_SIGNALS)) return 'will_drafting';
  return 'estates_general';
}

// ─── Raw signal extraction ─────────────────────────────────────────────────

export function extractRawSignals(input: string): RawSignals {
  const t = lower(input);
  return {
    mentions_urgency: matchesAny(t, [
      'urgent', 'asap', 'this week', 'right away', 'immediately', 'today', 'right now',
    ]),
    mentions_money: matchesAny(t, [
      'money', 'funds', 'account', 'bank', 'payment', 'paid', 'invoice',
      'financial', 'revenue', 'profit', 'asset',
    ]),
    mentions_access: matchesAny(t, [
      'access', 'locked', 'records', 'password', 'bank account', 'excluded',
      'locked out', 'restricted', 'removed',
    ]),
    mentions_ownership: matchesAny(t, [
      'owner', 'own', 'share', 'shareholder', 'percent', '%', 'stake',
      'equity', 'partner',
    ]),
    mentions_documents: matchesAny(t, [
      'document', 'contract', 'agreement', 'email', 'message', 'signed',
      'invoice', 'certificate', 'paper',
    ]),
    mentions_payment: matchesAny(t, [
      'paid', 'payment', 'pay', 'invoice', 'bill', 'owe', 'outstanding',
    ]),
    mentions_agreement: matchesAny(t, [
      'agreed', 'agreement', 'contract', 'deal', 'terms', 'arrangement',
    ]),
    mentions_vendor: matchesAny(t, [
      'vendor', 'supplier', 'saas', 'subscription', 'overcharged', 'overbilled',
    ]),
    mentions_fraud: matchesAny(t, [
      'fraud', 'embezzle', 'steal', 'stolen', 'fraudulent', 'misuse', 'suspicious transaction',
    ]),
    mentions_property: matchesAny(t, [
      'property', 'house', 'home', 'condo', 'condominium', 'townhouse', 'real estate',
      'land', 'lot', 'building', 'plaza', 'warehouse', 'office space', 'retail',
      'commercial property', 'apartment',
    ]),
    mentions_closing: matchesAny(t, [
      'closing', 'close on', 'close the deal', 'aps', 'agreement of purchase and sale',
      'purchase agreement', 'closing date', 'closing day', 'land transfer tax',
      'title insurance', 'closing documents',
    ]),
    mentions_lease: matchesAny(t, [
      'lease', 'tenant', 'landlord', 'rent', 'rental', 'eviction', 'evict',
      'ltb', 'landlord and tenant board',
    ]),
    mentions_construction: matchesAny(t, [
      'construction', 'contractor', 'subcontractor', 'lien', 'holdback',
      'general contractor', 'renovation', 'build', 'construction act',
    ]),
    mentions_mortgage: matchesAny(t, [
      'mortgage', 'remortgage', 'refinance', 'power of sale', 'foreclosure',
      'lender', 'mortgage default', 'mortgage arrears',
    ]),
    mentions_preconstruction: matchesAny(t, [
      'pre-construction', 'preconstruction', 'pre construction', 'tarion',
      'delayed closing', 'occupancy delay', 'condo deposit', 'assignment fee',
      'developer', 'builder', 'new build',
    ]),
    input_length: input.trim().split(/\s+/).length,
  };
}

// ─── Intent routing ────────────────────────────────────────────────────────

function detectIntent(input: string): IntentFamily {
  // Real estate dispute signals win even if base RE is also present
  if (matchesAny(input, RE_DISPUTE_SIGNALS)) return 'real_estate_dispute';

  // Strong corporate dispute override (locked out, money missing) wins over RE setup-ish words
  if (matchesAny(input, DISPUTE_OVERRIDE_SIGNALS)) return 'business_dispute';

  // Real estate transaction: buying, selling, leasing
  if (matchesAny(input, RE_TRANSACTION_SIGNALS)) return 'real_estate_transaction';

  // Corporate setup advisory
  if (matchesAny(input, SETUP_ADVISORY_SIGNALS)) return 'setup_advisory';

  // Corporate dispute
  if (matchesAny(input, BUSINESS_DISPUTE_SIGNALS)) return 'business_dispute';

  // General counsel advisory (DR-072). Checked AFTER setup + dispute so a
  // real incorporation or dispute wins; checked BEFORE the weak
  // real-estate-base fallback and the catch-alls so an explicit "on-call
  // lawyer" / "review this contract" / "records upkeep" ask routes here.
  if (
    matchesAny(input, FRACTIONAL_COUNSEL_SIGNALS) ||
    matchesAny(input, STANDALONE_CONTRACT_REVIEW_SIGNALS) ||
    matchesAny(input, RECORDS_UPKEEP_SIGNALS)
  ) {
    return 'general_counsel';
  }

  // Plain real estate context (mentions property/lease/construction without specific transaction or dispute language)
  if (matchesAny(input, REAL_ESTATE_BASE_SIGNALS)) {
    // If construction/lien language present, route as dispute lane
    if (matchesAny(input, CONSTRUCTION_LIEN_SIGNALS)) return 'real_estate_dispute';
    if (matchesAny(input, MORTGAGE_DISPUTE_SIGNALS)) return 'real_estate_dispute';
    if (matchesAny(input, LANDLORD_TENANT_SIGNALS)) return 'real_estate_dispute';
    return 'real_estate_transaction';
  }

  return 'unknown';
}

// ─── Dispute family derivation ─────────────────────────────────────────────

export function matterTypeToDisputeFamily(mt: MatterType): DisputeFamily {
  const map: Partial<Record<MatterType, DisputeFamily>> = {
    shareholder_dispute: 'ownership_control',
    unpaid_invoice: 'payment_collection',
    contract_dispute: 'agreement_performance',
    vendor_supplier_dispute: 'vendor_supplier',
    corporate_money_control: 'financial_irregularity',
    corporate_general: 'general_business',
    commercial_real_estate: 'real_estate_transaction',
    residential_purchase_sale: 'real_estate_transaction',
    real_estate_litigation: 'real_estate_dispute',
    landlord_tenant: 'tenancy',
    construction_lien: 'construction_payment',
    preconstruction_condo: 'real_estate_dispute',
    mortgage_dispute: 'real_estate_dispute',
    real_estate_general: 'general_real_estate',
  };
  return map[mt] ?? 'unknown';
}

// ─── LLM-driven classification ─────────────────────────────────────────────
//
// The regex `classify()` above is the fast path — clear hits in the lead's
// input set the matter type without an LLM call. When regex falls through
// to 'unknown', the LLM gets a chance to classify (see schema.ts and
// mergeLlmResults). When the LLM returns a matter type, this helper takes
// it and produces the full classification bundle (intent_family,
// practice_area, matter_type, dispute_family, advisory_subtrack) so
// state.matter_type isn't a lone field with stale dependent values.
//
// This keeps regex as the deterministic fast path AND lets the LLM cover
// every synonym, typo, layperson phrasing, or emerging vocabulary the
// regex doesn't know about. No more whack-a-mole keyword patches.

const CORPORATE_DISPUTE_MATTERS = new Set<MatterType>([
  'shareholder_dispute',
  'unpaid_invoice',
  'contract_dispute',
  'vendor_supplier_dispute',
  'corporate_money_control',
  'corporate_general',
]);

const REAL_ESTATE_TRANSACTION_MATTERS = new Set<MatterType>([
  'commercial_real_estate',
  'residential_purchase_sale',
]);

const REAL_ESTATE_DISPUTE_MATTERS = new Set<MatterType>([
  'real_estate_litigation',
  'landlord_tenant',
  'construction_lien',
  'preconstruction_condo',
  'mortgage_dispute',
  'real_estate_general',
]);

export function classificationForMatterType(mt: MatterType): {
  intent_family: IntentFamily;
  practice_area: PracticeArea;
  matter_type: MatterType;
  dispute_family: DisputeFamily;
  advisory_subtrack: AdvisorySubtrack;
} {
  if (mt === 'business_setup_advisory') {
    return {
      intent_family: 'setup_advisory',
      practice_area: 'corporate',
      matter_type: mt,
      dispute_family: 'unknown',
      advisory_subtrack: 'unknown',
    };
  }
  if (mt === 'general_counsel_advisory') {
    return {
      intent_family: 'general_counsel',
      practice_area: 'corporate',
      matter_type: mt,
      dispute_family: 'unknown',
      advisory_subtrack: 'unknown',
    };
  }
  if (mt === 'notary_services') {
    return {
      intent_family: 'general_counsel',
      practice_area: 'corporate',
      matter_type: mt,
      dispute_family: 'unknown',
      advisory_subtrack: 'unknown',
    };
  }
  if (CORPORATE_DISPUTE_MATTERS.has(mt)) {
    return {
      intent_family: 'business_dispute',
      practice_area: 'corporate',
      matter_type: mt,
      dispute_family: matterTypeToDisputeFamily(mt),
      advisory_subtrack: 'unknown',
    };
  }
  if (REAL_ESTATE_TRANSACTION_MATTERS.has(mt)) {
    return {
      intent_family: 'real_estate_transaction',
      practice_area: 'real_estate',
      matter_type: mt,
      dispute_family: matterTypeToDisputeFamily(mt),
      advisory_subtrack: 'unknown',
    };
  }
  if (REAL_ESTATE_DISPUTE_MATTERS.has(mt)) {
    return {
      intent_family: 'real_estate_dispute',
      practice_area: 'real_estate',
      matter_type: mt,
      dispute_family: matterTypeToDisputeFamily(mt),
      advisory_subtrack: 'unknown',
    };
  }
  if (mt === 'employment_general' || mt === 'wrongful_dismissal' || mt === 'severance_review'
      || mt === 'harassment_complaint' || mt === 'wage_recovery' || mt === 'employment_contract_review') {
    return {
      intent_family: 'employment',
      practice_area: 'employment',
      matter_type: mt,
      dispute_family: 'general_employment',
      advisory_subtrack: 'unknown',
    };
  }
  if (mt === 'estates_general' || mt === 'will_drafting' || mt === 'power_of_attorney'
      || mt === 'probate' || mt === 'estate_dispute') {
    return {
      intent_family: 'estates',
      practice_area: 'estates',
      matter_type: mt,
      dispute_family: 'general_estates',
      advisory_subtrack: 'unknown',
    };
  }
  if (mt === 'out_of_scope') {
    // OOS keeps practice_area to whatever the LLM sees in the
    // description; we mark practice_area 'unknown' here and the OOS
    // handler in the engine surfaces routing copy from the lead's text.
    return {
      intent_family: 'unknown',
      practice_area: 'unknown',
      matter_type: 'out_of_scope',
      dispute_family: 'unknown',
      advisory_subtrack: 'unknown',
    };
  }
  // 'unknown' or anything we don't recognise.
  return {
    intent_family: 'unknown',
    practice_area: 'unknown',
    matter_type: 'unknown',
    dispute_family: 'unknown',
    advisory_subtrack: 'unknown',
  };
}

const ALL_CANONICAL_MATTER_TYPES: ReadonlyArray<MatterType> = [
  'business_setup_advisory',
  'shareholder_dispute',
  'unpaid_invoice',
  'contract_dispute',
  'vendor_supplier_dispute',
  'corporate_money_control',
  'corporate_general',
  'general_counsel_advisory',
  'notary_services',
  'commercial_real_estate',
  'residential_purchase_sale',
  'real_estate_litigation',
  'landlord_tenant',
  'construction_lien',
  'preconstruction_condo',
  'mortgage_dispute',
  'real_estate_general',
  'wrongful_dismissal',
  'severance_review',
  'harassment_complaint',
  'wage_recovery',
  'employment_contract_review',
  'employment_general',
  'will_drafting',
  'power_of_attorney',
  'probate',
  'estate_dispute',
  'estates_general',
  'out_of_scope',
];

export function isValidMatterType(value: string): value is MatterType {
  return (ALL_CANONICAL_MATTER_TYPES as ReadonlyArray<string>).includes(value);
}

export { ALL_CANONICAL_MATTER_TYPES };

// ─── Composite matter classification ──────────────────────────────────────

// ─── Real estate matter classification ────────────────────────────────────

function classifyRealEstateMatter(input: string, intent: IntentFamily): MatterType {
  // Specific dispute lanes have priority — they're $100-bill cases per the brand
  if (matchesAny(input, CONSTRUCTION_LIEN_SIGNALS)) return 'construction_lien';
  if (matchesAny(input, PRECONSTRUCTION_CONDO_SIGNALS)) return 'preconstruction_condo';
  if (matchesAny(input, MORTGAGE_DISPUTE_SIGNALS)) return 'mortgage_dispute';
  if (matchesAny(input, LANDLORD_TENANT_SIGNALS)) return 'landlord_tenant';
  if (matchesAny(input, RE_LITIGATION_SIGNALS)) return 'real_estate_litigation';

  // Transactions: split commercial vs residential
  if (intent === 'real_estate_transaction') {
    if (matchesAny(input, COMMERCIAL_RE_SIGNALS)) return 'commercial_real_estate';
    if (matchesAny(input, RESIDENTIAL_RE_SIGNALS)) return 'residential_purchase_sale';
    // Generic transaction without commercial/residential signal — ask via routing slot
    return 'real_estate_general';
  }

  // Dispute intent without a specific dispute family matched
  return 'real_estate_general';
}

function classifyDisputeMatter(input: string): MatterType {
  const hasRelation = matchesAny(input, SHAREHOLDER_BUSINESS_RELATION);
  const hasControl = matchesAny(input, SHAREHOLDER_CONTROL_MONEY);

  if (hasRelation && hasControl) return 'shareholder_dispute';

  // Corporate money/control: financial fraud signals without ownership-dispute context
  if (matchesAny(input, CORPORATE_MONEY_FRAUD_SIGNALS)) return 'corporate_money_control';

  // Vendor/supplier billing dispute (before generic payment check)
  const hasVendorDispute = matchesAny(input, VENDOR_SUPPLIER_SIGNALS);
  const hasVendorContext = matchesAny(input, VENDOR_BUSINESS_CONTEXT);
  const hasPayment = matchesAny(input, UNPAID_PAYMENT_SIGNALS);
  const hasBusinessCtx = matchesAny(input, UNPAID_BUSINESS_CONTEXT);

  const hasBillingContext = hasPayment || matchesAny(input, ['charged', 'charges', 'charge']);
  if (hasVendorDispute || (hasVendorContext && hasBillingContext)) return 'vendor_supplier_dispute';

  if (hasPayment && hasBusinessCtx) return 'unpaid_invoice';
  if (hasPayment) return 'unpaid_invoice';

  const hasAgreement = matchesAny(input, CONTRACT_AGREEMENT_SIGNALS);
  const hasBreach = matchesAny(input, CONTRACT_BREACH_SIGNALS);
  if (hasAgreement && hasBreach) return 'contract_dispute';

  if (hasRelation && matchesAny(input, ['own part', 'being left out', 'left out'])) {
    return 'shareholder_dispute';
  }

  // Corporate general: detected as business dispute but subtype not determinable
  // This is the intermediate lane — not 'unknown'
  return 'corporate_general';
}

// ─── Advisory subtrack ────────────────────────────────────────────────────

function deriveAdvisorySubtrack(
  advisoryPath: string | null | undefined,
  coOwnerCount: string | null | undefined,
  input: string,
  decisionAuthority?: string | null | undefined,
): AdvisorySubtrack {
  const path = advisoryPath ?? '';
  const count = coOwnerCount ?? '';
  const auth = decisionAuthority ?? '';

  if (
    path === 'Buying into an existing business' ||
    matchesAny(input, [
      'buying into', 'buy into', 'joining a company', 'joining an existing',
      'review documents', 'review the documents', 'check the documents',
    ])
  ) return 'buy_in_or_joining';

  if (
    count === 'One partner' ||
    count === 'Multiple partners' ||
    matchesAny(input, ['with a friend', 'with a partner', 'cofounder', 'co-founder',
      'two of us', 'business together', 'company together', 'bring someone in',
      'bring in a partner'])
  ) return 'partner_setup';

  if (
    count === 'Just me' ||
    matchesAny(input, ['just me', 'by myself', 'on my own', 'alone', 'solo',
      'incorporate by myself', 'myself', 'just need guidance', 'basic guidance',
      'freelancing', 'freelancer', 'sole proprietor', 'sole prop', 'self-employed',
      'self employed', 'consultant on my own'])
  ) return 'solo_setup';

  // 2026-06-07: decision_authority is a tertiary signal. When the direct
  // signals (advisory_path, co_owner_count, input keywords) all return
  // unknown, fall back to the universal-readiness decision_authority slot.
  // "Me with a partner or family member" and "Multiple owners or directors"
  // strongly imply a multi-party setup; "Just me" implies solo. This is
  // the fallback that catches cases where the engine never asked the
  // direct co_owner_count slot but did capture decision_authority.
  if (
    auth === 'Me with a partner or family member' ||
    auth === 'Multiple owners or directors'
  ) return 'partner_setup';

  if (auth === 'Just me') return 'solo_setup';

  if (count === 'Not sure yet') return 'unknown';

  return 'unknown';
}

// ─── Voice transcript prep ────────────────────────────────────────────────
//
// Voice transcripts arrive in line-prefixed "bot: ..." / "human: ..."
// format. The classifier should only see what the CALLER said — not
// the bot's narration. Otherwise the bot's opening line ("we help with
// corporate, real estate, wills and estates, and employment matters")
// would trigger the in-scope-area detector on every call regardless of
// what the matter actually is.
//
// This stripper runs at the top of `classify(input)`. Inputs without
// the "bot:" / "human:" convention (web text, Meta DMs) are returned
// unchanged. Voice transcripts have the "bot:" lines removed and the
// "human:" prefix stripped so the classifier reads only caller speech.
//
// Note: `extractRawSignals(input)` and the kickoff name / postal-code
// regexes still see the FULL transcript — those signal scanners benefit
// from seeing both sides of the conversation (the bot may echo back a
// confirmed postal code in canonical form, and the caller's own
// statements are intact in the human lines). Only the classifier
// pipeline below uses the human-only slice.
function stripBotLinesForClassification(input: string): string {
  if (!/^(bot|human):/im.test(input)) return input;
  return input
    .split(/\r?\n/)
    .filter((line) => !/^\s*bot:/i.test(line))
    .map((line) => line.replace(/^\s*human:\s*/i, ''))
    .join('\n');
}

// ─── Main classifier ───────────────────────────────────────────────────────

export function classify(input: string): {
  intent_family: IntentFamily;
  practice_area: PracticeArea;
  matter_type: MatterType;
  dispute_family: DisputeFamily;
  advisory_subtrack: AdvisorySubtrack;
} {
  // For voice transcripts, classify only on what the caller said.
  // See `stripBotLinesForClassification` for rationale.
  input = stripBotLinesForClassification(input);

  // Out-of-scope detection runs first. Real estate / corporate signals do not
  // override a clear family / immigration / criminal / personal-injury match
  // because those areas are not yet covered by our matter-type packs.
  //
  // Employment and estates were previously in this set but moved to the
  // in-scope detector on 2026-05-21 — they have their own *_general matter
  // packs now (Phase A) and full sub-type packs are coming in Phase B.
  const oos = detectOutOfScope(input);
  if (oos) {
    return {
      intent_family: 'unknown',
      practice_area: oos.area,
      matter_type: 'out_of_scope',
      dispute_family: 'unknown',
      advisory_subtrack: 'unknown',
    };
  }

  // In-scope area detection (employment + estates). These route to their own
  // matter packs (Phase A general lane + Phase B sub-type packs) with proper
  // banding instead of the OOS thin template. Per-firm scope filtering (so a
  // firm that doesn't do estates gets the OOS treatment instead) is a Phase C
  // consideration; for now we treat both as in-scope universally because the
  // engine's current consumer (DRG and similar Toronto solo / 2-lawyer firms)
  // routinely handles both.
  const inScopeArea = detectInScopeArea(input);
  if (inScopeArea) {
    if (inScopeArea.area === 'employment') {
      const subType = classifyEmploymentSubType(input);
      return {
        intent_family: 'employment',
        practice_area: 'employment',
        matter_type: subType,
        dispute_family: 'general_employment',
        advisory_subtrack: 'unknown',
      };
    }
    if (inScopeArea.area === 'estates') {
      const subType = classifyEstatesSubType(input);
      return {
        intent_family: 'estates',
        practice_area: 'estates',
        matter_type: subType,
        dispute_family: 'general_estates',
        advisory_subtrack: 'unknown',
      };
    }
  }

  const intent = detectIntent(input);

  if (intent === 'setup_advisory') {
    const subtrack = deriveAdvisorySubtrack(null, null, input);
    return {
      intent_family: 'setup_advisory',
      practice_area: 'corporate',
      matter_type: 'business_setup_advisory',
      dispute_family: 'unknown',
      advisory_subtrack: subtrack,
    };
  }

  if (intent === 'business_dispute') {
    const matterType = classifyDisputeMatter(input);
    return {
      intent_family: 'business_dispute',
      practice_area: 'corporate',
      matter_type: matterType,
      dispute_family: matterTypeToDisputeFamily(matterType),
      advisory_subtrack: 'unknown',
    };
  }

  if (intent === 'general_counsel') {
    return {
      intent_family: 'general_counsel',
      practice_area: 'corporate',
      matter_type: 'general_counsel_advisory',
      dispute_family: 'unknown',
      advisory_subtrack: 'unknown',
    };
  }

  if (intent === 'real_estate_transaction' || intent === 'real_estate_dispute') {
    const matterType = classifyRealEstateMatter(input, intent);
    return {
      intent_family: intent,
      practice_area: 'real_estate',
      matter_type: matterType,
      dispute_family: matterTypeToDisputeFamily(matterType),
      advisory_subtrack: 'unknown',
    };
  }

  // Try composite even without strong intent signal
  const matterType = classifyDisputeMatter(input);
  if (matterType !== 'corporate_general') {
    return {
      intent_family: 'business_dispute',
      practice_area: 'corporate',
      matter_type: matterType,
      dispute_family: matterTypeToDisputeFamily(matterType),
      advisory_subtrack: 'unknown',
    };
  }

  // Notary services (DR-073). Checked LATE: after every legal-matter intent
  // and the composite dispute pass, so a genuine legal matter that merely
  // mentions notarization still routes to the legal matter. A pure
  // "document notarized" / "commissioner of oaths" request lands here.
  // Placed before the CORPORATE_CONTEXT fallback so "notarize my company's
  // resolution" routes to notary (the stamp they asked for), not the
  // corporate routing lane.
  if (matchesAny(input, NOTARY_SIGNALS)) {
    return classificationForMatterType('notary_services');
  }

  // Any corporate/business context → intermediate lane, not unknown.
  // "corporation" / "corporations" are NOT substrings of "corporate"
  // (different vowel at position 8) so they need their own entries.
  const CORPORATE_CONTEXT = [
    'company', 'business', 'corporate', 'corporation', 'corporations',
    'firm', 'enterprise',
  ];
  if (matchesAny(input, CORPORATE_CONTEXT)) {
    return {
      intent_family: 'business_dispute',
      practice_area: 'corporate',
      matter_type: 'corporate_general',
      dispute_family: 'general_business',
      advisory_subtrack: 'unknown',
    };
  }

  // Truly no signal
  return {
    intent_family: 'unknown',
    practice_area: 'unknown',
    matter_type: 'unknown',
    dispute_family: 'unknown',
    advisory_subtrack: 'unknown',
  };
}

// ─── Language detection (DR-039 — unified classification pipeline) ───────
//
// Language detection is the LLM's job. The engine no longer runs a
// statistical pre-call detector. `state.language` defaults to 'en' at
// `initialiseState`; on the first LLM call the schema's
// `__detected_language` field returns the lead's actual ISO 639-1 code
// (one of: en, fr, es, pt, zh, ar) and `mergeLlmResults` writes it back
// into `state.language`. This eliminates the brittle franc-detected vs
// LLM-detected split that previously gated the regex classifier path.
//
// Superseded: DR-029 (LLM-as-classifier when regex falls through) and
// DR-035 (franc + Gemini hybrid detection). See DR-039 for the
// rationale: a single classification pipeline runs for every intake
// regardless of language; the LLM is authoritative for both language
// detection and matter classification; regex augments the LLM (English
// keyword fast-path) but never gates it.

// ─── Contact-name regex extraction ────────────────────────────────────────
//
// Detects names the lead types in the kickoff message body. The patterns
// cover the common English self-introductions:
//   "I'm Adriano"        "I am Adriano"
//   "my name is Adriano" "this is Adriano"
//
// Why this lives in the regex extractor and not the LLM: client_name is on
// the LLM exclusion list (see schema.ts EXCLUDED_FROM_LLM) so the LLM
// never tries to fill it. On Meta channels the WhatsApp/IG/FB profile
// name is pre-seeded into client_name with source:'metadata' (see
// channel-intake-processor.seedSlots). Profile names are often initials
// or display handles ("A D", "ad12") which read off as a greeting. When
// the lead's text body contains an explicit self-introduction, that wins
// over the channel pre-fill — regex-extracted name carries
// source:'explicit', and seedSlots only fills when client_name is empty.
//
// Patterns are intentionally narrow: avoid matching common false
// positives ("I am sad", "I am writing about", "this is urgent"). The
// name token is required to start with a capital letter and contain no
// digits or punctuation other than apostrophe / hyphen (handles "O'Brien",
// "Jean-Claude"). Length cap of 30 chars prevents runaway matches.
//
// Implementation notes:
//   • No trailing `\b`. JavaScript `\b` treats apostrophe as a word
//     boundary, so `\bO'Brien\b` would short-circuit the capture at the
//     apostrophe and return just "O". The trailing match is bounded
//     instead by the character class itself — the next non-name
//     character (space, comma, period, end of input) simply does not
//     match `[a-zA-Z'’\-]` and the regex stops.
//   • The intro phrase is normalised to lowercase before matching against
//     a lowercased copy of the input, so "My name is" / "i'm" / "I am"
//     all trigger. The captured name token, however, is read from the
//     ORIGINAL input via the same start index — keeping the original
//     casing so "Adriano" stays "Adriano". The capital-letter requirement
//     is enforced on the original-case token before returning it.
const NAME_INTRO_PATTERNS: { lead: RegExp; nameOffset: number }[] = [
  { lead: /\bmy name is\s+/, nameOffset: 0 },
  { lead: /\bi(?:'|’)m\s+/, nameOffset: 0 },
  { lead: /\bi am\s+/, nameOffset: 0 },
  { lead: /\bthis is\s+/, nameOffset: 0 },
];

// Name token regex — capital letter followed by 0-29 name chars. No `\b`
// at end (see note above). Matches against the ORIGINAL-case substring
// starting where the intro phrase ended.
const NAME_TOKEN_RE = /^([A-Z][a-zA-Z'’\-]{0,29})/;

// Multi-word name token regex — captures up to 3 capitalised name tokens
// separated by spaces (covers "Adriano Dominguez", "Mary Ann O'Brien",
// "Jean-Claude Van Damme"). Used to upgrade a single-token capture when
// the lead's intro phrase contained a full first+last name. Anchored
// like NAME_TOKEN_RE — no trailing \b for the apostrophe / hyphen
// reason described above. The 1-2 trailing tokens are optional so this
// still matches "Adriano" alone.
const FULL_NAME_TOKEN_RE = /^([A-Z][a-zA-Z'’\-]{0,29}(?:\s+[A-Z][a-zA-Z'’\-]{0,29}){0,2})/;

// Tokens that look like a capitalised proper noun after the intro phrase
// but are NOT names. Anchored to lowercase so the lookups are cheap.
const NAME_BLOCKLIST = new Set<string>([
  'sad', 'sorry', 'tired', 'angry', 'frustrated', 'concerned', 'worried',
  'looking', 'writing', 'reaching', 'asking', 'wondering', 'seeking',
  'urgent', 'here', 'about', 'the', 'a', 'an',
  'mr', 'mrs', 'ms', 'dr', // honorifics alone aren't names
]);

/**
 * Extract a self-stated contact name from the lead's kickoff text.
 * Returns the captured name in its original casing, or null when no
 * pattern matches or the captured token is in the blocklist.
 *
 * Two-pass capture:
 *   1. Multi-word try (FULL_NAME_TOKEN_RE): captures "Adriano Dominguez"
 *      from "My name is Adriano Dominguez."
 *   2. Single-word fallback (NAME_TOKEN_RE): captures "Adriano" alone
 *      when the lead only said the first name initially. The voice-intake
 *      path (single-pass transcript extraction) then runs
 *      `upgradeNameFromBotConfirmation` to promote "Adriano" to
 *      "Adriano Dominguez" when the bot's acknowledgment line shows the
 *      full name (e.g. "Thank you, Adriano Dominguez. I've noted that
 *      down.").
 *
 * Exported for tests; called by `initialiseState` on turn 1.
 */
export function extractContactName(input: string): string | null {
  if (!input) return null;
  const lowered = input.toLowerCase();
  for (const { lead } of NAME_INTRO_PATTERNS) {
    const m = lead.exec(lowered);
    if (!m) continue;
    // Take the substring of the ORIGINAL input starting where the intro
    // phrase ended; the name-token regex enforces the capital-letter rule
    // and the name character class.
    const tail = input.slice(m.index + m[0].length);
    // First: try to capture a multi-word name (first + last, optional
    // middle). If the intro is followed by "Adriano Dominguez" we want
    // both tokens.
    const fullMatch = FULL_NAME_TOKEN_RE.exec(tail);
    if (fullMatch && fullMatch[1]) {
      const candidate = fullMatch[1].trim();
      // Validate ONLY the first token against the blocklist — false
      // positives like "I am sad" produce candidate="Sad" which we drop.
      // Subsequent tokens are pre-filtered by the multi-word regex's
      // capital-first-letter requirement.
      const firstToken = candidate.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (firstToken && NAME_BLOCKLIST.has(firstToken)) continue;
      return candidate;
    }
    // Fallback: single-token capture for "My name is Adriano." (period
    // immediately after, no last name).
    const nameMatch = NAME_TOKEN_RE.exec(tail);
    if (!nameMatch) continue;
    const candidate = nameMatch[1]?.trim();
    if (!candidate) continue;
    if (NAME_BLOCKLIST.has(candidate.toLowerCase())) continue;
    return candidate;
  }
  return null;
}

// ─── Bot-confirmation name upgrade (voice-intake) ─────────────────────────
//
// When a single-token name was captured from the caller's intro ("My name
// is Adriano.") but the bot later said the full name back as part of an
// acknowledgment, the bot's confirmation is reliable ground truth.
// Patterns we look for inside the transcript:
//
//   "Thank you, Adriano Dominguez. I've noted that down."
//   "Thanks, Adriano Dominguez."
//   "Got it, Adriano Dominguez."
//   "Perfect, Adriano Dominguez."
//
// The bot's casing is consistent (always capital-first-letter on names),
// so the same FULL_NAME_TOKEN_RE works on the tail after the lead-in
// phrase.
//
// Why only voice-intake: this is single-pass transcript extraction, so
// the engine sees both the lead's intro AND the bot's confirmation in
// the same string. On web / Meta channels the engine sees only the
// lead's text, so there's no bot confirmation to mine.
const BOT_NAME_CONFIRMATION_PATTERNS: RegExp[] = [
  /\bthank you,?\s+/i,
  /\bthanks,?\s+/i,
  /\bgot it,?\s+/i,
  /\bperfect,?\s+/i,
  /\bnoted,?\s+/i,
  // "I've noted that down, Adriano Dominguez."
  /\bnoted (?:that )?(?:down,?\s+)?/i,
];

/**
 * Upgrade an existing single-token client_name to the bot-confirmed
 * full name (first + last, optionally middle) when the transcript
 * contains an acknowledgment line.
 *
 * Returns the upgraded name string, or null if no upgrade was found
 * or the existing name is already multi-word.
 *
 * Idempotent and safe to call multiple times; only returns a longer
 * version if one exists.
 */
export function upgradeNameFromBotConfirmation(
  transcript: string,
  existingName: string | null | undefined,
): string | null {
  if (!transcript) return null;
  if (existingName && /\s/.test(existingName.trim())) {
    // Already multi-word; nothing to upgrade.
    return null;
  }
  // The existing first-name anchor — only upgrade matches that start
  // with the same first-name token to avoid hijacking the field with a
  // different person's name that may appear elsewhere in the transcript.
  const anchorFirst = (existingName ?? '').trim().split(/\s+/)[0];
  for (const pattern of BOT_NAME_CONFIRMATION_PATTERNS) {
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    while ((match = re.exec(transcript)) !== null) {
      const tail = transcript.slice(match.index + match[0].length);
      const nameMatch = FULL_NAME_TOKEN_RE.exec(tail);
      if (!nameMatch || !nameMatch[1]) continue;
      const candidate = nameMatch[1].trim();
      if (!/\s/.test(candidate)) continue; // single token; no upgrade
      const firstToken = candidate.split(/\s+/)[0];
      // If we have an existing first name, only upgrade if the
      // confirmation matches it (case-insensitive).
      if (anchorFirst && firstToken?.toLowerCase() !== anchorFirst.toLowerCase()) {
        continue;
      }
      // Reject obviously-bogus first-token matches (blocklist).
      if (firstToken && NAME_BLOCKLIST.has(firstToken.toLowerCase())) continue;
      return candidate;
    }
  }
  return null;
}

// ─── Postal code extraction (Canadian) ────────────────────────────────────
//
// Canadian postal codes follow the pattern letter-digit-letter SPACE
// digit-letter-digit (e.g. "M5T 1B3"). Three transcript forms to
// detect:
//
//   1. Canonical: "M5T 1B3" or "M5T1B3" — exact, easy regex.
//   2. Phonetic (bot confirmation): "M as in Mike, 5, T as in Tango,
//      1, B as in Bravo, 3" — bot reads back digit / letter form for
//      audio clarity. The bot's phrasing is consistent ("X as in
//      <word>, <digit>") so we can reconstruct the postal code from
//      the sequence of capitalised letters and digits.
//   3. Words: "M five t one b three" — caller speaks digits as words.
//      Less reliable; skipped for now (caller form is usually echoed
//      back by the bot in canonical or phonetic form within the same
//      transcript).
//
// Returns the canonical "A1A 1A1" form (with space, all uppercase) or
// null when no postal code is detected.
const CANONICAL_POSTAL_RE = /\b([A-Z])(\d)([A-Z])\s?(\d)([A-Z])(\d)\b/i;
const PHONETIC_POSTAL_RE = /([A-Z])\s+as in\s+\w+,\s*(\d),\s*([A-Z])\s+as in\s+\w+,\s*(\d),\s*([A-Z])\s+as in\s+\w+,\s*(\d)/i;

export function extractPostalCode(transcript: string): string | null {
  if (!transcript) return null;
  // 1. Canonical form, anywhere in transcript. Use the FIRST match —
  //    if the bot read it back multiple times (initial confirmation
  //    plus summary), they should all agree.
  const canonical = CANONICAL_POSTAL_RE.exec(transcript);
  if (canonical) {
    const [, a, b, c, d, e, f] = canonical;
    return `${a.toUpperCase()}${b}${c.toUpperCase()} ${d}${e.toUpperCase()}${f}`;
  }
  // 2. Phonetic form ("M as in Mike, 5, T as in Tango, 1, B as in Bravo, 3")
  const phonetic = PHONETIC_POSTAL_RE.exec(transcript);
  if (phonetic) {
    const [, a, b, c, d, e, f] = phonetic;
    return `${a.toUpperCase()}${b}${c.toUpperCase()} ${d}${e.toUpperCase()}${f}`;
  }
  return null;
}

// ─── State initialiser ────────────────────────────────────────────────────

export function initialiseState(input: string): EngineState {
  const raw = extractRawSignals(input);

  // DR-039: single classification pipeline. The regex classifier runs for
  // EVERY intake regardless of language. For non-English text it returns
  // matter_type='unknown' (the keyword patterns are English-only); the
  // LLM then classifies via the synthetic __matter_type field. For
  // English text the regex provides a fast, deterministic fast-path; the
  // LLM extracts slots and confirms language via __detected_language.
  //
  // No language-based bypass. No franc gating. The LLM is authoritative
  // for both language detection and matter classification; regex is a
  // redundant English-only signal that augments but never gates the
  // pipeline.
  const { intent_family, practice_area, matter_type, dispute_family, advisory_subtrack } =
    classify(input);

  // Contact-name regex pass. Runs language-agnostic for simplicity (the
  // patterns are anchored on English phrasings; the false-positive cost on
  // non-English input is zero — no match, no slot filled).
  let seededName = extractContactName(input);

  // Voice-intake bot-confirmation upgrade: if the regex captured a single
  // first name from the caller's intro, look at the bot's acknowledgment
  // lines in the same transcript for "Thank you, Adriano Dominguez" style
  // confirmations. The bot only says the full name back after the caller
  // confirmed it, so it's reliable ground truth. Same call for web text
  // is a no-op (no bot lines in the input).
  if (seededName) {
    const upgraded = upgradeNameFromBotConfirmation(input, seededName);
    if (upgraded) seededName = upgraded;
  }

  // Postal code regex pass. Detects canonical (A1A 1A1, A1A1A1) and bot
  // phonetic ("M as in Mike, 5, T as in Tango, 1, B as in Bravo, 3")
  // forms. Mostly populated on voice intake (the bot reads it back for
  // audio clarity); web / Meta intake captures it via the lead's text
  // when present.
  const seededPostal = extractPostalCode(input);

  const slots: Record<string, string | null> = {};
  const slotMeta: Record<string, EngineState['slot_meta'][string]> = {};
  if (seededName) {
    slots.client_name = seededName;
    slotMeta.client_name = {
      source: 'explicit',
      evidence: /\s/.test(seededName) ? 'self-introduction + bot confirmation in transcript' : 'self-introduction in kickoff text',
      confidence: 0.95,
    };
  }
  if (seededPostal) {
    slots.client_postal_code = seededPostal;
    slotMeta.client_postal_code = {
      source: 'explicit',
      evidence: 'postal code detected in transcript (canonical or bot phonetic confirmation)',
      confidence: 0.9,
    };
  }

  // Default language is English. The LLM's __detected_language field on
  // the first extraction call overwrites this via mergeLlmResults if the
  // lead wrote in another supported language.
  const language: SupportedLanguage = 'en';

  return {
    input,
    practice_area,
    matter_type,
    // DR-069: the initial classification always comes from the regex
    // classifier above, including its 'unknown' and 'out_of_scope'
    // outcomes. Later setters (rerouteFrom*General, the LLM __matter_type
    // promotion) upgrade this to 'user_routing_answer' / 'llm_inferred'.
    matter_type_provenance: 'deterministic',
    intent_family,
    dispute_family,
    advisory_subtrack,
    language,
    slots,
    slot_meta: slotMeta,
    slot_evidence: {},
    raw,
    confidence: 0,
    coreCompleteness: 0,
    answeredQuestionGroups: [],
    questionHistory: [],
    insightShown: false,
    contactCaptureStarted: false,
    lead_id: generateLeadId(),
    submitted_at: new Date().toISOString(),
  };
}

function generateLeadId(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  // Short random suffix, base36 for compactness
  const rand = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0');
  return `L-${yyyy}-${mm}-${dd}-${rand}`;
}

// ─── Subtrack re-derivation after slot answers ────────────────────────────

export function updateAdvisorySubtrack(state: EngineState): AdvisorySubtrack {
  if (state.matter_type !== 'business_setup_advisory') return 'unknown';
  return deriveAdvisorySubtrack(
    state.slots['advisory_path'],
    state.slots['co_owner_count'],
    state.input,
    state.slots['decision_authority'],
  );
}

// ─── Routing reroute provenance gate (DR-069) ─────────────────────────────
//
// "Inference informs; only the lead routes." A matter-type reroute driven
// by a routing-slot value fires ONLY when the lead actually gave that
// value: chip click, typed reply mapped by an adapter, or regex evidence.
// An llm_inferred fill must NOT change the matter type: the selector
// still treats the slot as unanswered (isUserAnswered) and asks the
// routing question, and the lead's answer then routes with full authority.
//
// Field defect that locked this rule: "I need to lease a space for my
// business" fell to real_estate_general; the LLM force-fit the routing
// slot to "Buying or selling commercial property" (the taxonomy had no
// leasing bucket); the processor rerouted on that guess; and because the
// routing slot only applies_to the *_general lane, the routing question
// became unaskable forever. The brief asserted a sale that did not exist.
//
// applyAnswer (control.ts) stamps source 'answered' on the same state
// before invoking these functions, so every legitimate path passes.

const USER_GROUNDED_ROUTING_SOURCES: ReadonlySet<string> = new Set([
  'answered',
  'explicit',
  'inferred', // legacy pre-2026-06-07 bucket, treated as user-grounded
]);

function routingAnswerIsUserGrounded(state: EngineState, slotId: string): boolean {
  const src = state.slot_meta[slotId]?.source;
  return !!src && USER_GROUNDED_ROUTING_SOURCES.has(src);
}

// ─── Corporate general rerouting ──────────────────────────────────────────

export function rerouteFromCorporateGeneral(state: EngineState, problemType: string): EngineState {
  // Stale-answer guard: once the matter has left the catch-all, a late
  // routing answer must not mutate a specific matter's classification.
  if (state.matter_type !== 'corporate_general') return state;
  if (!routingAnswerIsUserGrounded(state, 'corporate_problem_type')) return state;

  const routingMap: Partial<Record<string, { matter: MatterType; intent: IntentFamily }>> = {
    'Someone owes my company money': { matter: 'unpaid_invoice', intent: 'business_dispute' },
    'I have a dispute with a business partner or co-owner': { matter: 'shareholder_dispute', intent: 'business_dispute' },
    'A vendor or supplier has billed us incorrectly': { matter: 'vendor_supplier_dispute', intent: 'business_dispute' },
    'I am concerned about financial irregularities in the company': { matter: 'corporate_money_control', intent: 'business_dispute' },
    'A contract or agreement was not honoured': { matter: 'contract_dispute', intent: 'business_dispute' },
    // Transactional destinations (2026-06-11, DR-070). Every prior option
    // was dispute-shaped, so setup, purchase, and pre-signing review leads
    // were force-fit into disputes the brief then asserted as fact.
    'Starting, buying, or restructuring a business': { matter: 'business_setup_advisory', intent: 'setup_advisory' },
    'A contract I need drafted or reviewed before signing': { matter: 'business_setup_advisory', intent: 'setup_advisory' },
    // General counsel advisory destination (2026-06-11, DR-072). Absorbs
    // the corporate_general leads who mentioned an ongoing-support shape.
    'Ongoing legal support for an existing business': { matter: 'general_counsel_advisory', intent: 'general_counsel' },
  };

  const target = routingMap[problemType];
  if (!target) return state; // "Something else" stays corporate_general

  return {
    ...state,
    matter_type: target.matter,
    matter_type_provenance: 'user_routing_answer',
    intent_family: target.intent,
    dispute_family: matterTypeToDisputeFamily(target.matter),
  };
}

// ─── Real estate general rerouting ────────────────────────────────────────

export function rerouteFromRealEstateGeneral(state: EngineState, problemType: string): EngineState {
  if (state.matter_type !== 'real_estate_general') return state;
  if (!routingAnswerIsUserGrounded(state, 'real_estate_problem_type')) return state;

  const routingMap: Partial<Record<string, { matter: MatterType; intent: IntentFamily }>> = {
    'Buying or selling commercial property': { matter: 'commercial_real_estate', intent: 'real_estate_transaction' },
    // Leasing bucket (2026-06-11, DR-070): the field-defect gap. The
    // commercial_real_estate pack already handles leases (party_role
    // landlord/tenant, "Tenant or lease structure" concern, lease value
    // fee copy); only this routing option was missing.
    'Leasing commercial space (new lease, renewal, or review)': { matter: 'commercial_real_estate', intent: 'real_estate_transaction' },
    'Buying or selling a home or condo': { matter: 'residential_purchase_sale', intent: 'real_estate_transaction' },
    'A real estate deal that has gone wrong (deposit, closing, misrepresentation)': { matter: 'real_estate_litigation', intent: 'real_estate_dispute' },
    'A landlord or tenant dispute': { matter: 'landlord_tenant', intent: 'real_estate_dispute' },
    'Unpaid construction or renovation work': { matter: 'construction_lien', intent: 'real_estate_dispute' },
    'A pre-construction condo or new build issue': { matter: 'preconstruction_condo', intent: 'real_estate_dispute' },
    'A mortgage or power-of-sale issue': { matter: 'mortgage_dispute', intent: 'real_estate_dispute' },
    // 'Adding or removing someone on title (no sale)' has NO map entry on
    // purpose: no existing pack fits a no-sale title transfer, and an
    // honest thin real_estate_general brief beats a purchase-framed one.
  };

  const target = routingMap[problemType];
  if (!target) return state; // "Something else" / unmapped stays real_estate_general

  return {
    ...state,
    matter_type: target.matter,
    matter_type_provenance: 'user_routing_answer',
    intent_family: target.intent,
    dispute_family: matterTypeToDisputeFamily(target.matter),
  };
}

// ─── Employment general rerouting (DR-069 parity) ─────────────────────────
//
// Until 2026-06-11 employment and estates had NO deterministic reroute:
// the LLM __matter_type classifier was the ONLY promotion path, meaning a
// chip click on the routing question never routed, and an AI guess routed
// without confirmation, the exact inversion of the DR-069 invariant.
// These two functions restore parity with the corporate / real estate
// lanes; with them in place, gating the LLM promotion on interactive
// channels costs nothing.

export function rerouteFromEmploymentGeneral(state: EngineState, problemType: string): EngineState {
  if (state.matter_type !== 'employment_general') return state;
  if (!routingAnswerIsUserGrounded(state, 'employment_problem_type')) return state;

  const routingMap: Partial<Record<string, MatterType>> = {
    'I was fired or let go': 'wrongful_dismissal',
    // Constructive dismissal phrasing (DR-070): the lead resigned under
    // changed conditions. Routes to the wrongful_dismissal pack, which
    // carries the Bardal / limitation framing this claim needs.
    'My job changed so much I had to leave, or I felt forced out': 'wrongful_dismissal',
    'I work as a contractor and the company ended or changed my contract': 'wrongful_dismissal',
    'I have a severance offer to review': 'severance_review',
    'I am being harassed or discriminated against': 'harassment_complaint',
    'I am owed wages that have not been paid': 'wage_recovery',
    'I need an employment contract reviewed': 'employment_contract_review',
    // 'I am an employer and need help with an employee matter' has NO map
    // entry: every employment pack is employee-voiced today. The option
    // exists so the brief records the lead's side honestly instead of
    // reading the owner as a dismissed employee.
  };

  const target = routingMap[problemType];
  if (!target) return state; // "Something else" / employer-side stays employment_general

  return {
    ...state,
    ...classificationForMatterType(target),
    matter_type_provenance: 'user_routing_answer',
  };
}

// ─── Estates general rerouting (DR-069 parity) ────────────────────────────

export function rerouteFromEstatesGeneral(state: EngineState, problemType: string): EngineState {
  if (state.matter_type !== 'estates_general') return state;
  if (!routingAnswerIsUserGrounded(state, 'estates_problem_type')) return state;

  const routingMap: Partial<Record<string, MatterType>> = {
    'I need a will drafted or updated': 'will_drafting',
    'I want to set up a trust': 'will_drafting',
    'I need a power of attorney': 'power_of_attorney',
    // Lost capacity with nothing in place (DR-070): legally a guardianship
    // question, not POA drafting. Routes to the power_of_attorney pack so
    // the capacity questions get asked; the poa_urgency option "The person
    // may no longer be able to sign documents" carries the dispositive
    // fact to the lawyer.
    'A family member can no longer manage their affairs and nothing is in place': 'power_of_attorney',
    'Someone has passed and I need help with probate': 'probate',
    'There is a dispute over a will or an estate': 'estate_dispute',
    'Someone is misusing a power of attorney': 'estate_dispute',
  };

  const target = routingMap[problemType];
  if (!target) return state; // "Something else" stays estates_general

  return {
    ...state,
    ...classificationForMatterType(target),
    matter_type_provenance: 'user_routing_answer',
  };
}
