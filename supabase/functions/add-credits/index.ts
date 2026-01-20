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

    const { workspaceId, type, amount, description } = await req.json();

    if (!workspaceId || !type || !amount) {
      return new Response(JSON.stringify({ error: 'workspaceId, type, and amount are required' }), { status: 400, headers: corsHeaders });
    }

    if (type !== 'leads' && type !== 'phone') {
      return new Response(JSON.stringify({ error: 'type must be "leads" or "phone"' }), { status: 400, headers: corsHeaders });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return new Response(JSON.stringify({ error: 'amount must be a positive number' }), { status: 400, headers: corsHeaders });
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
      return new Response(JSON.stringify({ error: 'Only admins can add credits' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // ADD CREDITS: Using RPC with reference_id = NULL (manual admin add)
    // This is allowed per documentation: reference_id NULL for manual additions
    // ============================================
    const { data: addSuccess, error: addError } = await supabase.rpc('add_credits', {
      p_workspace_id: workspaceId,
      p_type: type,
      p_amount: amount,
      p_description: description || `Adição manual de ${amount} créditos de ${type}`,
      p_reference_id: null, // NULL is allowed for manual admin additions
    });

    if (addError) {
      console.error('Error adding credits:', addError);
      return new Response(JSON.stringify({ error: 'Failed to add credits', details: addError.message }), { status: 500, headers: corsHeaders });
    }

    if (!addSuccess) {
      return new Response(JSON.stringify({ error: 'Failed to add credits' }), { status: 500, headers: corsHeaders });
    }

    // Get updated balance
    const { data: credits } = await supabase
      .from('credits')
      .select('leads_credits, phone_credits')
      .eq('workspace_id', workspaceId)
      .single();

    console.log(`Admin added ${amount} ${type} credits to workspace ${workspaceId}`);

    return new Response(JSON.stringify({
      success: true,
      message: `Added ${amount} ${type} credits`,
      leads_credits: credits?.leads_credits ?? 0,
      phone_credits: credits?.phone_credits ?? 0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in add-credits:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
