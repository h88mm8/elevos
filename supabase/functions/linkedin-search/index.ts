import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchFilters {
  keywords?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company?: string;
  location?: string;
}

interface SearchRequest {
  workspaceId: string;
  accountId?: string; // kept for backwards compatibility but ignored
  searchType: "people" | "companies";
  api: "classic" | "sales_navigator" | "recruiter";
  filters: SearchFilters;
  cursor?: string;
  limit?: number;
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
async function consumeQuotaAtomic(
  serviceClient: any,
  workspaceId: string,
  action: string,
  dailyLimit: number,
  accountId: string,
  userId: string | null,
  metadata: Record<string, unknown> = {}
): Promise<QuotaResult> {
  const { data, error } = await serviceClient.rpc("consume_workspace_quota", {
    p_workspace_id: workspaceId,
    p_action: action,
    p_daily_limit: dailyLimit,
    p_account_id: accountId,
    p_user_id: userId,
    p_metadata: metadata,
  });
  
  if (error) {
    console.error("[PLAN_LIMIT] Error consuming quota:", error);
    // Fail open with a warning - return allowed but log error
    return { allowed: true, current: 0, limit: dailyLimit, action };
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
    const { workspaceId, searchType, api, filters, cursor, limit = 25 } = body;

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

    if (filters.location) {
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
    console.log("[linkedin-search] Unipile response items:", searchData.items?.length ?? 0);

    // Transform results
    const results = (searchData.items || []).map((item: Record<string, unknown>) => {
      const publicIdentifier = item.public_identifier as string | undefined;
      const profileUrl = publicIdentifier
        ? `https://www.linkedin.com/in/${publicIdentifier}`
        : (item.profile_url as string | undefined) ?? null;

      return {
        provider_id: item.id,
        public_identifier: publicIdentifier,
        full_name: item.name,
        first_name: item.first_name,
        last_name: item.last_name,
        headline: item.headline,
        profile_url: profileUrl,
        profile_picture_url: item.profile_picture,
        location: item.location,
        connection_degree: item.connection_degree,
        company:
          typeof item.current_company === "object"
            ? (item.current_company as Record<string, unknown>)?.name
            : item.current_company,
        job_title: item.current_title,
      };
    });

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