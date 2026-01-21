import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface DailyUsageItem {
  account_id: string;
  action: string;
  count: number;
}

export function useDailyUsage() {
  const { currentWorkspace } = useAuth();

  const query = useQuery({
    queryKey: ['daily-usage', currentWorkspace?.id],
    queryFn: async (): Promise<DailyUsageItem[]> => {
      if (!currentWorkspace) return [];
      
      const today = new Date().toISOString().split('T')[0];
      
      // Call the RPC function to get workspace daily usage
      const { data, error } = await supabase
        .rpc('get_workspace_daily_usage', {
          p_workspace_id: currentWorkspace.id,
          p_usage_date: today,
        });
      
      if (error) {
        console.error('Error fetching daily usage:', error);
        throw error;
      }
      
      return (data || []) as DailyUsageItem[];
    },
    enabled: !!currentWorkspace,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Aggregate usage by action type across all accounts
  const aggregateByAction = (action: string): number => {
    if (!query.data) return 0;
    return query.data
      .filter((item) => item.action === action)
      .reduce((sum, item) => sum + item.count, 0);
  };

  // Get usage for a specific account and action
  const getAccountUsage = (accountId: string, action: string): number => {
    if (!query.data) return 0;
    const item = query.data.find(
      (i) => i.account_id === accountId && i.action === action
    );
    return item?.count || 0;
  };

  return {
    usageData: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    // Convenience methods
    linkedinMessagesToday: aggregateByAction('linkedin_message'),
    linkedinInvitesToday: aggregateByAction('linkedin_invite'),
    whatsappMessagesToday: aggregateByAction('whatsapp_message'),
    getAccountUsage,
    aggregateByAction,
  };
}
