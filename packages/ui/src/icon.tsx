import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleDollarSign,
  CircleHelp,
  Clock,
  Coins,
  Copy,
  ExternalLink,
  FileText,
  Fingerprint,
  Globe,
  KeyRound,
  LifeBuoy,
  Link2,
  LayoutGrid,
  Lock,
  Mail,
  MessageSquare,
  PanelLeft,
  Pause,
  Pin,
  Play,
  RotateCw,
  Search,
  Send,
  Shield,
  SlidersHorizontal,
  Target,
  TriangleAlert,
  Trophy,
  User,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

/**
 * The product's icons, drawn from Lucide. Lucide matches what the design canvases drew by hand:
 * a 24×24 grid, round joins and a single stroke weight, so nothing needed redrawing.
 *
 * The set is curated on purpose. Importing from `lucide-react` directly in a feature is what makes
 * two screens use two different arrows; add a name here instead and every surface gets the same one.
 */
const ICONS = {
  activity: Activity,
  alert: TriangleAlert,
  arrow: ArrowRight,
  arrowDown: ArrowDown,
  arrowLeft: ArrowLeft,
  arrowUp: ArrowUp,
  bars: BarChart3,
  bolt: Zap,
  book: BookOpen,
  chart: ChartLine,
  chat: MessageSquare,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  chevronsUpDown: ChevronsUpDown,
  clock: Clock,
  coin: Coins,
  copy: Copy,
  dollar: CircleDollarSign,
  external: ExternalLink,
  file: FileText,
  fingerprint: Fingerprint,
  globe: Globe,
  grid: LayoutGrid,
  help: CircleHelp,
  key: KeyRound,
  life: LifeBuoy,
  link: Link2,
  lock: Lock,
  mail: Mail,
  pause: Pause,
  pin: Pin,
  play: Play,
  refresh: RotateCw,
  search: Search,
  send: Send,
  shield: Shield,
  sidebar: PanelLeft,
  sliders: SlidersHorizontal,
  target: Target,
  trophy: Trophy,
  user: User,
  users: Users,
  wallet: Wallet,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/**
 * Colour comes from `currentColor` and the weight matches the canvases (1.9). An icon is decoration
 * unless it is given a `label`, and then it is announced; a control with only an icon needs one.
 */
export function Icon({
  name,
  size = 18,
  label,
  ...props
}: { name: IconName; size?: number; label?: string } & Omit<
  ComponentPropsWithoutRef<LucideIcon>,
  "ref"
>) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={1.9}
      absoluteStrokeWidth
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...props}
    />
  );
}
