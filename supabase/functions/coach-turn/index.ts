import {
  admin,
  allowRate,
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
 * Mid-workout coaching turn: "give me the briefing for exercise X".
 * Part of GYM-16's session flow. No budget check — the session already
 * started; only the per-minute rate limit applies.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "coach-turn", 20, 60))) {
    return json(429, { error: "rate_limited" });
  }

  let sessionId: string, exerciseId: string;
  try {
    ({ sessionId, exerciseId } = await req.json());
    if (typeof sessionId !== "string" || typeof exerciseId !== "string") throw new Error();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  const { data: session } = await db
    .from("workout_sessions")
    .select("id, plan_id, status")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .eq("status", "in_progress")
    .maybeSingle();
  if (!session) return json(404, { error: "session_not_found" });

  const { data: exercise } = await db
    .from("exercises")
    .select("*")
    .eq("id", exerciseId)
    .eq("plan_id", session.plan_id)
    .maybeSingle();
  if (!exercise) return json(404, { error: "exercise_not_found" });

  const { data: profileRow } = await db
    .from("coach_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profileRow) return json(409, { error: "no_coach_profile" });

  const lastLogs = await lastLogsForExercise(db, user.id, exercise.id);
  const notes = await notesForExercise(db, user.id, exercise.id);

  const agentRes = await callAgent({
    userId: user.id,
    planId: session.plan_id,
    profile: profileToAgent(profileRow),
    exercise: exerciseToAgent(exercise),
    lastLogs: setLogsToAgent(lastLogs),
    notes,
  });
  if (!agentRes.ok) return json(503, { error: "coach_unavailable" });

  const turn = await agentRes.json();
  await recordUsage(db, user.id, turn.usage);

  return json(200, {
    exerciseId: exercise.id,
    message: turn.message,
    suggestedWeightKg: turn.suggestedWeightKg,
    targetReps: turn.targetReps,
    degraded: turn.degraded,
  });
});
