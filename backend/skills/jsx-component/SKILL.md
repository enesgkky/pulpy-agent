---
name: jsx-component
description: >
  Use this skill when the user asks to create, build, or generate a React/JSX UI component. Covers component architecture, styling with Tailwind CSS, accessibility, responsive design, and interactive patterns. Outputs production-ready TSX code.
---

# JSX Component Builder

This skill guides you through creating production-ready React components with TypeScript and Tailwind CSS.

## When to Use This Skill

Use this skill when the user asks to:

- Create a React/JSX/TSX component
- Build a UI element (button, card, modal, form, table, etc.)
- Generate a page layout or section
- Create an interactive widget or dashboard component
- Convert a design description into code

## Instructions

### 1. Clarify Requirements

Before writing code, identify:

- **Component type**: What UI element is needed?
- **Data**: What props/data does it receive?
- **Interactions**: Click handlers, form submissions, hover states?
- **Responsiveness**: Mobile-first? Breakpoints needed?

### 2. Component Architecture Rules

Follow these conventions strictly:

**File naming**: `kebab-case.tsx` (e.g., `user-profile-card.tsx`)

**Component naming**: PascalCase (e.g., `UserProfileCard`)

**Structure every component like this**:

```tsx
// 1. Imports
import { useState } from "react";

// 2. Type definitions
interface ComponentNameProps {
  // explicit prop types, no `any`
}

// 3. Component
export function ComponentName({ prop1, prop2 }: ComponentNameProps) {
  // hooks first
  // derived state
  // handlers
  // render
  return (
    <div>
      {/* JSX */}
    </div>
  );
}
```

### 3. Styling Guidelines

- Use **Tailwind CSS** utility classes exclusively
- Use `cn()` helper from `@/lib/utils` for conditional classes
- Follow mobile-first responsive design: `base` -> `sm:` -> `md:` -> `lg:`
- Use CSS variables for theme colors: `bg-background`, `text-foreground`, `bg-primary`, etc.
- Avoid inline styles

**Spacing scale**: Use Tailwind's consistent spacing (`p-2`, `p-4`, `gap-4`, `space-y-2`)

**Typography**: Use `text-sm`, `text-base`, `text-lg`, `font-medium`, `font-semibold`

### 4. Interactivity Patterns

**State management**:
- Local state with `useState` for UI-only state
- Lift state up for shared data between siblings
- Use `useCallback` only when passing handlers to memoized children

**Forms**:
- Controlled inputs with `useState`
- Validate on submit, show inline errors
- Disable submit button while loading

**Loading states**:
- Show skeleton/spinner during async operations
- Disable interactive elements while loading
- Provide visual feedback for user actions

### 5. Accessibility Requirements

Every component MUST include:

- Semantic HTML elements (`<button>`, `<nav>`, `<main>`, `<section>`, not `<div>` for everything)
- `aria-label` on icon-only buttons
- Keyboard navigation support (focusable elements, Enter/Space handlers)
- Sufficient color contrast (use theme variables)
- `role` attributes where semantic HTML is insufficient

### 6. Common Component Patterns

**Card**:
```tsx
<div className="rounded-lg border bg-card p-4 shadow-sm">
  <h3 className="font-semibold">{title}</h3>
  <p className="text-sm text-muted-foreground">{description}</p>
</div>
```

**Responsive grid**:
```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>
```

**Modal/Dialog**: Use Radix UI primitives when available, otherwise:
```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
  <div className="rounded-lg bg-background p-6 shadow-lg">
    {children}
  </div>
</div>
```

### 7. Output Format

When creating a component:

1. Write the component file to the sandbox filesystem
2. If the component has subcomponents, put them in the same file or create a folder
3. Include a brief usage example showing how to import and use the component
4. If props are complex, add JSDoc comments on the interface

### 8. Quality Checklist

Before delivering the component, verify:

- [ ] TypeScript types are complete (no `any`)
- [ ] Component is responsive (test mental model for mobile/tablet/desktop)
- [ ] Interactive elements have hover/focus states
- [ ] Loading and empty states are handled
- [ ] Accessibility basics are covered
- [ ] No hardcoded colors (use theme variables)
- [ ] Props have sensible defaults where appropriate
