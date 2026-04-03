import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export const renderDashboardTool = new DynamicStructuredTool({
  name: 'render_dashboard',
  description: `Render an interactive dashboard in the preview panel.

WHEN TO USE: Call this whenever the user wants to SEE data visually — charts,
tables, metrics, dashboards, reports. If you fetched data with SQL and the user
wants to visualize it, call this tool.

REQUIREMENTS FOR jsx_code:
- Must be a complete, self-contained React component
- Must have a default export: export default function DashboardName() { ... }
- ALL data must be embedded directly in the component as a const
- Use ONLY these libraries: React (hooks), Recharts, Lucide React, Tailwind CSS
- No TypeScript — plain JSX only
- No external API calls, no fetch, no localStorage
- Must include a Google Font import via <style> tag

The component renders in a sandboxed iframe with React 18, Recharts,
Lucide React, and Tailwind CSS pre-loaded.`,
  schema: z.object({
    jsx_code: z
      .string()
      .describe(
        'Complete React JSX component as a string. Must be valid JSX with a default export.',
      ),
    title: z
      .string()
      .optional()
      .default('Dashboard')
      .describe('Dashboard title shown in the preview panel header.'),
    description: z
      .string()
      .optional()
      .default('')
      .describe('Brief description of what the dashboard shows.'),
  }),
  func: async ({ title, description }) => {
    return `Dashboard '${title}' has been rendered in the preview panel. The user can now see: ${description}`;
  },
});
