import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { CampaignPerformance } from '@/hooks/useCampaignPerformance';

interface CampaignChartsProps {
  performance: CampaignPerformance;
}

const CHANNEL_COLORS = {
  email: 'hsl(217, 91%, 60%)',     // blue
  linkedin: 'hsl(199, 89%, 48%)',  // sky
  whatsapp: 'hsl(142, 71%, 45%)',  // green
};

const STATUS_COLORS = {
  delivered: 'hsl(142, 71%, 45%)',  // green
  seen: 'hsl(199, 89%, 48%)',       // sky
  replied: 'hsl(262, 83%, 58%)',    // purple
  failed: 'hsl(0, 84%, 60%)',       // red
};

export function CampaignDistributionChart({ performance }: CampaignChartsProps) {
  const data = [
    { name: 'Email', value: performance.email.totalCampaigns, color: CHANNEL_COLORS.email },
    { name: 'LinkedIn', value: performance.linkedin.totalCampaigns, color: CHANNEL_COLORS.linkedin },
    { name: 'WhatsApp', value: performance.whatsapp.totalCampaigns, color: CHANNEL_COLORS.whatsapp },
  ].filter(d => d.value > 0);

  const totalCampaigns = data.reduce((sum, d) => sum + d.value, 0);

  if (performance.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Distribuição por Canal</CardTitle>
      </CardHeader>
      <CardContent>
        {totalCampaigns === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            Nenhuma campanha ainda
          </div>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => [`${value} campanhas`, '']}
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ChannelComparisonChart({ performance }: CampaignChartsProps) {
  const data = [
    {
      name: 'Email',
      Enviados: performance.email.sent,
      Entregues: performance.email.delivered,
      Respondidos: performance.email.replied,
    },
    {
      name: 'LinkedIn',
      Enviados: performance.linkedin.sent,
      Entregues: performance.linkedin.delivered,
      Respondidos: performance.linkedin.replied,
    },
    {
      name: 'WhatsApp',
      Enviados: performance.whatsapp.sent,
      Entregues: performance.whatsapp.delivered,
      Respondidos: performance.whatsapp.replied,
    },
  ];

  const hasData = data.some(d => d.Enviados > 0 || d.Entregues > 0 || d.Respondidos > 0);

  if (performance.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Comparativo por Canal</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            Nenhum dado de envio ainda
          </div>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <XAxis 
                  dataKey="name" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => value.toLocaleString('pt-BR')}
                />
                <Tooltip 
                  formatter={(value: number) => value.toLocaleString('pt-BR')}
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Bar dataKey="Enviados" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Entregues" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Respondidos" fill="hsl(262, 83%, 58%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConversionRatesChart({ performance }: CampaignChartsProps) {
  const data = [
    {
      name: 'Email',
      'Taxa Entrega': performance.email.deliveryRate,
      'Taxa Abertura': performance.email.openRate,
      'Taxa Resposta': performance.email.replyRate,
    },
    {
      name: 'LinkedIn',
      'Taxa Entrega': performance.linkedin.deliveryRate,
      'Taxa Abertura': performance.linkedin.openRate,
      'Taxa Resposta': performance.linkedin.replyRate,
    },
    {
      name: 'WhatsApp',
      'Taxa Entrega': performance.whatsapp.deliveryRate,
      'Taxa Abertura': performance.whatsapp.openRate,
      'Taxa Resposta': performance.whatsapp.replyRate,
    },
  ];

  const hasData = data.some(d => 
    d['Taxa Entrega'] > 0 || d['Taxa Abertura'] > 0 || d['Taxa Resposta'] > 0
  );

  if (performance.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Taxas de Conversão (%)</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            Nenhum dado de conversão ainda
          </div>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <XAxis 
                  dataKey="name" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip 
                  formatter={(value: number) => `${value.toFixed(1)}%`}
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Bar dataKey="Taxa Entrega" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Taxa Abertura" fill="hsl(199, 89%, 48%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Taxa Resposta" fill="hsl(262, 83%, 58%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
