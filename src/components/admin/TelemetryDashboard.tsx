import { usePlanAdmin } from "@/hooks/usePlanAdmin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Search, 
  Sparkles, 
  TrendingUp, 
  AlertTriangle, 
  Building2,
  Activity,
  Server,
} from "lucide-react";
import { useMemo } from "react";

export function TelemetryDashboard() {
  const { 
    usageOverview, 
    topWorkspaces, 
    globalAccountUsage,
    isLoading,
  } = usePlanAdmin();

  // Aggregate totals from overview
  const totals = useMemo(() => {
    if (!usageOverview) return { searchPages: 0, enrichments: 0, blocked: 0 };
    
    let searchPages = 0;
    let enrichments = 0;
    let blocked = 0;
    
    for (const row of usageOverview) {
      if (row.action === 'linkedin_search_page') {
        searchPages += row.total_count;
      } else if (row.action === 'linkedin_enrich') {
        enrichments += row.total_count;
      } else if (row.action.includes('blocked')) {
        blocked += row.total_count;
      }
    }
    
    return { searchPages, enrichments, blocked };
  }, [usageOverview]);

  // Aggregate global account usage
  const globalTotals = useMemo(() => {
    if (!globalAccountUsage) return {};
    
    const byAccount: Record<string, { search: number; enrich: number; total: number }> = {};
    
    for (const row of globalAccountUsage) {
      if (!byAccount[row.account_id]) {
        byAccount[row.account_id] = { search: 0, enrich: 0, total: 0 };
      }
      if (row.action === 'linkedin_search_page') {
        byAccount[row.account_id].search += row.total_count;
      } else if (row.action === 'linkedin_enrich') {
        byAccount[row.account_id].enrich += row.total_count;
      }
      byAccount[row.account_id].total += row.total_count;
    }
    
    return byAccount;
  }, [globalAccountUsage]);

  // Check for high usage alerts
  const highUsageAccounts = useMemo(() => {
    return Object.entries(globalTotals)
      .filter(([_, usage]) => usage.total > 200)
      .map(([accountId, usage]) => ({ accountId, ...usage }));
  }, [globalTotals]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* High Usage Alert */}
      {highUsageAccounts.length > 0 && (
        <Alert variant="default" className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-600">Alerta de Alto Uso</AlertTitle>
          <AlertDescription className="text-amber-600/90">
            {highUsageAccounts.length} conta(s) global(is) com uso acima de 200 operações nos últimos 7 dias.
            Considere distribuir a carga ou verificar limites.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Search className="h-3 w-3" />
              Pesquisas (7d)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.searchPages}</div>
            <p className="text-xs text-muted-foreground">páginas de busca</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Enrichments (7d)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.enrichments}</div>
            <p className="text-xs text-muted-foreground">perfis enriquecidos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Total (7d)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.searchPages + totals.enrichments}</div>
            <p className="text-xs text-muted-foreground">operações</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Bloqueados (7d)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.blocked}</div>
            <p className="text-xs text-muted-foreground">por limite</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Workspaces */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Top Workspaces (7 dias)
          </CardTitle>
          <CardDescription>
            Workspaces com maior consumo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead className="text-right">Pesquisas</TableHead>
                <TableHead className="text-right">Enrich</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topWorkspaces?.map((ws) => (
                <TableRow key={ws.workspace_id}>
                  <TableCell className="font-medium">{ws.workspace_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{ws.plan_code}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{ws.search_pages}</TableCell>
                  <TableCell className="text-right">{ws.enrichments}</TableCell>
                  <TableCell className="text-right font-medium">
                    {ws.search_pages + ws.enrichments}
                  </TableCell>
                </TableRow>
              ))}
              {(!topWorkspaces || topWorkspaces.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Nenhum uso registrado nos últimos 7 dias
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Global Account Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Uso da Conta Global (7 dias)
          </CardTitle>
          <CardDescription>
            Consumo agregado por conta global de busca/enrich
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account ID</TableHead>
                <TableHead className="text-right">Pesquisas</TableHead>
                <TableHead className="text-right">Enrich</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(globalTotals).map(([accountId, usage]) => (
                <TableRow key={accountId}>
                  <TableCell className="font-mono text-sm">
                    {accountId.substring(0, 20)}...
                  </TableCell>
                  <TableCell className="text-right">{usage.search}</TableCell>
                  <TableCell className="text-right">{usage.enrich}</TableCell>
                  <TableCell className="text-right font-medium">{usage.total}</TableCell>
                  <TableCell>
                    {usage.total > 200 ? (
                      <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                        <AlertTriangle className="h-3 w-3" />
                        Alto uso
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Normal</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {Object.keys(globalTotals).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Nenhum uso registrado nos últimos 7 dias
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
