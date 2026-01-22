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

    console.log(`[platform-admin-bootstrap] User ${user.id} attempting atomic bootstrap`);

    // Call the atomic RPC function
    const { data: result, error: rpcError } = await serviceClient.rpc("bootstrap_platform_admin", {
      p_user_id: user.id,
    });

    if (rpcError) {
      console.error("[platform-admin-bootstrap] RPC error:", rpcError);
      return new Response(
        JSON.stringify({ error: "Failed to execute bootstrap", details: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { created, already_has_admin } = result as { created: boolean; already_has_admin: boolean };

    console.log(`[platform-admin-bootstrap] Result: created=${created}, already_has_admin=${already_has_admin}`);

    if (already_has_admin) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Platform admin already exists. Bootstrap is only allowed when no admins exist.",
          alreadyHasAdmin: true,
          created: false,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (created) {
      console.log(`[platform-admin-bootstrap] User ${user.id} is now platform admin`);
      return new Response(
        JSON.stringify({
          success: true,
          message: "You are now a platform administrator",
          userId: user.id,
          created: true,
          alreadyHasAdmin: false,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Edge case: user already is admin (ON CONFLICT DO NOTHING hit)
    return new Response(
      JSON.stringify({
        success: true,
        message: "You are already a platform administrator",
        userId: user.id,
        created: false,
        alreadyHasAdmin: false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[platform-admin-bootstrap] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
