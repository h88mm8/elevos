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

    const { inviteToken } = await req.json();

    if (!inviteToken) {
      return new Response(JSON.stringify({ error: 'inviteToken is required' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // FIND INVITE: Look up by token
    // ============================================
    // Use service role to bypass RLS since user isn't member yet
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: invite, error: inviteError } = await supabaseService
      .from('workspace_invites')
      .select('id, workspace_id, email, role, status')
      .eq('token', inviteToken)
      .maybeSingle();

    if (inviteError || !invite) {
      return new Response(JSON.stringify({ error: 'Invalid invite token' }), { status: 404, headers: corsHeaders });
    }

    // Check if invite is still valid
    if (invite.status !== 'pending') {
      return new Response(JSON.stringify({ 
        error: `Invite has already been ${invite.status}`,
        status: invite.status,
      }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // EMAIL VALIDATION: User email must match invite email
    // This prevents token theft/sharing
    // ============================================
    const userEmail = claimsData.user.email?.toLowerCase();
    const inviteEmail = invite.email.toLowerCase();

    if (userEmail !== inviteEmail) {
      console.warn(`Email mismatch: invite for ${inviteEmail}, user is ${userEmail}`);
      return new Response(JSON.stringify({ 
        error: 'Email does not match invite',
        message: `This invite was sent to ${inviteEmail}. Please login with that email address.`,
      }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // CHECK NOT ALREADY MEMBER
    // ============================================
    const { data: existingMember } = await supabaseService
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', invite.workspace_id)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (existingMember) {
      // Mark invite as accepted anyway
      await supabaseService
        .from('workspace_invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invite.id);

      return new Response(JSON.stringify({ 
        error: 'Already a member of this workspace',
        workspace_id: invite.workspace_id,
      }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // CREATE WORKSPACE MEMBER
    // ============================================
    const { error: memberError } = await supabaseService
      .from('workspace_members')
      .insert({
        workspace_id: invite.workspace_id,
        user_id: claimsData.user.id,
        role: invite.role,
      });

    if (memberError) {
      console.error('Error creating member:', memberError);
      return new Response(JSON.stringify({ error: 'Failed to join workspace', details: memberError.message }), { status: 500, headers: corsHeaders });
    }

    // ============================================
    // UPDATE INVITE STATUS
    // ============================================
    await supabaseService
      .from('workspace_invites')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    // Get workspace name
    const { data: workspace } = await supabaseService
      .from('workspaces')
      .select('name')
      .eq('id', invite.workspace_id)
      .single();

    console.log(`User ${claimsData.user.id} joined workspace ${invite.workspace_id} as ${invite.role}`);

    return new Response(JSON.stringify({
      success: true,
      workspace_id: invite.workspace_id,
      workspace_name: workspace?.name,
      role: invite.role,
      message: `Successfully joined workspace "${workspace?.name}"`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in accept-invite:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
