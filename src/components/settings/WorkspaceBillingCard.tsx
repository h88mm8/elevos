import { useEffect, useRef } from "react";
import { useWorkspacePlan } from "@/hooks/useWorkspacePlan";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreditCard, Search, Sparkles, AlertTriangle, Rocket, ExternalLink, Mail, Info } from "lucide-react";
import { UsageChart } from "./UsageChart";
import { useNavigate } from "react-router-dom";

// Telemetry helper - uses RPC for proper permissions
async function trackUpgradeEvent(
  workspaceId: string | undefined,
  action: string,
  metadata: Record<string, string>
) {
  if (!workspaceId) return;
  try {
    await supabase.rpc("log_client_event", {
      p_workspace_id: workspaceId,
      p_action: action,
      p_metadata: metadata,
    });
  } catch (e) {
    // Silent fail - telemetry should not break UX
    console.warn("Telemetry error:", e);
  }
}

export function WorkspaceBillingCard() {
  const { workspacePlan, usageToday, planLimits, isLoading } = useWorkspacePlan();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { currentWorkspace } = useAuth();
  const navigate = useNavigate();
  const ctaShownRef = useRef(false);

  const plan = workspacePlan?.plan;
  const searchUsed = usageToday?.linkedin_search_pages ?? 0;
  const searchLimit = planLimits.daily_search_page_limit;
  const searchPercent = searchLimit > 0 ? Math.min((searchUsed / searchLimit) * 100, 100) : 0;
  
  const enrichUsed = usageToday?.linkedin_enrichments ?? 0;
  const enrichLimit = planLimits.daily_enrich_limit;
  const enrichPercent = enrichLimit > 0 ? Math.min((enrichUsed / enrichLimit) * 100, 100) : 0;

  const searchBlocked = usageToday?.linkedin_search_blocked ?? 0;
  const enrichBlocked = usageToday?.linkedin_enrich_blocked ?? 0;

  const isSearchNearLimit = searchPercent >= 80;
  const isEnrichNearLimit = enrichPercent >= 80;
  const isSearchAtLimit = searchPercent >= 100;
  const isEnrichAtLimit = enrichPercent >= 100;
  const isAtLimit = isSearchAtLimit || isEnrichAtLimit;
  const isNearLimit = (isSearchNearLimit || isEnrichNearLimit) && !isAtLimit;
  const hasBlockedToday = (searchBlocked + enrichBlocked) > 0;
  const shouldShowUpgradeCTA = isSearchNearLimit || isEnrichNearLimit || hasBlockedToday;

  // Determine CTA reason for telemetry
  const getCtaReason = (): "at_limit" | "near_limit" | "blocked" => {
    if (isAtLimit) return "at_limit";
    if (hasBlockedToday) return "blocked";
    return "near_limit";
  };

  // Track CTA shown (once per mount when conditions are met)
  useEffect(() => {
    if (shouldShowUpgradeCTA && !ctaShownRef.current && !isLoading) {
      ctaShownRef.current = true;
      trackUpgradeEvent(currentWorkspace?.id, "upgrade_cta_shown", {
        reason: getCtaReason(),
      });
    }
  }, [shouldShowUpgradeCTA, isLoading, currentWorkspace?.id]);

  // Determine CTA message
  const getUpgradeMessage = () => {
    if (isAtLimit) {
      return "Você atingiu o limite diário. Faça upgrade para continuar hoje.";
    }
    if (hasBlockedToday) {
      return "Algumas ações foram bloqueadas por limite. Um upgrade evita bloqueios.";
    }
    return "Você está perto do limite diário. Um upgrade aumenta suas cotas.";
  };

  // Build mailto link
  const getMailtoLink = () => {
    const subject = encodeURIComponent(
      `Solicitação de upgrade de plano — Workspace ${currentWorkspace?.name || "N/A"}`
    );
    const body = encodeURIComponent(
      `Workspace: ${currentWorkspace?.name || "N/A"}\n` +
      `Workspace ID: ${currentWorkspace?.id || "N/A"}\n` +
      `Plano atual: ${plan?.name || "Starter"}\n\n` +
      `Uso hoje:\n` +
      `  - Pesquisas: ${searchUsed} / ${searchLimit}\n` +
      `  - Enrich: ${enrichUsed} / ${enrichLimit}\n` +
      `  - Bloqueios hoje: ${searchBlocked + enrichBlocked}\n`
    );
    return `mailto:suporte@elevsales.com.br?subject=${subject}&body=${body}`;
  };

  // Handle CTA clicks
  const handleViewPlans = () => {
    trackUpgradeEvent(currentWorkspace?.id, "upgrade_cta_clicked", {
      destination: "platform-admin",
    });
    navigate("/platform-admin?tab=plans");
  };

  const handleRequestUpgrade = () => {
    trackUpgradeEvent(currentWorkspace?.id, "upgrade_cta_clicked", {
      destination: "mailto",
    });
    window.open(getMailtoLink(), "_blank");
  };

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
                  <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">Perto do limite</Badge>
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
                  <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">Perto do limite</Badge>
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
        <Card className={
          isAtLimit 
            ? "border-destructive bg-destructive/5" 
            : isNearLimit 
              ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20" 
              : ""
        }>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Rocket className={`h-5 w-5 ${isAtLimit ? "text-destructive" : "text-amber-600"}`} />
              <CardTitle className="text-base">Precisa de mais limite?</CardTitle>
              {isAtLimit ? (
                <Badge variant="destructive" className="text-xs">Limite atingido</Badge>
              ) : isNearLimit && (
                <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">Perto do limite</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{getUpgradeMessage()}</p>
            
            <div className="flex flex-wrap gap-2">
              {isPlatformAdmin ? (
                <>
                  <Button size="sm" onClick={handleViewPlans}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Ver planos
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleRequestUpgrade}>
                    <Mail className="mr-2 h-4 w-4" />
                    Solicitar upgrade
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={handleRequestUpgrade}>
                  <Mail className="mr-2 h-4 w-4" />
                  Solicitar upgrade
                </Button>
              )}
            </div>

            {/* Non-admin info text */}
            {!isPlatformAdmin && (
              <div className="flex items-start gap-2 pt-2 border-t">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Você não é administrador da plataforma. Peça ao admin para fazer o upgrade.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Usage History Chart */}
      <UsageChart />
    </div>
  );
}
