import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { useTags, Tag } from '@/hooks/useTags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Tag as TagIcon, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const TAG_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
  '#14b8a6', // teal
];

export default function Tags() {
  const { tags, isLoading, createTag, updateTag, deleteTag, leadTags } = useTags();
  const { toast } = useToast();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [deleteConfirmTag, setDeleteConfirmTag] = useState<Tag | null>(null);
  
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState(TAG_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Count leads per tag
  function getLeadCount(tagId: string): number {
    return leadTags.filter(lt => lt.tag_id === tagId).length;
  }

  function openCreateDialog() {
    setTagName('');
    setTagColor(TAG_COLORS[0]);
    setEditingTag(null);
    setCreateDialogOpen(true);
  }

  function openEditDialog(tag: Tag) {
    setTagName(tag.name);
    setTagColor(tag.color);
    setEditingTag(tag);
    setCreateDialogOpen(true);
  }

  async function handleSubmit() {
    if (!tagName.trim()) return;
    
    setIsSubmitting(true);
    try {
      if (editingTag) {
        await updateTag({ id: editingTag.id, name: tagName.trim(), color: tagColor });
        toast({
          title: 'Tag atualizada',
          description: `Tag "${tagName}" foi atualizada com sucesso.`,
        });
      } else {
        await createTag({ name: tagName.trim(), color: tagColor });
        toast({
          title: 'Tag criada',
          description: `Tag "${tagName}" foi criada com sucesso.`,
        });
      }
      setCreateDialogOpen(false);
      setTagName('');
      setEditingTag(null);
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirmTag) return;
    
    setIsSubmitting(true);
    try {
      await deleteTag(deleteConfirmTag.id);
      toast({
        title: 'Tag excluída',
        description: `Tag "${deleteConfirmTag.name}" foi excluída com sucesso.`,
      });
      setDeleteConfirmTag(null);
    } catch (error: any) {
      toast({
        title: 'Erro ao excluir',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Tags</h1>
            <p className="text-muted-foreground">
              Gerencie as tags para organizar seus leads
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Tag
          </Button>
        </div>

        {/* Tags Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TagIcon className="h-5 w-5" />
              Suas Tags
            </CardTitle>
            <CardDescription>
              {tags.length} tag{tags.length !== 1 ? 's' : ''} cadastrada{tags.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : tags.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <TagIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhuma tag criada ainda.</p>
                <p className="text-sm mt-1">
                  Crie tags para organizar seus leads em categorias.
                </p>
                <Button className="mt-4" onClick={openCreateDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  Criar primeira tag
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tag</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead>Leads</TableHead>
                    <TableHead>Criada em</TableHead>
                    <TableHead className="w-24">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tags.map((tag) => (
                    <TableRow key={tag.id}>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="text-sm px-3 py-1"
                          style={{
                            backgroundColor: `${tag.color}20`,
                            color: tag.color,
                            borderColor: tag.color,
                          }}
                        >
                          {tag.name}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-5 h-5 rounded-full border"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="text-sm text-muted-foreground font-mono">
                            {tag.color}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{getLeadCount(tag.id)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(tag.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditDialog(tag)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirmTag(tag)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTag ? 'Editar Tag' : 'Nova Tag'}</DialogTitle>
            <DialogDescription>
              {editingTag 
                ? 'Altere o nome ou a cor da tag.'
                : 'Crie uma nova tag para organizar seus leads.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome da tag</label>
              <Input
                placeholder="Ex: Cliente Potencial, VIP, Follow-up..."
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Cor</label>
              <div className="flex flex-wrap gap-2">
                {TAG_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`w-8 h-8 rounded-full transition-all ${
                      tagColor === color 
                        ? 'ring-2 ring-offset-2 ring-primary scale-110' 
                        : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setTagColor(color)}
                  />
                ))}
              </div>
            </div>

            <div className="pt-2">
              <label className="text-sm font-medium">Preview</label>
              <div className="mt-2">
                <Badge
                  variant="secondary"
                  className="text-sm px-3 py-1"
                  style={{
                    backgroundColor: `${tagColor}20`,
                    color: tagColor,
                    borderColor: tagColor,
                  }}
                >
                  {tagName || 'Nome da tag'}
                </Badge>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || !tagName.trim()}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingTag ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmTag} onOpenChange={() => setDeleteConfirmTag(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tag?</AlertDialogTitle>
            <AlertDialogDescription>
              A tag "{deleteConfirmTag?.name}" será removida de todos os leads.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
