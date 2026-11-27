const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const secret = Deno.env.get("FIVE_STAR_SECRET_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    const apiKey = req.headers.get("apikey") || "";

    if (!auth.startsWith("Bearer ") || !apiKey) {
      return json({ error: "Admin login လုပ်ပါ။" }, 401);
    }

    const userRes = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: apiKey, Authorization: auth },
    });
    if (!userRes.ok) return json({ error: "Login သက်တမ်းကုန်သွားပါပြီ။" }, 401);
    const user = await userRes.json();

    const dbHeaders = {
      apikey: secret,
      "Content-Type": "application/json",
    };

    const adminRes = await fetch(
      `${url}/rest/v1/admin_users?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`,
      { headers: dbHeaders },
    );
    if (!adminRes.ok) return json({ error: "Admin စစ်ဆေးမှု မအောင်မြင်ပါ။" }, 500);
    const admins = await adminRes.json();
    if (!admins.length) return json({ error: "ဒီအကောင့်မှာ Admin ခွင့်ပြုချက် မရှိပါ။" }, 403);

    const body = await req.json();
    const action = body.action;

    if (action === "list") {
      const r = await fetch(
        `${url}/rest/v1/access_codes?select=id,plan_months,created_at,activated_at,expires_at,disabled_at&order=created_at.desc&limit=100`,
        { headers: dbHeaders },
      );
      const data = await r.json();
      return r.ok ? json({ codes: data }) : json({ error: "Code စာရင်း မရပါ။" }, 500);
    }

    if (action === "create") {
      const months = Number(body.plan_months);
      if (![1, 2, 3].includes(months)) return json({ error: "Package မမှန်ပါ။" }, 400);

      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      const raw = Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
      const code = `FIVE-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");

      const r = await fetch(`${url}/rest/v1/access_codes`, {
        method: "POST",
        headers: { ...dbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({
          code_hash: hash,
          plan_months: months,
          created_by: user.id,
        }),
      });
      if (!r.ok) return json({ error: "Code သိမ်းဆည်း၍ မရပါ။ " + await r.text() }, 500);
      return json({ success: true, code, plan_months: months });
    }

    if (action === "disable") {
      if (typeof body.id !== "string") return json({ error: "Code ID မမှန်ပါ။" }, 400);
      const r = await fetch(
        `${url}/rest/v1/access_codes?id=eq.${encodeURIComponent(body.id)}`,
        {
          method: "PATCH",
          headers: { ...dbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ disabled_at: new Date().toISOString() }),
        },
      );
      if (!r.ok) return json({ error: "Code ပိတ်၍ မရပါ။" }, 500);
      return json({ success: true });
    }

    return json({ error: "လုပ်ဆောင်ချက် မသိပါ။" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Server error ဖြစ်နေပါသည်။" }, 500);
  }
});
