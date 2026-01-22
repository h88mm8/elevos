import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  leadId: string,
  errorDetails: Record<string, unknown>
): Promise<void> {
  const { error } = await serviceClient
    .from("usage_events")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      action: 'linkedin_enrich_error',
      account_id: accountId,
      metadata: { ...errorDetails, lead_id: leadId },
    });
  
  if (error) {
    console.error("[PLAN_LIMIT] Error logging error event:", error);
  }
}

// Helper to get the global platform LinkedIn search account
async function getPlatformLinkedInSearchAccount(serviceClient: any): Promise<{
  accountUuid: string;
  accountId: string;
  linkedinFeature: string | null;
}> {
  const { data, error } = await serviceClient.rpc("get_platform_linkedin_search_account");
  
  if (error) {
    console.error("[LI_ENRICH_GLOBAL] Error fetching platform account:", error);
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
    throw new Error("The configured global LinkedIn account no longer exists.");
  }
  
  if (accountData.channel !== "linkedin") {
    throw new Error("The configured global account is not a LinkedIn account.");
  }
  
  if (accountData.status !== "connected") {
    throw new Error(`The global LinkedIn account is disconnected (status: ${accountData.status}).`);
  }
  
  return {
    accountUuid: account.account_uuid,
    accountId: account.account_id,
    linkedinFeature: account.linkedin_feature,
  };
}

interface EnrichRequest {
  workspaceId: string;
  accountId?: string;
  leadId: string;
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

    const body: EnrichRequest = await req.json();
    const { workspaceId, leadId } = body;

