/**
 * linkedin-enrich-preview
 * Enriches a single lead via Unipile /users/{public_identifier}
 * Uses GLOBAL platform account (not user accounts)
 * Returns normalized payload for UI preview (NO database writes)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createUnipileClientFromEnv, UnipileHttpError } from "../_shared/unipileClient.ts";
import { createLogger } from "../_shared/log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Configuration from env
const ENRICH_TIMEOUT_MS = parseInt(Deno.env.get('UNIPILE_ENRICH_TIMEOUT_MS') || '', 10) || 8000;

// ===== EXTRACTION HELPERS (shared with linkedin-search) =====

function extractJobTitle(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  if (data.occupation && typeof data.occupation === 'string') return data.occupation;
  const experiences = data.experiences as Array<Record<string, unknown>> | undefined;
  if (experiences?.length) return (experiences[0].title as string) || null;
  return null;
}

function extractCompany(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const experiences = data.experiences as Array<Record<string, unknown>> | undefined;
  if (experiences?.length) {
    const company = experiences[0].company as Record<string, unknown> | string;
    if (typeof company === 'string') return company;
    if (company && typeof company === 'object') return (company.name as string) || null;
  }
  return null;
}

function extractCompanyLinkedIn(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const experiences = data.experiences as Array<Record<string, unknown>> | undefined;
  if (experiences?.length) {
    const company = experiences[0].company as Record<string, unknown>;
    if (company) {
      const publicId = company.public_identifier as string;
      if (publicId) return `https://www.linkedin.com/company/${publicId}`;
      return (company.linkedin_url as string) || (company.url as string) || null;
    }
  }
  return null;
}

function extractCompanyIdentifier(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const experiences = data.experiences as Array<Record<string, unknown>> | undefined;
  if (experiences?.length) {
    const company = experiences[0].company as Record<string, unknown>;
    if (company && company.public_identifier) {
      return company.public_identifier as string;
    }
  }
  return null;
}

function extractCity(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const location = data.location as Record<string, unknown> | string;
  if (typeof location === 'object' && location) return (location.city as string) || null;
  if (typeof location === 'string') return location.split(',').map(s => s.trim())[0] || null;
  return null;
}

function extractState(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const location = data.location as Record<string, unknown> | string;
  if (typeof location === 'object' && location) return (location.state as string) || (location.region as string) || null;
  if (typeof location === 'string') {
    const parts = location.split(',').map(s => s.trim());
    return parts.length > 1 ? parts[1] : null;
  }
  return null;
}

function extractCountry(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const location = data.location as Record<string, unknown> | string;
  if (typeof location === 'object' && location) return (location.country as string) || null;
  if (typeof location === 'string') {
    const parts = location.split(',').map(s => s.trim());
    return parts.length > 2 ? parts[parts.length - 1] : null;
  }
  return null;
}

function extractEmail(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const emails = data.emails as Array<Record<string, unknown> | string>;
  if (emails?.length) {
    const first = emails[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object') return (first.email as string) || (first.address as string) || null;
  }
  if (data.email && typeof data.email === 'string') return data.email;
  return null;
}

function extractPhone(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const phones = data.phone_numbers as Array<Record<string, unknown> | string>;
  if (phones?.length) {
    const first = phones[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object') return (first.number as string) || (first.phone as string) || null;
  }
  return null;
}

function extractSkills(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const skills = data.skills as Array<Record<string, unknown> | string>;
  if (skills?.length) {
    const names = skills.map(s => typeof s === 'string' ? s : (s.name as string)).filter(Boolean);
    return names.length ? names.join(', ') : null;
  }
  return null;
}

// ===== NORMALIZE RESPONSE =====

interface EnrichedPreview {
  // Enriched fields
  headline: string | null;
  job_title: string | null;
  company: string | null;
  company_linkedin: string | null;
  company_identifier: string | null; // For on-demand company enrichment
  industry: string | null;
  seniority_level: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  keywords: string | null;
  about: string | null;
  connections: number | null;
  followers: number | null;
  profile_picture_url: string | null;
  // Status
  status: 'success' | 'error';
  error_reason?: string;
}

function normalizeEnrichedData(data: Record<string, unknown>): EnrichedPreview {
  return {
    headline: (data.headline as string) || null,
    job_title: extractJobTitle(data),
    company: extractCompany(data),
    company_linkedin: extractCompanyLinkedIn(data),
    company_identifier: extractCompanyIdentifier(data),
    industry: (data.industry as string) || null,
    seniority_level: (data.seniority as string) || null,
    city: extractCity(data),
    state: extractState(data),
    country: extractCountry(data),
    email: extractEmail(data),
    phone: extractPhone(data),
    keywords: extractSkills(data),
    about: (data.about as string) || (data.summary as string) || null,
    connections: typeof data.connections === 'number' ? data.connections : null,
    followers: typeof data.followers === 'number' ? data.followers : null,
    profile_picture_url: (data.profile_picture as string) || (data.picture_url as string) || null,
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

  const logger = createLogger('linkedin-enrich-preview');

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
    const { workspaceId, publicIdentifier } = body;

    if (!workspaceId || !publicIdentifier) {
      return new Response(
        JSON.stringify({ error: "workspaceId and publicIdentifier required" }),
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

    logger.info(`Enriching preview for ${publicIdentifier}`, { workspaceId });

    // Use centralized Unipile client with retry/backoff
    const unipileClient = createUnipileClientFromEnv('linkedin-enrich-preview');

    try {
      const response = await unipileClient.get<Record<string, unknown>>(
        `/users/${encodeURIComponent(publicIdentifier)}`,
        { account_id: globalAccount.accountId },
        { timeoutMs: ENRICH_TIMEOUT_MS }
      );

      const enriched = normalizeEnrichedData(response.data);
      
      logger.info(`Enrichment success for ${publicIdentifier}`, { 
        hasEmail: !!enriched.email,
        hasPhone: !!enriched.phone,
      });

      return new Response(
        JSON.stringify({
          publicIdentifier,
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

      logger.warn(`Enrichment failed for ${publicIdentifier}`, { errorReason });

      return new Response(
        JSON.stringify({
          publicIdentifier,
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
