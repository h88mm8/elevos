import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface DailyUsagePoint {
  date: string;
  action: string;
  total_count: number;
}

export interface DailyUsageChartData {
  dates: string[];
  searchPages: number[];
  enrichments: number[];
  searchBlocked: number[];
  enrichBlocked: number[];
}

export function useUsageHistory(days: number = 7) {
  const { currentWorkspace } = useAuth();

  const { 
    data, 
    isLoading, 
    refetch 
  } = useQuery({
    queryKey: ["workspace-usage-history", currentWorkspace?.id, days],
    queryFn: async (): Promise<DailyUsageChartData> => {
      if (!currentWorkspace?.id) {
        return {
          dates: [],
          searchPages: [],
          enrichments: [],
          searchBlocked: [],
          enrichBlocked: [],
        };
      }
      
      const { data: rawData, error } = await supabase.rpc("get_workspace_usage_daily", {
        p_workspace_id: currentWorkspace.id,
        p_days: days,
      });
      
      if (error) throw error;
      
      // Process the flat data into series
      const points = (rawData || []) as DailyUsagePoint[];
      
      // Get unique dates in order
      const uniqueDates = [...new Set(points.map(p => p.date))].sort();
      
      // Build series data
      const searchPages: number[] = [];
      const enrichments: number[] = [];
      const searchBlocked: number[] = [];
      const enrichBlocked: number[] = [];
      
      for (const date of uniqueDates) {
        const dayPoints = points.filter(p => p.date === date);
        
        searchPages.push(
          dayPoints.find(p => p.action === 'linkedin_search_page')?.total_count || 0
        );
        enrichments.push(
          dayPoints.find(p => p.action === 'linkedin_enrich')?.total_count || 0
        );
        searchBlocked.push(
          dayPoints.find(p => p.action === 'linkedin_search_page_blocked')?.total_count || 0
        );
        enrichBlocked.push(
          dayPoints.find(p => p.action === 'linkedin_enrich_blocked')?.total_count || 0
        );
      }
      
      // Format dates for display
      const formattedDates = uniqueDates.map(d => {
        const date = new Date(d);
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
      });
      
      return {
        dates: formattedDates,
        searchPages,
        enrichments,
        searchBlocked,
        enrichBlocked,
      };
    },
    enabled: !!currentWorkspace?.id,
    refetchInterval: 60000, // Refresh every minute
  });

  const hasData = data && data.dates.length > 0 && (
    data.searchPages.some(v => v > 0) ||
    data.enrichments.some(v => v > 0) ||
    data.searchBlocked.some(v => v > 0) ||
    data.enrichBlocked.some(v => v > 0)
  );

  return {
    data,
    isLoading,
    hasData: !!hasData,
    refetch,
  };
}
