import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapWithConcurrency } from "../_shared/semaphore.ts";
import { createLogger } from "../_shared/log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Configuration from env
const ENRICH_TIMEOUT_MS = parseInt(Deno.env.get('UNIPILE_ENRICH_TIMEOUT_MS') || '', 10) || 15000;
const ENRICH_CONCURRENCY = parseInt(Deno.env.get('UNIPILE_ENRICH_CONCURRENCY') || '', 10) || 5;

interface SearchFilters {
  keywords?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company?: string;
  location?: string;
  // Advanced filters with IDs
  location_ids?: string[];
  company_ids?: string[];
  industry_ids?: string[];
  school_ids?: string[];
  title_ids?: string[];
}

interface SearchRequest {
  workspaceId: string;
  accountId?: string; // kept for backwards compatibility but ignored
  searchType: "people" | "companies";
  api: "classic" | "sales_navigator" | "recruiter";
  filters: SearchFilters;
  cursor?: string;
  limit?: number;
  enrich?: boolean; // Optional: if true, do blocking enrichment (for debug). Default: false
}

interface WorkspacePlan {
  plan_id: string;
  plan_code: string;
  plan_name: string;
  daily_search_page_limit: number;
  daily_enrich_limit: number;
  monthly_search_page_limit: number | null;
  monthly_enrich_limit: number | null;
  status: string;
}

interface QuotaResult {
  allowed: boolean;
  current: number;
  limit: number;
  action: string;
}

interface EnrichedResult {
  provider_id: string | null;
  public_identifier: string | null;
  profile_url: string | null;
  profile_picture_url: string | null;
  connection_degree: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  headline: string | null;
  industry: string | null;
  job_title: string | null;
  company: string | null;
  company_linkedin: string | null;
  seniority_level: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  location: string | null;
  email: string | null;
  personal_email: string | null;
  phone: string | null;
  mobile_number: string | null;
  keywords: string | null;
  about: string | null;
  connections: number | null;
  followers: number | null;
}

// Helper to get workspace plan with limits
async function getWorkspacePlan(serviceClient: any, workspaceId: string): Promise<WorkspacePlan> {
  const { data, error } = await serviceClient.rpc("get_workspace_plan", {
    p_workspace_id: workspaceId
  });
  
  if (error) {
    console.error("[PLAN_LIMIT] Error fetching workspace plan:", error);
    return {
      plan_id: 'default',
      plan_code: 'starter',
      plan_name: 'Starter',
      daily_search_page_limit: 20,
      daily_enrich_limit: 50,
      monthly_search_page_limit: null,
      monthly_enrich_limit: null,
      status: 'active'
    };
  }
  
  if (!data || data.length === 0) {
    return {
      plan_id: 'default',
      plan_code: 'starter',
      plan_name: 'Starter',
      daily_search_page_limit: 20,
      daily_enrich_limit: 50,
      monthly_search_page_limit: null,
      monthly_enrich_limit: null,
      status: 'active'
    };
  }
  
  return data[0];
}

// Helper to consume quota atomically (prevents race conditions)
// FAIL-CLOSED: Returns null on error, caller must handle as blocked
async function consumeQuotaAtomic(
  serviceClient: any,
  workspaceId: string,
  action: string,
  dailyLimit: number,
  accountId: string,
  userId: string | null,
  metadata: Record<string, unknown> = {}
): Promise<QuotaResult | null> {
  const { data, error } = await serviceClient.rpc("consume_workspace_quota", {
    p_workspace_id: workspaceId,
    p_action: action,
    p_daily_limit: dailyLimit,
    p_account_id: accountId,
    p_user_id: userId,
    p_metadata: metadata,
  });
  
  if (error) {
    console.error("[PLAN_LIMIT] FAIL-CLOSED: Error consuming quota:", error);
    // FAIL-CLOSED: Return null to indicate system error
    return null;
  }
  
  return data as QuotaResult;
}

