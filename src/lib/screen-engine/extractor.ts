import { francAll } from 'franc';
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
  'open a company', 'opening a company', 'start a business', 'starting a business',
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
  area: 'family' | 'immigration' | 'employment' | 'criminal' | 'personal_injury' | 'estates';
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
  if ((m = hit(ESTATES_SIGNALS))) return { area: 'estates', signal: m };
  if ((m = hit(EMPLOYMENT_SIGNALS))) return { area: 'employment', signal: m };
  return null;
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
  'commercial_real_estate',
  'residential_purchase_sale',
  'real_estate_litigation',
  'landlord_tenant',
  'construction_lien',
  'preconstruction_condo',
  'mortgage_dispute',
  'real_estate_general',
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
): AdvisorySubtrack {
  const path = advisoryPath ?? '';
  const count = coOwnerCount ?? '';

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

  if (count === 'Not sure yet') return 'unknown';

  return 'unknown';
}

// ─── Main classifier ───────────────────────────────────────────────────────

export function classify(input: string): {
  intent_family: IntentFamily;
  practice_area: PracticeArea;
  matter_type: MatterType;
  dispute_family: DisputeFamily;
  advisory_subtrack: AdvisorySubtrack;
} {
  // Out-of-scope detection runs first. Real estate / corporate signals do not
  // override a clear family / immigration / criminal / etc. match because
  // those areas are not yet covered by our matter-type packs.
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

// ─── Language detection (DR-035) ──────────────────────────────────────────

// ISO 639-3 codes for the six supported languages (restricts franc search space)
const SUPPORTED_FRANC_CODES = ['eng', 'fra', 'spa', 'por', 'cmn', 'arb'] as const;

const FRANC_TO_LANG: Record<string, SupportedLanguage> = {
  eng: 'en', fra: 'fr', spa: 'es', por: 'pt', cmn: 'zh', arb: 'ar',
};

// Threshold below which franc's top result is considered uncertain; Gemini
// confirms the language on the same turn-1 call via __detected_language.
const FRANC_CONFIDENCE_THRESHOLD = 0.7;

// Short-text English tie-breaker constants. franc's score is RELATIVE (top
// result always 1.0, rest are scaled ratios), so the confidence threshold
// above never filters anything in practice. On short inputs the trigram
// signal is weak and franc routinely ranks Spanish, Catalan, or Portuguese
// above English on obviously-English text. When the input is short and
// English sits anywhere in the result list with a score close to the
// leader, prefer English.
//
// Calibration: genuine non-English short inputs cap English's relative score
// at roughly 0.72; misranked English inputs keep English's relative score
// at 0.93 or higher. A tie-breaker score of 0.85 sits safely in the gap.
// Char limit 60 covers the longest observed misranked English (54 chars,
// "I want a lawyer to review my preconstruction agreement"); past that
// length franc reliably puts English at rank 1 with no need for a fallback.
//
// Asymmetry rationale: a false positive (real French marked English) costs
// one LLM round-trip via the existing Gemini __detected_language confirmation
// path. A false negative (real English marked Spanish, the current bug)
// skips the regex classifier entirely per DR-029 + DR-035, sending every
// short English lead through the slow LLM-only routing path forever.
const SHORT_TEXT_THRESHOLD_CHARS = 60;
const ENGLISH_TIEBREAKER_SCORE = 0.85;

function detectLanguage(input: string): { language: SupportedLanguage; confirmed: boolean } {
  // francAll returns [[code, score], ...] ordered by descending confidence.
  // The 'only' filter restricts to our six languages for accuracy on short inputs.
  const results = francAll(input, { only: [...SUPPORTED_FRANC_CODES], minLength: 5 });
  if (!results.length) return { language: 'en', confirmed: false };

  const [topCode, topScore] = results[0] as [string, number];

  // Short-text English bias (see constants above for rationale).
  if (input.length < SHORT_TEXT_THRESHOLD_CHARS) {
    const englishCandidate = results.find(([code]) => code === 'eng');
    if (englishCandidate && (englishCandidate[1] as number) >= ENGLISH_TIEBREAKER_SCORE) {
      return { language: 'en', confirmed: true };
    }
  }

  const mapped = FRANC_TO_LANG[topCode];
  if (!mapped) return { language: 'en', confirmed: false };
  return { language: mapped, confirmed: topScore >= FRANC_CONFIDENCE_THRESHOLD };
}

// ─── State initialiser ────────────────────────────────────────────────────

export function initialiseState(input: string): EngineState {
  const raw = extractRawSignals(input);
  const { language, confirmed } = detectLanguage(input);

  // Non-English: skip the regex classifier entirely; LLM handles routing (DR-029 + DR-035).
  // English retains the fast regex path with no regression.
  const { intent_family, practice_area, matter_type, dispute_family, advisory_subtrack } =
    language === 'en'
      ? classify(input)
      : {
          intent_family: 'unknown' as IntentFamily,
          practice_area: 'unknown' as PracticeArea,
          matter_type: 'unknown' as MatterType,
          dispute_family: 'unknown' as DisputeFamily,
          advisory_subtrack: 'unknown' as AdvisorySubtrack,
        };

  return {
    input,
    practice_area,
    matter_type,
    intent_family,
    dispute_family,
    advisory_subtrack,
    language,
    ...(confirmed ? {} : { language_needs_confirm: true }),
    slots: {},
    slot_meta: {},
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
  );
}

// ─── Corporate general rerouting ──────────────────────────────────────────

export function rerouteFromCorporateGeneral(state: EngineState, problemType: string): EngineState {
  const routingMap: Partial<Record<string, MatterType>> = {
    'Someone owes my company money': 'unpaid_invoice',
    'I have a dispute with a business partner or co-owner': 'shareholder_dispute',
    'A vendor or supplier has billed us incorrectly': 'vendor_supplier_dispute',
    'I am concerned about financial irregularities in the company': 'corporate_money_control',
    'A contract or agreement was not honoured': 'contract_dispute',
  };

  const newMatterType = routingMap[problemType];
  if (!newMatterType) return state; // "Something else" — stays corporate_general

  return {
    ...state,
    matter_type: newMatterType,
    intent_family: 'business_dispute',
    dispute_family: matterTypeToDisputeFamily(newMatterType),
  };
}

// ─── Real estate general rerouting ────────────────────────────────────────

export function rerouteFromRealEstateGeneral(state: EngineState, problemType: string): EngineState {
  const routingMap: Partial<Record<string, { matter: MatterType; intent: IntentFamily }>> = {
    'Buying or selling commercial property': { matter: 'commercial_real_estate', intent: 'real_estate_transaction' },
    'Buying or selling a home or condo': { matter: 'residential_purchase_sale', intent: 'real_estate_transaction' },
    'A real estate deal that has gone wrong (deposit, closing, misrepresentation)': { matter: 'real_estate_litigation', intent: 'real_estate_dispute' },
    'A landlord or tenant dispute': { matter: 'landlord_tenant', intent: 'real_estate_dispute' },
    'Unpaid construction or renovation work': { matter: 'construction_lien', intent: 'real_estate_dispute' },
    'A pre-construction condo or new build issue': { matter: 'preconstruction_condo', intent: 'real_estate_dispute' },
    'A mortgage or power-of-sale issue': { matter: 'mortgage_dispute', intent: 'real_estate_dispute' },
  };

  const target = routingMap[problemType];
  if (!target) return state; // "Something else" — stays real_estate_general

  return {
    ...state,
    matter_type: target.matter,
    intent_family: target.intent,
    dispute_family: matterTypeToDisputeFamily(target.matter),
  };
}
