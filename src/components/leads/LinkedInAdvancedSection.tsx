import { Lead } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Brain, 
  Briefcase, 
  GraduationCap, 
  Users, 
  MapPin,
  Quote,
  Megaphone,
  Award,
  FolderKanban,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface LinkedInAdvancedSectionProps {
  lead: Lead;
}

// Type for parsed experience from linkedin_profile or linkedin_profile_json
interface Experience {
  position?: string;
  companyName?: string;
  companyIndustry?: string;
  companySize?: string;
  startDate?: { text?: string } | string;
  endDate?: { text?: string } | string;
  jobStillWorking?: boolean;
  description?: string;
  duration?: string;
}

interface Education {
  schoolName?: string;
  degree?: string;
  fieldOfStudy?: string;
  startYear?: number;
  endYear?: number;
  period?: string;
  startDate?: { text?: string };
  endDate?: { text?: string };
}

interface Certification {
  title?: string;
  issuedBy?: string;
  issuedAt?: string;
}

interface Project {
  title?: string;
  description?: string;
  duration?: string;
  startDate?: { text?: string };
  endDate?: { text?: string };
}

interface LinkedInProfileRawJson {
  experience?: Experience[];
  education?: Education[];
  certifications?: Certification[];
  projects?: Project[];
  honorsAndAwards?: Array<{
    title?: string;
    issuedBy?: string;
    issuedAt?: string;
    description?: string;
  }>;
  languages?: Array<{
    name?: string;
    proficiency?: string;
  }>;
  volunteering?: Array<{
    role?: string;
    organizationName?: string;
    duration?: string;
  }>;
}

