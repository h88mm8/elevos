import { useState } from "react";
import { usePlanAdmin, Plan, WorkspaceWithPlan } from "@/hooks/usePlanAdmin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Plus, Building2, Search, Sparkles, Star } from "lucide-react";

export function PlansManagement() {
  const { 
    plans, 
    workspaces, 
    isLoading, 
    updatePlan, 
    isUpdatingPlan,
    createPlan,
    isCreatingPlan,
    assignPlan,
    isAssigningPlan,
  } = usePlanAdmin();

  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newPlan, setNewPlan] = useState({
    code: '',
    name: '',
    daily_search_page_limit: 20,
    daily_enrich_limit: 50,
    monthly_search_page_limit: null as number | null,
    monthly_enrich_limit: null as number | null,
    is_default: false,
  });

  const handleUpdatePlan = async () => {
    if (!editingPlan) return;
    try {
      await updatePlan(editingPlan);
      toast.success("Plano atualizado com sucesso!");
      setEditingPlan(null);
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar plano");
    }
  };

  const handleCreatePlan = async () => {
    if (!newPlan.code || !newPlan.name) {
      toast.error("Preencha código e nome do plano");
      return;
    }
    try {
      await createPlan(newPlan);
      toast.success("Plano criado com sucesso!");
      setCreateDialogOpen(false);
      setNewPlan({
        code: '',
        name: '',
        daily_search_page_limit: 20,
        daily_enrich_limit: 50,
        monthly_search_page_limit: null,
        monthly_enrich_limit: null,
        is_default: false,
      });
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar plano");
    }
  };

  const handleAssignPlan = async (workspaceId: string, planId: string) => {
    try {
      await assignPlan({ workspaceId, planId });
      toast.success("Plano atribuído com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao atribuir plano");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Plans Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5" />
              Planos
            </CardTitle>
            <CardDescription>
              Gerencie os planos e limites disponíveis
            </CardDescription>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Novo Plano
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Novo Plano</DialogTitle>
                <DialogDescription>
                  Defina um novo plano com limites personalizados
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Código</Label>
                    <Input
                      placeholder="ex: enterprise"
                      value={newPlan.code}
                      onChange={(e) => setNewPlan({ ...newPlan, code: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input
                      placeholder="ex: Enterprise"
                      value={newPlan.name}
                      onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pesquisas/dia</Label>
                    <Input
                      type="number"
                      value={newPlan.daily_search_page_limit}
                      onChange={(e) => setNewPlan({ ...newPlan, daily_search_page_limit: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Enrich/dia</Label>
                    <Input
                      type="number"
                      value={newPlan.daily_enrich_limit}
                      onChange={(e) => setNewPlan({ ...newPlan, daily_enrich_limit: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreatePlan} disabled={isCreatingPlan}>
                  {isCreatingPlan ? "Criando..." : "Criar Plano"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plano</TableHead>
                <TableHead>Código</TableHead>
                <TableHead className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Search className="h-3 w-3" />
                    Pesquisas/dia
                  </div>
                </TableHead>
                <TableHead className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Enrich/dia
                  </div>
                </TableHead>
                <TableHead>Padrão</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans?.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{plan.code}</Badge>
                  </TableCell>
                  <TableCell className="text-center">{plan.daily_search_page_limit}</TableCell>
                  <TableCell className="text-center">{plan.daily_enrich_limit}</TableCell>
                  <TableCell>
                    {plan.is_default && <Badge variant="secondary">Padrão</Badge>}
                  </TableCell>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => setEditingPlan({ ...plan })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Editar Plano</DialogTitle>
                          <DialogDescription>
                            Altere os limites do plano {plan.name}
                          </DialogDescription>
                        </DialogHeader>
                        {editingPlan && (
                          <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>Nome</Label>
                                <Input
                                  value={editingPlan.name}
                                  onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Código</Label>
                                <Input
                                  value={editingPlan.code}
                                  onChange={(e) => setEditingPlan({ ...editingPlan, code: e.target.value })}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>Pesquisas/dia</Label>
                                <Input
                                  type="number"
                                  value={editingPlan.daily_search_page_limit}
                                  onChange={(e) => setEditingPlan({ ...editingPlan, daily_search_page_limit: parseInt(e.target.value) || 0 })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Enrich/dia</Label>
                                <Input
                                  type="number"
                                  value={editingPlan.daily_enrich_limit}
                                  onChange={(e) => setEditingPlan({ ...editingPlan, daily_enrich_limit: parseInt(e.target.value) || 0 })}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setEditingPlan(null)}>
                            Cancelar
                          </Button>
                          <Button onClick={handleUpdatePlan} disabled={isUpdatingPlan}>
                            {isUpdatingPlan ? "Salvando..." : "Salvar"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Workspaces Plans Assignment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Workspaces
          </CardTitle>
          <CardDescription>
            Atribua planos aos workspaces
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Plano Atual</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Alterar Plano</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces?.map((workspace) => (
                <TableRow key={workspace.id}>
                  <TableCell className="font-medium">{workspace.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {workspace.plan?.name || 'Starter (padrão)'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={workspace.plan_status === 'active' ? 'default' : 'outline'}>
                      {workspace.plan_status || 'active'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={workspace.plan?.id || ''}
                      onValueChange={(planId) => handleAssignPlan(workspace.id, planId)}
                      disabled={isAssigningPlan}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Selecionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {plans?.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {plan.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
