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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, FolderInput } from 'lucide-react';
import { LeadList } from '@/types';

interface MoveLeadsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (listId: string | null) => Promise<void>;
  lists: LeadList[];
  selectedCount: number;
  isLoading?: boolean;
}

export function MoveLeadsDialog({
  open,
  onOpenChange,
  onConfirm,
  lists,
  selectedCount,
  isLoading = false,
}: MoveLeadsDialogProps) {
  const [selectedListId, setSelectedListId] = useState<string>('no-list');

  async function handleConfirm() {
    const listId = selectedListId === 'no-list' ? null : selectedListId;
    await onConfirm(listId);
    setSelectedListId('no-list');
  }

  function handleOpenChange(newOpen: boolean) {
    if (!isLoading) {
      onOpenChange(newOpen);
      if (!newOpen) {
        setSelectedListId('no-list');
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-5 w-5" />
            Mover Leads
          </DialogTitle>
          <DialogDescription>
            Mover {selectedCount} lead{selectedCount !== 1 ? 's' : ''} para outra lista.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <RadioGroup
            value={selectedListId}
            onValueChange={setSelectedListId}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="no-list" id="no-list" />
              <Label htmlFor="no-list" className="cursor-pointer flex-1">
                Sem lista
              </Label>
            </div>
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
          {lists.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma lista criada ainda. Crie uma lista ao fazer uma nova busca.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Movendo...
              </>
            ) : (
              'Mover'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
