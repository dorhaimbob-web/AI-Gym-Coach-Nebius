"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import posthog from "posthog-js";
import { palette } from "@gymcoach/shared";
import { supabase, callFn } from "../../lib/supabase";

const t = palette.light;

interface Exercise { id: string; name: string; sets: number; rep_range: string; order_index: number }
interface Plan { id: string; name: string; exercises: Exercise[] }

/**
 * GYM-35: web mirror of the plan — view the active program, paste a new
 * one (same parse-confirm-commit flow as the app; no in-place editing).
 */
export default function PlanPage() {
  const [session, setSession] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<unknown[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const identifiedUserId = useRef<string | null>(null);

  async function loadPlans() {
    const { data } = await supabase
      .from("training_plans")
      .select("id, name, exercises(id, name, sets, rep_range, order_index)")
      .eq("status", "active");
    setPlans((data ?? []) as unknown as Plan[]);
  }

  function synchronizeSession(currentSession: Session | null, resetOnSignOut = false) {
    setSession(!!currentSession);

    if (currentSession) {
      const { user } = currentSession;
      if (identifiedUserId.current !== user.id) {
        if (identifiedUserId.current) posthog.reset();
        posthog.identify(user.id, user.email ? { email: user.email } : {});
        identifiedUserId.current = user.id;
      }
      void loadPlans();
    } else if (resetOnSignOut && identifiedUserId.current) {
      posthog.reset();
      identifiedUserId.current = null;
      setPlans([]);
    }
  }

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      synchronizeSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      synchronizeSession(currentSession, event === "SIGNED_OUT");
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn() {
    setBusy(true);
    setError("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError("Sign-in failed — check email and password.");
    else {
      synchronizeSession(data.session);
      posthog.capture("user_signed_in");
    }
  }

  async function parse() {
    setBusy(true);
    setError("");
    try {
      const res = await callFn<{ plans: unknown[] }>("plan-import", { action: "parse", text: pasteText });
      setPreview(res.plans);
      posthog.capture("training_plan_parsed", {
        parsed_plan_count: res.plans.length,
      });
    } catch {
      setError("Could not parse that text — clean it up and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      await callFn("plan-import", { action: "commit", plans: preview });
      posthog.capture("training_plan_replaced", {
        replacement_plan_count: preview?.length ?? 0,
      });
      setPreview(null);
      setPasteText("");
      await loadPlans();
    } catch {
      setError("Saving failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = {
    border: `1px solid ${t.rule}`, borderRadius: 12, padding: 10, width: "100%", boxSizing: "border-box",
  };

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24, fontFamily: '-apple-system, "Segoe UI", Arial, sans-serif', color: t.ink }}>
      <h1 style={{ fontWeight: 800, letterSpacing: "-0.02em" }}>My plan</h1>

      {session === null ? (
        <p style={{ color: t.inkSoft }}>Loading…</p>
      ) : !session ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
          <input style={box} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={box} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button
            onClick={signIn}
            disabled={busy}
            style={{ background: t.accent, color: t.onAccent, padding: "10px 22px", borderRadius: 24, fontWeight: 700, border: "none", cursor: "pointer" }}
          >
            Sign in
          </button>
          {error && <p style={{ color: t.critical }}>{error}</p>}
        </div>
      ) : (
        <>
          {plans.map((p) => (
            <section key={p.id} style={{ background: t.surface, borderRadius: 14, padding: 16, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>{p.name}</h2>
              <ol style={{ margin: "8px 0 0", paddingInlineStart: 20 }}>
                {[...p.exercises].sort((a, b) => a.order_index - b.order_index).map((e) => (
                  <li key={e.id} style={{ fontSize: 14, marginBottom: 2 }}>
                    {e.name} — {e.sets}×{e.rep_range}
                  </li>
                ))}
              </ol>
            </section>
          ))}

          <h2 style={{ fontSize: 16 }}>Paste a new plan</h2>
          <p style={{ color: t.inkSoft, fontSize: 13 }}>
            Pasting a new program archives the current one and starts fresh logs.
          </p>
          <textarea
            style={{ ...box, minHeight: 140, fontFamily: "inherit" }}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          {!preview ? (
            <button
              onClick={parse}
              disabled={busy || pasteText.length < 10}
              style={{ background: t.accent, color: t.onAccent, padding: "10px 22px", borderRadius: 24, fontWeight: 700, border: "none", cursor: "pointer", marginTop: 10 }}
            >
              {busy ? "Parsing…" : "Parse"}
            </button>
          ) : (
            <button
              onClick={commit}
              disabled={busy}
              style={{ background: t.success, color: "#fff", padding: "10px 22px", borderRadius: 24, fontWeight: 700, border: "none", cursor: "pointer", marginTop: 10 }}
            >
              Confirm and replace plan
            </button>
          )}
          {error && <p style={{ color: t.critical }}>{error}</p>}
        </>
      )}
    </main>
  );
}
