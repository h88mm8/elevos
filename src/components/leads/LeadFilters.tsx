import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { X, Filter, Plus, Tag } from 'lucide-react';
import { Lead, LeadList, LeadFilters as LeadFiltersType } from '@/types';
import { CreateListDialog } from './CreateListDialog';
import { useTags, Tag as TagType } from '@/hooks/useTags';

interface LeadFiltersProps {
  filters: LeadFiltersType;
  onFiltersChange: (filters: LeadFiltersType) => void;
  leads: Lead[];
  lists: LeadList[];
  onCreateList?: (name: string, description?: string) => Promise<void>;
}

export function LeadFilters({ filters, onFiltersChange, leads, lists, onCreateList }: LeadFiltersProps) {
  const [createListOpen, setCreateListOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { tags } = useTags();

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

  const hasFilters = filters.company || filters.jobTitle || filters.industry || filters.country || filters.listId || filters.tagIds.length > 0;

  function clearFilters() {
    onFiltersChange({
      company: '',
      jobTitle: '',
      industry: '',
      country: '',
      listId: null,
      tagIds: [],
    });
  }

  function toggleTagFilter(tagId: string) {
    const newTagIds = filters.tagIds.includes(tagId)
      ? filters.tagIds.filter(id => id !== tagId)
      : [...filters.tagIds, tagId];
    onFiltersChange({ ...filters, tagIds: newTagIds });
  }

  async function handleCreateList(name: string, description?: string) {
    if (!onCreateList) return;
    setIsCreating(true);
    try {
      await onCreateList(name, description);
      setCreateListOpen(false);
    } finally {
      setIsCreating(false);
    }
  }

  const selectedTags = tags.filter(t => filters.tagIds.includes(t.id));

  return (
    <>
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

        {/* Tag Filter */}
        <div className="space-y-1">
          <Label className="text-xs">Tags</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 min-w-[120px] justify-start">
                <Tag className="h-4 w-4 mr-2" />
                {selectedTags.length > 0 ? (
                  <span>{selectedTags.length} tag{selectedTags.length > 1 ? 's' : ''}</span>
                ) : (
                  <span className="text-muted-foreground">Todas</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
              <div className="space-y-2">
                <p className="text-sm font-medium">Filtrar por tags</p>
                {tags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma tag criada</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-auto">
                    {tags.map(tag => (
                      <label
                        key={tag.id}
                        className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded"
                      >
                        <Checkbox
                          checked={filters.tagIds.includes(tag.id)}
                          onCheckedChange={() => toggleTagFilter(tag.id)}
                        />
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="text-sm">{tag.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Display selected tags */}
        {selectedTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedTags.map(tag => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="text-xs cursor-pointer hover:opacity-80"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                }}
                onClick={() => toggleTagFilter(tag.id)}
              >
                {tag.name}
                <X className="h-3 w-3 ml-1" />
              </Badge>
            ))}
          </div>
        )}

        {onCreateList && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateListOpen(true)}
            className="h-9"
          >
            <Plus className="h-4 w-4 mr-1" />
            Nova Lista
          </Button>
        )}

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

      <CreateListDialog
        open={createListOpen}
        onOpenChange={setCreateListOpen}
        onConfirm={handleCreateList}
        isLoading={isCreating}
      />
    </>
  );
}
