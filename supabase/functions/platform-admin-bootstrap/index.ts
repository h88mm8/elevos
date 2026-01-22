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

    console.log(`[platform-admin-bootstrap] User ${user.id} attempting bootstrap`);

    // Check if any platform admins exist
    const { data: existingAdmins, error: countError } = await serviceClient
      .from("platform_admins")
      .select("user_id")
      .limit(1);

    if (countError) {
      console.error("[platform-admin-bootstrap] Error checking admins:", countError);
      return new Response(
        JSON.stringify({ error: "Failed to check existing admins" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If admins exist, deny the request
    if (existingAdmins && existingAdmins.length > 0) {
      console.log("[platform-admin-bootstrap] Admins already exist, denying bootstrap");
      return new Response(
        JSON.stringify({ 
          error: "Platform admin already exists. Bootstrap is only allowed when no admins exist.",
          alreadyHasAdmin: true
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // No admins exist - make this user the first admin
    const { error: insertError } = await serviceClient
      .from("platform_admins")
      .insert({ user_id: user.id });

    if (insertError) {
      console.error("[platform-admin-bootstrap] Error inserting admin:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create platform admin" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[platform-admin-bootstrap] User ${user.id} is now platform admin`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "You are now a platform administrator",
        userId: user.id
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
