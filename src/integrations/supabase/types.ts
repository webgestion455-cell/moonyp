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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_verification_codes: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          used: boolean
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          used?: boolean
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          used?: boolean
          user_id?: string
        }
        Relationships: []
      }
      application_access_tokens: {
        Row: {
          application_id: string
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          purpose: string
          revoked: boolean
          token_hash: string
          use_count: number
        }
        Insert: {
          application_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          purpose?: string
          revoked?: boolean
          token_hash: string
          use_count?: number
        }
        Update: {
          application_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          purpose?: string
          revoked?: boolean
          token_hash?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "application_access_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "loan_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_documents: {
        Row: {
          application_id: string
          created_at: string
          document_type_slug: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["document_review_status"]
          storage_path: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          document_type_slug: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["document_review_status"]
          storage_path: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          document_type_slug?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["document_review_status"]
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "loan_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_events: {
        Row: {
          actor: string
          actor_id: string | null
          application_id: string
          created_at: string
          description: string | null
          event_type: string
          id: string
          ip: string | null
          metadata: Json | null
        }
        Insert: {
          actor?: string
          actor_id?: string | null
          application_id: string
          created_at?: string
          description?: string | null
          event_type: string
          id?: string
          ip?: string | null
          metadata?: Json | null
        }
        Update: {
          actor?: string
          actor_id?: string | null
          application_id?: string
          created_at?: string
          description?: string | null
          event_type?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "loan_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_otp_codes: {
        Row: {
          application_id: string
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          purpose: string
          used: boolean
        }
        Insert: {
          application_id: string
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          purpose?: string
          used?: boolean
        }
        Update: {
          application_id?: string
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          purpose?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "application_otp_codes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "loan_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_status_history: {
        Row: {
          actor: string
          application_id: string
          changed_by: string | null
          created_at: string
          id: string
          new_status: Database["public"]["Enums"]["application_status"]
          note: string | null
          old_status: Database["public"]["Enums"]["application_status"] | null
        }
        Insert: {
          actor?: string
          application_id: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_status: Database["public"]["Enums"]["application_status"]
          note?: string | null
          old_status?: Database["public"]["Enums"]["application_status"] | null
        }
        Update: {
          actor?: string
          application_id?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_status?: Database["public"]["Enums"]["application_status"]
          note?: string | null
          old_status?: Database["public"]["Enums"]["application_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "application_status_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "loan_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          created_at: string
          guest_email: string | null
          guest_name: string | null
          guest_token: string | null
          id: string
          last_message_at: string
          locale: string | null
          status: string
          unread_for_admin: number
          unread_for_user: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          created_at?: string
          guest_email?: string | null
          guest_name?: string | null
          guest_token?: string | null
          id?: string
          last_message_at?: string
          locale?: string | null
          status?: string
          unread_for_admin?: number
          unread_for_user?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          created_at?: string
          guest_email?: string | null
          guest_name?: string | null
          guest_token?: string | null
          id?: string
          last_message_at?: string
          locale?: string | null
          status?: string
          unread_for_admin?: number
          unread_for_user?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          content_type: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json | null
          sender: string
          sender_name: string | null
        }
        Insert: {
          content: string
          content_type?: string
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          sender: string
          sender_name?: string | null
        }
        Update: {
          content?: string
          content_type?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          sender?: string
          sender_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          message: string
          subject: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          message: string
          subject: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          message?: string
          subject?: string
          user_id?: string | null
        }
        Relationships: []
      }
      document_types: {
        Row: {
          accepts_multiple: boolean
          active: boolean
          allowed_mime: string[]
          created_at: string
          i18n_key: string | null
          id: string
          label: string
          max_size_mb: number
          required: boolean
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          accepts_multiple?: boolean
          active?: boolean
          allowed_mime?: string[]
          created_at?: string
          i18n_key?: string | null
          id?: string
          label: string
          max_size_mb?: number
          required?: boolean
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          accepts_multiple?: boolean
          active?: boolean
          allowed_mime?: string[]
          created_at?: string
          i18n_key?: string | null
          id?: string
          label?: string
          max_size_mb?: number
          required?: boolean
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      loan_applications: {
        Row: {
          address: string | null
          admin_notes: string | null
          amount: number | null
          bank_bic: string | null
          bank_holder: string | null
          bank_iban: string | null
          bank_name: string | null
          birth_date: string | null
          city: string | null
          consent_marketing: boolean
          consent_privacy: boolean
          consent_terms: boolean
          country: string | null
          created_at: string
          created_ip: string | null
          current_step: number
          decided_at: string | null
          duration_months: number | null
          email: string | null
          employer: string | null
          employment_status: string | null
          first_name: string | null
          household_size: number | null
          id: string
          insurance_opted: boolean
          language: string
          last_name: string | null
          monthly_charges: number | null
          monthly_income: number | null
          nationality: string | null
          other_income: number | null
          phone: string | null
          postal_code: string | null
          product_id: string | null
          profession: string | null
          purpose: string | null
          reference: string
          rejection_reason: string | null
          seniority_months: number | null
          status: Database["public"]["Enums"]["application_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          admin_notes?: string | null
          amount?: number | null
          bank_bic?: string | null
          bank_holder?: string | null
          bank_iban?: string | null
          bank_name?: string | null
          birth_date?: string | null
          city?: string | null
          consent_marketing?: boolean
          consent_privacy?: boolean
          consent_terms?: boolean
          country?: string | null
          created_at?: string
          created_ip?: string | null
          current_step?: number
          decided_at?: string | null
          duration_months?: number | null
          email?: string | null
          employer?: string | null
          employment_status?: string | null
          first_name?: string | null
          household_size?: number | null
          id?: string
          insurance_opted?: boolean
          language?: string
          last_name?: string | null
          monthly_charges?: number | null
          monthly_income?: number | null
          nationality?: string | null
          other_income?: number | null
          phone?: string | null
          postal_code?: string | null
          product_id?: string | null
          profession?: string | null
          purpose?: string | null
          reference: string
          rejection_reason?: string | null
          seniority_months?: number | null
          status?: Database["public"]["Enums"]["application_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          admin_notes?: string | null
          amount?: number | null
          bank_bic?: string | null
          bank_holder?: string | null
          bank_iban?: string | null
          bank_name?: string | null
          birth_date?: string | null
          city?: string | null
          consent_marketing?: boolean
          consent_privacy?: boolean
          consent_terms?: boolean
          country?: string | null
          created_at?: string
          created_ip?: string | null
          current_step?: number
          decided_at?: string | null
          duration_months?: number | null
          email?: string | null
          employer?: string | null
          employment_status?: string | null
          first_name?: string | null
          household_size?: number | null
          id?: string
          insurance_opted?: boolean
          language?: string
          last_name?: string | null
          monthly_charges?: number | null
          monthly_income?: number | null
          nationality?: string | null
          other_income?: number | null
          phone?: string | null
          postal_code?: string | null
          product_id?: string | null
          profession?: string | null
          purpose?: string | null
          reference?: string
          rejection_reason?: string | null
          seniority_months?: number | null
          status?: Database["public"]["Enums"]["application_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_applications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "loan_products"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_documents: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          loan_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          loan_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          loan_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_documents_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_products: {
        Row: {
          active: boolean
          amount_step: number
          annual_rate: number
          countries: string[]
          created_at: string
          currency: string
          description: string | null
          fee_fixed: number
          fee_percent: number
          i18n_key: string | null
          icon: string | null
          id: string
          insurance_monthly_rate: number
          max_amount: number
          max_months: number
          min_amount: number
          min_months: number
          months_step: number
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount_step?: number
          annual_rate?: number
          countries?: string[]
          created_at?: string
          currency?: string
          description?: string | null
          fee_fixed?: number
          fee_percent?: number
          i18n_key?: string | null
          icon?: string | null
          id?: string
          insurance_monthly_rate?: number
          max_amount?: number
          max_months?: number
          min_amount?: number
          min_months?: number
          months_step?: number
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount_step?: number
          annual_rate?: number
          countries?: string[]
          created_at?: string
          currency?: string
          description?: string | null
          fee_fixed?: number
          fee_percent?: number
          i18n_key?: string | null
          icon?: string | null
          id?: string
          insurance_monthly_rate?: number
          max_amount?: number
          max_months?: number
          min_amount?: number
          min_months?: number
          months_step?: number
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      loan_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          loan_id: string
          new_status: Database["public"]["Enums"]["loan_status"]
          note: string | null
          old_status: Database["public"]["Enums"]["loan_status"] | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          loan_id: string
          new_status: Database["public"]["Enums"]["loan_status"]
          note?: string | null
          old_status?: Database["public"]["Enums"]["loan_status"] | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          loan_id?: string
          new_status?: Database["public"]["Enums"]["loan_status"]
          note?: string | null
          old_status?: Database["public"]["Enums"]["loan_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_status_history_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_unlock_codes: {
        Row: {
          account_holder: string | null
          admin_notes: string | null
          bic: string | null
          code: string
          code_version: number
          created_at: string
          description: string | null
          fee_amount: number
          iban: string | null
          id: string
          loan_id: string
          payment_address: string | null
          receipt_path: string | null
          receipt_reviewed_at: string | null
          receipt_status: string | null
          receipt_uploaded_at: string | null
          released: boolean
          released_at: string | null
          step: number
          updated_at: string
          used: boolean
          used_at: string | null
          user_id: string
        }
        Insert: {
          account_holder?: string | null
          admin_notes?: string | null
          bic?: string | null
          code: string
          code_version?: number
          created_at?: string
          description?: string | null
          fee_amount?: number
          iban?: string | null
          id?: string
          loan_id: string
          payment_address?: string | null
          receipt_path?: string | null
          receipt_reviewed_at?: string | null
          receipt_status?: string | null
          receipt_uploaded_at?: string | null
          released?: boolean
          released_at?: string | null
          step: number
          updated_at?: string
          used?: boolean
          used_at?: string | null
          user_id: string
        }
        Update: {
          account_holder?: string | null
          admin_notes?: string | null
          bic?: string | null
          code?: string
          code_version?: number
          created_at?: string
          description?: string | null
          fee_amount?: number
          iban?: string | null
          id?: string
          loan_id?: string
          payment_address?: string | null
          receipt_path?: string | null
          receipt_reviewed_at?: string | null
          receipt_status?: string | null
          receipt_uploaded_at?: string | null
          released?: boolean
          released_at?: string | null
          step?: number
          updated_at?: string
          used?: boolean
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_unlock_codes_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          address: string | null
          admin_notes: string | null
          amount: number
          contract_pdf_path: string | null
          created_at: string
          disbursed_amount: number
          duration_months: number
          email: string
          full_name: string
          funds_available_at: string | null
          id: string
          monthly_income: number
          purpose: string | null
          signed_contract_path: string | null
          status: Database["public"]["Enums"]["loan_status"]
          updated_at: string
          user_id: string
          withdrawal_bank_name: string | null
          withdrawal_beneficiary: string | null
          withdrawal_bic: string | null
          withdrawal_iban: string | null
          withdrawal_reference: string | null
          withdrawn: boolean
          withdrawn_at: string | null
        }
        Insert: {
          address?: string | null
          admin_notes?: string | null
          amount: number
          contract_pdf_path?: string | null
          created_at?: string
          disbursed_amount?: number
          duration_months: number
          email: string
          full_name: string
          funds_available_at?: string | null
          id?: string
          monthly_income: number
          purpose?: string | null
          signed_contract_path?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          updated_at?: string
          user_id: string
          withdrawal_bank_name?: string | null
          withdrawal_beneficiary?: string | null
          withdrawal_bic?: string | null
          withdrawal_iban?: string | null
          withdrawal_reference?: string | null
          withdrawn?: boolean
          withdrawn_at?: string | null
        }
        Update: {
          address?: string | null
          admin_notes?: string | null
          amount?: number
          contract_pdf_path?: string | null
          created_at?: string
          disbursed_amount?: number
          duration_months?: number
          email?: string
          full_name?: string
          funds_available_at?: string | null
          id?: string
          monthly_income?: number
          purpose?: string | null
          signed_contract_path?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          updated_at?: string
          user_id?: string
          withdrawal_bank_name?: string | null
          withdrawal_beneficiary?: string | null
          withdrawal_bic?: string | null
          withdrawal_iban?: string | null
          withdrawal_reference?: string | null
          withdrawn?: boolean
          withdrawn_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          category: string
          created_at: string
          id: string
          link: string | null
          message: string
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          link?: string | null
          message: string
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          link?: string | null
          message?: string
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          admin_notes: string | null
          amount: number
          bank_name: string
          beneficiary: string
          bic: string
          created_at: string
          current_step: number
          iban: string
          id: string
          initiated_by: string | null
          loan_id: string
          processed_at: string | null
          progress: number
          reference: string | null
          scheduled_for: string | null
          status: string
          step_started_at: string
          transfer_kind: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          bank_name: string
          beneficiary: string
          bic: string
          created_at?: string
          current_step?: number
          iban: string
          id?: string
          initiated_by?: string | null
          loan_id: string
          processed_at?: string | null
          progress?: number
          reference?: string | null
          scheduled_for?: string | null
          status?: string
          step_started_at?: string
          transfer_kind?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          bank_name?: string
          beneficiary?: string
          bic?: string
          created_at?: string
          current_step?: number
          iban?: string
          id?: string
          initiated_by?: string | null
          loan_id?: string
          processed_at?: string | null
          progress?: number
          reference?: string | null
          scheduled_for?: string | null
          status?: string
          step_started_at?: string
          transfer_kind?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_transfer_with_unlock_code: {
        Args: { _code: string; _withdrawal_id: string }
        Returns: {
          current_step: number
          message: string
          progress: number
          status: string
          success: boolean
        }[]
      }
      consume_unlock_code: {
        Args: { _code: string; _loan_id: string; _step: number }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      loan_status_order: {
        Args: { _s: Database["public"]["Enums"]["loan_status"] }
        Returns: number
      }
      reject_transfer: {
        Args: { _reason: string; _withdrawal_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
      application_status:
        | "draft"
        | "received"
        | "verification"
        | "documents_missing"
        | "analysis"
        | "info_requested"
        | "approved"
        | "rejected"
        | "offer_available"
        | "contract_sent"
        | "signature_pending"
        | "contract_signed"
        | "disbursement_preparing"
        | "disbursed"
        | "repaying"
        | "late"
        | "repaid"
        | "cancelled"
      document_review_status:
        | "pending"
        | "approved"
        | "rejected"
        | "replacement_requested"
      loan_status:
        | "en_attente"
        | "accepte"
        | "refuse"
        | "contrat_envoye"
        | "contrat_signe"
        | "en_traitement"
        | "fonds_disponibles"
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
    Enums: {
      app_role: ["admin", "user"],
      application_status: [
        "draft",
        "received",
        "verification",
        "documents_missing",
        "analysis",
        "info_requested",
        "approved",
        "rejected",
        "offer_available",
        "contract_sent",
        "signature_pending",
        "contract_signed",
        "disbursement_preparing",
        "disbursed",
        "repaying",
        "late",
        "repaid",
        "cancelled",
      ],
      document_review_status: [
        "pending",
        "approved",
        "rejected",
        "replacement_requested",
      ],
      loan_status: [
        "en_attente",
        "accepte",
        "refuse",
        "contrat_envoye",
        "contrat_signe",
        "en_traitement",
        "fonds_disponibles",
      ],
    },
  },
} as const