// Helper to log error event (for Unipile failures after quota consumed)
async function logErrorEvent(
  serviceClient: any,
  workspaceId: string,
  userId: string | null,
  accountId: string,
  errorDetails: Record<string, unknown>
): Promise<void> {
  const { error } = await serviceClient
    .from("usage_events")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      action: 'linkedin_search_error',
      account_id: accountId,
      metadata: errorDetails,
    });
  
  if (error) {
    console.error("[PLAN_LIMIT] Error logging error event:", error);
  }
}

// Helper to get the global platform LinkedIn search account with validation
async function getPlatformLinkedInSearchAccount(serviceClient: any): Promise<{
  accountUuid: string;
  accountId: string;
  linkedinFeature: string | null;
}> {
  const { data, error } = await serviceClient.rpc("get_platform_linkedin_search_account");
  
  if (error) {
    console.error("[LI_SEARCH_GLOBAL] Error fetching platform account:", error);
    throw new Error("Platform admin must configure the global LinkedIn search account.");
  }
  
  const rows = data as Array<{ account_uuid: string; account_id: string; linkedin_feature: string | null }>;
  
  if (!rows || rows.length === 0) {
    throw new Error("Platform admin must configure the global LinkedIn search account.");
  }
  
  const account = rows[0];
  
  const { data: accountData, error: accountError } = await serviceClient
    .from("accounts")
    .select("id, account_id, channel, status")
    .eq("id", account.account_uuid)
    .maybeSingle();
  
  if (accountError || !accountData) {
    console.error("[LI_SEARCH_GLOBAL] Global account not found by UUID:", account.account_uuid);
    throw new Error("The configured global LinkedIn account no longer exists. Platform admin must reconfigure.");
  }
  
  if (accountData.channel !== "linkedin") {
    throw new Error("The configured global account is not a LinkedIn account. Platform admin must reconfigure.");
  }
  
  if (accountData.status !== "connected") {
    throw new Error(`The global LinkedIn account is disconnected (status: ${accountData.status}). Please reconnect it in Settings.`);
  }
  
  return {
    accountUuid: account.account_uuid,
    accountId: account.account_id,
    linkedinFeature: account.linkedin_feature,
  };
}

// ===== ENRICHMENT HELPER FUNCTIONS =====

// Enrichment result tracking
interface EnrichmentSummary {
  attempted: number;
  success: number;
  failed: number;
  reasons: Record<string, number>;
}

// Fetch profile details from Unipile with timeout
async function enrichProfile(
  unipileDsn: string,
  unipileApiKey: string,
  accountId: string,
  publicIdentifier: string,
  timeoutMs: number = ENRICH_TIMEOUT_MS
): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    // Normalize public_identifier (handle both camelCase and snake_case)
    const normalizedId = publicIdentifier.trim();
    const url = `https://${unipileDsn}/api/v1/users/${encodeURIComponent(normalizedId)}?account_id=${encodeURIComponent(accountId)}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: { 
        "X-API-KEY": unipileApiKey,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      const reason = response.status === 404 ? 'not_found' : 
                     response.status === 429 ? 'rate_limited' :
                     response.status >= 500 ? 'server_error' : 'api_error';
      return { data: null, error: reason };
    }
    
    const data = await response.json();
    return { data };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return { data: null, error: 'timeout' };
    }
    return { data: null, error: 'network_error' };
  }
}

// Extract job title from experiences or occupation
function extractJobTitle(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  // First try occupation
  if (enrichedData.occupation && typeof enrichedData.occupation === 'string') {
    return enrichedData.occupation;
  }
  
  // Then try experiences array
  const experiences = enrichedData.experiences as Array<Record<string, unknown>> | undefined;
  if (experiences && Array.isArray(experiences) && experiences.length > 0) {
    const current = experiences[0];
    return (current.title as string) || null;
  }
  
  return null;
}

// Extract company name from experiences
function extractCompany(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  const experiences = enrichedData.experiences as Array<Record<string, unknown>> | undefined;
  if (experiences && Array.isArray(experiences) && experiences.length > 0) {
    const current = experiences[0];
    const company = current.company as Record<string, unknown> | string | undefined;
    
    if (typeof company === 'string') {
      return company;
    }
    if (company && typeof company === 'object') {
      return (company.name as string) || null;
    }
  }
  
  return null;
}

// Extract company LinkedIn URL from experiences
function extractCompanyLinkedIn(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  const experiences = enrichedData.experiences as Array<Record<string, unknown>> | undefined;
  if (experiences && Array.isArray(experiences) && experiences.length > 0) {
    const current = experiences[0];
    const company = current.company as Record<string, unknown> | undefined;
    
    if (company && typeof company === 'object') {
      const publicId = company.public_identifier as string | undefined;
      if (publicId) {
        return `https://www.linkedin.com/company/${publicId}`;
      }
      return (company.linkedin_url as string) || (company.url as string) || null;
    }
  }
  
  return null;
}

