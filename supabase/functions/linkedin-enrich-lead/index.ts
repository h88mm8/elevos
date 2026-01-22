import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

function extractLinkedInPublicIdentifier(linkedinUrl: string): string | null {
  if (!linkedinUrl) return null;
  const match = linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/i);
  return match ? match[1] : null;
}

function extractCompanyIdentifier(companyUrl: string): string | null {
  if (!companyUrl) return null;
  const match = companyUrl.match(/linkedin\.com\/company\/([^\/\?]+)/i);
  return match ? match[1] : null;
}

// Parse headline to extract job title and company when not structured
function parseHeadline(headline: string): { jobTitle?: string; company?: string } {
  if (!headline) return {};
  
  // Common patterns: "Title at Company", "Title | Company", "Title @ Company", "Title - Company"
  // Also handles: "Something | Title at Company" (takes last part)
  
  // First, try to find "at Company" pattern which is most reliable
  const atPatterns = [
    /\|\s*(.+?)\s+at\s+(.+?)$/i,     // "Blurb | CEO at Optimal"
    /^(.+?)\s+at\s+(.+?)$/i,         // "CEO at Optimal"
    /\|\s*(.+?)\s+@\s+(.+?)$/i,      // "Blurb | CTO @ Startup"
    /^(.+?)\s+@\s+(.+?)$/i,          // "CTO @ Startup"
  ];
  
  for (const pattern of atPatterns) {
    const match = headline.match(pattern);
    if (match) {
      return { 
        jobTitle: match[1].trim(), 
        company: match[2].trim() 
      };
    }
  }
  
  // Try pipe separator as fallback (might be "Title | Company")
  const pipeMatch = headline.match(/^(.+?)\s*\|\s*(.+?)$/);
  if (pipeMatch) {
    // Check if second part looks like a company (starts with capital, no common title words)
    const secondPart = pipeMatch[2].trim();
    const titleWords = ['ceo', 'cto', 'cfo', 'founder', 'director', 'manager', 'head', 'vp', 'president'];
    const lowerSecond = secondPart.toLowerCase();
    const isLikelyCompany = !titleWords.some(w => lowerSecond.startsWith(w));
    
    if (isLikelyCompany && /^[A-Z]/.test(secondPart)) {
      return { jobTitle: pipeMatch[1].trim(), company: secondPart };
    }
  }
  
  // Try dash separator
  const dashMatch = headline.match(/^(.+?)\s+-\s+(.+?)$/);
  if (dashMatch) {
    const secondPart = dashMatch[2].trim();
    if (/^[A-Z]/.test(secondPart)) {
      return { jobTitle: dashMatch[1].trim(), company: secondPart };
    }
  }
  
  return {};
}

interface EnrichRequest {
  workspaceId: string;
  accountId: string;
  leadId: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Validate user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: EnrichRequest = await req.json();
    const { workspaceId, accountId, leadId } = body;

