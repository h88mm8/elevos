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
import { Shield, AlertTriangle, Linkedin, Check, UserPlus, Star, Activity, Plus, RefreshCw, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function PlatformAdmin() {
  const navigate = useNavigate();
  const { currentWorkspace } = useAuth();
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
  const [isConnecting, setIsConnecting] = useState(false);

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

  const handleConnectGlobalAccount = async () => {
    if (!currentWorkspace?.id) {
      toast.error("Workspace não encontrado");
      return;
    }

    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-connect-link", {
        body: {
          workspaceId: currentWorkspace.id,
          channel: "linkedin",
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.url) {
        window.open(data.url, "_blank");
        toast.info("Complete a conexão na janela aberta. Após conectar, selecione a conta aqui.");
      }
    } catch (error: any) {
      console.error("Error creating connect link:", error);
      toast.error(error.message || "Erro ao criar link de conexão");
    } finally {
      setIsConnecting(false);
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

  // Get current global account status
  const currentAccount = linkedInAccounts?.find(
    (acc) => acc.id === platformSettings?.linkedin_search_account_id
  );
  
  // Check if the account is connected or disconnected by querying via the hook
  const isAccountConnected = currentAccount !== undefined;
  const hasChanges = selectedAccountId !== (platformSettings?.linkedin_search_account_id ?? null);

  // Filter only connected LinkedIn accounts for selection
  const connectedAccounts = linkedInAccounts?.filter(acc => acc.id) || [];

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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Linkedin className="h-5 w-5 text-[#0A66C2]" />
                    <CardTitle>Conta Global LinkedIn</CardTitle>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleConnectGlobalAccount}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Conectar Nova Conta
                  </Button>
                </div>
                <CardDescription>
                  Conta usada para buscas e enriquecimento em toda a plataforma.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Current account status */}
                {platformSettings?.linkedin_search_account_id && (
                  <div className={`p-4 rounded-lg border ${isAccountConnected ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-muted-foreground mb-1">Conta global atual:</div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {currentAccount?.name || "Conta não encontrada"}
                          </span>
                          {currentAccount?.linkedin_feature && (
                            <Badge variant="secondary">{currentAccount.linkedin_feature}</Badge>
                          )}
                        </div>
                      </div>
                      {isAccountConnected ? (
                        <Badge variant="default" className="bg-green-600">
                          <Check className="h-3 w-3 mr-1" /> Conectada
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="flex items-center gap-1">
                          <WifiOff className="h-3 w-3" /> Desconectada
                        </Badge>
                      )}
                    </div>
                    {!isAccountConnected && (
                      <Alert variant="destructive" className="mt-4">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Conta desconectada</AlertTitle>
                        <AlertDescription>
                          A conta global está desconectada. Conecte uma nova conta ou reconecte a existente em Configurações → Contas.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                {!platformSettings?.linkedin_search_account_id && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Nenhuma conta configurada</AlertTitle>
                    <AlertDescription>
                      Configure uma conta global para habilitar buscas e enriquecimento na plataforma.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium">Selecionar Conta Global</label>
                  {isLoadingAccounts ? (
                    <Skeleton className="h-10 w-full" />
                  ) : connectedAccounts.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-4 border rounded-lg text-center">
                      Nenhuma conta LinkedIn conectada encontrada.<br />
                      Clique em "Conectar Nova Conta" para adicionar.
                    </div>
                  ) : (
                    <Select
                      value={selectedAccountId || "none"}
                      onValueChange={(value) => setSelectedAccountId(value === "none" ? null : value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma conta..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {connectedAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            <div className="flex items-center gap-2">
                              <Linkedin className="h-4 w-4 text-[#0A66C2]" />
                              {account.name || account.account_id}
                              <span className="text-muted-foreground">({account.workspace_name})</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isUpdating || !hasChanges}>
                    {isUpdating ? "Salvando..." : hasChanges ? "Salvar Alterações" : <><Check className="h-4 w-4 mr-1" />Salvo</>}
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
