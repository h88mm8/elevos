import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Webhook endpoint for receiving message status updates from Unipile
 * Handles: message_sent, message_delivered, message_seen, message_received (reply)
 * 
 * Unipile Message Payload reference:
 * - id: unique message ID in Unipile
 * - provider_id: message ID in WhatsApp
 * - chat_id: conversation ID
 * - account_id: WhatsApp account used
 * - is_sender: true if we sent it, false if incoming
 * - timestamp: real message time
 * - status fields: delivered, seen, seen_by, deleted, edited
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ============================================
    // WEBHOOK SIGNATURE VALIDATION
    // ============================================
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
    if (webhookSecret) {
      const signature = req.headers.get('x-webhook-signature') || req.headers.get('x-signature');
      if (!signature) {
        console.error('Webhook rejected: missing signature');
        return new Response(JSON.stringify({ error: 'Missing signature' }), {
          status: 403,
          headers: corsHeaders,
        });
      }
      
      const encoder = new TextEncoder();
      const bodyBytes = await req.clone().arrayBuffer();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(webhookSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBytes = await crypto.subtle.sign('HMAC', key, bodyBytes);
      const expectedSignature = Array.from(new Uint8Array(signatureBytes))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      if (signature !== expectedSignature) {
        console.error('Webhook rejected: invalid signature');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 403,
          headers: corsHeaders,
        });
      }
    }

    // ============================================
    // PARSE WEBHOOK PAYLOAD
    // ============================================
    const payload = await req.json();
    console.log('Message webhook received:', JSON.stringify(payload));

    // ============================================
    // SERVICE CLIENT (bypasses RLS)
    // ============================================
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ============================================
    // EXTRACT EVENT DATA
    // ============================================
    // Unipile webhook format varies by event type
    const eventType = payload.event || payload.type || '';
    const messageData = payload.data || payload.message || payload.object || payload;
    
    // Message identifiers
    const messageId = messageData.id || messageData.message_id;
    const providerId = messageData.provider_id;
    const accountId = messageData.account_id;
    const chatId = messageData.chat_id;
    const isSender = messageData.is_sender;
    const timestamp = messageData.timestamp;
    
    // Status fields from message payload
    const isDelivered = messageData.delivered === true;
    const isSeen = messageData.seen === true || (messageData.seen_by && messageData.seen_by.length > 0);
    
    console.log(`Event: ${eventType}, MessageId: ${messageId}, ProviderId: ${providerId}, AccountId: ${accountId}, isSender: ${isSender}`);

    // ============================================
    // DETERMINE EVENT TYPE AND UPDATE
    // ============================================
    let processedEvent: string | null = null;
    let updateData: Record<string, any> = {};

    const normalizedEvent = (eventType || '').toLowerCase().replace(/[._-]/g, '');

    // Message delivered event
    if (normalizedEvent.includes('delivered') || isDelivered) {
      processedEvent = 'delivered';
      updateData = { 
        status: 'delivered',
        delivered_at: timestamp || new Date().toISOString()
      };
    }
    // Message seen/read event
    else if (normalizedEvent.includes('seen') || normalizedEvent.includes('read') || isSeen) {
      processedEvent = 'seen';
      updateData = { 
        status: 'seen',
        seen_at: timestamp || new Date().toISOString()
      };
    }
    // Incoming message (reply) - is_sender = false means the lead replied
    else if (
      (normalizedEvent.includes('message') && normalizedEvent.includes('received')) ||
      (normalizedEvent.includes('new') && normalizedEvent.includes('message')) ||
      (isSender === false && messageId)
    ) {
      // This is a reply from the lead
      processedEvent = 'replied';
      updateData = { 
        status: 'replied',
        replied_at: timestamp || new Date().toISOString()
      };
    }
    // Message sent confirmation
    else if (normalizedEvent.includes('sent') && isSender === true) {
      processedEvent = 'sent';
      // Just log, don't update status (already marked as sent when we sent it)
    }

    if (!processedEvent) {
      console.log(`Unhandled event type: ${eventType}`);
      return new Response(JSON.stringify({ 
        success: true, 
        processed: false,
        message: 'Event type not handled'
      }), { status: 200, headers: corsHeaders });
    }

    // ============================================
    // FIND CAMPAIGN LEAD BY PROVIDER MESSAGE ID OR CHAT
    // ============================================
    let campaignLead = null;
    let campaign = null;

    // First try to find by provider_message_id (if we stored it when sending)
    if (providerId || messageId) {
      const { data } = await serviceClient
        .from('campaign_leads')
        .select('*, campaign:campaigns(*)')
        .or(`provider_message_id.eq.${providerId},provider_message_id.eq.${messageId}`)
        .limit(1);
      
      if (data && data.length > 0) {
        campaignLead = data[0];
        campaign = campaignLead.campaign;
      }
    }

    // If not found by message ID, try to find by account + phone (for replies)
    if (!campaignLead && accountId && processedEvent === 'replied') {
      // Extract phone from chat_id or attendees
      // WhatsApp chat_id format is often "<phone>@s.whatsapp.net" or similar
      const phoneMatch = (chatId || '').match(/(\d{10,15})/);
      const leadPhone = phoneMatch ? phoneMatch[1] : null;

      if (leadPhone) {
        // Find the most recent campaign_lead with this phone and account
        const { data } = await serviceClient
          .from('campaign_leads')
          .select(`
            *,
            campaign:campaigns!inner(*),
            lead:leads!inner(mobile_number, phone)
          `)
          .eq('campaign.account_id', accountId)
          .in('status', ['sent', 'delivered', 'seen'])
          .order('sent_at', { ascending: false })
          .limit(10);

        if (data) {
          // Find matching lead by phone
          for (const cl of data) {
            const clPhone = (cl.lead?.mobile_number || cl.lead?.phone || '').replace(/\D/g, '');
            if (clPhone.includes(leadPhone) || leadPhone.includes(clPhone)) {
              campaignLead = cl;
              campaign = cl.campaign;
              break;
            }
          }
        }
      }
    }

    if (!campaignLead) {
      console.log('No matching campaign_lead found for this message event');
      return new Response(JSON.stringify({ 
        success: true, 
        processed: false,
        message: 'No matching campaign lead found'
      }), { status: 200, headers: corsHeaders });
    }

    // ============================================
    // UPDATE CAMPAIGN LEAD STATUS
    // ============================================
    if (Object.keys(updateData).length > 0 && processedEvent !== 'sent') {
      // Only update if new status is "better" than current
      const statusPriority: Record<string, number> = {
        pending: 0,
        failed: 1,
        sent: 2,
        delivered: 3,
        seen: 4,
        replied: 5,
      };

      const currentPriority = statusPriority[campaignLead.status] || 0;
      const newPriority = statusPriority[updateData.status] || 0;

      if (newPriority > currentPriority) {
        const { error: updateError } = await serviceClient
          .from('campaign_leads')
          .update(updateData)
          .eq('id', campaignLead.id);

        if (updateError) {
          console.error('Error updating campaign_lead:', updateError);
        } else {
          console.log(`Campaign lead ${campaignLead.id} updated to status: ${updateData.status}`);
        }
      }
    }

    // ============================================
    // LOG EVENT
    // ============================================
    await serviceClient.from('campaign_events').insert({
      campaign_id: campaign.id,
      campaign_lead_id: campaignLead.id,
      event_type: processedEvent,
      provider_message_id: providerId || messageId,
      metadata: {
        account_id: accountId,
        chat_id: chatId,
        timestamp: timestamp,
        raw_event: eventType,
      },
    });

    // ============================================
    // UPDATE CAMPAIGN COUNTERS
    // ============================================
    if (processedEvent === 'delivered' || processedEvent === 'seen' || processedEvent === 'replied') {
      // Fetch current counters and increment
      const { data: currentCampaign } = await serviceClient
        .from('campaigns')
        .select('delivered_count, seen_count, replied_count')
        .eq('id', campaign.id)
        .single();

      if (currentCampaign) {
        const updateData: Record<string, number> = {};
        
        if (processedEvent === 'delivered') {
          updateData.delivered_count = (currentCampaign.delivered_count || 0) + 1;
        } else if (processedEvent === 'seen') {
          updateData.seen_count = (currentCampaign.seen_count || 0) + 1;
        } else if (processedEvent === 'replied') {
          updateData.replied_count = (currentCampaign.replied_count || 0) + 1;
        }

        await serviceClient
          .from('campaigns')
          .update(updateData)
          .eq('id', campaign.id);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: true,
      event: processedEvent,
      campaign_lead_id: campaignLead.id,
      campaign_id: campaign.id,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const error = err as Error;
    console.error('Error in webhook-messages:', error);
    // Always return 200 for webhooks to prevent retries
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), { status: 200, headers: corsHeaders });
  }
});
