

# Plano: Simplificar Arquitetura de Enriquecimento LinkedIn

## Objetivo
Criar uma estrutura mais simples e estável com dois fluxos claros:
1. **Unipile (Básico)** = Busca + Enriquecimento padrão (automático, sempre junto)
2. **Apify (Deep Enrich)** = Enriquecimento profundo com TODOS os campos

---

## Análise da Situação Atual

### Fluxo Atual (Complexo)
```text
┌─────────────────────────────────────────────────────────────────┐
│ 1. LinkedIn Search (Unipile) → Retorna resultados básicos       │
│ 2. Adicionar leads → Salva no banco com dados mínimos           │
│ 3. Enrich Lead (Unipile) → Chamada separada para enriquecer     │
│ 4. Deep Enrich (Apify) → Enriquecimento profundo opcional       │
└─────────────────────────────────────────────────────────────────┘
```

### Fluxo Proposto (Simples)
```text
┌─────────────────────────────────────────────────────────────────┐
│ 1. LinkedIn Search + Enrich (Unipile)                           │
│    → Busca + Enriquece AUTOMATICAMENTE em uma operação          │
│    → Lead salvo já com todos dados básicos do Unipile           │
│                                                                 │
│ 2. Deep Enrich (Apify) - Quando usuário solicitar               │
│    → Enriquecimento profundo com TODOS os 20+ campos            │
│    → Email search incluído por padrão                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Campos do Apify que NÃO Estamos Capturando Atualmente

Com base no output de exemplo do actor HarvestAPI, identificamos campos que precisam ser mapeados:

| Campo Apify | Status Atual | Ação |
|-------------|--------------|------|
| `openToWork` | ❌ Não capturado | Adicionar coluna `open_to_work` |
| `hiring` | ❌ Não capturado | Adicionar coluna `is_hiring` |
| `premium` | ❌ Não capturado | Adicionar coluna `linkedin_premium` |
| `influencer` | ❌ Não capturado | Adicionar coluna `linkedin_influencer` |
| `verified` | ❌ Não capturado | Adicionar coluna `linkedin_verified` |
| `registeredAt` | ❌ Não capturado | Adicionar coluna `linkedin_registered_at` |
| `photo` | ❌ Não capturado | Adicionar coluna `profile_picture_url` |
| `topSkills` | ❌ Não capturado | Usar junto com `skills` |
| `publications` | ❌ Não capturado | Armazenar no `raw_json` |
| `courses` | ❌ Não capturado | Armazenar no `raw_json` |
| `patents` | ❌ Não capturado | Armazenar no `raw_json` |
| `volunteering` | ❌ Não capturado | Armazenar no `raw_json` |

---

## Implementação Detalhada

### 1. Migração do Banco de Dados

Adicionar novos campos na tabela `leads`:

```sql
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS open_to_work BOOLEAN DEFAULT NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS is_hiring BOOLEAN DEFAULT NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS linkedin_premium BOOLEAN DEFAULT NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS linkedin_influencer BOOLEAN DEFAULT NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS linkedin_verified BOOLEAN DEFAULT NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS linkedin_registered_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS profile_picture_url TEXT DEFAULT NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS top_skills TEXT DEFAULT NULL;
```

### 2. Modificar `linkedin-search/index.ts`

**Mudança Principal**: Após buscar resultados, enriquecer cada perfil automaticamente ANTES de retornar.

```typescript
// Após obter resultados da busca
for (const result of searchData.items) {
  const publicIdentifier = result.public_identifier;
  if (publicIdentifier) {
    // Enriquecer perfil automaticamente
    const profileResponse = await fetch(
      `https://${unipileDsn}/api/v1/users/${publicIdentifier}?account_id=${unipileAccountId}`,
      { headers: { "X-API-KEY": unipileApiKey } }
    );
    
    if (profileResponse.ok) {
      const profileData = await profileResponse.json();
      // Merge dados enriquecidos no resultado
      result.enrichedProfile = profileData;
    }
  }
}
```

### 3. Refatorar `process-enrichment-jobs/index.ts`

**Capturar TODOS os campos do Apify**:

```typescript
const updateData: Record<string, unknown> = {
  // Identidade
  first_name: profile.firstName,
  last_name: profile.lastName,
  full_name: fullName,
  headline: profile.headline,
  about: profile.about,
  profile_picture_url: profile.photo,
  
  // Status LinkedIn
  open_to_work: profile.openToWork ?? false,
  is_hiring: profile.hiring ?? false,
  linkedin_premium: profile.premium ?? false,
  linkedin_influencer: profile.influencer ?? false,
  linkedin_verified: profile.verified ?? false,
  linkedin_registered_at: profile.registeredAt,
  
  // Profissional
  company: currentExperience?.companyName || profile.currentPosition?.[0]?.companyName,
  job_title: currentExperience?.position,
  
  // Localização
  city: location.city,
  state: location.state,
  country: location.country,
  
  // Skills (array + top skills string)
  skills: profile.skills?.map((s) => s.name),
  top_skills: profile.topSkills,
  
  // Métricas sociais
  connections: profile.connectionsCount,
  followers: profile.followerCount,
  
  // Contato (prioridade para dados não existentes)
  email: matchingLead.email || profile.email,
  phone: matchingLead.phone || profile.phone,
  
  // Timestamp
  last_enriched_at: new Date().toISOString(),
};
```

### 4. Atualizar Interface `Lead` em `src/types/index.ts`

```typescript
export interface Lead {
  // ... campos existentes ...
  
