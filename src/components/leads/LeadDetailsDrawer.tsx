import { Lead } from '@/types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
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
} from 'lucide-react';

interface LeadDetailsDrawerProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadDetailsDrawer({ lead, open, onOpenChange }: LeadDetailsDrawerProps) {
  if (!lead) return null;

  const getLocation = () => {
    const parts = [lead.city, lead.state, lead.country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl">{lead.full_name || 'Lead sem nome'}</SheetTitle>
          <SheetDescription>
            {lead.headline || lead.job_title || 'Sem descrição'}
          </SheetDescription>
        </SheetHeader>

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
        </div>
      </SheetContent>
    </Sheet>
  );
}
