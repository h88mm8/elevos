import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Mail, Linkedin, MessageCircle, LucideIcon } from 'lucide-react';
import { ChannelMetrics } from '@/hooks/useCampaignPerformance';

interface ChannelPerformanceCardProps {
  channel: 'email' | 'linkedin' | 'whatsapp';
  metrics: ChannelMetrics;
  loading?: boolean;
}

const channelConfig: Record<string, { label: string; icon: LucideIcon; color: string; bgColor: string }> = {
  email: { 
    label: 'Email', 
    icon: Mail, 
    color: 'text-blue-600',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30'
  },
  linkedin: { 
    label: 'LinkedIn', 
    icon: Linkedin, 
    color: 'text-sky-600',
    bgColor: 'bg-sky-100 dark:bg-sky-900/30'
  },
  whatsapp: { 
    label: 'WhatsApp', 
    icon: MessageCircle, 
    color: 'text-green-600',
    bgColor: 'bg-green-100 dark:bg-green-900/30'
  },
};

function MetricRow({ label, value, total, rate }: { label: string; value: number; total: number; rate?: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {value.toLocaleString('pt-BR')}
          {rate !== undefined && (
            <span className="text-muted-foreground ml-1">({rate.toFixed(1)}%)</span>
          )}
        </span>
      </div>
      <Progress value={total > 0 ? (value / total) * 100 : 0} className="h-1.5" />
    </div>
  );
}

export function ChannelPerformanceCard({ channel, metrics, loading }: ChannelPerformanceCardProps) {
  const config = channelConfig[channel];
  const Icon = config.icon;

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-24" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.bgColor}`}>
              <Icon className={`h-5 w-5 ${config.color}`} />
            </div>
            <CardTitle className="text-lg">{config.label}</CardTitle>
          </div>
          <Badge variant="outline" className="font-normal">
            {metrics.totalCampaigns} campanha{metrics.totalCampaigns !== 1 ? 's' : ''}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {metrics.totalCampaigns === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Icon className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhuma campanha de {config.label}</p>
          </div>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-4 pb-3 border-b">
              <div>
                <p className="text-2xl font-bold">{metrics.totalLeads.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground">Total de Leads</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{metrics.sent.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground">Enviados</p>
              </div>
            </div>

            {/* Detailed Metrics */}
            <div className="space-y-3">
              <MetricRow 
                label="Entregues" 
                value={metrics.delivered} 
                total={metrics.sent}
                rate={metrics.deliveryRate}
              />
              <MetricRow 
                label="Visualizados" 
                value={metrics.seen} 
                total={metrics.sent}
                rate={metrics.openRate}
              />
              <MetricRow 
                label="Respondidos" 
                value={metrics.replied} 
                total={metrics.sent}
                rate={metrics.replyRate}
              />
              <MetricRow 
                label="Falhos" 
                value={metrics.failed} 
                total={metrics.sent}
                rate={metrics.failRate}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
