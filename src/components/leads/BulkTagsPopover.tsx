import { useState } from 'react';
import { useTags, Tag } from '@/hooks/useTags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Tag as TagIcon, Plus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BulkTagsPopoverProps {
  selectedLeadIds: string[];
  onComplete?: () => void;
}

const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', 
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#64748b',
];

export function BulkTagsPopover({ selectedLeadIds, onComplete }: BulkTagsPopoverProps) {
  const { tags, createTag, addTagToLead } = useTags();
  const [open, setOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  
  // New tag creation
  const [showNewTag, setShowNewTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  const [isCreating, setIsCreating] = useState(false);

  function toggleTag(tagId: string) {
    const next = new Set(selectedTagIds);
    if (next.has(tagId)) {
      next.delete(tagId);
    } else {
      next.add(tagId);
    }
    setSelectedTagIds(next);
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    
    setIsCreating(true);
    try {
      const newTag = await createTag({ name: newTagName.trim(), color: newTagColor });
      setSelectedTagIds(prev => new Set(prev).add(newTag.id));
      setNewTagName('');
      setShowNewTag(false);
    } catch (error) {
      console.error('Error creating tag:', error);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleApplyTags() {
    if (selectedTagIds.size === 0 || selectedLeadIds.length === 0) return;
    
    setIsApplying(true);
    try {
      // Apply all selected tags to all selected leads
      const promises: Promise<any>[] = [];
      for (const leadId of selectedLeadIds) {
        for (const tagId of selectedTagIds) {
          promises.push(addTagToLead({ leadId, tagId }));
        }
      }
      await Promise.all(promises);
      
      setOpen(false);
      setSelectedTagIds(new Set());
      onComplete?.();
    } catch (error) {
      console.error('Error applying tags:', error);
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <TagIcon className="mr-2 h-4 w-4" />
          Tags ({selectedLeadIds.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-3">
          <div className="font-medium text-sm">
            Aplicar tags em {selectedLeadIds.length} leads
          </div>
          
          {/* Existing tags */}
          {tags.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {tags.map((tag) => (
                <label
                  key={tag.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                >
                  <Checkbox
                    checked={selectedTagIds.has(tag.id)}
                    onCheckedChange={() => toggleTag(tag.id)}
                  />
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-sm truncate">{tag.name}</span>
                </label>
              ))}
            </div>
          )}
          
          {/* New tag form */}
          {showNewTag ? (
            <div className="space-y-2 pt-2 border-t">
              <Input
                placeholder="Nome da tag"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="h-8 text-sm"
              />
              <div className="flex flex-wrap gap-1">
                {TAG_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewTagColor(color)}
                    className={cn(
                      "w-5 h-5 rounded-full transition-all",
                      newTagColor === color && "ring-2 ring-offset-1 ring-primary"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7 text-xs"
                  onClick={() => setShowNewTag(false)}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="flex-1 h-7 text-xs"
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim() || isCreating}
                >
                  {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Criar'}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setShowNewTag(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova tag
            </Button>
          )}
          
          {/* Apply button */}
          <Button
            className="w-full"
            size="sm"
            onClick={handleApplyTags}
            disabled={selectedTagIds.size === 0 || isApplying}
          >
            {isApplying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Aplicando...
              </>
            ) : (
              <>
                Aplicar {selectedTagIds.size > 0 && `(${selectedTagIds.size})`} tags
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
