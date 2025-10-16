# FinWise - Personal Finance Management Application

## Overview

FinWise is a personal finance management web application that helps users track expenses, manage income, set savings goals, and receive AI-powered financial insights. Built with a modern tech stack, it emphasizes accessibility, data clarity, and Material Design principles to provide a utility-focused experience for users with varying financial literacy levels.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build Tools**
- React 18 with TypeScript for type-safe component development
- Vite as the build tool and dev server for fast development experience
- Wouter for lightweight client-side routing

**UI Component System**
- Shadcn/ui components built on Radix UI primitives for accessible, composable UI elements
- Tailwind CSS for utility-first styling with custom design tokens
- Material Design 3 principles with focus on elevation, clarity, and accessibility
- Custom color palette supporting light/dark themes with WCAG 2.1 AA compliance
- Roboto font family for general text, Roboto Mono for financial values

**State Management & Data Fetching**
- TanStack Query (React Query) for server state management, caching, and data synchronization
- React Hook Form with Zod resolvers for form validation and management
- Local component state using React hooks

**Chart & Data Visualization**
- Recharts library for rendering financial charts (pie charts for expense categories, line charts for trends)

### Backend Architecture

**Server Framework**
- Express.js running on Node.js with TypeScript
- ESM module system for modern JavaScript
- Custom middleware for request logging and error handling

**API Design**
- RESTful API endpoints organized by resource (expenses, income, goals)
- JSON request/response format
- Session-based demo user system (authentication to be implemented)

**Data Storage**
- In-memory storage implementation (MemStorage) for development
- Designed to be replaced with PostgreSQL + Drizzle ORM for production
- Schema defined using Drizzle with Zod validation

### Database Schema

**Core Tables** (defined in `shared/schema.ts`):
- **users**: User authentication and profile data
- **expenses**: Transaction records with category, amount, description, date
- **income**: Income records with source, amount, description, date  
- **goals**: Savings goals with target amounts, current progress, deadlines

**Data Types**:
- Decimal precision (10,2) for all monetary values
- UUID primary keys using PostgreSQL `gen_random_uuid()`
- Timestamp fields for temporal tracking

### Authentication & Authorization

**Current Implementation**:
- Demo user system with hardcoded `DEMO_USER_ID`
- No actual authentication flow (placeholder login page)

**Planned Implementation**:
- Session-based authentication using `connect-pg-simple` for PostgreSQL session store
- User registration and login with password hashing
- Protected API routes with user context

### Design System & Accessibility

**Accessibility Features**:
- Skip navigation link for keyboard users
- ARIA live regions for dynamic announcements
- Semantic HTML structure
- Focus management for dialogs and modals
- Keyboard navigation support throughout

**Theme System**:
- CSS custom properties for theming
- Light and dark mode support with system preference detection
- Consistent color palette for charts and UI elements
- Elevation system using shadows and opacity overlays

**Component Patterns**:
- Reusable card components (StatCard, GoalCard, InsightCard) for consistent data presentation
- Dialog-based forms for adding expenses and income
- Responsive layouts using Tailwind's responsive utilities

### Code Organization

**Project Structure**:
- `/client` - React frontend application
  - `/src/components` - Reusable UI components
  - `/src/pages` - Route-level page components
  - `/src/lib` - Utility functions and configurations
- `/server` - Express backend application
  - `routes.ts` - API endpoint definitions
  - `storage.ts` - Data access layer abstraction
- `/shared` - Shared TypeScript types and schemas

**Type Safety**:
- Shared schema definitions between frontend and backend
- Zod schemas for runtime validation
- TypeScript for compile-time type checking
- Drizzle Zod integration for database schema validation

## External Dependencies

### Third-Party UI Libraries
- **Radix UI**: Unstyled, accessible component primitives (dialog, dropdown, select, etc.)
- **Shadcn/ui**: Pre-built component library using Radix UI and Tailwind CSS
- **Lucide React**: Icon library for consistent iconography

### Data Visualization
- **Recharts**: React charting library for financial data visualization

### Database & ORM
- **Neon Database Serverless**: PostgreSQL serverless driver (`@neondatabase/serverless`)
- **Drizzle ORM**: Type-safe SQL ORM with migrations support
- **Drizzle Kit**: CLI tool for schema management and migrations

### Form Handling & Validation
- **React Hook Form**: Performant form state management
- **Zod**: TypeScript-first schema validation
- **@hookform/resolvers**: Integration between React Hook Form and Zod

### Development Tools
- **Vite**: Fast build tool with HMR
- **TypeScript**: Static type checking
- **TSX**: TypeScript execution for development server
- **esbuild**: Fast JavaScript bundler for production builds
- **Replit-specific plugins**: Development tooling for Replit environment

### Session Management
- **connect-pg-simple**: PostgreSQL session store for Express (configured but not actively used)

### Styling
- **Tailwind CSS**: Utility-first CSS framework
- **PostCSS & Autoprefixer**: CSS processing tools
- **class-variance-authority**: Component variant styling utility
- **clsx & tailwind-merge**: Class name composition utilities

### Future Integrations (Planned)
- AI/LLM service for financial insights and chatbot functionality
- Email service for notifications
- External financial data APIs for transaction imports