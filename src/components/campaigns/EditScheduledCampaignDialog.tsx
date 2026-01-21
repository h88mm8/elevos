import { useState, useEffect } from 'react';
import { Campaign } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar, Loader2, Save } from 'lucide-react';
import { format, setHours, setMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface EditScheduledCampaignDialogProps {
  campaign: Campaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updates: { name?: string; message?: string; subject?: string; schedule?: string }) => Promise<void>;
}

export function EditScheduledCampaignDialog({
  campaign,
  open,
  onOpenChange,
  onSave,
}: EditScheduledCampaignDialogProps) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (campaign) {
      setName(campaign.name);
      setMessage(campaign.message);
      setSubject(campaign.subject || '');
      if (campaign.schedule) {
        const date = new Date(campaign.schedule);
        setScheduleDate(date);
        setScheduleTime(format(date, 'HH:mm'));
      }
    }
  }, [campaign]);

  async function handleSave() {
    if (!campaign) return;

    setIsSaving(true);
    try {
      let scheduleISO: string | undefined;
      if (scheduleDate) {
        const [hours, minutes] = scheduleTime.split(':').map(Number);
        const scheduleDatetime = setMinutes(setHours(scheduleDate, hours), minutes);
        scheduleISO = scheduleDatetime.toISOString();
      }

      await onSave({
        name: name !== campaign.name ? name : undefined,
        message: message !== campaign.message ? message : undefined,
        subject: subject !== campaign.subject ? subject : undefined,
        schedule: scheduleISO,
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }

  if (!campaign) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Campanha Agendada</DialogTitle>
          <DialogDescription>
            Modifique os detalhes da campanha antes do envio
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nome</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {campaign.type === 'email' && (
            <div className="space-y-2">
              <Label htmlFor="edit-subject">Assunto</Label>
              <Input
                id="edit-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-message">Mensagem</Label>
            <Textarea
              id="edit-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data do envio</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {scheduleDate ? format(scheduleDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecionar'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={scheduleDate}
                    onSelect={setScheduleDate}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-time">Horário</Label>
              <Input
                id="edit-time"
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Fuso horário: {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Salvar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
