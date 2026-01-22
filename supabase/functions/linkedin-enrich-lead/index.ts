import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

function extractLinkedInPublicIdentifier(linkedinUrl: string): string | null {
  if (!linkedinUrl) return null;
  const match = linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/i);
  return match ? match[1] : null;
}

function extractCompanyIdentifier(companyUrl: string): string | null {
  if (!companyUrl) return null;
  const match = companyUrl.match(/linkedin\.com\/company\/([^\/\?]+)/i);
  return match ? match[1] : null;
}

interface EnrichRequest {
  workspaceId: string;
  accountId: string;
  leadId: string;
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
    const body: EnrichRequest = await req.json();
    const { workspaceId, accountId, leadId } = body;

    if (!workspaceId || !accountId || !leadId) {
      return new Response(
        JSON.stringify({ error: "workspaceId, accountId, and leadId are required" }),
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

    // Get lead
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (leadError || !lead) {
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lead.linkedin_url) {
      return new Response(
        JSON.stringify({ error: "Lead does not have a LinkedIn URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate account - accountId can be UUID (id column) or Unipile account_id
    const { data: account } = await supabase
      .from("accounts")
      .select("id, account_id, status, channel")
      .eq("workspace_id", workspaceId)
      .eq("channel", "linkedin")
      .or(`id.eq.${accountId},account_id.eq.${accountId}`)
      .maybeSingle();

    if (!account || account.status !== "connected") {
      return new Response(
        JSON.stringify({ error: "LinkedIn account not found or not connected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use the Unipile account_id for API calls
    const unipileAccountId = account.account_id;

    // Check daily limits
    const { data: settings } = await supabase
      .from("workspace_settings")
      .select("linkedin_daily_profile_scrape_limit")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const dailyLimit = settings?.linkedin_daily_profile_scrape_limit ?? 50;
    const today = getTodayDate();

    const { data: currentUsage } = await serviceClient.rpc("get_daily_usage", {
      p_workspace_id: workspaceId,
      p_account_id: unipileAccountId,
      p_action: "linkedin_profile_scrape",
      p_usage_date: today,
    });

    if ((currentUsage ?? 0) >= dailyLimit) {
      return new Response(
        JSON.stringify({
          error: "Daily profile scrape limit reached",
          usage: { current: currentUsage, limit: dailyLimit },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract public identifier
    const publicIdentifier = extractLinkedInPublicIdentifier(lead.linkedin_url);
    if (!publicIdentifier) {
      return new Response(
        JSON.stringify({ error: "Invalid LinkedIn URL format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Unipile to get profile data
    const unipileDsn = Deno.env.get("UNIPILE_DSN")!;
    const unipileApiKey = Deno.env.get("UNIPILE_API_KEY")!;

    console.log("[linkedin-enrich-lead] Fetching profile for:", publicIdentifier);

    const profileResponse = await fetch(
      `https://${unipileDsn}/api/v1/users/${publicIdentifier}?account_id=${unipileAccountId}`,
      {
        method: "GET",
        headers: {
          "X-API-KEY": unipileApiKey,
        },
      }
    );

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      console.error("[linkedin-enrich-lead] Profile fetch error:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to fetch LinkedIn profile", details: errorText }),
        { status: profileResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const profileData = await profileResponse.json();
    console.log("[linkedin-enrich-lead] Profile data received for:", profileData.name);

    // Prepare update object
    const updateData: Record<string, unknown> = {
      enriched_at: new Date().toISOString(),
    };

    // Map profile fields
    if (profileData.name) updateData.full_name = profileData.name;
    if (profileData.first_name) updateData.first_name = profileData.first_name;
    if (profileData.last_name) updateData.last_name = profileData.last_name;
    if (profileData.headline) updateData.headline = profileData.headline;
    if (profileData.industry) updateData.industry = profileData.industry;
    
    // Location parsing
    if (profileData.location) {
      const location = profileData.location;
      if (typeof location === "string") {
        // Try to parse "City, State, Country" format
        const parts = location.split(",").map((p: string) => p.trim());
        if (parts.length >= 1) updateData.city = parts[0];
        if (parts.length >= 2) updateData.state = parts[1];
        if (parts.length >= 3) updateData.country = parts[2];
      } else if (typeof location === "object") {
        if (location.city) updateData.city = location.city;
        if (location.state) updateData.state = location.state;
        if (location.country) updateData.country = location.country;
      }
    }

    // Current position
    if (profileData.current_positions && profileData.current_positions.length > 0) {
      const currentPosition = profileData.current_positions[0];
      if (currentPosition.title) updateData.job_title = currentPosition.title;
      if (currentPosition.company_name) updateData.company = currentPosition.company_name;
      if (currentPosition.company_linkedin_url) {
        updateData.company_linkedin = currentPosition.company_linkedin_url;
      }
    }

    // Seniority
    if (profileData.seniority) updateData.seniority_level = profileData.seniority;

    // Try to get company data if we have company LinkedIn
    const companyLinkedIn = updateData.company_linkedin as string || lead.company_linkedin;
    if (companyLinkedIn) {
      const companyIdentifier = extractCompanyIdentifier(companyLinkedIn);
      if (companyIdentifier) {
        console.log("[linkedin-enrich-lead] Fetching company data for:", companyIdentifier);
        
        try {
          const companyResponse = await fetch(
            `https://${unipileDsn}/api/v1/linkedin/company/${companyIdentifier}?account_id=${unipileAccountId}`,
            {
              method: "GET",
              headers: {
                "X-API-KEY": unipileApiKey,
              },
            }
          );

          if (companyResponse.ok) {
            const companyData = await companyResponse.json();
            console.log("[linkedin-enrich-lead] Company data received:", companyData.name);

            if (companyData.name) updateData.company = companyData.name;
            if (companyData.industry) updateData.company_industry = companyData.industry;
            if (companyData.company_size) updateData.company_size = companyData.company_size;
            if (companyData.description) updateData.company_description = companyData.description;
            if (companyData.website) updateData.company_website = companyData.website;
            if (companyData.founded_year) updateData.company_founded_year = companyData.founded_year;
            if (companyData.headquarters) {
              updateData.company_address = typeof companyData.headquarters === "string"
                ? companyData.headquarters
                : JSON.stringify(companyData.headquarters);
            }
          }
        } catch (companyError) {
          console.warn("[linkedin-enrich-lead] Company fetch failed:", companyError);
          // Continue without company data
        }
      }
    }

    // Update lead in database
    const { error: updateError } = await supabase
      .from("leads")
      .update(updateData)
      .eq("id", leadId);

    if (updateError) {
      console.error("[linkedin-enrich-lead] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update lead", details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Increment daily usage
    await serviceClient.rpc("increment_daily_usage", {
      p_workspace_id: workspaceId,
      p_account_id: unipileAccountId,
      p_action: "linkedin_profile_scrape",
      p_usage_date: today,
    });

    // Return enriched fields
    const enrichedFields = Object.keys(updateData).filter(k => k !== "enriched_at");

    return new Response(
      JSON.stringify({
        success: true,
        enrichedFields,
        data: updateData,
        connectionDegree: profileData.connection_degree,
        usage: {
          current: (currentUsage ?? 0) + 1,
          limit: dailyLimit,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[linkedin-enrich-lead] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
