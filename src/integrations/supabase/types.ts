export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_daily_usage: {
        Row: {
          account_id: string
          action: string
          count: number
          id: string
          updated_at: string
          usage_date: string
          workspace_id: string
        }
        Insert: {
          account_id: string
          action: string
          count?: number
          id?: string
          updated_at?: string
          usage_date: string
          workspace_id: string
        }
        Update: {
          account_id?: string
          action?: string
          count?: number
          id?: string
          updated_at?: string
          usage_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      accounts: {
        Row: {
          account_id: string
          channel: string
          created_at: string
          id: string
          linkedin_feature: string | null
          linkedin_organization_name: string | null
          name: string | null
          provider: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id: string
          channel: string
          created_at?: string
          id?: string
          linkedin_feature?: string | null
          linkedin_organization_name?: string | null
          name?: string | null
          provider?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string
          channel?: string
          created_at?: string
          id?: string
          linkedin_feature?: string | null
          linkedin_organization_name?: string | null
          name?: string | null
          provider?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_events: {
        Row: {
          campaign_id: string
          campaign_lead_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          provider_message_id: string | null
        }
        Insert: {
          campaign_id: string
          campaign_lead_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          provider_message_id?: string | null
        }
        Update: {
          campaign_id?: string
          campaign_lead_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          provider_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_leads: {
        Row: {
          campaign_id: string
          created_at: string
          delivered_at: string | null
          error: string | null
          id: string
          lead_id: string
          provider_message_id: string | null
          replied_at: string | null
          retry_count: number
          seen_at: string | null
          sent_at: string | null
          skip_reason: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          lead_id: string
          provider_message_id?: string | null
          replied_at?: string | null
          retry_count?: number
          seen_at?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          lead_id?: string
          provider_message_id?: string | null
          replied_at?: string | null
          retry_count?: number
          seen_at?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_queue: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          leads_sent: number
          leads_to_send: number
          processed_at: string | null
          scheduled_date: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          leads_sent?: number
          leads_to_send?: number
          processed_at?: string | null
          scheduled_date: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          leads_sent?: number
          leads_to_send?: number
          processed_at?: string | null
          scheduled_date?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          account_id: string | null
          created_at: string
          delivered_count: number
          failed_count: number
          id: string
          leads_count: number
          linkedin_action: string | null
          message: string
          name: string
          replied_count: number
          schedule: string | null
          seen_count: number
          sent_count: number
          status: string
          subject: string | null
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          delivered_count?: number
          failed_count?: number
          id?: string
          leads_count?: number
          linkedin_action?: string | null
          message: string
          name: string
          replied_count?: number
          schedule?: string | null
          seen_count?: number
          sent_count?: number
          status?: string
          subject?: string | null
          type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          delivered_count?: number
          failed_count?: number
          id?: string
          leads_count?: number
          linkedin_action?: string | null
          message?: string
          name?: string
          replied_count?: number
          schedule?: string | null
          seen_count?: number
          sent_count?: number
          status?: string
          subject?: string | null
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_history: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          reference_id: string | null
          type: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          reference_id?: string | null
          type: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          reference_id?: string | null
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credits: {
        Row: {
          created_at: string
          id: string
          leads_credits: number
          phone_credits: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          leads_credits?: number
          phone_credits?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          leads_credits?: number
          phone_credits?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_actions: {
        Row: {
          account_id: string
          action_type: string
          comment_text: string | null
          created_at: string
          error: string | null
          executed_at: string | null
          id: string
          lead_id: string | null
          linkedin_url: string
          post_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          account_id: string
          action_type: string
          comment_text?: string | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          id?: string
          lead_id?: string | null
          linkedin_url: string
          post_id?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          account_id?: string
          action_type?: string
          comment_text?: string | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          id?: string
          lead_id?: string | null
          linkedin_url?: string
          post_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_lists: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_lists_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tags: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          city: string | null
          company: string | null
          company_address: string | null
          company_annual_revenue: string | null
          company_description: string | null
          company_domain: string | null
          company_founded_year: number | null
          company_industry: string | null
          company_linkedin: string | null
          company_phone: string | null
          company_size: string | null
          company_technologies: string | null
          company_website: string | null
          country: string | null
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string | null
          headline: string | null
          id: string
          industry: string | null
          job_title: string | null
          keywords: string | null
          last_enriched_at: string | null
          last_name: string | null
          linkedin_profile_json: Json | null
          linkedin_provider_id: string | null
          linkedin_public_identifier: string | null
          linkedin_url: string | null
          list_id: string | null
          mobile_number: string | null
          personal_email: string | null
          phone: string | null
          seniority_level: string | null
          state: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          city?: string | null
          company?: string | null
          company_address?: string | null
          company_annual_revenue?: string | null
          company_description?: string | null
          company_domain?: string | null
          company_founded_year?: number | null
          company_industry?: string | null
          company_linkedin?: string | null
          company_phone?: string | null
          company_size?: string | null
          company_technologies?: string | null
          company_website?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          industry?: string | null
          job_title?: string | null
          keywords?: string | null
          last_enriched_at?: string | null
          last_name?: string | null
          linkedin_profile_json?: Json | null
          linkedin_provider_id?: string | null
          linkedin_public_identifier?: string | null
          linkedin_url?: string | null
          list_id?: string | null
          mobile_number?: string | null
          personal_email?: string | null
          phone?: string | null
          seniority_level?: string | null
          state?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          city?: string | null
          company?: string | null
          company_address?: string | null
          company_annual_revenue?: string | null
          company_description?: string | null
          company_domain?: string | null
          company_founded_year?: number | null
          company_industry?: string | null
          company_linkedin?: string | null
          company_phone?: string | null
          company_size?: string | null
          company_technologies?: string | null
          company_website?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          industry?: string | null
          job_title?: string | null
          keywords?: string | null
          last_enriched_at?: string | null
          last_name?: string | null
          linkedin_profile_json?: Json | null
          linkedin_provider_id?: string | null
          linkedin_public_identifier?: string | null
          linkedin_url?: string | null
          list_id?: string | null
          mobile_number?: string | null
          personal_email?: string | null
          phone?: string | null
          seniority_level?: string | null
          state?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_saved_searches: {
        Row: {
          api: string
          created_at: string
          filters_json: Json
          id: string
          is_shared: boolean
          last_run_at: string | null
          name: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          api?: string
          created_at?: string
          filters_json?: Json
          id?: string
          is_shared?: boolean
          last_run_at?: string | null
          name: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          api?: string
          created_at?: string
          filters_json?: Json
          id?: string
          is_shared?: boolean
          last_run_at?: string | null
          name?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_saved_searches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          daily_enrich_limit: number
          daily_search_page_limit: number
          id: string
          is_default: boolean
          monthly_enrich_limit: number | null
          monthly_search_page_limit: number | null
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          daily_enrich_limit?: number
          daily_search_page_limit?: number
          id?: string
          is_default?: boolean
          monthly_enrich_limit?: number | null
          monthly_search_page_limit?: number | null
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          daily_enrich_limit?: number
          daily_search_page_limit?: number
          id?: string
          is_default?: boolean
          monthly_enrich_limit?: number | null
          monthly_search_page_limit?: number | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          id: number
          linkedin_search_account_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          linkedin_search_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          linkedin_search_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_linkedin_search_account_id_fkey"
            columns: ["linkedin_search_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      qr_session_logs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          metadata: Json | null
          session_id: string
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          metadata?: Json | null
          session_id: string
          status: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          metadata?: Json | null
          session_id?: string
          status?: string
        }
        Relationships: []
      }
      qr_sessions: {
        Row: {
          account_id: string | null
          account_name: string | null
          attempts: number
          channel: string
          created_at: string
          error: string | null
          expires_at: string
          id: string
          qr_code: string | null
          session_id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          account_name?: string | null
          attempts?: number
          channel?: string
          created_at?: string
          error?: string | null
          expires_at: string
          id?: string
          qr_code?: string | null
          session_id: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          account_name?: string | null
          attempts?: number
          channel?: string
          created_at?: string
          error?: string | null
          expires_at?: string
          id?: string
          qr_code?: string | null
          session_id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          account_id: string | null
          action: string
          count: number
          created_at: string
          id: string
          metadata: Json | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          action: string
          count?: number
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          action?: string
          count?: number
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          role: string
          status: string
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          role: string
          status?: string
          token: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          role?: string
          status?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          id: string
          joined_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_plans: {
        Row: {
          created_at: string
          ends_at: string | null
          plan_id: string
          starts_at: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          plan_id: string
          starts_at?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          plan_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_plans_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          created_at: string
          daily_message_limit: number
          id: string
          linkedin_daily_comment_limit: number
          linkedin_daily_invite_limit: number
          linkedin_daily_like_limit: number
          linkedin_daily_message_limit: number
          linkedin_daily_profile_scrape_limit: number
          linkedin_daily_search_limit: number
          linkedin_message_interval_seconds: number
          max_retries: number
          message_interval_seconds: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          daily_message_limit?: number
          id?: string
          linkedin_daily_comment_limit?: number
          linkedin_daily_invite_limit?: number
          linkedin_daily_like_limit?: number
          linkedin_daily_message_limit?: number
          linkedin_daily_profile_scrape_limit?: number
          linkedin_daily_search_limit?: number
          linkedin_message_interval_seconds?: number
          max_retries?: number
          message_interval_seconds?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          daily_message_limit?: number
          id?: string
          linkedin_daily_comment_limit?: number
          linkedin_daily_invite_limit?: number
          linkedin_daily_like_limit?: number
          linkedin_daily_message_limit?: number
          linkedin_daily_profile_scrape_limit?: number
          linkedin_daily_search_limit?: number
          linkedin_message_interval_seconds?: number
          max_retries?: number
          message_interval_seconds?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      campaigns_with_stats: {
        Row: {
          account_id: string | null
          actual_failed_count: number | null
          actual_leads_count: number | null
          actual_pending_count: number | null
          actual_sent_count: number | null
          created_at: string | null
          delivered_count: number | null
          failed_count: number | null
          id: string | null
          leads_count: number | null
          linkedin_action: string | null
          message: string | null
          name: string | null
          replied_count: number | null
          schedule: string | null
          seen_count: number | null
          sent_count: number | null
          status: string | null
          subject: string | null
          type: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_credits: {
        Args: {
          p_amount: number
          p_description?: string
          p_reference_id?: string
          p_type: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      bootstrap_platform_admin: { Args: { p_user_id: string }; Returns: Json }
      claim_due_queue_entries: {
        Args: { p_limit?: number; p_workspace_id?: string }
        Returns: {
          campaign_id: string
          leads_sent: number
          leads_to_send: number
          queue_id: string
          scheduled_date: string
          workspace_id: string
          workspace_timezone: string
        }[]
      }
      deduct_credits: {
        Args: {
          p_amount: number
          p_description?: string
          p_reference_id: string
          p_type: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      finalize_campaign_status: {
        Args: { p_campaign_id: string }
        Returns: string
      }
      get_admin_usage_overview: {
        Args: { p_days?: number }
        Returns: {
          action: string
          date: string
          total_count: number
          unique_workspaces: number
        }[]
      }
      get_daily_usage: {
        Args: {
          p_account_id: string
          p_action: string
          p_usage_date: string
          p_workspace_id: string
        }
        Returns: number
      }
      get_global_account_usage: {
        Args: { p_days?: number }
        Returns: {
          account_id: string
          action: string
          date: string
          total_count: number
        }[]
      }
      get_platform_linkedin_search_account: {
        Args: never
        Returns: {
          account_id: string
          account_uuid: string
          linkedin_feature: string
        }[]
      }
      get_top_workspaces_usage: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          enrichments: number
          plan_code: string
          search_pages: number
          workspace_id: string
          workspace_name: string
        }[]
      }
      get_workspace_daily_usage: {
        Args: { p_usage_date: string; p_workspace_id: string }
        Returns: {
          account_id: string
          action: string
          count: number
        }[]
      }
      get_workspace_plan: {
        Args: { p_workspace_id: string }
        Returns: {
          daily_enrich_limit: number
          daily_search_page_limit: number
          monthly_enrich_limit: number
          monthly_search_page_limit: number
          plan_code: string
          plan_id: string
          plan_name: string
          status: string
        }[]
      }
      get_workspace_usage_today: {
        Args: { p_workspace_id: string }
        Returns: {
          action: string
          total_count: number
        }[]
      }
      increment_daily_usage: {
        Args: {
          p_account_id: string
          p_action: string
          p_increment?: number
          p_usage_date: string
          p_workspace_id: string
        }
        Returns: number
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_valid_phone: { Args: { identifier: string }; Returns: boolean }
      is_workspace_admin: { Args: { workspace_uuid: string }; Returns: boolean }
      is_workspace_member: {
        Args: { workspace_uuid: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
