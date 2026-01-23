import { useAuth } from '@/contexts/AuthContext';
import { useEnrichmentJobs } from '@/hooks/useEnrichmentJobs';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Brain, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Loader2,
  Rocket,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function EnrichmentJobs() {
  const { currentWorkspace } = useAuth();
  const { jobs, isLoading, refetch } = useEnrichmentJobs();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processing':
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processando
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="default" className="gap-1 bg-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Concluído
          </Badge>
        );
      case 'quota_exceeded':
        return (
          <Badge variant="secondary" className="gap-1 bg-orange-500 text-white">
            <AlertTriangle className="h-3 w-3" />
            Quota Excedida
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Falhou
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'profile_with_email':
        return 'Perfil + Email';
      case 'profile_only':
      default:
        return 'Perfil Completo';
    }
  };

  if (!currentWorkspace) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Selecione um workspace</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Brain className="h-8 w-8" />
              Enrichment Jobs
            </h1>
            <p className="text-muted-foreground">
              Acompanhe o status dos seus enriquecimentos profundos
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium text-lg mb-2">Nenhum enriquecimento ainda</h3>
              <p className="text-muted-foreground">
                Selecione leads na página de Leads e use "Enrich Deep" para enriquecer perfis.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => {
              const progress = job.total_leads > 0 
                ? ((job.enriched_count + job.error_count) / job.total_leads) * 100 
                : 0;
              
              return (
                <Card key={job.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Brain className="h-5 w-5 text-purple-500" />
                        Enriquecimento Profundo
                      </CardTitle>
                      {getStatusBadge(job.status)}
                    </div>
                    <CardDescription className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {format(new Date(job.created_at), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {getModeLabel(job.mode)}
                      </Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Progress */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Progresso</span>
                        <span className="font-medium">
                          {job.enriched_count} / {job.total_leads} leads
                        </span>
                      </div>
                      <Progress value={progress} className="h-2" />
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">
                          {job.enriched_count}
                        </div>
                        <div className="text-xs text-muted-foreground">Enriquecidos</div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-2xl font-bold text-red-600">
                          {job.error_count}
                        </div>
                        <div className="text-xs text-muted-foreground">Erros</div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-2xl font-bold text-muted-foreground">
                          {job.total_leads - job.enriched_count - job.error_count}
                        </div>
                        <div className="text-xs text-muted-foreground">Pendentes</div>
                      </div>
                    </div>

                    {/* Error message */}
                    {job.error_message && (
                      <Alert variant="destructive">
                        <XCircle className="h-4 w-4" />
                        <AlertDescription>{job.error_message}</AlertDescription>
                      </Alert>
                    )}

                    {/* Quota exceeded upsell */}
                    {job.status === 'quota_exceeded' && (
                      <Alert className="border-orange-500/50 bg-orange-500/10">
                        <AlertTriangle className="h-4 w-4 text-orange-500" />
                        <AlertDescription className="flex items-center justify-between">
                          <span>Limite diário de Enrich Deep atingido.</span>
                          <Button variant="outline" size="sm" className="ml-4">
                            <Rocket className="h-4 w-4 mr-1" />
                            Fazer Upgrade
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Completed at */}
                    {job.completed_at && (
                      <p className="text-xs text-muted-foreground text-right">
                        Concluído em {format(new Date(job.completed_at), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
