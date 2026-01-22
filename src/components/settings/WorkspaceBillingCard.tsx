import { useWorkspacePlan } from "@/hooks/useWorkspacePlan";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CreditCard, Search, Sparkles, AlertTriangle, Rocket, ExternalLink, Mail } from "lucide-react";
import { UsageChart } from "./UsageChart";
import { useNavigate } from "react-router-dom";

export function WorkspaceBillingCard() {
  const { workspacePlan, usageToday, planLimits, isLoading } = useWorkspacePlan();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { currentWorkspace } = useAuth();
  const navigate = useNavigate();

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
  const hasBlockedToday = (searchBlocked + enrichBlocked) > 0;
  const shouldShowUpgradeCTA = isSearchNearLimit || isEnrichNearLimit || hasBlockedToday;

  // Determine CTA message
  const getUpgradeMessage = () => {
    if (isSearchAtLimit || isEnrichAtLimit) {
      return "Você atingiu o limite diário. Faça upgrade para continuar hoje.";
    }
    if (hasBlockedToday) {
      return "Algumas ações foram bloqueadas por limite. Um upgrade evita bloqueios.";
    }
    return "Você está perto do limite diário. Um upgrade aumenta suas cotas.";
  };

  // Handle upgrade request
  const handleRequestUpgrade = () => {
    if (isPlatformAdmin) {
      navigate('/platform-admin?tab=plans');
    } else {
      const subject = encodeURIComponent("Solicitação de upgrade de plano");
      const body = encodeURIComponent(
        `Olá,\n\nGostaria de solicitar um upgrade de plano.\n\n` +
        `Workspace: ${currentWorkspace?.name || 'N/A'}\n` +
        `Plano atual: ${plan?.name || 'Starter'}\n` +
        `Uso de pesquisas: ${searchUsed}/${searchLimit}\n` +
        `Uso de enriquecimentos: ${enrichUsed}/${enrichLimit}\n` +
        `Bloqueios hoje: ${searchBlocked + enrichBlocked}\n\n` +
        `Aguardo retorno.\n\nObrigado!`
      );
      window.open(`mailto:suporte@elevos.io?subject=${subject}&body=${body}`, '_blank');
    }
  };

  // Handle view plans
  const handleViewPlans = () => {
    if (isPlatformAdmin) {
      navigate('/platform-admin?tab=plans');
    }
  };

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

      {/* Upgrade CTA */}
      {shouldShowUpgradeCTA && (
        <Alert variant={isSearchAtLimit || isEnrichAtLimit ? "destructive" : "default"}>
          <Rocket className="h-4 w-4" />
          <AlertTitle>Precisa de mais limite?</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-3">{getUpgradeMessage()}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleRequestUpgrade}>
                {isPlatformAdmin ? (
                  <>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Gerenciar planos
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Solicitar upgrade
                  </>
                )}
              </Button>
              {isPlatformAdmin ? (
                <Button size="sm" variant="outline" onClick={handleViewPlans}>
                  Ver todos os planos
                </Button>
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" variant="outline" disabled>
                        Ver planos
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Peça ao administrador do workspace</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Usage History Chart */}
      <UsageChart />
    </div>
  );
}
