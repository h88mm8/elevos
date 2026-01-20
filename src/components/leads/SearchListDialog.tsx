import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Search, Plus, FolderOpen } from 'lucide-react';
import { LeadList } from '@/types';

interface SearchListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (listId: string | null, newListName?: string, newListDescription?: string) => Promise<void>;
  lists: LeadList[];
  isLoading?: boolean;
}

export function SearchListDialog({
  open,
  onOpenChange,
  onConfirm,
  lists,
  isLoading = false,
}: SearchListDialogProps) {
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (mode === 'new') {
      if (!name.trim()) return;
      await onConfirm(null, name.trim(), description.trim() || undefined);
    } else {
      if (!selectedListId) return;
      await onConfirm(selectedListId);
    }
    
    // Reset form
    setMode('new');
    setSelectedListId(null);
    setName('');
    setDescription('');
  }

  function handleOpenChange(newOpen: boolean) {
    if (!isLoading) {
      onOpenChange(newOpen);
      if (!newOpen) {
        setMode('new');
        setSelectedListId(null);
        setName('');
        setDescription('');
      }
    }
  }

  const canSubmit = mode === 'new' ? name.trim() : selectedListId;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Buscar Leads
            </DialogTitle>
            <DialogDescription>
              Escolha onde salvar os leads encontrados.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            {/* Mode selector */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === 'new' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('new')}
                className="flex-1"
              >
                <Plus className="h-4 w-4 mr-1" />
                Nova Lista
              </Button>
              <Button
                type="button"
                variant={mode === 'existing' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('existing')}
                className="flex-1"
                disabled={lists.length === 0}
              >
                <FolderOpen className="h-4 w-4 mr-1" />
                Lista Existente
              </Button>
            </div>

            {mode === 'new' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="list-name">Nome da lista *</Label>
                  <Input
                    id="list-name"
                    placeholder="Ex: CEOs Brasil 2024"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isLoading}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="list-description">Descrição (opcional)</Label>
                  <Textarea
                    id="list-description"
                    placeholder="Detalhes sobre os filtros usados..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isLoading}
                    rows={2}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Selecione uma lista</Label>
                {lists.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nenhuma lista criada ainda.
                  </p>
                ) : (
                  <RadioGroup
                    value={selectedListId || ''}
                    onValueChange={setSelectedListId}
                    className="space-y-2 max-h-[200px] overflow-y-auto"
                  >
                    {lists.map(list => (
                      <div
                        key={list.id}
                        className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                      >
                        <RadioGroupItem value={list.id} id={list.id} />
                        <Label htmlFor={list.id} className="cursor-pointer flex-1">
                          <div>
                            <span className="font-medium">{list.name}</span>
                            {list.description && (
                              <p className="text-xs text-muted-foreground">{list.description}</p>
                            )}
                          </div>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit || isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Buscar Leads
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
