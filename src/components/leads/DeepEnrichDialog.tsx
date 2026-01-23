import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Brain, 
  Check, 
  AlertTriangle, 
  Loader2,
  Shield,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Lead } from '@/types';

interface DeepEnrichDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedLeads: Lead[];
  workspaceId: string;
  dailyLimit: number;
  usedToday: number;
  onSuccess: () => void;
}

export function DeepEnrichDialog({
  open,
  onOpenChange,
  selectedLeads,
  workspaceId,
  dailyLimit,
  usedToday,
  onSuccess,
}: DeepEnrichDialogProps) {
  const { toast } = useToast();
  const [includeEmail, setIncludeEmail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter leads that have LinkedIn URL
  const eligibleLeads = selectedLeads.filter(l => l.linkedin_url);
  const ineligibleCount = selectedLeads.length - eligibleLeads.length;

  const remaining = dailyLimit - usedToday;
  const canEnrich = Math.min(eligibleLeads.length, remaining);
  const willExceed = eligibleLeads.length > remaining;

  async function handleSubmit() {
    if (!workspaceId || eligibleLeads.length === 0) return;

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('linkedin-enrich-profile-apify', {
        body: {
          workspaceId,
          leadIds: eligibleLeads.slice(0, canEnrich).map(l => l.id),
          mode: includeEmail ? 'profile_with_email' : 'profile_only',
        },
      });

      if (error) throw error;

      if (data.error) {
        if (data.error.includes('quota') || data.error.includes('limit')) {
          toast({
            title: 'Limite atingido',
            description: 'Você atingiu seu limite diário de enriquecimento profundo.',
            variant: 'destructive',
          });
        } else {
          throw new Error(data.error);
        }
        return;
      }

      toast({
        title: 'Enriquecimento iniciado!',
        description: 'Você pode continuar usando o sistema. Os dados aparecerão automaticamente.',
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Deep enrich error:', error);
      toast({
        title: 'Erro ao iniciar enriquecimento',
        description: error.message || 'Tente novamente mais tarde.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Enriquecimento Profundo via LinkedIn
          </DialogTitle>
          <DialogDescription>
            Extraia dados completos do perfil LinkedIn dos leads selecionados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
        {/* Features checklist */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary" />
              <span>Experiência profissional completa</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary" />
              <span>Cargo e empresa atual</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary" />
              <span>Skills e especializações</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary" />
              <span>Educação e certificações</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary" />
              <span>Localização detalhada</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary" />
              <span>Seguidores e conexões</span>
            </div>
          </div>

          {/* Billing box */}
          <div className="p-4 rounded-lg bg-muted/50 border space-y-2">
            <div className="flex items-center gap-2 font-medium text-sm">
              <Shield className="h-4 w-4 text-primary" />
              Consumo de créditos
            </div>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                1 crédito premium por lead enriquecido com sucesso
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                Nenhum crédito é consumido em falhas
              </li>
            </ul>
          </div>

          {/* Email option */}
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="space-y-0.5">
              <Label htmlFor="include-email" className="text-sm font-medium">
                Incluir busca de email profissional
              </Label>
              <p className="text-xs text-muted-foreground">
                Pode aumentar o custo por lead
              </p>
            </div>
            <Switch
              id="include-email"
              checked={includeEmail}
              onCheckedChange={setIncludeEmail}
            />
          </div>

          {/* Ineligible warning */}
          {ineligibleCount > 0 && (
            <Alert variant="default" className="bg-muted border-muted-foreground/20">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <AlertDescription className="text-muted-foreground">
                {ineligibleCount} lead{ineligibleCount > 1 ? 's' : ''} sem URL do LinkedIn serão ignorados.
              </AlertDescription>
            </Alert>
          )}

          {/* Quota warning */}
          {willExceed && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Você tem {remaining} crédito{remaining !== 1 ? 's' : ''} restante{remaining !== 1 ? 's' : ''} hoje. 
                Apenas {canEnrich} leads serão enriquecidos.
              </AlertDescription>
            </Alert>
          )}

          {/* Remaining credits */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Créditos restantes hoje</span>
            <Badge 
              variant={remaining < 5 ? 'destructive' : 'secondary'}
              className="font-mono"
            >
              {remaining} / {dailyLimit}
            </Badge>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting || canEnrich === 0}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Iniciando...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Enriquecer {canEnrich} lead{canEnrich !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
