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
  locations?: string[];
  industries?: string[];
  current_companies?: string[];
  past_companies?: string[];
  titles?: string[];
  schools?: string[];
  first_name?: string;
  last_name?: string;
  connection_of?: string;
}

interface SearchRequest {
  workspaceId: string;
  accountId: string;
  searchType: "people" | "companies";
  api: "classic" | "sales_navigator" | "recruiter";
  filters: SearchFilters;
  cursor?: string;
  limit?: number;
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
    const { workspaceId, accountId, searchType, api, filters, cursor, limit = 25 } = body;

    if (!workspaceId || !accountId) {
      return new Response(
        JSON.stringify({ error: "workspaceId and accountId are required" }),
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

    // Validate account
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("account_id, status, channel")
      .eq("account_id", accountId)
      .eq("workspace_id", workspaceId)
      .eq("channel", "linkedin")
      .maybeSingle();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: "LinkedIn account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (account.status !== "connected") {
      return new Response(
        JSON.stringify({ error: "LinkedIn account is not connected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check workspace settings and daily limits
    const { data: settings } = await supabase
      .from("workspace_settings")
      .select("linkedin_daily_search_limit")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const dailySearchLimit = settings?.linkedin_daily_search_limit ?? 50;
    const today = getTodayDate();

    // Get current usage
    const { data: currentUsage } = await serviceClient.rpc("get_daily_usage", {
      p_workspace_id: workspaceId,
      p_account_id: accountId,
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

    const searchPayload: Record<string, unknown> = {
      account_id: accountId,
      api: api,
      limit: Math.min(limit, 25),
    };

    // Add filters
    if (filters.keywords) searchPayload.keywords = filters.keywords;
    if (filters.locations?.length) searchPayload.locations = filters.locations;
    if (filters.industries?.length) searchPayload.industries = filters.industries;
    if (filters.current_companies?.length) searchPayload.current_companies = filters.current_companies;
    if (filters.past_companies?.length) searchPayload.past_companies = filters.past_companies;
    if (filters.titles?.length) searchPayload.titles = filters.titles;
    if (filters.schools?.length) searchPayload.schools = filters.schools;
    if (filters.first_name) searchPayload.first_name = filters.first_name;
    if (filters.last_name) searchPayload.last_name = filters.last_name;
    if (filters.connection_of) searchPayload.connection_of = filters.connection_of;
    if (cursor) searchPayload.cursor = cursor;

    console.log("[linkedin-search] Calling Unipile search with payload:", JSON.stringify(searchPayload));

    const searchResponse = await fetch(
      `https://${unipileDsn}/api/v1/linkedin/search`,
      {
        method: "POST",
        headers: {
          "X-API-KEY": unipileApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(searchPayload),
      }
    );

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

    // Increment daily usage
    await serviceClient.rpc("increment_daily_usage", {
      p_workspace_id: workspaceId,
      p_account_id: accountId,
      p_action: "linkedin_search",
      p_usage_date: today,
    });

    // Transform results to match our lead format
    const results = (searchData.items || []).map((item: Record<string, unknown>) => ({
      provider_id: item.id,
      public_identifier: item.public_identifier,
      full_name: item.name,
      first_name: item.first_name,
      last_name: item.last_name,
      headline: item.headline,
      linkedin_url: item.public_identifier 
        ? `https://www.linkedin.com/in/${item.public_identifier}`
        : null,
      profile_picture: item.profile_picture,
      location: item.location,
      connection_degree: item.connection_degree,
      company: typeof item.current_company === "object" 
        ? (item.current_company as Record<string, unknown>)?.name 
        : item.current_company,
      job_title: item.current_title,
    }));

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
