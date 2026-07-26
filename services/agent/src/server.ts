import { createServer } from "node:http";
import { agentDisabled } from "./config.js";
import { runCoachingTurn, type TurnInput } from "./graph.js";

const PORT = Number(process.env.PORT ?? 8787);

/**
 * Minimal HTTP surface for the agent service.
 * Only Supabase Edge Functions call this (service-to-service secret);
 * end users never reach it directly.
 */
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, disabled: agentDisabled() }));
    return;
  }

  if (req.method === "POST" && req.url === "/turn") {
    if (agentDisabled()) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "agent_disabled" }));
      return;
    }
    const secret = process.env.AGENT_SHARED_SECRET;
    if (secret && req.headers["x-agent-secret"] !== secret) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const input = JSON.parse(Buffer.concat(chunks).toString()) as TurnInput;
      const output = await runCoachingTurn(input);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(output));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_request" }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`agent service listening on :${PORT}`);
});
