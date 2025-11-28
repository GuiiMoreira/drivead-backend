export class WeeklyPerformancePoint {
  day_label: string;
  impressions: number;
  intensity: number;
}

export class DashboardSummaryDto {
  active_campaigns_count: number;
  total_spent: number;
  total_budget: number;
  estimated_reach: number;
  total_km_driven: number;
  cars_active_now: number;
  cars_total_hired: number;
  weekly_performance: WeeklyPerformancePoint[];
}