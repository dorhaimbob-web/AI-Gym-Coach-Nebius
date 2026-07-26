import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Shared plumbing for all Edge Functions.
 *
 * SECURITY MODEL: the admin client bypasses RLS. Every query made with it
 * MUST filter by the authenticated user's id explicitly — treat a missing
 * `.eq("user_id", user.id)` (or ownership check) as a data leak.
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Resolve the calling user from their JWT. Every endpoint requires this. */
export async function getUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

/** GYM-54: fixed-window per-user rate limit. */
export async function allowRate(
  db: SupabaseClient,
  userId: string,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const windowStart = new Date(
    Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000,
  ).toISOString();
  const { data, error } = await db.rpc("bump_rate", {
    p_user_id: userId,
    p_bucket: bucket,
    p_window_start: windowStart,
  });
  if (error) return false; // fail closed
  return (data as number) <= limit;
}

export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/** GYM-21: monthly budget check — done once per session start. */
export async function budgetRemaining(
  db: SupabaseClient,
  userId: string,
): Promise<{ ok: boolean; spentCents: number; budgetCents: number }> {
  const budgetCents = Number(Deno.env.get("USAGE_MONTHLY_BUDGET_CENTS") ?? "3");
  const { data } = await db
    .from("usage_ledger")
    .select("cost_cents")
    .eq("user_id", userId)
    .eq("period", currentPeriod())
    .maybeSingle();
  const spentCents = Number(data?.cost_cents ?? 0);
  return { ok: spentCents < budgetCents, spentCents, budgetCents };
}

export async function recordUsage(
  db: SupabaseClient,
  userId: string,
  usage: { tokensInput: number; tokensOutput: number; costCents: number },
): Promise<void> {
  await db.rpc("record_usage", {
    p_user_id: userId,
    p_period: currentPeriod(),
    p_tokens_input: usage.tokensInput,
    p_tokens_output: usage.tokensOutput,
    p_cost_cents: usage.costCents,
  });
}

/** Call the agent service. GYM-56's kill switch lives on the agent side. */
export async function callAgent(payload: unknown): Promise<Response> {
  const url = Deno.env.get("AGENT_URL");
  const secret = Deno.env.get("AGENT_SHARED_SECRET");
  if (!url || !secret) {
    return new Response(JSON.stringify({ error: "agent_not_configured" }), {
      status: 503,
    });
  }
  return fetch(`${url}/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-secret": secret },
    body: JSON.stringify(payload),
  });
}

/** Camel-case a coach_profiles row into the agent's expected shape. */
export function profileToAgent(row: Record<string, unknown>) {
  return {
    userId: row.user_id,
    coachName: row.coach_name,
    language: row.language,
    tonePreset: row.tone_preset,
    accountabilityStyle: row.accountability_style,
    personaFreeform: row.persona_freeform ?? null,
  };
}

/** Camel-case an exercises row into the agent's expected shape. */
export function exerciseToAgent(row: Record<string, unknown>) {
  return {
    id: row.id,
    planId: row.plan_id,
    orderIndex: row.order_index,
    name: row.name,
    sets: row.sets,
    repRange: row.rep_range,
    restSec: row.rest_sec,
    intensity: row.intensity,
    warmup: row.warmup ?? null,
  };
}

/** Camel-case set_logs rows into the agent's expected shape. */
export function setLogsToAgent(rows: Record<string, unknown>[]) {
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    exerciseId: r.exercise_id,
    setNo: r.set_no,
    weightKg: Number(r.weight_kg),
    reps: r.reps,
    note: r.note ?? null,
    createdAt: r.created_at,
  }));
}

/** Last completed-session logs for one exercise (the "last time" memory). */
export async function lastLogsForExercise(
  db: SupabaseClient,
  userId: string,
  exerciseId: string,
): Promise<Record<string, unknown>[]> {
  const { data: lastSession } = await db
    .from("set_logs")
    .select("session_id, workout_sessions!inner(user_id, started_at, status)")
    .eq("exercise_id", exerciseId)
    .eq("workout_sessions.user_id", userId)
    .eq("workout_sessions.status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastSession) return [];
  const { data } = await db
    .from("set_logs")
    .select("*")
    .eq("session_id", lastSession.session_id)
    .eq("exercise_id", exerciseId)
    .order("set_no", { ascending: true });
  return data ?? [];
}

/** Saved coach notes for this exercise (GYM-22 read side). */
export async function notesForExercise(
  db: SupabaseClient,
  userId: string,
  exerciseId: string,
): Promise<string[]> {
  const { data } = await db
    .from("coach_notes")
    .select("note")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []).map((r) => r.note as string);
}
