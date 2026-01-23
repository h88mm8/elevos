import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lead } from '@/types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Building2, 
  Mail, 
  Phone, 
  MapPin, 
  Briefcase, 
  Globe, 
  Linkedin,
  Users,
  DollarSign,
  Calendar,
  Tag,
  Cpu,
  MessageSquare,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { LinkedInAdvancedSection } from './LinkedInAdvancedSection';
import { useTags } from '@/hooks/useTags';

interface LeadDetailsDrawerProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
  onLeadUpdated?: () => void;
}

export function LeadDetailsDrawer({ 
  lead, 
  open, 
  onOpenChange,
  workspaceId,
  onLeadUpdated,
}: LeadDetailsDrawerProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getLeadTags } = useTags();
  
  const [isEnriching, setIsEnriching] = useState(false);

  if (!lead) return null;

  const leadTags = getLeadTags(lead.id);

  const getLocation = () => {
    const parts = [lead.city, lead.state, lead.country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const phoneNumber = lead.mobile_number || lead.phone;
  const hasLinkedIn = !!lead.linkedin_url;
  const canEnrich = hasLinkedIn && workspaceId;

  const handleStartConversation = () => {
    if (!phoneNumber) return;
    navigate(`/messages?startConversation=${encodeURIComponent(phoneNumber)}&leadName=${encodeURIComponent(lead.full_name || '')}`);
    onOpenChange(false);
  };

  const handleEnrich = async () => {
    if (!workspaceId || !lead.id) return;

    setIsEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke('linkedin-enrich-lead', {
        body: {
          workspaceId,
          leadId: lead.id,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast({
        title: 'Lead enriquecido',
        description: `${data.enrichedFields?.length || 0} campos atualizados com dados do LinkedIn.`,
      });

      onLeadUpdated?.();
    } catch (error: any) {
      // Check if global account not configured
      const errorMsg = error.message || '';
      if (errorMsg.includes('global') || errorMsg.includes('configurada') || errorMsg.includes('not configured')) {
        toast({
          title: 'Enriquecimento indisponível',
          description: 'Peça ao administrador para configurar a conta global do LinkedIn.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Erro ao enriquecer',
          description: errorMsg || 'Não foi possível enriquecer o lead',
          variant: 'destructive',
        });
      }
    } finally {
      setIsEnriching(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SheetTitle className="text-xl">{lead.full_name || 'Lead sem nome'}</SheetTitle>
              {/* Tags aparecem logo após o nome */}
              {leadTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {leadTags.map((tag) => (
                    <Badge 
                      key={tag.id} 
                      style={{ backgroundColor: tag.color }}
                      className="text-white text-xs"
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              )}
              {/* Headline aparece após as tags */}
              {(lead.headline || lead.job_title) && (
                <SheetDescription className="mt-1">
                  {lead.headline || lead.job_title}
                </SheetDescription>
              )}
            </div>
            {phoneNumber && (
              <Button onClick={handleStartConversation} size="sm" className="shrink-0">
                <MessageSquare className="h-4 w-4 mr-1.5" />
                WhatsApp
              </Button>
            )}
          </div>
        </SheetHeader>

        {/* LinkedIn Enrich Section */}
        {canEnrich && (
          <div className="mt-4 p-3 rounded-lg border bg-muted/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                Enriquecer via LinkedIn
              </div>
              <Button
                size="sm"
                onClick={handleEnrich}
                disabled={isEnriching}
              >
                {isEnriching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Enriquecendo...
                  </>
                ) : (
                  <>
                    <Linkedin className="h-4 w-4 mr-1.5" />
                    Enriquecer
                  </>
                )}
              </Button>
            </div>
            {lead.last_enriched_at && (
              <p className="text-xs text-muted-foreground">
                Último enriquecimento: {new Date(lead.last_enriched_at).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 space-y-6">
          {/* Personal Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Informações Pessoais
            </h3>
            
            <div className="space-y-2">
              {lead.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${lead.email}`} className="text-primary hover:underline">
                    {lead.email}
                  </a>
                  <Badge variant="secondary" className="text-xs">Principal</Badge>
                </div>
              )}
              
              {lead.personal_email && lead.personal_email !== lead.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${lead.personal_email}`} className="text-primary hover:underline">
                    {lead.personal_email}
                  </a>
                  <Badge variant="outline" className="text-xs">Pessoal</Badge>
                </div>
              )}
              
              {(lead.phone || lead.mobile_number) && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.phone || lead.mobile_number}</span>
                </div>
              )}
              
              {lead.linkedin_url && (
                <div className="flex items-center gap-2">
                  <Linkedin className="h-4 w-4 text-muted-foreground" />
                  <a 
                    href={lead.linkedin_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Ver perfil LinkedIn
                  </a>
                </div>
              )}
              
              {getLocation() && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{getLocation()}</span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Professional Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Informações Profissionais
            </h3>
            
            <div className="space-y-2">
              {lead.job_title && (
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.job_title}</span>
                  {lead.seniority_level && (
                    <Badge variant="secondary">{lead.seniority_level}</Badge>
                  )}
                </div>
              )}
              
              {lead.industry && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.industry}</span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Company Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Empresa
            </h3>
            
            <div className="space-y-2">
              {lead.company && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{lead.company}</span>
                  {lead.company_size && (
                    <Badge variant="outline">{lead.company_size}</Badge>
                  )}
                </div>
              )}
              
              {lead.company_website && (
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <a 
                    href={lead.company_website.startsWith('http') ? lead.company_website : `https://${lead.company_website}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {lead.company_domain || lead.company_website}
                  </a>
                </div>
              )}
              
              {lead.company_linkedin && (
                <div className="flex items-center gap-2">
                  <Linkedin className="h-4 w-4 text-muted-foreground" />
                  <a 
                    href={lead.company_linkedin} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    LinkedIn da empresa
                  </a>
                </div>
              )}
              
              {lead.company_industry && (
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.company_industry}</span>
                </div>
              )}
              
              {lead.company_annual_revenue && (
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.company_annual_revenue}</span>
                </div>
              )}
              
              {lead.company_founded_year && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>Fundada em {lead.company_founded_year}</span>
                </div>
              )}
              
              {lead.company_phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.company_phone}</span>
                </div>
              )}
              
              {lead.company_address && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{lead.company_address}</span>
                </div>
              )}
              
              {lead.company_description && (
                <div className="mt-2 p-3 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">{lead.company_description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Additional Info */}
          {(lead.keywords || lead.company_technologies) && (
            <>
              <Separator />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Informações Adicionais
                </h3>
                
                {lead.keywords && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Tag className="h-4 w-4" />
                      <span>Palavras-chave</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {lead.keywords.split(',').slice(0, 10).map((keyword, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {keyword.trim()}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                {lead.company_technologies && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Cpu className="h-4 w-4" />
                      <span>Tecnologias</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {lead.company_technologies.split(',').slice(0, 10).map((tech, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {tech.trim()}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* LinkedIn Advanced Section (Deep Enrichment) */}
          <LinkedInAdvancedSection lead={lead} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
