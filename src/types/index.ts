// =============================================
// UNIPILE MESSENGER - TYPE DEFINITIONS
// =============================================

export interface Profile {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
}

export interface Credits {
  id: string;
  workspace_id: string;
  leads_credits: number;
  phone_credits: number;
  created_at: string;
  updated_at: string;
}

export interface CreditHistory {
  id: string;
  workspace_id: string;
  type: 'lead_search' | 'phone_enrich' | 'credit_add' | 'credit_deduct';
  amount: number;
  description: string | null;
  reference_id: string | null;
  created_at: string;
}

export interface LeadList {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  workspace_id: string;
  list_id: string | null;
  
  // Dados pessoais
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  personal_email: string | null;
  phone: string | null;
  mobile_number: string | null;
  linkedin_url: string | null;
  
  // Cargo e nível
  job_title: string | null;
  headline: string | null;
  seniority_level: string | null;
  industry: string | null;
  
  // Localização
  city: string | null;
  state: string | null;
  country: string | null;
  
  // Dados da empresa
  company: string | null;
  company_website: string | null;
  company_domain: string | null;
  company_linkedin: string | null;
  company_size: string | null;
  company_industry: string | null;
  company_annual_revenue: string | null;
  company_description: string | null;
  company_founded_year: number | null;
  company_phone: string | null;
  company_address: string | null;
  keywords: string | null;
  company_technologies: string | null;
  
  enriched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadFilters {
  company: string;
  jobTitle: string;
  industry: string;
  country: string;
  listId: string | null;
}

export interface Campaign {
  id: string;
  workspace_id: string;
  name: string;
  type: 'email' | 'whatsapp' | 'linkedin';
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';
  message: string;
  subject: string | null;
  account_id: string | null;
  schedule: string | null;
  leads_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  status: 'pending' | 'sent' | 'failed' | 'bounced';
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

// API Request/Response types
export interface SearchLeadsRequest {
  workspaceId: string;
  filters: {
    job_title?: string;
    company?: string;
    country?: string;
    industry?: string;
  };
  fetch_count: number;
  onlyWithEmail?: boolean;
  listId?: string;
}

export interface SearchLeadsResponse {
  success: boolean;
  runId: string;
  listId?: string;
  message?: string;
}

export interface GetLeadsResultsRequest {
  workspaceId: string;
  runId: string;
  onlyWithEmail?: boolean;
  limit?: number;
  offset?: number;
  listId?: string;
}

export interface EnrichLeadRequest {
  workspaceId: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  domain?: string;
  revealPhone?: boolean;
}

export interface CreateCampaignRequest {
  workspaceId: string;
  name: string;
  type: 'email' | 'whatsapp' | 'linkedin';
  leads: { email?: string; full_name?: string; phone?: string; linkedin_url?: string }[];
  message: string;
  subject?: string;
  accountId?: string;
  schedule?: string;
}

export interface Chat {
  id: string;
  account_id: string;
  attendee_identifier?: string;
  attendee_name: string;
  attendee_email?: string;
  attendee_picture?: string | null;
  last_message: string;
  last_message_at: string;
  unread_count: number;
}

export interface MessageAttachment {
  type: 'image' | 'video' | 'audio' | 'document' | 'file';
  url: string;
  mime_type?: string;
  filename?: string;
  size?: number;
  duration?: number; // For audio/video in seconds
}

export interface Message {
  id: string;
  chat_id: string;
  sender: 'me' | 'them';
  text: string;
  timestamp: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  attachments?: MessageAttachment[];
}

export interface Account {
  id: string;
  workspace_id: string;
  provider: string;
  channel: string;
  account_id: string;
  name: string | null;
  status: 'connected' | 'disconnected' | 'error';
  created_at: string;
  updated_at: string;
}
