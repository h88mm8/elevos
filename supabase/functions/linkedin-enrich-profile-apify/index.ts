import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EnrichRequest {
  workspaceId: string;
  leadIds: string[];
  mode?: "profile_only" | "profile_with_email";
}

interface WorkspacePlan {
  plan_id: string;
  plan_code: string;
  plan_name: string;
  daily_search_page_limit: number;
  daily_enrich_limit: number;
  daily_enrich_deep_limit: number;
}

interface QuotaResult {
  allowed: boolean;
  current: number;
  limit: number;
  action: string;
}

interface ApifyRunResponse {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

interface ApifyProfileData {
  publicIdentifier?: string;
  linkedInUrl?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  about?: string;
  location?: string;
  city?: string;
  country?: string;
  currentCompanyName?: string;
  currentCompanyPosition?: string;
  industry?: string;
  companySize?: string;
  skills?: string[];
  connectionsCount?: number;
  followersCount?: number;
  email?: string;
  phone?: string;
  [key: string]: unknown;
}

// Get workspace plan with enrich deep limit
// deno-lint-ignore no-explicit-any
async function getWorkspacePlan(serviceClient: any, workspaceId: string): Promise<WorkspacePlan | null> {
  const { data, error } = await serviceClient.rpc("get_workspace_plan", { p_workspace_id: workspaceId });
  
  if (error || !data || data.length === 0) {
    console.error("Error fetching workspace plan:", error);
    return null;
  }

  const plan = data[0];
  
  // Get the daily_enrich_deep_limit from plans table
  const { data: planData } = await serviceClient
    .from("plans")
    .select("daily_enrich_deep_limit")
    .eq("id", plan.plan_id)
    .single();

  return {
    ...plan,
    daily_enrich_deep_limit: planData?.daily_enrich_deep_limit ?? 10,
  };
}

// Consume quota atomically
// deno-lint-ignore no-explicit-any
async function consumeQuota(
  serviceClient: any,
  workspaceId: string,
  userId: string | null,
  dailyLimit: number
): Promise<QuotaResult | null> {
  const { data, error } = await serviceClient.rpc("consume_workspace_quota", {
    p_workspace_id: workspaceId,
    p_action: "linkedin_enrich_deep",
    p_daily_limit: dailyLimit,
    p_account_id: "apify",
    p_user_id: userId,
    p_metadata: { source: "apify_profile_enrichment" },
  });

  if (error) {
    console.error("Error consuming quota:", error);
    return null;
  }

  return data as QuotaResult;
}

// Log error event
// deno-lint-ignore no-explicit-any
async function logErrorEvent(
  serviceClient: any,
  workspaceId: string,
  userId: string | null,
  errorMessage: string
) {
  await serviceClient.from("usage_events").insert({
    workspace_id: workspaceId,
    user_id: userId,
    action: "linkedin_enrich_deep_error",
    account_id: "apify",
    metadata: { error: errorMessage },
    count: 1,
  });
}

// Start Apify run
async function startApifyRun(
  apifyToken: string,
  profileUrls: string[],
  mode: string
): Promise<ApifyRunResponse | null> {
  const actorId = "curious_coder~linkedin-profile-scraper";
  
  // deno-lint-ignore no-explicit-any
  const input: Record<string, any> = {
    profileUrls: profileUrls,
    proxyCountry: "US",
  };

  // If mode includes email, enable contact info scraping
  if (mode === "profile_with_email") {
    input.scrapeContactInfo = true;
  }

  console.log(`Starting Apify run with ${profileUrls.length} profiles`);

  const response = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Apify run start failed:", errorText);
    return null;
  }

  return response.json();
}

// Poll Apify run until complete
async function pollApifyRun(
  apifyToken: string,
  runId: string,
  maxWaitMs = 300000 // 5 minutes max
): Promise<string | null> {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
    );

    if (!response.ok) {
      console.error("Failed to poll run status");
      return null;
    }

    const data = await response.json();
    const status = data.data?.status;

    console.log(`Run ${runId} status: ${status}`);

    if (status === "SUCCEEDED") {
      return data.data.defaultDatasetId;
    }

    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      console.error(`Run failed with status: ${status}`);
      return null;
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.error("Polling timed out");
  return null;
}

