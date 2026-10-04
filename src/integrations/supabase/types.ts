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
      ai_insights_cache: {
        Row: {
          generated_at: string
          insights: Json
          passage: string
          user_id: string
          version_id: number
        }
        Insert: {
          generated_at?: string
          insights: Json
          passage: string
          user_id: string
          version_id: number
        }
        Update: {
          generated_at?: string
          insights?: Json
          passage?: string
          user_id?: string
          version_id?: number
        }
        Relationships: []
      }
      ai_usage_counters: {
        Row: {
          day_bucket: string
          day_count: number
          feature: string
          hour_bucket: string
          hour_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          day_bucket: string
          day_count?: number
          feature: string
          hour_bucket: string
          hour_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          day_bucket?: string
          day_count?: number
          feature?: string
          hour_bucket?: string
          hour_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chapter_notes: {
        Row: {
          note: string
          passage: string
          updated_at: string
          user_id: string
        }
        Insert: {
          note?: string
          passage: string
          updated_at?: string
          user_id: string
        }
        Update: {
          note?: string
          passage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chapter_studies: {
        Row: {
          completed_at: string | null
          intention: string | null
          passage: string
          prayer: string | null
          reflections: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          intention?: string | null
          passage: string
          prayer?: string | null
          reflections?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          intention?: string | null
          passage?: string
          prayer?: string | null
          reflections?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          body: string
          created_at: string
          id: string
          parent_id: string | null
          post_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          parent_id?: string | null
          post_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          post_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          body: string
          created_at: string
          excerpt: string | null
          id: string
          reference: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          excerpt?: string | null
          id?: string
          reference: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          excerpt?: string | null
          id?: string
          reference?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_reviews: {
        Row: {
          gratitude: string | null
          prayer: string | null
          review_date: string
          takeaway: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          gratitude?: string | null
          prayer?: string | null
          review_date: string
          takeaway?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          gratitude?: string | null
          prayer?: string | null
          review_date?: string
          takeaway?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reports: {
        Row: {
          created_at: string
          id: string
          post_id: string
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          reason: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_progress: {
        Row: {
          passage: string
          reading_date: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          passage: string
          reading_date: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          passage?: string
          reading_date?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      study_image_jobs: {
        Row: {
          created_at: string
          guide_hash: string
          id: string
          last_error: string | null
          passage: string
          prompt_version: string
          status: string
          updated_at: string
          user_id: string
          version_id: number
        }
        Insert: {
          created_at?: string
          guide_hash: string
          id?: string
          last_error?: string | null
          passage: string
          prompt_version: string
          status?: string
          updated_at?: string
          user_id: string
          version_id: number
        }
        Update: {
          created_at?: string
          guide_hash?: string
          id?: string
          last_error?: string | null
          passage?: string
          prompt_version?: string
          status?: string
          updated_at?: string
          user_id?: string
          version_id?: number
        }
        Relationships: []
      }
      study_images: {
        Row: {
          created_at: string
          guide_hash: string
          id: string
          job_id: string
          passage: string
          prompt_version: string
          selected_at: string
          storage_path: string
          user_id: string
          version_id: number
        }
        Insert: {
          created_at?: string
          guide_hash: string
          id?: string
          job_id: string
          passage: string
          prompt_version: string
          selected_at?: string
          storage_path: string
          user_id: string
          version_id: number
        }
        Update: {
          created_at?: string
          guide_hash?: string
          id?: string
          job_id?: string
          passage?: string
          prompt_version?: string
          selected_at?: string
          storage_path?: string
          user_id?: string
          version_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "study_images_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "study_image_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      study_plans: {
        Row: {
          active_tracks: Json
          chapters_per_day: number
          created_at: string
          id: string
          is_default: boolean
          name: string
          paused: boolean
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_tracks?: Json
          chapters_per_day: number
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          paused?: boolean
          start_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_tracks?: Json
          chapters_per_day?: number
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          paused?: boolean
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      study_video_scenes: {
        Row: {
          claim_type: string
          created_at: string
          id: string
          last_error: string | null
          narration: string
          narration_key: string | null
          narration_path: string | null
          narration_seconds: number | null
          narration_status: string
          role: string
          scene_index: number
          scripture_quote: string | null
          source_refs: Json
          tts_text: string | null
          updated_at: string
          user_id: string
          video_id: string
          visual_brief: string
          visual_job_id: string | null
          visual_key: string | null
          visual_kind: string
          visual_path: string | null
          visual_status: string
        }
        Insert: {
          claim_type: string
          created_at?: string
          id?: string
          last_error?: string | null
          narration: string
          narration_key?: string | null
          narration_path?: string | null
          narration_seconds?: number | null
          narration_status?: string
          role: string
          scene_index: number
          scripture_quote?: string | null
          source_refs?: Json
          tts_text?: string | null
          updated_at?: string
          user_id: string
          video_id: string
          visual_brief: string
          visual_job_id?: string | null
          visual_key?: string | null
          visual_kind: string
          visual_path?: string | null
          visual_status?: string
        }
        Update: {
          claim_type?: string
          created_at?: string
          id?: string
          last_error?: string | null
          narration?: string
          narration_key?: string | null
          narration_path?: string | null
          narration_seconds?: number | null
          narration_status?: string
          role?: string
          scene_index?: number
          scripture_quote?: string | null
          source_refs?: Json
          tts_text?: string | null
          updated_at?: string
          user_id?: string
          video_id?: string
          visual_brief?: string
          visual_job_id?: string | null
          visual_key?: string | null
          visual_kind?: string
          visual_path?: string | null
          visual_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_video_scenes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "study_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      study_videos: {
        Row: {
          call_budget: Json
          call_usage: Json
          created_at: string
          duration_seconds: number
          estimated_seconds: number | null
          guide_hash: string
          id: string
          kind: string
          last_error: string | null
          manifest: Json | null
          model: string
          passage: string
          plan_hash: string | null
          plan_title: string | null
          plan_version: string | null
          progress: number | null
          prompt_version: string
          provider: string
          provider_job_id: string | null
          scenes: Json
          selected_at: string
          stage: string | null
          stage_error: string | null
          status: string
          storage_path: string | null
          study_mode: string | null
          updated_at: string
          user_id: string
          version_id: number
        }
        Insert: {
          call_budget?: Json
          call_usage?: Json
          created_at?: string
          duration_seconds?: number
          estimated_seconds?: number | null
          guide_hash: string
          id?: string
          kind?: string
          last_error?: string | null
          manifest?: Json | null
          model: string
          passage: string
          plan_hash?: string | null
          plan_title?: string | null
          plan_version?: string | null
          progress?: number | null
          prompt_version: string
          provider?: string
          provider_job_id?: string | null
          scenes?: Json
          selected_at?: string
          stage?: string | null
          stage_error?: string | null
          status?: string
          storage_path?: string | null
          study_mode?: string | null
          updated_at?: string
          user_id: string
          version_id: number
        }
        Update: {
          call_budget?: Json
          call_usage?: Json
          created_at?: string
          duration_seconds?: number
          estimated_seconds?: number | null
          guide_hash?: string
          id?: string
          kind?: string
          last_error?: string | null
          manifest?: Json | null
          model?: string
          passage?: string
          plan_hash?: string | null
          plan_title?: string | null
          plan_version?: string | null
          progress?: number | null
          prompt_version?: string
          provider?: string
          provider_job_id?: string | null
          scenes?: Json
          selected_at?: string
          stage?: string | null
          stage_error?: string | null
          status?: string
          storage_path?: string | null
          study_mode?: string | null
          updated_at?: string
          user_id?: string
          version_id?: number
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          settings: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          settings?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          settings?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      verse_saves: {
        Row: {
          bookmarked: boolean
          created_at: string
          highlight: string | null
          id: string
          note: string | null
          passage: string
          reference: string
          updated_at: string
          user_id: string
          verse: string
          version_id: number
        }
        Insert: {
          bookmarked?: boolean
          created_at?: string
          highlight?: string | null
          id?: string
          note?: string | null
          passage: string
          reference: string
          updated_at?: string
          user_id: string
          verse: string
          version_id: number
        }
        Update: {
          bookmarked?: boolean
          created_at?: string
          highlight?: string | null
          id?: string
          note?: string | null
          passage?: string
          reference?: string
          updated_at?: string
          user_id?: string
          verse?: string
          version_id?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_ai_quota: { Args: { p_feature: string }; Returns: Json }
      consume_study_video_call: {
        Args: { p_kind: string; p_video_id: string }
        Returns: boolean
      }
      lock_study_video_plan: {
        Args: { p_plan_hash: string; p_title: string; p_video_id: string }
        Returns: boolean
      }
      reserve_study_image_job: {
        Args: {
          p_guide_hash: string
          p_passage: string
          p_prompt_version: string
          p_version_id: number
        }
        Returns: Json
      }
      reserve_study_sequence: {
        Args: {
          p_force?: boolean
          p_guide_hash: string
          p_mode: string
          p_passage: string
          p_version_id: number
        }
        Returns: Json
      }
      reserve_study_video_job: {
        Args: {
          p_guide_hash: string
          p_model: string
          p_passage: string
          p_prompt_version: string
          p_version_id: number
        }
        Returns: Json
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
