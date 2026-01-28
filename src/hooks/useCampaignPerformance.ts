import { useMemo } from 'react';
import { useCampaigns } from './useCampaigns';

export interface ChannelMetrics {
  totalCampaigns: number;
  totalLeads: number;
  sent: number;
  delivered: number;
  seen: number;
  replied: number;
  failed: number;
  // Calculated rates
  deliveryRate: number;
  openRate: number;
  replyRate: number;
  failRate: number;
}

export interface CampaignPerformance {
  email: ChannelMetrics;
  linkedin: ChannelMetrics;
  whatsapp: ChannelMetrics;
  totals: ChannelMetrics;
  isLoading: boolean;
}

const emptyMetrics: ChannelMetrics = {
  totalCampaigns: 0,
  totalLeads: 0,
  sent: 0,
  delivered: 0,
  seen: 0,
  replied: 0,
  failed: 0,
  deliveryRate: 0,
  openRate: 0,
  replyRate: 0,
  failRate: 0,
};

function calculateMetrics(campaigns: any[]): ChannelMetrics {
  const aggregated = campaigns.reduce(
    (acc, campaign) => ({
      totalCampaigns: acc.totalCampaigns + 1,
      totalLeads: acc.totalLeads + (campaign.leads_count || 0),
      sent: acc.sent + (campaign.sent_count || 0),
      delivered: acc.delivered + (campaign.delivered_count || 0),
      seen: acc.seen + (campaign.seen_count || 0),
      replied: acc.replied + (campaign.replied_count || 0),
      failed: acc.failed + (campaign.failed_count || 0),
    }),
    { totalCampaigns: 0, totalLeads: 0, sent: 0, delivered: 0, seen: 0, replied: 0, failed: 0 }
  );

  const sent = aggregated.sent || 1; // Avoid division by zero

  return {
    ...aggregated,
    deliveryRate: aggregated.sent > 0 ? (aggregated.delivered / sent) * 100 : 0,
    openRate: aggregated.sent > 0 ? (aggregated.seen / sent) * 100 : 0,
    replyRate: aggregated.sent > 0 ? (aggregated.replied / sent) * 100 : 0,
    failRate: aggregated.sent > 0 ? (aggregated.failed / sent) * 100 : 0,
  };
}

export function useCampaignPerformance(): CampaignPerformance {
  const { campaigns, isLoading } = useCampaigns();

  const performance = useMemo(() => {
    if (!campaigns || campaigns.length === 0) {
      return {
        email: { ...emptyMetrics },
        linkedin: { ...emptyMetrics },
        whatsapp: { ...emptyMetrics },
        totals: { ...emptyMetrics },
      };
    }

    const emailCampaigns = campaigns.filter((c) => c.type === 'email');
    const linkedinCampaigns = campaigns.filter((c) => c.type === 'linkedin');
    const whatsappCampaigns = campaigns.filter((c) => c.type === 'whatsapp');

    return {
      email: calculateMetrics(emailCampaigns),
      linkedin: calculateMetrics(linkedinCampaigns),
      whatsapp: calculateMetrics(whatsappCampaigns),
      totals: calculateMetrics(campaigns),
    };
  }, [campaigns]);

  return {
    ...performance,
    isLoading,
  };
}
