import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

function extractLinkedInPublicIdentifier(linkedinUrl: string): string | null {
  if (!linkedinUrl) return null;
  const match = linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/i);
  return match ? match[1] : null;
}

interface EngageRequest {
  workspaceId: string;
  accountId: string;
  leadId?: string;
  linkedinUrl?: string;
  action: "like" | "comment" | "get_posts";
  postId?: string;
  comment?: string;
  limit?: number;
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

    // Parse request body
    const body: EngageRequest = await req.json();
    const { workspaceId, accountId, leadId, linkedinUrl, action, postId, comment, limit = 10 } = body;

    if (!workspaceId || !accountId || !action) {
      return new Response(
        JSON.stringify({ error: "workspaceId, accountId, and action are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validActions = ["like", "comment", "get_posts"];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: `Invalid action. Must be one of: ${validActions.join(", ")}` }),
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

    // Get settings and check limits for like/comment actions
    const { data: settings } = await supabase
      .from("workspace_settings")
      .select("linkedin_daily_like_limit, linkedin_daily_comment_limit")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const today = getTodayDate();
    const unipileDsn = Deno.env.get("UNIPILE_DSN")!;
    const unipileApiKey = Deno.env.get("UNIPILE_API_KEY")!;

    // Resolve LinkedIn URL from lead if needed
    let targetLinkedInUrl = linkedinUrl;
    if (leadId && !linkedinUrl) {
      const { data: lead } = await supabase
        .from("leads")
        .select("linkedin_url")
        .eq("id", leadId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (!lead?.linkedin_url) {
        return new Response(
          JSON.stringify({ error: "Lead not found or has no LinkedIn URL" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      targetLinkedInUrl = lead.linkedin_url;
    }

    // Handle get_posts action
    if (action === "get_posts") {
      if (!targetLinkedInUrl) {
        return new Response(
          JSON.stringify({ error: "linkedinUrl or leadId is required for get_posts" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const publicIdentifier = extractLinkedInPublicIdentifier(targetLinkedInUrl);
      if (!publicIdentifier) {
        return new Response(
          JSON.stringify({ error: "Invalid LinkedIn URL format" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[linkedin-engage] Getting posts for: ${publicIdentifier}`);

      // First get the user's provider_id
      const userResponse = await fetch(
        `https://${unipileDsn}/api/v1/users/${publicIdentifier}?account_id=${accountId}`,
        {
          method: "GET",
          headers: { "X-API-KEY": unipileApiKey },
        }
      );

      if (!userResponse.ok) {
        const errorText = await userResponse.text();
        return new Response(
          JSON.stringify({ error: "Failed to get user profile", details: errorText }),
          { status: userResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const userData = await userResponse.json();
      const providerId = userData.provider_id || userData.id;

      if (!providerId) {
        return new Response(
          JSON.stringify({ error: "Could not resolve provider_id for user" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get user's posts
      const postsResponse = await fetch(
        `https://${unipileDsn}/api/v1/users/${providerId}/posts?account_id=${accountId}&limit=${limit}`,
        {
          method: "GET",
          headers: { "X-API-KEY": unipileApiKey },
        }
      );

      if (!postsResponse.ok) {
        const errorText = await postsResponse.text();
        return new Response(
          JSON.stringify({ error: "Failed to get posts", details: errorText }),
          { status: postsResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const postsData = await postsResponse.json();
      console.log(`[linkedin-engage] Found ${postsData.items?.length ?? 0} posts`);

      const posts = (postsData.items || []).map((post: Record<string, unknown>) => ({
        id: post.id,
        text: post.text,
        created_at: post.created_at,
        likes_count: post.likes_count,
        comments_count: post.comments_count,
        shares_count: post.shares_count,
        url: post.url,
        has_liked: post.has_liked,
      }));

      return new Response(
        JSON.stringify({
          success: true,
          posts,
          user: {
            name: userData.name,
            headline: userData.headline,
            profile_picture: userData.profile_picture,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle like action
    if (action === "like") {
      if (!postId) {
        return new Response(
          JSON.stringify({ error: "postId is required for like action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check daily limit
      const dailyLikeLimit = settings?.linkedin_daily_like_limit ?? 20;
      const { data: currentUsage } = await serviceClient.rpc("get_daily_usage", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
        p_action: "linkedin_like",
        p_usage_date: today,
      });

      if ((currentUsage ?? 0) >= dailyLikeLimit) {
        return new Response(
          JSON.stringify({
            error: "Daily like limit reached",
            usage: { current: currentUsage, limit: dailyLikeLimit },
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[linkedin-engage] Liking post: ${postId}`);

      const likeResponse = await fetch(
        `https://${unipileDsn}/api/v1/posts/${postId}/reactions`,
        {
          method: "POST",
          headers: {
            "X-API-KEY": unipileApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            account_id: accountId,
            reaction_type: "LIKE",
          }),
        }
      );

      if (!likeResponse.ok) {
        const errorText = await likeResponse.text();
        console.error("[linkedin-engage] Like failed:", errorText);

        // Log the failed action
        if (leadId) {
          await supabase.from("engagement_actions").insert({
            workspace_id: workspaceId,
            account_id: accountId,
            lead_id: leadId,
            linkedin_url: targetLinkedInUrl || "",
            post_id: postId,
            action_type: "like",
            status: "failed",
            executed_at: new Date().toISOString(),
            error: errorText,
          });
        }

        return new Response(
          JSON.stringify({ error: "Failed to like post", details: errorText }),
          { status: likeResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Increment usage
      await serviceClient.rpc("increment_daily_usage", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
        p_action: "linkedin_like",
        p_usage_date: today,
      });

      // Log successful action
      if (leadId) {
        await supabase.from("engagement_actions").insert({
          workspace_id: workspaceId,
          account_id: accountId,
          lead_id: leadId,
          linkedin_url: targetLinkedInUrl || "",
          post_id: postId,
          action_type: "like",
          status: "done",
          executed_at: new Date().toISOString(),
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          action: "like",
          postId,
          usage: { current: (currentUsage ?? 0) + 1, limit: dailyLikeLimit },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle comment action
    if (action === "comment") {
      if (!postId || !comment) {
        return new Response(
          JSON.stringify({ error: "postId and comment are required for comment action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check daily limit
      const dailyCommentLimit = settings?.linkedin_daily_comment_limit ?? 5;
      const { data: currentUsage } = await serviceClient.rpc("get_daily_usage", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
        p_action: "linkedin_comment",
        p_usage_date: today,
      });

      if ((currentUsage ?? 0) >= dailyCommentLimit) {
        return new Response(
          JSON.stringify({
            error: "Daily comment limit reached",
            usage: { current: currentUsage, limit: dailyCommentLimit },
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[linkedin-engage] Commenting on post: ${postId}`);

      const commentResponse = await fetch(
        `https://${unipileDsn}/api/v1/posts/${postId}/comments`,
        {
          method: "POST",
          headers: {
            "X-API-KEY": unipileApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            account_id: accountId,
            text: comment,
          }),
        }
      );

      if (!commentResponse.ok) {
        const errorText = await commentResponse.text();
        console.error("[linkedin-engage] Comment failed:", errorText);

        // Log the failed action
        if (leadId) {
          await supabase.from("engagement_actions").insert({
            workspace_id: workspaceId,
            account_id: accountId,
            lead_id: leadId,
            linkedin_url: targetLinkedInUrl || "",
            post_id: postId,
            action_type: "comment",
            comment_text: comment,
            status: "failed",
            executed_at: new Date().toISOString(),
            error: errorText,
          });
        }

        return new Response(
          JSON.stringify({ error: "Failed to comment on post", details: errorText }),
          { status: commentResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Increment usage
      await serviceClient.rpc("increment_daily_usage", {
        p_workspace_id: workspaceId,
        p_account_id: accountId,
        p_action: "linkedin_comment",
        p_usage_date: today,
      });

      // Log successful action
      if (leadId) {
        await supabase.from("engagement_actions").insert({
          workspace_id: workspaceId,
          account_id: accountId,
          lead_id: leadId,
          linkedin_url: targetLinkedInUrl || "",
          post_id: postId,
          action_type: "comment",
          comment_text: comment,
          status: "done",
          executed_at: new Date().toISOString(),
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          action: "comment",
          postId,
          comment,
          usage: { current: (currentUsage ?? 0) + 1, limit: dailyCommentLimit },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[linkedin-engage] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
