import React from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  Database,
  Download,
  FileChartColumn,
  Flame,
  Globe,
  Image,
  Layers2,
  Menu,
  MessageCircle,
  MousePointer2,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  Target,
  Thermometer,
  Users,
  X,
  Zap,
  Filter,
  Clapperboard,
  LayoutDashboard,
  Play,
} from 'lucide-react';

const icons = {
  activity: Activity,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'arrow-up-down': ArrowUpDown,
  bell: Bell,
  'calendar-days': CalendarDays,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  'circle-help': CircleHelp,
  'clock-3': Clock3,
  database: Database,
  download: Download,
  'file-chart-column': FileChartColumn,
  flame: Flame,
  funnel: Filter,
  globe: Globe,
  image: Image,
  'layers-2': Layers2,
  'layout-dashboard': LayoutDashboard,
  menu: Menu,
  'message-circle': MessageCircle,
  'mouse-pointer': MousePointer2,
  search: Search,
  settings: Settings,
  'shopping-bag': ShoppingBag,
  'sliders-horizontal': SlidersHorizontal,
  snowflake: Snowflake,
  sparkles: Sparkles,
  target: Target,
  thermometer: Thermometer,
  users: Users,
  x: X,
  zap: Zap,
  clapperboard: Clapperboard,
  play: Play,
};

export function Icon({ name, className = '', size = 17, ...props }) {
  const Component = icons[name] || Database;
  return <Component className={`icon ${className}`} size={size} aria-hidden="true" {...props} />;
}

export function Panel({ title, subtitle, children, className = '', ...props }) {
  return (
    <section className={`panel ${className}`} {...props}>
      {(title || subtitle) && (
        <header className="panel-heading">
          {title && <h2>{title}</h2>}
          {subtitle && <p>{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Chip({ children, tone = 'neutral' }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function Button({ children, variant = 'secondary', icon, className = '', ...props }) {
  return (
    <button className={`button ${variant} ${className}`} type="button" {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function Tabs({ items, value, onChange, label = 'Pilihan tampilan' }) {
  return (
    <div className="tabs" role="group" aria-label={label}>
      {items.map(([id, title, icon]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {icon && <Icon name={icon} />}
          {title}
        </button>
      ))}
    </div>
  );
}

export function Table({ headings, children, label = 'Tabel data', className = '' }) {
  return (
    <div className={`table-wrap ${className}`} tabIndex={0} role="region" aria-label={label}>
      <table>
        <thead>
          <tr>{headings.map((heading, index) => <th scope="col" key={`${heading}-${index}`}>{heading}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name="database" size={24} /></span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Info({ children }) {
  return <div className="inline-info"><Icon name="circle-help" />{children}</div>;
}

export function Explanation({ children }) {
  return (
    <div className="explain">
      <span><Icon name="zap" />Insight</span>
      <p>{children}</p>
    </div>
  );
}

export function DetailMetrics({ items }) {
  return (
    <div className="detail-metrics">
      {items.map(([label, value]) => (
        <div key={label}><span>{label}</span><strong>{value}</strong></div>
      ))}
    </div>
  );
}

export function StatusChip({ value }) {
  const tone = {
    Hot: 'orange',
    Warm: 'amber',
    Cold: 'indigo',
    Tinggi: 'green',
    Sedang: 'amber',
    Rendah: 'neutral',
    Awal: 'blue',
    Final: 'green',
  }[value] || 'neutral';
  return <Chip tone={tone}>{value}</Chip>;
}
