import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface CampaignReportMetrics {
  id: string;
  name: string;
  type: string;
  status: string;
  leads_count: number;
  sent_count: number;
  failed_count: number;
  delivered_count: number;
  seen_count: number;
  replied_count: number;
  created_at: string;
  // Calculated rates
  delivery_rate: number;
  open_rate: number;
  reply_rate: number;
}

export interface CampaignLeadDetail {
  id: string;
  lead_id: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  seen_at: string | null;
  replied_at: string | null;
  error: string | null;
  lead: {
    full_name: string | null;
    first_name: string | null;
    email: string | null;
    mobile_number: string | null;
    company: string | null;
    job_title: string | null;
  } | null;
}

export interface CampaignEvent {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, any> | null;
}

export function useCampaignReport(campaignId: string | null) {
  const { currentWorkspace } = useAuth();

  // Fetch campaign metrics
  const {
    data: campaign,
    isLoading: isLoadingCampaign,
    refetch: refetchCampaign,
  } = useQuery({
    queryKey: ['campaign-report', campaignId],
    queryFn: async (): Promise<CampaignReportMetrics | null> => {
      if (!campaignId || !currentWorkspace) return null;

      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .eq('workspace_id', currentWorkspace.id)
        .single();

      if (error) throw error;
      if (!data) return null;

      // Calculate rates
      const sentSuccessfully = data.sent_count || 0;
      const delivered = data.delivered_count || 0;
      const seen = data.seen_count || 0;
      const replied = data.replied_count || 0;

      return {
        ...data,
        delivery_rate: sentSuccessfully > 0 ? (delivered / sentSuccessfully) * 100 : 0,
        open_rate: sentSuccessfully > 0 ? (seen / sentSuccessfully) * 100 : 0,
        reply_rate: sentSuccessfully > 0 ? (replied / sentSuccessfully) * 100 : 0,
      };
    },
    enabled: !!campaignId && !!currentWorkspace,
    refetchInterval: 30000, // Refetch every 30s for live updates
  });

  // Fetch campaign leads with details
  const {
    data: leads,
    isLoading: isLoadingLeads,
    refetch: refetchLeads,
  } = useQuery({
    queryKey: ['campaign-leads-report', campaignId],
    queryFn: async (): Promise<CampaignLeadDetail[]> => {
      if (!campaignId) return [];

      const { data, error } = await supabase
        .from('campaign_leads')
        .select(`
          id,
          lead_id,
          status,
          sent_at,
          delivered_at,
          seen_at,
          replied_at,
          error,
          lead:leads (
            full_name,
            first_name,
            email,
            mobile_number,
            company,
            job_title
          )
        `)
        .eq('campaign_id', campaignId)
        .order('sent_at', { ascending: false });

      if (error) throw error;
      
      // Type cast the nested lead object
      return (data || []).map(item => ({
        ...item,
        lead: Array.isArray(item.lead) ? item.lead[0] : item.lead,
      })) as CampaignLeadDetail[];
    },
    enabled: !!campaignId,
    refetchInterval: 30000,
  });

  // Fetch recent events
  const {
    data: events,
    isLoading: isLoadingEvents,
  } = useQuery({
    queryKey: ['campaign-events', campaignId],
    queryFn: async (): Promise<CampaignEvent[]> => {
      if (!campaignId) return [];

      const { data, error } = await supabase
        .from('campaign_events')
        .select('id, event_type, created_at, metadata')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      
      // Handle metadata type properly
      return (data || []).map(event => ({
        ...event,
        metadata: event.metadata as Record<string, any> | null,
      }));
    },
    enabled: !!campaignId,
    refetchInterval: 30000,
  });

  // Status distribution for charts
  const statusDistribution = leads?.reduce((acc, lead) => {
    acc[lead.status] = (acc[lead.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return {
    campaign,
    leads,
    events,
    statusDistribution,
    isLoading: isLoadingCampaign || isLoadingLeads,
    isLoadingEvents,
    refetch: () => {
      refetchCampaign();
      refetchLeads();
    },
  };
}
