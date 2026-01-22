import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UpdateRequest {
  linkedin_search_account_id: string | null;
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

    // Parse request body
    const body: UpdateRequest = await req.json();
    const { linkedin_search_account_id } = body;

    console.log(`[update-platform-settings] Admin ${user.id} updating linkedin_search_account_id to ${linkedin_search_account_id}`);

    // D) Validate the account if provided
    if (linkedin_search_account_id !== null) {
      const { data: account, error: accountError } = await serviceClient
        .from("accounts")
        .select("id, account_id, channel, status, name")
        .eq("id", linkedin_search_account_id)
        .maybeSingle();

      if (accountError || !account) {
        return new Response(
          JSON.stringify({ error: "Account not found" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (account.channel !== "linkedin") {
        return new Response(
          JSON.stringify({ error: "Selected account is not a LinkedIn account" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (account.status !== "connected") {
        return new Response(
          JSON.stringify({ 
            error: `LinkedIn account is not connected (status: ${account.status}). Please reconnect the account first.` 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[update-platform-settings] Validated account: ${account.name || account.account_id}`);
    }

    // Update platform settings
    const { data: settings, error: updateError } = await serviceClient
      .from("platform_settings")
      .update({
        linkedin_search_account_id,
        updated_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", 1)
      .select()
      .single();

    if (updateError) {
      console.error("[update-platform-settings] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update settings" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[update-platform-settings] Settings updated successfully`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        settings 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[update-platform-settings] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