  // Novos campos de status LinkedIn
  open_to_work: boolean | null;
  is_hiring: boolean | null;
  linkedin_premium: boolean | null;
  linkedin_influencer: boolean | null;
  linkedin_verified: boolean | null;
  linkedin_registered_at: string | null;
  profile_picture_url: string | null;
  top_skills: string | null;
}
```

### 5. Exibir Novos Campos no `LeadDetailsDrawer`

Adicionar badges visuais para status:

```tsx
// Após o nome/headline
<div className="flex flex-wrap gap-1 mt-2">
  {lead.linkedin_premium && (
    <Badge className="bg-yellow-500">Premium</Badge>
  )}
  {lead.linkedin_verified && (
    <Badge className="bg-blue-500">Verificado</Badge>
  )}
  {lead.open_to_work && (
    <Badge className="bg-green-500">Open to Work</Badge>
  )}
  {lead.is_hiring && (
    <Badge className="bg-purple-500">Hiring</Badge>
  )}
  {lead.linkedin_influencer && (
    <Badge className="bg-orange-500">Influencer</Badge>
  )}
</div>
```

### 6. Exibir Avatar no Drawer

```tsx
// Header com avatar
<div className="flex items-center gap-4">
  {lead.profile_picture_url ? (
    <img 
      src={lead.profile_picture_url} 
      alt={lead.full_name || "Profile"}
      className="w-16 h-16 rounded-full object-cover border-2 border-primary"
    />
  ) : (
    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
      <User className="h-8 w-8 text-muted-foreground" />
    </div>
  )}
  <div>
    <SheetTitle>{lead.full_name}</SheetTitle>
    {/* Tags e headline */}
  </div>
</div>
```

---

## Resumo das Alterações por Arquivo

| Arquivo | Alteração |
|---------|-----------|
| **Migração SQL** | Adicionar 8 novas colunas na tabela `leads` |
| `process-enrichment-jobs/index.ts` | Mapear TODOS os campos do Apify (20+ campos) |
| `linkedin-search/index.ts` | (Opcional) Auto-enriquecer durante busca |
| `src/types/index.ts` | Adicionar novos campos na interface `Lead` |
| `LeadDetailsDrawer.tsx` | Exibir avatar e badges de status |
| `LinkedInAdvancedSection.tsx` | Já preparado para exibir dados adicionais |

---

## Garantia de Estabilidade

1. **Fail-safe**: Se enriquecimento falhar durante busca, retorna resultado básico sem erro
2. **Idempotência**: Campos não sobrescrevem dados existentes (email/phone)
3. **Raw JSON preservado**: `linkedin_profiles.raw_json` mantém dados completos para auditoria
4. **Quota atômica**: Sistema de quota existente continua funcionando

---

## Benefícios

- **Simplicidade**: 2 operações claras (Busca+Básico vs Deep)
- **Dados completos**: 100% dos campos do Apify capturados
- **UX melhorada**: Avatar e badges visuais imediatos
- **Estabilidade**: Fallbacks e tratamento de erros em cada etapa

