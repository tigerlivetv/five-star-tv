const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return reply({ error: "POST request သာ လက်ခံပါသည်။" }, 405);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("FIVE_STAR_SECRET_KEY");

    if (!url || !key) {
      return reply({ error: "Server configuration မပြည့်စုံပါ။" }, 500);
    }

    const body = await req.json();
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const deviceId =
      typeof body.deviceId === "string" ? body.deviceId.trim() : "";

    if (code.length < 4 || code.length > 100 || !deviceId || deviceId.length > 200) {
      return reply({ error: "Access Code သို့မဟုတ် Device အချက်အလက် မမှန်ပါ။" }, 400);
    }

    const codeHash = await sha256(code);
    const deviceHash = await sha256(deviceId);

    const headers = {
      apikey: key,
      "Content-Type": "application/json",
    };

    const query = new URLSearchParams({
      select: "id,plan_months,activated_at,expires_at,device_hash,disabled_at",
      code_hash: `eq.${codeHash}`,
      limit: "1",
    });

    const lookup = await fetch(`${url}/rest/v1/access_codes?${query}`, {
      headers,
    });

    if (!lookup.ok) {
      return reply({ error: "Access Code စစ်ဆေးရာတွင် အမှားရှိနေပါသည်။" }, 500);
    }

    const rows = await lookup.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return reply({ error: "Access Code မမှန်ပါ။" }, 401);
    }

    const record = rows[0];

    if (record.disabled_at) {
      return reply({ error: "ဤ Access Code ကို ပိတ်ထားပါသည်။" }, 403);
    }

    const now = new Date();

    if (record.expires_at && new Date(record.expires_at) <= now) {
      return reply({ error: "Access Code သက်တမ်းကုန်ဆုံးပါပြီ။" }, 403);
    }

    if (record.device_hash && record.device_hash !== deviceHash) {
      return reply({ error: "ဤ Access Code ကို အခြား Device နှင့် ချိတ်ဆက်ထားပါသည်။" }, 403);
    }

    let activatedAt = record.activated_at;
    let expiresAt = record.expires_at;

    if (!record.activated_at) {
      const months = Number(record.plan_months);

      if (![1, 2, 3].includes(months)) {
        return reply({ error: "Access Code သက်တမ်းအချက်အလက် မမှန်ပါ။" }, 400);
      }

      expiresAt = addMonths(now, months).toISOString();

      const updateQuery = new URLSearchParams({
        id: `eq.${record.id}`,
        activated_at: "is.null",
        device_hash: "is.null",
        disabled_at: "is.null",
      });

      const update = await fetch(
        `${url}/rest/v1/access_codes?${updateQuery}`,
        {
          method: "PATCH",
          headers: {
            ...headers,
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            activated_at: now.toISOString(),
            expires_at: expiresAt,
            device_hash: deviceHash,
            device_bound_at: now.toISOString(),
          }),
        }
      );

      if (!update.ok) {
        return reply({ error: "Access Code ဖွင့်ရာတွင် အမှားရှိနေပါသည်။" }, 500);
      }

      const updated = await update.json();

      if (!Array.isArray(updated) || updated.length === 0) {
        return reply({ error: "Access Code ကို အခြား Device က အသုံးပြုထားပါသည်။" }, 409);
      }
      activatedAt = now.toISOString();
    }

    const remainingDays = Math.max(
      0,
      Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86400000)
    );

    return reply({
      success: true,
      activated_at: activatedAt,
      expires_at: expiresAt,
      plan_months: Number(record.plan_months),
      remaining_days: remainingDays,
    });
  } catch {
    return reply({ error: "တောင်းဆိုမှုကို လုပ်ဆောင်ရာတွင် အမှားရှိနေပါသည်။" }, 500);
  }
});
