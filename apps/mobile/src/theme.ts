import { useColorScheme } from 'react-native';
import { palette, type Theme } from '@gymcoach/shared';

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return palette[scheme === 'dark' ? 'dark' : 'light'];
}

export { spacing, radius, typography } from '@gymcoach/shared';

/** Floating tab bar geometry — screens use this to keep content clear of it. */
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_BOTTOM_MARGIN = 24;
