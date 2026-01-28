
# Plano: Busca LinkedIn com Enriquecimento Unipile Automático

## Objetivo
Quando o usuário fizer uma busca no LinkedIn, automaticamente enriquecer cada resultado via Unipile antes de retornar, trazendo dados completos em vez de dados básicos.

## Dados que Serão Trazidos Automaticamente

| Campo | Origem |
|-------|--------|
| `first_name`, `last_name`, `full_name` | Perfil Unipile |
| `headline` | Perfil Unipile |
| `job_title` (occupation ou experience[0]) | Perfil Unipile |
| `company`, `company_linkedin` | Experience Unipile |
| `industry`, `seniority_level` | Perfil Unipile |
| `city`, `state`, `country` | Location Unipile |
| `email`, `personal_email` | Contatos Unipile |
| `phone`, `mobile_number` | Contatos Unipile |
| `skills` (keywords) | Skills array Unipile |
| `company_industry`, `company_size`, `company_website` | Company endpoint |

## Arquitetura Proposta

```text
┌─────────────────────────────────────────────────────────────────┐
│                     FLUXO ATUAL                                  │
├─────────────────────────────────────────────────────────────────┤
│ Busca → Dados Básicos → Importa → Enriquece Manualmente         │
└─────────────────────────────────────────────────────────────────┘

                              ↓

┌─────────────────────────────────────────────────────────────────┐
│                     FLUXO NOVO                                   │
├─────────────────────────────────────────────────────────────────┤
│ Busca → Para cada resultado:                                     │
│         └─→ Chama /users/{public_identifier} (paralelo)         │
│         └─→ Mescla dados enriquecidos                           │
│ → Retorna lista com dados completos                             │
└─────────────────────────────────────────────────────────────────┘
```

## Implementação Técnica

### 1. Modificar `linkedin-search/index.ts`

**Adicionar função de enriquecimento inline:**
```typescript
async function enrichProfile(
  unipileDsn: string,
  unipileApiKey: string,
  accountId: string,
  publicIdentifier: string
): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    `https://${unipileDsn}/api/v1/users/${publicIdentifier}?account_id=${accountId}`,
    { method: "GET", headers: { "X-API-KEY": unipileApiKey } }
  );
  if (!response.ok) return null;
  return await response.json();
}
```

**Processar resultados em paralelo (após linha ~396):**
```typescript
// Enriquecer cada resultado em paralelo
const enrichedResults = await Promise.allSettled(
  searchData.items.map(async (item) => {
    const publicId = item.public_identifier;
    if (!publicId) return transformBasicResult(item);
    
    const enriched = await enrichProfile(unipileDsn, unipileApiKey, accountId, publicId);
    return mergeEnrichedData(item, enriched);
  })
);

// Filtrar resultados bem sucedidos
const results = enrichedResults
  .filter(r => r.status === 'fulfilled')
  .map(r => r.value);
```

**Função para mesclar dados:**
```typescript
function mergeEnrichedData(searchItem: any, enrichedData: any): EnrichedResult {
  return {
    // Dados da busca
    provider_id: searchItem.id,
    public_identifier: searchItem.public_identifier,
    profile_url: `https://linkedin.com/in/${searchItem.public_identifier}`,
    profile_picture_url: enrichedData?.profile_picture || searchItem.profile_picture,
    connection_degree: searchItem.connection_degree,
    
    // Dados enriquecidos (com fallback para busca)
    first_name: enrichedData?.first_name || searchItem.first_name,
    last_name: enrichedData?.last_name || searchItem.last_name,
    full_name: enrichedData?.name || searchItem.name,
    headline: enrichedData?.headline || searchItem.headline,
    industry: enrichedData?.industry,
    job_title: enrichedData?.occupation || extractJobTitle(enrichedData?.experiences),
    company: extractCompany(enrichedData?.experiences) || searchItem.current_company?.name,
    company_linkedin: extractCompanyLinkedIn(enrichedData?.experiences),
    seniority_level: enrichedData?.seniority,
    
    // Location
    city: extractCity(enrichedData?.location),
    state: extractState(enrichedData?.location),
    country: extractCountry(enrichedData?.location),
    
    // Contatos
    email: extractEmail(enrichedData?.emails),
    phone: extractPhone(enrichedData?.phone_numbers),
    
    // Skills
    keywords: extractSkills(enrichedData?.skills),
  };
}
```

### 2. Atualizar Frontend (`LinkedInSearch.tsx`)

**Expandir interface `LinkedInSearchResult`:**
```typescript
interface LinkedInSearchResult {
  // Existentes
  provider_id?: string;
  public_identifier?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  profile_url?: string;
  profile_picture_url?: string;
  location?: string;
  connection_degree?: string;
  company?: string;
  job_title?: string;
  
  // Novos (enriquecimento automático)
  industry?: string;
  seniority_level?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
  company_linkedin?: string;
  keywords?: string;
}
```

**Atualizar importação de leads (linha ~342):**
```typescript
const leadsToInsert = selectedResults.map(lead => ({
  workspace_id: currentWorkspace.id,
  list_id: targetListId,
  full_name: lead.full_name,
  first_name: lead.first_name,
  last_name: lead.last_name,
  headline: lead.headline,
  linkedin_url: lead.profile_url,
  linkedin_public_identifier: lead.public_identifier,
  linkedin_provider_id: lead.provider_id,
  city: lead.city,
  state: lead.state,
  country: lead.country,
  company: lead.company,
  company_linkedin: lead.company_linkedin,
  job_title: lead.job_title,
  industry: lead.industry,
  seniority_level: lead.seniority_level,
  email: lead.email,
  phone: lead.phone,
  keywords: lead.keywords,
  last_enriched_at: new Date().toISOString(), // Marca como enriquecido
}));
```

### 3. Atualizar UI dos Resultados

**Exibir mais campos no card de resultado:**
- Email (se disponível) com ícone
- Telefone (se disponível) com ícone
- Industry badge
- Skills como tags

### 4. Decisões de Quota

**Opção A - Quota Única (Recomendado):**
- Consumir apenas `linkedin_search_page`
- O enriquecimento é parte do processo de busca
- Mais simples para o usuário entender

**Opção B - Quotas Separadas:**
- `linkedin_search_page` para a busca
- `linkedin_enrich` × N para cada resultado enriquecido
- Mais complexo, pode frustrar usuários

## Considerações de Performance

1. **Paralelização**: Usar `Promise.allSettled` para não bloquear se um enriquecimento falhar
2. **Timeout**: Adicionar timeout de 5s por enriquecimento para não travar
3. **Fallback**: Se enriquecimento falhar, retornar dados básicos da busca
4. **Limite**: Máximo de 25 resultados = 25 chamadas paralelas (aceitável)

## Tempo Estimado de Resposta

- Busca atual: ~1-2 segundos
- Busca + Enriquecimento: ~3-8 segundos (paralelo)
- Adicionar loading state com progresso

## Arquivos a Modificar

1. `supabase/functions/linkedin-search/index.ts` - Adicionar lógica de enriquecimento
2. `src/hooks/useLinkedInSearch.ts` - Atualizar interface de resultados
3. `src/pages/LinkedInSearch.tsx` - Atualizar importação e exibição
4. Remover botão "Básico" do `LeadDetailsDrawer.tsx` (opcional - já vem enriquecido)

## Resultado Final

O usuário fará uma busca e receberá leads com:
- Nome completo, cargo, empresa
- Localização (cidade, estado, país)
- Email e telefone (quando disponíveis)
- Industry e seniority
- Skills como keywords
- Todos prontos para importar e usar em campanhas