export function LinkedInAdvancedSection({ lead }: LinkedInAdvancedSectionProps) {
  const [profileData, setProfileData] = useState<LinkedInProfileRawJson | null>(null);

  // Fetch full profile data from linkedin_profiles table
  useEffect(() => {
    async function fetchProfileData() {
      if (!lead.id) return;
      
      const { data } = await supabase
        .from('linkedin_profiles')
        .select('raw_json')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (data?.raw_json) {
        setProfileData(data.raw_json as LinkedInProfileRawJson);
      }
    }

    fetchProfileData();
  }, [lead.id]);

  // Check if lead has deep enrichment data
  const hasDeepData = lead.about || (lead.skills && lead.skills.length > 0) || 
                      lead.connections || lead.followers || profileData;

  if (!hasDeepData) return null;

  // Use profile data from linkedin_profiles table, fallback to lead.linkedin_profile_json
  const experiences = profileData?.experience || 
    (lead.linkedin_profile_json as LinkedInProfileRawJson)?.experience || [];
  const education = profileData?.education || 
    (lead.linkedin_profile_json as LinkedInProfileRawJson)?.education || [];
  const certifications = profileData?.certifications || [];
  const projects = profileData?.projects || [];
  const honorsAndAwards = profileData?.honorsAndAwards || [];
  const languages = profileData?.languages || [];

  // Helper to extract date text
  const getDateText = (date: { text?: string } | string | undefined): string => {
    if (!date) return '';
    if (typeof date === 'string') return date;
    return date.text || '';
  };

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
              Enriquecido • {format(new Date(lead.last_enriched_at), "dd MMM yyyy", { locale: ptBR })}
            </Badge>
          )}
        </div>

        {/* Current position */}
        {(lead.job_title || lead.company) && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Briefcase className="h-4 w-4" />
              Cargo Atual
            </div>
            <p className="text-sm font-medium">
              {lead.job_title} {lead.job_title && lead.company && '·'} {lead.company}
            </p>
          </div>
        )}

        {/* Location */}
        {(lead.city || lead.state || lead.country) && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MapPin className="h-4 w-4" />
              Localização
            </div>
            <p className="text-sm">
              📍 {[lead.city, lead.state, lead.country].filter(Boolean).join(', ')}
            </p>
          </div>
        )}

        {/* About section */}
        {lead.about && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Quote className="h-4 w-4" />
              About
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
                {lead.about}
              </p>
            </div>
          </div>
        )}

        {/* Skills */}
        {lead.skills && lead.skills.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Brain className="h-4 w-4" />
              Skills
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lead.skills.slice(0, 12).map((skill, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {skill}
                </Badge>
              ))}
              {lead.skills.length > 12 && (
                <Badge variant="secondary" className="text-xs">
                  +{lead.skills.length - 12}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Experience timeline */}
        {experiences.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Briefcase className="h-4 w-4" />
              Experiência
            </div>
            <div className="space-y-3">
              {experiences.slice(0, 4).map((exp, idx) => (
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
                    {exp.duration && (
                      <p className="text-xs text-muted-foreground">
                        {exp.duration}
                      </p>
                    )}
                    {!exp.duration && (getDateText(exp.startDate) || getDateText(exp.endDate)) && (
                      <p className="text-xs text-muted-foreground">
                        {getDateText(exp.startDate)} — {getDateText(exp.endDate) === 'Present' ? 'Presente' : getDateText(exp.endDate)}
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
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <GraduationCap className="h-4 w-4" />
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
                  {edu.period && (
                    <p className="text-xs text-muted-foreground mt-0.5">{edu.period}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Certifications */}
        {certifications.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Award className="h-4 w-4" />
              Certificações
            </div>
            <div className="space-y-2">
              {certifications.slice(0, 4).map((cert, idx) => (
                <div key={idx} className="p-2 bg-muted/30 rounded-lg">
                  <p className="text-sm font-medium">{cert.title}</p>
                  {cert.issuedBy && (
                    <p className="text-xs text-muted-foreground">
                      {cert.issuedBy}
                    </p>
                  )}
                  {cert.issuedAt && (
                    <p className="text-xs text-muted-foreground">{cert.issuedAt}</p>
                  )}
                </div>
              ))}
              {certifications.length > 4 && (
                <Badge variant="secondary" className="text-xs">
                  +{certifications.length - 4} certificações
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Projects */}
        {projects.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FolderKanban className="h-4 w-4" />
              Projetos
            </div>
            <div className="space-y-2">
              {projects.slice(0, 3).map((project, idx) => (
                <div key={idx} className="p-2 bg-muted/30 rounded-lg">
                  <p className="text-sm font-medium">{project.title}</p>
                  {project.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {project.description}
                    </p>
                  )}
                  {project.duration && (
                    <p className="text-xs text-muted-foreground mt-0.5">{project.duration}</p>
                  )}
                </div>
              ))}
              {projects.length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{projects.length - 3} projetos
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Honors & Awards */}
        {honorsAndAwards.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Award className="h-4 w-4 text-warning" />
              Prêmios e Honrarias
            </div>
            <div className="space-y-2">
              {honorsAndAwards.slice(0, 3).map((award, idx) => (
                <div key={idx} className="p-2 bg-muted/30 rounded-lg">
                  <p className="text-sm font-medium">{award.title}</p>
                  {award.issuedBy && (
                    <p className="text-xs text-muted-foreground">{award.issuedBy}</p>
                  )}
                  {award.issuedAt && (
                    <p className="text-xs text-muted-foreground">{award.issuedAt}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Languages */}
        {languages.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              🌐 Idiomas
            </div>
            <div className="flex flex-wrap gap-1.5">
              {languages.map((lang, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {lang.name} {lang.proficiency && `• ${lang.proficiency}`}
                </Badge>
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
                    {lead.connections >= 500 
                      ? `${Math.floor(lead.connections / 1000)}k+`
                      : lead.connections.toLocaleString('pt-BR')}
                  </p>
                  <p className="text-xs text-muted-foreground">conexões</p>
                </div>
              </div>
            )}
            {lead.followers && (
              <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                <Megaphone className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-lg font-semibold">
                    {lead.followers >= 1000 
                      ? `${(lead.followers / 1000).toFixed(1)}k`
                      : lead.followers.toLocaleString('pt-BR')}
                  </p>
                  <p className="text-xs text-muted-foreground">seguidores</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
