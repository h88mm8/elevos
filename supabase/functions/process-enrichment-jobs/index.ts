import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WorkspacePlan {
  plan_id: string;
  plan_code: string;
  daily_enrich_deep_limit: number;
}

interface QuotaResult {
  allowed: boolean;
  current: number;
  limit: number;
  action: string;
}

// Profile data from harvestapi/linkedin-profile-details-extractor
interface ApifyProfileData {
  // Identity
  id?: string;
  publicIdentifier?: string;
  linkedinUrl?: string;  // lowercase 'i' in new actor
  firstName?: string;
  lastName?: string;
  headline?: string;
  about?: string;
  
  // Location
  location?: {
    linkedinText?: string;
    countryCode?: string;
    parsed?: {
      text?: string;
      country?: string;
      state?: string;
      city?: string;
    };
  };
  
  // Skills (array of skill objects)
  skills?: Array<{ name: string; positions?: string[] }>;
  topSkills?: string;
  
  // Social
  connectionsCount?: number;
  followerCount?: number;
  
  // Contact (if email mode enabled)
  email?: string;
  phone?: string;
  
  // Experience
  currentPosition?: Array<{ companyName?: string }>;
  experience?: Array<{
    companyName?: string;
    position?: string;
    employmentType?: string;
    location?: string;
    duration?: string;
    description?: string;
    startDate?: { text?: string };
    endDate?: { text?: string };
    skills?: string[];
  }>;
  
  // Education
  education?: Array<{
    schoolName?: string;
    degree?: string;
    fieldOfStudy?: string;
    period?: string;
  }>;
  
  // Status
  status?: number;
  openToWork?: boolean;
  hiring?: boolean;
  premium?: boolean;
  influencer?: boolean;
  verified?: boolean;
  
  [key: string]: unknown;
}

// Normalize LinkedIn URL for comparison
function normalizeLinkedIn(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/$/, "");
}

