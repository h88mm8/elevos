import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Campaign } from '@/types';
import { useMemo } from 'react';

export function useCampaigns() {
  const { currentWorkspace } = useAuth();
  const queryClient = useQueryClient();

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace) return [];
      // Use view that aggregates stats from campaign_leads current state
      const { data, error } = await supabase
        .from('campaigns_with_stats')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as (Campaign & {
        actual_leads_count: number;
        actual_sent_count: number;
        actual_failed_count: number;
        actual_pending_count: number;
      })[];
    },
    enabled: !!currentWorkspace,
  });

  // Auto-refetch every 5 seconds if there are campaigns in 'sending' or 'queued' status
  const hasActiveCampaigns = useMemo(() => {
    return campaignsQuery.data?.some(c => c.status === 'sending' || c.status === 'queued') ?? false;
  }, [campaignsQuery.data]);

  // Separate query for polling active campaigns
  useQuery({
    queryKey: ['campaigns-polling', currentWorkspace?.id],
    queryFn: async () => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns', currentWorkspace?.id] });
      return null;
    },
    enabled: !!currentWorkspace && hasActiveCampaigns,
    refetchInterval: hasActiveCampaigns ? 5000 : false,
    refetchIntervalInBackground: false,
  });

  const createCampaignMutation = useMutation({
    mutationFn: async (campaign: Omit<Campaign, 'id' | 'created_at' | 'updated_at' | 'sent_count' | 'failed_count'>) => {
      const { data, error } = await supabase
        .from('campaigns')
        .insert(campaign)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', currentWorkspace?.id] });
    },
  });

  const updateCampaignMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Campaign> & { id: string }) => {
      const { data, error } = await supabase
        .from('campaigns')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', currentWorkspace?.id] });
    },
  });

  return {
    campaigns: campaignsQuery.data ?? [],
    isLoading: campaignsQuery.isLoading,
    isError: campaignsQuery.isError,
    createCampaign: createCampaignMutation.mutateAsync,
    updateCampaign: updateCampaignMutation.mutateAsync,
    refetchCampaigns: () => queryClient.invalidateQueries({ queryKey: ['campaigns', currentWorkspace?.id] }),
  };
}

// Extended type with aggregated stats from view
export type CampaignWithStats = Campaign & {
  actual_leads_count: number;
  actual_sent_count: number;
  actual_failed_count: number;
  actual_pending_count: number;
};
