import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

interface SearchFilters {
  keywords?: string;
  first_name?: string;
  last_name?: string;
  // Legacy keys from the current UI (free-text)
  title?: string;
  company?: string;
  location?: string;
}

interface SearchRequest {
  workspaceId: string;
  // accountId is no longer used for search - we use the global platform account
  accountId?: string; // kept for backwards compatibility but ignored
  searchType: "people" | "companies";
  api: "classic" | "sales_navigator" | "recruiter";
  filters: SearchFilters;
  cursor?: string;
  limit?: number;
}

// Helper to get the global platform LinkedIn search account
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
  return {
    accountUuid: account.account_uuid,
    accountId: account.account_id,
    linkedinFeature: account.linkedin_feature,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Validate user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
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

    // Get the global platform LinkedIn account for search/enrichment
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
    
    console.log(`[LI_SEARCH_GLOBAL] workspaceId=${workspaceId} platformAccountUuid=${platformAccount.accountUuid} unipileAccountId=${unipileAccountId} feature=${platformAccount.linkedinFeature}`);

    // Check workspace settings and daily limits
    const { data: settings } = await supabase
      .from("workspace_settings")
      .select("linkedin_daily_search_limit")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const dailySearchLimit = settings?.linkedin_daily_search_limit ?? 50;
    const today = getTodayDate();

    // Get current usage (use Unipile account_id for usage tracking)
    const { data: currentUsage } = await serviceClient.rpc("get_daily_usage", {
      p_workspace_id: workspaceId,
      p_account_id: unipileAccountId,
      p_action: "linkedin_search",
      p_usage_date: today,
    });

    if ((currentUsage ?? 0) >= dailySearchLimit) {
      return new Response(
        JSON.stringify({
          error: "Daily search limit reached",
          usage: { current: currentUsage, limit: dailySearchLimit },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Unipile expects account_id as a query parameter for this endpoint.
    // It does NOT support GET; filters should be passed via POST JSON body.
    const searchUrl = `https://${unipileDsn}/api/v1/linkedin/search?account_id=${encodeURIComponent(unipileAccountId)}`;

    // Build payload (Unipile schema expects category + optional advanced_keywords)
    const searchPayload: Record<string, unknown> = {
      api: api || "classic",
      category: searchType === "companies" ? "companies" : "people",
      limit: Math.min(limit, 25),
    };

    if (filters.keywords) searchPayload.keywords = filters.keywords;

    // Free-text fields should go into advanced_keywords to avoid needing numeric IDs
    const advancedKeywords: Record<string, unknown> = {};
    if (filters.first_name) advancedKeywords.first_name = filters.first_name;
    if (filters.last_name) advancedKeywords.last_name = filters.last_name;
    if (filters.title) advancedKeywords.title = filters.title;
    if (filters.company) advancedKeywords.company = filters.company;
    if (Object.keys(advancedKeywords).length) searchPayload.advanced_keywords = advancedKeywords;

    // Location requires numeric parameter IDs. If UI sends free text, try to resolve the ID.
    if (filters.location) {
      const trimmed = filters.location.trim();
      if (/^\d+$/.test(trimmed)) {
        searchPayload.location = [trimmed];
      } else {
        const resolvedId = await resolveParameterId("location", trimmed);
        if (resolvedId) {
          searchPayload.location = [resolvedId];
        } else {
          console.log(`[linkedin-search] Could not resolve location '${trimmed}', skipping location filter.`);
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
      return new Response(
        JSON.stringify({ error: "LinkedIn search failed", details: errorText }),
        { status: searchResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const searchData = await searchResponse.json();
    console.log("[linkedin-search] Unipile response items:", searchData.items?.length ?? 0);

    // Increment daily usage (use Unipile account_id for tracking)
    await serviceClient.rpc("increment_daily_usage", {
      p_workspace_id: workspaceId,
      p_account_id: unipileAccountId,
      p_action: "linkedin_search",
      p_usage_date: today,
    });

    // Transform results to match our lead format
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
          current: (currentUsage ?? 0) + 1,
          limit: dailySearchLimit,
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
