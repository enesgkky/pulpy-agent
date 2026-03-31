---
name: business-intelligence
description: "Use this skill when the user asks to analyze data, create reports, build dashboards, generate charts, calculate KPIs, or perform any business intelligence task. Covers data analysis, visualization, metric calculation, and insight generation."
---

# Business Intelligence Skill

This skill provides a structured approach to business intelligence tasks: data analysis, KPI calculation, report generation, and visualization creation.

## When to Use This Skill

Use this skill when the user asks to:

- Analyze a dataset (CSV, JSON, Excel)
- Calculate business metrics or KPIs
- Create charts, graphs, or dashboards
- Generate a business report
- Compare performance across periods/segments
- Identify trends, anomalies, or patterns
- Build a data summary or executive brief

## Instructions

### 1. Understand the Data

Before any analysis:

1. **Read the data file** using `read_file` to understand structure
2. **Identify columns**: What fields exist? Types? (numeric, categorical, date)
3. **Check data quality**: Missing values, outliers, inconsistencies
4. **Ask clarifying questions** if the analysis goal is ambiguous:
   - What time period?
   - Which segments/dimensions to compare?
   - What decisions will this analysis inform?

### 2. Analysis Workflow

Follow this systematic process:

**Step 1 - Data Preparation**:
- Load and parse the data
- Handle missing values (document your approach)
- Convert types as needed (dates, numbers)
- Create derived fields if useful (year, quarter, category groups)

**Step 2 - Descriptive Statistics**:
- Count, sum, average, median, min, max for key metrics
- Distribution analysis for important fields
- Group-by summaries for categorical dimensions

**Step 3 - Comparative Analysis**:
- Period-over-period comparison (MoM, QoQ, YoY)
- Segment comparison (by region, product, channel)
- Benchmark against targets if provided

**Step 4 - Trend & Pattern Detection**:
- Time series trends (growth, decline, seasonality)
- Correlation between metrics
- Outlier identification with context

### 3. Key Business Metrics

Calculate these metrics when relevant to the data:

**Revenue & Sales**:
- Total Revenue, Average Order Value (AOV)
- Revenue Growth Rate = (Current - Previous) / Previous * 100
- Revenue per Customer = Total Revenue / Unique Customers

**Customer Metrics**:
- Customer Acquisition Cost (CAC)
- Customer Lifetime Value (CLV)
- Churn Rate = Lost Customers / Total Customers * 100
- Retention Rate = 1 - Churn Rate

**Operational**:
- Conversion Rate = Conversions / Total Visitors * 100
- Average Response Time
- Fulfillment Rate = Completed Orders / Total Orders * 100

**Financial**:
- Gross Margin = (Revenue - COGS) / Revenue * 100
- Net Profit Margin = Net Income / Revenue * 100
- ROI = (Gain - Cost) / Cost * 100
- Burn Rate (for startups)

### 4. Visualization with Code

When charts are needed, generate code using one of these approaches:

**Option A - HTML + Chart.js** (self-contained, recommended):
```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <canvas id="chart"></canvas>
  <script>
    new Chart(document.getElementById('chart'), {
      type: 'bar', // or 'line', 'pie', 'doughnut', 'radar'
      data: {
        labels: ['Q1', 'Q2', 'Q3', 'Q4'],
        datasets: [{
          label: 'Revenue ($)',
          data: [12000, 19000, 15000, 22000],
          backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']
        }]
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: 'Quarterly Revenue' } }
      }
    });
  </script>
</body>
</html>
```

**Option B - Python with matplotlib** (if Python sandbox available):
```python
import matplotlib.pyplot as plt
import json

data = json.loads(open('data.json').read())
plt.figure(figsize=(10, 6))
plt.bar(labels, values)
plt.title('Chart Title')
plt.savefig('chart.png', dpi=150, bbox_inches='tight')
```

**Option C - CSV/Markdown table** (for simple data):
```markdown
| Quarter | Revenue | Growth |
|---------|---------|--------|
| Q1 2025 | $12,000 | -      |
| Q2 2025 | $19,000 | +58.3% |
| Q3 2025 | $15,000 | -21.1% |
| Q4 2025 | $22,000 | +46.7% |
```

### 5. Report Structure

When generating a full report, follow this template:

```markdown
# [Report Title]
**Period**: [Date Range]
**Prepared**: [Date]

## Executive Summary
- 3-5 bullet points of key findings
- Lead with the most important insight

## Key Metrics
| Metric | Current | Previous | Change |
|--------|---------|----------|--------|
| ...    | ...     | ...      | +/-XX% |

## Analysis

### [Section 1: Main Finding]
[Data-backed narrative with specific numbers]

### [Section 2: Secondary Finding]
[Supporting analysis]

## Trends & Patterns
- [Trend 1 with evidence]
- [Trend 2 with evidence]

## Recommendations
1. [Action item based on data]
2. [Action item based on data]
3. [Action item based on data]

## Appendix
[Detailed tables, methodology notes]
```

### 6. Output Files

Save analysis outputs to the sandbox:

- `report.md` - Main analysis report
- `summary.json` - Structured metrics data
- `chart.html` - Interactive visualization (if charts created)
- `data_cleaned.csv` - Processed dataset (if data was transformed)

### 7. Quality Checklist

Before delivering analysis:

- [ ] Numbers are accurate and verified with source data
- [ ] Percentages and growth rates are calculated correctly
- [ ] Comparisons use consistent time periods
- [ ] Missing data is acknowledged, not hidden
- [ ] Insights are actionable, not just descriptive
- [ ] Visualizations have titles, labels, and legends
- [ ] Report uses the user's language (Turkish if user writes in Turkish)
