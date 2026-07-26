import {
  admin,
  allowRate,
  budgetRemaining,
  callAgent,
  corsHeaders,
  exerciseToAgent,
  getUser,
  json,
  lastLogsForExercise,
  notesForExercise,
  profileToAgent,
  recordUsage,
  setLogsToAgent,
} from "../_shared/mod.ts";

/**
 * GYM-16: POST /session/start  { planId }
 *
 * Budget is checked HERE and only here — a session already running is
 * never cut off mid-set (System Design §7).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "session-start", 5, 60))) {
    return json(429, { error: "rate_limited" });
  }

  const budget = await budgetRemaining(db, user.id);
  if (!budget.ok) {
    return json(402, {
      error: "monthly_budget_exhausted",
      spentCents: budget.spentCents,
      budgetCents: budget.budgetCents,
    });
  }

  let planId: string;
  try {
    ({ planId } = await req.json());
    if (typeof planId !== "string") throw new Error();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  // Ownership + active check (admin client bypasses RLS — filter explicitly).
  const { data: plan } = await db
    .from("training_plans")
    .select("id, name, status")
    .eq("id", planId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!plan) return json(404, { error: "plan_not_found" });

  const { data: firstExercise } = await db
    .from("exercises")
    .select("*")
    .eq("plan_id", plan.id)
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!firstExercise) return json(409, { error: "plan_has_no_exercises" });

  const { data: profileRow } = await db
    .from("coach_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profileRow) return json(409, { error: "no_coach_profile" });

  const { data: session, error: sessionError } = await db
    .from("workout_sessions")
    .insert({ user_id: user.id, plan_id: plan.id, source: "live" })
    .select("id")
    .single();
  if (sessionError || !session) return json(500, { error: "session_create_failed" });

  const lastLogs = await lastLogsForExercise(db, user.id, firstExercise.id);
  const notes = await notesForExercise(db, user.id, firstExercise.id);

  const agentRes = await callAgent({
    userId: user.id,
    planId: plan.id,
    profile: profileToAgent(profileRow),
    exercise: exerciseToAgent(firstExercise),
    lastLogs: setLogsToAgent(lastLogs),
    notes,
  });
  if (!agentRes.ok) return json(503, { error: "coach_unavailable" });

  const turn = await agentRes.json();
  await recordUsage(db, user.id, turn.usage);

  return json(200, {
    sessionId: session.id,
    exerciseId: firstExercise.id,
    message: turn.message,
    suggestedWeightKg: turn.suggestedWeightKg,
    targetReps: turn.targetReps,
    degraded: turn.degraded,
  });
});
