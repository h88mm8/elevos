import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    if (claimsError || !claimsData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { workspaceId, email, role } = await req.json();

    if (!workspaceId || !email || !role) {
      return new Response(JSON.stringify({ error: 'workspaceId, email, and role are required' }), { status: 400, headers: corsHeaders });
    }

    if (role !== 'admin' && role !== 'member') {
      return new Response(JSON.stringify({ error: 'role must be "admin" or "member"' }), { status: 400, headers: corsHeaders });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // ADMIN CHECK: Verify user is admin of workspace
    // ============================================
    const { data: member } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    if (member.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can invite members' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // CHECK EXISTING MEMBER: Don't invite if already member
    // ============================================
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existingProfile) {
      const { data: existingMember } = await supabase
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', existingProfile.user_id)
        .maybeSingle();

      if (existingMember) {
        return new Response(JSON.stringify({ error: 'User is already a member of this workspace' }), { status: 400, headers: corsHeaders });
      }
    }

    // ============================================
    // CHECK PENDING INVITE: Don't create duplicate invite
    // ============================================
    const { data: existingInvite } = await supabase
      .from('workspace_invites')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .maybeSingle();

    if (existingInvite) {
      return new Response(JSON.stringify({ error: 'An invite is already pending for this email' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // CREATE INVITE: Generate unique token
    // ============================================
    const inviteToken = crypto.randomUUID();

    const { data: invite, error: inviteError } = await supabase
      .from('workspace_invites')
      .insert({
        workspace_id: workspaceId,
        email: email.toLowerCase(),
        role,
        token: inviteToken,
        status: 'pending',
      })
      .select()
      .single();

    if (inviteError) {
      console.error('Error creating invite:', inviteError);
      return new Response(JSON.stringify({ error: 'Failed to create invite', details: inviteError.message }), { status: 500, headers: corsHeaders });
    }

    // Get workspace name for the response
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name')
      .eq('id', workspaceId)
      .single();

    console.log(`Invite created for ${email} to workspace ${workspaceId}, token: ${inviteToken}`);

    return new Response(JSON.stringify({
      success: true,
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token: invite.token,
        workspace_name: workspace?.name,
      },
      message: `Invite sent to ${email}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in invite-member:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
