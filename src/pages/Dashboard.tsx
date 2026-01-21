import { useAuth } from '@/contexts/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import { useLeads } from '@/hooks/useLeads';
import { useCampaigns } from '@/hooks/useCampaigns';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Phone, Send, MessageSquare, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function StatCard({ 
  title, 
  value, 
  description, 
  icon: Icon, 
  loading 
}: { 
  title: string; 
  value: string | number; 
  description?: string; 
  icon: React.ElementType;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Rascunho', variant: 'secondary' },
  scheduled: { label: 'Agendada', variant: 'outline' },
  sending: { label: 'Enviando', variant: 'default' },
  running: { label: 'Enviando', variant: 'default' },
  paused: { label: 'Pausada', variant: 'secondary' },
  completed: { label: 'Concluída', variant: 'default' },
  queued: { label: 'Na fila', variant: 'outline' },
  failed: { label: 'Falhou', variant: 'destructive' },
};

const typeLabels: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
};

export default function Dashboard() {
  const { currentWorkspace } = useAuth();
  const { credits, isLoading: creditsLoading } = useCredits();
  const { leads, isLoading: leadsLoading } = useLeads();
  const { campaigns, isLoading: campaignsLoading } = useCampaigns();

  const activeCampaigns = campaigns.filter(c => c.status === 'sending' || c.status === 'running' || c.status === 'scheduled' || c.status === 'queued');
  const recentCampaigns = campaigns.slice(0, 5);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Bem-vindo ao {currentWorkspace?.name}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Créditos de Leads"
            value={credits?.leads_credits ?? 0}
            description="disponíveis para busca"
            icon={Users}
            loading={creditsLoading}
          />
          <StatCard
            title="Créditos de Telefone"
            value={credits?.phone_credits ?? 0}
            description="disponíveis para enriquecimento"
            icon={Phone}
            loading={creditsLoading}
          />
          <StatCard
            title="Total de Leads"
            value={leads.length}
            icon={TrendingUp}
            loading={leadsLoading}
          />
          <StatCard
            title="Campanhas Ativas"
            value={activeCampaigns.length}
            icon={Send}
            loading={campaignsLoading}
          />
        </div>

        {/* Recent Campaigns */}
        <Card>
          <CardHeader>
            <CardTitle>Últimas Campanhas</CardTitle>
            <CardDescription>
              Suas campanhas mais recentes
            </CardDescription>
          </CardHeader>
          <CardContent>
            {campaignsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : recentCampaigns.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Send className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhuma campanha criada ainda.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentCampaigns.map((campaign) => (
                    <TableRow key={campaign.id}>
                      <TableCell className="font-medium">{campaign.name}</TableCell>
                      <TableCell>{typeLabels[campaign.type]}</TableCell>
                      <TableCell>
                        <Badge variant={statusLabels[campaign.status]?.variant || 'secondary'}>
                          {statusLabels[campaign.status]?.label || campaign.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{campaign.leads_count}</TableCell>
                      <TableCell className="text-right">
                        {format(new Date(campaign.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
