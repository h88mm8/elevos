import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react';

interface CampaignLead {
  id: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  lead: {
    full_name: string | null;
    email: string | null;
    linkedin_url: string | null;
    company: string | null;
  } | null;
}

interface CampaignLeadsDialogProps {
  campaignId: string | null;
  campaignName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusConfig: Record<string, { label: string; icon: React.ElementType; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pendente', icon: Clock, variant: 'outline' },
  sent: { label: 'Enviado', icon: CheckCircle, variant: 'default' },
  failed: { label: 'Falhou', icon: XCircle, variant: 'destructive' },
  bounced: { label: 'Rejeitado', icon: AlertCircle, variant: 'destructive' },
};

export function CampaignLeadsDialog({ campaignId, campaignName, open, onOpenChange }: CampaignLeadsDialogProps) {
  const [leads, setLeads] = useState<CampaignLead[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && campaignId) {
      fetchLeads();
    }
  }, [open, campaignId]);

  async function fetchLeads() {
    if (!campaignId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('campaign_leads')
        .select(`
          id,
          status,
          error,
          sent_at,
          lead:leads (
            full_name,
            email,
            linkedin_url,
            company
          )
        `)
        .eq('campaign_id', campaignId)
        .order('status', { ascending: true });

      if (error) throw error;
      setLeads((data as unknown as CampaignLead[]) || []);
    } catch (error) {
      console.error('Error fetching campaign leads:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Leads da Campanha: {campaignName}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[60vh]">
          {loading ? (
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum lead encontrado para esta campanha.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[300px]">Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((cl) => {
                  const config = statusConfig[cl.status] || statusConfig.pending;
                  const Icon = config.icon;
                  
                  return (
                    <TableRow key={cl.id}>
                      <TableCell>
                        <div className="space-y-0.5">
                          <div className="font-medium">
                            {cl.lead?.full_name || 'Nome não disponível'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {cl.lead?.company || cl.lead?.email || cl.lead?.linkedin_url || '-'}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={config.variant} className="gap-1">
                          <Icon className="h-3 w-3" />
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {cl.error ? (
                          <div className="text-xs text-destructive max-w-[300px] break-words">
                            {cl.error}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}