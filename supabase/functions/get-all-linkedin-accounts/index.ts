import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Check if user is platform admin
    const { data: adminCheck, error: adminError } = await serviceClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError || !adminCheck) {
      return new Response(
        JSON.stringify({ error: "Access denied. Platform admin required." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all connected LinkedIn accounts with workspace info
    const { data: accounts, error: accountsError } = await serviceClient
      .from("accounts")
      .select(`
        id,
        account_id,
        name,
        linkedin_feature,
        workspace_id,
        workspaces!inner(name)
      `)
      .eq("channel", "linkedin")
      .eq("status", "connected")
      .order("name", { ascending: true });

    if (accountsError) {
      console.error("[get-all-linkedin-accounts] Error:", accountsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch accounts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Transform data to include workspace name
    const transformedAccounts = (accounts || []).map((acc: any) => ({
      id: acc.id,
      account_id: acc.account_id,
      name: acc.name,
      linkedin_feature: acc.linkedin_feature,
      workspace_id: acc.workspace_id,
      workspace_name: acc.workspaces?.name || "Unknown Workspace",
    }));

    console.log(`[get-all-linkedin-accounts] Found ${transformedAccounts.length} connected LinkedIn accounts`);

    return new Response(
      JSON.stringify({ accounts: transformedAccounts }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[get-all-linkedin-accounts] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
