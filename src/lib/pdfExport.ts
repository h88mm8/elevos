import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CampaignReportMetrics, CampaignLeadDetail } from '@/hooks/useCampaignReport';

interface PDFExportData {
  campaign: CampaignReportMetrics;
  leads: CampaignLeadDetail[];
}

const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  sent: 'Enviado',
  delivered: 'Entregue',
  seen: 'Visualizado',
  replied: 'Respondido',
  failed: 'Falhou',
};

export function exportCampaignReportPDF({ campaign, leads }: PDFExportData) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Colors
  const primaryColor = '#1a1a2e';
  const accentColor = '#3b82f6';
  const textColor = '#333333';
  const mutedColor = '#666666';

  let yPosition = 20;

  // ========== HEADER ==========
  // Logo/Brand
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor);
  doc.text('ELEV OS', 20, yPosition);
  
  // Subtitle
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(mutedColor);
  doc.text('Relatório de Campanha', 20, yPosition + 8);
  
  // Date
  doc.setFontSize(9);
  doc.text(
    `Gerado em ${format(new Date(), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}`,
    pageWidth - 20,
    yPosition,
    { align: 'right' }
  );

  yPosition += 25;

  // Divider line
  doc.setDrawColor(accentColor);
  doc.setLineWidth(0.5);
  doc.line(20, yPosition, pageWidth - 20, yPosition);

  yPosition += 15;

  // ========== CAMPAIGN INFO ==========
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor);
  doc.text(campaign.name, 20, yPosition);

  yPosition += 8;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(mutedColor);
  doc.text(
    `Tipo: ${campaign.type.toUpperCase()} • Criada em ${format(new Date(campaign.created_at), 'dd/MM/yyyy', { locale: ptBR })}`,
    20,
    yPosition
  );

  yPosition += 20;

  // ========== KPI CARDS ==========
  const cardWidth = (pageWidth - 60) / 4;
  const cardHeight = 35;
  const cardY = yPosition;
  
  const kpis = [
    { label: 'Enviados', value: campaign.sent_count, total: campaign.leads_count },
    { label: 'Entregues', value: campaign.delivered_count, rate: campaign.delivery_rate },
    { label: 'Visualizados', value: campaign.seen_count, rate: campaign.open_rate },
    { label: 'Respondidos', value: campaign.replied_count, rate: campaign.reply_rate },
  ];

  kpis.forEach((kpi, index) => {
    const cardX = 20 + (index * (cardWidth + 6.67));
    
    // Card background
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 3, 3, 'F');
    
    // Value
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(primaryColor);
    doc.text(String(kpi.value), cardX + 8, cardY + 15);
    
    // Label
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(mutedColor);
    doc.text(kpi.label, cardX + 8, cardY + 24);
    
    // Rate or total
    if (kpi.rate !== undefined) {
      doc.setFontSize(8);
      doc.setTextColor(accentColor);
      doc.text(`${kpi.rate.toFixed(1)}%`, cardX + 8, cardY + 31);
    } else if (kpi.total !== undefined) {
      doc.setFontSize(8);
      doc.setTextColor(mutedColor);
      doc.text(`de ${kpi.total}`, cardX + 8, cardY + 31);
    }
  });

  yPosition = cardY + cardHeight + 20;

  // ========== FUNNEL SECTION ==========
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor);
  doc.text('Funil de Conversão', 20, yPosition);

  yPosition += 10;

  const funnelData = [
    { label: 'Enviados', value: campaign.sent_count, max: campaign.leads_count, color: [59, 130, 246] },
    { label: 'Entregues', value: campaign.delivered_count, max: campaign.sent_count || 1, color: [34, 197, 94] },
    { label: 'Visualizados', value: campaign.seen_count, max: campaign.delivered_count || 1, color: [168, 85, 247] },
    { label: 'Respondidos', value: campaign.replied_count, max: campaign.seen_count || 1, color: [16, 185, 129] },
  ];

  funnelData.forEach((item, index) => {
    const barY = yPosition + (index * 12);
    const percentage = item.max > 0 ? (item.value / item.max) * 100 : 0;
    const barMaxWidth = pageWidth - 90;
    const barWidth = (percentage / 100) * barMaxWidth;

    // Label
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(textColor);
    doc.text(item.label, 20, barY + 6);

    // Background bar
    doc.setFillColor(230, 230, 230);
    doc.roundedRect(70, barY, barMaxWidth, 8, 2, 2, 'F');

    // Filled bar
    if (barWidth > 0) {
      doc.setFillColor(item.color[0], item.color[1], item.color[2]);
      doc.roundedRect(70, barY, Math.max(barWidth, 4), 8, 2, 2, 'F');
    }

    // Percentage
    doc.setFontSize(8);
    doc.setTextColor(mutedColor);
    doc.text(`${item.value} (${percentage.toFixed(1)}%)`, pageWidth - 20, barY + 6, { align: 'right' });
  });

  yPosition += 60;

  // ========== LEADS TABLE ==========
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor);
  doc.text('Detalhamento por Lead', 20, yPosition);

  yPosition += 8;

  const tableData = leads.map(lead => [
    lead.lead?.full_name || lead.lead?.first_name || 'Sem nome',
    lead.lead?.company || '-',
    statusLabels[lead.status] || lead.status,
    lead.sent_at ? format(new Date(lead.sent_at), 'dd/MM HH:mm', { locale: ptBR }) : '-',
    lead.replied_at 
      ? format(new Date(lead.replied_at), 'dd/MM HH:mm', { locale: ptBR }) 
      : lead.seen_at 
        ? format(new Date(lead.seen_at), 'dd/MM HH:mm', { locale: ptBR })
        : lead.delivered_at
          ? format(new Date(lead.delivered_at), 'dd/MM HH:mm', { locale: ptBR })
          : '-',
  ]);

  autoTable(doc, {
    startY: yPosition,
    head: [['Lead', 'Empresa', 'Status', 'Enviado', 'Último Evento']],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: [26, 26, 46],
      textColor: [255, 255, 255],
      fontSize: 9,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [51, 51, 51],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 20, right: 20 },
    styles: {
      cellPadding: 4,
    },
  });

  // ========== FOOTER ==========
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(mutedColor);
    doc.text(
      `Página ${i} de ${pageCount} • ELEV OS`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  // Save
  const filename = `relatorio-${campaign.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
  doc.save(filename);
}
