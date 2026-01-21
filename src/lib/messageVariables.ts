import { Lead } from '@/types';

export interface MessageVariable {
  variable: string;
  field: keyof Lead;
  label: string;
  description: string;
}

export const MESSAGE_VARIABLES: MessageVariable[] = [
  { variable: '{{nome}}', field: 'full_name', label: 'Nome Completo', description: 'Nome completo do lead' },
  { variable: '{{primeiro_nome}}', field: 'first_name', label: 'Primeiro Nome', description: 'Primeiro nome do lead' },
  { variable: '{{sobrenome}}', field: 'last_name', label: 'Sobrenome', description: 'Sobrenome do lead' },
  { variable: '{{email}}', field: 'email', label: 'Email', description: 'Email do lead' },
  { variable: '{{celular}}', field: 'mobile_number', label: 'Celular', description: 'Número de celular' },
  { variable: '{{empresa}}', field: 'company', label: 'Empresa', description: 'Nome da empresa' },
  { variable: '{{cargo}}', field: 'job_title', label: 'Cargo', description: 'Cargo atual' },
  { variable: '{{cidade}}', field: 'city', label: 'Cidade', description: 'Cidade do lead' },
  { variable: '{{estado}}', field: 'state', label: 'Estado', description: 'Estado/região' },
  { variable: '{{pais}}', field: 'country', label: 'País', description: 'País do lead' },
  { variable: '{{linkedin}}', field: 'linkedin_url', label: 'LinkedIn', description: 'URL do perfil LinkedIn' },
  { variable: '{{industria}}', field: 'industry', label: 'Indústria', description: 'Setor/indústria' },
];

/**
 * Substitui as variáveis de template pelos valores do lead
 */
export function replaceVariables(message: string, lead: Partial<Lead>): string {
  let result = message;
  
  for (const { variable, field } of MESSAGE_VARIABLES) {
    const value = lead[field];
    result = result.split(variable).join(value ? String(value) : '');
  }
  
  return result;
}

/**
 * Retorna uma prévia da mensagem usando um lead de exemplo
 */
export function getMessagePreview(message: string, lead?: Partial<Lead>): string {
  const exampleLead: Partial<Lead> = lead || {
    full_name: 'João Silva',
    first_name: 'João',
    last_name: 'Silva',
    email: 'joao@exemplo.com',
    mobile_number: '+55 11 99999-9999',
    company: 'Empresa Exemplo',
    job_title: 'CEO',
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
    linkedin_url: 'https://linkedin.com/in/joaosilva',
    industry: 'Tecnologia',
  };
  
  return replaceVariables(message, exampleLead);
}

/**
 * Insere uma variável no texto na posição do cursor
 */
export function insertVariable(
  text: string, 
  variable: string, 
  cursorPosition: number
): { newText: string; newCursorPosition: number } {
  const before = text.substring(0, cursorPosition);
  const after = text.substring(cursorPosition);
  const newText = before + variable + after;
  const newCursorPosition = cursorPosition + variable.length;
  
  return { newText, newCursorPosition };
}
