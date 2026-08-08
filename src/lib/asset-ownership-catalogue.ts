/**
 * Catalogue of marketing assets the ownership register (DR-111) tracks.
 * Adding an asset is a code edit here, not a migration; the register table
 * has no fixed column per asset, one row per (firm, review_phase, asset_key).
 */

export interface AssetCategory {
  key: string;
  label: string;
}

export interface AssetCatalogueEntry {
  key: string;
  category: string;
  label: string;
}

export const ASSET_CATEGORIES: AssetCategory[] = [
  { key: "brand_content", label: "Brand and content" },
  { key: "domain_website", label: "Domain and website" },
  { key: "search_local", label: "Search and local presence" },
  { key: "ads_attribution", label: "Advertising and attribution" },
  { key: "crm_intake", label: "CRM, intake and relationships" },
  { key: "social_comms", label: "Social and communications" },
];

export const ASSET_OWNERSHIP_CATALOGUE: AssetCatalogueEntry[] = [
  // Brand and content
  { key: "logo_source_files", category: "brand_content", label: "Logo source files and brand guidelines" },
  { key: "website_copy_assets", category: "brand_content", label: "Website copy, photography, video and design files" },
  { key: "content_library_rights", category: "brand_content", label: "Published content library and image rights" },

  // Domain and website
  { key: "domain_registrar", category: "domain_website", label: "Domain registrar and renewal contact" },
  { key: "dns_hosting_cms", category: "domain_website", label: "DNS, hosting and CMS administrator" },
  { key: "website_source_repo", category: "domain_website", label: "Website source files, repository, backups and form notifications" },
  { key: "business_email_domain", category: "domain_website", label: "Business email domain and mailbox access" },

  // Search and local presence
  { key: "google_search_console", category: "search_local", label: "Google Search Console" },
  { key: "google_analytics_gtm", category: "search_local", label: "Google Analytics and Tag Manager" },
  { key: "google_business_profile", category: "search_local", label: "Google Business Profile" },
  { key: "bing_places", category: "search_local", label: "Bing Places" },
  { key: "apple_business_connect", category: "search_local", label: "Apple Business Connect" },
  { key: "legal_directories", category: "search_local", label: "Canadian Legal Listings, Yellow Pages and relevant legal directories" },

  // Advertising and attribution
  { key: "google_ads_lsa", category: "ads_attribution", label: "Google Ads and Local Services Ads accounts" },
  { key: "conversion_tracking", category: "ads_attribution", label: "Conversion tracking, pixels and landing pages" },
  { key: "call_tracking", category: "ads_attribution", label: "Call-tracking numbers and call-recording ownership" },
  { key: "ads_billing_profile", category: "ads_attribution", label: "Advertising billing profile" },

  // CRM, intake and relationships
  { key: "crm_account", category: "crm_intake", label: "CRM account ownership and data-export capability" },
  { key: "intake_automations", category: "crm_intake", label: "Intake forms, automations, calendars and contact records" },
  { key: "review_request_process", category: "crm_intake", label: "Review-request process" },
  { key: "email_newsletter_platform", category: "crm_intake", label: "Email and newsletter platform" },
  { key: "referral_contact_lists", category: "crm_intake", label: "Referral and former-client contact lists" },

  // Social and communications
  { key: "linkedin_company_page", category: "social_comms", label: "LinkedIn company page and administrator roles" },
  { key: "other_social_accounts", category: "social_comms", label: "Any active social accounts" },
  { key: "email_marketing_sending_domain", category: "social_comms", label: "Email marketing accounts and sending domains" },
];
