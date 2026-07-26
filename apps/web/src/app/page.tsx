import { palette } from "@gymcoach/shared";

export default function Home() {
  const t = palette.light;
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: t.bg,
        color: t.ink,
        fontFamily:
          '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <h1 style={{ fontWeight: 800, letterSpacing: "-0.02em" }}>GymCoach AI</h1>
      <p style={{ color: t.inkSoft, maxWidth: "40ch", textAlign: "center" }}>
        The personal trainer that remembers every rep, every set, every kg.
      </p>
    </main>
  );
}
