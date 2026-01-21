import { useState, useMemo } from 'react';
import { useCampaignReport, CampaignLeadDetail } from '@/hooks/useCampaignReport';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Send,
  CheckCheck,
  Eye,
  MessageCircle,
  XCircle,
  Clock,
  RefreshCw,
  Download,
  Filter,
  FileText,
} from 'lucide-react';
import { format, formatDistanceToNow, parseISO, startOfHour } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { exportCampaignReportPDF } from '@/lib/pdfExport';

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

const allStatuses = ['all', 'pending', 'sent', 'delivered', 'seen', 'replied', 'failed'];

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
  const [statusFilter, setStatusFilter] = useState('all');

  // Filter leads by status
  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    if (statusFilter === 'all') return leads;
    return leads.filter(lead => lead.status === statusFilter);
  }, [leads, statusFilter]);

  // Calculate time metrics
  const timeMetrics = useMemo(() => {
    if (!leads || leads.length === 0) return null;

    const timesToSeen: number[] = [];
    const timesToReply: number[] = [];

    leads.forEach(lead => {
      if (lead.sent_at && lead.seen_at) {
        const sentTime = new Date(lead.sent_at).getTime();
        const seenTime = new Date(lead.seen_at).getTime();
        timesToSeen.push(seenTime - sentTime);
      }
      if (lead.sent_at && lead.replied_at) {
        const sentTime = new Date(lead.sent_at).getTime();
        const repliedTime = new Date(lead.replied_at).getTime();
        timesToReply.push(repliedTime - sentTime);
      }
    });

    const avgTimeToSeen = timesToSeen.length > 0 
      ? timesToSeen.reduce((a, b) => a + b, 0) / timesToSeen.length 
      : null;
    const avgTimeToReply = timesToReply.length > 0 
      ? timesToReply.reduce((a, b) => a + b, 0) / timesToReply.length 
      : null;

    return {
      avgTimeToSeen,
      avgTimeToReply,
      seenCount: timesToSeen.length,
      replyCount: timesToReply.length,
    };
  }, [leads]);

  // Format milliseconds to human readable string
  function formatDuration(ms: number | null): string {
    if (ms === null) return '-';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }

  // Generate timeline chart data from events
  const chartData = useMemo(() => {
    if (!events || events.length === 0) return [];

    // Group events by hour
    const hourlyData: Record<string, { time: string; sent: number; delivered: number; seen: number; replied: number }> = {};

    events.forEach(event => {
      const hourKey = format(startOfHour(parseISO(event.created_at)), 'dd/MM HH:mm');
      
      if (!hourlyData[hourKey]) {
        hourlyData[hourKey] = { time: hourKey, sent: 0, delivered: 0, seen: 0, replied: 0 };
      }

      if (event.event_type === 'sent') hourlyData[hourKey].sent++;
      if (event.event_type === 'delivered') hourlyData[hourKey].delivered++;
      if (event.event_type === 'seen') hourlyData[hourKey].seen++;
      if (event.event_type === 'replied') hourlyData[hourKey].replied++;
    });

    // Sort by time and return as array
    return Object.values(hourlyData).sort((a, b) => {
      const [dayA, monthA, hourA] = a.time.split(/[\/\s:]/);
      const [dayB, monthB, hourB] = b.time.split(/[\/\s:]/);
      return `${monthA}${dayA}${hourA}`.localeCompare(`${monthB}${dayB}${hourB}`);
    });
  }, [events]);

  // Export leads to CSV
  function exportToCSV() {
    if (!leads || leads.length === 0) return;

    const headers = [
      'Nome',
      'Email',
      'Telefone',
      'Empresa',
      'Cargo',
      'Status',
      'Enviado em',
      'Entregue em',
      'Visualizado em',
      'Respondido em',
      'Erro',
    ];

    const rows = leads.map(lead => [
      lead.lead?.full_name || lead.lead?.first_name || '',
      lead.lead?.email || '',
      lead.lead?.mobile_number || '',
      lead.lead?.company || '',
      lead.lead?.job_title || '',
      statusConfig[lead.status]?.label || lead.status,
      lead.sent_at ? format(new Date(lead.sent_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '',
      lead.delivered_at ? format(new Date(lead.delivered_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '',
      lead.seen_at ? format(new Date(lead.seen_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '',
      lead.replied_at ? format(new Date(lead.replied_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '',
      lead.error || '',
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-campanha-${campaignName || campaignId}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

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
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => campaign && leads && exportCampaignReportPDF({ campaign, leads })} 
                disabled={!campaign || !leads?.length}
              >
                <FileText className="h-4 w-4 mr-1" />
                PDF
              </Button>
              <Button variant="outline" size="sm" onClick={exportToCSV} disabled={!leads?.length}>
                <Download className="h-4 w-4 mr-1" />
                CSV
              </Button>
              <Button variant="ghost" size="icon" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="flex-shrink-0">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="leads">Leads ({filteredLeads?.length || 0})</TabsTrigger>
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

                  {/* Time Metrics */}
                  {timeMetrics && (timeMetrics.avgTimeToSeen !== null || timeMetrics.avgTimeToReply !== null) && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Métricas de Tempo</CardTitle>
                        <CardDescription>Tempo médio de resposta e visualização</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950/20">
                            <div className="flex items-center gap-2 mb-2">
                              <Eye className="h-4 w-4 text-purple-600" />
                              <span className="text-sm font-medium">Tempo até visualização</span>
                            </div>
                            <p className="text-2xl font-bold text-purple-600">
                              {formatDuration(timeMetrics.avgTimeToSeen)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Baseado em {timeMetrics.seenCount} visualizações
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/20">
                            <div className="flex items-center gap-2 mb-2">
                              <MessageCircle className="h-4 w-4 text-emerald-600" />
                              <span className="text-sm font-medium">Tempo até resposta</span>
                            </div>
                            <p className="text-2xl font-bold text-emerald-600">
                              {formatDuration(timeMetrics.avgTimeToReply)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Baseado em {timeMetrics.replyCount} respostas
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

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

                  {/* Timeline Chart */}
                  {chartData.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Evolução ao Longo do Tempo</CardTitle>
                        <CardDescription>Eventos agrupados por hora</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={250}>
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis 
                              dataKey="time" 
                              tick={{ fontSize: 11 }} 
                              className="text-muted-foreground"
                            />
                            <YAxis 
                              tick={{ fontSize: 11 }} 
                              className="text-muted-foreground"
                            />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--background))', 
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                              }}
                            />
                            <Legend />
                            <Line 
                              type="monotone" 
                              dataKey="sent" 
                              name="Enviados"
                              stroke="#3b82f6" 
                              strokeWidth={2}
                              dot={{ r: 3 }}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="delivered" 
                              name="Entregues"
                              stroke="#22c55e" 
                              strokeWidth={2}
                              dot={{ r: 3 }}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="seen" 
                              name="Visualizados"
                              stroke="#a855f7" 
                              strokeWidth={2}
                              dot={{ r: 3 }}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="replied" 
                              name="Respondidos"
                              stroke="#10b981" 
                              strokeWidth={2}
                              dot={{ r: 3 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

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
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  Campanha não encontrada
                </div>
              )}
            </TabsContent>

            <TabsContent value="leads" className="h-full overflow-hidden mt-0 flex flex-col">
              {/* Status filter */}
              <div className="flex items-center gap-2 mb-4 flex-shrink-0">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filtrar por status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os status</SelectItem>
                    {allStatuses.filter(s => s !== 'all').map(status => {
                      const config = statusConfig[status];
                      return (
                        <SelectItem key={status} value={status}>
                          <div className="flex items-center gap-2">
                            <config.icon className={`h-3.5 w-3.5 ${config.color}`} />
                            {config.label}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">
                  {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''}
                </span>
              </div>

              <ScrollArea className="flex-1">
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
                    {filteredLeads.map((lead) => {
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
                    {filteredLeads.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {statusFilter !== 'all' 
                            ? `Nenhum lead com status "${statusConfig[statusFilter]?.label || statusFilter}"`
                            : 'Nenhum lead encontrado'
                          }
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
