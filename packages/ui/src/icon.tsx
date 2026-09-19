import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  CircleHelp,
  Coins,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  LayoutGrid,
  Lock,
  Mail,
  MessageSquare,
  Pause,
  Play,
  Send,
  SlidersHorizontal,
  Target,
  User,
  Users,
  Wallet,
  X,
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
  arrow: ArrowRight,
  arrowLeft: ArrowLeft,
  bars: BarChart3,
  book: BookOpen,
  chat: MessageSquare,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  coin: Coins,
  copy: Copy,
  dollar: CircleDollarSign,
  external: ExternalLink,
  file: FileText,
  globe: Globe,
  grid: LayoutGrid,
  help: CircleHelp,
  link: Link2,
  lock: Lock,
  mail: Mail,
  pause: Pause,
  play: Play,
  send: Send,
  sliders: SlidersHorizontal,
  target: Target,
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
