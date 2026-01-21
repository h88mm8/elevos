import { useState } from 'react';
import { useTags, Tag } from '@/hooks/useTags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Plus, Tag as TagIcon, X, Check, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface LeadTagsPopoverProps {
  leadId: string;
  children?: React.ReactNode;
}

const TAG_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export function LeadTagsPopover({ leadId, children }: LeadTagsPopoverProps) {
  const { tags, getLeadTags, createTag, addTagToLead, removeTagFromLead } = useTags();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const [loading, setLoading] = useState(false);

  const leadTags = getLeadTags(leadId);
  const leadTagIds = new Set(leadTags.map(t => t.id));

  async function handleToggleTag(tag: Tag) {
    setLoading(true);
    try {
      if (leadTagIds.has(tag.id)) {
        await removeTagFromLead({ leadId, tagId: tag.id });
      } else {
        await addTagToLead({ leadId, tagId: tag.id });
      }
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    
    setLoading(true);
    try {
      const tag = await createTag({ name: newTagName.trim(), color: newTagColor });
      await addTagToLead({ leadId, tagId: tag.id });
      setNewTagName('');
      setCreating(false);
      toast({
        title: 'Tag criada',
        description: `Tag "${tag.name}" criada e adicionada ao lead.`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao criar tag',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children || (
          <Button variant="ghost" size="sm" className="h-7 px-2">
            <TagIcon className="h-3.5 w-3.5" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {creating ? (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Nova Tag</span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6"
                onClick={() => setCreating(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Input
              placeholder="Nome da tag"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
            />
            <div className="flex flex-wrap gap-1.5">
              {TAG_COLORS.map(color => (
                <button
                  key={color}
                  className={`w-6 h-6 rounded-full transition-all ${
                    newTagColor === color ? 'ring-2 ring-offset-2 ring-primary' : ''
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => setNewTagColor(color)}
                />
              ))}
            </div>
            <Button 
              size="sm" 
              className="w-full" 
              onClick={handleCreateTag}
              disabled={loading || !newTagName.trim()}
            >
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Criar Tag
            </Button>
          </div>
        ) : (
          <Command>
            <CommandInput placeholder="Buscar tags..." />
            <CommandList>
              <CommandEmpty>
                <span className="text-sm text-muted-foreground">Nenhuma tag encontrada</span>
              </CommandEmpty>
              <CommandGroup>
                {tags.map(tag => (
                  <CommandItem
                    key={tag.id}
                    onSelect={() => handleToggleTag(tag)}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: tag.color }}
                      />
                      <span>{tag.name}</span>
                    </div>
                    {leadTagIds.has(tag.id) && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="p-2 border-t">
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-start"
                onClick={() => setCreating(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Criar nova tag
              </Button>
            </div>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Component to display tags inline
export function LeadTagsBadges({ leadId, showEmpty = false }: { leadId: string; showEmpty?: boolean }) {
  const { getLeadTags } = useTags();
  const leadTags = getLeadTags(leadId);

  if (leadTags.length === 0 && !showEmpty) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {leadTags.map(tag => (
        <Badge
          key={tag.id}
          variant="secondary"
          className="text-xs px-1.5 py-0 h-5"
          style={{ 
            backgroundColor: `${tag.color}20`,
            color: tag.color,
            borderColor: tag.color,
          }}
        >
          {tag.name}
        </Badge>
      ))}
    </div>
  );
}