// Get workspace plan
// deno-lint-ignore no-explicit-any
async function getWorkspacePlan(serviceClient: any, workspaceId: string): Promise<WorkspacePlan | null> {
  const { data, error } = await serviceClient.rpc("get_workspace_plan", { p_workspace_id: workspaceId });
  
  if (error || !data || data.length === 0) {
    console.error("Error fetching workspace plan:", error);
    return null;
  }

  const plan = data[0];
  
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

// Consume quota atomically - ONLY after successful enrichment
// deno-lint-ignore no-explicit-any
async function consumeQuota(
  serviceClient: any,
  workspaceId: string,
  userId: string,
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

// Check Apify run status
async function checkApifyRunStatus(
  apifyToken: string,
  runId: string
): Promise<{ status: string; datasetId?: string } | null> {
  const response = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
  );

  if (!response.ok) {
    console.error("Failed to check run status");
    return null;
  }

  const data = await response.json();
  return {
    status: data.data?.status,
    datasetId: data.data?.defaultDatasetId,
  };
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

// Parse location from the new actor format
function parseLocationFromProfile(profile: ApifyProfileData): { city?: string; state?: string; country?: string } {
  // Try parsed location first
  if (profile.location?.parsed) {
    return {
      city: profile.location.parsed.city,
      state: profile.location.parsed.state,
      country: profile.location.parsed.country,
    };
  }
  
  // Fallback to text parsing
  const locationText = profile.location?.linkedinText;
  if (!locationText) return {};
  
  const parts = locationText.split(",").map((p) => p.trim());
  
  if (parts.length === 1) return { country: parts[0] };
  if (parts.length === 2) return { city: parts[0], country: parts[1] };
  if (parts.length >= 3) return { city: parts[0], state: parts[1], country: parts[parts.length - 1] };
  
  return {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apifyToken = Deno.env.get("APIFY_API_TOKEN");

    if (!apifyToken) {
      console.error("APIFY_API_TOKEN not configured");
      return new Response(JSON.stringify({ error: "APIFY_API_TOKEN not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Find processing jobs
    const { data: jobs, error: jobsError } = await serviceClient
      .from("enrichment_jobs")
      .select("*")
      .eq("status", "processing")
      .limit(10);

    if (jobsError) {
      console.error("Failed to fetch jobs:", jobsError);
      return new Response(JSON.stringify({ error: "Failed to fetch jobs" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No pending jobs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing ${jobs.length} enrichment jobs`);

    let totalProcessed = 0;
    let totalEnriched = 0;
    let totalErrors = 0;

    for (const job of jobs) {
      console.log(`Processing job ${job.id} (run: ${job.apify_run_id})`);

      // Check Apify run status
      const runStatus = await checkApifyRunStatus(apifyToken, job.apify_run_id);
      
      if (!runStatus) {
        await serviceClient
          .from("enrichment_jobs")
          .update({ status: "failed", error_message: "Failed to check run status", completed_at: new Date().toISOString() })
          .eq("id", job.id);
        totalErrors++;
        continue;
      }

      if (runStatus.status === "RUNNING" || runStatus.status === "READY") {
        console.log(`Job ${job.id} still running`);
        continue; // Skip, still processing
      }

      if (runStatus.status === "FAILED" || runStatus.status === "ABORTED" || runStatus.status === "TIMED-OUT") {
        await serviceClient
          .from("enrichment_jobs")
          .update({ status: "failed", error_message: `Apify run ${runStatus.status}`, completed_at: new Date().toISOString() })
          .eq("id", job.id);
        totalErrors++;
        continue;
      }

      if (runStatus.status !== "SUCCEEDED" || !runStatus.datasetId) {
        console.log(`Job ${job.id} unexpected status: ${runStatus.status}`);
        continue;
      }

      // Fetch results
      const profiles = await fetchDataset(apifyToken, runStatus.datasetId);
      console.log(`Fetched ${profiles.length} profiles for job ${job.id}`);

      // Get leads for this job
      const { data: leads } = await serviceClient
        .from("leads")
        .select("id, linkedin_url, linkedin_public_identifier, email, phone, workspace_id")
        .in("id", job.lead_ids);

      if (!leads) {
        await serviceClient
          .from("enrichment_jobs")
          .update({ status: "failed", error_message: "Failed to fetch leads", completed_at: new Date().toISOString() })
          .eq("id", job.id);
        continue;
      }

      // Get workspace plan for quota
      const plan = await getWorkspacePlan(serviceClient, job.workspace_id);
      if (!plan) {
        await serviceClient
          .from("enrichment_jobs")
          .update({ status: "failed", error_message: "Failed to get workspace plan", completed_at: new Date().toISOString() })
          .eq("id", job.id);
        continue;
      }

      let enrichedCount = 0;
      let errorCount = 0;

      for (const profile of profiles) {
        // Find matching lead - use linkedinUrl (lowercase i in new actor)
        const profileUrl = profile.linkedinUrl ||
          (profile.publicIdentifier ? `https://www.linkedin.com/in/${profile.publicIdentifier}` : null);

        if (!profileUrl) {
          errorCount++;
          continue;
        }

        const normalizedProfileUrl = normalizeLinkedIn(profileUrl);

        const matchingLead = leads.find((lead: { id: string; linkedin_url?: string; linkedin_public_identifier?: string }) => {
          const leadUrl = lead.linkedin_url ||
            (lead.linkedin_public_identifier ? `https://www.linkedin.com/in/${lead.linkedin_public_identifier}` : null);
          
          if (!leadUrl) return false;
          return normalizeLinkedIn(leadUrl) === normalizedProfileUrl;
        });

        if (!matchingLead) {
          console.log(`No matching lead for profile: ${profileUrl}`);
          errorCount++;
          continue;
        }

        // Consume quota ONLY on successful enrichment
        const quotaResult = await consumeQuota(
          serviceClient,
          job.workspace_id,
          job.user_id,
          plan.daily_enrich_deep_limit
        );

        if (!quotaResult) {
          console.error("Quota system error - failing job");
          await serviceClient
            .from("enrichment_jobs")
            .update({ 
              status: "failed", 
              error_message: "Quota system error", 
              enriched_count: enrichedCount,
              error_count: errorCount,
              completed_at: new Date().toISOString() 
            })
            .eq("id", job.id);
          break;
        }

        if (!quotaResult.allowed) {
          console.log(`Quota exceeded for workspace ${job.workspace_id}`);
          await serviceClient
            .from("enrichment_jobs")
            .update({ 
              status: "quota_exceeded", 
              error_message: `Daily limit reached (${quotaResult.current}/${quotaResult.limit})`,
              enriched_count: enrichedCount,
              error_count: errorCount,
              completed_at: new Date().toISOString() 
            })
            .eq("id", job.id);
          break;
        }

        try {
          // Save raw JSON to linkedin_profiles
          await serviceClient.from("linkedin_profiles").insert({
            lead_id: matchingLead.id,
            workspace_id: job.workspace_id,
            raw_json: profile,
            source: "apify",
            apify_run_id: job.apify_run_id,
            status: "completed",
          });

          // ROBUST MAPPER for harvestapi actor format
          // Current job: check currentPosition or first experience with no endDate
          const currentExperience =
            profile.experience?.find((e) => e.endDate?.text === "Present") ??
            profile.experience?.[0];

          const location = parseLocationFromProfile(profile);

          // Build full name from first + last
          const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || undefined;

          // Build update
          const updateData: Record<string, unknown> = {
            first_name: profile.firstName,
            last_name: profile.lastName,
            full_name: fullName,
            headline: profile.headline,
            about: profile.about,
            company: currentExperience?.companyName || profile.currentPosition?.[0]?.companyName,
            job_title: currentExperience?.position,
            city: location.city,
            state: location.state,
            country: location.country,
            skills: profile.skills?.map((s) => s.name),
            connections: profile.connectionsCount,
            followers: profile.followerCount,
            last_enriched_at: new Date().toISOString(),
          };

          // Only update email/phone if not already set (don't overwrite)
          if (!matchingLead.email && profile.email) {
            updateData.email = profile.email;
          }
          if (!matchingLead.phone && profile.phone) {
            updateData.phone = profile.phone;
          }

          // Remove undefined values
          Object.keys(updateData).forEach((key) => {
            if (updateData[key] === undefined) delete updateData[key];
          });

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
          console.error(`Error processing profile:`, err);
          errorCount++;
        }
      }

      // Update job as completed
      await serviceClient
        .from("enrichment_jobs")
        .update({
          status: "completed",
          enriched_count: enrichedCount,
          error_count: errorCount,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      totalProcessed++;
      totalEnriched += enrichedCount;
      totalErrors += errorCount;

      console.log(`Job ${job.id} completed: ${enrichedCount} enriched, ${errorCount} errors`);
    }

    return new Response(
      JSON.stringify({
        processed: totalProcessed,
        enriched: totalEnriched,
        errors: totalErrors,
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
