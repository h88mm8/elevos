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

interface ApifyRunResponse {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

// Normalize LinkedIn URL for comparison
function normalizeLinkedIn(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/$/, "");
}

// Start Apify run - returns runId immediately
// Using harvestapi/linkedin-profile-details-extractor (LpVuK3Zozwuipa5bp)
async function startApifyRun(
  apifyToken: string,
  profileUrls: string[],
  mode: string
): Promise<ApifyRunResponse | null> {
  // Actor: LinkedIn Profile Details Extractor and Email Finder by HarvestAPI
  const actorId = "LpVuK3Zozwuipa5bp";
  
  // Build input according to actor's expected format
  const input: Record<string, unknown> = {
    queries: profileUrls,
    profileScraperMode: mode === "profile_with_email" 
      ? "Profile details + email search ($10 per 1k)" 
      : "Profile details no email ($4 per 1k)",
  };

  console.log(`Starting Apify run with actor ${actorId}, ${profileUrls.length} profiles, mode: ${input.profileScraperMode}`);

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
    console.error("Apify run start failed:", response.status, errorText);
    return null;
  }

  return response.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: EnrichRequest = await req.json();
    const { workspaceId, leadIds, mode = "profile_with_email" } = body; // Email search by default

    if (!workspaceId || !leadIds || leadIds.length === 0) {
      return new Response(JSON.stringify({ error: "workspaceId and leadIds are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Starting enrichment for ${leadIds.length} leads in workspace ${workspaceId}`);

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

    // Fetch leads with LinkedIn data
    const { data: leads, error: leadsError } = await serviceClient
      .from("leads")
      .select("id, linkedin_url, linkedin_public_identifier")
      .eq("workspace_id", workspaceId)
      .in("id", leadIds);

    if (leadsError || !leads) {
      return new Response(JSON.stringify({ error: "Failed to fetch leads" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter leads with LinkedIn data
    const leadsWithLinkedIn = leads.filter(
      (l: { linkedin_url?: string; linkedin_public_identifier?: string }) =>
        l.linkedin_url || l.linkedin_public_identifier
    );
    const skippedCount = leads.length - leadsWithLinkedIn.length;

    if (leadsWithLinkedIn.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          status: "completed",
          enriched: 0,
          skipped: skippedCount,
          message: "No leads with LinkedIn data to enrich",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build profile URLs
    const profileUrls = leadsWithLinkedIn.map(
      (lead: { linkedin_url?: string; linkedin_public_identifier?: string }) => {
        if (lead.linkedin_url) return lead.linkedin_url;
        return `https://www.linkedin.com/in/${lead.linkedin_public_identifier}`;
      }
    );

    // Start Apify run (non-blocking)
    const runResponse = await startApifyRun(apifyToken, profileUrls, mode);
    if (!runResponse) {
      return new Response(JSON.stringify({ error: "Failed to start enrichment job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const runId = runResponse.data.id;
    console.log(`Apify run started: ${runId}`);

    // Create enrichment job record for background processing
    const { data: job, error: jobError } = await serviceClient
      .from("enrichment_jobs")
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        apify_run_id: runId,
        lead_ids: leadsWithLinkedIn.map((l: { id: string }) => l.id),
        mode,
        status: "processing",
        total_leads: leadsWithLinkedIn.length,
      })
      .select("id")
      .single();

    if (jobError) {
      console.error("Failed to create enrichment job:", jobError);
      return new Response(JSON.stringify({ error: "Failed to create job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Enrichment job created: ${job.id}`);

    // Return 202 Accepted - processing will continue in background
    return new Response(
      JSON.stringify({
        success: true,
        status: "processing",
        jobId: job.id,
        runId,
        totalLeads: leadsWithLinkedIn.length,
        skipped: skippedCount,
        message: "Enrichment started. Check job status for updates.",
      }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
