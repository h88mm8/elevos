import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cache duration in hours
const CACHE_DURATION_HOURS = 24;

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

    // Service role client for cache operations (bypasses RLS for inserts)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    if (claimsError || !claimsData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { workspaceId, accountId, limit = 50, cursor } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId is required' }), { status: 400, headers: corsHeaders });
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
    // CALL MESSAGING PROVIDER API: Get chats
    // ============================================
    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured, returning empty chats');
      return new Response(JSON.stringify({
        success: true,
        chats: [],
        message: 'Messaging service not configured',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let url = `https://${PROVIDER_DSN}/api/v1/chats?limit=${limit}`;
    if (accountId) {
      url += `&account_id=${accountId}`;
    }
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

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
      
      if (providerResponse.status === 401 || providerResponse.status === 403) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Provider authentication failed',
          chats: [],
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      throw new Error(`Provider API error: ${providerResponse.status}`);
    }

    const providerData = await providerResponse.json();
    const chatItems = providerData.items || [];
    console.log(`Retrieved ${chatItems.length} chats from provider`);

    // ============================================
    // LOAD CACHED PROFILES: Check what we already have
    // ============================================
    const phoneIdentifiers = chatItems
      .map((chat: any) => {
        const identifier = chat.attendee_public_identifier || chat.attendee_provider_id || '';
        return identifier.split('@')[0] || '';
      })
      .filter((id: string) => id.length > 0);

    const cacheExpiry = new Date(Date.now() - CACHE_DURATION_HOURS * 60 * 60 * 1000).toISOString();
    
    const { data: cachedProfiles } = await supabase
      .from('contact_profiles_cache')
      .select('phone_identifier, display_name, profile_picture')
      .eq('workspace_id', workspaceId)
      .in('phone_identifier', phoneIdentifiers)
      .gte('cached_at', cacheExpiry);

    const cachedMap = new Map<string, { displayName: string | null; profilePicture: string | null }>();
    (cachedProfiles || []).forEach((p: any) => {
      cachedMap.set(p.phone_identifier, {
        displayName: p.display_name,
        profilePicture: p.profile_picture,
      });
    });

    console.log(`Found ${cachedMap.size} cached profiles out of ${phoneIdentifiers.length} contacts`);

    // ============================================
    // FETCH MISSING PROFILES: Only fetch what's not cached
    // ============================================
    const chatsNeedingFetch = chatItems.filter((chat: any) => {
      const identifier = chat.attendee_public_identifier || chat.attendee_provider_id || '';
      const phoneNumber = identifier.split('@')[0] || '';
      return phoneNumber && !cachedMap.has(phoneNumber);
    });

    console.log(`Fetching ${chatsNeedingFetch.length} profiles from provider API`);

    const fetchAttendeeProfile = async (chat: any): Promise<{ phoneNumber: string; displayName: string | null; profilePicture: string | null }> => {
      const identifier = chat.attendee_public_identifier || chat.attendee_provider_id || '';
      const phoneNumber = identifier.split('@')[0] || '';
      
      try {
        if (!identifier || !chat.account_id) {
          return { phoneNumber, displayName: null, profilePicture: null };
        }

        const profileUrl = `https://${PROVIDER_DSN}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${chat.account_id}`;
        const profileResponse = await fetch(profileUrl, {
          method: 'GET',
          headers: {
            'X-API-KEY': PROVIDER_API_KEY,
            'accept': 'application/json',
          },
        });

        if (!profileResponse.ok) {
          console.log(`Could not fetch profile for ${identifier}: ${profileResponse.status}`);
          return { phoneNumber, displayName: null, profilePicture: null };
        }

        const profile = await profileResponse.json();
        const displayName = profile.display_name || profile.name || 
                           (profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : null) ||
                           profile.first_name || null;
        return { 
          phoneNumber,
          displayName, 
          profilePicture: profile.profile_picture_url || profile.profile_picture || null 
        };
      } catch (err) {
        console.log(`Error fetching profile: ${err}`);
        return { phoneNumber, displayName: null, profilePicture: null };
      }
    };

    // Fetch profiles in parallel (limit concurrent requests to avoid rate limiting)
    const batchSize = 10;
    const newProfiles: Array<{ phoneNumber: string; displayName: string | null; profilePicture: string | null }> = [];

    for (let i = 0; i < chatsNeedingFetch.length; i += batchSize) {
      const batch = chatsNeedingFetch.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(fetchAttendeeProfile));
      newProfiles.push(...results);
    }

    // ============================================
    // SAVE NEW PROFILES TO CACHE
    // ============================================
    if (newProfiles.length > 0) {
      const cacheInserts = newProfiles
        .filter(p => p.phoneNumber && (p.displayName || p.profilePicture))
        .map(p => ({
          workspace_id: workspaceId,
          phone_identifier: p.phoneNumber,
          display_name: p.displayName,
          profile_picture: p.profilePicture,
          cached_at: new Date().toISOString(),
        }));

      if (cacheInserts.length > 0) {
        const { error: cacheError } = await supabaseAdmin
          .from('contact_profiles_cache')
          .upsert(cacheInserts, { 
            onConflict: 'workspace_id,phone_identifier',
            ignoreDuplicates: false 
          });

        if (cacheError) {
          console.log('Error caching profiles:', cacheError.message);
        } else {
          console.log(`Cached ${cacheInserts.length} new profiles`);
        }
      }
    }

    // Add new profiles to the map
    newProfiles.forEach(p => {
      cachedMap.set(p.phoneNumber, {
        displayName: p.displayName,
        profilePicture: p.profilePicture,
      });
    });

    // ============================================
    // MAP CHATS WITH PROFILES
    // ============================================
    // Helper to determine attachment type from provider data
    const getAttachmentInfo = (lastMessage: any): { type: string | null; duration: number | null } => {
      if (!lastMessage?.attachments || lastMessage.attachments.length === 0) {
        return { type: null, duration: null };
      }
      
      const attachment = lastMessage.attachments[0];
      const mimeType = attachment.mime_type || attachment.type || '';
      
      let type: string | null = null;
      if (mimeType.startsWith('image/')) {
        type = 'image';
      } else if (mimeType.startsWith('video/')) {
        type = 'video';
      } else if (mimeType.startsWith('audio/') || attachment.type === 'audio') {
        type = 'audio';
      } else if (mimeType.startsWith('application/') || attachment.type === 'document' || attachment.type === 'file') {
        type = 'document';
      }
      
      const duration = attachment.duration || null;
      
      return { type, duration };
    };

    const mappedChats = chatItems.map((chat: any) => {
      const attendeeIdentifier = chat.attendee_public_identifier || chat.attendee_provider_id || '';
      const phoneNumber = attendeeIdentifier.split('@')[0] || '';
      const formattedPhone = phoneNumber ? `+${phoneNumber.slice(0, 2)} ${phoneNumber.slice(2)}` : '';
      const profile = cachedMap.get(phoneNumber);
      
      const attachmentInfo = getAttachmentInfo(chat.last_message);
      
      return {
        id: chat.id || chat.chat_id,
        account_id: chat.account_id,
        attendee_identifier: phoneNumber, // Used for deduplication
        attendee_name: profile?.displayName || chat.name || formattedPhone || 'Contato',
        attendee_email: null,
        attendee_picture: profile?.profilePicture || null,
        last_message: chat.last_message?.text || chat.snippet || '',
        last_message_type: attachmentInfo.type,
        last_message_duration: attachmentInfo.duration,
        last_message_at: chat.timestamp || chat.last_message?.date || null,
        unread_count: chat.unread_count || chat.unread || 0,
      };
    });

    // ============================================
    // FILTER OUT GHOST CHATS (empty conversations)
    // ============================================
    const validChats = mappedChats.filter((chat: any) => {
      // Only include chats that have a real last_message with content
      const hasMessage = chat.last_message && chat.last_message.trim().length > 0;
      return hasMessage;
    });

    console.log(`Filtered ${mappedChats.length} chats to ${validChats.length} valid chats (removed ${mappedChats.length - validChats.length} empty)`);

    // ============================================
    // DEDUPLICATE CHATS BY PHONE NUMBER
    // Keep only the most recent chat for each unique phone number
    // ============================================
    const chatMap = new Map<string, any>();
    
    for (const chat of validChats) {
      const key = chat.attendee_identifier || chat.id;
      const existing = chatMap.get(key);
      
      if (!existing) {
        chatMap.set(key, chat);
      } else {
        // Keep the one with the most recent message
        const existingDate = new Date(existing.last_message_at || 0).getTime();
        const currentDate = new Date(chat.last_message_at || 0).getTime();
        
        if (currentDate > existingDate) {
          // Merge unread counts when deduplicating
          chat.unread_count = (chat.unread_count || 0) + (existing.unread_count || 0);
          chatMap.set(key, chat);
        } else {
          existing.unread_count = (existing.unread_count || 0) + (chat.unread_count || 0);
        }
      }
    }
    
    const deduplicatedChats = Array.from(chatMap.values());

    console.log(`Mapped ${mappedChats.length} chats, deduplicated to ${deduplicatedChats.length} (${cachedMap.size} profiles from cache)`);

    return new Response(JSON.stringify({
      success: true,
      chats: deduplicatedChats,
      cursor: providerData.cursor,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in get-chats:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
