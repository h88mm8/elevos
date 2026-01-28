import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ParameterType = "location" | "industry" | "company" | "school" | "title";

// Helper to get the global platform LinkedIn search account
async function getPlatformLinkedInSearchAccount(serviceClient: any): Promise<{
  accountId: string;
}> {
  const { data, error } = await serviceClient.rpc("get_platform_linkedin_search_account");
  
  if (error) {
    console.error("[LI_PARAMS] Error fetching platform account:", error);
    throw new Error("Platform admin must configure the global LinkedIn search account.");
  }
  
  const rows = data as Array<{ account_uuid: string; account_id: string; linkedin_feature: string | null }>;
  
  if (!rows || rows.length === 0) {
    throw new Error("Platform admin must configure the global LinkedIn search account.");
  }
  
  return { accountId: rows[0].account_id };
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

    // Initialize Supabase client
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

    // Parse query parameters
    const url = new URL(req.url);
    const parameterType = url.searchParams.get("type") as ParameterType;
    const query = url.searchParams.get("query") || "";
    const workspaceId = url.searchParams.get("workspaceId");

    if (!parameterType || !workspaceId) {
      return new Response(
        JSON.stringify({ error: "workspaceId and type are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validTypes: ParameterType[] = ["location", "industry", "company", "school", "title"];
    if (!validTypes.includes(parameterType)) {
      return new Response(
        JSON.stringify({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate workspace membership
    const { data: member } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member) {
      return new Response(
        JSON.stringify({ error: "Not a member of this workspace" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the global platform LinkedIn account (no accountId parameter needed)
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
    console.log(`[LI_PARAMS] Using global account: ${unipileAccountId}`);

    // Call Unipile to get search parameters
    const unipileDsn = Deno.env.get("UNIPILE_DSN")!;
    const unipileApiKey = Deno.env.get("UNIPILE_API_KEY")!;

    // Map our types to Unipile parameter types (per Unipile API docs)
    const unipileTypeMap: Record<ParameterType, string> = {
      location: "LOCATION",
      industry: "INDUSTRY",
      company: "COMPANY",
      school: "SCHOOL",
      title: "JOB_TITLE",
    };

    const unipileType = unipileTypeMap[parameterType];
    
    // Log the search parameters clearly
    console.log(`[linkedin-search-parameters] type=${parameterType}, query="${query}", unipileType=${unipileType}`);
    
    const searchUrl = new URL(`https://${unipileDsn}/api/v1/linkedin/search/parameters`);
    searchUrl.searchParams.set("account_id", unipileAccountId);
    searchUrl.searchParams.set("type", unipileType);
    
    // Always pass query to Unipile (searchParams.set handles encoding)
    if (query && query.trim().length > 0) {
      searchUrl.searchParams.set("query", query.trim());
    }

    console.log("[linkedin-search-parameters] Unipile URL:", searchUrl.toString());

    const response = await fetch(searchUrl.toString(), {
      method: "GET",
      headers: {
        "X-API-KEY": unipileApiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[linkedin-search-parameters] Unipile error: status=${response.status}, body=${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to get search parameters", details: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    
    // Transform to simpler format and limit to 20 results
    const items = (data.items || [])
      .slice(0, 20)
      .map((item: Record<string, unknown>) => ({
        id: item.id,
        name: item.name || item.title || item.label,
      }));
    
    console.log(`[linkedin-search-parameters] type=${parameterType}, query="${query}", returned=${items.length} items`);

    return new Response(
      JSON.stringify({
        success: true,
        type: parameterType,
        items,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[linkedin-search-parameters] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
