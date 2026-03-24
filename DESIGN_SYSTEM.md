# IBS-ERP Design System v3

> IBS Heavy Industry — Professional ERP Design System  
> Brand: Navy `#0a2540` + Accent `#e63946` | Font: Inter | Tailwind CSS v4

---

## Design Tokens

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--ibs-navy` | `#0a2540` | Primary buttons, headings, sidebar |
| `--ibs-red` / `--accent` | `#e63946` | CTA buttons, alerts, active states |
| `--success` | `#059669` | Completed, passed, positive |
| `--warning` | `#d97706` | Pending, caution |
| `--danger` | `#dc2626` | Overdue, errors, critical |
| `--info` | `#2563eb` | In-progress, informational |

### Typography Scale

| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | 12px | Labels, captions |
| `--text-sm` | 13px | Body text, descriptions |
| `--text-base` | 15px | Default body |
| `--text-md` | 16px | Emphasized body |
| `--text-lg` | 18px | Section titles |
| `--text-xl` | 22px | Page titles |
| `--text-2xl` | 28px | Stat values |
| `--text-3xl` | 36px | Hero numbers |

### Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | 8px | Tight gaps |
| `--space-sm` | 12px | Element gaps |
| `--space-md` | 16px | Card compact padding, section gaps |
| `--space-lg` | 24px | Card default padding |
| `--space-xl` | 32px | Card spacious padding |
| `--space-2xl` | 40px | Large sections |

### Border Radius

| Token | Value |
|-------|-------|
| `--radius-sm` | 6px |
| `--radius` | 10px |
| `--radius-lg` | 14px |
| `--radius-xl` | 20px |
| `--radius-pill` | 9999px |

---

## Components

### Button

```tsx
import { Button } from '@/components/ui'

<Button variant="primary">Save</Button>
<Button variant="accent">Create</Button>
<Button variant="outline">Cancel</Button>
<Button variant="ghost">Toggle</Button>
<Button variant="danger">Delete</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="md">Medium (default)</Button>
<Button size="lg">Large</Button>
<Button size="icon"><Icon /></Button>

// Loading
<Button loading>Saving...</Button>
```

### Card

```tsx
import { Card } from '@/components/ui'

<Card padding="compact">Compact (16px)</Card>
<Card padding="default">Default (24px)</Card>
<Card padding="spacious">Spacious (32px)</Card>

// Hoverable
<Card hoverable>Hover me</Card>

// Accent bar
<Card accentColor="#0ea5e9">Blue top bar</Card>

// Link card
<Card as="a" href="/page" hoverable>Clickable card</Card>
```

### StatCard

```tsx
import { StatCard } from '@/components/ui'

<StatCard
  label="Total Tasks"
  value={42}
  color="#0a2540"
  icon={<BarChart size={24} />}
/>

// Compact (for inline use)
<StatCard label="Active" value={12} color="#0ea5e9" compact />

// With accent warning
<StatCard label="Overdue" value={5} color="#dc2626" accent />

// Clickable
<StatCard label="WO" value={8} color="#f59e0b" href="/production" />
```

### Badge

```tsx
import { Badge } from '@/components/ui'

<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="danger">Overdue</Badge>
<Badge variant="info">In Progress</Badge>
<Badge variant="default">Draft</Badge>
```

### PageHeader

```tsx
import { PageHeader, Button } from '@/components/ui'

<PageHeader
  title="Projects"
  subtitle="42 total"
  actions={<Button variant="accent">+ Create</Button>}
/>
```

### InputField

```tsx
import { InputField, SelectField, TextareaField } from '@/components/ui'

<InputField label="Company Name" value={name} onChange={...} />
<InputField label="Password" type="password" error="Too short" />
<SelectField label="Currency" options={[{ value: 'VND', label: 'VND' }]} />
<TextareaField label="Description" rows={3} />
```

---

## CSS Utilities

| Class | Effect |
|-------|--------|
| `.section-title` | 18px bold heading |
| `.section-subtitle` | 13px muted text below title |
| `.mono-label` | 12px monospace bold |
| `.filter-pill` / `.filter-pill.active` | Pill-shaped filter button |
| `.welcome-banner` | Navy gradient banner |
| `.project-row` | Hoverable project list item |
| `.bottleneck-item` | Bottleneck card with subtle bg |

---

## Rules

1. **Never use inline `fontSize: 'Npx'`** — always use CSS tokens or Tailwind
2. **Never use raw hex colors inline** — use CSS variables
3. **Always use components** for buttons, cards, badges, page headers
4. **Use `.filter-pill`** for status/category filter buttons
5. **Use `.section-title`/`.section-subtitle`** for section headings
