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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    if (claimsError || !claimsData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { workspaceId, accountId, limit = 50 } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId is required' }), { status: 400, headers: corsHeaders });
    }

    // Verify user is member of workspace
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured');
      return new Response(JSON.stringify({
        success: true,
        synced: 0,
        message: 'Messaging service not configured',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fetch chats from provider
    let url = `https://${PROVIDER_DSN}/api/v1/chats?limit=${limit}`;
    if (accountId) {
      url += `&account_id=${accountId}`;
    }

    console.log(`Syncing chats from provider: ${url}`);

    const providerResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': PROVIDER_API_KEY,
        'accept': 'application/json',
      },
    });

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      console.error('Provider API error:', providerResponse.status, errorText);
      throw new Error(`Provider API error: ${providerResponse.status}`);
    }

    const providerData = await providerResponse.json();
    const chatItems = providerData.items || [];
    console.log(`Retrieved ${chatItems.length} chats from provider for sync`);

    // Prepare chat records for upsert
    const chatRecords = chatItems.map((chat: any) => {
      const attendeeIdentifier = (chat.attendee_public_identifier || chat.attendee_provider_id || '').split('@')[0];
      const formattedPhone = attendeeIdentifier ? `+${attendeeIdentifier.slice(0, 2)} ${attendeeIdentifier.slice(2)}` : '';
      
      // Determine attachment type
      let lastMessageType: string | null = null;
      let lastMessageDuration: number | null = null;
      if (chat.last_message?.attachments && chat.last_message.attachments.length > 0) {
        const att = chat.last_message.attachments[0];
        const mimeType = att.mime_type || att.type || '';
        if (mimeType.startsWith('image/')) lastMessageType = 'image';
        else if (mimeType.startsWith('video/')) lastMessageType = 'video';
        else if (mimeType.startsWith('audio/') || att.type === 'audio') lastMessageType = 'audio';
        else if (mimeType.startsWith('application/') || att.type === 'document') lastMessageType = 'document';
        lastMessageDuration = att.duration || null;
      }

      return {
        workspace_id: workspaceId,
        external_id: chat.id || chat.chat_id,
        account_id: chat.account_id || '',
        attendee_identifier: attendeeIdentifier,
        attendee_name: chat.name || formattedPhone || null,
        attendee_picture: null, // Will be fetched separately if needed
        last_message: chat.last_message?.text || chat.snippet || null,
        last_message_type: lastMessageType,
        last_message_duration: lastMessageDuration,
        last_message_at: chat.timestamp || chat.last_message?.date || new Date().toISOString(),
        unread_count: chat.unread_count || chat.unread || 0,
        updated_at: new Date().toISOString(),
      };
    });

    // Upsert all chats
    if (chatRecords.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from('chats')
        .upsert(chatRecords, {
          onConflict: 'workspace_id,external_id',
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error('Error upserting chats:', upsertError);
        throw upsertError;
      }

      console.log(`Successfully synced ${chatRecords.length} chats to cache`);
    }

    // Fetch and cache profile pictures in background
    const profileFetchPromises = chatItems.slice(0, 20).map(async (chat: any) => {
      const identifier = chat.attendee_public_identifier || chat.attendee_provider_id || '';
      const phoneNumber = identifier.split('@')[0];
      if (!identifier || !chat.account_id || !phoneNumber) return;

      try {
        const profileUrl = `https://${PROVIDER_DSN}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${chat.account_id}`;
        const profileResponse = await fetch(profileUrl, {
          method: 'GET',
          headers: {
            'X-API-KEY': PROVIDER_API_KEY,
            'accept': 'application/json',
          },
        });

        if (!profileResponse.ok) return;

        const profile = await profileResponse.json();
        const profilePicture = profile.profile_picture_url || profile.profile_picture || null;
        const displayName = profile.display_name || profile.name || 
                           (profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : null) ||
                           profile.first_name || null;

        if (profilePicture || displayName) {
          await supabaseAdmin
            .from('chats')
            .update({ 
              attendee_picture: profilePicture,
              attendee_name: displayName,
              updated_at: new Date().toISOString(),
            })
            .eq('workspace_id', workspaceId)
            .eq('attendee_identifier', phoneNumber);
        }
      } catch (err) {
        console.log(`Error fetching profile for ${identifier}:`, err);
      }
    });

    // Fire and forget profile fetches
    Promise.all(profileFetchPromises).catch(console.error);

    return new Response(JSON.stringify({
      success: true,
      synced: chatRecords.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in sync-chats:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
