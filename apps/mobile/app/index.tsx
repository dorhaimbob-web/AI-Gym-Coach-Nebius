import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useTheme } from '../src/theme';

/**
 * Entry router: resume the user at the right step —
 * signed out -> sign-in; no consent -> consent; no plan -> paste plan;
 * no persona -> persona; otherwise the app.
 */
export default function Entry() {
  const theme = useTheme();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (cancelled) return;
      if (!user) return router.replace('/sign-in');

      const [{ data: userRow }, { data: profile }, { count }] = await Promise.all([
        supabase.from('users').select('terms_accepted_at').eq('id', user.id).maybeSingle(),
        supabase.from('coach_profiles').select('user_id').eq('user_id', user.id).maybeSingle(),
        supabase
          .from('training_plans')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active'),
      ]);
      if (cancelled) return;
      if (!userRow?.terms_accepted_at) return router.replace('/consent');
      if (!count) return router.replace('/onboarding-plan');
      if (!profile) return router.replace('/onboarding-persona');
      router.replace('/(tabs)');
    })().finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
      {checking && <ActivityIndicator color={theme.accent} />}
    </View>
  );
}
