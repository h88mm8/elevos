/**
 * linkedin-company-enrich
 * Enriches company data via Unipile GET /linkedin/company/{identifier}
 * ON-DEMAND: Only called when user selects a lead or views details
 * Uses GLOBAL platform account
 * Returns normalized company payload (NO database writes)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createUnipileClientFromEnv, UnipileHttpError } from "../_shared/unipileClient.ts";
import { createLogger } from "../_shared/log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COMPANY_ENRICH_TIMEOUT_MS = parseInt(Deno.env.get('UNIPILE_COMPANY_TIMEOUT_MS') || '', 10) || 5000;

// ===== NORMALIZE COMPANY DATA =====

interface CompanyEnriched {
  name: string | null;
  description: string | null;
  industry: string | null;
  company_size: string | null;
  employee_count: number | null;
  employee_count_range: string | null;
  founded_year: number | null;
  website: string | null;
  linkedin_url: string | null;
  headquarters: string | null;
  specialties: string[] | null;
  logo_url: string | null;
  status: 'success' | 'error';
  error_reason?: string;
}

function normalizeCompanyData(data: Record<string, unknown>): CompanyEnriched {
  // Extract employee count/range
  let employeeCount: number | null = null;
  let employeeRange: string | null = null;
  
  if (typeof data.employee_count === 'number') {
    employeeCount = data.employee_count;
  } else if (typeof data.staff_count === 'number') {
    employeeCount = data.staff_count;
  }
  
  if (data.employee_count_range && typeof data.employee_count_range === 'string') {
    employeeRange = data.employee_count_range;
  } else if (data.company_size && typeof data.company_size === 'string') {
    employeeRange = data.company_size;
  } else if (data.staffCount_range && typeof data.staffCount_range === 'string') {
    employeeRange = data.staffCount_range;
  }

  // Extract headquarters
  let headquarters: string | null = null;
  const hq = data.headquarters as Record<string, unknown> | string | undefined;
  if (typeof hq === 'string') {
    headquarters = hq;
  } else if (hq && typeof hq === 'object') {
    const parts = [hq.city, hq.state, hq.country].filter(Boolean);
    headquarters = parts.length ? parts.join(', ') : null;
  }

  // Extract specialties
  let specialties: string[] | null = null;
  if (Array.isArray(data.specialties)) {
    specialties = data.specialties.filter((s): s is string => typeof s === 'string');
  }

  return {
    name: (data.name as string) || null,
    description: (data.description as string) || (data.about as string) || null,
    industry: (data.industry as string) || null,
    company_size: employeeRange,
    employee_count: employeeCount,
    employee_count_range: employeeRange,
    founded_year: typeof data.founded_year === 'number' ? data.founded_year : 
                  typeof data.founded === 'number' ? data.founded : null,
    website: (data.website as string) || (data.url as string) || null,
    linkedin_url: (data.linkedin_url as string) || (data.profile_url as string) || null,
    headquarters,
    specialties,
    logo_url: (data.logo as string) || (data.logo_url as string) || null,
    status: 'success',
  };
}

// ===== GET GLOBAL ACCOUNT =====

async function getGlobalAccount(serviceClient: any): Promise<{ accountId: string }> {
  const { data, error } = await serviceClient.rpc("get_platform_linkedin_search_account");
  
  if (error || !data?.length) {
    throw new Error("Conta global LinkedIn não configurada");
  }
  
  const account = data[0] as { account_id: string };
  return { accountId: account.account_id };
}

// ===== MAIN HANDLER =====

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const logger = createLogger('linkedin-company-enrich');

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
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
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse body
    const body = await req.json();
    const { workspaceId, companyIdentifier } = body;

    if (!workspaceId || !companyIdentifier) {
      return new Response(
        JSON.stringify({ error: "workspaceId and companyIdentifier required" }),
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
        JSON.stringify({ error: "Not a workspace member" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get global account
    let globalAccount;
    try {
      globalAccount = await getGlobalAccount(serviceClient);
    } catch (e) {
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error_reason: 'global_account_missing',
          error: (e as Error).message 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logger.info(`Enriching company: ${companyIdentifier}`, { workspaceId });

    // Use centralized Unipile client
    const unipileClient = createUnipileClientFromEnv('linkedin-company-enrich');

    try {
      const response = await unipileClient.get<Record<string, unknown>>(
        `/linkedin/company/${encodeURIComponent(companyIdentifier)}`,
        { account_id: globalAccount.accountId },
        { timeoutMs: COMPANY_ENRICH_TIMEOUT_MS }
      );

      const enriched = normalizeCompanyData(response.data);
      
      logger.info(`Company enrichment success: ${companyIdentifier}`, { 
        hasIndustry: !!enriched.industry,
        hasSize: !!enriched.company_size,
      });

      return new Response(
        JSON.stringify({
          companyIdentifier,
          ...enriched,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (err) {
      let errorReason = 'unknown';
      
      if (err instanceof UnipileHttpError) {
        if (err.status === 404) errorReason = 'not_found';
        else if (err.status === 429) errorReason = 'rate_limited';
        else if (err.status >= 500) errorReason = 'server_error';
        else if (err.isSessionError) errorReason = 'session_error';
        else errorReason = 'api_error';
      } else if (err instanceof Error && err.message.includes('timeout')) {
        errorReason = 'timeout';
      }

      logger.warn(`Company enrichment failed: ${companyIdentifier}`, { errorReason });

      return new Response(
        JSON.stringify({
          companyIdentifier,
          status: 'error',
          error_reason: errorReason,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    logger.error("Unexpected error", error as Error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
