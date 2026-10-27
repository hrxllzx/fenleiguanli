/* ============================================================
 * 应用配置
 * ------------------------------------------------------------
 * 【方式一】本地演示模式（默认）：下面两项留空，直接双击打开 index.html
 *   即可体验完整界面。数据保存在浏览器 localStorage，仅用于预览界面。
 *   演示模式下「老师注册码」填 DEMO_TEACHER_CODE 的值即可注册为老师。
 *
 * 【方式二】真实部署（多用户 + 云端存储 + AI）：
 *   1. 到 https://supabase.com 免费创建一个项目
 *   2. Project Settings → API 里复制「Project URL」和「anon public key」
 *   3. 填入下面两项，再按 README.md 完成建表、部署 AI 函数、发布到 GitHub Pages
 * ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL: "",        // 例如 https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: "",   // anon / publishable key

  DEMO_TEACHER_CODE: "teacher123",  // 演示模式下的老师注册码

  APP_NAME: "作业分类与任务分发系统",
  APP_SUBTITLE: "上传 → AI 自动分类 → 按类别分发任务",
};
