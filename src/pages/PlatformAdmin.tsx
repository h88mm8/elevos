import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { PlansManagement } from "@/components/admin/PlansManagement";
import { TelemetryDashboard } from "@/components/admin/TelemetryDashboard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Shield, AlertTriangle, Linkedin, Building2, Check, UserPlus, Star, Activity } from "lucide-react";

export default function PlatformAdmin() {
  const navigate = useNavigate();
  const {
    isPlatformAdmin,
    isCheckingAdmin,
    platformSettings,
    isLoadingSettings,
    linkedInAccounts,
    isLoadingAccounts,
    updateSettings,
    isUpdating,
    bootstrap,
    isBootstrapping,
    refetchAdminStatus,
  } = usePlatformAdmin();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showBootstrap, setShowBootstrap] = useState(false);

  useEffect(() => {
    if (!isCheckingAdmin && isPlatformAdmin === false) {
      setShowBootstrap(true);
    }
  }, [isCheckingAdmin, isPlatformAdmin]);

  useEffect(() => {
    if (platformSettings?.linkedin_search_account_id) {
      setSelectedAccountId(platformSettings.linkedin_search_account_id);
    }
  }, [platformSettings]);

  const handleSave = async () => {
    try {
      await updateSettings(selectedAccountId);
      toast.success("Configurações salvas com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar configurações");
    }
  };

  const handleBootstrap = async () => {
    try {
      await bootstrap();
      toast.success("Você agora é um administrador da plataforma!");
      refetchAdminStatus();
      setShowBootstrap(false);
    } catch (error: any) {
      if (error.message?.includes("already exists")) {
        toast.error("Já existe um administrador da plataforma.");
        navigate("/dashboard");
      } else {
        toast.error(error.message || "Erro ao executar bootstrap");
      }
    }
  };

  if (isCheckingAdmin) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Skeleton className="h-8 w-48" />
        </div>
      </AppLayout>
    );
  }

  if (showBootstrap && !isPlatformAdmin) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Administração da Plataforma</h1>
              <p className="text-muted-foreground">Configurações globais</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                <CardTitle>Bootstrap de Administrador</CardTitle>
              </div>
              <CardDescription>
                Não existe nenhum administrador configurado. Torne-se o primeiro.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Atenção</AlertTitle>
                <AlertDescription>
                  Esta ação só está disponível quando não existe administrador.
                </AlertDescription>
              </Alert>
              <Button onClick={handleBootstrap} disabled={isBootstrapping} className="w-full">
                {isBootstrapping ? "Processando..." : "Tornar-me Administrador"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (!isPlatformAdmin) return null;

  const currentAccount = linkedInAccounts?.find(
    (acc) => acc.id === platformSettings?.linkedin_search_account_id
  );
  const hasChanges = selectedAccountId !== (platformSettings?.linkedin_search_account_id ?? null);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Administração da Plataforma</h1>
            <p className="text-muted-foreground">Configurações globais</p>
          </div>
        </div>

        <Tabs defaultValue="settings" className="space-y-4">
          <TabsList>
            <TabsTrigger value="settings">Configurações</TabsTrigger>
            <TabsTrigger value="plans" className="flex items-center gap-1">
              <Star className="h-4 w-4" /> Planos
            </TabsTrigger>
            <TabsTrigger value="telemetry" className="flex items-center gap-1">
              <Activity className="h-4 w-4" /> Telemetria
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Linkedin className="h-5 w-5 text-[#0A66C2]" />
                  <CardTitle>Conta Global LinkedIn</CardTitle>
                </div>
                <CardDescription>
                  Conta usada para buscas e enriquecimento em toda a plataforma.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {currentAccount && (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">Conta atual:</div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{currentAccount.name || currentAccount.account_id}</span>
                      {currentAccount.linkedin_feature && (
                        <Badge variant="secondary">{currentAccount.linkedin_feature}</Badge>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium">Selecionar Conta</label>
                  {isLoadingAccounts ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <Select
                      value={selectedAccountId || "none"}
                      onValueChange={(value) => setSelectedAccountId(value === "none" ? null : value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {linkedInAccounts?.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name || account.account_id} ({account.workspace_name})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isUpdating || !hasChanges}>
                    {isUpdating ? "Salvando..." : hasChanges ? "Salvar" : <><Check className="h-4 w-4 mr-1" />Salvo</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans">
            <PlansManagement />
          </TabsContent>

          <TabsContent value="telemetry">
            <TelemetryDashboard />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
