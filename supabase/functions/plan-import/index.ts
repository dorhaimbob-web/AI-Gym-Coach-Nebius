import { admin, allowRate, callAgent, corsHeaders, getUser, json } from "../_shared/mod.ts";

/**
 * GYM-26: paste-and-parse plan onboarding.
 *  { action: "parse", text }  -> parsed preview (nothing written)
 *  { action: "commit", plans } -> archive all active plans, insert new ones
 * Two steps by design: the user always confirms what the parser understood
 * before anything is saved.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "plan-import", 10, 60))) {
    return json(429, { error: "rate_limited" });
  }

  let body: { action: string; text?: string; plans?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  if (body.action === "parse") {
    if (typeof body.text !== "string" || body.text.length < 10 || body.text.length > 20000) {
      return json(400, { error: "invalid_input" });
    }
    const res = await callAgent({ text: body.text }, "/parse-plan");
    if (!res.ok) {
      return json(res.status === 422 ? 422 : 503, {
        error: res.status === 422 ? "unparseable" : "parser_unavailable",
      });
    }
    return json(200, await res.json());
  }

  if (body.action === "commit") {
    const plans = body.plans as Array<{
      name: string;
      exercises: Array<{
        orderIndex: number; name: string; sets: number; repRange: string;
        restSec: number; intensity: string; warmup: string | null;
      }>;
    }>;
    if (!Array.isArray(plans) || plans.length === 0 || plans.length > 10) {
      return json(400, { error: "invalid_input" });
    }
    for (const p of plans) {
      if (typeof p.name !== "string" || !Array.isArray(p.exercises) ||
        p.exercises.length === 0 || p.exercises.length > 30) {
        return json(400, { error: "invalid_input" });
      }
    }

    // Pasting a new program archives everything before it (System Design §5).
    await db.from("training_plans")
      .update({ status: "archived" })
      .eq("user_id", user.id)
      .eq("status", "active");

    const created: Array<{ id: string; name: string }> = [];
    for (const p of plans) {
      const { data: plan, error } = await db
        .from("training_plans")
        .insert({ user_id: user.id, name: p.name })
        .select("id, name")
        .single();
      if (error || !plan) return json(500, { error: "write_failed" });
      const { error: exError } = await db.from("exercises").insert(
        p.exercises.map((e) => ({
          plan_id: plan.id,
          order_index: e.orderIndex,
          name: e.name,
          sets: e.sets,
          rep_range: e.repRange,
          rest_sec: e.restSec,
          intensity: e.intensity,
          warmup: e.warmup,
        })),
      );
      if (exError) return json(500, { error: "write_failed" });
      created.push(plan);
    }
    return json(200, { plans: created });
  }

  return json(400, { error: "unknown_action" });
});
