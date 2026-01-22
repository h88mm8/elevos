import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";
import { useUsageHistory } from "@/hooks/useUsageHistory";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
} from "recharts";

interface UsageChartProps {
  title?: string;
  description?: string;
}

export function UsageChart({ 
  title = "Uso dos últimos dias",
  description = "Histórico de buscas e enriquecimentos LinkedIn"
}: UsageChartProps) {
  const [days, setDays] = useState(7);
  const { data, isLoading, hasData } = useUsageHistory(days);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  // Transform data for recharts
  const chartData = data?.dates.map((date, i) => ({
    date,
    'Buscas': data.searchPages[i],
    'Enriquecimentos': data.enrichments[i],
    'Buscas bloqueadas': data.searchBlocked[i],
    'Enrich bloqueados': data.enrichBlocked[i],
  })) || [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={days === 7 ? "default" : "ghost"}
              size="sm"
              onClick={() => setDays(7)}
              className="h-7 px-2 text-xs"
            >
              7d
            </Button>
            <Button
              variant={days === 14 ? "default" : "ghost"}
              size="sm"
              onClick={() => setDays(14)}
              className="h-7 px-2 text-xs"
            >
              14d
            </Button>
            <Button
              variant={days === 30 ? "default" : "ghost"}
              size="sm"
              onClick={() => setDays(30)}
              className="h-7 px-2 text-xs"
            >
              30d
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            Sem uso no período selecionado
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 10 }} 
                className="fill-muted-foreground"
              />
              <YAxis 
                tick={{ fontSize: 10 }} 
                className="fill-muted-foreground"
                allowDecimals={false}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Legend 
                wrapperStyle={{ fontSize: '11px' }}
                iconSize={8}
              />
              <Line 
                type="monotone" 
                dataKey="Buscas" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line 
                type="monotone" 
                dataKey="Enriquecimentos" 
                stroke="hsl(var(--chart-2))" 
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line 
                type="monotone" 
                dataKey="Buscas bloqueadas" 
                stroke="hsl(var(--destructive))" 
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={{ r: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="Enrich bloqueados" 
                stroke="hsl(var(--chart-5))" 
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
