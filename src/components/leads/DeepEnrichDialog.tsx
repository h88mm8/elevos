import { useState } from 'react';
import {
  Dialog,
  DialogContent,
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
  CreditCard,
  Rocket,
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
  const [withEmail, setWithEmail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter leads that have LinkedIn URL
  const eligibleLeads = selectedLeads.filter(l => l.linkedin_url);
  const ineligibleCount = selectedLeads.length - eligibleLeads.length;

  const remaining = dailyLimit - usedToday;
  const canEnrich = Math.min(eligibleLeads.length, Math.max(0, remaining));
  const willExceed = eligibleLeads.length > remaining && remaining > 0;
  const isNearLimit = remaining <= Math.ceil(dailyLimit * 0.2) && remaining > 0;

  async function handleSubmit() {
    if (!workspaceId || eligibleLeads.length === 0) return;

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('linkedin-enrich-profile-apify', {
        body: {
          workspaceId,
          leadIds: eligibleLeads.slice(0, canEnrich).map(l => l.id),
          mode: withEmail ? 'profile_with_email' : 'profile_only',
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
        title: '🧠 Enriquecimento iniciado!',
        description: 'Você pode continuar trabalhando. Os dados aparecerão automaticamente.',
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
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-primary" />
            Enriquecimento Profundo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Features checklist */}
          <div className="space-y-2">
            {[
              'Experiência profissional completa',
              'Cargo e empresa atual',
              'Skills e especializações',
              'Educação e certificações',
              'Conexões e seguidores',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary shrink-0" />
                <span>{feature}</span>
              </div>
            ))}
          </div>

          {/* Billing box */}
          <div className="p-4 rounded-lg bg-muted/50 border">
            <div className="flex items-start gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground mt-0.5" />
              <p className="text-sm text-muted-foreground">
                💳 Consumo: 1 crédito premium por lead enriquecido com sucesso
              </p>
            </div>
          </div>

          {/* Email option */}
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="space-y-0.5">
              <Label htmlFor="include-email" className="text-sm font-medium">
                Buscar email profissional
              </Label>
              <p className="text-xs text-muted-foreground">
                Pode aumentar o custo por lead
              </p>
            </div>
            <Switch
              id="include-email"
              checked={withEmail}
              onCheckedChange={setWithEmail}
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

          {/* Quota warning - near limit */}
          {isNearLimit && !willExceed && (
            <Alert className="border-warning bg-warning/10">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertDescription>
                ⚠ Você tem {remaining} crédito{remaining !== 1 ? 's' : ''} restante{remaining !== 1 ? 's' : ''} hoje
              </AlertDescription>
            </Alert>
          )}

          {/* Quota warning - will exceed */}
          {willExceed && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Você tem {remaining} crédito{remaining !== 1 ? 's' : ''} restante{remaining !== 1 ? 's' : ''} hoje. 
                Apenas {canEnrich} lead{canEnrich !== 1 ? 's' : ''} serão enriquecidos.
              </AlertDescription>
            </Alert>
          )}

          {/* Quota exceeded - upsell */}
          {remaining <= 0 && (
            <Alert variant="destructive" className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Você atingiu o limite diário de Enrich Deep.
                </AlertDescription>
              </div>
              <Button size="sm" className="w-full gap-2 mt-1">
                <Rocket className="h-4 w-4" />
                Aumentar limite
              </Button>
            </Alert>
          )}

          {/* Remaining credits */}
          {remaining > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Créditos restantes hoje</span>
              <Badge 
                variant={remaining < 5 ? 'destructive' : 'secondary'}
                className="font-mono"
              >
                {remaining} / {dailyLimit}
              </Badge>
            </div>
          )}
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
                Enriquecer {canEnrich} lead{canEnrich !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}