// Extract location components
function extractCity(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  const location = enrichedData.location as Record<string, unknown> | string | undefined;
  if (typeof location === 'object' && location) {
    return (location.city as string) || null;
  }
  
  // Try to parse from location string
  if (typeof location === 'string') {
    const parts = location.split(',').map(s => s.trim());
    return parts[0] || null;
  }
  
  return null;
}

function extractState(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  const location = enrichedData.location as Record<string, unknown> | string | undefined;
  if (typeof location === 'object' && location) {
    return (location.state as string) || (location.region as string) || null;
  }
  
  if (typeof location === 'string') {
    const parts = location.split(',').map(s => s.trim());
    return parts.length > 1 ? parts[1] : null;
  }
  
  return null;
}

function extractCountry(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  const location = enrichedData.location as Record<string, unknown> | string | undefined;
  if (typeof location === 'object' && location) {
    return (location.country as string) || (location.country_code as string) || null;
  }
  
  if (typeof location === 'string') {
    const parts = location.split(',').map(s => s.trim());
    return parts.length > 2 ? parts[parts.length - 1] : null;
  }
  
  return null;
}

function extractLocationString(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  const location = enrichedData.location as Record<string, unknown> | string | undefined;
  if (typeof location === 'string') {
    return location;
  }
  
  if (typeof location === 'object' && location) {
    const parts = [
      location.city,
      location.state || location.region,
      location.country
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  
  return null;
}

// Extract email from emails array
function extractEmail(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  const emails = enrichedData.emails as Array<Record<string, unknown> | string> | undefined;
  if (emails && Array.isArray(emails) && emails.length > 0) {
    const first = emails[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first.email) return first.email as string;
    if (typeof first === 'object' && first.address) return first.address as string;
  }
  
  // Direct email field
  if (enrichedData.email && typeof enrichedData.email === 'string') {
    return enrichedData.email;
  }
  
  return null;
}

// Extract phone from phone_numbers array
function extractPhone(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  const phones = enrichedData.phone_numbers as Array<Record<string, unknown> | string> | undefined;
  if (phones && Array.isArray(phones) && phones.length > 0) {
    const first = phones[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first.number) return first.number as string;
    if (typeof first === 'object' && first.phone) return first.phone as string;
  }
  
  return null;
}

// Extract skills as comma-separated keywords
function extractSkills(enrichedData: Record<string, unknown> | null): string | null {
  if (!enrichedData) return null;
  
  const skills = enrichedData.skills as Array<Record<string, unknown> | string> | undefined;
  if (skills && Array.isArray(skills) && skills.length > 0) {
    const skillNames = skills.map(s => {
      if (typeof s === 'string') return s;
      if (typeof s === 'object' && s.name) return s.name as string;
      return null;
    }).filter(Boolean);
    
    return skillNames.length > 0 ? skillNames.join(', ') : null;
  }
  
  return null;
}

// Merge search item with enriched data
function mergeEnrichedData(
  searchItem: Record<string, unknown>,
  enrichedData: Record<string, unknown> | null
): EnrichedResult {
  const publicIdentifier = searchItem.public_identifier as string | undefined;
  const profileUrl = publicIdentifier
    ? `https://www.linkedin.com/in/${publicIdentifier}`
    : (searchItem.profile_url as string | null) ?? null;
  
  // Get company from search item as fallback
  const searchCompany = typeof searchItem.current_company === "object"
    ? (searchItem.current_company as Record<string, unknown>)?.name as string | undefined
    : searchItem.current_company as string | undefined;
  
  return {
    // IDs from search
    provider_id: (searchItem.id as string) || null,
    public_identifier: publicIdentifier || null,
    profile_url: profileUrl,
    connection_degree: (searchItem.connection_degree as string) || null,
    
    // Profile picture - prefer enriched
    profile_picture_url: (enrichedData?.profile_picture as string) || 
                         (enrichedData?.picture_url as string) ||
                         (searchItem.profile_picture as string) || null,
    
    // Names - prefer enriched
    first_name: (enrichedData?.first_name as string) || (searchItem.first_name as string) || null,
    last_name: (enrichedData?.last_name as string) || (searchItem.last_name as string) || null,
    full_name: (enrichedData?.name as string) || (searchItem.name as string) || null,
    
    // Professional data
    headline: (enrichedData?.headline as string) || (searchItem.headline as string) || null,
    industry: (enrichedData?.industry as string) || null,
    seniority_level: (enrichedData?.seniority as string) || null,
    
    // Job and company
    job_title: extractJobTitle(enrichedData) || (searchItem.current_title as string) || null,
    company: extractCompany(enrichedData) || searchCompany || null,
    company_linkedin: extractCompanyLinkedIn(enrichedData),
    
    // Location
    city: extractCity(enrichedData),
    state: extractState(enrichedData),
    country: extractCountry(enrichedData),
    location: extractLocationString(enrichedData) || (searchItem.location as string) || null,
    
    // Contact info
    email: extractEmail(enrichedData),
    personal_email: extractEmail(enrichedData), // same source for now
    phone: extractPhone(enrichedData),
    mobile_number: extractPhone(enrichedData), // same source for now
    
    // Skills
    keywords: extractSkills(enrichedData),
    
    // About and social metrics
    about: (enrichedData?.about as string) || (enrichedData?.summary as string) || null,
    connections: typeof enrichedData?.connections === 'number' ? enrichedData.connections : null,
    followers: typeof enrichedData?.followers === 'number' ? enrichedData.followers : null,
  };
}

// ===== END ENRICHMENT HELPERS =====

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: SearchRequest = await req.json();
    const { workspaceId, searchType, api, filters, cursor, limit = 25, enrich = false } = body;

    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: "workspaceId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate workspace membership
    const { data: member, error: memberError } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError || !member) {
      return new Response(
        JSON.stringify({ error: "Not a member of this workspace" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the global platform LinkedIn account
    let platformAccount;
    try {
      platformAccount = await getPlatformLinkedInSearchAccount(serviceClient);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: (e as Error).message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const unipileAccountId = platformAccount.accountId;
    
    // ===== ATOMIC QUOTA CHECK =====
    const workspacePlan = await getWorkspacePlan(serviceClient, workspaceId);
    
    console.log(`[PLAN_LIMIT] workspaceId=${workspaceId} planCode=${workspacePlan.plan_code} action=linkedin_search_page limit=${workspacePlan.daily_search_page_limit}`);
    
    const quotaResult = await consumeQuotaAtomic(
      serviceClient,
      workspaceId,
      'linkedin_search_page',
      workspacePlan.daily_search_page_limit,
      unipileAccountId,
      user.id,
      {
        cursorUsed: !!cursor,
        api: api || 'classic',
        plan_code: workspacePlan.plan_code,
      }
    );
    
    // FAIL-CLOSED: If quota system fails, don't proceed
    if (quotaResult === null) {
      console.error(`[PLAN_LIMIT] FAIL-CLOSED: Quota system unavailable for workspaceId=${workspaceId}`);
      return new Response(
        JSON.stringify({
          error: "Quota system unavailable",
          message: "Unable to verify usage limits. Please try again later.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (!quotaResult.allowed) {
      console.log(`[PLAN_LIMIT] BLOCKED workspaceId=${workspaceId} action=linkedin_search_page current=${quotaResult.current} limit=${quotaResult.limit}`);
      
      return new Response(
        JSON.stringify({
          error: "Daily limit reached",
          action: "linkedin_search_page",
          usage: { current: quotaResult.current, limit: quotaResult.limit },
          plan: { code: workspacePlan.plan_code, name: workspacePlan.plan_name },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[PLAN_LIMIT] ALLOWED workspaceId=${workspaceId} action=linkedin_search_page current=${quotaResult.current} limit=${quotaResult.limit}`);
    // ===== END ATOMIC QUOTA CHECK =====

    // Call Unipile LinkedIn Search API
    const unipileDsn = Deno.env.get("UNIPILE_DSN")!;
    const unipileApiKey = Deno.env.get("UNIPILE_API_KEY")!;

    async function resolveParameterId(parameterType: "location" | "company" | "industry" | "school" | "title", query: string) {
      const unipileTypeMap: Record<typeof parameterType, string> = {
        location: "REGIONS",
        industry: "INDUSTRIES",
        company: "CURRENT_COMPANY",
        school: "SCHOOLS",
        title: "CURRENT_TITLE",
      };

      const url = new URL(`https://${unipileDsn}/api/v1/linkedin/search/parameters`);
      url.searchParams.set("account_id", unipileAccountId);
      url.searchParams.set("type", unipileTypeMap[parameterType]);
      url.searchParams.set("query", query);

      const resp = await fetch(url.toString(), {
        method: "GET",
        headers: { "X-API-KEY": unipileApiKey, Accept: "application/json" },
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`[linkedin-search] Failed to resolve ${parameterType} id:`, errorText);
        return null;
      }

      const data = await resp.json();
      const first = (data.items || [])[0] as { id?: string } | undefined;
      return first?.id ?? null;
    }

    const searchUrl = `https://${unipileDsn}/api/v1/linkedin/search?account_id=${encodeURIComponent(unipileAccountId)}`;

    const searchPayload: Record<string, unknown> = {
      api: api || "classic",
      category: searchType === "companies" ? "companies" : "people",
      limit: Math.min(limit, 25),
    };

    if (filters.keywords) searchPayload.keywords = filters.keywords;

    const advancedKeywords: Record<string, unknown> = {};
    if (filters.first_name) advancedKeywords.first_name = filters.first_name;
    if (filters.last_name) advancedKeywords.last_name = filters.last_name;
    if (filters.title) advancedKeywords.title = filters.title;
    if (filters.company) advancedKeywords.company = filters.company;
    if (Object.keys(advancedKeywords).length) searchPayload.advanced_keywords = advancedKeywords;

    // Location filter - prefer IDs, fallback to text resolution
    if (filters.location_ids && filters.location_ids.length > 0) {
      searchPayload.location = filters.location_ids;
    } else if (filters.location) {
      const trimmed = filters.location.trim();
      if (/^\d+$/.test(trimmed)) {
        searchPayload.location = [trimmed];
      } else {
        const resolvedId = await resolveParameterId("location", trimmed);
        if (resolvedId) {
          searchPayload.location = [resolvedId];
        }
      }
    }

    // Industry filter (IDs only)
    if (filters.industry_ids && filters.industry_ids.length > 0) {
      searchPayload.industry = filters.industry_ids;
    }

    // Company filter - prefer IDs, fallback to text
    if (filters.company_ids && filters.company_ids.length > 0) {
      searchPayload.current_company = filters.company_ids;
    }

    // Title filter - prefer IDs, fallback to text  
    if (filters.title_ids && filters.title_ids.length > 0) {
      searchPayload.current_title = filters.title_ids;
    }

    // School filter (IDs only)
    if (filters.school_ids && filters.school_ids.length > 0) {
      searchPayload.school = filters.school_ids;
    }

    if (cursor) searchPayload.cursor = cursor;

    console.log("[linkedin-search] Calling Unipile search URL:", searchUrl);
    console.log("[linkedin-search] Calling Unipile search payload:", JSON.stringify(searchPayload));

    const searchResponse = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "X-API-KEY": unipileApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(searchPayload),
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error("[linkedin-search] Unipile error:", errorText);
      
      // Log error event (quota already consumed)
      await logErrorEvent(serviceClient, workspaceId, user.id, unipileAccountId, {
        error: true,
        status: searchResponse.status,
        details: errorText.substring(0, 200),
      });
      
      return new Response(
        JSON.stringify({ error: "LinkedIn search failed", details: errorText }),
        { status: searchResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const searchData = await searchResponse.json();
    const searchItems = searchData.items || [];
    console.log("[linkedin-search] Unipile response items:", searchItems.length);

    // ===== ENRICHMENT (CONDITIONAL) =====
    // Default: NO enrichment (fast response). Set enrich=true for debug/legacy behavior.
    
    let results: EnrichedResult[];
    let enrichSummary: EnrichmentSummary | null = null;
    
    if (enrich) {
      // BLOCKING ENRICHMENT (legacy/debug mode)
      const logger = createLogger('linkedin-search');
      logger.info(`Starting BLOCKING enrichment for ${searchItems.length} profiles`, { 
        concurrency: ENRICH_CONCURRENCY, 
        timeoutMs: ENRICH_TIMEOUT_MS 
      });
      
      enrichSummary = {
        attempted: 0,
        success: 0,
        failed: 0,
        reasons: {},
      };
      
      const enrichmentResults = await mapWithConcurrency(
        searchItems,
        ENRICH_CONCURRENCY,
        async (item: Record<string, unknown>) => {
          const publicId = (item.public_identifier || item.publicIdentifier) as string | undefined;
          
          if (!publicId) {
            return { item, enrichedData: null, error: 'no_identifier' };
          }
          
          enrichSummary!.attempted++;
          const result = await enrichProfile(unipileDsn, unipileApiKey, unipileAccountId, publicId, ENRICH_TIMEOUT_MS);
          
          if (result.error) {
            enrichSummary!.failed++;
            enrichSummary!.reasons[result.error] = (enrichSummary!.reasons[result.error] || 0) + 1;
            return { item, enrichedData: null, error: result.error };
          }
          
          enrichSummary!.success++;
          return { item, enrichedData: result.data, error: null };
        }
      );
      
      results = enrichmentResults
        .filter(r => r.status === 'fulfilled')
        .map(r => {
          const fulfilled = r as { status: 'fulfilled'; value: { item: Record<string, unknown>; enrichedData: Record<string, unknown> | null } };
          const { item, enrichedData } = fulfilled.value;
          return mergeEnrichedData(item, enrichedData);
        });
      
      const enrichedWithData = results.filter(r => r.email || r.keywords || r.about).length;
      logger.info(`Enrichment complete`, { 
        summary: enrichSummary,
        resultsWithData: enrichedWithData,
        totalResults: results.length,
      });
    } else {
      // FAST MODE (default): Return raw search results without enrichment
      // UI will enrich progressively via linkedin-enrich-preview
      results = searchItems.map((item: Record<string, unknown>) => mergeEnrichedData(item, null));
      console.log(`[linkedin-search] Fast mode: returning ${results.length} raw results (no enrichment)`);
    }
    // ===== END ENRICHMENT =====

    return new Response(
      JSON.stringify({
        success: true,
        results,
        cursor: searchData.cursor,
        hasMore: !!searchData.cursor,
        usage: {
          current: quotaResult.current,
          limit: quotaResult.limit,
        },
        plan: {
          code: workspacePlan.plan_code,
          name: workspacePlan.plan_name,
        },
        enrich: enrichSummary ? { summary: enrichSummary } : { mode: 'fast' },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[linkedin-search] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
