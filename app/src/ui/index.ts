// Registering the themes has to happen before ANY `StyleSheet.create` runs, and
// every component below calls it at module scope. The root layout imports the
// config first, but expo-router evaluates nested layouts while it builds the
// route tree — before the root layout's own imports — so a layout that reaches
// for this barrel would otherwise crash with "no theme has been selected yet".
//
// Importing it here makes the guarantee belong to the barrel instead of to the
// import order of every file that uses it.
import '../theme/unistyles';

export { Text, type AppTextProps, type TextVariant } from './Text';
export { CurrencyText, type CurrencyTextProps } from './CurrencyText';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export { Card, type CardProps } from './Card';
export { Field, type FieldProps } from './Field';
export { PressableScale, type PressableScaleProps } from './PressableScale';
export { ToastHost, useToast, type ToastTone } from './Toast';
export { Icon, type IconName, type IconProps } from './Icon';
export { ErrorBoundary } from './ErrorBoundary';
export { HeroBalance, type HeroBalanceProps } from './HeroBalance';
export { ActionStrip, type Action } from './ActionStrip';
export { SectionCard, type SectionCardProps } from './SectionCard';
export { Chip, type ChipProps } from './Chip';
export { DetailRows, type DetailRow } from './DetailRows';
export { SheetScaffold, type SheetScaffoldProps } from './SheetScaffold';
export { SheetNav, SheetNavButton, type SheetNavProps } from './SheetNav';
export { ScreenScaffold, type ScreenScaffoldProps } from './ScreenScaffold';
export { TabBar, type TabBarItem, type TabBarProps } from './TabBar';
