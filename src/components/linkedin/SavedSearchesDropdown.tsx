import { useState } from 'react';
import { SavedSearch } from '@/hooks/useSavedSearches';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  BookmarkPlus, 
  ChevronDown, 
  Clock, 
  Play, 
  Trash2, 
  Share2,
  Loader2
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface SavedSearchesDropdownProps {
  searches: SavedSearch[];
  isLoading: boolean;
  isSaving: boolean;
  onLoad: (search: SavedSearch) => void;
  onSave: (name: string, isShared: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  hasActiveFilters: boolean;
}

export function SavedSearchesDropdown({
  searches,
  isLoading,
  isSaving,
  onLoad,
  onSave,
  onDelete,
  hasActiveFilters,
}: SavedSearchesDropdownProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newSearchName, setNewSearchName] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleSave = async () => {
    if (!newSearchName.trim()) return;
    await onSave(newSearchName.trim(), isShared);
    setNewSearchName('');
    setIsShared(false);
    setSaveDialogOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await onDelete(deleteId);
    setDeleteId(null);
  };

  return (
    <>
      <div className="flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={isLoading}>
              <BookmarkPlus className="h-4 w-4 mr-2" />
              Pesquisas Salvas
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {searches.length === 0 ? (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                Nenhuma pesquisa salva
              </div>
            ) : (
              searches.map(search => (
                <DropdownMenuItem
                  key={search.id}
                  className="flex items-start gap-2 p-2 cursor-pointer"
                  onClick={() => onLoad(search)}
                >
                  <Play className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-medium truncate">{search.name}</span>
                      {search.is_shared && (
                        <Share2 className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                    {search.last_run_at && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(search.last_run_at), { 
                          addSuffix: true,
                          locale: ptBR 
                        })}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteId(search.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </DropdownMenuItem>
              ))
            )}
            {hasActiveFilters && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setSaveDialogOpen(true)}
                  className="cursor-pointer"
                >
                  <BookmarkPlus className="h-4 w-4 mr-2" />
                  Salvar pesquisa atual
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Save Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar Pesquisa</DialogTitle>
            <DialogDescription>
              Salve os filtros atuais para usar novamente depois.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="search-name">Nome da pesquisa</Label>
              <Input
                id="search-name"
                value={newSearchName}
                onChange={e => setNewSearchName(e.target.value)}
                placeholder="Ex: CEOs São Paulo"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-shared"
                checked={isShared}
                onCheckedChange={(checked) => setIsShared(!!checked)}
              />
              <Label htmlFor="is-shared" className="text-sm font-normal">
                Compartilhar com o workspace
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={!newSearchName.trim() || isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir pesquisa?</DialogTitle>
            <DialogDescription>
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
