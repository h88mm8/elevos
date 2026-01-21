import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Search, 
  MessageSquare, 
  Building2, 
  User,
  Phone,
  Briefcase,
} from 'lucide-react';
import { Lead } from '@/types';
import { useLeads } from '@/hooks/useLeads';
import { useLeadLists } from '@/hooks/useLeadLists';

interface StartConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectLead: (lead: Lead) => void;
}

export function StartConversationDialog({ 
  open, 
  onOpenChange, 
  onSelectLead 
}: StartConversationDialogProps) {
  const { leads, isLoading } = useLeads();
  const { lists } = useLeadLists();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedList, setSelectedList] = useState<string>('all');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');

  // Get unique industries from leads
  const industries = useMemo(() => {
    const industrySet = new Set<string>();
    leads.forEach(lead => {
      if (lead.industry) industrySet.add(lead.industry);
      if (lead.company_industry) industrySet.add(lead.company_industry);
    });
    return Array.from(industrySet).sort();
  }, [leads]);

  // Filter leads that have phone numbers and match search criteria
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      // Must have phone number
      const hasPhone = lead.phone || lead.mobile_number;
      if (!hasPhone) return false;

      // Search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        (lead.full_name?.toLowerCase().includes(searchLower)) ||
        (lead.first_name?.toLowerCase().includes(searchLower)) ||
        (lead.last_name?.toLowerCase().includes(searchLower)) ||
        (lead.company?.toLowerCase().includes(searchLower)) ||
        (lead.job_title?.toLowerCase().includes(searchLower)) ||
        (lead.email?.toLowerCase().includes(searchLower));

      // List filter
      const matchesList = selectedList === 'all' || lead.list_id === selectedList;

      // Industry filter
      const matchesIndustry = selectedIndustry === 'all' || 
        lead.industry === selectedIndustry ||
        lead.company_industry === selectedIndustry;

      return matchesSearch && matchesList && matchesIndustry;
    });
  }, [leads, searchQuery, selectedList, selectedIndustry]);

  const handleSelectLead = (lead: Lead) => {
    onSelectLead(lead);
    onOpenChange(false);
    // Reset filters
    setSearchQuery('');
    setSelectedList('all');
    setSelectedIndustry('all');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Iniciar Conversa no WhatsApp
          </DialogTitle>
          <DialogDescription>
            Selecione um lead para iniciar uma conversa. Apenas leads com telefone cadastrado são exibidos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, empresa, cargo..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <Select value={selectedList} onValueChange={setSelectedList}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Todas as listas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as listas</SelectItem>
                {lists.map(list => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Todas as indústrias" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as indústrias</SelectItem>
                {industries.map(industry => (
                  <SelectItem key={industry} value={industry}>
                    {industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Results count */}
          <div className="text-sm text-muted-foreground">
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''} encontrado{filteredLeads.length !== 1 ? 's' : ''} com telefone
          </div>

          {/* Lead List */}
          <ScrollArea className="h-[400px] pr-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhum lead encontrado com telefone.</p>
                <p className="text-sm mt-1">Tente ajustar os filtros ou busca.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredLeads.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => handleSelectLead(lead)}
                    className="w-full text-left p-4 rounded-lg border hover:bg-muted transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">
                            {lead.full_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Sem nome'}
                          </p>
                          {lead.seniority_level && (
                            <Badge variant="secondary" className="text-xs shrink-0">
                              {lead.seniority_level}
                            </Badge>
                          )}
                        </div>
                        
                        {lead.job_title && (
                          <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
                            <Briefcase className="h-3.5 w-3.5" />
                            <span className="truncate">{lead.job_title}</span>
                          </div>
                        )}
                        
                        {lead.company && (
                          <div className="flex items-center gap-1.5 mt-0.5 text-sm text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" />
                            <span className="truncate">{lead.company}</span>
                          </div>
                        )}
                        
                        <div className="flex items-center gap-1.5 mt-1 text-sm text-primary">
                          <Phone className="h-3.5 w-3.5" />
                          <span>{lead.mobile_number || lead.phone}</span>
                        </div>
                      </div>
                      
                      <Button size="sm" variant="outline" className="shrink-0">
                        <MessageSquare className="h-4 w-4 mr-1" />
                        Conversar
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