// Fetch dataset results
async function fetchDataset(
  apifyToken: string,
  datasetId: string
): Promise<ApifyProfileData[]> {
  const response = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`
  );

  if (!response.ok) {
    console.error("Failed to fetch dataset");
    return [];
  }

  return response.json();
}

// Parse location string into city/state/country
function parseLocation(location: string | undefined): { city?: string; state?: string; country?: string } {
  if (!location) return {};
  
  const parts = location.split(",").map((p) => p.trim());
  
  if (parts.length === 1) {
    return { country: parts[0] };
  } else if (parts.length === 2) {
    return { city: parts[0], country: parts[1] };
  } else if (parts.length >= 3) {
    return { city: parts[0], state: parts[1], country: parts[parts.length - 1] };
  }
  
  return {};
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apifyToken = Deno.env.get("APIFY_API_TOKEN");

    if (!apifyToken) {
      return new Response(JSON.stringify({ error: "APIFY_API_TOKEN not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const body: EnrichRequest = await req.json();
    const { workspaceId, leadIds, mode = "profile_only" } = body;

    if (!workspaceId || !leadIds || leadIds.length === 0) {
      return new Response(JSON.stringify({ error: "workspaceId and leadIds are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Enriching ${leadIds.length} leads for workspace ${workspaceId}`);

    // Verify workspace membership
    const { data: membership } = await userClient
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return new Response(JSON.stringify({ error: "Not a workspace member" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch leads
    const { data: leads, error: leadsError } = await serviceClient
      .from("leads")
      .select("id, linkedin_url, linkedin_public_identifier, full_name, email, phone")
      .eq("workspace_id", workspaceId)
      .in("id", leadIds);

    if (leadsError || !leads) {
      return new Response(JSON.stringify({ error: "Failed to fetch leads" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter leads with LinkedIn data
    const leadsWithLinkedIn = leads.filter((l: { linkedin_url?: string; linkedin_public_identifier?: string }) => 
      l.linkedin_url || l.linkedin_public_identifier
    );
    const skippedCount = leads.length - leadsWithLinkedIn.length;

    if (leadsWithLinkedIn.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          enriched: 0,
          skipped: skippedCount,
          errors: 0,
          message: "No leads with LinkedIn data to enrich",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get workspace plan
    const plan = await getWorkspacePlan(serviceClient, workspaceId);
    if (!plan) {
      return new Response(JSON.stringify({ error: "Failed to get workspace plan" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Consume quota for each lead (fail-closed)
    let quotaConsumed = 0;
    for (const _lead of leadsWithLinkedIn) {
      const quotaResult = await consumeQuota(
        serviceClient,
        workspaceId,
        user.id,
        plan.daily_enrich_deep_limit
      );

      if (!quotaResult) {
        await logErrorEvent(serviceClient, workspaceId, user.id, "Quota check failed");
        return new Response(JSON.stringify({ error: "Quota system error - fail closed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!quotaResult.allowed) {
        // Quota exceeded - return partial results
        return new Response(
          JSON.stringify({
            success: false,
            error: "Daily quota exceeded",
            enriched: 0,
            skipped: skippedCount,
            errors: 0,
            quota: {
              current: quotaResult.current,
              limit: quotaResult.limit,
            },
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      quotaConsumed++;
    }

    console.log(`Quota consumed: ${quotaConsumed} profiles`);

    // Build profile URLs for Apify
    const profileUrls = leadsWithLinkedIn.map((lead: { linkedin_url?: string; linkedin_public_identifier?: string }) => {
      if (lead.linkedin_url) {
        return lead.linkedin_url;
      }
      return `https://www.linkedin.com/in/${lead.linkedin_public_identifier}`;
    });

    // Start Apify run
    const runResponse = await startApifyRun(apifyToken, profileUrls, mode);
    if (!runResponse) {
      await logErrorEvent(serviceClient, workspaceId, user.id, "Failed to start Apify run");
      return new Response(JSON.stringify({ error: "Failed to start enrichment job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const runId = runResponse.data.id;
    console.log(`Apify run started: ${runId}`);

    // Poll for completion
    const datasetId = await pollApifyRun(apifyToken, runId);
    if (!datasetId) {
      await logErrorEvent(serviceClient, workspaceId, user.id, "Apify run failed or timed out");
      return new Response(JSON.stringify({ error: "Enrichment job failed or timed out" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch results
    const profiles = await fetchDataset(apifyToken, datasetId);
    console.log(`Fetched ${profiles.length} profiles from dataset`);

    // Process each profile
    let enrichedCount = 0;
    let errorCount = 0;

    for (const profile of profiles) {
      // Find matching lead by URL or public identifier
      const linkedInUrl = profile.linkedInUrl || 
        (profile.publicIdentifier ? `https://www.linkedin.com/in/${profile.publicIdentifier}` : null);
      
      if (!linkedInUrl) {
        errorCount++;
        continue;
      }

      const matchingLead = leadsWithLinkedIn.find((lead: { id: string; linkedin_url?: string; linkedin_public_identifier?: string; full_name?: string; email?: string; phone?: string }) => {
        const leadUrl = lead.linkedin_url || 
          (lead.linkedin_public_identifier ? `https://www.linkedin.com/in/${lead.linkedin_public_identifier}` : null);
        
        if (!leadUrl) return false;
        
        // Normalize URLs for comparison
        const normalizedProfileUrl = linkedInUrl.toLowerCase().replace(/\/$/, "");
        const normalizedLeadUrl = leadUrl.toLowerCase().replace(/\/$/, "");
        
        return normalizedProfileUrl === normalizedLeadUrl ||
          profile.publicIdentifier === lead.linkedin_public_identifier;
      });

      if (!matchingLead) {
        console.log(`No matching lead found for profile: ${linkedInUrl}`);
        errorCount++;
        continue;
      }

      try {
        // Save raw JSON to linkedin_profiles
        await serviceClient.from("linkedin_profiles").insert({
          lead_id: matchingLead.id,
          workspace_id: workspaceId,
          raw_json: profile,
          source: "apify",
        });

        // Parse location
        const location = parseLocation(profile.location || profile.city);

        // Build update object (don't overwrite existing email/phone)
        // deno-lint-ignore no-explicit-any
        const updateData: Record<string, any> = {
          full_name: profile.fullName || (profile.firstName && profile.lastName 
            ? `${profile.firstName} ${profile.lastName}` 
            : matchingLead.full_name),
          headline: profile.headline,
          about: profile.about,
          company: profile.currentCompanyName,
          job_title: profile.currentCompanyPosition,
          industry: profile.industry,
          company_size: profile.companySize,
          city: location.city,
          state: location.state,
          country: profile.country || location.country,
          skills: profile.skills,
          connections: profile.connectionsCount,
          followers: profile.followersCount,
          linkedin_profile_json: profile,
          last_enriched_at: new Date().toISOString(),
        };

        // Only update email/phone if not already set
        if (!matchingLead.email && profile.email) {
          updateData.email = profile.email;
        }
        if (!matchingLead.phone && profile.phone) {
          updateData.phone = profile.phone;
        }

        // Update lead
        const { error: updateError } = await serviceClient
          .from("leads")
          .update(updateData)
          .eq("id", matchingLead.id);

        if (updateError) {
          console.error(`Failed to update lead ${matchingLead.id}:`, updateError);
          errorCount++;
        } else {
          enrichedCount++;
        }
      } catch (err) {
        console.error(`Error processing profile for lead ${matchingLead.id}:`, err);
        errorCount++;
      }
    }

    console.log(`Enrichment complete: ${enrichedCount} enriched, ${skippedCount} skipped, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        enriched: enrichedCount,
        skipped: skippedCount,
        errors: errorCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unhandled error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Internal server error", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
