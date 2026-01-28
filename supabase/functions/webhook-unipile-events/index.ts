/**
 * Webhook for Unipile Events (Messages, Invites, etc.)
 * 
 * Receives events from Unipile about:
 * - Messages: sent, delivered, seen, replied
 * - Invites: sent, accepted, withdrawn
 * 
 * Features:
 * - Idempotent processing via event_id unique constraint
 * - Best-effort matching to campaign_leads
 * - Raw payload storage for audit/debugging
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature, x-signature',
};

// Map Unipile event types to internal status
const MESSAGE_STATUS_MAP: Record<string, { field: string; status: string }> = {
  // Message events (Unipile formats)
  'message.sent': { field: 'sent_at', status: 'sent' },
  'message.delivered': { field: 'delivered_at', status: 'sent' },
  'message.seen': { field: 'seen_at', status: 'sent' },
  'message.read': { field: 'seen_at', status: 'sent' },
  'message.replied': { field: 'replied_at', status: 'sent' },
  'message.failed': { field: 'error', status: 'failed' },
  'message.reaction': { field: 'seen_at', status: 'sent' }, // Reaction implies seen
  
  // Chat events (alternative format from Unipile dashboard)
  'chat.new_message': { field: 'sent_at', status: 'sent' },
  'chat.message_sent': { field: 'sent_at', status: 'sent' },
  'chat.message_delivered': { field: 'delivered_at', status: 'sent' },
  'chat.message_read': { field: 'seen_at', status: 'sent' },
  'chat.message_replied': { field: 'replied_at', status: 'sent' },
  'chat.message_reaction': { field: 'seen_at', status: 'sent' },
  
  // Invite events
  'invitation.sent': { field: 'sent_at', status: 'sent' },
  'invitation.accepted': { field: 'accepted_at', status: 'sent' },
  'invitation.withdrawn': { field: 'error', status: 'failed' },
  'invitation.failed': { field: 'error', status: 'failed' },
  
  // Connection/relation events (on new relation = accepted invitation)
  'relation.new': { field: 'accepted_at', status: 'sent' },
  'connection.new': { field: 'accepted_at', status: 'sent' },
  'connection.accepted': { field: 'accepted_at', status: 'sent' },
  'connection.rejected': { field: 'error', status: 'failed' },
};

// Events that use fallback matching by provider_id (invite events without message_id)
const INVITE_EVENT_TYPES = [
  'relation.new',
  'connection.new',
  'connection.accepted',
  'invitation.accepted',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  try {
    // ============================================
    // WEBHOOK SIGNATURE VALIDATION
    // ============================================
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
    if (webhookSecret) {
      const signature = req.headers.get('x-webhook-signature') || req.headers.get('x-signature');
      if (signature) {
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
          console.error(`[${correlationId}] Webhook rejected: invalid signature`);
          return new Response(JSON.stringify({ error: 'Invalid signature' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // ============================================
    // PARSE WEBHOOK PAYLOAD
    // ============================================
    const payload = await req.json();
    console.log(`[${correlationId}] Webhook received:`, JSON.stringify(payload).substring(0, 1000));

    // ============================================
    // SERVICE CLIENT
    // ============================================
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ============================================
    // EXTRACT EVENT DATA
    // ============================================
    // Unipile webhook format varies, try multiple paths
    const eventData = payload.data || payload.object || payload;
    const eventType = 
      payload.event || 
      payload.type || 
      eventData.event || 
      eventData.type ||
      'unknown';
    
    // Generate event_id for idempotency
    const eventId = 
      payload.id ||
      payload.event_id ||
      eventData.id ||
      eventData.message_id ||
      eventData.invitation_id ||
      `${correlationId}`;
    
    // Extract identifiers for matching
    const accountId = 
      eventData.account_id || 
      payload.account_id;
    
    const messageId = 
      eventData.message_id || 
      eventData.id ||
      payload.message_id;
    
    const providerId = 
      eventData.provider_id ||
      eventData.user_id ||
      eventData.attendee_id ||
      eventData.recipient_id ||
      eventData.profile_id ||
      eventData.member_id ||
      eventData.sender_id ||
      payload.provider_id ||
      payload.user_id;
    
    const objectType = 
      eventData.object_type ||
      (eventType.includes('message') ? 'message' : 
       eventType.includes('invitation') || eventType.includes('connection') ? 'invitation' : 
       'unknown');

    console.log(`[${correlationId}] Event parsed: type=${eventType}, eventId=${eventId}, accountId=${accountId}, messageId=${messageId}`);

    // ============================================
    // FIND WORKSPACE FROM ACCOUNT
    // ============================================
    let workspaceId: string | null = null;
    
    if (accountId) {
      const { data: accountData } = await serviceClient
        .from('accounts')
        .select('workspace_id')
        .eq('account_id', accountId)
        .maybeSingle();
      
      if (accountData) {
        workspaceId = accountData.workspace_id;
        console.log(`[${correlationId}] Found workspace ${workspaceId} for account ${accountId}`);
      }
    }

    // ============================================
    // INSERT EVENT (idempotent via unique constraint)
    // ============================================
    const eventRecord = {
      event_id: eventId,
      provider: 'unipile',
      account_id: accountId || null,
      event_type: eventType,
      object_type: objectType,
      object_id: messageId || null,
      workspace_id: workspaceId,
      payload: payload,
      matched: false,
    };

    const { data: insertedEvent, error: insertError } = await serviceClient
      .from('unipile_events')
      .upsert(eventRecord, {
        onConflict: 'event_id',
        ignoreDuplicates: true,
      })
      .select('id, event_id')
      .maybeSingle();

    if (insertError) {
      // Check if it's a duplicate (expected for idempotency)
      if (insertError.code === '23505') {
        console.log(`[${correlationId}] Duplicate event ignored: ${eventId}`);
        return new Response(JSON.stringify({
          success: true,
          message: 'Duplicate event ignored',
          event_id: eventId,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error(`[${correlationId}] Error inserting event:`, insertError);
    } else {
      console.log(`[${correlationId}] Event stored: ${insertedEvent?.id}`);
    }

    // ============================================
    // TRY TO MATCH TO CAMPAIGN_LEAD
    // ============================================
    let matchedLeadId: string | null = null;
    const statusMapping = MESSAGE_STATUS_MAP[eventType];

    if (statusMapping && messageId) {
      // Try to find campaign_lead by provider_message_id
      const { data: campaignLead } = await serviceClient
        .from('campaign_leads')
        .select('id, campaign_id, lead_id, status')
        .eq('provider_message_id', messageId)
        .maybeSingle();

      if (campaignLead) {
        matchedLeadId = campaignLead.id;
        console.log(`[${correlationId}] Matched to campaign_lead: ${matchedLeadId}`);

        // Build update object
        const updateData: Record<string, unknown> = {};
        const timestamp = new Date().toISOString();

        if (statusMapping.field === 'error') {
          updateData.status = 'failed';
          updateData.error = eventData.error || eventData.message || eventType;
        } else {
          updateData.status = statusMapping.status;
          updateData[statusMapping.field] = timestamp;
          
          // Clear error on success
          if (statusMapping.status === 'sent') {
            updateData.error = null;
          }
        }

        // Update campaign_lead
        const { error: updateError } = await serviceClient
          .from('campaign_leads')
          .update(updateData)
          .eq('id', matchedLeadId);

        if (updateError) {
          console.error(`[${correlationId}] Error updating campaign_lead:`, updateError);
        } else {
          console.log(`[${correlationId}] Updated campaign_lead ${matchedLeadId}:`, updateData);

          // Update event as matched
          await serviceClient
            .from('unipile_events')
            .update({
              campaign_lead_id: matchedLeadId,
              lead_id: campaignLead.lead_id,
              matched: true,
              processed_at: timestamp,
            })
            .eq('event_id', eventId);

          // Insert campaign_event for tracking
          await serviceClient
            .from('campaign_events')
            .insert({
              campaign_id: campaignLead.campaign_id,
              campaign_lead_id: matchedLeadId,
              event_type: eventType,
              provider_message_id: messageId,
              metadata: {
                correlation_id: correlationId,
                unipile_event_id: eventId,
              },
            });
        }
      } else {
        console.log(`[${correlationId}] No campaign_lead matched for message_id: ${messageId}`);
      }
    }

    // ============================================
    // FALLBACK: MATCH BY PROVIDER_ID FOR INVITES
    // ============================================
    const isInviteEvent = INVITE_EVENT_TYPES.includes(eventType);

    if (!matchedLeadId && isInviteEvent && providerId) {
      console.log(`[${correlationId}] Fallback invite match: provider_id=${providerId}`);
      
      // 1) Lead lookup (safe on duplicates)
      let leadQuery = serviceClient
        .from('leads')
        .select('id, workspace_id')
        .eq('linkedin_provider_id', providerId);
      
      if (workspaceId) leadQuery = leadQuery.eq('workspace_id', workspaceId);
      
      const { data: leadResults, error: leadError } = await leadQuery.limit(5);
      
      if (leadError) console.error(`[${correlationId}] lead lookup error`, leadError);
      
      if (leadResults && leadResults.length > 0) {
        if (leadResults.length > 1) {
          console.warn(`[${correlationId}] WARNING: ${leadResults.length} leads found for provider_id=${providerId}. Using first.`);
        }
        
        const leadData = leadResults[0];
        
        // 2) pendingCount ONLY for invite campaigns
        const { count: pendingCount, error: pendingErr } = await serviceClient
          .from('campaign_leads')
          .select('id, campaigns!inner(linkedin_action)', { count: 'exact', head: true })
          .eq('lead_id', leadData.id)
          .eq('status', 'sent')
          .is('accepted_at', null)
          .eq('campaigns.linkedin_action', 'invite');
        
        if (pendingErr) console.error(`[${correlationId}] pendingCount error`, pendingErr);
        
        if (pendingCount && pendingCount > 1) {
          console.warn(`[${correlationId}] WARNING: ${pendingCount} pending INVITE campaign_leads for lead=${leadData.id}. Using most recent.`);
        }
        
        // 3) Find most recent invite campaign_lead
        const { data: inviteLead, error: inviteError } = await serviceClient
          .from('campaign_leads')
          .select(`
            id,
            campaign_id,
            lead_id,
            status,
            provider_message_id,
            campaigns!inner(linkedin_action)
          `)
          .eq('lead_id', leadData.id)
          .eq('status', 'sent')
          .is('accepted_at', null)
          .eq('campaigns.linkedin_action', 'invite')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (inviteError) {
          console.error(`[${correlationId}] inviteLead lookup error`, inviteError);
        } else if (inviteLead) {
          matchedLeadId = inviteLead.id;
          const timestamp = new Date().toISOString();
          
          // 4) Idempotent accepted_at update
          const { data: updatedRows, error: updateError } = await serviceClient
            .from('campaign_leads')
            .update({ accepted_at: timestamp })
            .eq('id', matchedLeadId)
            .is('accepted_at', null)
            .select('id');
          
          if (updateError) {
            console.error(`[${correlationId}] accepted_at update error`, updateError);
          }
          
          const updated = (updatedRows?.length ?? 0);
          if (updated === 0) {
            console.log(`[${correlationId}] Idempotent skip: campaign_lead=${matchedLeadId} already had accepted_at`);
          } else {
            console.log(`[${correlationId}] accepted_at set for campaign_lead=${matchedLeadId}`);
          }
          
          // 5) ALWAYS mark event as matched
          await serviceClient
            .from('unipile_events')
            .update({
              campaign_lead_id: matchedLeadId,
              lead_id: leadData.id,
              workspace_id: leadData.workspace_id,
              matched: true,
              processed_at: timestamp,
            })
            .eq('event_id', eventId);
          
          // 6) ALWAYS insert campaign_event
          await serviceClient
            .from('campaign_events')
            .insert({
              campaign_id: inviteLead.campaign_id,
              campaign_lead_id: matchedLeadId,
              event_type: eventType,
              provider_message_id: inviteLead.provider_message_id || null,
              metadata: {
                correlation_id: correlationId,
                unipile_event_id: eventId,
                match_method: 'fallback_provider_id',
                provider_id: providerId,
              },
            });
        } else {
          console.log(`[${correlationId}] No pending INVITE campaign_lead found for lead=${leadData.id}`);
        }
      } else {
        console.log(`[${correlationId}] No lead found for provider_id=${providerId}${workspaceId ? ` workspace=${workspaceId}` : ''}`);
      }
    }

    // ============================================
    // RESPONSE
    // ============================================
    return new Response(JSON.stringify({
      success: true,
      correlation_id: correlationId,
      event_id: eventId,
      event_type: eventType,
      matched: !!matchedLeadId,
      campaign_lead_id: matchedLeadId,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const error = err as Error;
    console.error(`[${correlationId}] Webhook error:`, error);
    
    // Always return 200 for webhooks to prevent retries
    return new Response(JSON.stringify({
      success: false,
      correlation_id: correlationId,
      error: error.message,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
