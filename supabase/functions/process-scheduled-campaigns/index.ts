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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const now = new Date().toISOString();
    console.log(`Processing scheduled campaigns at ${now}`);

    // ============================================
    // GET SCHEDULED CAMPAIGNS THAT ARE DUE
    // ============================================
    const { data: scheduledCampaigns, error: fetchError } = await supabase
      .from('campaigns')
      .select('id, name, workspace_id, type, schedule')
      .eq('status', 'scheduled')
      .lte('schedule', now);

    if (fetchError) {
      console.error('Error fetching scheduled campaigns:', fetchError);
      return new Response(JSON.stringify({ error: 'Failed to fetch scheduled campaigns' }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }

    if (!scheduledCampaigns || scheduledCampaigns.length === 0) {
      console.log('No scheduled campaigns due');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No campaigns to process',
        processedCount: 0 
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log(`Found ${scheduledCampaigns.length} scheduled campaigns to trigger`);

    const results: { campaignId: string; name: string; triggered: boolean; error?: string }[] = [];

    for (const campaign of scheduledCampaigns) {
      console.log(`Triggering campaign ${campaign.id}: ${campaign.name}`);

      try {
        // Call send-campaign function to process this campaign
        const sendResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-campaign`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ campaignId: campaign.id }),
          }
        );

        if (sendResponse.ok) {
          const result = await sendResponse.json();
          console.log(`Campaign ${campaign.id} triggered successfully:`, result);
          results.push({ 
            campaignId: campaign.id, 
            name: campaign.name, 
            triggered: true 
          });
        } else {
          const errorText = await sendResponse.text();
          console.error(`Failed to trigger campaign ${campaign.id}:`, errorText);
          
          // Mark campaign as failed if send failed
          await supabase
            .from('campaigns')
            .update({ status: 'failed' })
            .eq('id', campaign.id);

          results.push({ 
            campaignId: campaign.id, 
            name: campaign.name, 
            triggered: false,
            error: errorText
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error triggering campaign ${campaign.id}:`, errorMessage);
        
        // Mark campaign as failed
        await supabase
          .from('campaigns')
          .update({ status: 'failed' })
          .eq('id', campaign.id);

        results.push({ 
          campaignId: campaign.id, 
          name: campaign.name, 
          triggered: false,
          error: errorMessage
        });
      }
    }

    const successCount = results.filter(r => r.triggered).length;
    console.log(`Processed ${results.length} campaigns, ${successCount} triggered successfully`);

    return new Response(JSON.stringify({
      success: true,
      processedCount: results.length,
      successCount,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in process-scheduled-campaigns:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
});
