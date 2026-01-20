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

    const { workspaceId, chatId, accountId } = await req.json();

    if (!workspaceId || !chatId) {
      return new Response(JSON.stringify({ error: 'workspaceId and chatId are required' }), { status: 400, headers: corsHeaders });
    }

    // Verify workspace membership
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    // Call the messaging provider to mark messages as read
    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured');
      return new Response(JSON.stringify({
        success: true,
        message: 'Messaging service not configured',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Mark chat as read via provider API
    const url = `https://${PROVIDER_DSN}/api/v1/chats/${chatId}`;
    
    const providerResponse = await fetch(url, {
      method: 'PATCH',
      headers: {
        'X-API-KEY': PROVIDER_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        seen: true,
      }),
    });

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      console.log('Provider API error when marking as read:', providerResponse.status, errorText);
      // Don't fail the request, just log the error
    } else {
      console.log(`Successfully marked chat ${chatId} as read`);
    }

    return new Response(JSON.stringify({
      success: true,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in mark-chat-read:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
