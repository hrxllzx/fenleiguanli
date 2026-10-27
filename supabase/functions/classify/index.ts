// ============================================================
// AI 自动分类 Edge Function（Supabase Edge Functions, Deno）
// 职责：校验调用者是老师 → 取分类规则与未分类文件 → 调 DeepSeek 分类
//       → 写回分类结果，并按「分类 → 任务」映射自动下发任务
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEXT_EXT = /\.(txt|md|csv|json|log|py|js|ts|java|c|cpp|h|html|css|xml|ya?ml|ini|cfg)$/i;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "缺少 SUPABASE 环境变量" }, 500);

    // 1. 用调用者 JWT 校验老师身份
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ error: "未登录" }, 401);

    const { data: prof } = await userClient.from("profiles").select("role").eq("id", user.id).single();
    if (!prof || prof.role !== "teacher") return json({ error: "仅老师可执行自动分类" }, 403);

    // 2. 服务端角色客户端（绕过 RLS）
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: categories } = await admin.from("categories").select("*");
    const { data: uploads } = await admin.from("uploads").select("*").is("category_id", null);
    if (!categories || !categories.length) return json({ error: "还没有任何分类规则，请先在「分类规则」里添加" }, 400);
    if (!uploads || !uploads.length) return json({ classified: 0, assigned: 0, total: 0, message: "没有待分类的文件" });

    // 3. 提取文本（仅文本类文件，用于提升分类准确度）
    const items = [];
    for (const u of uploads) {
      let text = "";
      if (TEXT_EXT.test(u.filename || "")) {
        try {
          const { data } = await admin.storage.from("uploads").download(u.storage_path);
          if (data) text = (await data.text()).slice(0, 2000);
        } catch (_) {}
      }
      items.push({ id: u.id, filename: u.filename, text });
    }

    // 4. 调 DeepSeek
    const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
    if (!apiKey) return json({ error: "未配置 DEEPSEEK_API_KEY" }, 500);
    const base = (Deno.env.get("DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/+$/, "");
    const model = Deno.env.get("DEEPSEEK_MODEL") || "deepseek-chat";
    const results = await classifyWithLLM(base, apiKey, model, categories, items);

    // 5. 写回分类 + 下发任务
    const { data: tasks } = await admin.from("tasks").select("*");
    const taskList = tasks || [];
    let classified = 0, assigned = 0;

    for (const r of results) {
      const upload = uploads.find((u) => u.id === r.id);
      if (!upload || !r.category_id) continue;

      const { error: cerr } = await admin.from("uploads")
        .update({ category_id: r.category_id, classified_by: "ai" })
        .eq("id", r.id);
      if (!cerr) classified++;

      const task =
        taskList.find((t) => t.category_id === r.category_id) ||
        taskList.find((t) => t.category_id === null);
      if (task) {
        const { error: aerr } = await admin.from("assignments").insert({
          upload_id: r.id,
          task_id: task.id,
          student_id: upload.student_id,
          status: "pending",
          assigned_by: "ai",
        });
        if (!aerr) assigned++;
      }
    }

    return json({ classified, assigned, total: uploads.length });
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

async function classifyWithLLM(base, apiKey, model, categories, items) {
  const catDesc = categories.map((c) => `- ${c.name}（id: ${c.id}）规则：${c.rules || "无"}`).join("\n");
  const fileDesc = items
    .map((it) => `- id: ${it.id}，文件名: ${it.filename}${it.text ? "，内容摘录: " + it.text : ""}`)
    .join("\n");

  const system = "你是文件自动分类助手。严格根据给定的分类规则，把每个文件归入唯一一个类别。只输出合法 JSON，不要输出任何其它文字。";
  const user =
    `分类规则如下：\n${catDesc}\n\n待分类文件如下：\n${fileDesc}\n\n` +
    `请返回 JSON：{"results":[{"id":"文件id","category_id":"对应类别的id，无法判断则填null","reason":"简短理由"}]}`;

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek 调用失败: ${res.status} ${(await res.text()).slice(0, 200)}`);

  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content || "";
  const parsed = JSON.parse(content);
  const arr = parsed?.results;
  if (!Array.isArray(arr)) throw new Error("DeepSeek 返回格式异常");
  return arr;
}
