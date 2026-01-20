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

export interface Lead {
  id: string;
  workspace_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  country: string | null;
  enriched_at: string | null;
  created_at: string;
  updated_at: string;
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
}

export interface SearchLeadsResponse {
  success: boolean;
  runId: string;
  message?: string;
}

export interface GetLeadsResultsRequest {
  workspaceId: string;
  runId: string;
  onlyWithEmail?: boolean;
  limit?: number;
  offset?: number;
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
  attendee_name: string;
  attendee_email?: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
}

export interface Message {
  id: string;
  chat_id: string;
  sender: 'me' | 'them';
  text: string;
  timestamp: string;
}
