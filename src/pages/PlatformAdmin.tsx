import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Shield, AlertTriangle, Linkedin, Building2, Check } from "lucide-react";
import { useState } from "react";

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
  } = usePlatformAdmin();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Redirect non-admins
  useEffect(() => {
    if (!isCheckingAdmin && isPlatformAdmin === false) {
      toast.error("Acesso negado. Você não é um administrador da plataforma.");
      navigate("/dashboard");
    }
  }, [isCheckingAdmin, isPlatformAdmin, navigate]);

  // Set initial selection when data loads
  useEffect(() => {
    if (platformSettings?.linkedin_search_account_id) {
      setSelectedAccountId(platformSettings.linkedin_search_account_id);
    }
  }, [platformSettings]);

  const handleSave = async () => {
    try {
      await updateSettings(selectedAccountId);
      toast.success("Configurações salvas com sucesso!");
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error("Erro ao salvar configurações");
    }
  };

  // Show loading while checking admin status
  if (isCheckingAdmin) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Skeleton className="h-8 w-48" />
        </div>
      </AppLayout>
    );
  }

  // Don't render anything if not admin (will redirect)
  if (!isPlatformAdmin) {
    return null;
  }

  const currentAccount = linkedInAccounts?.find(
    (acc) => acc.id === platformSettings?.linkedin_search_account_id
  );

  const hasChanges = selectedAccountId !== (platformSettings?.linkedin_search_account_id ?? null);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Administração da Plataforma</h1>
            <p className="text-muted-foreground">
              Configurações globais que afetam toda a plataforma
            </p>
          </div>
        </div>

        {/* Global LinkedIn Search Account */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Linkedin className="h-5 w-5 text-[#0A66C2]" />
              <CardTitle>Conta Global para Busca/Enriquecimento LinkedIn</CardTitle>
            </div>
            <CardDescription>
              Esta conta será usada exclusivamente para buscas e enriquecimento de perfis LinkedIn 
              em toda a plataforma. O envio de mensagens (DM/InMail/Convites) continuará usando 
              a conta selecionada em cada campanha.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Warning Alert */}
            <Alert variant="default" className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertTitle className="text-amber-600">Atenção</AlertTitle>
              <AlertDescription className="text-amber-600/90">
                Esta conta é usada APENAS para busca e enriquecimento. O envio de mensagens 
                continua sendo feito pela conta selecionada em cada campanha individual.
              </AlertDescription>
            </Alert>

            {/* Current Selection Display */}
            {currentAccount && (
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Conta atual configurada:</div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{currentAccount.name || currentAccount.account_id}</span>
                  {currentAccount.linkedin_feature && (
                    <Badge variant="secondary" className="text-xs">
                      {currentAccount.linkedin_feature}
                    </Badge>
                  )}
                  <span className="text-muted-foreground text-sm">
                    ({currentAccount.workspace_name})
                  </span>
                </div>
              </div>
            )}

            {/* Account Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Selecionar Conta LinkedIn</label>
              {isLoadingAccounts ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select
                  value={selectedAccountId || "none"}
                  onValueChange={(value) => setSelectedAccountId(value === "none" ? null : value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione uma conta LinkedIn..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">Nenhuma conta selecionada</span>
                    </SelectItem>
                    {linkedInAccounts?.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        <div className="flex items-center gap-2">
                          <Linkedin className="h-4 w-4 text-[#0A66C2]" />
                          <span>{account.name || account.account_id}</span>
                          {account.linkedin_feature && (
                            <Badge variant="outline" className="text-xs ml-1">
                              {account.linkedin_feature}
                            </Badge>
                          )}
                          <span className="text-muted-foreground text-xs flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {account.workspace_name}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                Mostrando todas as contas LinkedIn conectadas de todos os workspaces.
              </p>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
              <Button 
                onClick={handleSave} 
                disabled={isUpdating || !hasChanges}
                className="min-w-[120px]"
              >
                {isUpdating ? (
                  "Salvando..."
                ) : hasChanges ? (
                  "Salvar Alterações"
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    Salvo
                  </>
                )}
              </Button>
            </div>

            {/* Last Updated */}
            {platformSettings?.updated_at && (
              <div className="text-xs text-muted-foreground text-right">
                Última atualização: {new Date(platformSettings.updated_at).toLocaleString("pt-BR")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
