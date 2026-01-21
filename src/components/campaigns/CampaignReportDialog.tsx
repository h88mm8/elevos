import { useState } from 'react';
import { useCampaignReport } from '@/hooks/useCampaignReport';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Send,
  CheckCheck,
  Eye,
  MessageCircle,
  XCircle,
  Clock,
  TrendingUp,
  Users,
  RefreshCw,
  Info,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface CampaignReportDialogProps {
  campaignId: string | null;
  campaignName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusConfig: Record<string, { 
  label: string; 
  icon: React.ElementType; 
  color: string;
  bgColor: string;
}> = {
  pending: { label: 'Pendente', icon: Clock, color: 'text-muted-foreground', bgColor: 'bg-muted' },
  sent: { label: 'Enviado', icon: Send, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  delivered: { label: 'Entregue', icon: CheckCheck, color: 'text-green-600', bgColor: 'bg-green-100' },
  seen: { label: 'Visualizado', icon: Eye, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  replied: { label: 'Respondido', icon: MessageCircle, color: 'text-emerald-600', bgColor: 'bg-emerald-100' },
  failed: { label: 'Falhou', icon: XCircle, color: 'text-destructive', bgColor: 'bg-destructive/10' },
};

export function CampaignReportDialog({
  campaignId,
  campaignName,
  open,
  onOpenChange,
}: CampaignReportDialogProps) {
  const { campaign, leads, events, statusDistribution, isLoading, refetch } = useCampaignReport(
    open ? campaignId : null
  );

  const [activeTab, setActiveTab] = useState('overview');

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl">
                Relatório: {campaignName || campaign?.name || 'Campanha'}
              </DialogTitle>
              <DialogDescription>
                Métricas de entrega, visualização e resposta
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="flex-shrink-0">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="leads">Leads ({leads?.length || 0})</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-hidden mt-4">
            <TabsContent value="overview" className="h-full overflow-auto mt-0">
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-48 w-full" />
                </div>
              ) : campaign ? (
                <div className="space-y-6">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <MetricCard
                      title="Enviados"
                      value={campaign.sent_count}
                      total={campaign.leads_count}
                      icon={Send}
                      color="text-blue-600"
                    />
                    <MetricCard
                      title="Entregues"
                      value={campaign.delivered_count}
                      rate={campaign.delivery_rate}
                      icon={CheckCheck}
                      color="text-green-600"
                    />
                    <MetricCard
                      title="Visualizados"
                      value={campaign.seen_count}
                      rate={campaign.open_rate}
                      icon={Eye}
                      color="text-purple-600"
                    />
                    <MetricCard
                      title="Respondidos"
                      value={campaign.replied_count}
                      rate={campaign.reply_rate}
                      icon={MessageCircle}
                      color="text-emerald-600"
                      highlight
                    />
                  </div>

                  {/* Funnel visualization */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Funil de Conversão</CardTitle>
                      <CardDescription>Taxa de progressão em cada etapa</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <FunnelBar 
                        label="Enviados" 
                        value={campaign.sent_count} 
                        max={campaign.leads_count} 
                        color="bg-blue-500"
                      />
                      <FunnelBar 
                        label="Entregues" 
                        value={campaign.delivered_count} 
                        max={campaign.sent_count || 1} 
                        color="bg-green-500"
                      />
                      <FunnelBar 
                        label="Visualizados" 
                        value={campaign.seen_count} 
                        max={campaign.delivered_count || 1} 
                        color="bg-purple-500"
                      />
                      <FunnelBar 
                        label="Respondidos" 
                        value={campaign.replied_count} 
                        max={campaign.seen_count || 1} 
                        color="bg-emerald-500"
                      />
                    </CardContent>
                  </Card>

                  {/* Status distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Distribuição de Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-3">
                        {Object.entries(statusDistribution).map(([status, count]) => {
                          const config = statusConfig[status] || statusConfig.pending;
                          const Icon = config.icon;
                          return (
                            <div
                              key={status}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg ${config.bgColor}`}
                            >
                              <Icon className={`h-4 w-4 ${config.color}`} />
                              <span className="text-sm font-medium">{config.label}</span>
                              <Badge variant="secondary" className="text-xs">
                                {count}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Best practices alert */}
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      <strong>Dica:</strong> Uma taxa de resposta acima de 5% é considerada boa para campanhas de WhatsApp.
                      Mensagens personalizadas com perguntas diretas tendem a gerar mais engajamento.
                    </AlertDescription>
                  </Alert>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  Campanha não encontrada
                </div>
              )}
            </TabsContent>

            <TabsContent value="leads" className="h-full overflow-hidden mt-0">
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lead</TableHead>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Enviado em</TableHead>
                      <TableHead>Último evento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads?.map((lead) => {
                      const config = statusConfig[lead.status] || statusConfig.pending;
                      const Icon = config.icon;
                      const lastEvent = lead.replied_at || lead.seen_at || lead.delivered_at || lead.sent_at;
                      
                      return (
                        <TableRow key={lead.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">
                                {lead.lead?.full_name || lead.lead?.first_name || 'Sem nome'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {lead.lead?.mobile_number || lead.lead?.email}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {lead.lead?.company || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                              <span className="text-sm">{config.label}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {lead.sent_at 
                              ? format(new Date(lead.sent_at), 'dd/MM HH:mm', { locale: ptBR })
                              : '-'
                            }
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {lastEvent 
                              ? formatDistanceToNow(new Date(lastEvent), { 
                                  addSuffix: true, 
                                  locale: ptBR 
                                })
                              : '-'
                            }
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(!leads || leads.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Nenhum lead encontrado
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="timeline" className="h-full overflow-hidden mt-0">
              <ScrollArea className="h-[500px]">
                <div className="space-y-3 pr-4">
                  {events?.map((event) => {
                    const config = statusConfig[event.event_type] || statusConfig.pending;
                    const Icon = config.icon;
                    
                    return (
                      <div 
                        key={event.id} 
                        className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                      >
                        <div className={`p-2 rounded-full ${config.bgColor}`}>
                          <Icon className={`h-4 w-4 ${config.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">
                            Mensagem {config.label.toLowerCase()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(event.created_at), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {(!events || events.length === 0) && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Nenhum evento registrado ainda</p>
                      <p className="text-xs mt-1">
                        Eventos serão exibidos conforme as mensagens forem entregues e lidas
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Metric card component
function MetricCard({
  title,
  value,
  total,
  rate,
  icon: Icon,
  color,
  highlight,
}: {
  title: string;
  value: number;
  total?: number;
  rate?: number;
  icon: React.ElementType;
  color: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-emerald-500/50 bg-emerald-500/5' : ''}>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <Icon className={`h-5 w-5 ${color}`} />
          {rate !== undefined && (
            <Badge variant="secondary" className="text-xs">
              {rate.toFixed(1)}%
            </Badge>
          )}
        </div>
        <div className="mt-2">
          <p className="text-2xl font-bold">{value}</p>
          {total !== undefined && (
            <p className="text-xs text-muted-foreground">de {total} leads</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// Funnel bar component
function FunnelBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {value} ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}
