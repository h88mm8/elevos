import { useWorkspacePlan } from "@/hooks/useWorkspacePlan";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, Search, Sparkles, AlertTriangle } from "lucide-react";
import { UsageChart } from "./UsageChart";

export function WorkspaceBillingCard() {
  const { workspacePlan, usageToday, planLimits, isLoading } = useWorkspacePlan();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const plan = workspacePlan?.plan;
  const searchUsed = usageToday?.linkedin_search_pages ?? 0;
  const searchLimit = planLimits.daily_search_page_limit;
  const searchPercent = Math.min((searchUsed / searchLimit) * 100, 100);
  
  const enrichUsed = usageToday?.linkedin_enrichments ?? 0;
  const enrichLimit = planLimits.daily_enrich_limit;
  const enrichPercent = Math.min((enrichUsed / enrichLimit) * 100, 100);

  const searchBlocked = usageToday?.linkedin_search_blocked ?? 0;
  const enrichBlocked = usageToday?.linkedin_enrich_blocked ?? 0;

  const isSearchNearLimit = searchPercent >= 80;
  const isEnrichNearLimit = enrichPercent >= 80;
  const isSearchAtLimit = searchPercent >= 100;
  const isEnrichAtLimit = enrichPercent >= 100;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <CardTitle>Plano e Limites</CardTitle>
            </div>
            <Badge 
              variant={plan?.code === 'scale' ? 'default' : 'secondary'}
              className="text-sm"
            >
              {plan?.name || 'Starter'}
            </Badge>
          </div>
          <CardDescription>
            Uso diário de LinkedIn Search e Enrichment do seu workspace
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Search Usage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Pesquisas LinkedIn</span>
              </div>
              <div className="flex items-center gap-2">
                {isSearchAtLimit ? (
                  <Badge variant="destructive" className="text-xs">Limite atingido</Badge>
                ) : isSearchNearLimit && (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                <span className="text-sm text-muted-foreground">
                  {searchUsed} / {searchLimit} páginas hoje
                </span>
              </div>
            </div>
            <Progress 
              value={searchPercent} 
              className={isSearchAtLimit ? '[&>div]:bg-destructive' : isSearchNearLimit ? '[&>div]:bg-amber-500' : ''}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Cada página de busca retorna até 25 resultados
              </p>
              {searchBlocked > 0 && (
                <span className="text-xs text-destructive">
                  {searchBlocked} bloqueada{searchBlocked !== 1 ? 's' : ''} hoje
                </span>
              )}
            </div>
          </div>

          {/* Enrich Usage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Enriquecimentos</span>
              </div>
              <div className="flex items-center gap-2">
                {isEnrichAtLimit ? (
                  <Badge variant="destructive" className="text-xs">Limite atingido</Badge>
                ) : isEnrichNearLimit && (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                <span className="text-sm text-muted-foreground">
                  {enrichUsed} / {enrichLimit} perfis hoje
                </span>
              </div>
            </div>
            <Progress 
              value={enrichPercent} 
              className={isEnrichAtLimit ? '[&>div]:bg-destructive' : isEnrichNearLimit ? '[&>div]:bg-amber-500' : ''}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Enriquecimento obtém dados detalhados do perfil LinkedIn
              </p>
              {enrichBlocked > 0 && (
                <span className="text-xs text-destructive">
                  {enrichBlocked} bloqueado{enrichBlocked !== 1 ? 's' : ''} hoje
                </span>
              )}
            </div>
          </div>

          {/* Plan details */}
          <div className="pt-4 border-t">
            <h4 className="text-sm font-medium mb-2">Limites do plano {plan?.name || 'Starter'}</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Pesquisas/dia:</span>
                <span className="ml-2 font-medium">{searchLimit} páginas</span>
              </div>
              <div>
                <span className="text-muted-foreground">Enrich/dia:</span>
                <span className="ml-2 font-medium">{enrichLimit} perfis</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage History Chart */}
      <UsageChart />
    </div>
  );
}
