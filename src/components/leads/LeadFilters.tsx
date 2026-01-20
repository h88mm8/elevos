import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X, Filter } from 'lucide-react';
import { Lead, LeadList, LeadFilters as LeadFiltersType } from '@/types';

interface LeadFiltersProps {
  filters: LeadFiltersType;
  onFiltersChange: (filters: LeadFiltersType) => void;
  leads: Lead[];
  lists: LeadList[];
}

export function LeadFilters({ filters, onFiltersChange, leads, lists }: LeadFiltersProps) {
  // Extract unique values from leads for select options
  const uniqueIndustries = useMemo(() => {
    const industries = leads
      .map(l => l.industry)
      .filter((v): v is string => !!v);
    return [...new Set(industries)].sort();
  }, [leads]);

  const uniqueCountries = useMemo(() => {
    const countries = leads
      .map(l => l.country)
      .filter((v): v is string => !!v);
    return [...new Set(countries)].sort();
  }, [leads]);

  const hasFilters = filters.company || filters.jobTitle || filters.industry || filters.country || filters.listId;

  function clearFilters() {
    onFiltersChange({
      company: '',
      jobTitle: '',
      industry: '',
      country: '',
      listId: null,
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 p-4 bg-muted/30 rounded-lg border">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Filter className="h-4 w-4" />
        Filtros
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-list" className="text-xs">Lista</Label>
        <Select
          value={filters.listId || 'all'}
          onValueChange={(v) => onFiltersChange({ ...filters, listId: v === 'all' ? null : v })}
        >
          <SelectTrigger id="filter-list" className="w-[180px] h-9">
            <SelectValue placeholder="Todas as listas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as listas</SelectItem>
            <SelectItem value="no-list">Sem lista</SelectItem>
            {lists.map(list => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-company" className="text-xs">Empresa</Label>
        <Input
          id="filter-company"
          placeholder="Filtrar por empresa..."
          value={filters.company}
          onChange={(e) => onFiltersChange({ ...filters, company: e.target.value })}
          className="w-[150px] h-9"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-job" className="text-xs">Cargo</Label>
        <Input
          id="filter-job"
          placeholder="Filtrar por cargo..."
          value={filters.jobTitle}
          onChange={(e) => onFiltersChange({ ...filters, jobTitle: e.target.value })}
          className="w-[150px] h-9"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-industry" className="text-xs">Indústria</Label>
        <Select
          value={filters.industry || 'all'}
          onValueChange={(v) => onFiltersChange({ ...filters, industry: v === 'all' ? '' : v })}
        >
          <SelectTrigger id="filter-industry" className="w-[150px] h-9">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {uniqueIndustries.map(industry => (
              <SelectItem key={industry} value={industry}>
                {industry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-country" className="text-xs">País</Label>
        <Select
          value={filters.country || 'all'}
          onValueChange={(v) => onFiltersChange({ ...filters, country: v === 'all' ? '' : v })}
        >
          <SelectTrigger id="filter-country" className="w-[150px] h-9">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {uniqueCountries.map(country => (
              <SelectItem key={country} value={country}>
                {country}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
          <X className="h-4 w-4 mr-1" />
          Limpar
        </Button>
      )}
    </div>
  );
}