    if (!workspaceId || !accountId || !leadId) {
      return new Response(
        JSON.stringify({ error: "workspaceId, accountId, and leadId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate workspace membership
    const { data: member } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member) {
      return new Response(
        JSON.stringify({ error: "Not a member of this workspace" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get lead
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (leadError || !lead) {
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lead.linkedin_url) {
      return new Response(
        JSON.stringify({ error: "Lead does not have a LinkedIn URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate account - accountId can be UUID (id column) or Unipile account_id
    const { data: account } = await supabase
      .from("accounts")
      .select("id, account_id, status, channel")
      .eq("workspace_id", workspaceId)
      .eq("channel", "linkedin")
      .or(`id.eq.${accountId},account_id.eq.${accountId}`)
      .maybeSingle();

    if (!account || account.status !== "connected") {
      return new Response(
        JSON.stringify({ error: "LinkedIn account not found or not connected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use the Unipile account_id for API calls
    const unipileAccountId = account.account_id;

    // Check daily limits
    const { data: settings } = await supabase
      .from("workspace_settings")
      .select("linkedin_daily_profile_scrape_limit")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const dailyLimit = settings?.linkedin_daily_profile_scrape_limit ?? 50;
    const today = getTodayDate();

    const { data: currentUsage } = await serviceClient.rpc("get_daily_usage", {
      p_workspace_id: workspaceId,
      p_account_id: unipileAccountId,
      p_action: "linkedin_profile_scrape",
      p_usage_date: today,
    });

    if ((currentUsage ?? 0) >= dailyLimit) {
      return new Response(
        JSON.stringify({
          error: "Daily profile scrape limit reached",
          usage: { current: currentUsage, limit: dailyLimit },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract public identifier
    const publicIdentifier = extractLinkedInPublicIdentifier(lead.linkedin_url);
    if (!publicIdentifier) {
      return new Response(
        JSON.stringify({ error: "Invalid LinkedIn URL format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Unipile to get profile data
    const unipileDsn = Deno.env.get("UNIPILE_DSN")!;
    const unipileApiKey = Deno.env.get("UNIPILE_API_KEY")!;

    console.log("[linkedin-enrich-lead] Fetching profile for:", publicIdentifier);

    const profileResponse = await fetch(
      `https://${unipileDsn}/api/v1/users/${publicIdentifier}?account_id=${unipileAccountId}`,
      {
        method: "GET",
        headers: {
          "X-API-KEY": unipileApiKey,
        },
      }
    );

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      console.error("[linkedin-enrich-lead] Profile fetch error:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to fetch LinkedIn profile", details: errorText }),
        { status: profileResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const profileData = await profileResponse.json();
    console.log("[linkedin-enrich-lead] Full profile data:", JSON.stringify(profileData, null, 2));

    // Prepare update object
    const updateData: Record<string, unknown> = {
      enriched_at: new Date().toISOString(),
    };

    // Map profile fields according to Unipile API structure
    // Name fields - build full_name from first_name + last_name if not provided directly
    const firstName = profileData.first_name;
    const lastName = profileData.last_name;
    
    if (firstName) updateData.first_name = firstName;
    if (lastName) updateData.last_name = lastName;
    
    // Build full_name from parts or use direct name field
    if (firstName || lastName) {
      updateData.full_name = [firstName, lastName].filter(Boolean).join(' ');
    } else if (profileData.name) {
      updateData.full_name = profileData.name;
    }
    
    if (profileData.headline) updateData.headline = profileData.headline;
    if (profileData.industry) updateData.industry = profileData.industry;
    
    // Occupation is the primary source for job title in Unipile
    if (profileData.occupation) updateData.job_title = profileData.occupation;
    
    // Location parsing - handle string or object format
    const locationData = profileData.location;
    if (locationData) {
      if (typeof locationData === "string") {
        // Try to parse "City, State, Country" or "City, Country" format
        const parts = locationData.split(",").map((p: string) => p.trim());
        if (parts.length === 1) {
          // Just city or country
          updateData.city = parts[0];
        } else if (parts.length === 2) {
          // "City, Country" format (common for international)
          updateData.city = parts[0];
          updateData.country = parts[1];
        } else if (parts.length >= 3) {
          // "City, State, Country" format
          updateData.city = parts[0];
          updateData.state = parts[1];
          updateData.country = parts[2];
        }
      } else if (typeof locationData === "object") {
        if (locationData.city) updateData.city = locationData.city;
        if (locationData.state || locationData.region) updateData.state = locationData.state || locationData.region;
        if (locationData.country || locationData.country_name) updateData.country = locationData.country || locationData.country_name;
      }
    }

    // FALLBACK: Extract job_title and company from headline if not already set
    if (profileData.headline && (!updateData.job_title || !updateData.company)) {
      const parsed = parseHeadline(profileData.headline);
      if (!updateData.job_title && parsed.jobTitle) {
        updateData.job_title = parsed.jobTitle;
        console.log("[linkedin-enrich-lead] Job title extracted from headline:", parsed.jobTitle);
      }
      if (!updateData.company && parsed.company) {
        updateData.company = parsed.company;
        console.log("[linkedin-enrich-lead] Company extracted from headline:", parsed.company);
      }
    }

    // Experiences array - Unipile uses "experiences" not "current_positions"
    const experiences = profileData.experiences;
    if (experiences && Array.isArray(experiences) && experiences.length > 0) {
      const currentExperience = experiences[0];
      
      // If occupation wasn't set, use experience title
      if (!updateData.job_title && currentExperience.title) {
        updateData.job_title = currentExperience.title;
      }
      
      // Company info from experience - company is an object in Unipile
      if (currentExperience.company) {
        const company = currentExperience.company;
        if (typeof company === "object") {
          if (company.name) updateData.company = company.name;
          if (company.linkedin_url) updateData.company_linkedin = company.linkedin_url;
          if (company.logo_url) console.log("[linkedin-enrich-lead] Company logo available:", company.logo_url);
        } else if (typeof company === "string") {
          updateData.company = company;
        }
      } else if (currentExperience.company_name) {
        updateData.company = currentExperience.company_name;
      }
    }

    // Seniority
    if (profileData.seniority) updateData.seniority_level = profileData.seniority;

    // Email addresses - can be array or single value
    const emails = profileData.emails || profileData.email;
    if (emails) {
      if (Array.isArray(emails) && emails.length > 0) {
        // First email goes to main email field
        const primaryEmail = typeof emails[0] === 'object' ? emails[0].email || emails[0].address : emails[0];
        if (primaryEmail) updateData.email = primaryEmail;
        // Second email (if exists) goes to personal_email
        if (emails.length > 1) {
          const secondaryEmail = typeof emails[1] === 'object' ? emails[1].email || emails[1].address : emails[1];
          if (secondaryEmail) updateData.personal_email = secondaryEmail;
        }
      } else if (typeof emails === 'string') {
        updateData.email = emails;
      }
    }

    // Phone numbers - can be array or single value
    const phones = profileData.phone_numbers || profileData.phones || profileData.phone;
    if (phones) {
      if (Array.isArray(phones) && phones.length > 0) {
        // First phone goes to main phone field
        const primaryPhone = typeof phones[0] === 'object' ? phones[0].number || phones[0].phone : phones[0];
        if (primaryPhone) updateData.phone = primaryPhone;
        // Second phone (if exists) goes to mobile_number
        if (phones.length > 1) {
          const secondaryPhone = typeof phones[1] === 'object' ? phones[1].number || phones[1].phone : phones[1];
          if (secondaryPhone) updateData.mobile_number = secondaryPhone;
        } else if (primaryPhone && primaryPhone.toString().match(/^(\+55|55)?[1-9]{2}9/)) {
          // If single phone looks like mobile (Brazil format), also set as mobile
          updateData.mobile_number = primaryPhone;
        }
      } else if (typeof phones === 'string') {
        updateData.phone = phones;
      }
    }

    // Skills - store as comma-separated in keywords field
    const skills = profileData.skills;
    if (skills && Array.isArray(skills) && skills.length > 0) {
      const skillNames = skills.map((s: unknown) => {
        if (typeof s === 'string') return s;
        if (typeof s === 'object' && s !== null) {
          const skillObj = s as Record<string, unknown>;
          return skillObj.name || skillObj.skill || skillObj.title;
        }
        return null;
      }).filter(Boolean);
      
      if (skillNames.length > 0) {
        // Append to existing keywords or create new
        const existingKeywords = lead.keywords || '';
        const newKeywords = existingKeywords 
          ? `${existingKeywords}, ${skillNames.join(', ')}`
          : skillNames.join(', ');
        updateData.keywords = newKeywords;
        console.log("[linkedin-enrich-lead] Skills extracted:", skillNames.length);
      }
    }

    // Education - extract most recent for additional context
    const education = profileData.education || profileData.educations;
    if (education && Array.isArray(education) && education.length > 0) {
      const recentEdu = education[0];
      const eduInfo = [];
      if (recentEdu.school_name || recentEdu.school) {
        eduInfo.push(recentEdu.school_name || recentEdu.school);
      }
      if (recentEdu.degree) {
        eduInfo.push(recentEdu.degree);
      }
      if (recentEdu.field_of_study || recentEdu.field) {
        eduInfo.push(recentEdu.field_of_study || recentEdu.field);
      }
      if (eduInfo.length > 0) {
        console.log("[linkedin-enrich-lead] Education:", eduInfo.join(' - '));
      }
    }

    // Try to get company data if we have company LinkedIn
    const companyLinkedIn = updateData.company_linkedin as string || lead.company_linkedin;
    if (companyLinkedIn) {
      const companyIdentifier = extractCompanyIdentifier(companyLinkedIn);
      if (companyIdentifier) {
        console.log("[linkedin-enrich-lead] Fetching company data for:", companyIdentifier);
        
        try {
          const companyResponse = await fetch(
            `https://${unipileDsn}/api/v1/linkedin/company/${companyIdentifier}?account_id=${unipileAccountId}`,
            {
              method: "GET",
              headers: {
                "X-API-KEY": unipileApiKey,
              },
            }
          );

          if (companyResponse.ok) {
            const companyData = await companyResponse.json();
            console.log("[linkedin-enrich-lead] Company data received:", companyData.name);

            if (companyData.name) updateData.company = companyData.name;
            if (companyData.industry) updateData.company_industry = companyData.industry;
            if (companyData.company_size) updateData.company_size = companyData.company_size;
            if (companyData.description) updateData.company_description = companyData.description;
            if (companyData.website) updateData.company_website = companyData.website;
            if (companyData.founded_year) updateData.company_founded_year = companyData.founded_year;
            if (companyData.headquarters) {
              updateData.company_address = typeof companyData.headquarters === "string"
                ? companyData.headquarters
                : JSON.stringify(companyData.headquarters);
            }
          }
        } catch (companyError) {
          console.warn("[linkedin-enrich-lead] Company fetch failed:", companyError);
          // Continue without company data
        }
      }
    }

    // Update lead in database
    const { error: updateError } = await supabase
      .from("leads")
      .update(updateData)
      .eq("id", leadId);

    if (updateError) {
      console.error("[linkedin-enrich-lead] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update lead", details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Increment daily usage
    await serviceClient.rpc("increment_daily_usage", {
      p_workspace_id: workspaceId,
      p_account_id: unipileAccountId,
      p_action: "linkedin_profile_scrape",
      p_usage_date: today,
    });

    // Return enriched fields
    const enrichedFields = Object.keys(updateData).filter(k => k !== "enriched_at");

    return new Response(
      JSON.stringify({
        success: true,
        enrichedFields,
        data: updateData,
        connectionDegree: profileData.connection_degree,
        usage: {
          current: (currentUsage ?? 0) + 1,
          limit: dailyLimit,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[linkedin-enrich-lead] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
