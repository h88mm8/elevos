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
      accounts: {
        Row: {
          account_id: string
          channel: string
          created_at: string
          id: string
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
          seen_at: string | null
          sent_at: string | null
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
          seen_at?: string | null
          sent_at?: string | null
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
          seen_at?: string | null
          sent_at?: string | null
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
          enriched_at: string | null
          first_name: string | null
          full_name: string | null
          headline: string | null
          id: string
          industry: string | null
          job_title: string | null
          keywords: string | null
          last_name: string | null
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
          enriched_at?: string | null
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          industry?: string | null
          job_title?: string | null
          keywords?: string | null
          last_name?: string | null
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
          enriched_at?: string | null
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          industry?: string | null
          job_title?: string | null
          keywords?: string | null
          last_name?: string | null
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
      workspace_settings: {
        Row: {
          created_at: string
          daily_message_limit: number
          id: string
          message_interval_seconds: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          daily_message_limit?: number
          id?: string
          message_interval_seconds?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          daily_message_limit?: number
          id?: string
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
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
