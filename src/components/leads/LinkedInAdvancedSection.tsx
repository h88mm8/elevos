import { Lead } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Brain, 
  Briefcase, 
  GraduationCap, 
  Users, 
  MapPin,
  Calendar,
  Building2,
  Quote,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LinkedInAdvancedSectionProps {
  lead: Lead;
}

// Type for parsed experience from linkedin_profile_json
interface Experience {
  position?: string;
  companyName?: string;
  companyIndustry?: string;
  companySize?: string;
  startDate?: string;
  endDate?: string;
  jobStillWorking?: boolean;
  description?: string;
}

interface Education {
  schoolName?: string;
  degree?: string;
  fieldOfStudy?: string;
  startYear?: number;
  endYear?: number;
}

export function LinkedInAdvancedSection({ lead }: LinkedInAdvancedSectionProps) {
  // Check if lead has deep enrichment data
  const hasDeepData = lead.about || (lead.skills && lead.skills.length > 0) || 
                      lead.connections || lead.followers;

  if (!hasDeepData) return null;

  // Parse JSON data if available
  const profileJson = lead.linkedin_profile_json as {
    experience?: Experience[];
    education?: Education[];
  } | null;

  const experiences = profileJson?.experience || [];
  const education = profileJson?.education || [];

  return (
    <>
      <Separator />
      
      <div className="space-y-4">
        {/* Header with badge */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Perfil LinkedIn Avançado
          </h3>
          {lead.last_enriched_at && (
            <Badge variant="secondary" className="text-xs">
              Enriquecido em {format(new Date(lead.last_enriched_at), "dd MMM yyyy", { locale: ptBR })}
            </Badge>
          )}
        </div>

        {/* About section */}
        {lead.about && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Quote className="h-4 w-4 text-muted-foreground" />
              Sobre
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {lead.about}
              </p>
            </div>
          </div>
        )}

        {/* Skills */}
        {lead.skills && lead.skills.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Brain className="h-4 w-4 text-muted-foreground" />
              Skills
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lead.skills.slice(0, 15).map((skill, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {skill}
                </Badge>
              ))}
              {lead.skills.length > 15 && (
                <Badge variant="secondary" className="text-xs">
                  +{lead.skills.length - 15}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Experience timeline */}
        {experiences.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              Experiência
            </div>
            <div className="space-y-3">
              {experiences.slice(0, 5).map((exp, idx) => (
                <div 
                  key={idx} 
                  className="relative pl-4 border-l-2 border-muted pb-3 last:pb-0"
                >
                  <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-primary" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{exp.position}</p>
                    <p className="text-sm text-muted-foreground">
                      {exp.companyName}
                    </p>
                    {(exp.startDate || exp.endDate) && (
                      <p className="text-xs text-muted-foreground">
                        {exp.startDate} — {exp.jobStillWorking ? 'Presente' : exp.endDate}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Education */}
        {education.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GraduationCap className="h-4 w-4 text-muted-foreground" />
              Educação
            </div>
            <div className="space-y-2">
              {education.slice(0, 3).map((edu, idx) => (
                <div key={idx} className="p-2 bg-muted/30 rounded-lg">
                  <p className="text-sm font-medium">{edu.schoolName}</p>
                  {(edu.degree || edu.fieldOfStudy) && (
                    <p className="text-xs text-muted-foreground">
                      {[edu.degree, edu.fieldOfStudy].filter(Boolean).join(' • ')}
                    </p>
                  )}
                  {(edu.startYear || edu.endYear) && (
                    <p className="text-xs text-muted-foreground">
                      {edu.startYear} — {edu.endYear || 'Presente'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metrics */}
        {(lead.connections || lead.followers) && (
          <div className="grid grid-cols-2 gap-3">
            {lead.connections && (
              <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                <Users className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-lg font-semibold">
                    {lead.connections.toLocaleString('pt-BR')}
                  </p>
                  <p className="text-xs text-muted-foreground">Conexões</p>
                </div>
              </div>
            )}
            {lead.followers && (
              <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                <Users className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-lg font-semibold">
                    {lead.followers.toLocaleString('pt-BR')}
                  </p>
                  <p className="text-xs text-muted-foreground">Seguidores</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
