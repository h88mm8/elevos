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

    const { workspaceId, chatId, accountId, attendeesIds, text, attachmentUrl, attachmentType, attachmentName } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId is required' }), { status: 400, headers: corsHeaders });
    }

    // Must have either text or attachment
    if (!text && !attachmentUrl) {
      return new Response(JSON.stringify({ error: 'text or attachment is required' }), { status: 400, headers: corsHeaders });
    }

    // Need either chatId (existing chat) or accountId + attendeesIds (new chat)
    if (!chatId && (!accountId || !attendeesIds?.length)) {
      return new Response(JSON.stringify({ 
        error: 'Either chatId or (accountId + attendeesIds) is required' 
      }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // MEMBERSHIP CHECK: Verify user belongs to workspace
    // ============================================
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // VALIDATE ACCOUNT: If accountId provided, verify it belongs to workspace
    // ============================================
    if (accountId) {
      const { data: account } = await supabase
        .from('accounts')
        .select('id')
        .eq('account_id', accountId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (!account) {
        return new Response(JSON.stringify({ 
          error: 'Account not found or does not belong to this workspace' 
        }), { status: 403, headers: corsHeaders });
      }
    }

    // ============================================
    // CALL MESSAGING PROVIDER API: Send message
    // ============================================
    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured, returning mock response');
      return new Response(JSON.stringify({
        success: true,
        messageId: 'mock-' + crypto.randomUUID(),
        message: 'Messaging service not configured',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let url: string;
    let providerResponse: Response;

    if (chatId) {
      // Send message to existing chat
      url = `https://${PROVIDER_DSN}/api/v1/chats/${chatId}/messages`;
      
      // Check if we're sending an attachment
      if (attachmentUrl) {
        console.log('Sending message with attachment:', { attachmentUrl, attachmentType, attachmentName });
        
        // Fetch the file from the signed URL
        const fileResponse = await fetch(attachmentUrl);
        if (!fileResponse.ok) {
          throw new Error('Failed to fetch attachment file');
        }
        
        const fileBlob = await fileResponse.blob();
        
        // Create FormData for multipart upload
        const formData = new FormData();
        formData.append('file', fileBlob, attachmentName || 'attachment');
        
        if (text) {
          formData.append('text', text);
        }
        
        providerResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'X-API-KEY': PROVIDER_API_KEY,
            'accept': 'application/json',
          },
          body: formData,
        });
      } else {
        // Text-only message
        providerResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'X-API-KEY': PROVIDER_API_KEY,
            'accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        });
      }
    } else {
      // Create new chat and send message (text only for new chats)
      url = `https://${PROVIDER_DSN}/api/v1/chats`;
      providerResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-KEY': PROVIDER_API_KEY,
          'accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_id: accountId,
          attendees_ids: attendeesIds,
          text: text || '',
        }),
      });
    }

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      console.error('Provider API error:', providerResponse.status, errorText);
      
      if (providerResponse.status === 404) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Chat not found',
        }), { status: 404, headers: corsHeaders });
      }
      
      if (providerResponse.status === 400) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid request to messaging service',
          details: errorText,
        }), { status: 400, headers: corsHeaders });
      }
      
      throw new Error(`Provider API error: ${providerResponse.status}`);
    }

    const providerData = await providerResponse.json();
    console.log('Message sent via provider:', providerData);

    return new Response(JSON.stringify({
      success: true,
      messageId: providerData.message_id || providerData.id,
      chatId: providerData.chat_id || chatId,
      data: providerData,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in send-message:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