    if (!workspaceId || !leadId) {
      return new Response(
        JSON.stringify({ error: "workspaceId and leadId are required" }),
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
    
    console.log(`[PLAN_LIMIT] workspaceId=${workspaceId} planCode=${workspacePlan.plan_code} action=linkedin_enrich limit=${workspacePlan.daily_enrich_limit}`);
    
    const quotaResult = await consumeQuotaAtomic(
      serviceClient,
      workspaceId,
      'linkedin_enrich',
      workspacePlan.daily_enrich_limit,
      unipileAccountId,
      user.id,
      {
        lead_id: leadId,
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
      console.log(`[PLAN_LIMIT] BLOCKED workspaceId=${workspaceId} action=linkedin_enrich current=${quotaResult.current} limit=${quotaResult.limit}`);
      
      return new Response(
        JSON.stringify({
          error: "Daily limit reached",
          action: "linkedin_enrich",
          usage: { current: quotaResult.current, limit: quotaResult.limit },
          plan: { code: workspacePlan.plan_code, name: workspacePlan.plan_name },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[PLAN_LIMIT] ALLOWED workspaceId=${workspaceId} action=linkedin_enrich current=${quotaResult.current} limit=${quotaResult.limit}`);
    // ===== END ATOMIC QUOTA CHECK =====

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
      
      // Log error event (quota already consumed)
      await logErrorEvent(serviceClient, workspaceId, user.id, unipileAccountId, leadId, {
        error: true,
        status: profileResponse.status,
        details: errorText.substring(0, 200),
      });
      
      return new Response(
        JSON.stringify({ error: "Failed to fetch LinkedIn profile", details: errorText }),
        { status: profileResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const profileData = await profileResponse.json();
    console.log("[linkedin-enrich-lead] Full profile data:", JSON.stringify(profileData, null, 2));

    // Prepare update object
    const updateData: Record<string, unknown> = {
      last_enriched_at: new Date().toISOString(),
      linkedin_public_identifier: publicIdentifier,
      linkedin_provider_id: profileData.id || profileData.provider_id || null,
      linkedin_profile_json: profileData,
    };

    const firstName = profileData.first_name;
    const lastName = profileData.last_name;
    
    if (firstName) updateData.first_name = firstName;
    if (lastName) updateData.last_name = lastName;
    
    if (firstName || lastName) {
      updateData.full_name = [firstName, lastName].filter(Boolean).join(' ');
    } else if (profileData.name) {
      updateData.full_name = profileData.name;
    }
    
    if (profileData.headline) updateData.headline = profileData.headline;
    if (profileData.industry) updateData.industry = profileData.industry;
    if (profileData.occupation) updateData.job_title = profileData.occupation;
    
    const locationData = profileData.location;
    if (locationData) {
      if (typeof locationData === "string") {
        const parts = locationData.split(",").map((p: string) => p.trim());
        if (parts.length === 1) {
          updateData.city = parts[0];
        } else if (parts.length === 2) {
          updateData.city = parts[0];
          updateData.country = parts[1];
        } else if (parts.length >= 3) {
          updateData.city = parts[0];
          updateData.state = parts[1];
          updateData.country = parts[2];
        }
      } else if (typeof locationData === "object") {
        if (locationData.city) updateData.city = locationData.city;
        if (locationData.state || locationData.region) updateData.state = locationData.state || locationData.region;
        if (locationData.country || locationData.country_name) updateData.country = locationData.country || locationData.country_name;
      }
    }

    const experiences = profileData.experiences;
    if (experiences && Array.isArray(experiences) && experiences.length > 0) {
      const currentExperience = experiences[0];
      
      if (!updateData.job_title && currentExperience.title) {
        updateData.job_title = currentExperience.title;
      }
      
      if (currentExperience.company) {
        const company = currentExperience.company;
        if (typeof company === "object") {
          if (company.name) updateData.company = company.name;
          if (company.linkedin_url) updateData.company_linkedin = company.linkedin_url;
        } else if (typeof company === "string") {
          updateData.company = company;
        }
      } else if (currentExperience.company_name) {
        updateData.company = currentExperience.company_name;
      }
    }

    if (profileData.seniority) updateData.seniority_level = profileData.seniority;

    const emails = profileData.emails || profileData.email;
    if (emails) {
      if (Array.isArray(emails) && emails.length > 0) {
        const primaryEmail = typeof emails[0] === 'object' ? emails[0].email || emails[0].address : emails[0];
        if (primaryEmail) updateData.email = primaryEmail;
        if (emails.length > 1) {
          const secondaryEmail = typeof emails[1] === 'object' ? emails[1].email || emails[1].address : emails[1];
          if (secondaryEmail) updateData.personal_email = secondaryEmail;
        }
      } else if (typeof emails === 'string') {
        updateData.email = emails;
      }
    }

    const phones = profileData.phone_numbers || profileData.phones || profileData.phone;
    if (phones) {
      if (Array.isArray(phones) && phones.length > 0) {
        const primaryPhone = typeof phones[0] === 'object' ? phones[0].number || phones[0].phone : phones[0];
        if (primaryPhone) updateData.phone = primaryPhone;
        if (phones.length > 1) {
          const secondaryPhone = typeof phones[1] === 'object' ? phones[1].number || phones[1].phone : phones[1];
          if (secondaryPhone) updateData.mobile_number = secondaryPhone;
        } else if (primaryPhone && primaryPhone.toString().match(/^(\+55|55)?[1-9]{2}9/)) {
          updateData.mobile_number = primaryPhone;
        }
      } else if (typeof phones === 'string') {
        updateData.phone = phones;
      }
    }

    const skills = profileData.skills;
    if (skills && Array.isArray(skills) && skills.length > 0) {
      const skillNames = skills.map((s: unknown) => {
        if (typeof s === 'string') return s;
        if (typeof s === 'object' && s !== null) {
          const skillObj = s as Record<string, unknown>;
          return skillObj.name || skillObj.skill || skillObj.title;
        }
        return null;
      }).filter(Boolean);
      
      if (skillNames.length > 0) {
        const existingKeywords = lead.keywords || '';
        const newKeywords = existingKeywords 
          ? `${existingKeywords}, ${skillNames.join(', ')}`
          : skillNames.join(', ');
        updateData.keywords = newKeywords;
      }
    }

    // Try to get company data if we have company LinkedIn
    const companyLinkedIn = updateData.company_linkedin as string || lead.company_linkedin;
    if (companyLinkedIn) {
      const companyIdentifier = extractCompanyIdentifier(companyLinkedIn);
      if (companyIdentifier) {
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

    const enrichedFields = Object.keys(updateData).filter(k => k !== "enriched_at");

    return new Response(
      JSON.stringify({
        success: true,
        enrichedFields,
        data: updateData,
        connectionDegree: profileData.connection_degree,
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
    console.error("[linkedin-enrich-lead] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});