-- Adicionar novos campos à tabela leads para armazenar todos os dados do Apify

-- Dados pessoais adicionais
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS personal_email text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS mobile_number text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS headline text;

-- Nível e setor
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS seniority_level text;

-- Localização detalhada
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS state text;

-- Dados da empresa
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_website text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_domain text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_linkedin text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_size text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_industry text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_annual_revenue text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_description text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_founded_year integer;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_phone text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_address text;

-- Metadados adicionais
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS keywords text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_technologies text;