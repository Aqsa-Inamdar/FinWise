# FinWise Design Guidelines

## Design Approach
**System**: Material Design 3 with Material UI (MUI) components  
**Rationale**: FinWise is a utility-focused, data-dense productivity application where clarity, accessibility, and consistent interaction patterns are paramount. Material Design's emphasis on elevation, clear hierarchy, and robust accessibility features aligns perfectly with financial data presentation.

**Core Principles**:
- Data clarity above decoration
- Immediate comprehension of financial status
- Accessible to users with varying financial literacy
- WCAG 2.1 AA compliance minimum

---

## Color Palette

### Light Mode
- **Primary**: 220 70% 50% (Trust-inspiring blue)
- **Secondary**: 340 65% 48% (Alert red for overspending)
- **Success**: 142 71% 45% (Green for savings/positive trends)
- **Warning**: 38 92% 50% (Amber for budget warnings)
- **Background**: 0 0% 98% (Off-white canvas)
- **Surface**: 0 0% 100% (White cards)
- **Text Primary**: 220 15% 20%
- **Text Secondary**: 220 10% 45%

### Dark Mode
- **Primary**: 220 70% 60%
- **Secondary**: 340 65% 58%
- **Success**: 142 60% 55%
- **Warning**: 38 82% 60%
- **Background**: 220 15% 8%
- **Surface**: 220 12% 12%
- **Text Primary**: 0 0% 95%
- **Text Secondary**: 0 0% 70%

**Chart Colors**: Use 5-color categorical palette for expense categories:
- Rent/Housing: 280 60% 55% (Purple)
- Food/Groceries: 25 75% 55% (Orange)
- Transportation: 200 70% 50% (Cyan)
- Entertainment: 340 65% 55% (Pink)
- Utilities: 160 60% 50% (Teal)

---

## Typography

**Font Family**: 
- Primary: 'Roboto' (Material Design standard)
- Monospace: 'Roboto Mono' (for financial values)

**Scale**:
- H1 Dashboard Title: 32px, weight 300, letter-spacing -0.5px
- H2 Section Headers: 24px, weight 400
- H3 Card Titles: 20px, weight 500
- Body Text: 16px, weight 400, line-height 1.5
- Financial Values: 24px-48px, weight 500-700, monospace
- Labels/Captions: 14px, weight 400, text-secondary color

**Hierarchy**: Large, bold numbers for financial data; smaller, lighter text for labels and context.

---

## Layout System

**Spacing Units**: Use MUI's 8px base grid (theme spacing)
- Common spacing: 1 (8px), 2 (16px), 3 (24px), 4 (32px), 6 (48px)
- Card padding: 3 (24px)
- Section gaps: 4 (32px)
- Element gaps: 2 (16px)

**Grid Structure**:
- Desktop: 12-column grid, max-width 1440px
- Tablet: 8-column grid
- Mobile: 4-column grid with 16px margins

**Dashboard Layout**:
- Permanent sidebar: 280px width (desktop), collapsible drawer (mobile)
- Main content: Remaining width with 32px padding
- Cards: Grid layout, 3 cards per row (desktop), 2 (tablet), 1 (mobile)

---

## Component Library

### Navigation
- **Sidebar**: Permanent drawer with list items, active state with primary color left border (4px) and light background tint
- **Top Bar**: App title, user avatar, theme toggle icon button
- **Mobile**: Bottom navigation bar with 4 main items

### Data Display Cards
- **Summary Cards**: Elevated (elevation 2), rounded corners (8px), 24px padding
- **Structure**: Large financial value (top), label (below), trend indicator icon (top-right), optional sparkline chart (bottom)
- **Hover**: Subtle elevation increase (2→4)

### Charts
- **Types**: Donut chart (expense breakdown), Line chart (trends over time), Bar chart (category comparison)
- **Styling**: 2px stroke width, rounded line caps, grid lines at 0 0% 85% opacity 0.1
- **Interactive**: Tooltips on hover with precise values, legend with click-to-filter

### AI Assistant
- **Floating Action Button**: 56px diameter, bottom-right position (24px from edges), primary color, chat icon
- **Chat Panel**: Slide-in drawer from right, 400px width, message bubbles with user (primary color) and AI (surface with border)
- **Input**: Fixed bottom text field with send icon button

### Forms & Inputs
- **Text Fields**: Outlined variant, 56px height, proper label/helper text
- **Buttons**: Contained (primary actions), Outlined (secondary), Text (tertiary)
- **Date Pickers**: MUI DatePicker with calendar popup
- **Category Selectors**: Autocomplete with colored chips

### Goals Module
- **Goal Cards**: Linear progress bar (8px height), goal name, current/target amounts, deadline
- **Progress Indicators**: Color-coded (green on track, amber approaching deadline, red behind)

### Insights Section
- **Insight Cards**: Icon + headline + description + data visualization
- **Compare Periods**: Side-by-side metric cards with trend arrows

---

## Accessibility Features

- All interactive elements: 44px minimum touch target
- Color contrast: 4.5:1 minimum for text, 3:1 for UI components
- Keyboard navigation: Visible focus indicators (2px outline, primary color)
- ARIA labels: All icon buttons, chart data points, progress indicators
- Screen reader text: Hidden labels for financial values with currency and context
- Focus management: Logical tab order, focus trap in modals/drawers
- Dark mode: Automatically adjusts based on system preference with manual toggle

---

## Animations

**Minimal and Purposeful**:
- Page transitions: 200ms fade-in
- Card hover: 150ms elevation change
- Chart loading: 300ms fade-in with staggered element reveal
- AI chat: 250ms slide-in from right
- No decorative animations

---

## Responsive Behavior

- **Desktop (>1200px)**: Full sidebar, 3-column card grid, side-by-side chart layouts
- **Tablet (768-1199px)**: Collapsible sidebar, 2-column cards, stacked charts
- **Mobile (<768px)**: Bottom navigation, single column, full-width charts, simplified data tables

---

## Data Visualization Guidelines

- Charts occupy full card width
- Minimum 300px height for readability
- Interactive tooltips reveal precise values
- Legend placement: Bottom for pie/donut, top-right for line/bar
- Export functionality: Download as PNG/CSV icon button (top-right)
- Loading states: Skeleton screens with pulse animation

---

## Images

**Profile/Avatar**: User profile image in top-right app bar (40px circle)  
**Empty States**: Illustrative icons (not photos) for "No data yet" states (160px, primary color tint)  
**No hero images** - this is a utility dashboard application