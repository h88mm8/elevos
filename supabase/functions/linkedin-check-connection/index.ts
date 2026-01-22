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

interface CheckConnectionRequest {
  workspaceId: string;
  accountId: string;
  linkedinUrl: string;
}

interface CheckConnectionBatchRequest {
  workspaceId: string;
  accountId: string;
  linkedinUrls: string[];
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

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Validate user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body = await req.json();
    
    // Determine if batch or single request
    const isBatch = Array.isArray(body.linkedinUrls);
    
    const workspaceId = body.workspaceId;
    const accountId = body.accountId;

    if (!workspaceId || !accountId) {
      return new Response(
        JSON.stringify({ error: "workspaceId and accountId are required" }),
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

    // Validate account
    const { data: account } = await supabase
      .from("accounts")
      .select("account_id, status, channel")
      .eq("account_id", accountId)
      .eq("workspace_id", workspaceId)
      .eq("channel", "linkedin")
      .maybeSingle();

    if (!account || account.status !== "connected") {
      return new Response(
        JSON.stringify({ error: "LinkedIn account not found or not connected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const unipileDsn = Deno.env.get("UNIPILE_DSN")!;
    const unipileApiKey = Deno.env.get("UNIPILE_API_KEY")!;

    // Helper function to check single connection
    async function checkSingleConnection(linkedinUrl: string): Promise<{
      linkedinUrl: string;
      publicIdentifier: string | null;
      connectionDegree: number | null;
      isConnected: boolean;
      error?: string;
    }> {
      const publicIdentifier = extractLinkedInPublicIdentifier(linkedinUrl);
      
      if (!publicIdentifier) {
        return {
          linkedinUrl,
          publicIdentifier: null,
          connectionDegree: null,
          isConnected: false,
          error: "Invalid LinkedIn URL format",
        };
      }

      try {
        const response = await fetch(
          `https://${unipileDsn}/api/v1/users/${publicIdentifier}?account_id=${accountId}`,
          {
            method: "GET",
            headers: {
              "X-API-KEY": unipileApiKey,
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[linkedin-check-connection] Failed for ${publicIdentifier}:`, errorText);
          return {
            linkedinUrl,
            publicIdentifier,
            connectionDegree: null,
            isConnected: false,
            error: `API error: ${response.status}`,
          };
        }

        const data = await response.json();
        const connectionDegree = data.connection_degree ?? null;
        
        return {
          linkedinUrl,
          publicIdentifier,
          connectionDegree,
          isConnected: connectionDegree === 1,
        };
      } catch (err) {
        console.error(`[linkedin-check-connection] Error for ${publicIdentifier}:`, err);
        return {
          linkedinUrl,
          publicIdentifier,
          connectionDegree: null,
          isConnected: false,
          error: String(err),
        };
      }
    }

    if (isBatch) {
      // Batch request
      const batchRequest = body as CheckConnectionBatchRequest;
      const linkedinUrls = batchRequest.linkedinUrls;

      if (!linkedinUrls || linkedinUrls.length === 0) {
        return new Response(
          JSON.stringify({ error: "linkedinUrls array is required and must not be empty" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (linkedinUrls.length > 50) {
        return new Response(
          JSON.stringify({ error: "Maximum 50 URLs per batch request" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[linkedin-check-connection] Checking ${linkedinUrls.length} connections in batch`);

      // Process in parallel with concurrency limit
      const results = await Promise.all(
        linkedinUrls.map(url => checkSingleConnection(url))
      );

      const connected = results.filter(r => r.isConnected);
      const notConnected = results.filter(r => !r.isConnected && !r.error);
      const errors = results.filter(r => r.error);

      return new Response(
        JSON.stringify({
          success: true,
          results,
          summary: {
            total: results.length,
            connected: connected.length,
            notConnected: notConnected.length,
            errors: errors.length,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Single request
      const singleRequest = body as CheckConnectionRequest;
      const linkedinUrl = singleRequest.linkedinUrl;

      if (!linkedinUrl) {
        return new Response(
          JSON.stringify({ error: "linkedinUrl is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[linkedin-check-connection] Checking connection for: ${linkedinUrl}`);

      const result = await checkSingleConnection(linkedinUrl);

      if (result.error) {
        return new Response(
          JSON.stringify({ success: false, ...result }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, ...result }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[linkedin-check-connection] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
